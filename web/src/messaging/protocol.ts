/**
 * Wire protocol types, defensive parsing and pure reducers for the messaging
 * surfaces.
 *
 * Everything here is free of React and of the DOM so a Node contract case can
 * import it directly: parsing a hostile or partial Worker payload must never
 * throw into the UI, and list/merge decisions must be reviewable on their own.
 *
 * Field names follow the routes the Android app and the production PWA already
 * use (`GET /api/conversations`, `GET|POST /api/conversations/:id/messages`,
 * `POST /api/conversations/:id/read|typing`, `/ws/user`, `/ws/chat/:id`).
 */

import { BOT_IDS, OFFICIAL_BOT_ID, isEnvelope } from "./e2ee";
import { parseStatusQuote, type StatusQuote } from "../status/statusQuote";

export const MESSAGE_PAGE_SIZE = 50;
/** `MESSAGE_MAX` in src/shared/constants.ts — the Worker rejects longer bodies. */
export const MESSAGE_BODY_LIMIT = 4_000;
export const TYPING_WINDOW_MS = 6_000;
export const PREVIEW_BODY_LIMIT = 120;

export type ConversationPeer = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly e2eePublicKey: string;
  /**
   * Owner round 31 item 21: a private profile's chat, calls, pictures and
   * videos are screenshot-blocked and NOT saveable / forwardable on the other
   * phone too. A browser cannot block a screenshot — it says so — but the
   * save / forward half of that rule is a client decision and this is the flag
   * that carries it (`KpSecure.privatePeer` on the phone).
   */
  readonly privateProfile: boolean;
};

export type ConversationPreview = {
  readonly id: string;
  readonly kind: string;
  readonly category: string;
  readonly createdAt: string;
  readonly body: string;
  readonly viewOnce: boolean;
};

export type ConversationRow = {
  readonly id: string;
  readonly isGroup: boolean;
  readonly title: string;
  readonly hidden: boolean;
  /**
   * Slice I (chat-theme parity): the phone's per-chat theme — `darkblue`,
   * `default` (classic cream), `mint`, `rose`, `night`. Android's `cTheme()`
   * treats a missing/blank value as `darkblue`, so the parser applies the same
   * default instead of leaking an empty string to the theme tables.
   */
  readonly theme: string;
  /**
   * The group's owner id (null for solo chats). The Worker lets only the owner
   * change shared settings of a GROUP conversation, so the chat-theme picker
   * needs this to stand down honestly for non-owners.
   */
  readonly ownerId: string;
  readonly muted: boolean;
  readonly unread: number;
  readonly lastMessageAt: string;
  readonly lastMessage: string;
  readonly preview: ConversationPreview | null;
  readonly other: ConversationPeer | null;
  /**
   * The admin's "Private group" switch. While it is on the phone hides group
   * media, add-members and call recording — and nothing may be forwarded out
   * of the chat (`privateChat` in ChatScreen is `privatePeer(c) || privateGroup`).
   */
  readonly privateGroup: boolean;
  /**
   * r69: MY mute choice, split the way the Worker stores it. `mutedCall` hides
   * the chat header's call buttons entirely and silences the ring for this chat
   * (the server withholds the push and the relay too); `mutedMsg` silences only
   * the message tone. An older payload carries neither, and a missing flag means
   * "not muted" — never the other way round.
   */
  readonly mutedCall: boolean;
  readonly mutedMsg: boolean;
  /**
   * Owner round 32 (item 38) + round 34 (item 15): a stranger's unaccepted
   * message request, and the directional block wall. Both kill the composer on
   * the phone, and both remove the call buttons — `POST /api/calls` refuses with
   * REQUEST_PENDING or BLOCKED, so a button that could only fail is not drawn.
   */
  readonly requestPending: boolean;
  readonly blockedByMe: boolean;
  readonly blockedMe: boolean;
  /**
   * r71-18: whether the OTHER side lets me keep what they send here. The
   * worker answers `peerSave`; a false answer withholds Save and Forward on
   * their rows, which is the client half of "save and forward follow the
   * sender's consent".
   */
  readonly peerSave: boolean;
};

