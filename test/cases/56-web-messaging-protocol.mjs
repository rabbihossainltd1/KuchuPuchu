/**
 * Web messaging protocol, outbox and socket contract.
 *
 * These are the pure pieces the chat surfaces depend on: parsing a hostile or
 * partial Worker payload without throwing, the list/merge rules that stop a
 * WebSocket frame racing a GET from duplicating a bubble, the send-queue state
 * machine, and the reconnect/heartbeat behaviour of the managed socket.
 *
 * Every check here drives the real client modules — no reimplementation.
 */

import { ApiError } from "../../web/src/api.ts";
import {
  CAPABILITY_COPY,
  QUICK_REACTIONS,
  QUICK_REACTION_EMOJI,
} from "../../web/src/messaging/chatCopy.ts";
import {
  OUTBOX_MAX_ATTEMPTS,
  applySendOutcome,
  classifySendFailure,
  createMemoryDraftStore,
  createMemoryOutboxStore,
  createOutboxItem,
  isActionable,
  pendingCount,
  retryDelayMs,
} from "../../web/src/messaging/outbox.ts";
import {
  MESSAGE_BODY_LIMIT,
  advanceReadMarker,
  applyDeliveredFrame,
  applyMessageFrame,
  clockTime,
  compareConversations,
  compareMessages,
  conversationInitial,
  conversationPeerKey,
  conversationPreviewText,
  conversationTitle,
  createLocalEcho,
  dayLabel,
  groupByDay,
  isLocalMessage,
  isOneWayConversation,
  isTypingActive,
  newClientId,
  parseConversationDetail,
  parseConversationList,
  parseMessageRow,
  parseMessagesPage,
  parseSocketFrame,
  prependOlderPage,
  reconcileMessagePage,
  socketUrl,
  tickState,
  totalUnread,
  upsertConversation,
} from "../../web/src/messaging/protocol.ts";
import { backoffDelayMs, createManagedSocket } from "../../web/src/messaging/sockets.ts";
import { SECURE_CHAT_WAITING, SendRefusedError } from "../../web/src/messaging/e2ee.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

/* ------------------------------------------------------- payload parsing --- */

const conversationPayload = {
  conversations: [
    {
      id: "c_1",
      isGroup: false,
      unread: 3,
      hidden: 0,
      lastMessageAt: "2026-10-04T09:00:00.000Z",
      lastMessagePreview: {
        kind: "TEXT",
        category: "message",
        body: "hello",
        createdAt: "2026-10-04T09:00:00.000Z",
      },
      other: { id: "u_2", displayName: "Rahi", username: "rahi", e2eePublicKey: "x".repeat(80) },
    },
    { id: "c_hidden", hidden: 1, unread: 9, other: { id: "u_9" } },
    { id: "c_group", kind: "GROUP", title: "Squad", unread: 0, isGroup: true },
    null,
    { unread: 5 }, // no id -> dropped
    { id: "c_bot", unread: 1, other: { id: "kp_official_bot", displayName: "KuchuPuchu" } },
  ],
};

const list = parseConversationList(conversationPayload);
check(
  "hidden conversations never reach the list",
  list.every((row) => row.id !== "c_hidden"),
);
check(
  "rows without an id are dropped, not rendered blank",
  list.length === 3 && list.every((row) => row.id),
);
check(
  "a group is recognised from either isGroup or kind",
  list.find((row) => row.id === "c_group").isGroup === true,
);
check(
  "unread is coerced to a non-negative integer",
  list.find((row) => row.id === "c_1").unread === 3,
);
check("total unread sums the visible rows only", totalUnread(list) === 4);
check("list order is newest activity first", list[0].id === "c_1");
check(
  "a hostile payload yields an empty list instead of throwing",
  parseConversationList(null).length === 0 &&
    parseConversationList({ conversations: "nope" }).length === 0,
);
check(
  "detail parsing accepts {conversation} and a bare row",
  parseConversationDetail({ conversation: conversationPayload.conversations[0] }).id === "c_1" &&
    parseConversationDetail(conversationPayload.conversations[2]).id === "c_group",
);

