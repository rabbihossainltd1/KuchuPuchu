import { readFileSync } from "node:fs";
import {
  commandDraft,
  commandSuggestions,
  parseMessageCommand,
} from "../../web/src/messaging/messageCommands.ts";
import { parseMessageText, stripBoldMarkers } from "../../web/src/messaging/messageText.ts";

const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );
const read = (path) => readFileSync(path, "utf8");

const worker = read("src/worker/index.ts");
const androidChat = read("native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt");
const androidPush = read("native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt");
const androidSearch = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/SearchScreen.kt",
);
const androidProfile = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ProfileScreen.kt",
);
const androidGroup = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/GroupInfoScreen.kt",
);
const androidMarkup = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/MessageMarkup.kt",
);
const androidCommands = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ComposerCommands.kt",
);
const androidMagic = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/MagicMessageEffect.kt",
);
const webCommands = read("web/src/messaging/ChatPane.tsx");
const webMessaging = read("web/src/messaging/useMessaging.ts");
const webInfo = read("web/src/messaging/InfoPane.tsx");
const webSearch = read("web/src/messaging/SearchPane.tsx");
const webAttachment = read("web/src/messaging/AttachmentRow.tsx");
const webCss = read("web/src/messaging/messaging.css");
const status = read("native-android/app/src/main/java/app/kuchupuchu/android/StatusScreens.kt");

check(
  "slash suggestions offer /silent, /magic and /vanish only at the start of a draft",
  commandSuggestions("/")
    .map((item) => item.name)
    .join(",") === "silent,magic,vanish" &&
    commandSuggestions("/va")
      .map((item) => item.name)
      .join(",") === "vanish" &&
    commandSuggestions("text /").length === 0 &&
    commandDraft("magic") === "/magic ",
);
const silent = parseMessageCommand("/silent no alert");
const magic = parseMessageCommand("/MAGIC sparkle");
const vanish = parseMessageCommand("/vanish one minute");
check(
  "slash commands strip the command from message text and preserve its metadata flag",
  silent?.text === "no alert" &&
    silent.meta.silent === true &&
    magic?.text === "sparkle" &&
    magic.meta.magic === true &&
    vanish?.text === "one minute" &&
    vanish.meta.vanish === true,
);

