/**
 * Web forwarding, multi-select and the document reader contract (slice E2).
 *
 * Same discipline as cases 57–59: every rule is compared with the source that
 * owns it — `ChatScreen.kt`'s `forwardMessageTo` / `forwardSelected` /
 * `ForwardDialog` / selection bar for the forward and selection half,
 * `DocViewerScreen.kt` and `Files.kt` for the document reader, `Ui.kt` for the
 * delete-for-everyone predicate and its labels, and `src/worker/index.ts` for
 * what the server will and will not accept.
 *
 * The two rules that hurt if they drift: a forward re-seals the DECRYPTED body
 * for the TARGET's key (forwarding the envelope would hand the new recipient
 * something they cannot open), and nothing at all leaves a private chat or a
 * view-once message.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FORWARD_DIALOG_TITLE,
  FORWARD_FALLBACK_NAME,
  FORWARD_FALLBACK_TYPE,
  REUPLOAD_PHOTO_NAME,
  REUPLOAD_PHOTO_TYPE,
  albumForForward,
  canDeleteForEveryone,
  canForwardRow,
  canForwardSelection,
  canSaveMedia,
  chatLabel,
  deleteAlsoLabel,
  deleteScopeLabel,
  fileLooksImage,
  forwardContextOf,
  forwardFileName,
  forwardFileType,
  forwardMetaOf,
  forwardNotice,
  forwardPickerSubtitle,
  forwardShapeOf,
  forwardTargets,
  isPhotoRow,
  isPrivateConversation,
  selectionCanCopy,
  selectionCanDeleteForEveryone,
  selectionCopyText,
  selectionFacts,
  sentAsDocument,
} from "../../web/src/messaging/forward.ts";
import {
  ARCHIVE_EXTENSIONS,
  EMPTY_TEXT_PREVIEW,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  TEXT_PREVIEW_MAX_BYTES,
  ZIP_SHAPED_NOT_ARCHIVES,
  decodePreviewText,
  displaySize,
  docBadge,
  docExtension,
  docFacts,
  docKindFor,
  docNotice,
  docPreviewKind,
  looksRar,
  looksTiff,
  looksZip,
  mimeFor,
  truncatedNotice,
} from "../../web/src/messaging/docPreview.ts";
import { CAPABILITY_COPY } from "../../web/src/messaging/chatCopy.ts";
import { parseConversationRow, parseMessageRow } from "../../web/src/messaging/protocol.ts";
import { albumId, formatBytes } from "../../web/src/media/uploadContract.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const chatSource = readFileSync(resolve(`${ANDROID}/ChatScreen.kt`), "utf8");
const docSource = readFileSync(resolve(`${ANDROID}/DocViewerScreen.kt`), "utf8");
const filesSource = readFileSync(resolve(`${ANDROID}/Files.kt`), "utf8");
const uiSource = readFileSync(resolve(`${ANDROID}/Ui.kt`), "utf8");
const secureSource = readFileSync(resolve(`${ANDROID}/KpSecure.kt`), "utf8");

/** A real MessageRow, so every check runs against the parsed shape. */
const row = (fields) =>
  parseMessageRow({
    id: "m_1",
    kind: "TEXT",
    body: "hello",
    createdAt: "2026-10-04T09:00:00.000Z",
    ...fields,
  });

/** A real ConversationRow, for the chat-level gates. */
const conv = (fields) =>
  parseConversationRow({ id: "c_1", lastMessageAt: "2026-10-04T09:00:00.000Z", ...fields });

const ME = "u_me";
const plainChat = conv({ other: { id: "u_them", displayName: "Rina", username: "rina" } });
const privatePeerChat = conv({
  other: { id: "u_them", displayName: "Rina", username: "rina", privateProfile: true },
});
const privateGroupChat = conv({ isGroup: true, title: "Secret room", privateGroup: true });
const groupChat = conv({ isGroup: true, title: "Class of 2026" });
const botChat = conv({ other: { id: "kp_ai_bot", displayName: "KuchuPuchu AI" } });
const noSaveChat = conv({
  other: { id: "u_them", displayName: "Rina", username: "rina" },
  peerSave: false,
});

const contextOf = (c) => forwardContextOf(c);
const isOwn = (r) => r.senderId === ME;

/* ------------------------------------------------------- what a chat forbids */

check(
  "the phone's private-chat rule is KpSecure.privatePeer(c) || privateGroup",
  chatSource.includes("val privateChat = KpSecure.privatePeer(c) || privateGroup"),
);
check(
  "privatePeer reads the other member's privateProfile flag",
  secureSource.includes(
    'fun privateUser(u: JSONObject?): Boolean = u?.optBoolean("privateProfile") == true',
  ),
);
check(
  "a private group is private even with no private member in it",
  chatSource.includes('val privateGroup = isGroup && c?.optBoolean("privateGroup") == true'),
);
check(
  "the web reads the same two flags, and only those two",
  isPrivateConversation(privatePeerChat) === true &&
    isPrivateConversation(privateGroupChat) === true &&
    isPrivateConversation(plainChat) === false &&
    isPrivateConversation(groupChat) === false,
);
check(
  "a group with one private member is NOT a private chat",
  isPrivateConversation(
    conv({ isGroup: true, title: "T", other: { id: "u_x", privateProfile: true } }),
  ) === false,
);
check("no conversation at all is not private", isPrivateConversation(null) === false);
check(
  "the chat context carries the OTHER side's save switch, defaulting to allowed",
  contextOf(noSaveChat).peerSave === false &&
    contextOf(plainChat).peerSave === true &&
    contextOf(null).peerSave === true,
);
check(
  "r76-18: a withheld flag means allowed, because the server answers with the effective value",
  conv({ other: { id: "u_them" } }).peerSave === true,
);

/* ----------------------------------------------------------- the forward gates */

