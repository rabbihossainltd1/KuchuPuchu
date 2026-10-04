/**
 * Selection actions and forwarding — the rules, ported from the phone.
 *
 * `ChatScreen.kt` decides what a selection may do (`forwardSelected`,
 * `forwardMessageTo`, the long-press sheet's gates, the selection bar's icons),
 * and every one of those decisions is a rule about the ROW and the CHAT, not
 * about Compose. So they live here, DOM-free, where a contract case can pin
 * them against the Kotlin source.
 *
 * The four gates on a forward, in the phone's own order:
 *
 *   1. an optimistic echo has no server row to copy yet (`!echo`);
 *   2. nothing may be forwarded out of a private chat — a private PROFILE's 1:1
 *      or a private GROUP (owner round 31 item 21);
 *   3. a view-once message is one opening, not a reference (owner round 32
 *      item 17);
 *   4. the sender's own "Media Save permission" (r71-18): when they turned it
 *      off, their media may be read here but not kept — which is what makes the
 *      privacy note "save and forward follow the sender's consent" a rule
 *      instead of a sentence.
 *
 * What a forward actually posts is `forwardMessageTo`: a row that carries a
 * `fileKey` re-uses that key (the worker allows a key to be referenced by more
 * than one row — that is what forwarding a file *is*), a `data:` row posts its
 * inline bytes again, a server-hosted IMAGE row is downloaded and re-uploaded
 * so both chats own their own copy, and anything else is a TEXT post. Two or
 * more photos forwarded together get ONE fresh album id per target chat, so
 * each chat owns its own group.
 */

import {
  conversationTitle,
  isBotConversation,
  type ConversationRow,
  type MessageRow,
} from "./protocol";
import { albumId } from "../media/uploadContract";
import { isViewOnce } from "./viewOnce";

/**
 * A row to copy into another chat, paired with the plaintext its bubble
 * displays. The pairing matters: in a personal chat the row's own `body` is a
 * sealed `KP1.` envelope, and a forward has to re-seal the DECRYPTED text for
 * the target's key — forwarding the envelope would hand the new recipient
 * something they cannot open.
 */
export type ForwardItem = { readonly row: MessageRow; readonly plaintext: string };

/** What the chat itself allows, before any row is looked at. */
export type ForwardContext = {
  /** A private profile's 1:1, or a private group. */
  readonly privateChat: boolean;
  /** The other side's "Media Save permission" for this chat. */
  readonly peerSave: boolean;
};

/** The type a forwarded row falls back to when it declared none. */
export const FORWARD_FALLBACK_TYPE = "application/octet-stream";
/** The name a forwarded row falls back to when it declared none. */
export const FORWARD_FALLBACK_NAME = "File";
/** What a re-uploaded photo is called and typed as (`forwardMessageTo`). */
export const REUPLOAD_PHOTO_NAME = "photo.jpg";
export const REUPLOAD_PHOTO_TYPE = "image/jpeg";

/** `KpSecure.privatePeer(c) || privateGroup`. */
export function isPrivateConversation(conversation: ConversationRow | null): boolean {
  if (!conversation) return false;
  if (conversation.privateGroup) return true;
  return !conversation.isGroup && conversation.other?.privateProfile === true;
}

/** The context a chat hands the selection rules. */
export function forwardContextOf(conversation: ConversationRow | null): ForwardContext {
  return {
    privateChat: isPrivateConversation(conversation),
    peerSave: conversation ? conversation.peerSave : true,
  };
}

/** `sentAsDocument`: picked through "Document", so it renders as a file row. */
export function sentAsDocument(row: Pick<MessageRow, "meta">): boolean {
  return row.meta?.document === true;
}

/** `fileLooksImage`. */
export function fileLooksImage(row: Pick<MessageRow, "fileType" | "fileName">): boolean {
  const type = String(row.fileType || "").toLowerCase();
  if (type.startsWith("image")) return true;
  const name = String(row.fileName || "").toLowerCase();
  return (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp") ||
    name.endsWith(".gif")
  );
}

/** `isPhotoMsg`: kind IMAGE, or an image FILE that was not sent as a document. */
export function isPhotoRow(
  row: Pick<MessageRow, "kind" | "fileType" | "fileName" | "meta">,
): boolean {
  return (
    row.kind === "IMAGE" || (row.kind === "FILE" && fileLooksImage(row) && !sentAsDocument(row))
  );
}

export type ForwardVerdict = { readonly allowed: boolean; readonly reason: string };

