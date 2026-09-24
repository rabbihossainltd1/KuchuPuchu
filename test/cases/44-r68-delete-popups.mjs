// r68 items 7 + 8 — the two delete popups (2026-09-24).
//
// 7. full-chat delete: "ekhon theke full chat delete korte gele emon popup asbe
//    user jodi check box ta tick kore delete kore duijoner thekei chat delete
//    hoye jabe shob permanently tick na korle just tar kache thekei delete Hobe
//    je koreche" — the checkbox (default UNTICKED) is the whole decision:
//    ticked = both members lose the chat and the rows themselves go; unticked =
//    only the deleter's copy disappears and the other side keeps everything
//    (owner confirmed: "হ্যাঁ, এটাই").
// 8. message delete: "delete option just ektai hobe 2 ta na" + "1:1 chat a
//    user tar massage delete korte geleo ei popup abar opponent er massage
//    delete korte geleo ei popup mane se opponent er massage o delete korte
//    parbe everyone" — ONE Delete everywhere (long-press sheet, multi-select
//    bar, photo viewer, clip player, document viewer), and the same popup asks
//    the scope with the same checkbox.
//
// The worker half runs against the real handler (d1shim); the Kotlin half is
// pinned as source shape (no Android SDK in this sandbox — CI's
// assembleRelease is the compile witness).

import { readFileSync } from "node:fs";
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
  const db = makeD1();
  const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
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
  const solo = async (a, b) =>
    (await call("POST", "/api/conversations", { userId: b }, a.token)).json.conversation.id;
  const send = async (a, cid, body, extra = {}) =>
    (
      await call(
        "POST",
        `/api/conversations/${cid}/messages`,
        { kind: "TEXT", body, ...extra },
        a.token,
      )
    ).json;
  const msgs = async (a, cid) =>
    (await call("GET", `/api/conversations/${cid}/messages`, undefined, a.token)).json.items || [];
  const list = async (a) =>
    ((await call("GET", "/api/conversations", undefined, a.token)).json.items || []).map(
      (c) => c.id,
    );
  const search = async (a, q) =>
    (await call("GET", `/api/search?q=${encodeURIComponent(q)}`, undefined, a.token)).json;
  const media = async (a, cid) =>
    (await call("GET", `/api/conversations/${cid}/media`, undefined, a.token)).json;
  const detail = async (a, cid) =>
    (await call("GET", `/api/conversations/${cid}`, undefined, a.token)).json;
  return { db, call, reg, solo, send, msgs, list, search, media, detail };
}

const bodies = (rows) => JSON.stringify(rows.map((m) => m.body));

/* -------- 8. a personal chat: the OTHER side's message can go too -------- */
{
  const k = await mk();
  const A = await k.reg("d8a@x.com", "d8a");
  const B = await k.reg("d8b@x.com", "d8b");
  const cid = await k.solo(A, B.user.id);
  const fromB = await k.send(B, cid, "b-old");
  await k.send(A, cid, "a-old");
  const del = await k.call("DELETE", `/api/messages/${fromB.message.id}`, undefined, A.token);
  check(
    "r68-8: in a 1:1 the RECIPIENT can delete the sender's message for everyone (200)",
    del.status === 200 && del.json.ok === true,
    `${del.status} ${JSON.stringify(del.json).slice(0, 60)}`,
  );
  check(
    "r68-8: …and the row is really gone from BOTH histories",
    bodies(await k.msgs(A, cid)) === JSON.stringify(["a-old"]) &&
      bodies(await k.msgs(B, cid)) === JSON.stringify(["a-old"]),
    JSON.stringify({ a: await k.msgs(A, cid), b: await k.msgs(B, cid) }),
  );
  check(
    "r68-8: the chat survives the message delete (only the message goes)",
    (await k.list(A)).length === 1 && (await k.list(B)).length === 1,
    JSON.stringify({ a: await k.list(A), b: await k.list(B) }),
  );
}