/** `localState` is local-only, so an echo is a parsed row with the flag spread on. */
const echo = (fields) => ({ ...row(fields), localState: "pending" });

const gates = [
  ["an echo that is still sending", echo({}), plainChat, true],
  ["a deleted row", row({ kind: "DELETED", body: "" }), plainChat, true],
  ["anything at all in a private 1:1", row({}), privatePeerChat, true],
  ["anything at all in a private group", row({}), privateGroupChat, true],
  ["a view-once row", row({ viewOnce: true, meta: { viewOnce: true } }), plainChat, true],
  [
    "somebody else's media when saving is off",
    row({ kind: "FILE", fileType: "image/png", fileKey: "f/a.png", senderId: "u_them" }),
    noSaveChat,
    false,
  ],
];
for (const [name, r, c, own] of gates) {
  check(
    `${name} cannot be forwarded`,
    canForwardRow(r, contextOf(c), own).allowed === false,
    canForwardRow(r, contextOf(c), own).reason,
  );
}
check(
  "every refusal comes with a sentence a person can act on",
  gates.every(([, r, c, own]) => canForwardRow(r, contextOf(c), own).reason.length > 12),
);
check(
  "the private-chat refusal names the chat, not the message",
  canForwardRow(row({}), contextOf(privatePeerChat), true).reason.toLowerCase().includes("private"),
);
check(
  "the view-once refusal says it is one opening",
  canForwardRow(row({ viewOnce: true }), contextOf(plainChat), true).reason.includes("one opening"),
);
check(
  "the consent refusal names the sender's switch (r71-18)",
  canForwardRow(
    row({ kind: "FILE", fileType: "image/png", fileKey: "f/a.png", senderId: "u_them" }),
    contextOf(noSaveChat),
    false,
  ).reason.includes("sender"),
);
check(
  "r71-18 is the OTHER side's switch: my own media is always mine to forward",
  canForwardRow(
    row({ kind: "FILE", fileType: "image/png", fileKey: "f/a.png", senderId: ME }),
    contextOf(noSaveChat),
    true,
  ).allowed === true,
);
check(
  "and their TEXT is still forwardable when only media saving is off",
  canForwardRow(row({ senderId: "u_them" }), contextOf(noSaveChat), false).allowed === true,
);
check(
  "the phone gates the sheet the same way: no private chat, no view-once in the selection",
  chatSource.includes("if (!privateChat && selectedMessages().none { isViewOnce(it) })"),
);
check(
  "the doc viewer's own sheet adds one more gate: a real fileKey",
  docSource.includes(
    'val canForward = m != null && !privateDoc && m.optText("fileKey").isNotBlank()',
  ),
);
check(
  "an ordinary row in an ordinary chat is forwardable",
  canForwardRow(row({}), contextOf(plainChat), false).allowed === true,
);
check(
  "a whole selection is refused by its worst member, and the reason is that member's",
  canForwardSelection(
    [row({ id: "a" }), row({ id: "b", viewOnce: true, meta: { viewOnce: true } })],
    contextOf(plainChat),
    isOwn,
  ).allowed === false &&
    canForwardSelection(
      [row({ id: "a" }), row({ id: "b", viewOnce: true, meta: { viewOnce: true } })],
      contextOf(plainChat),
      isOwn,
    ).reason.includes("view-once"),
);
check(
  "an empty selection may do nothing at all",
  canForwardSelection([], contextOf(plainChat), isOwn).allowed === false &&
    canForwardSelection([], contextOf(plainChat), isOwn).reason.length > 5,
);
check(
  "a selection of ordinary rows is forwardable",
  canForwardSelection([row({ id: "a" }), row({ id: "b" })], contextOf(plainChat), isOwn).allowed ===
    true,
);
check(
  "the worker independently refuses to hand a foreign view-once file over",
  workerSource.includes('if (foreignOnce) fail(403, "This was sent as view once.", "VIEW_ONCE")'),
);

/* --------------------------------------------------------- the four shapes */

const forwardBody = chatSource.slice(chatSource.indexOf("internal suspend fun forwardMessageTo"));
const branchAt = (needle) => forwardBody.indexOf(needle);
const keyBranch = branchAt("key.isNotBlank() ->");
const dataBranch = branchAt('m.optText("mediaUrl").startsWith("data:")');
const hostBranch = branchAt('m.optText("mediaUrl").isNotBlank()');
const textBranch = branchAt('.put("kind", "TEXT")');
check(
  "the phone tests a stored key first, then a data URL, then a server media URL, then plain text",
  keyBranch > -1 && dataBranch > keyBranch && hostBranch > dataBranch && textBranch > hostBranch,
  `${keyBranch} < ${dataBranch} < ${hostBranch} < ${textBranch}`,
);
check(
  "a stored fileKey is reused, not re-uploaded",
  forwardShapeOf(row({ kind: "FILE", fileKey: "f/a.pdf", fileType: "application/pdf" })) ===
    "fileKey",
);
check(
  "an inline data URL is posted again as an IMAGE",
  forwardShapeOf(row({ kind: "IMAGE", mediaUrl: "data:image/png;base64,AAA", hasImage: true })) ===
    "dataUrl",
);
check(
  "a server-hosted media URL is downloaded and re-uploaded",
  forwardShapeOf(row({ kind: "IMAGE", mediaUrl: "/api/messages/m_1/media", hasImage: true })) ===
    "reupload",
);
check("anything else is a plain text post", forwardShapeOf(row({})) === "text");
check(
  "a fileKey wins over a media URL, exactly as the phone's first branch does",
  forwardShapeOf(
    row({
      kind: "FILE",
      fileKey: "f/a.png",
      fileType: "image/png",
      mediaUrl: "/api/files/f/a.png",
    }),
  ) === "fileKey",
);
check(
  'a nameless file falls back to "File"',
  forwardFileName(row({ kind: "FILE", fileKey: "f/a", fileName: "" })) === FORWARD_FALLBACK_NAME &&
    chatSource.includes('.put("fileName", m.optText("fileName").ifBlank { "File" })'),
  FORWARD_FALLBACK_NAME,
);
check(
  "a typeless file falls back to application/octet-stream",
  forwardFileType(row({ kind: "FILE", fileKey: "f/a", fileType: "" })) === FORWARD_FALLBACK_TYPE &&
    chatSource.includes(
      '.put("fileType", m.optText("fileType").ifBlank { "application/octet-stream" })',
    ),
  FORWARD_FALLBACK_TYPE,
);
check(
  "a declared name and type survive untouched",
  forwardFileName(row({ kind: "FILE", fileName: "brief.pdf" })) === "brief.pdf" &&
    forwardFileType(row({ kind: "FILE", fileType: "application/pdf" })) === "application/pdf",
);
check(
  "the re-upload is called photo.jpg and typed image/jpeg, as the phone hard-codes it",
  REUPLOAD_PHOTO_NAME === "photo.jpg" &&
    REUPLOAD_PHOTO_TYPE === "image/jpeg" &&
    chatSource.includes(
      'Api.upload(m.optText("fileName").ifBlank { "photo.jpg" }, "image/jpeg", bytes)',
    ),
);

