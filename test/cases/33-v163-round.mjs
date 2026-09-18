// v163 — the owner's round after testing v162. Five things landed here, and the
// interesting part of each is WHY it was broken:
//
// 1. ceilings (“image 100 MB, video 2 GB, documents 5 GB, voice 100 MB”). The
//    worker's single POST could only ever carry what a request body can hold, so
//    the big three need a chunked route: start -> N parts -> complete, each part
//    streamed straight into R2. The old 25 MB flat cap is what the client showed
//    as “That file is over 25 MB”.
// 2. delete-for-everyone is PERMANENT. The old delete left a tombstone row
//    (kind DELETED, body/media blanked) in D1 forever and kept the object in R2
//    until an unrelated sweep noticed it.
// 3. a status is gone from the SERVER 24 h after it was posted — the sweep
//    existed but only ran when somebody listed statuses, so a quiet account's
//    expired photo sat there until the next open.
// 4. the sending ring's middle is a ✕ that CANCELS the send (the percentage text
//    is gone). Cancel has to work at both ends of the race: still queued (the
//    upload never starts) and already posted (the row is deleted for everyone).
// 5. a sent video/photo shows its OWN ratio thumbnail — a clip used to be laid
//    out on a hardcoded 16:9 fake tile until the receiver had bytes to decode.
//    The fix measures the box on the SENDING side and rides it in meta.w/meta.h.
//
// The worker half of all of that runs live here (through the same shim CI uses);
// the Android half is pinned as source shape, because there is no Android SDK in
// this sandbox — CI's assembleRelease is the compile.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";
import { readFileSync } from "node:fs";

installGoogleStub();

