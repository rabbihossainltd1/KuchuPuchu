import { readFileSync } from "node:fs";
import {
  commandDraft,
  commandSuggestions,
  parseMessageCommand,
} from "../../web/src/messaging/messageCommands.ts";
import { parseMessageText, stripBoldMarkers } from "../../web/src/messaging/messageText.ts";
import { conversationPreviewText } from "../../web/src/messaging/protocol.ts";
import {
  activeMentionQuery,
  insertMention,
  matchingMentionCandidates,
} from "../../web/src/messaging/messageMentions.ts";

const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );
const read = (path) => readFileSync(path, "utf8");

const worker = read("src/worker/index.ts");
const androidChat = read("native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt");
const androidPush = read("native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt");
const androidNotify = read("native-android/app/src/main/java/app/kuchupuchu/android/KpNotify.kt");
const androidPreview = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
);
const androidChatPreview = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ChatPreviewText.kt",
);
const androidMentions = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ComposerMentions.kt",
);
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
const androidNicknameSheet = read(
  "native-android/app/src/main/java/app/kuchupuchu/android/ConversationNicknamesSheet.kt",
);
const webPush = read("web/src/push/pushModel.ts");
const webServiceWorker = read("web/service-worker.template.js");
const webCommands = read("web/src/messaging/ChatPane.tsx");
const webMessaging = read("web/src/messaging/useMessaging.ts");
const webInfo = read("web/src/messaging/InfoPane.tsx");
const webMenu = read("web/src/messaging/ChatMenu.tsx");
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
const androidComposerSource = androidChat.slice(
  androidChat.indexOf("val commandOptions = ComposerCommands.suggestions(input)"),
  androidChat.indexOf(
    "        Row(\n            Modifier\n                .fillMaxWidth()\n                // Owner round 15: the bar itself is TRANSPARENT",
  ),
);
check(
  "slash suggestions are one-per-row on Web and Android",
  webCss.includes(".composer-command-suggestions,") &&
    webCss.includes("grid-template-columns: minmax(0, 1fr)") &&
    androidComposerSource.includes("commandOptions.forEach") &&
    !androidComposerSource.includes("horizontalScroll"),
);
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
const boldPreview = conversationPreviewText({
  lastMessage: "",
  preview: { category: "message", body: "*example**", viewOnce: false },
});
check(
  "Web conversation preview strips balanced and mismatched bold markers",
  boldPreview === "example",
);
const directText = parseMessageText("Hi **@rahi** and a@b.com; https://example.com/@linked", true);
const groupText = parseMessageText("Hi @rahi", true);
const mentionCandidates = [
  { id: "1", displayName: "Rahi Ahmed", username: "rahi" },
  { id: "2", displayName: "Mina Akter", username: "mina" },
  { id: "3", displayName: "Rabiul", username: "rabiul" },
];
const activeMention = activeMentionQuery("hello @ra");
check(
  "@ opens matching people, filters as the username is typed, and selection inserts the full mention",
  activeMention?.query === "ra" &&
    activeMentionQuery("mail@rahi") === null &&
    matchingMentionCandidates(activeMention.query, mentionCandidates)
      .map((user) => user.username)
      .join(",") === "rahi,rabiul" &&
    insertMention("hello @ra", "rahi")?.value === "hello @rahi ",
);
check(
  "single and double asterisks become bold spans without visible markers",
  stripBoldMarkers(marked) === "plain single and double" &&
    parseMessageText(marked)
      .filter((part) => part.bold)
      .map((part) => part.text)
      .join("|") === "single|double" &&
    stripBoldMarkers("*example**") === "example" &&
    parseMessageText("**example*").some((part) => part.bold && part.text === "example"),
);
check(
  "@username is clickable in direct and group message text, while email and URL lookalikes stay plain",
  directText.some((part) => part.text === "@rahi" && part.bold && part.mention === "rahi") &&
    directText.every((part) => part.mention !== "b" && part.mention !== "linked") &&
    groupText.some((part) => part.text === "@rahi" && part.mention === "rahi"),
);
check(
  "the Web command suggestions, cleaned send body, formatting and mention click are wired to the composer and bubbles",
  webCommands.includes("commandSuggestions(controller.draft)") &&
    webCommands.includes("activeMentionQuery(controller.draft, composerCaret)") &&
    webCommands.includes("matchingMentionCandidates(mentionQuery.query, mentionCandidates)") &&
    webCommands.includes("insertMention(") &&
    webCommands.includes("parseMessageText(body, !isPlaceholder)") &&
    androidChat.includes("allowMentions = true") &&
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
  "Android mention suggestions follow @typing, filter group/direct peers, and insert a complete username",
  androidChat.includes("ComposerMentions.forConversation(c, Store.myId())") &&
    androidChat.includes("ComposerMentions.suggestions(it.query, mentionCandidates)") &&
    androidChat.includes("ComposerMentions.insert(input, mention)") &&
    androidMentions.includes('val username = user.optText("username")') &&
    androidMentions.includes("id == meId"),
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
    webCommands.includes("stripBoldMarkers(selection.copyText)") &&
    androidPush.includes("MessageMarkup.notification(cardText)") &&
    androidNotify.includes("val body: CharSequence") &&
    androidPreview.includes("MessageMarkup.plain(raw).trim()") &&
    androidChatPreview.includes("MessageMarkup.plain(plain)"),
);
check(
  "mention taps open a chat from normal and optimistic Android rows and Web group/direct message rows",
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
    ) &&
    androidPush.includes("mentioned = mentioned,") &&
    androidNotify.includes('if (mentioned) "$from mentioned you" else from') &&
    worker.includes('...(kind === "kp.msg" && mentioned ? { m: 1 } : {})') &&
    webPush.includes("Someone mentioned you in a group — open the app to check.") &&
    webServiceWorker.includes("payload.m === 1") &&
    webServiceWorker.includes("data: { t: kind }"),
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
  "magic sends move only the text itself on Android and Web, leaving the bubble frame still",
  androidMagic.includes("fun magicMessageTextModifier") &&
    androidMagic.includes("translationY =") &&
    androidChat.includes("magicMessageTextModifier(") &&
    webCommands.includes('message.meta.magic === true ? " bubble__body--magic"') &&
    webCss.includes("@keyframes message-magic-text") &&
    webCss.includes("transform: translateY(-3px)") &&
    !webCss.includes("@keyframes message-magic-glow"),
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
  "scheduled sends also strip slash syntax and preserve command metadata",
  androidChat.includes("val command = ComposerCommands.parse(body)") &&
    webMessaging.includes("const command = parseMessageCommand(composerText)") &&
    webMessaging.includes("...(command ? { meta: { ...command.meta } } : {})"),
);
check(
  "conversation-scoped nicknames live in the Profile / Group Info ⋮ menu, never conversation options",
  worker.includes("conversation_nicknames") &&
    worker.includes('method === "PUT" || method === "DELETE"') &&
    !webMenu.includes('row("pencil", "Nicknames"') &&
    webInfo.includes('aria-label="More profile options"') &&
    webInfo.includes('role="menuitem"') &&
    webInfo.includes("messagingApi.setNickname(") &&
    webCss.includes(".info-pane__nickname-field input") &&
    webCss.includes("width: 100%") &&
    !androidChat.includes('KpSheetRow(Icons.Filled.Edit, "Nicknames")') &&
    androidProfile.includes('KpSheetRow(Icons.Filled.Edit, "Nickname")') &&
    androidGroup.includes('KpSheetRow(Icons.Filled.Edit, "Nicknames")') &&
    androidNicknameSheet.includes("heightIn(min = 54.dp)") &&
    androidNicknameSheet.includes('Api.put(path, JSONObject().put("nickname", value))'),
);
check(
  "composer bold formatting previews before send, with the same marker-free rendering on Android and Web",
  androidChat.includes("MessageMarkup.formatted(inputState.text.toString())") &&
    androidChat.includes("outputTransformation = boldOutputTransformation") &&
    androidMarkup.includes("fun boldDelimiterRanges(value: String): List<IntRange>") &&
    webCommands.includes('className="composer__format-preview"') &&
    webCommands.includes("parseMessageText(controller.draft)") &&
    webCss.includes(".composer__input--format-overlay"),
);
check(
  "status route owns its missing system-bar/cutout inset without replacing established shortcut icons",
  status.includes(".statusBarsPadding()") && status.includes(".displayCutoutPadding()"),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);
