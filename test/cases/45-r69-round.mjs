// r69 round (owner bug list after testing r68): the two-aspect mute (calls vs
// messages), the mute glyph + the hidden call buttons, the emoji-fx route
// rule, the attach-bar crash guard, and the chat-list swipe delete popup.
//
// Worker half drives the real worker: a chat muted for CALLS must not ring the
// callee (no relay, no push) while its messages still notify; a chat muted for
// MESSAGES rings normally while its message card goes to the silent channel;
// and the old one-flag body still mutes both halves.

import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();

// A real PKCS8 RSA key so the worker's FCM token exchange + send actually run
// (without credentials pushToUser is a no-op and there is nothing to assert).
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FCM_CREDENTIALS = JSON.stringify({
  project_id: "kp-test-proj",
  client_email: "svc@kp-test-proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const body = (m) => JSON.parse(m.body);
// The worker nests a data-only push under `message.android.data` (an FCM
// message holds `data` inside the platform object), and the token identifies
// the recipient's device row.
const pushOf = (sent, type, userId) =>
  sent.find(
    (p) => (p.message?.android?.data?.type ?? "") === type && p.message?.token === `tok-${userId}`,
  );

async function mk() {
  const worker = await freshWorker();
  const db = makeD1();
  const env = {
    DB: db,
    MEDIA: makeR2(),
    FCM_CREDENTIALS,
    GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  };
  const ctx = makeCtx();
  const sent = [];
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
  let ipSeq = 0;
  const call = async (method, path, reqBody, token) => {
    const headers = { "content-type": "application/json" };
    if (path.startsWith("/api/auth/"))
      headers["cf-connecting-ip"] = `203.11.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (reqBody !== undefined && method !== "GET") init.body = JSON.stringify(reqBody);
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
  return {
    db,
    env,
    ctx,
    sent,
    call,
    reg: makeReg(call),
    restore: () => (globalThis.fetch = realFetch),
  };
}

/** Two accounts, one chat, a device token each (so the worker has someone to push to). */
async function pair(k, tag) {
  const a = await k.reg(`mute-${tag}-a@x.com`, `mute${tag}a`);
  const b = await k.reg(`mute-${tag}-b@x.com`, `mute${tag}b`);
  await k.call("POST", "/api/devices", { token: `tok-${a.user.id}` }, a.token);
  await k.call("POST", "/api/devices", { token: `tok-${b.user.id}` }, b.token);
  // The conversation first (POST /api/conversations), then the messages inside it.
  const c = await k.call("POST", "/api/conversations", { userId: b.user.id }, a.token);
  const convId = c.json.conversation?.id;
  await k.call(
    "POST",
    `/api/conversations/${convId}/messages`,
    { kind: "TEXT", body: "hi" },
    a.token,
  );
  return { a, b, convId };
}

const mute = (k, who, convId, payload) =>
  k.call("POST", `/api/conversations/${convId}/mute`, payload, who.token);
const detail = (k, who, convId) =>
  k.call("GET", `/api/conversations/${convId}`, undefined, who.token);

// ── A. worker: the two aspects ───────────────────────────────────────────────
{
  const k = await mk();
  try {
    // A chat muted for CALLS only.
    {
      const { a, b, convId } = await pair(k, "call");
      const r = await mute(k, b, convId, { call: true, msg: false });
      const d = await detail(k, b, convId);
      k.sent.length = 0;
      const msg = await k.call(
        "POST",
        `/api/conversations/${convId}/messages`,
        { kind: "TEXT", body: "still loud" },
        a.token,
      );
      const card = pushOf(k.sent, "message", b.user.id);
      k.sent.length = 0;
      const ring = await k.call(
        "POST",
        "/api/calls",
        { userId: b.user.id, kind: "AUDIO", offerSdp: "v=0" },
        a.token,
      );
      // the ring push rides a waitUntil with a 700 ms anti-phantom gate
      await new Promise((r2) => setTimeout(r2, 820));
      await k.ctx.drain();
      check(
        "r69 mute: {call:true} stores the CALL half only — members.muted_call = 1, muted_msg = 0, and the row reports mutedCall true / mutedMsg false",
        r.status === 200 &&
          r.json.mutedCall === true &&
          r.json.mutedMsg === false &&
          d.json.conversation?.mutedCall === true &&
          d.json.conversation?.mutedMsg === false,
        JSON.stringify({
          mute: r.json,
          row: { c: d.json.conversation?.mutedCall, m: d.json.conversation?.mutedMsg },
        }),
      );
      check(
        "r69 mute: a CALL-muted chat still notifies its MESSAGES — the card is pushed (not silent) because the message half is untouched",
        msg.status === 201 && !!card && card.message?.android?.data?.muted === "0",
        JSON.stringify({ status: msg.status, muted: card?.message?.data?.muted }),
      );
      check(
        "r69 mute: …and it never RINGS — the callee gets no `call` push at all (the row stays RINGING for the caller, which times out as unanswered)",
        ring.status === 201 && !pushOf(k.sent, "call", b.user.id),
        JSON.stringify({
          status: ring.status,
          types: k.sent.map((p) => p.message?.android?.data?.type),
        }),
      );
    }
    // A chat muted for MESSAGES only.
    {
      const { a, b, convId } = await pair(k, "msg");
      const r = await mute(k, b, convId, { call: false, msg: true });
      const d = await detail(k, b, convId);
      k.sent.length = 0;
      await k.call(
        "POST",
        `/api/conversations/${convId}/messages`,
        { kind: "TEXT", body: "quiet" },
        a.token,
      );
      const card = pushOf(k.sent, "message", b.user.id);
      k.sent.length = 0;
      const ring = await k.call(
        "POST",
        "/api/calls",
        { userId: b.user.id, kind: "AUDIO", offerSdp: "v=0" },
        a.token,
      );
      await new Promise((r2) => setTimeout(r2, 820));
      await k.ctx.drain();
      check(
        "r69 mute: {msg:true} stores the MESSAGE half only — muted_msg = 1, muted_call = 0, reported as mutedMsg true / mutedCall false",
        r.status === 200 &&
          r.json.mutedMsg === true &&
          r.json.mutedCall === false &&
          d.json.conversation?.mutedMsg === true &&
          d.json.conversation?.mutedCall === false,
      );
      check(
        "r69 mute: a MESSAGE-muted chat still RINGS — the call push names its conversation (kp_chat) so the phone can re-check the mute, and it is not withheld",
        ring.status === 201 &&
          !!pushOf(k.sent, "call", b.user.id) &&
          pushOf(k.sent, "call", b.user.id).message?.android?.data?.kp_chat === convId,
        JSON.stringify(pushOf(k.sent, "call", b.user.id)?.message?.android?.data ?? null),
      );
      check(
        "r69 mute: …and its message card is the silent one — the push carries muted=1",
        !!card && card.message?.android?.data?.muted === "1",
        JSON.stringify({ muted: card?.message?.data?.muted }),
      );
    }
    // The old one-flag body (an installed app, the old chat-list toggle).
    {
      const { b, convId } = await pair(k, "both");
      const r = await mute(k, b, convId, { muted: true });
      const d = await detail(k, b, convId);
      check(
        "r69 mute: the legacy body {muted:true} still mutes BOTH halves in one call (the old app and the old toggle keep working)",
        r.json.mutedCall === true &&
          r.json.mutedMsg === true &&
          d.json.conversation?.mutedCall === true &&
          d.json.conversation?.mutedMsg === true,
      );
    }
    // Muting one half must not clear the other.
    {
      const { b, convId } = await pair(k, "half");
      await mute(k, b, convId, { call: true, msg: true });
      const r = await mute(k, b, convId, { msg: false });
      const d = await detail(k, b, convId);
      check(
        "r69 mute: unmuting ONE half leaves the other exactly as it was (a partial payload never zeroes the sibling)",
        r.json.mutedCall === true &&
          r.json.mutedMsg === false &&
          d.json.conversation?.mutedCall === true &&
          d.json.conversation?.mutedMsg === false,
      );
    }
  } finally {
    k.restore();
  }
}

// ── B. app: the chooser, the glyph, the silent paths ────────────────────────
{
  const kt = (f) =>
    readFileSync(`native-android/app/src/main/java/app/kuchupuchu/android/${f}`, "utf8");
  const ui = kt("Ui.kt");
  const chat = kt("ChatScreen.kt");
  const cl = kt("ChatListScreen.kt");
  const prof = kt("ProfileScreen.kt");
  const store = kt("ScreenStore.kt");
  const push = kt("KpPush.kt");
  const engine = kt("CallEngine.kt");
  const src = readFileSync("src/worker/index.ts", "utf8");

  check(
    "r69 mute: ONE chooser carries the two answers (call / messages) and every entry point opens it — the chat ⋮, the AI chat menu, the group menu, the chat-list sheet, both swipe Mute slots and the profile menu",
    ui.includes("internal fun KpMuteChooser(") &&
      ui.includes('if (callMuted) "Unmute calls" else "Mute calls"') &&
      ui.includes('if (msgMuted) "Unmute messages" else "Mute messages"') &&
      chat.includes("KpMuteChooser(") &&
      chat.includes("setMuteAspect(callOff, msgOff)") &&
      cl.includes("KpMuteChooser(") &&
      cl.includes("ListSelect.muteFor?.let { target ->") &&
      cl.includes("internal fun muteAspectsNow(") &&
      (cl.match(/askMute = true/g) || []).length === 2 &&
      prof.includes("KpMuteChooser(") &&
      (chat.match(/if \(muted\) "Unmute…" else "Mute…"/g) || []).length === 3,
  );
  check(
    "r69 mute: the chat publishes which half is off (row → conv.value → ScreenStore) and the app keeps them per chat, with `muted` still the OR for every older reader",
    store.includes("fun setMutedAspects(convId: String, call: Boolean, msg: Boolean)") &&
      store.includes('.put("muted", call || msg)') &&
      store.includes("fun isCallMuted(convId: String): Boolean {") &&
      store.includes("fun isMsgMuted(convId: String): Boolean {") &&
      store.includes(
        "fun isSilenced(convId: String): Boolean = isMsgMuted(convId) || isHidden(convId)",
      ) &&
      src.includes("mutedCall: meMutedCall,") &&
      src.includes(
        '"UPDATE members SET muted = ?, muted_call = ?, muted_msg = ? WHERE conv_id = ? AND user_id = ?",',
      ),
  );
  check(
    "r69 mute: the chat screen shows a mute glyph beside the name (one small bell-off, whichever half is off) and hides BOTH call buttons when the CALLS are muted",
    chat.includes("if (callMuted || msgMuted) {") &&
      chat.includes(
        "Icons.Filled.NotificationsOff,\n                            contentDescription =",
      ) &&
      chat.includes(
        'if (callMuted && msgMuted) "Muted" else if (callMuted) "Calls muted" else "Messages muted"',
      ) &&
      chat.includes("if (isGroup && c != null && !callMuted) {") &&
      chat.includes("!blockWall && !callMuted) {"),
  );
  check(
    "r69 mute: no ring anywhere for a call-muted chat — the worker withholds the relay + push, and the phone checks it too (the push handler and the engine's own poll)",
    src.includes("if (calleeRow?.muted_call === 1) return;") &&
      src.includes("if (mutedRow?.muted_call === 1) return;") &&
      push.includes("ScreenStore.isCallMuted(muteConv)") &&
      push.includes("CallEngine.ignoredCalls.add(callId)") &&
      engine.includes("val muted = ScreenStore.isCallMuted(conv)") &&
      engine.includes('if (conv.isBlank() || !call.optBoolean("incoming")) return@filter true'),
  );
  check(
    "r69 mute: a message card is silenced by the MESSAGE half (and a call-mute never silences it) on both sides of the wire",
    src.includes('muted: memberId.muted_msg === 1 ? "1" : "0",') &&
      push.includes('data["muted"] == "1" || ScreenStore.isMsgMuted(convoId)'),
  );
  check(
    "r69 mute: a muted chat posts NO card at all — the badge/list still move, but nothing lands in the shade (the silent channel still drew one), and a call-muted chat's missed-call card is withheld too (the ring never happened)",
    push.includes("if (muted) return") &&
      src.includes("if (muteRow?.muted_call === 1) return;") &&
      src.includes('// r69: the chat is muted for CALLS — the ring was withheld, so a "Missed'),
  );
}

// ── C. app: the r69 crash guard + the emoji-fx route rule ───────────────────
{
  const kt = (f) =>
    readFileSync(`native-android/app/src/main/java/app/kuchupuchu/android/${f}`, "utf8");
  const attach = kt("AttachSheet.kt");
  const emo = kt("EmojiAnim.kt");
  const chat = kt("ChatScreen.kt");
  check(
    "r69 crash: the selection bar NEVER indexes `sel` while it animates out — it reads mirrors (barCount / barOnce / exitCaption) taken at SideEffect time, and the caption write is guarded (the owner's IndexOutOfBoundsException: index 0, size 0)",
    attach.includes("var exitCount by remember { mutableStateOf(0) }") &&
      attach.includes('var exitCaption by remember { mutableStateOf("") }') &&
      attach.includes("var exitOnce by remember { mutableStateOf(false) }") &&
      attach.includes("val barCount = if (sel.isNotEmpty()) sel.size else exitCount") &&
      attach.includes("val barOnce = if (sel.isNotEmpty()) sel.all { it.once } else exitOnce") &&
      attach.includes("val cap = if (sel.isNotEmpty()) sel[0].caption else exitCaption") &&
      attach.includes("val allOnce = barOnce") &&
      attach.includes('"$barCount",') &&
      !attach.includes('"${sel.size}"'),
  );
  check(
    "r69-4 → r70-4: the policy is still the pure route test, and the CALL SITE now pairs it with the app's own foreground flag and with the tapper's `fromChat` proof — the owner's r70 finding was that a backgrounded or buried chat screen still buzzed (r70-4 put the flag back the r69 fix had dropped; case 47 and case 09 pin the rest)",
    emo.includes("fun mirrorsOnScreen(route: String, convId: String): Boolean") &&
      !emo.includes("foreground: Boolean") &&
      chat.includes("EmojiFxPolicy.mirrorsOnScreen(Store.route, convId)") &&
      chat.includes('ev.optBoolean("fromChat", true)') &&
      chat.includes("Store.foreground &&"),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r69-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
