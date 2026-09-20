// H3 (audit 2026-09-21): a view-once opening is spent by the fetch itself.
//
// Before: GET /api/messages/:id/media served view-once bytes to any member
// any number of times; the spend happened only when the viewer voluntarily
// POSTed /view — a modified client could pull + keep the bytes forever.
// Now: the first non-sender fetch serves the bytes once (no-store) and
// vanishes the row + object, recomputes the preview, and emits the same
// VANISHED frame + sender list-poke POST /view sends. The sender's own
// preview still streams free, ordinary messages are untouched, and the app
// never caches view-once bytes (Coil bypass + v2 disk dir + dispose wipe).

import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token, raw) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `198.51.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    let init = { method, headers };
    if (raw) {
      init = { method, headers: raw.headers, body: raw.body };
      if (token) init.headers.authorization = `Bearer ${token}`;
    } else if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const buf = Buffer.from(await res.arrayBuffer());
    await ctx.drain();
    let j = {};
    try {
      j = JSON.parse(buf.toString());
    } catch {
      j = {};
    }
    return { status: res.status, json: j, headers: res.headers, body: buf };
  };
  const reg = makeReg(call);
  return { db, call, reg };
}

const upload = (k, tok, name, type, bytes) =>
  k.call("POST", `/api/files?name=${name}&type=${type}`, undefined, tok, {
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(bytes),
  });

const sendOncePhoto = (k, cid, key, tok) =>
  k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "photo.jpg",
      fileType: "image/jpeg",
      fileSize: 16,
      meta: { viewOnce: true, w: 1200, h: 900 },
    },
    tok,
  );

// ---- 1. recipient fetch spends: bytes once, then gone everywhere ----
{
  const k = await mk();
  const A = await k.reg("h3a@x.com", "h3a");
  const B = await k.reg("h3b@x.com", "h3b");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const key = (await upload(k, A.token, "photo.jpg", "image/jpeg", "ONCEBYTES-1")).json.fileKey;
  const mid = (await sendOncePhoto(k, cid, key, A.token)).json.message?.id;
  check("view-once photo sends", !!mid, `mid=${mid}`);

  const first = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  check(
    "recipient's first fetch serves the bytes with no-store",
    first.status === 200 &&
      first.body.toString() === "ONCEBYTES-1" &&
      first.headers.get("cache-control") === "no-store",
    `status=${first.status} cc=${first.headers.get("cache-control")}`,
  );
  const rowGone = k.db._db.prepare("SELECT id FROM messages WHERE id = ?").get(mid) === undefined;
  check("the fetch deleted the row for everyone", rowGone === true);
  const second = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  check("a second fetch is 404 (nothing left to serve)", second.status === 404);
  const viewAfter = await k.call("POST", `/api/messages/${mid}/view`, {}, B.token);
  check("POST /view after the fetch-spend is 404", viewAfter.status === 404);
  const fileAfter = await k.call("GET", `/api/files/${key}`, undefined, B.token);
  check(
    "the object is collected (files route 403/404)",
    fileAfter.status === 403 || fileAfter.status === 404,
    `status=${fileAfter.status}`,
  );
}

// ---- 2. the sender's own preview still streams free ----
{
  const k = await mk();
  const A = await k.reg("h3c@x.com", "h3c");
  const B = await k.reg("h3d@x.com", "h3d");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const key = (await upload(k, A.token, "photo.jpg", "image/jpeg", "ONCEBYTES-2")).json.fileKey;
  const mid = (await sendOncePhoto(k, cid, key, A.token)).json.message?.id;

  const s1 = await k.call("GET", `/api/messages/${mid}/media`, undefined, A.token);
  const s2 = await k.call("GET", `/api/messages/${mid}/media`, undefined, A.token);
  check(
    "sender fetches repeatedly without spending",
    s1.status === 200 && s2.status === 200 && s2.body.toString() === "ONCEBYTES-2",
    `s1=${s1.status} s2=${s2.status}`,
  );
  const rowAlive = k.db._db.prepare("SELECT id FROM messages WHERE id = ?").get(mid) !== undefined;
  check("the row survives sender previews", rowAlive === true);
  const spend = await k.call("POST", `/api/messages/${mid}/view`, {}, B.token);
  check("the recipient can still spend via POST /view", spend.status === 200);
}

// ---- 3. ordinary messages are untouched ----
{
  const k = await mk();
  const A = await k.reg("h3e@x.com", "h3e");
  const B = await k.reg("h3f@x.com", "h3f");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const key = (await upload(k, A.token, "photo.jpg", "image/jpeg", "PLAINBYTES")).json.fileKey;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "photo.jpg",
      fileType: "image/jpeg",
      fileSize: 10,
      meta: { w: 800, h: 600 },
    },
    A.token,
  );
  const mid = sent.json.message?.id;
  const g1 = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  const g2 = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  check(
    "ordinary media fetches repeatedly, cacheable, row survives",
    g1.status === 200 &&
      g2.status === 200 &&
      (g1.headers.get("cache-control") ?? "").includes("max-age") &&
      k.db._db.prepare("SELECT id FROM messages WHERE id = ?").get(mid) !== undefined,
    `g1=${g1.status} g2=${g2.status} cc=${g1.headers.get("cache-control")}`,
  );
}

// ---- 4. source locks: the spend lives in the media route ----
{
  const src = readFileSync(new URL("../../src/worker/index.ts", import.meta.url), "utf8");
  const mediaRoute = src.slice(
    src.indexOf("const msgMediaMatch = path.match("),
    src.indexOf("const msgViewMatch = path.match("),
  );
  check(
    "worker — media GET spends a non-sender view-once fetch (conditional delete, 410 on a lost race, VANISHED frame + sender poke, no-store bytes)",
    mediaRoute.includes("onceMeta.viewOnce === true && row.sender_id !== uid") &&
      mediaRoute.includes('if (!cleared) fail(410, "This was already opened.", "VIEWED");') &&
      mediaRoute.includes('kind: "VANISHED",') &&
      mediaRoute.includes('headers.set("cache-control", "no-store");'),
  );
}

// ---- 5. source locks: the app never caches view-once bytes ----
{
  const root = new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/",
    import.meta.url,
  );
  const kt = (f) => readFileSync(new URL(f, root), "utf8");
  const ui = kt("Ui.kt");
  const viewer = kt("MediaViewer.kt");
  const chat = kt("ChatScreen.kt");
  const main = kt("MainActivity.kt");
  check(
    "app — KpNetImage takes noCache and disables Coil memory + disk caching for it",
    ui.includes("noCache: Boolean = false,") &&
      ui.includes("memoryCachePolicy(CachePolicy.DISABLED)") &&
      ui.includes("diskCachePolicy(CachePolicy.DISABLED)"),
  );
  check(
    "app — KpPhotoViewer takes once and passes noCache through; the chat passes its once flag",
    viewer.includes("once: Boolean = false,") &&
      viewer.includes("noCache = once,") &&
      chat.includes("once = once,"),
  );
  check(
    "app — POST /view treats 404/410 as terminally spent (fetch already spent it), other failures still retry",
    chat.includes("(e as? ApiException)?.status == 404") &&
      chat.includes("(e as? ApiException)?.status == 410") &&
      chat.includes("if (!ok) spent.remove(messageId)"),
  );
  check(
    "app — Coil disk cache is v2 and the v1 directory is dropped once (it may hold view-once bytes)",
    main.includes('filesDir.resolve("kp-image-cache-v2")') &&
      main.includes("if (legacy.exists()) legacy.deleteRecursively()"),
  );
  check(
    "app — a view-once clip's download + thumb sidecars are wiped when the player leaves",
    chat.includes("fun evict(key: String)") &&
      viewer.includes("DisposableEffect(b64, onceClip)") &&
      viewer.includes("VideoThumbs.evict(it)"),
  );
}

console.log(lines.join("\n"));
console.log(
  `h3 viewonce-spend-on-fetch: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
