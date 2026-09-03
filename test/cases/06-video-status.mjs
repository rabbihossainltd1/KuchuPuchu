// End-to-end check of the video status flow the Android client now performs:
//   upload video/mp4 -> POST /api/statuses {kind:VIDEO, fileKey, seconds, text}
//   -> the status reaches a contact's feed -> its media can be fetched.
//
// The server side used to downgrade kind=VIDEO to TEXT, and the client could
// not pick a video at all, so this path had never worked from either end.

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
      headers["cf-connecting-ip"] = `192.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 2}`;
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

{
  const k = await mk();
  const A = await k.reg("va@x.com", "va");
  const B = await k.reg("vb@x.com", "vb");
  const C = await k.reg("vc@x.com", "vc");

  // 1. what the client's Api.upload() sends
  const up = await k.call("POST", "/api/files?name=status.mp4&type=video/mp4", undefined, A.token, {
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from("fake-mp4-payload"),
  });
  check("video upload accepted", up.status === 201, `key=${up.json.fileKey}`);

  // 2. what the client's Post button sends
  const st = await k.call(
    "POST",
    "/api/statuses",
    { kind: "VIDEO", fileKey: up.json.fileKey, seconds: 42, text: "look at this" },
    A.token,
  );
  const s = st.json.status || {};
  check(
    "status stored as VIDEO, not downgraded to TEXT",
    st.status === 201 && s.kind === "VIDEO",
    `${st.status} kind=${s.kind}`,
  );
  check("the duration survived", s.seconds === 42, `seconds=${s.seconds}`);
  check("the caption survived", s.text === "look at this", JSON.stringify(s.text));
  check("it is flagged as having media", s.hasMedia === true, `hasMedia=${s.hasMedia}`);
  check(
    "it expires in 24h",
    Math.round((Date.parse(s.expiresAt) - Date.parse(s.createdAt)) / 36e5) === 24,
    `${((Date.parse(s.expiresAt) - Date.parse(s.createdAt)) / 36e5).toFixed(1)}h`,
  );

  // 3. a contact sees it in the feed (B shares a chat with A)
  await k.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  const feed = await k.call("GET", "/api/statuses", undefined, B.token);
  const mine = (feed.json.items || []).find((row) => row.user?.id === A.user.id);
  const entry = (mine?.statuses || [])[0];
  check(
    "a contact's feed carries the VIDEO status",
    entry?.kind === "VIDEO",
    JSON.stringify(entry?.kind),
  );
  check("the feed entry keeps hasMedia", entry?.hasMedia === true, `hasMedia=${entry?.hasMedia}`);

  // 4. the viewer fetches the bytes from /api/statuses/:id/media
  const media = await k.call("GET", `/api/statuses/${s.id}/media`, undefined, B.token);
  check(
    "the contact can download the video",
    media.status === 200 && media.body.toString() === "fake-mp4-payload",
    `${media.status} ct=${media.headers.get("content-type")}`,
  );
  check(
    "served as video/mp4 with nosniff",
    media.headers.get("content-type") === "video/mp4" &&
      media.headers.get("x-content-type-options") === "nosniff",
    `ct=${media.headers.get("content-type")}`,
  );

  // 5. someone with no relationship to A cannot
  const stranger = await k.call("GET", `/api/statuses/${s.id}/media`, undefined, C.token);
  check("a non-contact cannot download it", stranger.status === 403, String(stranger.status));

  // 6. the owner can always see their own
  const owner = await k.call("GET", `/api/statuses/${s.id}/media`, undefined, A.token);
  check("the owner can download it", owner.status === 200, String(owner.status));

  // 7. a text status is unaffected by the VIDEO work
  const txt = await k.call(
    "POST",
    "/api/statuses",
    { kind: "TEXT", text: "hello", bgStyle: "amber" },
    A.token,
  );
  check(
    "TEXT statuses still work",
    txt.status === 201 && txt.json.status?.kind === "TEXT",
    `${txt.status} kind=${txt.json.status?.kind}`,
  );

  // 8. an unknown kind is still rejected rather than stored verbatim
  const bogus = await k.call(
    "POST",
    "/api/statuses",
    { kind: "AUDIO", fileKey: up.json.fileKey },
    A.token,
  );
  const stored = k.db._db
    .prepare("SELECT kind FROM statuses ORDER BY created_at DESC LIMIT 1")
    .get().kind;
  check(
    "an unsupported kind does not get stored as-is",
    stored !== "AUDIO",
    `rejected=${bogus.status} newest stored kind=${stored}`,
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