check(
  "titles fall back peer displayName -> username -> id",
  conversationTitle(list[0]) === "Rahi" &&
    conversationTitle(
      parseConversationRowish({ id: "c_x", other: { id: "u_5", username: "five" } }),
    ) === "five",
);
function parseConversationRowish(value) {
  return parseConversationList({ conversations: [value] })[0];
}
check(
  'initials fall back through title -> peer -> "Chat" and are never empty',
  conversationInitial(list[0]) === "R" &&
    conversationInitial(parseConversationRowish({ id: "c_e" })) === "C",
);
check(
  "the official bot conversation is one-way",
  isOneWayConversation(list.find((row) => row.id === "c_bot")) === true &&
    isOneWayConversation(list[0]) === false,
);
check(
  "the peer key is read for sealing",
  conversationPeerKey(list[0]).length === 80 && conversationPeerKey(list[2]) === "",
);

// previews
check(
  "a sealed preview shows a lock, never ciphertext",
  conversationPreviewText(
    parseConversationRowish({
      id: "c_s",
      lastMessagePreview: { category: "message", body: "KP1.aaaaaaaa" },
    }),
  ) === "\u{1F512} এনক্রিপ্টেড মেসেজ",
);
check(
  "a view-once preview does not leak the body",
  conversationPreviewText(
    parseConversationRowish({ id: "c_v", lastMessagePreview: { viewOnce: 1, body: "secret" } }),
  ) === "\u{1F4F7} View once",
);
check(
  "media categories get their own label",
  conversationPreviewText(
    parseConversationRowish({
      id: "c_p",
      lastMessagePreview: { category: "photo", body: "caption" },
    }),
  ) === "\u{1F4F7} Photo",
);
check(
  "a long preview is truncated",
  conversationPreviewText(
    parseConversationRowish({
      id: "c_l",
      lastMessagePreview: { category: "message", body: "a".repeat(400) },
    }),
  ).length === 121,
);
check(
  "a call-only conversation previews as a call",
  conversationPreviewText(parseConversationRowish({ id: "c_call", lastMessage: "call" })) ===
    "\u{1F4DE} Call",
);

// messages page
const page = parseMessagesPage({
  items: [
    {
      id: "m_2",
      kind: "TEXT",
      body: "second",
      createdAt: "2026-10-04T09:02:00.000Z",
      rowid: 12,
      senderId: "u_2",
    },
    {
      id: "m_1",
      kind: "TEXT",
      body: "KP1.aaa",
      createdAt: "2026-10-04T09:01:00.000Z",
      rowid: 11,
      senderId: "u_1",
      clientId: "c_w1",
      replyTo: { id: "m_0", body: "quoted", senderId: "u_2", senderName: "Rahi" },
    },
    { id: "m_3", kind: "DELETED", body: null, createdAt: "2026-10-04T09:03:00.000Z", rowid: 13 },
    null,
    { kind: "TEXT" }, // no id -> dropped
  ],
  readAt: "2026-10-04T09:05:00.000Z",
  typingAt: new Date().toISOString(),
  typingKind: "text",
  marker: "mk1",
  oldest: { createdAt: "2026-10-04T09:01:00.000Z", rowid: 11 },
  hasMore: true,
  priv: { screenshot: true, save: false },
});
check("malformed message rows are dropped", page.items.length === 3);
check(
  "a DELETED tombstone keeps an empty body, not the string 'null'",
  page.items.find((row) => row.id === "m_3").body === "",
);
check(
  "reply context survives parsing",
  page.items.find((row) => row.id === "m_1").replyTo.body === "quoted",
);
check(
  "the oldest cursor is read from the page, not recomputed",
  page.oldest === "2026-10-04T09:01:00.000Z" && page.oldestRowid === 11,
);
check("hasMore drives the load-older control", page.hasMore === true);
check("peer privacy flags are booleans", page.priv.screenshot === true && page.priv.save === false);
check(
  "an unchanged poll short-circuits without items",
  parseMessagesPage({ marker: "mk1", unchanged: true }).unchanged === true,
);
check(
  "an empty payload yields an empty page",
  parseMessagesPage(undefined).items.length === 0 && parseMessagesPage(undefined).hasMore === false,
);
check(
  "reaction metadata is parsed into a userId->emoji map",
  parseMessageRow({ id: "m_9", meta: { reactions: { u_1: "\u{1F44D}", u_2: 42 } } }).reactions
    .u_1 === "\u{1F44D}" &&
    parseMessageRow({ id: "m_9", meta: { reactions: { u_1: "\u{1F44D}", u_2: 42 } } }).reactions
      .u_2 === undefined,
);
check("the body limit is the Worker's MESSAGE_MAX", MESSAGE_BODY_LIMIT === 4000);