/**
 * Whether one row may be forwarded out of this chat. `own` matters for the
 * consent gate only: the sender's own rows are always theirs to forward.
 */
export function canForwardRow(
  row: MessageRow,
  context: ForwardContext,
  own: boolean,
): ForwardVerdict {
  if (row.localState !== "") {
    return { allowed: false, reason: "That message is still sending." };
  }
  if (row.kind === "DELETED") {
    return { allowed: false, reason: "A deleted message cannot be forwarded." };
  }
  if (context.privateChat) {
    return { allowed: false, reason: "Nothing can be forwarded out of a private chat." };
  }
  if (isViewOnce(row)) {
    return {
      allowed: false,
      reason: "A view-once message is one opening; it cannot be forwarded.",
    };
  }
  const isMedia = row.kind === "FILE" || row.kind === "IMAGE";
  if (!own && isMedia && !context.peerSave) {
    return {
      allowed: false,
      reason: "The sender turned off saving and forwarding for their media in this chat.",
    };
  }
  return { allowed: true, reason: "" };
}

/** Whether a row's media may be kept (the viewer's Save, the doc viewer's Save). */
export function canSaveMedia(row: MessageRow, context: ForwardContext, own: boolean): boolean {
  if (own) return true;
  if (row.kind !== "FILE" && row.kind !== "IMAGE") return true;
  return context.peerSave;
}

/** What a whole selection may do. An empty selection may do nothing. */
export function canForwardSelection(
  rows: readonly MessageRow[],
  context: ForwardContext,
  ownIds: (row: MessageRow) => boolean,
): ForwardVerdict {
  if (rows.length === 0) return { allowed: false, reason: "Nothing is selected." };
  for (const row of rows) {
    const verdict = canForwardRow(row, context, ownIds(row));
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true, reason: "" };
}

export type ForwardShape = "fileKey" | "dataUrl" | "reupload" | "text";

/**
 * Which branch of `forwardMessageTo` a row takes, in the same order the phone
 * tests them: a stored key first, then an inline data URL, then a server-hosted
 * media URL (download + re-upload), then a plain text post.
 */
export function forwardShapeOf(row: MessageRow): ForwardShape {
  if (row.fileKey) return "fileKey";
  if (row.mediaUrl.startsWith("data:")) return "dataUrl";
  if (row.mediaUrl) return "reupload";
  return "text";
}

/** The name a forwarded FILE row carries. */
export function forwardFileName(row: MessageRow): string {
  return row.fileName || FORWARD_FALLBACK_NAME;
}

/** The type a forwarded FILE row carries. */
export function forwardFileType(row: MessageRow): string {
  return row.fileType || FORWARD_FALLBACK_TYPE;
}

/**
 * The `meta` a forwarded row carries, key for key as the phone builds it:
 * a voice note stays a voice note (duration and bars come along), a document
 * stays a document, and anything else takes the album id when the forward
 * grouped photos. Nothing else survives — a reply quote, reactions and the
 * view-once flag are all properties of the ORIGINAL message, not of a copy.
 */
export function forwardMetaOf(
  row: MessageRow,
  album?: string,
): Record<string, unknown> | undefined {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  if (meta.voice === true) {
    const out: Record<string, unknown> = { voice: true, seconds: Number(meta.seconds) || 0 };
    if (Array.isArray(meta.waveform) && meta.waveform.length > 0) out.waveform = meta.waveform;
    return out;
  }
  if (meta.document === true) return { document: true };
  if (album && isPhotoRow(row)) return { album };
  return undefined;
}

/**
 * Two or more photos forwarded together arrive as ONE grouped bubble again —
 * with a fresh album id per TARGET chat, so each chat owns its own group.
 */
export function albumForForward(rows: readonly MessageRow[]): string {
  const photos = rows.filter((row) => isPhotoRow(row));
  return photos.length >= 2 ? albumId() : "";
}

/** The selection bar's Copy: every selected TEXT row's body, newline-joined. */
export function selectionCopyText(
  rows: readonly MessageRow[],
  bodies: Readonly<Record<string, string>>,
): string {
  return rows
    .filter((row) => row.kind === "TEXT")
    .map((row) => bodies[row.id] ?? row.body)
    .filter((body) => body.length > 0)
    .join("\n");
}

/** Copy is offered when any selected row is a TEXT row with a body. */
export function selectionCanCopy(
  rows: readonly MessageRow[],
  bodies: Readonly<Record<string, string>>,
): boolean {
  return selectionCopyText(rows, bodies).length > 0;
}

