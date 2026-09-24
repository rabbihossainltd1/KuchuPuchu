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

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r70-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