/* --------------------------------------------------------------- the meta copy */

const voiceRow = row({
  kind: "FILE",
  fileType: "audio/webm",
  fileKey: "f/v.webm",
  meta: { voice: true, seconds: 12, waveform: [10, 20], clientId: "cid" },
});
check(
  "a forwarded voice note stays a voice note: duration and bars come along (owner round 31 item 27)",
  JSON.stringify(forwardMetaOf(voiceRow)) ===
    JSON.stringify({ voice: true, seconds: 12, waveform: [10, 20] }),
  JSON.stringify(forwardMetaOf(voiceRow)),
);
check(
  "the phone builds that same object, key for key",
  chatSource.includes('JSONObject().put("voice", true).put("seconds", vm.optInt("seconds"))') &&
    chatSource.includes('vm.optJSONArray("waveform")?.let { mm.put("waveform", it) }'),
);
check(
  "a voice note with no recorded bars carries none",
  JSON.stringify(forwardMetaOf(row({ kind: "FILE", meta: { voice: true, seconds: 3 } }))) ===
    JSON.stringify({ voice: true, seconds: 3 }),
);
check(
  "a voice note with no seconds still says it is a voice note",
  forwardMetaOf(row({ kind: "FILE", meta: { voice: true } })).voice === true,
);
check(
  "a document stays a document",
  JSON.stringify(forwardMetaOf(row({ kind: "FILE", meta: { document: true, w: 900 } }))) ===
    JSON.stringify({ document: true }),
  JSON.stringify(forwardMetaOf(row({ kind: "FILE", meta: { document: true, w: 900 } }))),
);
check(
  "the phone's else-branch is the album meta and nothing more",
  chatSource.includes('} else if (vm?.optBoolean("document") == true) {') &&
    chatSource.includes('albumMeta?.let { body.put("meta", it) }'),
);
check(
  "a photo takes the album id when the forward grouped photos",
  JSON.stringify(
    forwardMetaOf(row({ kind: "IMAGE", hasImage: true }), "alb_0123456789abcdef0123"),
  ) === JSON.stringify({ album: "alb_0123456789abcdef0123" }),
);
check(
  "a photo forwarded alone carries no meta at all",
  forwardMetaOf(row({ kind: "IMAGE", hasImage: true })) === undefined,
);
check(
  "nothing else survives: a reply quote, the reactions and the view-once flag belong to the ORIGINAL",
  forwardMetaOf(
    row({ kind: "TEXT", meta: { replyTo: "m_0", viewOnce: true, reactions: { "👍": 2 } } }),
  ) === undefined,
);
check(
  "a text row never takes an album id, even when one is offered",
  forwardMetaOf(row({}), "alb_0123456789abcdef0123") === undefined,
);
check(
  "isPhotoMsg's rule is kind IMAGE, or an image FILE that was not sent as a document",
  isPhotoRow(row({ kind: "IMAGE" })) === true &&
    isPhotoRow(row({ kind: "FILE", fileType: "image/png", fileName: "a.png" })) === true &&
    isPhotoRow(
      row({ kind: "FILE", fileType: "image/png", fileName: "a.png", meta: { document: true } }),
    ) === false &&
    isPhotoRow(row({ kind: "TEXT" })) === false,
);
check(
  "sentAsDocument is the meta.document marker",
  sentAsDocument(row({ meta: { document: true } })) === true &&
    sentAsDocument(row({ meta: {} })) === false,
);
check(
  "fileLooksImage is the type first, then the five extensions the phone lists",
  fileLooksImage(row({ fileType: "image/heic", fileName: "x" })) === true &&
    [".jpg", ".jpeg", ".png", ".webp", ".gif"].every((ext) =>
      fileLooksImage(row({ fileType: "", fileName: `a${ext}` })),
    ) &&
    fileLooksImage(row({ fileType: "", fileName: "a.bmp" })) === false,
);

/* --------------------------------------------------------------- album grouping */

