// A notification reply posts a visible confirmation, but it must never play the incoming-message tone.
import { readFileSync } from "node:fs";

const source = readFileSync(
  "native-android/app/src/main/java/app/kuchupuchu/android/KpNotify.kt",
  "utf8",
);
const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const replyStart = source.indexOf("fun replySent(");
const replyEnd = source.indexOf("\n    /**", replyStart);
const replySent = source.slice(replyStart, replyEnd);
const actionStart = source.indexOf("ACTION_REPLY -> {");
const actionEnd = source.indexOf("\n        }\n    }\n\n    companion object", actionStart);
const replyAction = source.slice(actionStart, actionEnd);
const channelStart = source.indexOf('NotificationChannel(REPLY_CHANNEL, "Sent replies"');
const channelEnd = source.indexOf("\n        )", channelStart);
const replyChannel = source.slice(channelStart, channelEnd);

check(
  "reply confirmation uses its dedicated silent channel, never the selected incoming-message tone channel",
  source.includes('private const val REPLY_CHANNEL = "kp_reply_silent_v1"') &&
    replySent.includes("NotificationCompat.Builder(ctx, REPLY_CHANNEL)") &&
    !replySent.includes("toneChannelFor(ctx)"),
);
check(
  "the reply channel is low-importance with sound and vibration explicitly disabled",
  channelStart >= 0 &&
    replyChannel.includes("NotificationManager.IMPORTANCE_LOW") &&
    replyChannel.includes("setSound(null, null)") &&
    replyChannel.includes("enableVibration(false)"),
  replyChannel,
);
check(
  "legacy devices and replacement updates are also silenced",
  replySent.includes(".setOnlyAlertOnce(true)") &&
    replySent.includes(".setSound(null)") &&
    replySent.includes(".setVibrate(null)") &&
    replySent.includes(".setDefaults(0)"),
);
check(
  "only a successfully sent notification reply replaces the original card with a quiet confirmation",
  replyAction.includes("if (ok)") &&
    replyAction.includes("cancelAllCards()") &&
    replyAction.includes("KpNotify.replySent(ctx, convoId, text, cardId)"),
);

for (const line of lines) console.log(line);
if (lines.some((line) => line.includes("BROKEN"))) process.exitCode = 1;