let n = 0;
const fresh = async () =>
  (await import(new URL("../../src/worker/index.ts", import.meta.url).href + `?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const MB = 1024 * 1024;

async function mk() {
  const worker = await fresh();
  const db = makeD1();
  const media = makeR2();
  const broadcasts = [];
  const env = {
    DB: db,
    MEDIA: media,
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    // The tombstone has to reach the other devices THROUGH the room, so the
    // fake DO records every frame the worker pushes into it.
    CHAT_ROOM: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async (url, init) => {
          broadcasts.push({ room: id.name, body: JSON.parse(init.body) });
          return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200 });
        },
      }),
    },
  };
  const ctx = makeCtx();
  let ipSeq = 0;
  // `raw` lets a case send real bytes (an upload) instead of a JSON body.
  const call = async (method, path, body, token, raw) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.17.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (raw) {
      init.body = raw.bytes;
      if (raw.type) headers["content-type"] = raw.type;
    } else if (body !== undefined && method !== "GET") {
      init.body = JSON.stringify(body);
    }
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 120) };
    }
    return { status: res.status, json: j };
  };
  // A byte-exact read (the multipart round trip compares real bytes, so the
  // JSON-parsing wrapper above is not enough).
  const fetchRaw = async (method, path, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await worker.fetch(
      new Request(`https://kp.test${path}`, { method, headers }),
      env,
      ctx,
    );
    await ctx.drain();
    return res;
  };
  const upload = (name, type, bytes, token) =>
    call(
      "POST",
      `/api/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      undefined,
      token,
      {
        bytes,
        type: "application/octet-stream",
      },
    );
  return { worker, db, media, env, ctx, call, fetchRaw, upload, broadcasts, reg: makeReg(call) };
}

// ---------------------------------------------------------------------------
// 1. the ceilings, on the real routes
// ---------------------------------------------------------------------------
{
  const k = await mk();
  const a = await k.reg("v163-limits@x.com", "lim");

  // 26 MB through the single route: refused with a code the client can act on
  // (it retries through the chunked route), not a generic 413.
  const big = await k.upload("clip.mp4", "video/mp4", Buffer.alloc(26 * MB, 7), a.token);
  check(
    "v163 (owner's size rules): a single POST above 25 MB is refused with 413 USE_MULTIPART — the client's cue to switch to the chunked route",
    big.status === 413 && big.json.error?.code === "USE_MULTIPART",
    JSON.stringify(big.json).slice(0, 140),
  );

  // The per-kind ceilings are enforced at the START of a chunked upload, i.e.
  // before a byte moves — a 3 GB “image” must not upload for ten minutes first.
  const start = (name, type, size) =>
    k.call("POST", "/api/files/mpu/start", { name, type, size }, a.token);
  const img150 = await start("p.jpg", "image/jpeg", 150 * MB);
  const doc6 = await start("d.pdf", "application/pdf", 6 * 1024 * MB);
  const voice101 = await start("v.m4a", "audio/mp4", 101 * MB);
  const vid2 = await start("big.mp4", "video/mp4", 2 * 1024 * MB);
  const img99 = await start("ok.jpg", "image/jpeg", 99 * MB);
  check(
    "v163: the chunked route refuses 150 MB of image, 6 GB of document and 101 MB of voice with 413 TOO_LARGE — and accepts exactly 2 GB of video / 99 MB of image",
    img150.status === 413 &&
      img150.json.error?.code === "TOO_LARGE" &&
      img150.json.error?.message.includes("100 MB") &&
      doc6.status === 413 &&
      doc6.json.error?.message.includes("5 GB") &&
      voice101.status === 413 &&
      voice101.json.error?.message.includes("100 MB") &&
      vid2.status === 201 &&
      img99.status === 201,
    JSON.stringify({
      img150: img150.json.error?.message,
      doc6: doc6.json.error?.message,
      voice101: voice101.json.error?.message,
      vid2: vid2.status,
      img99: img99.status,
    }),
  );
  check(
    "v163: the chunked start hands back the session (uploadId + 8 MB part size + the key the parts will land on)",
    vid2.status === 201 &&
      !!vid2.json.uploadId &&
      vid2.json.partSize === 8 * MB &&
      /^f\//.test(vid2.json.key || ""),
    JSON.stringify(vid2.json).slice(0, 140),
  );
}

// ---------------------------------------------------------------------------
// 2. the chunked round trip — the bytes must arrive WHOLE and the object must be
//    the sender's own key, reachable by the recipient
// ---------------------------------------------------------------------------
{
  const k = await mk();
  const a = await k.reg("v163-mpu-a@x.com", "mpa");
  const b = await k.reg("v163-mpu-b@x.com", "mpb");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;

  const total = 20 * MB;
  const body = Buffer.alloc(total);
  for (let i = 0; i < total; i += 4096) body.writeUInt32LE(i, i);
  const started = await k.call(
    "POST",
    "/api/files/mpu/start",
    { name: "holiday.mp4", type: "video/mp4", size: total },
    a.token,
  );
  const uploadId = started.json.uploadId;
  const partSize = started.json.partSize;
  const etags = [];
  for (let off = 0, part = 1; off < total; off += partSize, part++) {
    const slice = body.subarray(off, Math.min(total, off + partSize));
    const res = await k.call(
      "PUT",
      `/api/files/mpu/part?uploadId=${uploadId}&n=${part}`,
      undefined,
      a.token,
      { bytes: slice, type: "application/octet-stream" },
    );
    etags.push({ part, status: res.status, etag: res.json.etag });
  }
  const done = await k.call("POST", "/api/files/mpu/complete", { uploadId }, a.token);
  const key = done.json.fileKey;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "holiday.mp4",
      fileType: "video/mp4",
      fileSize: total,
      clientId: "v163_mpu_1",
      // v163 item 5: the sender measures the box and the POST carries it.
      meta: { w: 1080, h: 1920 },
    },
    a.token,
  );
  const backRes = await k.fetchRaw("GET", `/api/files/${key}`, b.token);
  const got = Buffer.from(await backRes.arrayBuffer());
  check(
    "v163: start -> 3 parts -> complete lands the file with every byte intact (the recipient reads back the same 20 MB, same first/last word)",
    done.status === 201 &&
      !!key &&
      etags.every((e) => e.status === 200 && !!e.etag) &&
      sent.status === 201 &&
      backRes.status === 200 &&
      got.length === total &&
      got.readUInt32LE(0) === 0 &&
      got.readUInt32LE(total - 4096) === total - 4096,
    JSON.stringify({
      done: done.status,
      etags: etags.map((e) => e.status),
      back: backRes.status,
      len: got.length,
    }),
  );
  const uploadRow = k.db._db.prepare("SELECT * FROM uploads WHERE id = ?").get(uploadId);
  const fileRow = k.db._db.prepare("SELECT owner_id FROM files WHERE key = ?").get(key);
  check(
    "v163: completing the upload drops the session row and binds the object to its owner (the parts' etags were kept in the row between requests)",
    !uploadRow && fileRow?.owner_id === a.user.id,
    JSON.stringify({ upload: !!uploadRow, owner: fileRow?.owner_id }),
  );

  // The ratio contract for a video that the receiver has never downloaded.
  const row = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
  const msg = (row.json.items || []).find((m) => m.clientId === "v163_mpu_1");
  check(
    "v163 (owner's thumbnail rule): meta.w/meta.h ride the POST and come back to the OTHER side as mediaW/mediaH — that is what lets the receiver's bubble be the clip's own shape on its first frame instead of the hardcoded 16:9 fake tile",
    msg?.mediaW === 1080 && msg?.mediaH === 1920,
    JSON.stringify({ w: msg?.mediaW, h: msg?.mediaH }),
  );
  // …and view-once stays dimension-free, as round 32 designed it: no shape leak
  // before the single opening. The client keeps a neutral tile for it.
  const once = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "once.mp4",
      fileType: "video/mp4",
      fileSize: total,
      clientId: "v163_mpu_once",
      meta: { viewOnce: true, w: 1080, h: 1920 },
    },
    a.token,
  );
  check(
    "v163: …while a VIEW-ONCE clip still publishes no dimensions (nothing about the picture leaks before the opening), even when the sender sent them",
    !once.json.message?.mediaW && once.json.message?.meta?.viewOnce === true,
    JSON.stringify({ w: once.json.message?.mediaW, meta: once.json.message?.meta }),
  );

  // abort: the half-sent session leaves nothing behind
  const second = await k.call(
    "POST",
    "/api/files/mpu/start",
    { name: "left.mp4", type: "video/mp4", size: 40 * MB },
    a.token,
  );
  await k.call(
    "PUT",
    `/api/files/mpu/part?uploadId=${second.json.uploadId}&n=1`,
    undefined,
    a.token,
    { bytes: Buffer.alloc(1024, 1), type: "application/octet-stream" },
  );
  const aborted = await k.call(
    "POST",
    "/api/files/mpu/abort",
    { uploadId: second.json.uploadId },
    a.token,
  );
  const after = await k.call(
    "POST",
    "/api/files/mpu/complete",
    { uploadId: second.json.uploadId },
    a.token,
  );
  check(
    "v163: the ✕ on a half-sent big file aborts it server-side — the session row is gone, the R2 multipart is dropped, and a late complete answers 404 instead of resurrecting it",
    aborted.status === 200 &&
      !k.db._db.prepare("SELECT 1 AS x FROM uploads WHERE id = ?").get(second.json.uploadId) &&
      k.media._multiparts.size === 0 &&
      after.status === 404,
    JSON.stringify({ abort: aborted.status, after: after.status, open: k.media._multiparts.size }),
  );
}

// ---------------------------------------------------------------------------
// 3. delete-for-everyone is permanent — row, object and files row all go, and
//    the dust still reaches the other devices
// ---------------------------------------------------------------------------
{
  const k = await mk();
  const a = await k.reg("v163-del-a@x.com", "dla");
  const b = await k.reg("v163-del-b@x.com", "dlb");
  const conv = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const cid = conv.json.conversation.id;
  const up = await k.upload("pic.jpg", "image/jpeg", Buffer.alloc(2048, 3), a.token);
  const key = up.json.fileKey;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "pic.jpg",
      fileType: "image/jpeg",
      fileSize: 2048,
      clientId: "v163_del_1",
      meta: { w: 900, h: 1600 },
    },
    a.token,
  );
  const id = sent.json.message.id;
  // One survivor, so "the deleted row is gone" can be read off a NON-empty list
  // instead of a rout that simply answered nothing.
  const keep = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "TEXT", body: "keep me", clientId: "v163_del_2" },
    a.token,
  );
  k.broadcasts.length = 0;
  const del = await k.call("DELETE", `/api/messages/${id}`, undefined, a.token);
  const rowGone = !k.db._db.prepare("SELECT 1 AS x FROM messages WHERE id = ?").get(id);
  const objGone = !k.media._store?.has(key);
  const fileGone = !k.db._db.prepare("SELECT 1 AS x FROM files WHERE key = ?").get(key);
  const dust = k.broadcasts
    .map((x) => x.body)
    .find((x) => x.type === "message" && x.message?.id === id);
  check(
    "v163 (owner: “delete for everyone must really delete”): the message row, the R2 object and the files row are all gone after the delete — no tombstone row is left in D1",
    del.status === 200 && rowGone && objGone && fileGone,
    JSON.stringify({ del: del.status, rowGone, objGone, fileGone }),
  );
  check(
    "v163: …and the other side still gets its dust — the room frame carries the DELETED shape (no media, no body, no meta) the client's delete animation already knows how to paint",
    dust?.message?.kind === "DELETED" &&
      !dust.message.media &&
      !dust.message.meta &&
      !dust.message.fileKey &&
      dust.message.id === id,
    JSON.stringify(dust?.message || null).slice(0, 160),
  );
  const list = await k.call("GET", `/api/conversations/${cid}/messages`, undefined, b.token);
  const items = list.json.items || [];
  check(
    "v163: the deleted message is not in the recipient's history either (the row is gone, not hidden)",
    keep.status === 201 &&
      items.length === 1 &&
      items[0].id === keep.json.message.id &&
      !items.some((m) => m.id === id),
    JSON.stringify({ len: items.length, ids: items.map((m) => m.id) }).slice(0, 140),
  );
}

// ---------------------------------------------------------------------------
// 4. the 24 h status rule runs on the CRON, not on someone opening statuses
// ---------------------------------------------------------------------------
{
  const k = await mk();
  const a = await k.reg("v163-status@x.com", "sta");
  const up = await k.upload("s.jpg", "image/jpeg", Buffer.alloc(64, 9), a.token);
  const key = up.json.fileKey;
  const past = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  k.db._db
    .prepare(
      "INSERT INTO statuses (id, user_id, kind, media, text, created_at, expires_at) VALUES (?, ?, 'IMAGE', ?, NULL, ?, ?)",
    )
    .run("st_v163_expired", a.user.id, key, past, past);
  k.db._db
    .prepare("INSERT INTO status_views (status_id, viewer_id, viewed_at) VALUES (?, ?, ?)")
    .run("st_v163_expired", a.user.id, past);
  // A row in the future must survive the same tick.
  const future = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  k.db._db
    .prepare(
      "INSERT INTO statuses (id, user_id, kind, media, text, created_at, expires_at) VALUES (?, ?, 'TEXT', NULL, 'still here', ?, ?)",
    )
    .run("st_v163_live", a.user.id, past, future);
  await k.worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" }, k.env, k.ctx);
  await k.ctx.drain();
  const expiredGone = !k.db._db
    .prepare("SELECT 1 AS x FROM statuses WHERE id = 'st_v163_expired'")
    .get();
  const viewsGone = !k.db._db
    .prepare("SELECT 1 AS x FROM status_views WHERE status_id = 'st_v163_expired'")
    .get();
  const liveKept = !!k.db._db
    .prepare("SELECT 1 AS x FROM statuses WHERE id = 'st_v163_live'")
    .get();
  check(
    "v163 (owner's 24 h rule): a plain cron tick — nobody opened the statuses screen — permanently deletes the expired status, its view rows and its R2 object, and leaves the unexpired one alone",
    expiredGone && viewsGone && !k.media._store?.has(key) && liveKept,
    JSON.stringify({ expiredGone, viewsGone, objGone: !k.media._store?.has(key), liveKept }),
  );

  // An abandoned multipart session older than a day is aborted by the same tick.
  const stale = await k.call(
    "POST",
    "/api/files/mpu/start",
    { name: "zombie.mp4", type: "video/mp4", size: 30 * MB },
    a.token,
  );
  const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  k.db._db.prepare("UPDATE uploads SET created_at = ? WHERE id = ?").run(old, stale.json.uploadId);
  await k.worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" }, k.env, k.ctx);
  await k.ctx.drain();
  check(
    "v163: the tick also collects an abandoned multipart session (app killed mid-upload): the R2 parts are aborted and the session row is gone",
    !k.db._db.prepare("SELECT 1 AS x FROM uploads WHERE id = ?").get(stale.json.uploadId) &&
      k.media._multiparts.size === 0,
    JSON.stringify({ open: k.media._multiparts.size }),
  );
}

// ---------------------------------------------------------------------------
// 5. the Android half — pinned as source shape (CI's gradle build is the compile)
// ---------------------------------------------------------------------------
{
  const api = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Api.kt",
    "utf8",
  );
  const chat = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt",
    "utf8",
  );
  const cache = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/Cache.kt",
    "utf8",
  );
  const viewer = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/MediaViewer.kt",
    "utf8",
  );
  const editor = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/MediaEditScreen.kt",
    "utf8",
  );
  const share = readFileSync(
    "native-android/app/src/main/java/app/kuchupuchu/android/ShareIntake.kt",
    "utf8",
  );
  const worker = readFileSync("src/worker/index.ts", "utf8");
  const shared = readFileSync("src/shared/constants.ts", "utf8");

  check(
    "v163: the client's ceilings match the server's (image 100 MB / video 2 GB / documents 5 GB / voice 100 MB, single request 25 MB) and `limitFor` picks by mime or extension with documents as the default",
    api.includes("const val IMAGE_MAX = 100L * 1024 * 1024") &&
      api.includes("const val VIDEO_MAX = 2L * 1024 * 1024 * 1024") &&
      api.includes("const val DOC_MAX = 5L * 1024 * 1024 * 1024") &&
      api.includes("const val VOICE_MAX = 100L * 1024 * 1024") &&
      api.includes("const val SINGLE_MAX = 25L * 1024 * 1024") &&
      api.includes('fun limitFor(mime: String, name: String = ""): Long {') &&
      api.includes("else -> DOC_MAX") &&
      shared.includes("IMAGE_MAX_BYTES = 100 * 1024 * 1024") &&
      shared.includes("VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024") &&
      shared.includes("DOC_MAX_BYTES = 5 * 1024 * 1024 * 1024") &&
      shared.includes("VOICE_MAX_BYTES = 100 * 1024 * 1024") &&
      shared.includes("UPLOAD_PART_BYTES = 8 * 1024 * 1024") &&
      shared.includes("SINGLE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024") &&
      shared.includes("export function mediaLimitFor"),
  );
  check(
    "v163: the raw-bytes routes keep their body UNREAD so the upload can stream — and no other route does: the multipart start/complete/abort parse JSON (a blanket `/api/files` skip made every chunked upload answer “File is empty.”)",
    worker.includes("const rawBytes =") &&
      worker.includes(
        '(path === "/api/files" && method === "POST") || path === "/api/files/mpu/part"',
      ) &&
      worker.includes('if (method !== "GET" && method !== "HEAD" && !rawBytes) {') &&
      !worker.includes('!path.startsWith("/api/files")'),
  );
  check(
    "v163: every send path checks the ceiling for WHAT it is before a byte leaves the phone (chat file/video, voice note, editor export, share intake) — the old flat 25 MB check is gone",
    chat.includes("val cap = Api.limitFor(mime, name)") &&
      chat.includes("if (file.length() > cap) {") &&
      chat.includes("if (file.length() > Api.VOICE_MAX) {") &&
      editor.includes("if (bytes.size > Api.VIDEO_MAX)") &&
      share.includes("> Api.limitFor(declared, name)") &&
      share.includes("> Api.limitFor(item.mime, item.file.name)") &&
      !chat.includes("if (file.length() > VideoPlan.UPLOAD_LIMIT) {"),
  );
  check(
    "v163: anything above 25 MB goes out through the chunked route — start, then one streaming PUT per 8 MB part (reading the file at an offset, never into memory), then complete; a failure aborts the session so nothing is left half-uploaded",
    api.includes(
      "fun uploadChunked(name: String, mime: String, file: java.io.File, onProgress: ((Long, Long) -> Unit)? = null): JSONObject {",
    ) &&
      api.includes('url(BASE + "/api/files/mpu/start")') &&
      api.includes('url(BASE + "/api/files/mpu/part?uploadId=${q(uploadId)}&n=$n")') &&
      api.includes('url(BASE + "/api/files/mpu/complete")') &&
      api.includes('java.io.RandomAccessFile(file, "r").use { raf ->') &&
      api.includes("raf.seek(offset)") &&
      api.includes("val len = minOf(partSize, total - done)") &&
      api.includes("fun abortChunked(uploadId: String) {") &&
      api.includes("if (total > SINGLE_MAX) return uploadChunked(name, mime, file, onProgress)"),
  );
  check(
    "v163 (owner's thumbnail rule): the sender MEASURES the box on IO and the queue stamps it into the POST — clips through the retriever (rotation aware, so a portrait clip is not laid out landscape), images from their header only — and never overwrites a box the caller already knows",
    chat.includes("internal object MediaBox {") &&
      chat.includes("fun readVideoDims(file: java.io.File): Pair<Int, Int>? {") &&
      chat.includes("if (rot == 90 || rot == 270) {") &&
      chat.includes("fun measure(") &&
      chat.includes("inJustDecodeBounds = true") &&
      cache.includes(
        "private fun stampBox(clientId: String, body: JSONObject, mime: String, f: File) {",
      ) &&
      cache.includes('if (meta.optInt("w") > 0 && meta.optInt("h") > 0) return') &&
      cache.includes('meta.put("w", box.first).put("h", box.second)') &&
      cache.includes("stampBox(clientId, body, mime, f)") &&
      cache.includes('items.firstOrNull { it.optString("clientId") == clientId }') &&
      api.includes(
        'if (res.optInt("n", n) != n) throw ApiException(500, "Upload part was refused.")',
      ),
  );
  check(
    "v163: every bubble that draws media takes the message's own box before any hardcoded 16:9 — the clip bubble, the full-screen viewer, and the view-once tile (which now draws the clip's own frame as a 16 px mosaic instead of the fake tile, and keeps a neutral box only when nothing is known, i.e. a view-once clip the recipient has not opened)",
    chat.includes("?: MediaBox.payloadRatio(m).takeIf { it > 0f }") &&
      chat.includes("Modifier.heightIn(max = 320.dp).aspectRatio(videoRatio)") &&
      viewer.includes("?: MediaBox.payloadRatio(m).takeIf { it > 0f }") &&
      chat.includes('var videoRatio by remember(m.optString("id")) {') &&
      chat.includes(
        "android.graphics.Bitmap\n                                .createScaledBitmap(it, 16,",
      ) &&
      chat.includes("filterQuality = androidx.compose.ui.graphics.FilterQuality.None,"),
  );
  check(
    "v163 (the delete-animation regression the owner hit): the dust hold keeps every latched id of an ACTIVE show — v161 filtered the latched ids out, so the hold merged nothing and paintFromStore replaced the row ~200 ms in, which is the animation cutting off early",
    chat.includes("val holdAll = hold.filter { it !in dustLatched || it in vanishingIds }") &&
      !chat.includes("val holdAll = hold.filter { it !in dustLatched }"),
  );
  check(
    "v163 (cancel send, and it has to mean it): the progress callback throws the moment the id is cancelled — so the ✕ stops the BYTES mid-file (a 2 GB send used to keep streaming) — the dropped view is torn down by OkHttp inside the body writer, the retry walk neither re-posts nor retries a cancelled id, and a cancel never paints a red “failed” bubble",
    chat.includes("fun cancelSend(clientId: String)") &&
      cache.includes("fun cancel(clientId: String): Boolean {") &&
      cache.includes("cancelled.add(clientId)") &&
      cache.includes('items.removeAll { it.optString("clientId") == clientId }') &&
      cache.includes("if (isCancelled(clientId)) {") &&
      cache.includes('if (isCancelled(clientId)) throw ApiException(499, "Cancelled.")') &&
      cache.includes("if (status == 499 || isCancelled(clientId)) {") &&
      cache.includes('Api.delete("/api/messages/$id")') &&
      !chat.includes("(upFrac * 100).toInt()}%"),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
