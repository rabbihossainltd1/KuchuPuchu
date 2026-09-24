// r70 round (owner's list after testing r69). Eleven items confirmed fixed;
// item 4 came back "not fixed" a second time; five are new (12–16).
//
//   13. send/sending/sent + reply: "reply massage send korle first a normal
//       vabe jai tarpor reply massage hisabe jai" — the optimistic echo never
//       carried the quote, so the bubble was born unquoted and BECAME a reply
//       when the server row replaced it. One `replyId` per send, written to
//       the payload AND the echo, for text, photo and file alike (a photo /
//       clip / document reply used to drop the quote entirely and leave the
//       quote bar open behind it).
//   4. the mirrored reaction's animation + buzz (see the second half of this
//       file once the r70 gate lands).
//
// No Android SDK here, so the app half is pinned as source shape; CI's apk job
// (testDebugUnitTest lintDebug) is the compile witness.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "} ${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (p) => readFileSync(p, "utf8");
const main = (f) => read(`${ANDROID}/${f}`);

/* ---------- 13. one replyId per send, written to payload AND echo ---------- */
{
  const chat = main("ChatScreen.kt");
  const echoQuote =
    chat.split('.also { if (replyId != null) it.put("replyTo", replyId) }').length - 1;

  check(
    "r70-13: the text send captures ONE replyId and writes it to the payload and the echo (the echo is what the bubble is born with)",
    chat.includes('val replyId = replyTo?.optString("id")?.takeIf { it.isNotBlank() }') &&
      chat.includes('replyId?.let { payload.put("replyTo", it) }') &&
      chat.includes('// r70-13 (owner: "send sending sent a ekhono problem ache jemon reply') &&
      chat.includes(
        '.put("body", body)\n                .also { if (replyId != null) it.put("replyTo", replyId) }',
      ),
  );
  check(
    "r70-13: the old shape is gone — the quote no longer goes on the payload ALONE (that is what made the bubble change shape after landing)",
    !chat.includes(
      'replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }',
    ) &&
      !chat.includes(
        'replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }\n        replyTo = null\n        bornKeys',
      ),
  );
  check(
    "r70-13: photos answer their quote too — echo, live payload and the send-later payload all carry it",
    chat.includes("// r70-13: the quote a photo (or a scheduled photo) is answering") &&
      chat.includes("// r70-13: the photo's own echo carries the quote from frame one.") &&
      chat.includes("// r70-13: the quote rides the payload, so the server row that") &&
      chat.includes("// r70-13: a photo sent for LATER answers its quote too.") &&
      echoQuote >= 6,
  );
  check(
    "r70-13: clips / documents answer their quote too — the uncaptioned arm passes an explicit payload (it used to build its own without the quote), the captioned arm and the send-later payload carry it as well",
    chat.includes("// r70-13: the quote a clip / document (or a scheduled one) is answering") &&
      chat.includes("fun plainPayload() =") &&
      chat.includes(
        "Uploads.sendFile(convId, clientId, name, mime, file, if (clipMeta.length() > 0) clipMeta else docMeta, plainPayload()) { outcome ->",
      ) &&
      chat.includes("// r70-13: the file's own echo carries the quote from frame one.") &&
      chat.includes("// r70-13: the quote a captioned clip is answering."),
  );
  check(
    "r70-13: the reply bar is consumed exactly once per send (every send path clears it through the captured replyId)",
    chat.split("replyTo = null").length - 1 >= 5 &&
      !chat.includes('replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let'),
  );
}

