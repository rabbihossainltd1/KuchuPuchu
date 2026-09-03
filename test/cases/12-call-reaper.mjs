// Stale-call reaper (scheduled cron). The MISSED transition + missed_call push
// used to live ONLY inside GET /api/calls/active, so when both phones were
// backgrounded nobody polled and a call stayed RINGING forever — the callee's
// "X is calling" card hung. This drives the worker's `scheduled` handler
// directly and asserts that a stale RINGING call flips to MISSED and fires the
// missed_call push with NO client poll at all.
//
// The worker's fetch() is never called for the reaper; only worker.scheduled()
// is. global.fetch is intercepted (FCM token exchange + send) so the push is
// captured. env.CHAT_ROOM is a fake DO namespace returning `sent: 0` (no live
// socket), which is the "system payload" branch — a dead/frozen callee.

import { generateKeyPairSync } from "node:crypto";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FCM_CREDENTIALS = JSON.stringify({
  project_id: "kp-test-proj",
  client_email: "svc@kp-test-proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});

async function main() {
  const worker = await freshWorker();
  const db = makeD1();
  const sent = [];
  const env = {
    DB: db,
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
    MEDIA: makeR2(),
    FCM_CREDENTIALS,
    // No live socket: the callee is swiped away -> guaranteed system payload.
    CHAT_ROOM: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async () => new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 }),
      }),
    },
    CALL_SIGNAL: {
      idFromName: (name) => ({ toString: () => name, name }),
      get: (id) => ({
        fetch: async () => new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 }),
      }),
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("oauth2.googleapis.com/token") && !url.includes("tokeninfo")) {
      return new Response(JSON.stringify({ access_token: "fake-at", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("fcm.googleapis.com/v1/projects")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ name: "projects/1/messages/1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };

  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
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
  const reg = makeReg(call);

  try {
    const caller = await reg("rea@x.com", "rea");
    const callee = await reg("reb@x.com", "reb");
    await call("POST", "/api/devices", { token: "fcm-device-token-reb" }, callee.token);

    const conv = await call("POST", "/api/conversations", { userId: callee.user.id }, caller.token);
    const convId = conv.json.conversation.id;
    check("conversation created", conv.status === 200 && !!convId, String(conv.status));

    // Start a call (RINGING). This schedules a 1.8s delayed push, which the
    // call() helper's drain() settles; then we age it so it is stale.
    const start = await call(
      "POST",
      "/api/calls",
      { userId: callee.user.id, kind: "AUDIO", offerSdp: "offer" },
      caller.token,
    );
    const callId = start.json?.callId ?? start.json?.call?.id ?? start.json?.id;
    check("call started", !!callId, `${start.status} ${JSON.stringify(start.json)}`);

    // Age the call beyond the 60s reaper cutoff (created_at < now - 60s).
    const aged = new Date(Date.now() - 120_000).toISOString();
    db._db.prepare("UPDATE calls SET created_at = ? WHERE id = ?").run(aged, callId);

    // No client poll happened: we drive the reaper via the scheduled handler.
    sent.length = 0; // drop the start-call notification captured above
    await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" }, env, ctx);
    await ctx.drain();

    const row = db._db.prepare("SELECT status FROM calls WHERE id = ?").get(callId);
    check("reaper flipped call to MISSED", row && row.status === "MISSED", JSON.stringify(row));

    const missed = sent.find((m) => m.message?.android?.data?.type === "missed_call");
    check(
      "reaper pushed missed_call without any client poll",
      !!missed,
      `${sent.length} fcm send(s)`,
    );
    check(
      "missed_call push carries the right callId",
      !!missed && missed.message.android.data.callId === callId,
      JSON.stringify(missed?.message?.android?.data ?? {}),
    );
    check(
      "missed_call push carries the system payload (no live socket)",
      !!missed?.message?.android?.notification,
      JSON.stringify(missed?.message?.android ?? {}),
    );
    check(
      "missed_call push carries Call back / Message deep-links",
      !!missed?.message?.android?.data?.kp_callback && !!missed?.message?.android?.data?.kp_chat,
      JSON.stringify(missed?.message?.android?.data ?? {}),
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
