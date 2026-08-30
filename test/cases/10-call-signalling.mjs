// Call signalling broadcasts (Step 3). The CallSignal Durable Object runs
// only on Cloudflare; a fake namespace records everything the worker would
// have relayed. Asserts: state-change frames on create/answer/decline/end,
// instant ICE relay with the GET /ice item shape, renegotiation nudges, the
// anti-phantom-gated callee poke, participant-only access to /ws/call/:id,
// and that the no-binding path is unchanged REST.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

async function mk(withDo) {
  const worker = await freshWorker();
  const db = makeD1();
  const callFrames = [];
  const chatFrames = [];
  const connects = [];
  const env = { DB: db, MEDIA: makeR2() };
  if (withDo) {
    // The worker may call fetch("url", init) OR fetch(new Request(...)) — the
    // real DO stub accepts both; normalise here so the fakes do too.
    const normalize = (input, init) => {
      const isReq = typeof input === "object" && typeof input.url === "string";
      return {
        url: isReq ? input.url : String(input),
        headers: init?.headers ?? (isReq ? Object.fromEntries([...input.headers.entries()]) : {}),
        body: init?.body,
      };
    };
    env.CALL_SIGNAL = {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async (input, init) => {
          const { url, headers, body } = normalize(input, init);
          if (url.includes("/connect")) {
            connects.push({ ns: "call", url, headers });
            return new Response(null, { status: 200 });
          }
          callFrames.push({ room: id.name, body: JSON.parse(body) });
          return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200 });
        },
      }),
    };
    env.CHAT_ROOM = {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async (input, init) => {
          const { url, headers, body } = normalize(input, init);
          if (url.includes("/connect")) {
            connects.push({ ns: "chat", url, headers });
            return new Response(null, { status: 200 });
          }
          chatFrames.push({ room: id.name, body: JSON.parse(body) });
          return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200 });
        },
      }),
    };
  }
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/register"))
      headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 80) };
    }
    return { status: res.status, json: j };
  };
  const reg = async (e, u) => {
    const r = await call("POST", "/api/auth/register", {
      email: e,
      password: "secret123",
      username: u,
      displayName: u,
    });
    if (!r.json.user) throw new Error(`register ${u} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  return { db, call, reg, callFrames, chatFrames, connects };
}

// ---- 1. create → answer → end frames + gated callee poke ----
{
  const k = await mk(true);
  const a = await k.reg("cs1a@x.com", "cs1a");
  const b = await k.reg("cs1b@x.com", "cs1b");
  const created = await k.call(
    "POST",
    "/api/calls",
    { userId: b.user.id, kind: "AUDIO", offerSdp: "v=0 offer" },
    a.token,
  );
  const callId = created.json.call.id;
  check("call created", created.status === 201 && !!callId, String(created.status));

  const ring = k.callFrames.find((f) => f.body.type === "call" && f.body.status === "RINGING");
  check("RINGING frame on the call room", !!ring && ring.room === callId);

  // callee poke is delayed 1.8s + still-RINGING-gated; ctx.drain() waited for it
  const poke = k.chatFrames.find((f) => f.body.type === "call" && f.body.callId === callId);
  check(
    "callee's user channel got the delayed call poke",
    !!poke && poke.room === "user:" + b.user.id,
  );
  check(
    "poke identifies caller + kind",
    poke && poke.body.fromId === a.user.id && poke.body.kind === "AUDIO",
  );

  const answered = await k.call(
    "POST",
    `/api/calls/${callId}/answer`,
    { answerSdp: "v=0 answer" },
    b.token,
  );
  check("answer succeeds", answered.status === 200, String(answered.status));
  check(
    "ACTIVE frame on the call room",
    k.callFrames.some((f) => f.body.type === "call" && f.body.status === "ACTIVE"),
  );

  await k.call("POST", `/api/calls/${callId}/end`, {}, a.token);
  check(
    "ENDED frame on the call room",
    k.callFrames.some((f) => f.body.type === "call" && f.body.status === "ENDED"),
  );
}

// ---- 2. ICE + renegotiation relay with GET /ice item shape ----
{
  const k = await mk(true);
  const a = await k.reg("cs2a@x.com", "cs2a");
  const b = await k.reg("cs2b@x.com", "cs2b");
  const created = await k.call(
    "POST",
    "/api/calls",
    { userId: b.user.id, kind: "VIDEO", offerSdp: "o" },
    a.token,
  );
  const callId = created.json.call.id;
  await k.call("POST", `/api/calls/${callId}/answer`, { answerSdp: "a" }, b.token);

  const ice = await k.call(
    "POST",
    `/api/calls/${callId}/ice`,
    { candidate: { candidate: "candidate:1 1 UDP udp", sdpMid: "0", sdpMLineIndex: 0 } },
    a.token,
  );
  check("ice post succeeds", ice.status === 201, String(ice.status));
  const frame = k.callFrames.find((f) => f.body.type === "ice");
  check(
    "ice frame carries candidate + createdAt (GET /ice item shape)",
    frame &&
      frame.body.candidate.candidate === "candidate:1 1 UDP udp" &&
      frame.body.candidate.sdpMid === "0" &&
      !!frame.body.createdAt,
    frame ? JSON.stringify(frame.body).slice(0, 120) : "none",
  );

  await k.call("POST", `/api/calls/${callId}/reoffer`, { sdp: "v=0 reoffer" }, b.token);
  check(
    "reoffer nudge relayed",
    k.callFrames.some((f) => f.body.type === "reoffer"),
  );
  await k.call("POST", `/api/calls/${callId}/reanswer`, { sdp: "v=0 reanswer" }, a.token);
  check(
    "reanswer nudge relayed",
    k.callFrames.some((f) => f.body.type === "reanswer"),
  );
}

// ---- 3. /ws/call/:id — participants only ----
{
  const k = await mk(true);
  const a = await k.reg("cs3a@x.com", "cs3a");
  const b = await k.reg("cs3b@x.com", "cs3b");
  const c = await k.reg("cs3c@x.com", "cs3c");
  const created = await k.call("POST", "/api/calls", { userId: b.user.id, kind: "AUDIO" }, a.token);
  const callId = created.json.call.id;

  const asParticipant = await k.call("GET", `/ws/call/${callId}`, undefined, b.token);
  check(
    "callee may open the call socket",
    asParticipant.status === 200,
    String(asParticipant.status),
  );
  const conn = k.connects.find((x) => x.ns === "call");
  check(
    "upgrade forwarded with verified identity",
    !!conn && conn.headers["x-kp-user"] === b.user.id,
  );

  const outsider = await k.call("GET", `/ws/call/${callId}`, undefined, c.token);
  check("a third user is refused", outsider.status === 403, String(outsider.status));
  const anon = await k.call("GET", `/ws/call/${callId}`);
  check("anonymous is refused", anon.status === 401, String(anon.status));
}

// ---- 4. no bindings: everything still works over REST ----
{
  const k = await mk(false);
  const a = await k.reg("cs4a@x.com", "cs4a");
  const b = await k.reg("cs4b@x.com", "cs4b");
  const created = await k.call("POST", "/api/calls", { userId: b.user.id, kind: "AUDIO" }, a.token);
  check("call create works without DO bindings", created.status === 201, String(created.status));
  check("nothing was relayed", k.callFrames.length === 0 && k.chatFrames.length === 0);
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
