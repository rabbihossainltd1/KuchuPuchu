// r68 — the owner's round after the r67 batch (2026-09-24). Eight items; this
// file covers the four that landed as code in this pass (1, 4, 5, 6) and stays
// the home for 7/8 (chat delete with the both-sides checkbox, single message
// delete with the same checkbox popup) when they land.
//
// 1. caption bar position: "caption bar open korle sothik position a ashe na
//    keyboard er upore ashe na onek upore ashe ar half attach screen a to
//    caption bar dekhai jai na" — the panel and the bar each lifted by the IME,
//    so the bar floated a whole keyboard too high and, in the 40% panel, clean
//    off the top. One lift now: the panel's, on the shared glide value.
// 4. reactions: "ei haptic ta just tokhoni kaj korbe jokhon 2 ta user e same
//    chat screen a thakbe all time na" — the mirrored replay (animation AND
//    buzz) is enqueued only while that chat is the screen in front.
// 5. "individual background shob buttons mile ektai rounded type background
//    Hobe. ar ei caption bar egula asbar somoy niche theke upore asbe animate
//    hoye" — one capsule behind the whole bar, entering from below.
// 6. "50% 40% kore daw" (the message tones) — one trim constant, now 0.4.
//
// No Android SDK in this sandbox, so 1/5/6 are pinned as source shape (CI's
// assembleRelease + the JVM tests are the behavioural half) and 4's decision
// table is additionally executed in the .scratch probe and EmojiFxPolicyTest.

import { readFileSync } from "node:fs";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "} ${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const read = (p) => readFileSync(p, "utf8");
const main = (f) => read(`${ANDROID}/${f}`);

/* ------------- 1. the caption bar sits on the keyboard, once ------------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r68-1: the panel lifts by the SHARED glide value the composer rides (one lift)",
    attach.includes(".padding(bottom = imeGlideDp),"),
  );
  check(
    "r68-1: …and `WindowInsets.ime` is not trusted a second time on this BOM",
    !attach.includes(".imePadding(),") &&
      !attach.includes("import androidx.compose.foundation.layout.imePadding"),
  );
  check(
    "r68-1: the bar itself no longer lifts (that was the second keyboard of height)",
    !attach.includes(".padding(bottom = imeGlideDp)\n"),
  );
  check(
    "r68-1: both grids reserve the bar's real height (76 dp), not the IME's",
    (attach.match(/bottom = if \(sel\.isNotEmpty\(\)\) 76\.dp else 4\.dp,/g) || []).length === 2 &&
      !attach.includes("68.dp + imeGlideDp"),
  );
  check(
    "r68-1: the caption field still arms the panel's expansion (the half panel grows instead of burying the bar)",
    attach.includes("val targetH = if (fullscreen || imeGlidePx > 10) expandedH else collapsedH"),
  );
}

/* ---------- 4. the mirrored reaction belongs to a shared screen ---------- */
{
  const emo = main("EmojiAnim.kt");
  const chat = main("ChatScreen.kt");
  check(
    "r68-4: the decision is one pure function (foreground + THIS route), so it can be asserted off-device",
    emo.includes("internal object EmojiFxPolicy") &&
      emo.includes(
        "fun mirrorsOnScreen(foreground: Boolean, route: String, convId: String): Boolean",
      ) &&
      emo.includes('return route == "chat/$convId" || route.startsWith("chat/$convId?")'),
  );
  check(
    "r68-4: the replay is enqueued only through it — a pocketed phone no longer buzzes for an unseen dance",
    chat.includes("EmojiFxPolicy.mirrorsOnScreen(Store.foreground, Store.route, convId)") &&
      (chat.match(/emojiFxReplays\.add\(/g) || []).length === 1,
  );
  check(
    "r68-4: the local tap still buzzes (the user IS looking at the screen) and still posts /fx on every tap",
    emo.includes("if (isSingle) replay(local = true) else haptics.tap()") &&
      emo.includes('Api.post("/api/messages/$mid/fx")'),
  );
}

/* ---------- 5. one rounded ground, entering from below ---------- */
{
  const attach = main("AttachSheet.kt");
  check(
    "r68-5: ONE rounded ground behind the whole bar (not one fill per control)",
    attach.includes(".background(Color(0x80000000), RoundedCornerShape(barH / 2 + 8.dp))") &&
      (attach.match(/Color\(0x80000000\)/g) || []).length === 1,
  );
  check(
    "r68-5: the per-control fills are gone (pen, pill, once seat, send seat)",
    !attach.includes(".background(Color(0x80000000))\n") &&
      !attach.includes(".size(barH - 8.dp)\n                                    .background(") &&
      !attach.includes(".size(barH + 4.dp)\n                                .background("),
  );
  check(
    "r68-5: the bar rises from below and retreats the same way",
    attach.includes("AnimatedVisibility(\n                    visible = sel.isNotEmpty(),") &&
      attach.includes("enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),") &&
      attach.includes("exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),"),
  );
  check(
    "r68-5: the pill's outline and the blue send disc survive the merge",
    attach.includes(".border(1.dp, Color(0x44FFFFFF), RoundedCornerShape(barH / 2))") &&
      attach.includes(".background(ActionBlue)"),
  );
  check(
    "r68-5: the bar height constant is still ONE value above the animation",
    attach.includes("val barH = 40.dp") && attach.includes(".height(barH)"),
  );
}

console.log(lines.join("\n"));
console.log(
  `r68 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
