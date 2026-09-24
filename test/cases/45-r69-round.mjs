// r69 round (owner bug list after testing r68): the attach-bar crash, the
// emoji-fx route rule and the two-aspect mute (calls vs messages).

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const kt = (f) =>
  readFileSync(`native-android/app/src/main/java/app/kuchupuchu/android/${f}`, "utf8");

// ── C. app: the r69 crash guard ─────────────────────────────────────────────
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
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`r69-round: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