export type MessageRow = {
  readonly id: string;
  readonly clientId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly kind: string;
  readonly body: string;
  readonly replyTo: ReplyTarget | null;
  readonly hasImage: boolean;
  readonly mediaUrl: string;
  readonly fileKey: string;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
  readonly mediaWidth: number;
  readonly mediaHeight: number;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly reactions: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly rowid: number;
  readonly deliveredAt: string;
  readonly edited: boolean;
  readonly viewOnce: boolean;
  /** Set once a view-once attachment has been opened; the bytes are then gone. */
  readonly viewedAt: string;
  readonly viewedBy: string;
  /** Local-only: this row has not been confirmed by the server yet. */
  readonly localState: "pending" | "failed" | "";
  readonly localError: string;
  /**
   * Local-only object URL for an attachment this browser is still uploading.
   * The row has no fileKey yet, so the transcript shows the bytes it already
   * has instead of a spinner for the whole upload.
   */
  readonly localPreview: string;
  /** Local-only upload progress, 0..100, for the bubble's ring. */
  readonly localProgress: number;
  /**
   * Local-only: the photos this row stands for. Android folds rows that share
   * `meta.album` and a sender into ONE list row (`foldAlbums`), so a five-photo
   * send is one bubble with five thumbs and one viewer that pages between them.
   * Empty for every row that is not a folded album head.
   */
  readonly albumMembers: readonly MessageRow[];
  /**
   * A reply to a STATUS carries the status it answers (`meta.status`, expanded
   * server-side to `{id, kind, text}`). Both clients draw a small quote for it
   * in the bubble — `StatusQuote` in ChatScreen.kt — so the reader can see what
   * the words are answering without leaving the chat.
   */
  readonly statusQuote: StatusQuote | null;
};

export type ReplyTarget = {
  readonly id: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly body: string;
  readonly kind: string;
};

export type MessagesPage = {
  readonly items: readonly MessageRow[];
  readonly readAt: string;
  readonly typingAt: string;
  readonly typingKind: string;
  readonly marker: string;
  readonly oldest: string;
  readonly oldestRowid: number;
  readonly hasMore: boolean;
  readonly unchanged: boolean;
  readonly priv: Readonly<Record<string, boolean>>;
};

export type SocketFrame =
  | { type: "message"; conversationId: string; message: MessageRow }
  | { type: "conv"; conversationId: string }
  | { type: "read"; userId: string; at: string }
  | { type: "typing"; userId: string; at: string; kind: string }
  | { type: "delivered"; messageIds: readonly string[]; at: string };

/* ------------------------------------------------------------------ helpers */

function text(value: unknown, limit = 4096): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : value;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanish(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : "";
}

/* ----------------------------------------------------------------- messages */

function parseReplyTarget(value: unknown): ReplyTarget | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;
  return {
    id,
    senderId: text(value.senderId, 64),
    senderName: text(value.senderName, 120),
    body: text(value.body, 4000),
    kind: text(value.kind, 32) || "TEXT",
  };
}

function parseReactions(meta: Record<string, unknown>): Record<string, string> {
  const raw = meta.reactions;
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [userId, emoji] of Object.entries(raw)) {
    if (typeof emoji === "string" && emoji && userId) out[userId] = emoji.slice(0, 8);
  }
  return out;
}

export function parseMessageRow(value: unknown): MessageRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;

  const meta = isRecord(value.meta) ? value.meta : {};
  const kind = text(value.kind, 32) || "TEXT";
  return {
    id,
    clientId: text(value.clientId, 64),
    senderId: text(value.senderId, 64),
    senderName: text(value.senderName, 120),
    kind,
    // A DELETED tombstone arrives with a null body; never coerce it to text.
    body: kind === "DELETED" ? "" : text(value.body, 8000),
    replyTo: parseReplyTarget(value.replyTo ?? meta.replyTo),
    hasImage: booleanish(value.hasImage),
    mediaUrl: text(value.mediaUrl, 512),
    fileKey: text(value.fileKey, 256),
    fileName: text(value.fileName, 256),
    fileType: text(value.fileType, 128),
    fileSize: number(value.fileSize),
    mediaWidth: number(value.mediaW),
    mediaHeight: number(value.mediaH),
    meta,
    reactions: parseReactions(meta),
    createdAt: isoTimestamp(value.createdAt),
    rowid: number(value.rowid ?? value.kp_rowid),
    deliveredAt: isoTimestamp(value.deliveredAt),
    edited: booleanish(value.edited ?? meta.edited),
    viewOnce: booleanish(value.viewOnce ?? meta.viewOnce),
    viewedAt: isoTimestamp(value.viewedAt),
    viewedBy: text(value.viewedBy, 256),
    localState: "",
    localError: "",
    localPreview: "",
    localProgress: 0,
    albumMembers: [],
    statusQuote: parseStatusQuote(meta.status),
  };
}