/* -------------------------------------------------------------- derivations */

const me = "u_1";
const own = { ...page.items[1], senderId: me, localState: "", deliveredAt: "" };
check("own unread messages show as sent", tickState(own, { meId: me, otherReadAt: "" }) === "sent");
check(
  "a delivery stamp upgrades to delivered",
  tickState({ ...own, deliveredAt: "2026-10-04T09:04:00.000Z" }, { meId: me, otherReadAt: "" }) ===
    "delivered",
);
check(
  "a read marker at or after the message upgrades to read",
  tickState(own, { meId: me, otherReadAt: "2026-10-04T09:05:00.000Z" }) === "read",
);
check(
  "a read marker older than the message leaves it delivered",
  tickState(
    { ...own, deliveredAt: "2026-10-04T09:04:00.000Z" },
    { meId: me, otherReadAt: "2026-10-04T08:00:00.000Z" },
  ) === "delivered",
);
check(
  "a pending local echo reports pending",
  tickState({ ...own, localState: "pending" }, { meId: me, otherReadAt: "" }) === "pending",
);
check(
  "a failed send reports failed",
  tickState({ ...own, localState: "failed" }, { meId: me, otherReadAt: "" }) === "failed",
);
check(
  "incoming messages carry no outgoing tick",
  tickState({ ...own, senderId: "u_2" }, { meId: me, otherReadAt: "" }) === "sent",
);

check(
  "typing expires outside the 6s window",
  isTypingActive(new Date(Date.now() - 1000).toISOString()) === true &&
    isTypingActive(new Date(Date.now() - 9000).toISOString()) === false &&
    isTypingActive("") === false,
);
check(
  "day labels are Today/Yesterday in Dhaka time",
  dayLabel(new Date().toISOString()) === "Today" &&
    dayLabel(new Date(Date.now() - 86400000).toISOString()) === "Yesterday",
);
check(
  "clock and day labels reject unparseable stamps",
  clockTime("not-a-date") === "" && dayLabel("") === "",
);
check(
  "a local echo is identifiable",
  isLocalMessage(createLocalEcho({ clientId: "c_wabc", senderId: me, plaintext: "hi" })) === true &&
    isLocalMessage(page.items[0]) === false,
);
check(
  "client ids are prefixed like the app's web ids",
  newClientId(() => "ABC-123-XYZ").startsWith("c_w") && newClientId().length <= 27,
);
check(
  "messages sort oldest-first with a rowid tiebreak",
  [page.items[0], page.items[1]].sort(compareMessages)[0].id === "m_1" &&
    compareMessages(
      { ...page.items[0], rowid: 5, createdAt: page.items[1].createdAt },
      { ...page.items[0], rowid: 9, createdAt: page.items[1].createdAt },
    ) < 0,
);
check(
  "conversations sort newest-activity-first",
  compareConversations(
    list[0],
    parseConversationRowish({ id: "c_old", lastMessageAt: "2020-01-01T00:00:00.000Z" }),
  ) < 0,
);
check(
  "day grouping keeps order and buckets by Dhaka day",
  groupByDay([...page.items].sort(compareMessages)).length >= 1,
);

/* ----------------------------------------------------------------- reducers */

const echo = createLocalEcho({ clientId: "c_wecho", senderId: me, plaintext: "drafted send" });
// The confirmed row must be ours: an echo is only replaced by our own send.
const confirmed = { ...page.items[0], clientId: "c_wecho", senderId: me };