const photos = [
  row({ id: "p1", kind: "IMAGE", hasImage: true }),
  row({ id: "p2", kind: "IMAGE", hasImage: true }),
];
const grouped = albumForForward(photos);
check(
  "two or more photos forwarded together arrive as ONE grouped bubble again (owner round 31 item 29)",
  chatSource.includes("val grouped = items.count { isPhotoMsg(it) } >= 2"),
);
check("the group gets a fresh album id", grouped.length > 0 && grouped.startsWith("alb_"), grouped);
const albumRe = (workerSource.match(/const ALBUM_ID_RE = \/(.*)\/;/) ?? [])[1] ?? "";
check(
  "the id is one the worker will actually keep",
  albumRe.length > 0 && new RegExp(albumRe).test(grouped),
  `/${albumRe}/ vs ${grouped}`,
);
check("a single photo is not grouped", albumForForward([photos[0]]) === "");
check("a text selection is not grouped", albumForForward([row({}), row({ id: "b" })]) === "");
check("a photo and a text is not grouped", albumForForward([photos[0], row({ id: "t" })]) === "");
check(
  "each target chat gets its OWN id, so two chats never share a group",
  albumForForward(photos) !== albumForForward(photos),
);
check(
  "the phone mints one per target inside the target loop",
  /for \(targetConvId in targets\) \{\s*val album = if \(grouped\) newAlbumId\(\) else null/.test(
    chatSource,
  ),
);
check(
  "the web mints ids in the same shape as its own uploads",
  albumId().startsWith("alb_") && albumId().length === grouped.length,
);

/* --------------------------------------------------------------- the re-seal */

check(
  "a keyless target (group, bot, AI) gets the plaintext caption",
  chatSource.includes('if (tConv == null || tConv.optBoolean("isGroup")) ""') &&
    chatSource.includes('else tConv.optJSONObject("other")?.optText("e2eePublicKey").orEmpty()'),
);
check(
  "a keyed solo target gets a fresh envelope for ITS pair",
  chatSource.includes('if (tKey.isNotBlank()) E2eeMsg.sealGlobal(m.optText("body"), tKey)'),
);
check(
  "the ForwardItem pairs the row with the DECRYPTED body it displays, so the seal is of readable text",
  /plaintext/.test(readFileSync(resolve("web/src/messaging/forward.ts"), "utf8")),
);
check(
  "the deliberate divergence is documented in the module: the phone falls back to plaintext, the web refuses",
  chatSource.includes('E2eeMsg.sealGlobal(m.optText("body"), tKey) ?: m.optText("body")'),
);
check(
  "a forwarded message is an ordinary post to the target chat — there is no server-side forward route",
  !/\/api\/messages\/([^/]+)\/forward/.test(workerSource) &&
    chatSource.includes(
      'Api.post(\n                    "/api/conversations/$targetConvId/messages"',
    ),
);
check(
  "each row's failure is swallowed, as runCatching does, so one bad row cannot lose the rest",
  chatSource.includes("runCatching { forwardMessageTo(targetConvId, m, meta) }"),
);

/* -------------------------------------------------------------- the picker UI */

check(
  "the picker's title is the phone's default",
  FORWARD_DIALOG_TITLE === "Forward to" && chatSource.includes('title: String = "Forward to"'),
);
check(
  'the subtitle reads "<n> chats" until something is ticked, then "<n> selected"',
  forwardPickerSubtitle(0, 12) === "12 chats" &&
    forwardPickerSubtitle(3, 12) === "3 selected" &&
    chatSource.includes(
      'if (picked.isEmpty()) "${convs.size} chats" else "${picked.size} selected"',
    ),
  `${forwardPickerSubtitle(0, 12)} / ${forwardPickerSubtitle(3, 12)}`,
);
check(
  "the picker lists the WHOLE conversation list — this chat included, as the phone does",
  forwardTargets([plainChat, groupChat]).length === 2 && forwardTargets([]).length === 0,
);
check(
  "a refusal names the chat it came from",
  chatLabel(plainChat, "this chat") === "Rina" &&
    chatLabel(groupChat, "this chat") === "Class of 2026" &&
    chatLabel(null, "this chat") === "this chat",
  chatLabel(plainChat, "this chat"),
);
check(
  "the finished forward announces what actually happened, per chat",
  forwardNotice([row({}), row({ id: "b" })], ["c_1"]) === "Forwarded 2 messages to 1 chat." &&
    forwardNotice([row({})], ["c_1", "c_2"]) === "Forwarded 1 message to 2 chats.",
  forwardNotice([row({}), row({ id: "b" })], ["c_1"]),
);
check(
  "nothing forwarded reads as nothing forwarded",
  forwardNotice([], ["c_1"]) === "Nothing was forwarded." &&
    forwardNotice([row({})], []) === "Nothing was forwarded.",
);

/* --------------------------------------------------------- the selection bar */

check(
  "the phone's bar is back, count, Copy (texts), Forward, Edit (single, own, in window), ONE Delete",
  chatSource.includes("if (selected.isNotEmpty()) {") &&
    chatSource.includes('Icon(Icons.Filled.ContentCopy, "Copy"') &&
    chatSource.includes('Icon(Icons.AutoMirrored.Filled.Send, "Forward"') &&
    chatSource.includes('Icon(Icons.Filled.Edit, "Edit"') &&
    chatSource.includes('Icon(Icons.Filled.Delete, "Delete"'),
);
check(
  "r68-8: one Delete for the whole selection, and the popup asks the scope",
  chatSource.includes("// r68-8: one Delete for the whole selection (single or many,"),
);
const bodies = { a: "first line", b: "second line", c: "" };
const textRows = [
  row({ id: "a", senderId: ME }),
  row({ id: "b", senderId: ME }),
  row({ id: "c", senderId: ME }),
];
check(
  "Copy joins every selected TEXT row's body with a newline",
  chatSource.includes(
    '.filter { it.optString("kind") == "TEXT" }\n                            .joinToString("\\n")',
  ),
);
check(
  "the joined text is the DECRYPTED bodies, not the sealed envelopes",
  selectionCopyText(textRows, bodies) === "first line\nsecond line",
  JSON.stringify(selectionCopyText(textRows, bodies)),
);
check(
  "an empty body never adds a blank line to the clipboard",
  selectionCopyText(textRows, bodies).split("\n").length === 2,
);
check(
  "a selection with no text at all offers no Copy",
  selectionCanCopy([row({ id: "p", kind: "IMAGE", hasImage: true })], {}) === false &&
    chatSource.includes('it.optString("kind") == "TEXT" && it.optText("body").isNotBlank()'),
);
const facts = selectionFacts(textRows, bodies, contextOf(plainChat), {
  isOwn: () => true,
  canEditRow: (r) => r.id === "a",
});
check("the bar counts the selection", facts.count === 3, String(facts.count));
check("the bar knows the selection can be copied", facts.canCopy === true);
check(
  "the bar knows the selection can be forwarded",
  facts.canForward === true && facts.forwardReason === "",
);
check("the bar reports every row as own", facts.allOwn === true);
check("the bar reports no echo in flight", facts.anyEcho === false);
check(
  "Edit is offered only for a SINGLE row the caller says is editable",
  facts.canEdit === false &&
    selectionFacts([textRows[0]], bodies, contextOf(plainChat), {
      isOwn: () => true,
      canEditRow: () => true,
    }).canEdit === true,
);
check(
  "the phone's canEdit is own + TEXT + no media + inside a 60 second window",
  /fun canEdit\(m: JSONObject\): Boolean =\s*m\.optString\("senderId"\) == Store\.myId\(\) &&\s*m\.optString\("kind"\) == "TEXT" &&\s*m\.optString\("mediaUrl"\)\.isBlank\(\)/.test(
    chatSource,
  ) && chatSource.includes(".seconds < 60"),
);
check(
  "Unsend is offered for one own row the server already has",
  selectionFacts([row({ senderId: ME })], {}, contextOf(plainChat), {
    isOwn,
    canEditRow: () => false,
  }).canUnsend === true &&
    selectionFacts([echo({ senderId: ME })], {}, contextOf(plainChat), {
      isOwn,
      canEditRow: () => false,
    }).canUnsend === false &&
    selectionFacts(
      [row({ senderId: ME }), row({ id: "b", senderId: ME })],
      {},
      contextOf(plainChat),
      { isOwn, canEditRow: () => false },
    ).canUnsend === false,
);
check(
  "an empty selection can do nothing",
  (() => {
    const empty = selectionFacts([], {}, contextOf(plainChat), { isOwn, canEditRow: () => false });
    return (
      empty.count === 0 &&
      empty.canCopy === false &&
      empty.canForward === false &&
      empty.canEdit === false &&
      empty.canUnsend === false &&
      empty.allOwn === false
    );
  })(),
);
check(
  "a selection in a private chat reports the reason on the bar itself",
  selectionFacts([row({})], {}, contextOf(privatePeerChat), { isOwn, canEditRow: () => false })
    .forwardReason.length > 10,
);

/* ----------------------------------------------------- delete for everyone */

check(
  "Ui.kt's predicate: no echo, own always, group never, 1:1 only with a real person",
  uiSource.includes("if (m == null || isEchoMsg(m)) return false") &&
    uiSource.includes('if (m.optString("senderId") == Store.myId()) return true') &&
    uiSource.includes('if (c.optBoolean("isGroup")) return false') &&
    uiSource.includes("return otherId.isNotBlank() && !isKpBot(otherId)"),
);
check(
  "an echo has no server row to delete",
  canDeleteForEveryone(echo({ senderId: ME }), plainChat, true) === false &&
    canDeleteForEveryone({ ...row({ senderId: ME }), localState: "failed" }, plainChat, true) ===
      false,
);
check(
  "my own message was always deletable for everyone, in any chat",
  canDeleteForEveryone(row({ senderId: ME }), plainChat, true) === true &&
    canDeleteForEveryone(row({ senderId: ME }), groupChat, true) === true &&
    canDeleteForEveryone(row({ senderId: ME }), botChat, true) === true,
);
check(
  "somebody else's message is deletable for everyone in a 1:1 with a real person",
  canDeleteForEveryone(row({ senderId: "u_them" }), plainChat, false) === true,
);
check(
  'never in a group — the group rule stays "your own messages only"',
  canDeleteForEveryone(row({ senderId: "u_them" }), groupChat, false) === false,
);
check(
  "and never for the two bot accounts",
  canDeleteForEveryone(row({ senderId: "kp_ai_bot" }), botChat, false) === false &&
    canDeleteForEveryone(
      row({ senderId: "kp_official_bot" }),
      conv({ other: { id: "kp_official_bot" } }),
      false,
    ) === false,
);
check(
  "no conversation, no other side to delete for",
  canDeleteForEveryone(row({ senderId: "u_them" }), null, false) === false,
);
check(
  "a chat with no other id at all refuses",
  canDeleteForEveryone(row({ senderId: "u_them" }), conv({}), false) === false,
);
check(
  'the scope label is the other member\'s display name, then their username, then "everyone"',
  deleteScopeLabel(plainChat) === "Rina" &&
    deleteScopeLabel(conv({ other: { id: "u_x", username: "onlyhandle" } })) === "onlyhandle" &&
    deleteScopeLabel(conv({ other: { id: "u_x" } })) === "everyone" &&
    deleteScopeLabel(groupChat) === "everyone" &&
    deleteScopeLabel(null) === "everyone",
  deleteScopeLabel(plainChat),
);
check(
  "deleteOtherLabel prefers displayName then username then everyone",
  uiSource.includes(
    'val name = other?.optText("displayName").orEmpty().ifBlank { other?.optText("username").orEmpty() }',
  ) && uiSource.includes('return name.ifBlank { "everyone" }'),
);
check(
  'the checkbox reads "Also delete for <name>"',
  deleteAlsoLabel(plainChat) === "Also delete for Rina" &&
    uiSource.includes('"Also delete for $it"'),
  deleteAlsoLabel(plainChat),
);
check(
  "a group never offers the other side, so the label stays generic",
  deleteAlsoLabel(groupChat) === "Also delete for everyone",
);
check(
  "the whole selection may go for everyone only when EVERY row may",
  selectionCanDeleteForEveryone(
    [row({ id: "a", senderId: ME }), row({ id: "b", senderId: ME })],
    plainChat,
    isOwn,
  ) === true &&
    selectionCanDeleteForEveryone(
      [row({ id: "a", senderId: ME }), row({ id: "b", senderId: "u_them" })],
      groupChat,
      isOwn,
    ) === false &&
    selectionCanDeleteForEveryone([], plainChat, isOwn) === false,
);
check(
  "the server route that performs it is DELETE /api/messages/:id",
  chatSource.includes('Api.delete("/api/messages/$id")') &&
    /\/api\\\/messages\\\/\(\[\^\/\]\+\)\$/.test(workerSource),
);
check(
  "the phone's delete-for-me hides the row in its own store",
  chatSource.includes("ids.forEach { id -> ScreenStore.hideMessage(it) }") ||
    chatSource.includes("ScreenStore.hideMessage(it)"),
);
check(
  "a browser has no local message store, so the web hide is in-memory for the session",
  !/DELETE FROM messages WHERE.*hidden/i.test(workerSource),
);
check(
  "and the UI says so rather than implying the row is gone",
  CAPABILITY_COPY.stillPending.length > 0 &&
    readFileSync(resolve("web/src/messaging/useMessaging.ts"), "utf8").includes("hiddenMessageIds"),
);
check(
  "the worker's per-chat hide route is a watermark for the WHOLE chat, not a per-message delete",
  /\/api\\\/conversations\\\/\(\[\^\/\]\+\)\\\/hide\$/.test(workerSource),
);

/* ------------------------------------------------------- the document reader */

check(
  "the phone reads the first 400 000 bytes of a text document",
  /val bytes = ByteArray\((\d+_?\d*)\)/.test(docSource) &&
    Number(docSource.match(/val bytes = ByteArray\((\d+_?\d*)\)/)?.[1]?.replace(/_/g, "")) ===
      TEXT_PREVIEW_MAX_BYTES,
  String(TEXT_PREVIEW_MAX_BYTES),
);
check(
  "the cap is applied to BYTES before the UTF-8 decode, so emoji cannot quadruple the budget",
  decodePreviewText(new Uint8Array(TEXT_PREVIEW_MAX_BYTES + 10).fill(0x41)).truncated === true &&
    decodePreviewText(new Uint8Array(TEXT_PREVIEW_MAX_BYTES).fill(0x41)).truncated === false,
);
check(
  "a four-byte emoji document is cut at the same byte count",
  decodePreviewText(new Uint8Array(TEXT_PREVIEW_MAX_BYTES + 4).fill(0xf0)).text.length <=
    TEXT_PREVIEW_MAX_BYTES,
);
check(
  "the truncation line is the phone's own sentence",
  truncatedNotice(2_500_000) === "\n\n… (2.4 MB in total)" &&
    docSource.includes('"\\n\\n… (${FilesUtil.displaySize(file.length().toInt())} in total)"'),
  JSON.stringify(truncatedNotice(2_500_000)),
);
check(
  "an empty file reads as the phone's placeholder",
  decodePreviewText(new Uint8Array(0)).text === EMPTY_TEXT_PREVIEW &&
    docSource.includes('text.ifBlank { "(empty file)" }') &&
    EMPTY_TEXT_PREVIEW === "(empty file)",
);
check(
  "a short text is neither truncated nor replaced",
  decodePreviewText(new TextEncoder().encode("hello")).text === "hello" &&
    decodePreviewText(new TextEncoder().encode("hello")).truncated === false,
);
check(
  "undecodable bytes fall back to the placeholder instead of throwing",
  decodePreviewText(new Uint8Array([0xff, 0xfe, 0x00])).text.length > 0,
);

const kindOrder = [
  ["brief.pdf", "application/pdf", null, "pdf"],
  ["brief", "application/pdf", null, "pdf"],
  ["logo.svg", "image/svg+xml", null, "svg"],
  ["scan.tif", "image/tiff", null, "tiff"],
  ["photo.heic", "", null, "image"],
  ["photo", "image/png", null, "image"],
  ["bundle.zip", "", new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "archive"],
  ["old.rar", "", new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), "archive"],
  ["notes.txt", "text/plain", null, "text"],
  ["data", "application/json", null, "text"],
  ["clip.mp4", "video/mp4", null, "video"],
  ["song.mp3", "audio/mpeg", null, "audio"],
  ["mystery.bin", "application/octet-stream", null, "other"],
];
for (const [name, mime, bytes, expected] of kindOrder) {
  check(
    `docKind calls ${name || mime} "${expected}"`,
    docKindFor(name, mime, bytes) === expected,
    docKindFor(name, mime, bytes),
  );
}
check(
  "the phone's docKind tests the branches in exactly this order",
  /mime == "application\/pdf" \|\| ext == "pdf" -> DocKind\.PDF[\s\S]{0,200}?ext == "svg"[\s\S]{0,200}?DocKind\.TIFF[\s\S]{0,300}?DocKind\.IMAGE[\s\S]{0,400}?DocKind\.ARCHIVE[\s\S]{0,600}?DocKind\.TEXT[\s\S]{0,100}?else -> DocKind\.OTHER/.test(
    docSource,
  ),
);
check(
  "a ZIP-shaped Office document is NOT an archive — listing its entries would be nonsense",
  docKindFor("paper.docx", "", new Uint8Array([0x50, 0x4b, 0x03, 0x04])) === "other" &&
    docSource.includes(
      'ArchiveList.looksZip(f) && ext !in setOf("docx", "xlsx", "pptx", "apk", "jar", "odt", "ods", "odp", "epub")',
    ),
);
check(
  "the nine ZIP-shaped exceptions are the phone's nine",
  JSON.stringify([...ZIP_SHAPED_NOT_ARCHIVES]) ===
    JSON.stringify(["docx", "xlsx", "pptx", "apk", "jar", "odt", "ods", "odp", "epub"]),
  ZIP_SHAPED_NOT_ARCHIVES.join(","),
);
check(
  "an .svg is markup that must not be drawn, even though it is an image type",
  docKindFor("logo.svg", "image/svg+xml") === "svg",
);
check(
  "the text extension set is the phone's set, extension for extension",
  JSON.stringify([...TEXT_EXTENSIONS]) ===
    JSON.stringify([
      "txt",
      "md",
      "json",
      "csv",
      "log",
      "kt",
      "js",
      "ts",
      "py",
      "html",
      "css",
      "xml",
      "yml",
      "yaml",
      "ini",
      "sh",
      "java",
      "c",
      "cpp",
      "h",
      "sql",
      "srt",
      "vtt",
    ]),
  String(TEXT_EXTENSIONS.length),
);
check(
  "the image extension set is the phone's set",
  JSON.stringify([...IMAGE_EXTENSIONS]) ===
    JSON.stringify(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"]),
);
check(
  "the archive extensions are zip and rar",
  JSON.stringify([...ARCHIVE_EXTENSIONS]) === JSON.stringify(["zip", "rar"]),
);
check(
  "a clip or an audio file SENT AS A DOCUMENT is named here, though the phone folds it into OTHER",
  docKindFor("clip.mp4", "video/mp4") === "video" &&
    docKindFor("song.mp3", "audio/mpeg") === "audio",
);
check(
  "the phone's docKind has no video or audio branch at all — its card hands those to the system",
  !/DocKind\.(VIDEO|AUDIO)/.test(docSource) && docSource.includes("else -> DocKind.OTHER"),
);
check(
  "and its notice says what each client does with it",
  docNotice("video", null).includes("system player"),
  docNotice("video", null),
);
check(
  "the phone's docPreviewKind names HTML and Markdown only",
  docSource.includes("private enum class PreviewKind { HTML, MARKDOWN }"),
);
check(
  "html / htm / xhtml and the two html mimes are the html preview",
  ["a.html", "a.htm", "a.xhtml"].every((n) => docPreviewKind(n, "") === "html") &&
    docPreviewKind("page", "text/html") === "html" &&
    docPreviewKind("page", "application/xhtml+xml") === "html",
);
check(
  "md / markdown / mdown and text/markdown are the markdown preview",
  ["a.md", "a.markdown", "a.mdown"].every((n) => docPreviewKind(n, "") === "markdown") &&
    docPreviewKind("notes", "text/markdown") === "markdown",
);
check("anything else has no rendered preview", docPreviewKind("a.pdf", "application/pdf") === null);
check(
  "HTML is shown as SOURCE and never rendered here, and the notice says why",
  docNotice("text", "html").includes("never rendered") &&
    docNotice("text", "html").includes("WebView"),
);
check(
  "Markdown is shown as source too, and says the phone renders it",
  docNotice("text", "markdown").includes("source") &&
    docNotice("text", "markdown").includes("phone renders"),
);
check("SVG is never drawn, and says so", docNotice("svg", null).includes("never drawn"));
check("a PDF is handed to the browser's own viewer", docNotice("pdf", null).includes("browser"));
check(
  "a TIFF is download-only, and says no browser can decode it",
  docNotice("tiff", null).includes("No browser"),
);
check(
  "an archive is download-only, and says the phone lists its contents",
  docNotice("archive", null).includes("download-only"),
);
check(
  "the text notice quotes the real cap in KB",
  docNotice("text", null).includes(`${Math.round(TEXT_PREVIEW_MAX_BYTES / 1000)} KB`),
  docNotice("text", null),
);
check("an image needs no notice", docNotice("image", null) === "");
check(
  "the fallback notice points at the device's own apps, as 'Open with' does",
  docNotice("other", null).includes("Open with"),
);

check(
  "the zip signature is the three local-file / central-directory marks",
  looksZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04])) === true &&
    looksZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06])) === true &&
    looksZip(new Uint8Array([0x50, 0x4b, 0x07, 0x08])) === true &&
    looksZip(new Uint8Array([0x50, 0x4b, 0x00, 0x00])) === false &&
    looksZip(new Uint8Array([0x50, 0x4b])) === false,
);
check(
  "RAR 4 and RAR 5 both start Rar!\\x1a\\x07",
  looksRar(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) === true &&
    looksRar(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01])) === true &&
    looksRar(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x02])) === false,
);
check(
  "a TIFF is recognised in both byte orders",
  looksTiff(new Uint8Array([0x49, 0x49, 0x2a, 0x00])) === true &&
    looksTiff(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])) === true &&
    looksTiff(new Uint8Array([0x49, 0x49, 0x00, 0x00])) === false,
);
check(
  "magic bytes beat a lying name: an unnamed TIFF is still a TIFF",
  docKindFor("mystery", "", new Uint8Array([0x49, 0x49, 0x2a, 0x00])) === "tiff",
);
check(
  'the extension is the lower-case tail after the last dot, "" when there is none',
  docExtension("Report.PDF") === "pdf" &&
    docExtension("archive.tar.gz") === "gz" &&
    docExtension("README") === "" &&
    docExtension("") === "",
);