/** Build a local echo row. Its id is the clientId so the server row can replace it. */
export function createLocalEcho(input: {
  clientId: string;
  senderId: string;
  plaintext: string;
  replyTo?: ReplyTarget | null;
  createdAt?: string;
}): MessageRow {
  return {
    id: input.clientId,
    clientId: input.clientId,
    senderId: input.senderId,
    senderName: "",
    kind: "TEXT",
    body: input.plaintext,
    replyTo: input.replyTo ?? null,
    hasImage: false,
    mediaUrl: "",
    fileKey: "",
    fileName: "",
    fileType: "",
    fileSize: 0,
    mediaWidth: 0,
    mediaHeight: 0,
    meta: {},
    reactions: {},
    createdAt: input.createdAt ?? new Date().toISOString(),
    rowid: 0,
    deliveredAt: "",
    edited: false,
    viewOnce: false,
    viewedAt: "",
    viewedBy: "",
    localState: "pending",
    localError: "",
    localPreview: "",
    localProgress: 0,
    albumMembers: [],
    statusQuote: null,
  };
}

export function parseMessagesPage(payload: unknown): MessagesPage {
  const empty: MessagesPage = {
    items: [],
    readAt: "",
    typingAt: "",
    typingKind: "",
    marker: "",
    oldest: "",
    oldestRowid: 0,
    hasMore: false,
    unchanged: false,
    priv: {},
  };
  if (!isRecord(payload)) return empty;

  // The Worker short-circuits an unchanged poll with {marker, unchanged:true}.
  if (payload.unchanged === true) {
    return { ...empty, unchanged: true, marker: text(payload.marker, 128) };
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.map(parseMessageRow).filter((row): row is MessageRow => row !== null);
  const oldest = isRecord(payload.oldest) ? payload.oldest : null;

  return {
    items,
    readAt: isoTimestamp(payload.readAt),
    typingAt: isoTimestamp(payload.typingAt),
    typingKind: text(payload.typingKind, 32),
    marker: text(payload.marker, 128),
    oldest: oldest ? isoTimestamp(oldest.createdAt) : (items[0]?.createdAt ?? ""),
    oldestRowid: oldest ? number(oldest.rowid) : (items[0]?.rowid ?? 0),
    hasMore: payload.hasMore === true,
    unchanged: false,
    priv: isRecord(payload.priv)
      ? Object.fromEntries(
          Object.entries(payload.priv).map(([key, value]) => [key, value === true]),
        )
      : {},
  };
}

/* ------------------------------------------------------------ conversations */

function parsePeer(value: unknown): ConversationPeer | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;
  return {
    id,
    displayName: text(value.displayName, 120),
    username: text(value.username, 64),
    e2eePublicKey: text(value.e2eePublicKey, 4096),
    privateProfile: booleanish(value.privateProfile),
  };
}

function parsePreview(value: unknown): ConversationPreview | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id, 64),
    kind: text(value.kind, 32),
    category: text(value.category, 32),
    createdAt: isoTimestamp(value.createdAt),
    body: text(value.body, 4000),
    viewOnce: booleanish(value.viewOnce),
  };
}