const reconciled = reconcileMessagePage([confirmed], [echo]);
check(
  "a confirmed server row retires its local echo",
  reconciled.length === 1 && reconciled[0].id === confirmed.id,
);
check(
  "an unconfirmed echo survives a page refresh",
  reconcileMessagePage([page.items[0]], [echo, page.items[0]]).some(
    (row) => row.clientId === "c_wecho",
  ),
);
check(
  "reconciliation never duplicates by id",
  reconcileMessagePage([page.items[0]], [page.items[0]]).length === 1,
);

const framed = applyMessageFrame([echo], confirmed, me);
check(
  "our own frame replaces the echo instead of appending",
  framed.messages.length === 1 &&
    framed.appended === false &&
    framed.messages[0].id === confirmed.id,
);
const foreign = { ...page.items[0], id: "m_new", senderId: "u_2", clientId: "" };
check("a foreign frame appends", applyMessageFrame([page.items[0]], foreign, me).appended === true);
check(
  "a foreign frame with a known id replaces in place (security card update)",
  applyMessageFrame([page.items[0]], { ...page.items[0], body: "redacted" }, me).messages.length ===
    1,
);

const delivered = applyDeliveredFrame(
  [page.items[0], { ...page.items[1], deliveredAt: "" }],
  [page.items[0].id],
  "2026-10-04T09:10:00.000Z",
);
check(
  "a delivered frame stamps only unstamped rows",
  delivered.changed === true &&
    delivered.messages.find((row) => row.id === page.items[0].id).deliveredAt ===
      "2026-10-04T09:10:00.000Z",
);
check(
  "re-delivering the same row changes nothing",
  applyDeliveredFrame(delivered.messages, [page.items[0].id], "2026-10-04T09:11:00.000Z")
    .changed === false,
);

check(
  "read markers only move forward",
  advanceReadMarker("2026-10-04T09:00:00.000Z", "2026-10-04T08:00:00.000Z") ===
    "2026-10-04T09:00:00.000Z" &&
    advanceReadMarker("", "2026-10-04T08:00:00.000Z") === "2026-10-04T08:00:00.000Z" &&
    advanceReadMarker("2026-10-04T09:00:00.000Z", "") === "2026-10-04T09:00:00.000Z",
);

check(
  "an older page prepends without duplicates",
  prependOlderPage([page.items[0]], [page.items[1], page.items[0]]).length === 2,
);
const upserted = upsertConversation(list, {
  ...list[0],
  unread: 9,
  lastMessageAt: new Date().toISOString(),
});
check(
  "upserting a conversation updates it in place and re-sorts",
  upserted.filter((row) => row.id === "c_1").length === 1 &&
    upserted[0].unread === 9 &&
    upserted.length === list.length,
);

/* -------------------------------------------------------------- socket I/O */

check(
  "heartbeat frames are ignored as non-frames",
  parseSocketFrame(JSON.stringify({ type: "hb", at: 1 })) === null,
);
check(
  "malformed JSON does not throw",
  parseSocketFrame("{oops") === null &&
    parseSocketFrame("") === null &&
    parseSocketFrame(null) === null,
);
check(
  "a message frame without a parseable row is dropped",
  parseSocketFrame(JSON.stringify({ type: "message", message: {} })) === null,
);
check(
  "message/read/typing/delivered/conv frames parse",
  ["message", "read", "typing", "delivered", "conv"].every((type) => {
    const frame = parseSocketFrame(
      JSON.stringify(
        type === "message"
          ? { type, conversationId: "c_1", message: page.items[0] }
          : type === "delivered"
            ? { type, messageIds: ["m_1", 7, null], at: "2026-10-04T09:00:00.000Z" }
            : {
                type,
                conversationId: "c_1",
                userId: "u_2",
                at: new Date().toISOString(),
                kind: "text",
              },
      ),
    );
    return frame && frame.type === type;
  }),
);
check(
  "a delivered frame keeps only string ids",
  parseSocketFrame(JSON.stringify({ type: "delivered", messageIds: ["m_1", 7, null], at: "" }))
    .messageIds.length === 1,
);

