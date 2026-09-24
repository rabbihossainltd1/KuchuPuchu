// r68 — the owner's round after the r67 batch (2026-09-24). Eight items; this
// file covers the four that landed as code in this pass (1, 4, 5, 6); 7/8 (the
// two delete popups) live in 44-r68-delete-popups.mjs, which drives the worker
// as well as pinning the app.
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
    // r70-14: the bar's ink is 70 dp now that barH is 34 (was 76 at 40 dp).
    "r68-1: both grids reserve the bar's real height (70 dp), not the IME's",
    (attach.match(/bottom = if \(sel\.isNotEmpty\(\)\) 70\.dp else 4\.dp,/g) || []).length === 2 &&
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
    'r68-4 / r69-4: the decision is one pure function over THIS route (owner: "only chat screen a thaklei hobe eita"), so it can be asserted off-device',
    emo.includes("internal object EmojiFxPolicy") &&
      emo.includes("fun mirrorsOnScreen(route: String, convId: String): Boolean") &&
      !emo.includes("fun mirrorsOnScreen(foreground") &&
      emo.includes('return route == "chat/$convId" || route.startsWith("chat/$convId?")'),
  );
  check(
    // r70-4: the foreground flag is back (a backgrounded app is not on the chat
    // screen) — the policy stays the pure route test, the call site pairs it
    // with `Store.foreground` and the tapper's `fromChat`.
    "r68-4 / r69-4 / r70-4: the replay is enqueued only through it — being ON that chat screen is the condition, now with the foreground flag and the frame's `fromChat` proof (a buried or backgrounded chat screen must not buzz)",
    chat.includes("EmojiFxPolicy.mirrorsOnScreen(Store.route, convId)") &&
      chat.includes("Store.foreground &&") &&
      chat.includes('ev.optBoolean("fromChat", true)') &&
      (chat.match(/emojiFxReplays\.add\(/g) || []).length === 1,
  );
  check(
    // r71-4 (the owner, third round: "ami chat screen e nei, tobu amar phone
    // buzz kore"): the route alone was never the whole truth — the photo
    // viewer and the album viewer are drawn BY the chat screen (no route of
    // their own) and every sheet paints over the thread while the route still
    // reads chat/<id>, so a phone staring at a photo looked like a phone
    // reading the chat. "In front" now means the THREAD is readable.
    "r71-4: the mirror ALSO refuses while one of the chat's own covers (photo viewer, album viewer, any sheet) sits on top of the thread",
    chat.includes("fun threadCovered(): Boolean =") &&
      chat.includes("viewerPhotos.isNotEmpty() || albumMsg != null ||") &&
      chat.includes("showAttach || showStickers || showSchedule || showScheduled ||") &&
      chat.includes("showChatSearch || showDisappear || showTheme || showDeselect ||") &&
      chat.includes("editing != null || forwarding") &&
      // the gate itself, in that order: conv, fromChat, foreground, route, covers
      /if \(ev\.optString\("conversationId"\) == convId &&[\s\S]{0,400}?mirrorsOnScreen\(Store\.route, convId\) &&[\s\S]{0,200}?!threadCovered\(\)[\s\S]{0,40}?\) \{/.test(
        chat,
      ) &&
      // and the covers really are composed by this screen (a nav route would
      // have been caught by the route test — these were the hole)
      chat.includes("if (viewerPhotos.isNotEmpty()) {") &&
      !chat.includes('nav.navigate("photoviewer') &&
      chat.includes("albumMsg?.let { m ->"),
  );
  check(
    "r71-4: a mirrored frame is stamped on arrival and only replayed while it is still fresh (3 s) — a dance whose row was not composed at the time must not buzz a screen that scrolled past it later",
    emo.includes("internal val emojiFxAt = HashMap<String, Long>()") &&
      emo.includes("internal const val MIRROR_FRESH_MS = 3_000L") &&
      chat.includes("emojiFxAt[it] = System.currentTimeMillis()") &&
      emo.includes("val at = emojiFxAt.remove(mid) ?: 0L") &&
      emo.includes(
        "if (System.currentTimeMillis() - at in 0..MIRROR_FRESH_MS) replay(local = false)",
      ) &&
      // still exactly one enqueue site (case 43's other pin counts it)
      (chat.match(/emojiFxReplays\.add\(/g) || []).length === 1,
  );
  check(
    "r68-4: the local tap still buzzes (the user IS looking at the screen) and still posts /fx on every tap (r70-4 adds the tap's own `onChat` state to that POST; r71-4 leaves the sender's half alone — the tap happens ON a bubble, so it stays the pair `foreground + chat/` and the mirror never dies)",
    emo.includes("if (isSingle) replay(local = true) else haptics.tap()") &&
      emo.includes('Api.post("/api/messages/$mid/fx", JSONObject().put("onChat", onChatNow))') &&
      emo.includes('val onChatNow = Store.foreground && Store.route.startsWith("chat/")'),
  );
}

/* ---------- 5. one rounded ground, entering from below ---------- */
{
  const attach = main("AttachSheet.kt");
  check(
    // r70-14: the same capsule, now 40% black (owner: "ar halka ... Hobe").
    "r68-5: ONE rounded ground behind the whole bar (not one fill per control)",
    attach.includes(".background(Color(0x66000000), RoundedCornerShape(barH / 2 + 8.dp))") &&
      (attach.match(/Color\(0x66000000\)/g) || []).length === 1,
  );
  check(
    "r68-5: the per-control fills are gone (pen, pill, once seat, send seat)",
    !attach.includes(".background(Color(0x66000000))\n") &&
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
    // r70-14: 34 dp now (the owner asked for "ar halka chikon"); the pin is
    // that the constant exists and the pill rides it.
    attach.includes("val barH = 34.dp") && attach.includes(".height(barH)"),
  );
}

/* ------------------ 6. the four message tones at 40% ------------------ */
{
  const feel = main("Feel.kt");
  check(
    "r68-6: the trim constant is 0.4 (was 0.5 for r67's half)",
    feel.includes("private const val MSG_VOLUME_TRIM = 0.4f") &&
      !feel.includes("MSG_VOLUME_TRIM = 0.5f"),
  );
  const trimmed = feel.match(/0\.(?:6|7|55)f \* MSG_VOLUME_TRIM/g) || [];
  check("r68-6: all four message tones read it", trimmed.length === 4, JSON.stringify(trimmed));
  check(
    "r68-6: the reaction / call / status tones are untouched",
    feel.includes("fun reaction(ctx: Context) = play(ctx, reactionId, 0.7f)") &&
      feel.includes("fun lineBusy(ctx: Context) = play(ctx, lineBusyId, 0.9f)"),
  );
}

console.log(lines.join("\n"));
console.log(
  `r68 round: ${lines.filter((l) => l.includes("OK")).length} ok / ${lines.filter((l) => l.includes("BROKEN")).length} broken`,
);
process.exit(lines.some((l) => l.includes("BROKEN")) ? 1 : 0);
