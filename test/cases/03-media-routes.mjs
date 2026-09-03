// Regression suite for the two `media` routes.
//
// GET /api/messages/:id/media used to call dataUrlResponse() unconditionally.
// Since uploads now go through POST /api/files, `messages.media` holds an R2
// object key, not a data URL - so every photo/document/voice-note message
// answered 400 "Bad media." The bytes were in the bucket, unreachable.
//
// Both media routes now share storedMediaResponse(). OK / BROKEN per line.

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

// ---- 1. a FILE message whose media is an R2 key can be fetched ----
{
  const k = await mk();
  const A = await k.reg("ma@x.com", "ma");
  const B = await k.reg("mb@x.com", "mb");
  const C = await k.reg("mc@x.com", "mc");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const up = await upload(k, A.token, "photo.jpg", "image/jpeg", "jpegbytes!");
  const key = up.json.fileKey;
  check("upload succeeds", up.status === 201, `key=${key}`);

  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "FILE", fileKey: key, fileName: "photo.jpg" },
    A.token,
  );
  const mid = sent.json.message?.id;
  check("FILE message stored the R2 key in media", !!mid, `mid=${mid}`);
  check(
    "media column really is the key, not a data URL",
    k.db._db.prepare("SELECT media FROM messages WHERE id = ?").get(mid).media === key,
  );

  const mine = await k.call("GET", `/api/messages/${mid}/media`, undefined, A.token);
  check(
    "sender can fetch the media",
    mine.status === 200 && mine.body.toString() === "jpegbytes!",
    `${mine.status} ${mine.body.toString().slice(0, 40)}`,
  );
  check(
    "served as the stored type, with nosniff",
    mine.headers.get("content-type") === "image/jpeg" &&
      mine.headers.get("x-content-type-options") === "nosniff",
    `ct=${mine.headers.get("content-type")} ns=${mine.headers.get("x-content-type-options")}`,
  );

  const theirs = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  check(
    "recipient can fetch the media",
    theirs.status === 200 && theirs.body.toString() === "jpegbytes!",
    `${theirs.status}`,
  );

  const stranger = await k.call("GET", `/api/messages/${mid}/media`, undefined, C.token);
  check("non-member is rejected", stranger.status === 403, String(stranger.status));
}

// ---- 2. the legacy data-URL path still works ----
{
  const k = await mk();
  const A = await k.reg("na@x.com", "na");
  const B = await k.reg("nb@x.com", "nb");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const png = "data:image/png;base64," + Buffer.from("pngbytes!!").toString("base64");
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { imageData: png },
    A.token,
  );
  const mid = sent.json.message?.id;
  const got = await k.call("GET", `/api/messages/${mid}/media`, undefined, B.token);
  check(
    "legacy data: URL media still decodes",
    got.status === 200 && got.body.toString() === "pngbytes!!",
    `${got.status} ${got.body.toString().slice(0, 40)}`,
  );
  const html = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      imageData: "data:text/html;base64," + Buffer.from("<script>").toString("base64"),
    },
    A.token,
  );
  check("data:text/html media is refused", html.status === 400, String(html.status));
}

// ---- 3. status media with an R2 key keeps working (shared helper) ----
{
  const k = await mk();
  const A = await k.reg("oa@x.com", "oa");
  const B = await k.reg("ob@x.com", "ob");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  await cid;
  const up = await upload(k, A.token, "clip.mp4", "video/mp4", "mp4bytes!!");
  const st = await k.call(
    "POST",
    "/api/statuses",
    { kind: "VIDEO", fileKey: up.json.fileKey, seconds: 9, text: "cap" },
    A.token,
  );
  const sid = st.json.status?.id;
  const got = await k.call("GET", `/api/statuses/${sid}/media`, undefined, A.token);
  check(
    "VIDEO status media serves the R2 object",
    got.status === 200 && got.body.toString() === "mp4bytes!!",
    `${got.status} ct=${got.headers.get("content-type")} ${got.body.toString().slice(0, 20)}`,
  );
  check("status media is not sniffable", got.headers.get("x-content-type-options") === "nosniff");
}

// ---- 4. a missing object is a 404, not a 500 ----
{
  const k = await mk();
  const A = await k.reg("qa@x.com", "qa");
  const B = await k.reg("qb@x.com", "qb");
  const cid = (await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  const sent = await k.call(
    "POST",
    `/api/conversations/${cid}/messages`,
    { kind: "FILE", fileKey: "f/gone.jpg", fileName: "gone.jpg" },
    A.token,
  );
  const mid = sent.json.message?.id;
  const got = await k.call("GET", `/api/messages/${mid}/media`, undefined, A.token);
  check("a deleted object answers 404", got.status === 404, String(got.status));
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