// socketUrl and the managed socket need a browser-ish global.
const intervals = [];
globalThis.window = {
  location: { protocol: "https:", host: "kp.example" },
  setTimeout: (callback, ms) => {
    const handle = { callback, ms, cancelled: false };
    timeouts.push(handle);
    return handle;
  },
  clearTimeout: (handle) => {
    if (handle) handle.cancelled = true;
  },
  setInterval: (callback, ms) => {
    const handle = { callback, ms, cancelled: false };
    intervals.push(handle);
    return handle;
  },
  clearInterval: (handle) => {
    if (handle) handle.cancelled = true;
  },
};
const timeouts = [];

check(
  "the ws url keeps the token as a query parameter only",
  socketUrl("/ws/user", "tok/en") === "wss://kp.example/ws/user?token=tok%2Fen",
);
check(
  "backoff is capped",
  backoffDelayMs(0) === 2500 && backoffDelayMs(1) === 5000 && backoffDelayMs(10) === 30000,
);

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(data) {
    this.onmessage?.({ data });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}
FakeWebSocket.instances = [];

const frames = [];
const statuses = [];
const scheduled = [];
const socket = createManagedSocket({
  path: "/ws/chat/c_1",
  token: "tok",
  webSocketImpl: FakeWebSocket,
  onFrame: (frame) => frames.push(frame),
  onStatus: (status) => statuses.push(status),
  schedule: (callback, delayMs) => {
    const entry = { callback, delayMs, cancelled: false, ran: false };
    scheduled.push(entry);
    return { cancel: () => (entry.cancelled = true) };
  },
  heartbeatMs: 20000,
});

check("connecting is reported before the socket opens", statuses[0] === "connecting");
check("send before open reports failure", socket.send({ type: "hb" }) === false);

FakeWebSocket.instances[0].open();
check("open is reported once connected", statuses.includes("open") && socket.status() === "open");
check("the socket url carries the token", FakeWebSocket.instances[0].url.includes("token=tok"));

FakeWebSocket.instances[0].emit(JSON.stringify({ type: "conv", conversationId: "c_1" }));
check("a valid frame reaches the handler", frames.length === 1 && frames[0].type === "conv");
FakeWebSocket.instances[0].emit("not json");
check("an invalid frame is dropped without throwing", frames.length === 1);

const heartbeat = intervals.at(-1);
heartbeat.callback();
check(
  "the heartbeat frame matches the app's shape",
  JSON.parse(FakeWebSocket.instances[0].sent.at(-1)).type === "hb",
);

FakeWebSocket.instances[0].drop();
check(
  "a drop schedules a reconnect with backoff",
  scheduled.length === 1 && scheduled[0].delayMs === 2500 && socket.status() === "reconnecting",
);
scheduled[0].ran = true;
scheduled[0].callback();
check("the reconnect opens a second socket", FakeWebSocket.instances.length === 2);
FakeWebSocket.instances[1].drop();
check("the second backoff doubles", scheduled.at(-1).delayMs === 5000);

socket.close();
check(
  "an explicit close stops reconnecting",
  socket.status() === "closed" && intervals.at(-1).cancelled === true,
);
const before = scheduled.length;
scheduled.at(-1).callback();
check(
  "a pending reconnect after close opens no further socket",
  FakeWebSocket.instances.length === 2 && scheduled.length === before + 0,
);

const noToken = createManagedSocket({
  path: "/ws/user",
  token: "",
  webSocketImpl: FakeWebSocket,
  onFrame: () => undefined,
});
check("without a token no socket is opened", noToken.status() === "closed");
noToken.close();

/* ------------------------------------------------------------------ outbox --- */

check(
  "backoff starts at 1s and caps at 30s",
  retryDelayMs(0) === 1000 && retryDelayMs(1) === 2000 && retryDelayMs(9) === 30000,
);
check("the attempt ceiling is pinned", OUTBOX_MAX_ATTEMPTS === 5);