export function parseConversationRow(value: unknown): ConversationRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;

  // The list route reports `isGroup`; some single-conversation payloads only
  // carry `kind`, so accept either rather than guessing from the id shape.
  const isGroup =
    typeof value.isGroup === "boolean"
      ? value.isGroup
      : text(value.kind, 32).toUpperCase() === "GROUP";

  return {
    id,
    isGroup,
    title: text(value.title, 120),
    // Mirror Android's `cTheme()`: blank/absent means the dark-blue default,
    // never an empty string the palette tables cannot match.
    theme: text(value.theme, 20) || "darkblue",
    ownerId: text(value.ownerId, 64),
    hidden: booleanish(value.hidden),
    muted: booleanish(value.muted),
    unread: Math.max(0, Math.trunc(number(value.unread))),
    lastMessageAt: isoTimestamp(value.lastMessageAt),
    lastMessage: text(value.lastMessage, 32),
    preview: parsePreview(value.lastMessagePreview),
    other: parsePeer(value.other),
    privateGroup: booleanish(value.privateGroup),
    // Withheld by an older payload means "allowed": the worker's own default is
    // `otherSave ?? true`, and a missing flag must not silently disable Save.
    peerSave: value.peerSave === undefined ? true : booleanish(value.peerSave),
    // A missing mute/wall flag means "not muted, no wall": the Worker sends all
    // four on every conversation payload, so an older one only predates them.
    mutedCall: booleanish(value.mutedCall),
    mutedMsg: booleanish(value.mutedMsg),
    requestPending: booleanish(value.requestPending),
    blockedByMe: booleanish(value.blockedByMe),
    blockedMe: booleanish(value.blockedMe),
  };
}

export function parseConversationList(payload: unknown): readonly ConversationRow[] {
  // The Worker wraps the list as { items, marker } — the contract pinned by
  // case 04 and served by production. Slice I retired a stale parser that read
  // a removed `conversations` key: the E2E mocks repeated the same stale key,
  // so the suites stayed green while a real server would have rendered an
  // empty chat list (the exact bug hotfix PR #90 shipped for the legacy PWA).
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  const rows = payload.items
    .map(parseConversationRow)
    .filter((row): row is ConversationRow => row !== null);
  // Hidden chats must not leak into the list, its counts or its notifications.
  return rows.filter((row) => !row.hidden);
}

export function parseConversationDetail(payload: unknown): ConversationRow | null {
  if (!isRecord(payload)) return null;
  return parseConversationRow(payload.conversation ?? payload);
}

/* -------------------------------------------------------------- derivations */

export function conversationTitle(conversation: ConversationRow): string {
  if (conversation.isGroup) return conversation.title || "Group";
  const other = conversation.other;
  return other?.displayName || other?.username || other?.id || "Chat";
}

export function conversationInitial(conversation: ConversationRow): string {
  return conversationTitle(conversation).trim().charAt(0).toUpperCase() || "?";
}

export function isOneWayConversation(conversation: ConversationRow): boolean {
  return !conversation.isGroup && conversation.other?.id === OFFICIAL_BOT_ID;
}

export function conversationPeerId(conversation: ConversationRow): string {
  return conversation.other?.id ?? "";
}

export function conversationPeerKey(conversation: ConversationRow): string {
  return conversation.other?.e2eePublicKey ?? "";
}

export function isBotConversation(conversation: ConversationRow): boolean {
  const peer = conversationPeerId(conversation);
  return !conversation.isGroup && BOT_IDS.has(peer);
}

const PREVIEW_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  photo: "\u{1F4F7} Photo",
  video: "\u{1F3AC} Video",
  voice: "\u{1F399} Voice message",
  file: "\u{1F4CE} File",
  call: "\u{1F4DE} Call",
  status: "\u{1F4AC} Status",
};

/**
 * Chat-list preview text. A sealed body is never shown as ciphertext: the list
 * gets the same lock placeholder the open chat uses.
 */
export function conversationPreviewText(conversation: ConversationRow): string {
  const preview = conversation.preview;
  if (!preview) {
    if (conversation.lastMessage.toLowerCase() === "call") return "\u{1F4DE} Call";
    return "No messages yet";
  }
  if (preview.viewOnce) return "\u{1F4F7} View once";

  const category = preview.category.toLowerCase();
  const label = PREVIEW_CATEGORY_LABELS[category];
  if (label && category !== "message") return label;

  if (isEnvelope(preview.body)) return "\u{1F512} এনক্রিপ্টেড মেসেজ";
  const body = preview.body.trim();
  if (!body) return label ?? "No messages yet";
  return body.length > PREVIEW_BODY_LIMIT ? `${body.slice(0, PREVIEW_BODY_LIMIT)}…` : body;
}

