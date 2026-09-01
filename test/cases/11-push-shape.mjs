// Push shape guard (regression test for the WhatsApp-style delivery).
//
// The whole point of the recent work is: a REACHABLE recipient (whether or not
// a socket is open) must get a DATA-ONLY FCM message so onMessageReceived runs
// and the app draws its OWN rich card (Reply / Like / Mark-as-read, etc.). Only
// a genuinely IDLE recipient (>= IDLE_PUSH_WINDOW_MS, i.e. frozen / dead /
// force-stopped) gets the system notification payload so at least a plain tray
// card shows.
//
// This drives the real worker against the in-memory D1/R2 shim, injects a fake
// FCM service-account so the worker's token exchange + send actually run, and
// captures the FCM HTTP body. A message to a *recent* recipient must have NO
// `android.notification` (data-only); a message to an *idle* recipient (we age
// its last_active_at) MUST have `android.notification`.
//
// The same rule drives message, missed_call and incoming-call pushes (they all
// route through recipientAlert / the same idle check), so this guards the whole
// class.

import { generateKeyPairSync } from "node:crypto";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

// A real PKCS8 RSA key so the worker's JWT signing (RS256) succeeds.
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
  const sent = []; // every FCM send body
  const env = { DB: db, MEDIA: makeR2(), FCM_CREDENTIALS };

  // Intercept the worker's external fetches only. The Durable-Object stubs are
  // reached through env.CHAT_ROOM/…, not global fetch, so they are untouched.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
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

  try {
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
      await ctx.drain(); // settle waitUntil (the FCM send) before we assert
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
    const ageLastActive = (userId, minutes) => {
      const when = new Date(Date.now() - minutes * 60_000).toISOString();
      db._db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(when, userId);
    };

    const a = await reg("psa@x.com", "psa");
    const b = await reg("psb@x.com", "psb");

    // Register a device token for the recipient so the worker has someone to push to.
    await call("POST", "/api/devices", { token: "fcm-device-token-b" }, b.token);

    // Conversation between the two, then a message.
    const conv = await call("POST", "/api/conversations", { userId: b.user.id }, a.token);
    const convId = conv.json.conversation.id;
    check("conversation created", conv.status === 200 && !!convId, String(conv.status));

    // 1) Recent recipient (last_active = just now from register) -> DATA-ONLY.
    //    (The worker nests `data` (and any `notification`) under `android`.)
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "hello recent" },
      a.token,
    );
    const recent = sent.find((m) => m.message?.android?.data?.type === "message");
    check("recent recipient gets a message push", !!recent, `${sent.length} fcm send(s)`);
    check(
      "recent recipient push is DATA-ONLY (no android.notification)",
      !!recent && !recent.message.android.notification,
      JSON.stringify(recent?.message?.android ?? {}),
    );
    check("recent recipient push carries payload data", !!recent?.message?.android?.data?.type);

    // 2) Idle recipient (age last_active > IDLE_PUSH_WINDOW_MS = 5 min) -> payload.
    ageLastActive(b.user.id, 6);
    sent.length = 0;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "hello idle" },
      a.token,
    );
    const idle = sent.find((m) => m.message?.android?.data?.type === "message");
    check("idle recipient gets a message push", !!idle, `${sent.length} fcm send(s)`);
    check(
      "idle recipient push carries the system notification payload",
      !!idle?.message?.android?.notification,
      JSON.stringify(idle?.message?.android ?? {}),
    );
    check(
      "idle recipient payload uses the message channel",
      idle?.message?.android?.notification?.channel_id === "kp_messages_v2",
    );

    // 3) Data-only payload still carries the fields the client needs for the
    //    rich card (fromName + body + convoId + muted).
    check(
      "message push carries fromName/body/convoId/muted",
      !!recent?.message?.android?.data?.fromName &&
        !!recent?.message?.android?.data?.body &&
        !!recent?.message?.android?.data?.convoId &&
        recent.message.android.data.muted !== undefined,
      JSON.stringify(recent?.message?.android?.data ?? {}),
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
