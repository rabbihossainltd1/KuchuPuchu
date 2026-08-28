import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const notes = [];
const check = (name, cond, detail) =>
  notes.push(`  ${cond ? "OK      " : "BROKEN  "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const media = makeR2();
  const env = { DB: db, MEDIA: media };
  const ctx = makeCtx();
  const call = async (method, path, body, token, raw) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    let init = { method, headers };
    if (raw) {
      init = { method, headers: raw.headers, body: raw.body };
      if (token) init.headers.authorization = `Bearer ${token}`;
    } else if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 60) };
    }
    return { status: res.status, json: j, headers: res.headers, text: t };
  };
  const reg = async (e, u) =>
    (
      await call("POST", "/api/auth/register", {
        email: e,
        password: "secret123",
        username: u,
        displayName: u,
      })
    ).json;
  return { worker, db, media, env, ctx, call, reg };
}

// ============ 1. photo round-trip still works for BOTH sides ==============
{
  const { db, call, reg } = await mk();
  const A = await reg("pa@x.com", "pa");
  const B = await reg("pb@x.com", "pb");
  const up = await call("POST", "/api/files?name=photo.jpg&type=image/jpeg", undefined, A.token, {
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from("jpegbytes!"),
  });
  const key = up.json.fileKey;
  check("owner can upload", up.status === 201, `key=${key}`);

  const conv = await call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  const cid = conv.json.conversation.id;
  const msg = await call(
    "POST",
    `/api/conversations/${cid}/messages`,
    {
      kind: "FILE",
      fileKey: key,
      fileName: "photo.jpg",
      fileType: "image/jpeg",
      fileSize: 10,
      clientId: "c1",
    },
    A.token,
  );
  check(
    "photo message accepted",
    msg.status === 201 && msg.json.message.hasImage === true,
    JSON.stringify(msg.json.message?.hasImage),
  );

  const ownerDl = await call("GET", `/api/files/${key}`, undefined, A.token);
  const recipDl = await call("GET", `/api/files/${key}`, undefined, B.token);
  check(
    "SENDER can still download the photo",
    ownerDl.status === 200 && ownerDl.text === "jpegbytes!",
    `${ownerDl.status}`,
  );
  check(
    "RECIPIENT can download the photo (no regression)",
    recipDl.status === 200 && recipDl.text === "jpegbytes!",
    `${recipDl.status} ${recipDl.text.slice(0, 80)}`,
  );

  const C = await reg("pc@x.com", "pc");
  const stranger = await call("GET", `/api/files/${key}`, undefined, C.token);
  check("stranger is rejected", stranger.status === 403, `${stranger.status}`);

  const hdrs = recipDl.headers;
  check(
    "served with nosniff + attachment + safe content-type",
    hdrs.get("x-content-type-options") === "nosniff" &&
      /attachment/.test(hdrs.get("content-disposition") || "") &&
      hdrs.get("content-type") === "image/jpeg",
    `ct=${hdrs.get("content-type")} cd=${hdrs.get("content-disposition")} ns=${hdrs.get("x-content-type-options")}`,
  );
}

// ============ 2. legacy key (uploaded before the files table) =============
{
  const { db, media, call, reg } = await mk();
  const A = await reg("la@x.com", "la");
  const B = await reg("lb@x.com", "lb");
  const conv = await call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  const cid = conv.json.conversation.id;
  await media.put("f/legacy.jpg", Buffer.from("old"), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  db._db
    .prepare(
      "INSERT INTO messages (id,conv_id,sender_id,kind,body,media,meta_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "m1",
      cid,
      A.user.id,
      "FILE",
      "",
      "f/legacy.jpg",
      JSON.stringify({ type: "image/jpeg", name: "x.jpg" }),
      new Date().toISOString(),
    );
  const a = await call("GET", "/api/files/f/legacy.jpg", undefined, A.token);
  const b = await call("GET", "/api/files/f/legacy.jpg", undefined, B.token);
  const C = await reg("lc@x.com", "lc");
  const c = await call("GET", "/api/files/f/legacy.jpg", undefined, C.token);
  check("legacy key: sender ok", a.status === 200, `${a.status}`);
  check("legacy key: conversation member ok", b.status === 200, `${b.status}`);
  check("legacy key: stranger rejected", c.status === 403, `${c.status}`);
}

// ============ 3. video status now actually saves as VIDEO =================
{
  const { call, reg } = await mk();
  const A = await reg("va@x.com", "va");
  const up = await call("POST", "/api/files?name=clip.mp4&type=video/mp4", undefined, A.token, {
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from("mp4bytes"),
  });
  const key = up.json.fileKey;
  const st = await call(
    "POST",
    "/api/statuses",
    { kind: "VIDEO", fileKey: key, seconds: 12, text: "cap" },
    A.token,
  );
  check(
    "VIDEO status keeps kind=VIDEO",
    st.status === 201 && st.json.status.kind === "VIDEO",
    JSON.stringify(st.json.status),
  );
  const feed = await call("GET", "/api/statuses", {}, A.token);
  const mine = feed.json.items.find((i) => i.mine);
  check(
    "VIDEO status shows up in the feed with hasMedia",
    mine?.statuses?.[0]?.kind === "VIDEO" && mine?.statuses?.[0]?.hasMedia === true,
    JSON.stringify(mine?.statuses?.[0]),
  );
}

// ============ 4. avatar / message media reject html data urls =============
{
  const { call, reg } = await mk();
  const A = await reg("xa@x.com", "xa");
  const html =
    "data:text/html;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
  const bad = await call("PATCH", "/api/me", { avatarUrl: html }, A.token);
  const good = await call(
    "PATCH",
    "/api/me",
    { avatarUrl: "data:image/png;base64,iVBORw0KGgo=" },
    A.token,
  );
  check(
    "data:text/html avatar rejected",
    bad.status === 400,
    `${bad.status} ${JSON.stringify(bad.json)}`,
  );
  check("data:image/png avatar accepted", good.status === 200, `${good.status}`);
}

// ============ 5. group read receipt needs EVERYONE to have read ===========
{
  const { call, reg } = await mk();
  const A = await reg("ga@x.com", "ga");
  const B = await reg("gb@x.com", "gb");
  const C = await reg("gc@x.com", "gc");
  const g = await call(
    "POST",
    "/api/conversations/group",
    { title: "G", memberIds: [B.user.id, C.user.id] },
    A.token,
  );
  const gid = g.json.conversation.id;
  await call("POST", `/api/conversations/${gid}/messages`, { body: "hey" }, A.token);
  await call("POST", `/api/conversations/${gid}/read`, {}, B.token);
  const partial = await call("GET", `/api/conversations/${gid}/messages`, {}, A.token);
  check(
    "1 of 2 read -> no read receipt",
    partial.json.readAt === null,
    `readAt=${partial.json.readAt}`,
  );
  await call("POST", `/api/conversations/${gid}/read`, {}, C.token);
  const full = await call("GET", `/api/conversations/${gid}/messages`, {}, A.token);
  check(
    "both read -> read receipt present",
    typeof full.json.readAt === "string" && full.json.readAt.length > 0,
    `readAt=${full.json.readAt}`,
  );
}

// ============ 6. LIKE wildcards are literal ==============================
{
  const { call, reg } = await mk();
  for (let i = 0; i < 5; i++) await reg(`w${i}@x.com`, `wild${i}`);
  const me = (await reg("wme@x.com", "wme")).token;
  const pct = await call("GET", "/api/users?q=" + encodeURIComponent("%"), {}, me);
  const real = await call("GET", "/api/users?q=wild", {}, me);
  check(
    "q=% returns nobody (was: everyone)",
    pct.json.users.length === 0,
    `${pct.json.users.length} users`,
  );
  check(
    "q=wild still matches normally",
    real.json.users.length === 5,
    `${real.json.users.length} users`,
  );
}

// ============ 7. pagination keeps same-millisecond messages ===============
{
  const { db, call, reg } = await mk();
  const A = await reg("ta@x.com", "ta");
  const B = await reg("tb@x.com", "tb");
  const conv = await call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  const cid = conv.json.conversation.id;
  const ts = new Date().toISOString();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const mid = `same${i}`;
    ids.push(mid);
    db._db
      .prepare(
        "INSERT INTO messages (id,conv_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(mid, cid, A.user.id, "TEXT", `same-ms-${i}`, ts);
  }
  db._db
    .prepare(
      "INSERT INTO messages (id,conv_id,sender_id,kind,body,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run("old", cid, A.user.id, "TEXT", "older", new Date(Date.now() - 60_000).toISOString());
  const first = await call("GET", `/api/conversations/${cid}/messages`, {}, A.token);
  check(
    "all 4 messages on the first page",
    first.json.items.length === 4,
    `${first.json.items.length}`,
  );
  const oldestOnPage = first.json.items[0];
  const rowid = db._db
    .prepare("SELECT rowid FROM messages WHERE id = ?")
    .get(oldestOnPage.id).rowid;
  const page2 = await call(
    "GET",
    `/api/conversations/${cid}/messages?before=${encodeURIComponent(oldestOnPage.createdAt)}&beforeRowid=${rowid}`,
    {},
    A.token,
  );
  const all = new Set([...first.json.items, ...page2.json.items].map((x) => x.id));
  check(
    "paging back with the rowid cursor loses nothing",
    all.size === 4,
    `seen ${all.size}/4 -> ${[...all].join(",")}`,
  );
}

// ============ 8. presence is not written on every request =================
{
  const { db, call, reg } = await mk();
  const A = await reg("na@x.com", "na");
  let writes = 0;
  const op = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) writes++;
    return op(sql);
  };
  for (let i = 0; i < 10; i++) await call("GET", "/api/me", {}, A.token);
  check("10 x GET /api/me issues no presence write", writes === 0, `${writes} writes`);
}

console.log(notes.join("\n"));
const broken = notes.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${notes.length - broken} ok / ${broken} broken ---`);