const marked = "plain *single* and **double**";
const directText = parseMessageText("Hi **@rahi** and a@b.com; https://example.com/@linked", true);
const groupText = parseMessageText("Hi @rahi", false);
check(
  "single and double asterisks become bold spans without visible markers",
  stripBoldMarkers(marked) === "plain single and double" &&
    parseMessageText(marked)
      .filter((part) => part.bold)
      .map((part) => part.text)
      .join("|") === "single|double",
);
check(
  "a direct-chat @username is clickable and styled bold too; the group and email lookalike are plain",
  directText.some((part) => part.text === "@rahi" && part.bold && part.mention === "rahi") &&
    directText.every((part) => part.mention !== "b" && part.mention !== "linked") &&
    groupText.every((part) => part.mention === undefined),
);
check(
  "the Web command suggestions, cleaned send body, formatting and mention click are wired to the composer and bubbles",
  webCommands.includes("commandSuggestions(controller.draft)") &&
    webCommands.includes("parseMessageText(body, !conversation.isGroup && !isPlaceholder)") &&
    webCommands.includes("openMentionChat(part.mention!)") &&
    webMessaging.includes("const plaintext = command ? command.text : composerText") &&
    webMessaging.includes("...(item.meta ? { meta: { ...item.meta } } : {})"),
);
check(
  "the Android composer parses the cleaned messageBody, keeps the command in meta, clears drafts and checks emoji-only on the cleaned text",
  androidCommands.includes('ComposerCommand("silent"') &&
    androidCommands.includes('ComposerCommand("magic"') &&
    androidCommands.includes('ComposerCommand("vanish"') &&
    androidChat.includes("val messageBody = command?.text ?: body") &&
    androidChat.includes("emojiOnlyCount(messageBody)") &&
    androidChat.includes("Drafts.clear(convId)\n        return true"),
);
check(
  "bold markers are hidden across Android/Web bubbles, captions, search results, quotes and copied text",
  androidMarkup.includes("fun formatted(value: String): AnnotatedString") &&
    androidMarkup.includes("FontWeight.Bold") &&
    androidChat.includes("MessageMarkup.annotate(") &&
    androidChat.includes("MessageMarkup.formatted(body)") &&
    androidChat.includes('MessageMarkup.plain(m.optText("body"))') &&
    androidSearch.includes('MessageMarkup.formatted(m.optString("body").ifBlank { "Photo" })') &&
    androidSearch.includes('Highlight(MessageMarkup.plain(m.optString("body")), query)') &&
    webAttachment.includes("parseMessageText(caption)") &&
    webSearch.includes("return stripBoldMarkers(row.body)") &&
    webCommands.includes("copyText(stripBoldMarkers(body))") &&
    webCommands.includes("stripBoldMarkers(selection.copyText)"),
);
check(
  "1:1 mention taps open a chat on Android from both normal and optimistic rows and on Web",
  (androidChat.match(/onOpenMention = \{ username -> openMentionChat\(username\) \}/g) ?? [])
    .length >= 2 &&
    androidChat.includes("/api/users/username/$username") &&
    androidChat.includes('nav.navigate("chat/$targetId")') &&
    webCommands.includes("aria-label={`Open chat with @${part.mention}`}"),
);
check(
  "a group mention forces a notification through both Worker and Android mute checks",
  worker.includes('...(mentioned ? { mention: "1" } : {})') &&
    worker.includes('muted: memberId.muted_msg === 1 && !mentioned ? "1" : "0",') &&
    androidPush.includes('val mentioned = data["mention"] == "1"') &&
    androidPush.includes(
      'val muted = !mentioned && (data["muted"] == "1" || ScreenStore.isMsgMuted(convoId))',
    ),
);
check(
  "/silent keeps the unread/list refresh but suppresses Worker push and in-app message alert",
  worker.includes("msg: silent ? 0 : 1") &&
    worker.includes("if (silent) return;") &&
    androidChat.includes('optBoolean("silent") != true') &&
    webMessaging.includes("const meta = command?.meta") &&
    worker.includes('kind === "TEXT" && incomingMeta.silent === true'),
);
check(
  "magic sends use matching one-shot Android and Web bubble animations",
  androidMagic.includes("fun Modifier.magicMessageEffect") &&
    androidChat.includes('optBoolean("magic") == true && fxBorn') &&
    webCommands.includes('message.meta.magic === true ? " bubble--magic"') &&
    webCss.includes("@keyframes message-magic-glow"),
);
check(
  "vanish starts on first recipient read, exposes a common expiry, and both clients call the expiry route",
  worker.includes("$.vanishExpiresAt") &&
    worker.includes("new Date(Date.parse(at) + 60_000).toISOString()") &&
    androidChat.includes('/expire", JSONObject())') &&
    webMessaging.includes(".expireVanish(api, row.id)") &&
    webMessaging.includes("hideMessages([row.id])") &&
    webMessaging.includes("expiry also removes the local row directly"),
);
check(
  "conversation nicknames are shared through the Worker and editable in both Web and Android direct/group screens",
  worker.includes("conversation_nicknames") &&
    worker.includes('method === "PUT" || method === "DELETE"') &&
    webInfo.includes("Nickname in this chat") &&
    webInfo.includes("Every current group member sees this alias") &&
    androidProfile.includes("Nickname in this chat") &&
    androidGroup.includes("Set group nickname"),
);
check(
  "status route owns its missing system-bar/cutout inset without replacing established shortcut icons",
  status.includes(".statusBarsPadding()") && status.includes(".displayCutoutPadding()"),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