/* ----------------------------------------------------------- mime and size */

check(
  "the declared type wins unless it is one of the two generic ones",
  mimeFor("a.bin", "text/csv") === "text/csv" &&
    mimeFor("a.csv", "application/octet-stream") === "text/csv" &&
    mimeFor("a.csv", "application/binary") === "text/csv" &&
    filesSource.includes('!declared.equals("application/octet-stream", true)'),
);
check(
  "a blank declared type falls through to the extension table",
  mimeFor("a.pdf", "") === "application/pdf" &&
    mimeFor("a.docx", "") ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);
check(
  "the audio extensions map the way the phone maps them",
  mimeFor("a.mp3", "") === "audio/mpeg" &&
    mimeFor("a.m4a", "") === "audio/mp4" &&
    mimeFor("a.aac", "") === "audio/mp4" &&
    mimeFor("a.wav", "") === "audio/x-wav" &&
    mimeFor("a.ogg", "") === "audio/ogg",
);
check(
  "the video extensions map the way the phone maps them",
  mimeFor("a.mp4", "") === "video/mp4" &&
    mimeFor("a.mov", "") === "video/mp4" &&
    mimeFor("a.mkv", "") === "video/x-matroska",
);
check(
  "an unknown extension keeps the declared type, or */* when there was none",
  mimeFor("a.xyz", "") === "*/*" && mimeFor("a.xyz", "application/xyz") === "application/xyz",
);
check(
  "displaySize never says GB — a 2 GB clip reads 2048.0 MB on the phone",
  displaySize(2 * 1024 * 1024 * 1024) === "2048.0 MB" &&
    filesSource.includes('bytes >= 1_048_576 -> String.format("%.1f MB", bytes / 1_048_576.0)'),
  displaySize(2 * 1024 * 1024 * 1024),
);
check(
  "kilobytes are whole and bytes are bytes",
  displaySize(1536) === "1 KB" && displaySize(999) === "999 B" && displaySize(0) === "0 B",
);
check(
  "a negative or broken size reads as zero rather than as nonsense",
  displaySize(-5) === "0 B" && displaySize(Number.NaN) === "0 B",
);
check(
  "the two size readers agree on every exact multiple below a gigabyte",
  [512, 1024, 2048, 1024 * 1024, 10 * 1024 * 1024, 100 * 1024 * 1024, 1023 * 1024 * 1024].every(
    (size) => displaySize(size) === formatBytes(size),
  ),
  [displaySize(10 * 1024 * 1024), formatBytes(10 * 1024 * 1024)].join(" / "),
);
check(
  "where they differ, they differ the way the two sources do: the phone TRUNCATES a kilobyte count, the composer rounds it",
  displaySize(1536) === "1 KB" &&
    formatBytes(1536) === "2 KB" &&
    filesSource.includes("bytes / 1024"),
  `${displaySize(1536)} vs ${formatBytes(1536)}`,
);
check(
  "and above a gigabyte only the composer says GB — the reader keeps the phone's MB",
  displaySize(3 * 1024 * 1024 * 1024) === "3072.0 MB" &&
    formatBytes(3 * 1024 * 1024 * 1024) === "3.00 GB",
  `${displaySize(3 * 1024 * 1024 * 1024)} vs ${formatBytes(3 * 1024 * 1024 * 1024)}`,
);
check(
  "the badge is the extension in capitals, and blank when it would not fit",
  docBadge("report.pdf") === "PDF" &&
    docBadge("archive.tar.gz") === "GZ" &&
    docBadge("verylongextensionname") === "" &&
    docBadge("README") === "",
);
check(
  "the card's second line is type · size, dropping a generic type",
  docFacts("application/pdf", 2048) === "application/pdf · 2 KB" &&
    docFacts("application/octet-stream", 2048) === "2 KB" &&
    docFacts("", 0) === "",
  docFacts("application/pdf", 2048),
);
check(
  "the reader's Save obeys the same consent gate as the viewer's",
  canSaveMedia(
    row({ kind: "FILE", fileKey: "f/a.pdf", fileType: "application/pdf", senderId: "u_them" }),
    contextOf(noSaveChat),
    false,
  ) === false &&
    canSaveMedia(
      row({ kind: "FILE", fileKey: "f/a.pdf", fileType: "application/pdf", senderId: ME }),
      contextOf(noSaveChat),
      true,
    ) === true &&
    canSaveMedia(row({ kind: "TEXT", senderId: "u_them" }), contextOf(noSaveChat), false) === true,
);
check(
  "the phone's doc sheet gates Save the same way: owner, or a non-private chat that allows saving",
  docSource.includes(
    "if ((KpSecure.amOwner() || (!privateDoc && !noSaveDoc)) && !saved && state == 1)",
  ),
);