/* ------------- 14. the caption bar: slimmer, longer, lighter ------------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r70-14: the bar is 34 dp (was 40) and the pencil seat rides the SAME constant — no 40 dp literal is left in the row",
    attach.includes("val barH = 34.dp") &&
      attach.includes(".size(barH)") &&
      !attach.includes(".size(40.dp)") &&
      attach.includes(".height(barH)"),
  );
  check(
    "r70-14: it runs almost the whole width — 4 dp of side air (it was 10) — and both grids reserve its real 70 dp of ink",
    attach.includes(".padding(horizontal = 4.dp, vertical = 8.dp)") &&
      (attach.match(/bottom = if \(sel\.isNotEmpty\(\)\) 70\.dp else 4\.dp,/g) || []).length ===
        2 &&
      !attach.includes("76.dp else 4.dp"),
  );
  check(
    "r70-14: the ground is lighter — 40% black, ONE capsule for the whole bar (it was 50%)",
    (attach.match(/Color\(0x66000000\)/g) || []).length === 1 &&
      attach.includes(".background(Color(0x66000000), RoundedCornerShape(barH / 2 + 8.dp))") &&
      !attach.includes("Color(0x80000000)"),
  );
}

/* -------- 15. the pencil seat wears the first ticked item's thumb -------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r70-15: the edit seat shows the FIRST ticked media's own thumbnail (same decode path as the grid), with a smaller pencil over a scrim — never a bare white glyph",
    attach.includes("val editFirst = sel.firstOrNull()") &&
      attach.includes("initialValue = editFirst?.let { ThumbCache.get(it.uri) },") &&
      attach.includes("key1 = editFirst?.uri,") &&
      attach.includes("ThumbDecodeGate.decode(one.uri, ctx, one.isVideo)") &&
      !attach.includes("sel.lastOrNull()?.uri]"),
  );
  check(
    "r70-15: it is still the editor's door — a tap opens the LAST ticked item in the editor, and the pencil is 16 dp (the seat is barH)",
    attach.includes("sel.lastOrNull()?.let(onEdit)") &&
      attach.includes('Icons.Filled.Edit,\n                                "Edit",') &&
      attach.includes("modifier = Modifier.size(16.dp),") &&
      !attach.includes(
        'Icon(Icons.Filled.Edit, "Edit", tint = Color.White, modifier = Modifier.size(20.dp))',
      ),
  );
}

/* ---------- 16. editor buttons: a halo, not a white-on-white glyph ---------- */
{
  const edit = main("MediaEditScreen.kt");
  check(
    "r70-16: the rail's bare glyphs (v170: no circle, no border) get a soft black halo instead — visible over white media without a fill coming back",
    edit.includes("import androidx.compose.ui.draw.shadow") &&
      edit.includes(
        ".size(40.dp)\n                .shadow(8.dp, CircleShape)\n                .alpha(if (can) 1f else 0.35f)",
      ) &&
      edit.includes('// r70-16 (owner: "media edit a buttons gula shadow add korte hobe noile') &&
      // the seat itself: no fill and no border of its own (v170) — the halo is
      // the whole change (the 18 dp red badge's white border is another control).
      !/fun StageHistory[\s\S]{0,900}?\.border\(/.test(edit) &&
      !/fun StageHistory[\s\S]{0,900}?\.background\(/.test(edit),
  );
  check(
    "r70-16: the top bar's ✕ / undo / redo ride the same halo (their sizes — 36 / 32 — are untouched, so the v169 geometry holds)",
    edit.includes("modifier = Modifier.size(36.dp).shadow(6.dp, CircleShape)") &&
      edit.includes("modifier = Modifier.size(32.dp).shadow(6.dp, CircleShape))") &&
      (edit.match(/modifier = Modifier\.size\(32\.dp\)\.shadow\(6\.dp, CircleShape\)\) \{/g) || [])
        .length === 2,
  );
}

/* ---- 4. the mirror needs BOTH phones on the chat screen (again) ---- */
{
  const app = main("KpApp.kt");
  const chat = main("ChatScreen.kt");
  const emo = main("EmojiAnim.kt");
  const worker = read("src/worker/index.ts");
  check(
    "r70-4: Store.route has ONE writer again — the nav back stack (a chat buried under the media viewer / clip player / doc viewer, or a backgrounded app, used to keep claiming chat/<id>)",
    app.includes("import androidx.navigation.compose.currentBackStackEntryAsState") &&
      app.includes("val navEntry by nav.currentBackStackEntryAsState()") &&
      app.includes('dest == "chat/{id}" -> "chat/" + (e.arguments?.getString("id") ?: "")') &&
      !chat.includes('Store.route = "chat/$convId"') &&
      !chat.includes('Store.route = ""'),
  );
  check(
    "r70-4: this phone's half is \"really in front\" — the foreground flag AND the route (the same pair the notification path uses), plus the tapper's `fromChat` proof from the frame",
    chat.includes('ev.optBoolean("fromChat", true)') &&
      chat.includes("Store.foreground &&") &&
      chat.includes("EmojiFxPolicy.mirrorsOnScreen(Store.route, convId)"),
  );
  check(
    "r70-4: the tapper's app posts its own screen state with the tap (`onChat`), and the worker relays it as `fromChat` (a body-less tap keeps the old behaviour)",
    emo.includes('Api.post("/api/messages/$mid/fx", JSONObject().put("onChat", onChatNow))') &&
      emo.includes('val onChatNow = Store.foreground && Store.route.startsWith("chat/")') &&
      worker.includes('const fromChat = typeof body.onChat === "boolean" ? body.onChat : true;') &&
      worker.includes("fromChat,"),
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r70-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