check(
  "a network failure is retryable",
  classifySendFailure(new ApiError({ kind: "network" })).kind === "retryable",
);
check(
  "an aborted request is retryable, not permanent",
  classifySendFailure(new ApiError({ kind: "aborted" })).kind === "retryable",
);
check(
  "a 429/500 is retryable",
  classifySendFailure(new ApiError({ kind: "http", status: 429 })).kind === "retryable" &&
    classifySendFailure(new ApiError({ kind: "http", status: 503 })).kind === "retryable",
);
check(
  "a 400/403 is permanent",
  classifySendFailure(new ApiError({ kind: "http", status: 400 })).kind === "refused" &&
    classifySendFailure(new ApiError({ kind: "http", status: 403, code: "BLOCKED" })).kind ===
      "refused",
);
check(
  "a send refusal is permanent and keeps its copy",
  classifySendFailure(new SendRefusedError()).kind === "refused" &&
    classifySendFailure(new SendRefusedError()).message === SECURE_CHAT_WAITING,
);
check(
  "an unknown error is treated as retryable rather than dropped",
  classifySendFailure(new Error("weird")).kind === "retryable",
);

const item = createOutboxItem({
  clientId: "c_w1",
  accountId: "u_1",
  conversationId: "c_1",
  plaintext: "hello",
  wireBody: "KP1.abc",
});
check("a new item starts queued with no attempts", item.state === "queued" && item.attempts === 0);

const sent = applySendOutcome(item, { kind: "sent" });
check("a sent item leaves the queue", sent.keep === false && sent.item.state === "sent");
const refused = applySendOutcome(item, { kind: "refused", message: SECURE_CHAT_WAITING });
check(
  "a refused item leaves the queue and stays actionable",
  refused.keep === false && refused.item.state === "refused" && isActionable(refused.item),
);

let walking = item;
for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS - 1; attempt += 1) {
  const next = applySendOutcome(walking, { kind: "retryable", message: "Could not connect." });
  check(
    `retryable attempt ${attempt + 1} stays queued`,
    next.keep === true && next.item.state === "queued" && next.item.attempts === attempt + 1,
  );
  walking = next.item;
}
const exhausted = applySendOutcome(walking, { kind: "retryable", message: "Could not connect." });
check(
  "the last attempt marks the item failed but keeps it for the user",
  exhausted.item.state === "failed" && exhausted.keep === true && isActionable(exhausted.item),
);
check(
  "pending counts only queued/sending items",
  pendingCount([item, { ...item, state: "sending" }, exhausted.item]) === 2,
);

const store = createMemoryOutboxStore();
await store.put(item);
await store.put({ ...item, clientId: "c_w2", accountId: "u_other" });
check("the outbox is account-scoped", (await store.list("u_1")).length === 1);
await store.remove("c_w1");
check("a confirmed send is removed", (await store.list("u_1")).length === 0);
await store.put(item);
await store.clearAccount("u_1");
check(
  "signing out can clear an account's queue",
  (await store.list("u_1")).length === 0 && store.snapshot().length === 1,
);

const drafts = createMemoryDraftStore();
await drafts.write("c_1", "typed but not sent");
check(
  "a draft survives independently of the queue",
  (await drafts.read("c_1")) === "typed but not sent",
);
await drafts.write("c_1", "");
check("an empty draft is cleared rather than stored", (await drafts.read("c_1")) === "");
await drafts.write("c_2", "x".repeat(9000));
check(
  "a draft is capped at the message body limit",
  (await drafts.read("c_2")).length === MESSAGE_BODY_LIMIT,
);

/* -------------------------------------------------------------------- copy --- */

check(
  "quick reactions are a frozen catalog of six",
  QUICK_REACTIONS.length === 6 &&
    Object.isFrozen(QUICK_REACTIONS) &&
    QUICK_REACTION_EMOJI.length === 6,
);
check(
  "every quick reaction has a spoken label",
  QUICK_REACTIONS.every((reaction) => reaction.label.length > 0 && reaction.emoji.length > 0),
);
check(
  "capability copy states the real browser limits",
  CAPABILITY_COPY.captureWarning.includes("cannot block") &&
    CAPABILITY_COPY.mediaNotEncrypted.includes("not end-to-end encrypted"),
);

console.log(lines.join("\n"));