/* -------- 8. the two bot transcripts stay sender-only -------- */
{
  const k = await mk();
  const A = await k.reg("d8c@x.com", "d8c");
  await k.call("POST", "/api/ai/welcome", {}, A.token);
  const conv = k.db._db
    .prepare(
      `SELECT c.id AS id FROM conversations c
        JOIN members m ON m.conv_id = c.id AND m.user_id = 'kp_ai_bot'`,
    )
    .get();
  check("r68-8: the AI chat exists for the bot test", !!conv?.id, String(conv?.id));
  const botMsg = k.db._db
    .prepare("SELECT id FROM messages WHERE conv_id = ? AND sender_id = 'kp_ai_bot'")
    .get(conv.id);
  const refused = await k.call("DELETE", `/api/messages/${botMsg.id}`, undefined, A.token);
  check(
    "r68-8: the bot's own message is still nobody else's to delete (403)",
    refused.status === 403,
    `${refused.status} ${JSON.stringify(refused.json).slice(0, 60)}`,
  );
  const mine = await k.send(A, conv.id, "my own note");
  const own = await k.call("DELETE", `/api/messages/${mine.message.id}`, undefined, A.token);
  check(
    "r68-8: …while the user's OWN message in that same AI chat deletes as always",
    own.status === 200,
    String(own.status),
  );
}

/* -------- 8. groups keep the old rule: your own messages only -------- */
{
  const k = await mk();
  const A = await k.reg("d8d@x.com", "d8d");
  const B = await k.reg("d8e@x.com", "d8e");
  const C = await k.reg("d8f@x.com", "d8f");
  const g = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "G8", memberIds: [B.user.id, C.user.id] },
      A.token,
    )
  ).json.conversation.id;
  const fromA = await k.send(A, g, "a-in-group");
  const fromB = await k.send(B, g, "b-in-group");
  const refused = await k.call("DELETE", `/api/messages/${fromA.message.id}`, undefined, B.token);
  check(
    "r68-8: in a GROUP the 403 stands — a member cannot delete another member's words",
    refused.status === 403,
    `${refused.status} ${JSON.stringify(refused.json).slice(0, 60)}`,
  );
  const own = await k.call("DELETE", `/api/messages/${fromB.message.id}`, undefined, B.token);
  check(
    "r68-8: …and the member's own message in the group still goes",
    own.status === 200,
    String(own.status),
  );
  const gLeft = bodies(await k.msgs(C, g));
  check(
    "r68-8: only that one row left the group history",
    gLeft.includes('"a-in-group"') && !gLeft.includes("b-in-group"),
    gLeft,
  );
}

/* -------- 7. unticked: my copy only — list, history, search, media, detail -------- */
{
  const k = await mk();
  const A = await k.reg("d7a@x.com", "d7a");
  const B = await k.reg("d7b@x.com", "d7b");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "needle-untick-one");
  await k.send(B, cid, "needle-untick-two");
  // A photo row (the media tab's own path): a real object in the bucket + the
  // IMAGE row pointing at it.
  await k.db._db
    .prepare(
      "INSERT INTO messages (id,conv_id,sender_id,kind,body,media,meta_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "m_photo_untick",
      cid,
      B.user.id,
      "IMAGE",
      "needle-untick-photo",
      "f/untick.jpg",
      JSON.stringify({ type: "image/jpeg", w: 100, h: 100 }),
      // A minute in the past: the watermark keeps a SAME-INSTANT row visible
      // (the round-13 data-loss guard), so the fixture must be clearly older.
      new Date(Date.now() - 60_000).toISOString(),
    );
  const del = await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: false }, B.token);
  check(
    "r68-7: the unticked delete answers {ok, forEveryone:false}",
    del.status === 200 && del.json.forEveryone === false,
    `${del.status} ${JSON.stringify(del.json).slice(0, 60)}`,
  );
  const detailB = await k.detail(B, cid);
  check(
    "r68-7: the detail route tells the app this chat is hidden for me (hiddenByMe) — the list merge cannot resurrect it",
    detailB.hiddenByMe === true && !!detailB.conversation,
    JSON.stringify({ hiddenByMe: detailB.hiddenByMe, conv: !!detailB.conversation }),
  );
  check(
    "r68-7: …and it is NOT hidden for the other member",
    (await k.detail(A, cid)).hiddenByMe === false,
    JSON.stringify((await k.detail(A, cid)).hiddenByMe),
  );
  check(
    "r68-7: it left MY list and stayed in theirs",
    !(await k.list(B)).includes(cid) && (await k.list(A)).includes(cid),
    JSON.stringify({ b: await k.list(B), a: await k.list(A) }),
  );
  check(
    "r68-7: my history is cut at the delete, theirs is untouched",
    (await k.msgs(B, cid)).length === 0 && (await k.msgs(A, cid)).length === 3,
    JSON.stringify({ b: bodies(await k.msgs(B, cid)), a: bodies(await k.msgs(A, cid)) }),
  );
  const sB = await k.search(B, "needle-untick");
  const sA = await k.search(A, "needle-untick");
  check(
    "r68-7: search cannot hand the deleted chat back to ME",
    (sB.messages || []).length === 0,
    JSON.stringify((sB.messages || []).map((m) => m.body)),
  );
  check(
    "r68-7: …and the other member still finds every word",
    (sA.messages || []).length === 3,
    JSON.stringify((sA.messages || []).map((m) => m.body)),
  );
  const mB = await k.media(B, cid);
  const mA = await k.media(A, cid);
  check(
    "r68-7: the media tab honours the same watermark (mine empty, theirs holds the photo)",
    (mB.images || []).length === 0 && (mA.images || []).length === 1,
    JSON.stringify({ b: (mB.images || []).length, a: (mA.images || []).length }),
  );
  await k.send(A, cid, "after-the-untick");
  check(
    "r68-7: a newer message brings it back for me with only what is new",
    (await k.list(B)).includes(cid) &&
      bodies(await k.msgs(B, cid)) === JSON.stringify(["after-the-untick"]),
    JSON.stringify({ list: await k.list(B), msgs: bodies(await k.msgs(B, cid)) }),
  );
}

