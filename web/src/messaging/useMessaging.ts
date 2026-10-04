/**
 * Messaging orchestration: conversation list, open chat, realtime sockets,
 * sealed bodies, the persistent outbox and drafts.
 *
 * Reconciliation rules that matter (each one caused a visible bug in the
 * phone client at some point):
 *   - the server page is authoritative; a local echo survives only while no
 *     confirmed row carries the same `clientId`;
 *   - read markers only move forward;
 *   - a `message` frame for our own send replaces the echo instead of
 *     appending a second bubble;
 *   - a refused send is permanent and gives its text back to the composer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { ApiError, apiErrorMessage } from "../api";
import {
  SECURE_CHAT_WAITING,
  decryptMessageBody,
  protectOutgoingBody,
  type E2eeIdentity,
} from "./e2ee";
import { messagingApi } from "./messagingApi";
import {
  applyDeliveredFrame,
  applyMessageFrame,
  advanceReadMarker,
  compareMessages,
  conversationPeerId,
  conversationPeerKey,
  conversationTitle,
  createLocalEcho,
  isOneWayConversation,
  isTypingActive,
  newClientId,
  parseConversationRow,
  prependOlderPage,
  reconcileMessagePage,
  upsertConversation,
  type ConversationRow,
  type MessageRow,
  type ReplyTarget,
} from "./protocol";
import {
  applySendOutcome,
  classifySendFailure,
  createMemoryDraftStore,
  createMemoryOutboxStore,
  createOutboxItem,
  createPersistentStores,
  isIndexedDbUsable,
  pendingCount,
  type OutboxItem,
  type OutboxStore,
} from "./outbox";
import { createManagedSocket, type ManagedSocket, type SocketStatus } from "./sockets";

const TYPING_THROTTLE_MS = 2_000;
const TYPING_IDLE_MS = 3_000;
const NOTICE_TIMEOUT_MS = 6_000;

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type MessagingState = {
  conversations: readonly ConversationRow[];
  listStatus: LoadStatus;
  listError: string;
  totalUnread: number;
  selected: ConversationRow | null;
  messagesStatus: LoadStatus;
  messagesError: string;
  messages: readonly MessageRow[];
  displayBodies: Readonly<Record<string, string>>;
  sealedCount: number;
  hasMore: boolean;
  loadingOlder: boolean;
  otherReadAt: string;
  typingActive: boolean;
  draft: string;
  replyTo: ReplyTarget | null;
  outbox: readonly OutboxItem[];
  pendingSends: number;
  listSocket: SocketStatus;
  chatSocket: SocketStatus;
  notice: string;
  oneWay: boolean;
  durable: boolean;
};

export type MessagingActions = {
  refreshList: () => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  setDraft: (text: string) => void;
  composerChanged: () => void;
  send: () => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => Promise<void>;
  setReplyTo: (target: ReplyTarget | null) => void;
  react: (messageId: string, emoji: string) => Promise<void>;
  editMessage: (messageId: string, text: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  dismissNotice: () => void;
  announce: (message: string) => void;
};

export type MessagingController = MessagingState & MessagingActions;

type Options = {
  api: ApiClient;
  enabled: boolean;
  token: string;
  meId: string;
  identity: E2eeIdentity | null;
  selectedId: string;
};

export function useMessaging(options: Options): MessagingController {
  const { api, enabled, token, meId, identity, selectedId } = options;

  const stores = useMemo(() => {
    if (!isIndexedDbUsable()) {
      return {
        outbox: createMemoryOutboxStore() as OutboxStore,
        drafts: createMemoryDraftStore(),
        durable: false,
      };
    }
    const persistent = createPersistentStores();
    return { outbox: persistent.outbox, drafts: persistent.drafts, durable: persistent.durable };
  }, []);

  const [conversations, setConversations] = useState<readonly ConversationRow[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>("idle");
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>("idle");
  const [messagesError, setMessagesError] = useState("");
  const [messages, setMessages] = useState<readonly MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [cursor, setCursor] = useState<{ before: string; beforeRowid: number }>({
    before: "",
    beforeRowid: 0,
  });
  const [otherReadAt, setOtherReadAt] = useState("");
  const [typingActive, setTypingActive] = useState(false);
  const [draft, setDraftState] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const [listSocketStatus, setListSocketStatus] = useState<SocketStatus>("idle");
  const [chatSocketStatus, setChatSocketStatus] = useState<SocketStatus>("idle");
  const [notice, setNotice] = useState("");

  const selectedRef = useRef<ConversationRow | null>(null);
  selectedRef.current = selected;
  const messagesRef = useRef<readonly MessageRow[]>([]);
  messagesRef.current = messages;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const outboxRef = useRef<readonly OutboxItem[]>([]);
  outboxRef.current = outbox;
  const noticeTimer = useRef<number | null>(null);
  const typingSentAt = useRef(0);
  const typingIdleTimer = useRef<number | null>(null);
  const retryTimers = useRef(new Map<string, number>());

  const announce = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (message) {
      noticeTimer.current = window.setTimeout(() => setNotice(""), NOTICE_TIMEOUT_MS);
    } else {
      noticeTimer.current = null;
    }
  }, []);

  const dismissNotice = useCallback(() => announce(""), [announce]);

  /* -------------------------------------------------------- conversation list */

  const refreshList = useCallback(async () => {
    if (!enabled || !token) return;
    setListStatus((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const rows = await messagingApi.listConversations(api);
      setConversations(rows);
      setListError("");
      setListStatus("ready");
      // Keep the open chat's header in step with the refreshed row.
      const openId = selectedRef.current?.id;
      if (openId) {
        const fresh = rows.find((row) => row.id === openId);
        if (fresh) setSelected(fresh);
      }
    } catch (error) {
      if (error instanceof ApiError && error.kind === "aborted") return;
      setListError(apiErrorMessage(error));
      setListStatus("error");
    }
  }, [api, enabled, token]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!enabled || !token) return;
    const socket = createManagedSocket({
      path: "/ws/user",
      token,
      onStatus: setListSocketStatus,
      onFrame: (frame) => {
        if (frame.type !== "conv") return;
        void refreshList();
      },
      shouldReconnect: () => Boolean(token),
    });
    return () => socket.close();
  }, [enabled, refreshList, token]);

  /* ------------------------------------------------------------- open a chat */

  const hydrateOutbox = useCallback(async () => {
    if (!enabled || !meId) return;
    const items = await stores.outbox.list(meId);
    setOutbox(items);
  }, [enabled, meId, stores.outbox]);

  useEffect(() => {
    void hydrateOutbox();
  }, [hydrateOutbox]);

  const loadDraft = useCallback(
    async (conversationId: string) => {
      const stored = await stores.drafts.read(conversationId);
      setDraftState(stored);
    },
    [stores.drafts],
  );

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (!enabled || !token || !conversationId) return;

      const known = conversations.find((row) => row.id === conversationId) ?? null;
      setSelected(known);
      setMessages([]);
      setMessagesStatus("loading");
      setMessagesError("");
      setOtherReadAt("");
      setTypingActive(false);
      setReplyTo(null);
      setHasMore(false);
      setCursor({ before: "", beforeRowid: 0 });

      let conversation = known;
      if (!conversation) {
        try {
          conversation = await messagingApi.getConversation(api, conversationId);
        } catch (error) {
          if (!(error instanceof ApiError && error.kind === "aborted")) {
            setMessagesError(apiErrorMessage(error));
            setMessagesStatus("error");
          }
          return;
        }
      }
      if (!conversation) {
        setMessagesError("That chat is no longer available.");
        setMessagesStatus("error");
        return;
      }
      setSelected(conversation);
      void loadDraft(conversationId);
      void messagingApi.markRead(api, conversationId);

      try {
        const page = await messagingApi.getMessages(api, conversationId);
        // The API page is newest-first; the transcript is rendered oldest-first.
        const items = [...page.items].sort(compareMessages);
        setMessages(items);
        setOtherReadAt(page.readAt);
        setHasMore(page.hasMore);
        const oldest = items[0];
        setCursor({
          before: page.oldest || oldest?.createdAt || "",
          beforeRowid: page.oldestRowid || oldest?.rowid || 0,
        });
        setMessagesStatus("ready");
        setMessagesError("");
      } catch (error) {
        if (error instanceof ApiError && error.kind === "aborted") return;
        setMessagesError(apiErrorMessage(error));
        setMessagesStatus("error");
      }
    },
    [api, conversations, enabled, loadDraft, token],
  );

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setMessages([]);
      setMessagesStatus("idle");
      return;
    }
    if (selectedRef.current?.id === selectedId && messagesStatus !== "idle") return;
    void selectConversation(selectedId);
    // `messagesStatus` is deliberately excluded: re-running on every status
    // change would refetch the transcript in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectConversation]);

  const loadOlder = useCallback(async () => {
    const conversation = selectedRef.current;
    if (!conversation || loadingOlder || !hasMore || !cursor.before) return;
    setLoadingOlder(true);
    try {
      const page = await messagingApi.getMessages(api, conversation.id, {
        before: cursor.before,
        beforeRowid: cursor.beforeRowid,
      });
      setMessages((current) => prependOlderPage(current, [...page.items].sort(compareMessages)));
      setHasMore(page.hasMore);
      const oldest = [...page.items].sort(compareMessages)[0];
      setCursor({
        before: page.oldest || oldest?.createdAt || cursor.before,
        beforeRowid: page.oldestRowid || oldest?.rowid || cursor.beforeRowid,
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.kind === "aborted")) {
        announce(apiErrorMessage(error));
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [announce, api, cursor.before, cursor.beforeRowid, hasMore, loadingOlder]);

  /* --------------------------------------------------------------- chat socket */

  useEffect(() => {
    // Keyed on the id, not the row object: a list refresh returns a new row
    // identity for the same chat, and depending on it would tear the socket
    // down and reconnect on every incoming message.
    if (!enabled || !token || !selectedId) return;
    const conversationId = selectedId;

    const socket = createManagedSocket({
      path: `/ws/chat/${encodeURIComponent(conversationId)}`,
      token,
      onStatus: setChatSocketStatus,
      shouldReconnect: () => selectedRef.current?.id === conversationId,
      onFrame: (frame) => {
        if (frame.type === "message") {
          if (frame.conversationId && frame.conversationId !== conversationId) return;
          const incoming = frame.message;

          if (incoming.kind === "DELETED") {
            setMessages((current) => current.filter((row) => row.id !== incoming.id));
            return;
          }

          setMessages((current) => applyMessageFrame(current, incoming, meId).messages);
          // A confirmed server row retires its queued outbox entry.
          if (incoming.clientId) {
            const queued = outboxRef.current.find((item) => item.clientId === incoming.clientId);
            if (queued) {
              void stores.outbox.remove(queued.clientId);
              setOutbox((current) => current.filter((item) => item.clientId !== queued.clientId));
            }
          }
          void messagingApi.markRead(api, conversationId);
          void refreshList();
          return;
        }

        if (frame.type === "read" && frame.userId !== meId) {
          setOtherReadAt((current) => advanceReadMarker(current, frame.at));
          return;
        }

        if (frame.type === "delivered") {
          setMessages(
            (current) => applyDeliveredFrame(current, frame.messageIds, frame.at).messages,
          );
          return;
        }

        if (frame.type === "typing" && frame.userId !== meId) {
          setTypingActive(frame.at !== "" && isTypingActive(frame.at));
          return;
        }

        if (frame.type === "conv") {
          void refreshList();
        }
      },
    });

    return () => socket.close();
  }, [api, enabled, meId, refreshList, selectedId, stores.outbox, token]);

  /* --------------------------------------------------------------- decryption */

  const [displayBodies, setDisplayBodies] = useState<Readonly<Record<string, string>>>({});
  const [sealedCount, setSealedCount] = useState(0);

  useEffect(() => {
    const conversation = selectedRef.current;
    if (!conversation) {
      setDisplayBodies({});
      setSealedCount(0);
      return;
    }

    let cancelled = false;
    const peerKey = conversationPeerKey(conversation);

    void (async () => {
      const next: Record<string, string> = {};
      let sealed = 0;
      for (const message of messagesRef.current) {
        const result = await decryptMessageBody(message.body, peerKey, identityRef.current);
        if (cancelled) return;
        if (result.sealed) sealed += 1;
        next[message.id] = result.text;
      }
      if (cancelled) return;
      setDisplayBodies(next);
      setSealedCount(sealed);
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, messages, selected]);

  /* ------------------------------------------------------------------ sending */

  const attemptItem = useCallback(
    async (item: OutboxItem) => {
      const conversation = selectedRef.current;
      if (!conversation || conversation.id !== item.conversationId) return;

      const sending: OutboxItem = { ...item, state: "sending" };
      setOutbox((current) =>
        current.map((row) => (row.clientId === item.clientId ? sending : row)),
      );

      try {
        const result = await messagingApi.sendMessage(api, item.conversationId, {
          kind: "TEXT",
          body: item.wireBody,
          clientId: item.clientId,
          replyTo: item.replyToId || undefined,
        });
        await stores.outbox.remove(item.clientId);
        setOutbox((current) => current.filter((row) => row.clientId !== item.clientId));
        if (result.message) {
          setMessages((current) => applyMessageFrame(current, result.message!, meId).messages);
        }
        void refreshList();
      } catch (error) {
        const outcome = classifySendFailure(error);
        const { item: next, keep } = applySendOutcome(item, outcome);

        if (outcome.kind === "refused") {
          await stores.outbox.remove(item.clientId);
          setOutbox((current) => current.filter((row) => row.clientId !== item.clientId));
          setMessages((current) =>
            current.map((row) =>
              row.clientId === item.clientId
                ? { ...row, localState: "failed" as const, localError: outcome.message }
                : row,
            ),
          );
          if (outcome.message === SECURE_CHAT_WAITING) {
            // Give the text back: a policy refusal is not a lost draft.
            await stores.drafts.write(item.conversationId, item.plaintext);
            setDraftState(item.plaintext);
          }
          announce(outcome.message);
          return;
        }

        if (keep) {
          await stores.outbox.put(next);
          setOutbox((current) =>
            current.map((row) => (row.clientId === next.clientId ? next : row)),
          );
          setMessages((current) =>
            current.map((row) =>
              row.clientId === item.clientId
                ? {
                    ...row,
                    localState:
                      next.state === "failed" ? ("failed" as const) : ("pending" as const),
                    localError: next.lastError,
                  }
                : row,
            ),
          );
          if (next.state === "queued") {
            const delay = Math.min(30_000, 1_000 * 2 ** Math.min(next.attempts, 5));
            const timer = window.setTimeout(() => {
              retryTimers.current.delete(next.clientId);
              void attemptItem(next);
            }, delay);
            retryTimers.current.set(next.clientId, timer);
          } else {
            announce("Message not sent. Retry from the composer.");
          }
        }
      }
    },
    [announce, api, meId, refreshList, stores.drafts, stores.outbox],
  );

  const send = useCallback(async () => {
    const conversation = selectedRef.current;
    const plaintext = draft.trim();
    if (!conversation || !plaintext || !meId) return;
    if (isOneWayConversation(conversation)) {
      announce("This account only sends notifications; replies are not accepted.");
      return;
    }

    const clientId = newClientId();
    let wireBody: string;
    try {
      wireBody = await protectOutgoingBody(
        plaintext,
        { isGroup: conversation.isGroup, otherId: conversationPeerId(conversation) },
        conversationPeerKey(conversation),
        identity,
      );
    } catch (error) {
      announce((error as Error).message || SECURE_CHAT_WAITING);
      return;
    }

    const item = createOutboxItem({
      clientId,
      accountId: meId,
      conversationId: conversation.id,
      plaintext,
      wireBody,
      replyToId: replyTo?.id ?? "",
      replyTo,
    });

    await stores.outbox.put(item);
    setOutbox((current) => [...current, item]);
    setMessages((current) =>
      [...current, createLocalEcho({ clientId, senderId: meId, plaintext, replyTo })].sort(
        compareMessages,
      ),
    );

    setDraftState("");
    await stores.drafts.clear(conversation.id);
    setReplyTo(null);
    void messagingApi.setTyping(api, conversation.id, "clear");

    await attemptItem(item);
  }, [announce, api, attemptItem, draft, identity, meId, replyTo, stores.drafts, stores.outbox]);

  const retry = useCallback(
    async (clientId: string) => {
      const item = outboxRef.current.find((row) => row.clientId === clientId);
      if (!item) return;
      const reset: OutboxItem = { ...item, state: "queued", attempts: 0, lastError: "" };
      await stores.outbox.put(reset);
      setOutbox((current) => current.map((row) => (row.clientId === clientId ? reset : row)));
      setMessages((current) =>
        current.map((row) =>
          row.clientId === clientId
            ? { ...row, localState: "pending" as const, localError: "" }
            : row,
        ),
      );
      await attemptItem(reset);
    },
    [attemptItem, stores.outbox],
  );

  const discard = useCallback(
    async (clientId: string) => {
      const item = outboxRef.current.find((row) => row.clientId === clientId);
      await stores.outbox.remove(clientId);
      setOutbox((current) => current.filter((row) => row.clientId !== clientId));
      setMessages((current) => current.filter((row) => row.clientId !== clientId));
      if (item?.plaintext) {
        await stores.drafts.write(item.conversationId, item.plaintext);
        setDraftState(item.plaintext);
        announce("Send discarded. The text is back in the composer.");
      }
    },
    [announce, stores.drafts, stores.outbox],
  );

  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);
      const conversation = selectedRef.current;
      if (conversation) void stores.drafts.write(conversation.id, text);
    },
    [stores.drafts],
  );

  /** Throttled typing ping; the Worker swallows pings across a block. */
  const composerChanged = useCallback(() => {
    const conversation = selectedRef.current;
    if (!conversation || isOneWayConversation(conversation)) return;
    const now = Date.now();
    if (now - typingSentAt.current >= TYPING_THROTTLE_MS) {
      typingSentAt.current = now;
      void messagingApi.setTyping(api, conversation.id, "text");
    }
    if (typingIdleTimer.current) window.clearTimeout(typingIdleTimer.current);
    typingIdleTimer.current = window.setTimeout(() => {
      const open = selectedRef.current;
      if (open) void messagingApi.setTyping(api, open.id, "clear");
    }, TYPING_IDLE_MS);
  }, [api]);

  /* --------------------------------------------------------- message actions */

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      try {
        const updated = await messagingApi.react(api, messageId, emoji);
        if (updated) setMessages((current) => applyMessageFrame(current, updated, meId).messages);
      } catch (error) {
        announce(apiErrorMessage(error));
      }
    },
    [announce, api, meId],
  );

  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      const conversation = selectedRef.current;
      const trimmed = text.trim();
      if (!conversation || !trimmed) return;

      // An edited sealed message is re-sealed, exactly like the send path.
      let wireBody = trimmed;
      try {
        wireBody = await protectOutgoingBody(
          trimmed,
          { isGroup: conversation.isGroup, otherId: conversationPeerId(conversation) },
          conversationPeerKey(conversation),
          identity,
        );
      } catch (error) {
        announce((error as Error).message || SECURE_CHAT_WAITING);
        return;
      }

      try {
        const updated = await messagingApi.editMessage(api, messageId, wireBody);
        if (updated) setMessages((current) => applyMessageFrame(current, updated, meId).messages);
        announce("Message edited.");
      } catch (error) {
        announce(apiErrorMessage(error));
      }
    },
    [announce, api, identity, meId],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const removed = await messagingApi.deleteMessage(api, messageId);
        if (removed) {
          setMessages((current) => current.filter((row) => row.id !== messageId));
          void refreshList();
          announce("Message deleted for everyone.");
        }
      } catch (error) {
        announce(apiErrorMessage(error));
      }
    },
    [announce, api, refreshList],
  );

  useEffect(
    () => () => {
      for (const timer of retryTimers.current.values()) window.clearTimeout(timer);
      retryTimers.current.clear();
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (typingIdleTimer.current) window.clearTimeout(typingIdleTimer.current);
    },
    [],
  );

  const totalUnread = useMemo(
    () => conversations.reduce((sum, row) => sum + row.unread, 0),
    [conversations],
  );

  return {
    conversations,
    listStatus,
    listError,
    totalUnread,
    selected,
    messagesStatus,
    messagesError,
    messages,
    displayBodies,
    sealedCount,
    hasMore,
    loadingOlder,
    otherReadAt,
    typingActive,
    draft,
    replyTo,
    outbox,
    pendingSends: pendingCount(outbox),
    listSocket: listSocketStatus,
    chatSocket: chatSocketStatus,
    notice,
    oneWay: selected ? isOneWayConversation(selected) : false,
    durable: stores.durable,
    refreshList,
    selectConversation,
    loadOlder,
    setDraft,
    composerChanged,
    send,
    retry,
    discard,
    setReplyTo,
    react,
    editMessage,
    deleteMessage,
    dismissNotice,
    announce,
  };
}

export { conversationTitle, parseConversationRow };