export type TickState = "pending" | "failed" | "sent" | "delivered" | "read";

export function tickState(
  message: MessageRow,
  context: { meId: string; otherReadAt: string },
): TickState {
  if (message.localState === "failed") return "failed";
  if (message.localState === "pending") return "pending";
  if (message.senderId !== context.meId) return "sent";
  if (
    context.otherReadAt &&
    message.createdAt &&
    Date.parse(message.createdAt) <= Date.parse(context.otherReadAt)
  ) {
    return "read";
  }
  return message.deliveredAt ? "delivered" : "sent";
}

export const TICK_LABELS: Readonly<Record<TickState, string>> = {
  pending: "Sending",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

const dhakaFormatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", ...options });

/** Timestamps are shown in Asia/Dhaka and the zone is stated in the UI. */
export function clockTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return dhakaFormatter({ hour: "numeric", minute: "2-digit", hour12: true }).format(parsed);
}

export function dayLabel(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const dhakaDay = dhakaFormatter({ year: "numeric", month: "2-digit", day: "2-digit" });
  const today = dhakaDay.format(Date.now());
  const yesterday = dhakaDay.format(Date.now() - 86_400_000);
  const stamp = dhakaDay.format(parsed);
  if (stamp === today) return "Today";
  if (stamp === yesterday) return "Yesterday";
  return dhakaFormatter({ day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

export function isTypingActive(typingAt: string, now: number = Date.now()): boolean {
  const parsed = Date.parse(typingAt);
  return Number.isFinite(parsed) && now - parsed < TYPING_WINDOW_MS;
}

/** A local row is one this browser created and the server has not confirmed. */
export function isLocalMessage(message: MessageRow): boolean {
  return message.localState !== "" || message.id === message.clientId;
}

export function localClientIdPrefix(): string {
  return "c_w";
}

/**
 * The optimistic row for an attachment send.
 *
 * It carries everything the bubble needs to render before the server answers:
 * the file name and type, the measured box, the meta the phone will read, and a
 * local object URL so a photo is visible while its bytes are still going up.
 * `id` is the clientId, which is how `applyMessageFrame` swaps in the confirmed
 * row later — the same trick `createLocalEcho` uses for text.
 */
export function createLocalAttachmentEcho(input: {
  clientId: string;
  senderId: string;
  kind: "FILE" | "STICKER";
  body: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  mediaWidth?: number;
  mediaHeight?: number;
  meta?: Readonly<Record<string, unknown>>;
  viewOnce?: boolean;
  localPreview?: string;
  replyTo?: ReplyTarget | null;
  createdAt?: string;
}): MessageRow {
  return {
    id: input.clientId,
    clientId: input.clientId,
    senderId: input.senderId,
    senderName: "",
    kind: input.kind,
    body: input.body,
    replyTo: input.replyTo ?? null,
    hasImage: input.fileType.startsWith("image/"),
    mediaUrl: "",
    fileKey: "",
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    mediaWidth: input.mediaWidth ?? 0,
    mediaHeight: input.mediaHeight ?? 0,
    meta: input.meta ?? {},
    reactions: {},
    createdAt: input.createdAt ?? new Date().toISOString(),
    rowid: 0,
    deliveredAt: "",
    edited: false,
    viewOnce: input.viewOnce ?? false,
    viewedAt: "",
    viewedBy: "",
    localState: "pending",
    localError: "",
    localPreview: input.localPreview ?? "",
    localProgress: 0,
    albumMembers: [],
    statusQuote: null,
  };
}

export function newClientId(
  random: () => string = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}${Math.random()}`,
): string {
  return `${localClientIdPrefix()}${random()
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 24)}`;
}

/* ---------------------------------------------------------------- reducers */

/**
 * Merge a freshly fetched page with rows this browser is still waiting on.
 *
 * The server page is authoritative; a local echo survives only while no
 * confirmed row carries the same clientId. Without that reconciliation a
 * WebSocket frame racing a GET produced duplicate bubbles.
 */
export function reconcileMessagePage(
  fresh: readonly MessageRow[],
  current: readonly MessageRow[],
): MessageRow[] {
  const confirmedClientIds = new Set(
    fresh.map((message) => message.clientId).filter((clientId) => clientId !== ""),
  );
  const confirmedIds = new Set(fresh.map((message) => message.id));
  const stillPending = current.filter(
    (message) =>
      isLocalMessage(message) &&
      message.clientId !== "" &&
      !confirmedClientIds.has(message.clientId) &&
      !confirmedIds.has(message.id),
  );
  return [...fresh, ...stillPending].sort(compareMessages);
}

/** Oldest first, with a rowid tiebreaker for same-millisecond messages. */
export function compareMessages(left: MessageRow, right: MessageRow): number {
  const byTime = Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
  if (byTime !== 0) return byTime;
  if (left.rowid !== right.rowid) return left.rowid - right.rowid;
  return left.id.localeCompare(right.id);
}

/** Prepend an older page without duplicating rows already on screen. */
export function prependOlderPage(
  current: readonly MessageRow[],
  older: readonly MessageRow[],
): MessageRow[] {
  const seen = new Set(current.map((message) => message.id));
  const additions = older.filter((message) => !seen.has(message.id));
  return [...additions, ...current].sort(compareMessages);
}

/**
 * Apply a `message` socket frame.
 *
 * Own sends replace the matching local echo (by clientId first, then id). A
 * foreign message replaces an existing row in place — security cards receive
 * redacted/status updates that way — and otherwise appends.
 */
export function applyMessageFrame(
  current: readonly MessageRow[],
  incoming: MessageRow,
  meId: string,
): { messages: MessageRow[]; appended: boolean } {
  // Defensive: a VANISHED marker is a removal instruction, not a row. Android
  // returns early on it; folding it into the list would leave a bubble that
  // says nothing and can never be opened.
  if (isVanishedMarker(incoming)) {
    return { messages: current.filter((message) => message.id !== incoming.id), appended: false };
  }

  const byId = current.findIndex((message) => message.id === incoming.id);
  const isOwn = incoming.senderId === meId;

  if (isOwn) {
    const echoIndex = current.findIndex(
      (message) => message.clientId !== "" && message.clientId === incoming.clientId,
    );
    if (echoIndex >= 0) {
      const next = [...current];
      next[echoIndex] = incoming;
      return { messages: next.sort(compareMessages), appended: false };
    }
  }

  if (byId >= 0) {
    const next = [...current];
    next[byId] = incoming;
    return { messages: next.sort(compareMessages), appended: false };
  }

  return { messages: [...current, incoming].sort(compareMessages), appended: true };
}

/** Apply a `delivered` frame; only rows without a stamp change. */
export function applyDeliveredFrame(
  current: readonly MessageRow[],
  messageIds: readonly string[],
  at: string,
): { messages: MessageRow[]; changed: boolean } {
  const ids = new Set(messageIds);
  let changed = false;
  const next = current.map((message) => {
    if (message.deliveredAt || !ids.has(message.id)) return message;
    changed = true;
    return { ...message, deliveredAt: at || new Date().toISOString() };
  });
  return { messages: next, changed };
}

/** Read markers only move forward. */
export function advanceReadMarker(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  return Date.parse(incoming) > Date.parse(current) ? incoming : current;
}

/** Insert or update a conversation row in the list, keeping newest-first order. */
export function upsertConversation(
  current: readonly ConversationRow[],
  next: ConversationRow,
): ConversationRow[] {
  const withoutExisting = current.filter((row) => row.id !== next.id);
  return [...withoutExisting, next].sort(compareConversations);
}

export function compareConversations(left: ConversationRow, right: ConversationRow): number {
  const leftAt = Date.parse(left.lastMessageAt || "") || 0;
  const rightAt = Date.parse(right.lastMessageAt || "") || 0;
  if (leftAt !== rightAt) return rightAt - leftAt;
  return left.id.localeCompare(right.id);
}

export function totalUnread(conversations: readonly ConversationRow[]): number {
  return conversations.reduce((sum, row) => sum + row.unread, 0);
}

/** Group messages under day separators without recomputing on every render. */
export function groupByDay(messages: readonly MessageRow[]): {
  day: string;
  items: readonly MessageRow[];
}[] {
  const groups: { day: string; items: MessageRow[] }[] = [];
  for (const message of messages) {
    const day = dayLabel(message.createdAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(message);
    else groups.push({ day, items: [message] });
  }
  return groups;
}

/* -------------------------------------------------------------- socket I/O */

/**
 * The Worker's vanish marker: a view-once row whose single opening happened is
 * DELETED for everyone, and every open chat receives `{kind:"VANISHED"}` so the
 * row can leave without a tombstone (owner round 34, item 16a). It is not a
 * message and must never be inserted into a transcript.
 */
export function isVanishedMarker(message: MessageRow): boolean {
  return message.kind === "VANISHED";
}

/** A photo row, by the Worker's own rule: IMAGE, or a FILE whose type is an image and is not a document. */
export function isPhotoMessage(message: MessageRow): boolean {
  if (message.kind === "IMAGE") return true;
  if (message.kind !== "FILE") return false;
  return message.fileType.startsWith("image/") && message.meta.document !== true;
}

/**
 * The album a row belongs to — "" for anything else.
 *
 * Android: `if (a.isNotBlank() && isPhotoMsg(m) && !isViewOnce(m)) a else ""`.
 * A view-once photo never joins an album (one tap = one opening), and the
 * Worker agrees: it refuses to store `meta.album` on a view-once row.
 */
export function albumIdOf(message: MessageRow): string {
  const raw = typeof message.meta.album === "string" ? message.meta.album : "";
  if (!raw) return "";
  if (!isPhotoMessage(message)) return "";
  if (message.viewOnce || message.meta.viewOnce === true) return "";
  return raw;
}

/**
 * Fold album siblings into their first row.
 *
 * A group of one (the rest still unsent, or the rest deleted) stays a plain
 * photo, and rows outside any album keep their identity — so a transcript with
 * no albums at all is returned untouched, byte for byte.
 */
export function foldAlbums(rows: readonly MessageRow[]): readonly MessageRow[] {
  if (!rows.some((row) => albumIdOf(row) !== "")) return rows;

  const groups = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const album = albumIdOf(row);
    if (!album) continue;
    const key = `${row.senderId}|${album}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out: MessageRow[] = [];
  const emitted = new Set<string>();
  for (const row of rows) {
    const album = albumIdOf(row);
    if (!album) {
      out.push(row);
      continue;
    }
    const key = `${row.senderId}|${album}`;
    const group = groups.get(key);
    if (!group) continue;
    if (group.length < 2) {
      out.push(row);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push({ ...row, albumMembers: group });
  }
  return out;
}

export function socketUrl(path: string, token: string): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  // Browsers cannot set WebSocket headers, so the bearer travels as a query
  // parameter. The Worker accepts that on /ws/* only (pinned by test 48).
  return `${protocol}://${window.location.host}${path}?token=${encodeURIComponent(token)}`;
}

/**
 * Plan §7.2: the socket opens with a 60-second, single-use ticket instead of
 * the long-lived session token, so no bearer ever sits in a URL. The ticket
 * arrives from POST /api/ws/ticket (`wsTicket.ts`) with ordinary header auth.
 */
export function socketTicketUrl(path: string, ticket: string): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

export function parseSocketFrame(raw: unknown): SocketFrame | null {
  if (typeof raw !== "string" || !raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  const type = text(payload.type, 32);
  switch (type) {
    case "message": {
      const message = parseMessageRow(payload.message);
      if (!message) return null;
      return {
        type,
        conversationId: text(payload.conversationId, 64),
        message,
      };
    }
    case "conv":
      return { type, conversationId: text(payload.conversationId, 64) };
    case "read":
      return { type, userId: text(payload.userId, 64), at: isoTimestamp(payload.at) };
    case "typing":
      return {
        type,
        userId: text(payload.userId, 64),
        at: isoTimestamp(payload.at),
        kind: text(payload.kind, 32),
      };
    case "delivered": {
      const ids = Array.isArray(payload.messageIds)
        ? payload.messageIds.map((id) => text(id, 64)).filter((id) => id !== "")
        : [];
      return { type, messageIds: ids, at: isoTimestamp(payload.at) };
    }
    default:
      return null;
  }
}