/* -------- 7. ticked: permanent for BOTH, rows and previews gone -------- */
{
  const k = await mk();
  const A = await k.reg("d7c@x.com", "d7c");
  const B = await k.reg("d7d@x.com", "d7d");
  const cid = await k.solo(A, B.user.id);
  await k.send(A, cid, "needle-tick-one");
  await k.send(B, cid, "needle-tick-two");
  const del = await k.call("DELETE", `/api/conversations/${cid}`, { forEveryone: true }, B.token);
  check(
    "r68-7: the ticked delete answers {ok, forEveryone:true}",
    del.status === 200 && del.json.forEveryone === true,
    `${del.status} ${JSON.stringify(del.json).slice(0, 60)}`,
  );
  check(
    "r68-7: both members are told the chat is hidden for them",
    (await k.detail(A, cid)).hiddenByMe === true && (await k.detail(B, cid)).hiddenByMe === true,
    JSON.stringify({
      a: (await k.detail(A, cid)).hiddenByMe,
      b: (await k.detail(B, cid)).hiddenByMe,
    }),
  );
  check(
    "r68-7: the chat leaves BOTH lists",
    !(await k.list(A)).includes(cid) && !(await k.list(B)).includes(cid),
    JSON.stringify({ a: await k.list(A), b: await k.list(B) }),
  );
  check(
    "r68-7: both histories are empty",
    (await k.msgs(A, cid)).length === 0 && (await k.msgs(B, cid)).length === 0,
    JSON.stringify({ a: await k.msgs(A, cid), b: await k.msgs(B, cid) }),
  );
  check(
    "r68-7: neither side can search the deleted words back",
    (await k.search(A, "needle-tick")).messages.length === 0 &&
      (await k.search(B, "needle-tick")).messages.length === 0,
    JSON.stringify({
      a: (await k.search(A, "needle-tick")).messages,
      b: (await k.search(B, "needle-tick")).messages,
    }),
  );
  const row = k.db._db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?").get(cid);
  check(
    "r68-7: the rows themselves are gone (permanent, not a tombstone)",
    row.n === 0,
    String(row.n),
  );
  const conv = k.db._db
    .prepare("SELECT last_message, last_message_at FROM conversations WHERE id = ?")
    .get(cid);
  check(
    "r68-7: the shared preview is cleared for both",
    conv.last_message === null && conv.last_message_at === null,
    JSON.stringify(conv),
  );
  const unread = k.db._db
    .prepare("SELECT SUM(unread) AS s FROM members WHERE conv_id = ?")
    .get(cid);
  check(
    "r68-7: no counter still counts a message that no longer exists",
    (unread.s || 0) === 0,
    String(unread.s),
  );
}

