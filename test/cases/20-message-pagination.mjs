// §39 cursor pagination over the real worker: the newest window, then page back
// through (created_at, rowid), until the end of history — with no duplicates, no
// dropped boundary rows, no internal rowid in the payload, and no extra reads on
// the `unchanged` fast path (this route is polled every couple of seconds).

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const worker = await freshWorker();
  const env = { DB: makeD1(), MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
  const ctx = makeCtx();
  let ipSeq = 0;
  const traced = [];
  const origPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    traced.push(sql);
    return origPrepare(sql);
  };
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.7.${(ipSeq >> 8) & 255}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 80) };
    }
    return { status: res.status, json: j, headers: res.headers };
  };
  const regByTag = makeReg(call);
  const reg = async (tag) => {
    const r = await regByTag(`${tag}@x.com`, tag);
    if (!r.user) throw new Error(`register ${tag}: ${JSON.stringify(r).slice(0, 90)}`);
    return { user: r.user, token: r.token };
  };
  return { env, ctx, worker, call, reg, traced };
}

const TOTAL = 130;

async function main() {
  const h = await mk();
  const A = await h.reg("pg-a");
  const B = await h.reg("pg-b");
  const cid = (await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token)).json
    .conversation.id;
  for (let i = 0; i < TOTAL; i++) {
    await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: `m${String(i).padStart(3, "0")}`, clientId: `pg-${i}` },
      A.token,
    );
  }

  const page1 = (await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token))
    .json;
  check(
    "the newest window is one page, not the whole chat",
    page1.items.length === 50,
    `${page1.items.length}`,
  );
  check(
    "…newest last (ascending), so the client appends without re-sorting",
    page1.items[0].body === `m${String(TOTAL - 50).padStart(3, "0")}` &&
      page1.items[49].body === `m${String(TOTAL - 1).padStart(3, "0")}`,
    `${page1.items[0]?.body} … ${page1.items[49]?.body}`,
  );
  check("and it says there is more history", page1.hasMore === true, JSON.stringify(page1.hasMore));
  check(
    "…with a (created_at,rowid) cursor for the next page back",
    !!page1.oldest && typeof page1.oldest.at === "string" && page1.oldest.rowid > 0,
    JSON.stringify(page1.oldest),
  );
  check(
    "the internal rowid never leaks into a message payload",
    page1.items.every((m) => !("kp_rowid" in m) && !("rowid" in m)),
    JSON.stringify(Object.keys(page1.items[0] ?? {})).slice(0, 120),
  );

  const back = (cur) =>
    h.call(
      "GET",
      `/api/conversations/${cid}/messages?before=${encodeURIComponent(cur.at)}&beforeRowid=${cur.rowid}`,
      undefined,
      A.token,
    );
  const p2 = (await back(page1.oldest)).json;
  const ids1 = new Set(page1.items.map((m) => m.id));
  check("page 2 is 50 more rows", p2.items.length === 50, `${p2.items.length}`);
  check(
    "…strictly older, no overlap (this is the duplicate-prevention rule)",
    p2.items.every((m) => !ids1.has(m.id)) && p2.items[49].body < page1.items[0].body,
    `${p2.items[0]?.body}..${p2.items[49]?.body} vs ${page1.items[0]?.body}`,
  );
  const p3 = (await back(p2.oldest)).json;
  check("page 3 lands on the oldest message", p3.items[0].body === "m000", `${p3.items[0]?.body}`);
  check(
    "…and reports the end of history",
    p3.hasMore === false && p3.items.length === TOTAL - 100,
    `${p3.items.length}/${p3.hasMore}`,
  );
  const union = new Set([...page1.items, ...p2.items, ...p3.items].map((m) => m.id));
  check("three pages = the whole chat, exactly once", union.size === TOTAL, `${union.size}`);

  const p4 = await back(p3.oldest);
  check(
    "paging past the end is an empty page, not an error",
    p4.status === 200 && p4.json.items.length === 0 && p4.json.hasMore === false,
    `${p4.status}/${p4.json.items?.length}`,
  );
  const junk = await h.call(
    "GET",
    `/api/conversations/${cid}/messages?before=not-a-date&beforeRowid=-5`,
    undefined,
    A.token,
  );
  check(
    "a garbage cursor is refused, not answered with the newest page",
    junk.status === 400 && junk.json.error?.code === "BAD_CURSOR",
    `${junk.status} ${JSON.stringify(junk.json).slice(0, 70)}`,
  );

  {
    // The marker fast path must not pay for the new fields.
    const first = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token);
    const mark = first.json.marker;
    const before = h.traced.length;
    const again = await h.call(
      "GET",
      `/api/conversations/${cid}/messages?marker=${encodeURIComponent(mark)}`,
      undefined,
      A.token,
    );
    const stmts = h.traced.slice(before).length;
    check(
      "an unchanged poll still answers {unchanged} with a tiny statement count",
      again.json.unchanged === true && stmts <= 7,
      `unchanged=${again.json.unchanged} statements=${stmts}`,
    );
    check(
      "…and carries no page payload to re-parse",
      again.json.items === undefined,
      JSON.stringify(again.json).slice(0, 80),
    );
  }

  {
    // The cut a "delete chat" watermark imposes must hold across pages, or one
    // scroll up silently resurrects the history the user deleted. Asserted from the
    // OTHER member's seat: the sender's own watermark is cleared on purpose when
    // they send (they came back to the chat), so only a non-sender still has one.
    await h.call("DELETE", `/api/conversations/${cid}`, undefined, B.token);
    await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "m130", clientId: "pg-after" },
      A.token,
    );
    const forB = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, B.token);
    check(
      "the deleted side sees only what is newer than their cut",
      forB.json.items.length === 1 && forB.json.items[0].body === "m130",
      JSON.stringify((forB.json.items ?? []).map((m) => m.body)).slice(0, 80),
    );
    check(
      "…and is told there is nothing older to load",
      forB.json.hasMore === false,
      JSON.stringify({ hm: forB.json.hasMore }),
    );
    // Even if a client ignored hasMore, the cursor it was handed must not open the
    // deleted past (this is the rowid cut doing its job one page deeper).
    const deep = await h.call(
      "GET",
      `/api/conversations/${cid}/messages?before=${encodeURIComponent(forB.json.oldest.at)}&beforeRowid=${forB.json.oldest.rowid}`,
      undefined,
      B.token,
    );
    check(
      "…and paging anyway cannot resurrect rows under the watermark",
      deep.status === 200 && deep.json.items.length === 0,
      `${deep.status}/${deep.json.items?.length}`,
    );
    const forA = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token);
    check(
      "…and round 13 real-delete means even the sender's history is gone (fresh start)",
      forA.json.items.length === 1 && forA.json.hasMore === false,
      JSON.stringify({ n: forA.json.items.length, hm: forA.json.hasMore }),
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  // Print what was already checked: a crash must not hide which assertion the run
  // died in front of.
  process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""));
  console.error(e);
  process.exit(1);
});