/* ------------------------------------------------------------- the disclosed copy */

check(
  "the capability line promises documents, multi-select and forwarding — and nothing it cannot do",
  ["documents", "multi-select", "forwarding"].every((word) =>
    CAPABILITY_COPY.stillPending.includes(word),
  ),
);
check(
  "the document notice names the browser's own PDF viewer",
  CAPABILITY_COPY.documentPreviewNotice.includes("PDF"),
);
check(
  "the document notice quotes the real text cap",
  CAPABILITY_COPY.documentPreviewNotice.includes(`${Math.round(TEXT_PREVIEW_MAX_BYTES / 1000)} KB`),
);
check(
  "the document notice says HTML, SVG and Markdown are shown as source",
  ["HTML", "SVG", "Markdown"].every((word) => CAPABILITY_COPY.documentPreviewNotice.includes(word)),
);
check(
  "the document notice says a TIFF and an archive are download-only",
  /TIFF/i.test(CAPABILITY_COPY.documentPreviewNotice) &&
    /download/i.test(CAPABILITY_COPY.documentPreviewNotice),
);
check(
  "the forwarding notice says a stored key is reused and a photo is re-uploaded",
  CAPABILITY_COPY.forwardingNotice.includes("key") &&
    /re-upload|upload/i.test(CAPABILITY_COPY.forwardingNotice),
);
check(
  "the forwarding notice says a caption is re-sealed for the new chat",
  /seal/i.test(CAPABILITY_COPY.forwardingNotice),
);
check(
  "the forwarding notice says nothing leaves a private chat",
  /private/i.test(CAPABILITY_COPY.forwardingNotice),
);
check(
  "the forwarding notice says a view-once message is still one opening",
  /view once|view-once/i.test(CAPABILITY_COPY.forwardingNotice),
);
check(
  "media is still not claimed to be encrypted end to end",
  /not (encrypted|end-to-end)/i.test(CAPABILITY_COPY.mediaNotEncrypted),
);

console.log(lines.join("\n"));