/* -------- 7. deleting a GROUP is still a leave -------- */
{
  const k = await mk();
  const A = await k.reg("d7e@x.com", "d7e");
  const B = await k.reg("d7f@x.com", "d7f");
  const g = (
    await k.call(
      "POST",
      "/api/conversations/group",
      { title: "G7", memberIds: [B.user.id] },
      A.token,
    )
  ).json.conversation.id;
  await k.send(A, g, "group-keeps-this");
  const del = await k.call("DELETE", `/api/conversations/${g}`, { forEveryone: true }, B.token);
  check(
    "r68-7: on a group the checkbox changes nothing — the delete is a leave",
    del.status === 200 && del.json.forEveryone === false && !(await k.list(B)).includes(g),
    `${del.status} ${JSON.stringify(del.json).slice(0, 60)}`,
  );
  check(
    "r68-7: …and the group's history survives for the member who stayed",
    bodies(await k.msgs(A, g)).includes('"group-keeps-this"'),
    bodies(await k.msgs(A, g)),
  );
}

/* ---------------- the app side: ONE popup, every entry point ---------------- */
{
  const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
  const main = (f) => readFileSync(`${ANDROID}/${f}`, "utf8");
  const ui = main("Ui.kt");
  const chat = main("ChatScreen.kt");
  const cl = main("ChatListScreen.kt");
  const store = main("ScreenStore.kt");
  const mv = main("MediaViewer.kt");
  const doc = main("DocViewerScreen.kt");
  const api = main("Api.kt");

  check(
    "r68-7/8 (r69 geometry): ONE shared dialog carries both popups — optional avatar + bold title, the question, the checkbox row (default UNTICKED), Cancel blue / Delete red. r69 rebuilt the box to the owner's screenshot: usePlatformDefaultWidth = false + 16 dp side margins (the fat left-right gap was his complaint), 10 dp corners, 24/14/12 dp padding",
    ui.includes("fun KpDeleteDialog(") &&
      ui.includes("alsoDefault: Boolean = false") &&
      ui.includes("var also by remember { mutableStateOf(alsoDefault) }") &&
      ui.includes("usePlatformDefaultWidth = false") &&
      ui.includes("padding(horizontal = 16.dp)") &&
      ui.includes("RoundedCornerShape(10.dp)") &&
      ui.includes(".border(2.dp, if (also) ActionBlue else Muted, RoundedCornerShape(5.dp))") &&
      ui.includes(
        'Text("Cancel", color = ActionBlue, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)',
      ) &&
      ui.includes(
        "Text(confirmLabel, color = Red, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)",
      ) &&
      ui.includes("haptics.toggle(!also)") &&
      ui.includes("haptics.heavy()\n                            onConfirm(also)"),
  );
  check(
    "r68-8: the checkbox line names the other person (display name, username, else 'everyone') and is dropped when there is nobody to tell",
    ui.includes("internal fun deleteOtherLabel(convId: String): String {") &&
      ui.includes('return name.ifBlank { "everyone" }') &&
      chat.includes(
        'alsoLabel = if (canAlso) "Also delete for ${deleteOtherLabel(convId)}" else null,',
      ),
  );
  check(
    "r68-8: who may reach the other side — a personal chat with a peer who is not one of the two bots, never a sending echo, never a group",
    ui.includes("internal fun canDeleteForEveryone(convId: String, m: JSONObject?): Boolean {") &&
      ui.includes("if (m == null || isEchoMsg(m)) return false") &&
      ui.includes('if (m.optString("senderId") == Store.myId()) return true') &&
      ui.includes('if (c.optBoolean("isGroup")) return false') &&
      ui.includes("return otherId.isNotBlank() && !isKpBot(otherId)"),
  );
  check(
    "r68-8: the long-press sheet and the multi-select bar each carry ONE Delete (no delete-for-everyone / delete-for-me pair, no 'Unsend')",
    chat.includes('KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red) {') &&
      chat.includes("IconButton(onClick = { haptics.tap(); confirmDelete = true }) {") &&
      !chat.includes("KpSheetRow(Icons.Filled.DeleteForever, ") &&
      !chat.includes("Delete for everyone"),
  );
  check(
    "r68-8: the answer splits the gesture — ticked = the server delete for the rows that exist, unticked = hide them here; a sending echo has no id and leaves locally either way",
    chat.includes("fun deleteChosen(alsoForThem: Boolean) {") &&
      chat.includes("val rows = selectedMessages()") &&
      chat.includes("val onServer = rows.filterNot { pendingEchoOf(it) }") &&
      chat.includes("if (alsoForThem && onServer.isNotEmpty()) {") &&
      chat.includes("unsendSelected()") &&
      chat.includes("echoes.forEach { ScreenStore.hideMessage(it) }") &&
      chat.includes("deleteForMe()"),
  );
  check(
    "r68-8: the message popup asks exactly the owner's question ('Delete message' / 'Are you sure…'), plural for a multi-select",
    chat.includes('title = "Delete message"') &&
      chat.includes('"Are you sure you want to delete these ${rows.size} messages?"') &&
      chat.includes('"Are you sure you want to delete this message?"') &&
      chat.includes('confirmLabel = "Delete",'),
  );
  check(
    "r68-7: the chat popup carries the peer's avatar + 'Delete Chat' + 'Permanently delete the chat with {name}?' and the same checkbox",
    chat.includes('title = "Delete Chat"') &&
      chat.includes('question = "Permanently delete the chat with $name?"') &&
      chat.includes('alsoLabel = "Also delete for $name"') &&
      chat.includes('confirmLabel = "Delete Chat"') &&
      chat.includes('avatarUrl = otherJ?.optIso("avatarUrl")'),
  );
  check(
    "r68-7: every chat-delete entry point lands on that popup and sends the answer (thread ⋮, chat-list row, chat-list multi-select, block wall)",
    chat.includes("confirmDeleteChat = true") &&
      chat.includes("deleteWallChat(also)") &&
      chat.includes("fun deleteWallChat(forEveryone: Boolean)") &&
      chat.includes('"/api/conversations/$convId",') &&
      chat.includes('JSONObject().put("forEveryone", forEveryone),') &&
      cl.includes("KpDeleteDialog(") &&
      cl.includes('title = "Delete Chat"') &&
      cl.includes('Api.delete("/api/conversations/$id", JSONObject().put("forEveryone", also))'),
  );
  check(
    "r68-7: a chat the server calls hidden for me is dropped, never re-added by the one-conversation poke merge",
    cl.includes("val detail =") &&
      cl.includes('if (detail.optBoolean("hiddenByMe")) ScreenStore.dropConv(cid)') &&
      cl.includes("else ScreenStore.upsertConv(one)"),
  );
  check(
    "r68-7: the other side's `cleared` frame empties an open thread instead of limping on with rows that are gone",
    chat.includes(
      '"cleared" ->\n                    if (ev.optString("conversationId") == convId) {\n                        refreshMessages(forceNetwork = true)\n                    }',
    ),
  );
  check(
    "r68-8: the viewers ask the same question — the photo viewer gets the label from its host (it is generic), the two route screens read the open chat from the store",
    mv.includes("deleteAlsoLabel: String? = null") &&
      mv.includes("alsoLabel = if (onDeleteForEveryone != null) deleteAlsoLabel else null,") &&
      mv.includes("if (also) onDeleteForEveryone?.invoke() else onDeleteForMe?.invoke()") &&
      mv.includes("val canUnsend = canDeleteForEveryone(ScreenStore.activeConvId, m)") &&
      doc.includes("val canUnsend = canDeleteForEveryone(ScreenStore.activeConvId, m)") &&
      doc.includes("alsoLabel = if (canUnsend) deleteAlsoLabelForActiveChat() else null,") &&
      !mv.includes("internal fun KpDeleteSheet("),
  );
  check(
    "r68-8: the chat publishes itself for those routes, and the store keeps the published name",
    store.includes('var activeConvId: String = ""') &&
      store.includes('var activePeerName: String = ""') &&
      chat.includes("ScreenStore.activeConvId = convId") &&
      chat.includes("ScreenStore.activePeerName = rawTitle") &&
      ui.includes("internal fun deleteAlsoLabelForActiveChat(): String?"),
  );
  check(
    "r68-7/8: the DELETE call can carry a body now (the checkbox's answer)",
    api.includes("fun delete(path: String, body: JSONObject = JSONObject()): JSONObject {") &&
      api.includes('val data = request(path, "DELETE", body)'),
  );
}

console.log(lines.join("\n"));
console.log(
  `r68 delete popups: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