export type SelectionFacts = {
  readonly count: number;
  readonly canCopy: boolean;
  readonly canForward: boolean;
  readonly forwardReason: string;
  /** One own row the server already has: it can be unsent for everyone. */
  readonly canUnsend: boolean;
  /** One own TEXT row inside the edit window. */
  readonly canEdit: boolean;
  readonly allOwn: boolean;
  readonly anyEcho: boolean;
  readonly copyText: string;
};

/**
 * What the selection bar may draw. Android's bar is: back, count, Copy (texts),
 * Forward (not a private chat, no view-once in the selection), Edit (single,
 * own, inside the window) and ONE Delete whose popup asks the scope.
 */
export function selectionFacts(
  rows: readonly MessageRow[],
  bodies: Readonly<Record<string, string>>,
  context: ForwardContext,
  options: { isOwn: (row: MessageRow) => boolean; canEditRow: (row: MessageRow) => boolean },
): SelectionFacts {
  const copyText = selectionCopyText(rows, bodies);
  const forward = canForwardSelection(rows, context, options.isOwn);
  const single = rows.length === 1 ? rows[0] : null;
  return {
    count: rows.length,
    canCopy: copyText.length > 0,
    canForward: forward.allowed,
    forwardReason: forward.reason,
    canUnsend: Boolean(single && options.isOwn(single) && single.localState === ""),
    canEdit: Boolean(single && options.canEditRow(single)),
    allOwn: rows.length > 0 && rows.every((row) => options.isOwn(row)),
    anyEcho: rows.some((row) => row.localState !== ""),
    copyText,
  };
}

/** The notice a finished forward leaves behind. */
export function forwardNotice(rows: readonly MessageRow[], targets: readonly string[]): string {
  const messages = rows.length;
  const chats = targets.length;
  if (messages === 0 || chats === 0) return "Nothing was forwarded.";
  return `Forwarded ${messages} message${messages === 1 ? "" : "s"} to ${chats} chat${
    chats === 1 ? "" : "s"
  }.`;
}

/** The picker's own copy, matching `ForwardDialog`. */
export const FORWARD_DIALOG_TITLE = "Forward to";

export function forwardPickerSubtitle(picked: number, total: number): string {
  return picked === 0 ? `${total} chats` : `${picked} selected`;
}

/* --------------------------------------------------------- delete for everyone */

/**
 * `canDeleteForEveryone` (Ui.kt): an echo has no server row; your OWN message
 * was always deletable for everyone in any chat; somebody else's message is
 * deletable for everyone only in a 1:1 with a real person — not in a group, and
 * not to a bot.
 */
export function canDeleteForEveryone(
  row: MessageRow,
  conversation: ConversationRow | null,
  isOwn: boolean,
): boolean {
  if (row.localState !== "") return false;
  if (isOwn) return true;
  if (!conversation) return false;
  if (conversation.isGroup) return false;
  const otherId = conversation.other?.id ?? "";
  return otherId.length > 0 && !isBotConversation(conversation);
}

/** `deleteOtherLabel`: the other member's name, or "everyone" when unknown. */
export function deleteScopeLabel(conversation: ConversationRow | null): string {
  if (!conversation || conversation.isGroup) return "everyone";
  const other = conversation.other;
  const name = other?.displayName || other?.username || "";
  return name || "everyone";
}

/** The confirm panel's "also delete for …" wording (`deleteAlsoLabelForActiveChat`). */
export function deleteAlsoLabel(conversation: ConversationRow | null): string {
  return `Also delete for ${deleteScopeLabel(conversation)}`;
}

/** Every row in the selection may be deleted for everyone. */
export function selectionCanDeleteForEveryone(
  rows: readonly MessageRow[],
  conversation: ConversationRow | null,
  isOwn: (row: MessageRow) => boolean,
): boolean {
  return (
    rows.length > 0 && rows.every((row) => canDeleteForEveryone(row, conversation, isOwn(row)))
  );
}

/** What the chat picker lists: every chat, this one included, as the phone does. */
export function forwardTargets(
  conversations: readonly ConversationRow[],
): readonly ConversationRow[] {
  return conversations;
}

/** The title a forwarded-from chat is named by in a refusal. */
export function chatLabel(conversation: ConversationRow | null, fallback: string): string {
  return conversation ? conversationTitle(conversation) : fallback;
}
