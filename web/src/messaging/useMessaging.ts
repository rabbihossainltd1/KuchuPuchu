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
  createLocalAttachmentEcho,
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
import { requestWsTicket } from "./wsTicket";
import { fetchMessageMediaBlob, uploadFile } from "./filesApi";
import { attachmentMeta, type PendingAttachment } from "./attachments";
import { albumId } from "../media/uploadContract";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, voiceTooBigMessage } from "./voice";
import type { VoiceTake } from "./voiceRecorder";
import {
  REUPLOAD_PHOTO_NAME,
  REUPLOAD_PHOTO_TYPE,
  albumForForward,
  forwardFileName,
  forwardFileType,
  forwardMetaOf,
  forwardNotice,
  forwardShapeOf,
  type ForwardItem,
} from "./forward";
import { EMPTY_SHARED_MEDIA, sharedMediaRefusal, type SharedMedia } from "./sharedMedia";
import { VANISH_GRACE_MS, createViewOnceSpender } from "./viewOnce";
import { isVanishedMarker } from "./protocol";
import { chatThemeOr, type ChatTheme } from "./chatTheme";

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
  /**
   * What the other side is doing: "" / "text" / "voice". A voice note being
   * recorded shows a microphone instead of typing dots (r55, r56 item 2).
   */
  typingKind: string;
  draft: string;
  replyTo: ReplyTarget | null;
  outbox: readonly OutboxItem[];
  pendingSends: number;
  listSocket: SocketStatus;
  chatSocket: SocketStatus;
  notice: string;
  oneWay: boolean;
  durable: boolean;
  /** Rows playing their vanish animation after a spent view-once opening. */
  vanishingIds: readonly string[];
  /** Ids that have left the transcript, so the media panel can agree with it. */
  hiddenMessageIds: readonly string[];
  sharedMedia: SharedMedia;
  sharedMediaStatus: LoadStatus;
  sharedMediaError: string;
};

export type MessagingActions = {
  refreshList: () => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  setDraft: (text: string) => void;
  composerChanged: () => void;
  send: () => Promise<void>;
  sendSticker: (glyph: string) => Promise<void>;
  sendAttachments: (items: readonly PendingAttachment[], caption: string) => Promise<void>;
  /** Upload and post a recorded voice note (`sendVoice` on the phone). */
  sendVoice: (take: VoiceTake, once: boolean) => Promise<void>;
  /** Copy selected rows into other chats (`forwardSelected` / `forwardMessageTo`). */
  forwardMessages: (items: readonly ForwardItem[], targetIds: readonly string[]) => Promise<void>;
  /** Ping `typing` with a kind: "text" | "voice" | "clear". */
  pingTyping: (kind: "text" | "voice" | "clear") => void;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => Promise<void>;
  setReplyTo: (target: ReplyTarget | null) => void;
  react: (messageId: string, emoji: string) => Promise<void>;
  editMessage: (messageId: string, text: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  /** Hide rows on this device only (the phone's "Delete for me"). */
  hideMessages: (messageIds: readonly string[]) => void;
  /** Report the single opening of a view-once message. */
  spendViewOnce: (messageId: string) => void;
  openSharedMedia: () => Promise<void>;
  retrySharedMedia: () => Promise<void>;
  closeSharedMedia: () => void;
  dismissNotice: () => void;
  announce: (message: string) => void;
  /** Slice I: change this chat's theme (Android's per-chat theme picker). */
  setChatTheme: (theme: ChatTheme) => Promise<void>;
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
  const [vanishingIds, setVanishingIds] = useState<readonly string[]>([]);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<readonly string[]>([]);
  const [sharedMedia, setSharedMedia] = useState<SharedMedia>(EMPTY_SHARED_MEDIA);
  const [sharedMediaStatus, setSharedMediaStatus] = useState<LoadStatus>("idle");
  const [sharedMediaError, setSharedMediaError] = useState("");
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
  const [typingKind, setTypingKind] = useState("");
  const conversationsRef = useRef<readonly ConversationRow[]>([]);
  const [draft, setDraftState] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const [listSocketStatus, setListSocketStatus] = useState<SocketStatus>("idle");
  const [chatSocketStatus, setChatSocketStatus] = useState<SocketStatus>("idle");
  const [notice, setNotice] = useState("");

  const selectedRef = useRef<ConversationRow | null>(null);
  selectedRef.current = selected;
  conversationsRef.current = conversations;
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
  const vanishTimers = useRef(new Map<string, number>());

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

  /* ------------------------------------------------------------- view once */

  const viewOnceSpender = useMemo(
    () =>
      createViewOnceSpender((messageId) => messagingApi.reportViewOnce(api, messageId), {
        onSettled: () => void refreshList(),
      }),
    [api, refreshList],
  );

  const spendViewOnce = useCallback(
    (messageId: string) => viewOnceSpender.spend(messageId),
    [viewOnceSpender],
  );

  /**
   * Hide rows on THIS device only — the phone's "Delete for me".
   *
   * Android keeps the ids in its local store; a browser tab keeps them in
   * memory, so the rows come back on a reload and the selection bar says so
   * instead of implying a durable delete. The vanish show plays first, exactly
   * as it does for a server VANISHED frame, so rows do not pop out of the list.
   */
  const hideMessages = useCallback((messageIds: readonly string[]) => {
    const ids = messageIds.filter((id) => id.length > 0);
    if (ids.length === 0) return;
    setVanishingIds((current) => [...new Set([...current, ...ids])]);
    ids.forEach((id) => {
      const existing = vanishTimers.current.get(`hide:${id}`);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        setMessages((current) => current.filter((row) => row.id !== id));
        setHiddenMessageIds((current) => (current.includes(id) ? current : [...current, id]));
        setVanishingIds((current) => current.filter((row) => row !== id));
        vanishTimers.current.delete(`hide:${id}`);
      }, VANISH_GRACE_MS);
      vanishTimers.current.set(`hide:${id}`, timer);
    });
  }, []);

  /* ---------------------------------------------------------- shared media */

  const fetchSharedMedia = useCallback(async () => {
    if (!enabled || !selectedId) return;
    const conversationId = selectedId;
    setSharedMediaStatus("loading");
    setSharedMediaError("");
    try {
      const payload = await messagingApi.fetchSharedMedia(api, conversationId);
      // A late answer for a chat the reader has already left is dropped.
      if (selectedRef.current?.id !== conversationId) return;
      setSharedMedia(payload);
      setSharedMediaStatus("ready");
    } catch (error) {
      if (selectedRef.current?.id !== conversationId) return;
      const code = error instanceof ApiError && error.code ? error.code : "";
      setSharedMedia(EMPTY_SHARED_MEDIA);
      setSharedMediaError(
        code ? sharedMediaRefusal(code, apiErrorMessage(error)) : apiErrorMessage(error),
      );
      setSharedMediaStatus("error");
    }
  }, [api, enabled, selectedId]);

  const openSharedMedia = useCallback(async () => {
    await fetchSharedMedia();
  }, [fetchSharedMedia]);

  const retrySharedMedia = useCallback(async () => {
    await fetchSharedMedia();
  }, [fetchSharedMedia]);

  const closeSharedMedia = useCallback(() => {
    setSharedMedia(EMPTY_SHARED_MEDIA);
    setSharedMediaStatus("idle");
    setSharedMediaError("");
  }, []);

  useEffect(() => {
    if (!enabled || !token) return;
    const socket = createManagedSocket({
      path: "/ws/user",
      acquireTicket: () => requestWsTicket(token),
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
      // Another chat's gallery must never survive the switch: a panel showing
      // the previous conversation's photos is a privacy bug, not a stale view.
      setSharedMedia(EMPTY_SHARED_MEDIA);
      setSharedMediaStatus("idle");
      setSharedMediaError("");
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
      acquireTicket: () => requestWsTicket(token),
      onStatus: setChatSocketStatus,
      shouldReconnect: () => selectedRef.current?.id === conversationId,
      onFrame: (frame) => {
        if (frame.type === "message") {
          if (frame.conversationId && frame.conversationId !== conversationId) return;
          const incoming = frame.message;

          if (incoming.kind === "DELETED") {
            setMessages((current) => current.filter((row) => row.id !== incoming.id));
            setHiddenMessageIds((current) =>
              current.includes(incoming.id) ? current : [...current, incoming.id],
            );
            return;
          }

          // A spent view-once row is gone for everyone: play the short vanish,
          // then drop it. No tombstone is left behind, on either side.
          if (isVanishedMarker(incoming)) {
            const vanishedId = incoming.id;
            setVanishingIds((current) =>
              current.includes(vanishedId) ? current : [...current, vanishedId],
            );
            setHiddenMessageIds((current) =>
              current.includes(vanishedId) ? current : [...current, vanishedId],
            );
            vanishTimers.current.set(
              `vanish:${vanishedId}`,
              window.setTimeout(() => {
                setMessages((current) => current.filter((row) => row.id !== vanishedId));
                setVanishingIds((current) => current.filter((id) => id !== vanishedId));
                vanishTimers.current.delete(`vanish:${vanishedId}`);
              }, VANISH_GRACE_MS),
            );
            void refreshList();
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
          const active = frame.at !== "" && isTypingActive(frame.at);
          setTypingActive(active);
          setTypingKind(active ? frame.kind || "text" : "");
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

  /**
   * A sticker is a TEXT-shaped send with `kind: "STICKER"` and the glyph in the
   * body — what Android's `sendText(content, "STICKER")` posts — so it goes
   * through the same seal path and the same optimistic echo, minus the upload.
   */
  const sendSticker = useCallback(
    async (glyph: string) => {
      const conversation = selectedRef.current;
      if (!conversation || !meId || !glyph) return;
      if (isOneWayConversation(conversation)) {
        announce("This account only sends notifications; replies are not accepted.");
        return;
      }

      let wireBody: string;
      try {
        wireBody = await protectOutgoingBody(
          glyph,
          { isGroup: conversation.isGroup, otherId: conversationPeerId(conversation) },
          conversationPeerKey(conversation),
          identity,
        );
      } catch (error) {
        announce((error as Error).message || SECURE_CHAT_WAITING);
        return;
      }

      const clientId = newClientId();
      const echo = createLocalAttachmentEcho({
        clientId,
        senderId: meId,
        kind: "STICKER",
        body: glyph,
        fileName: "",
        fileType: "",
        fileSize: 0,
        replyTo,
      });
      setMessages((current) => [...current, echo].sort(compareMessages));

      try {
        const result = await messagingApi.sendMessage(api, conversation.id, {
          kind: "STICKER",
          body: wireBody,
          clientId,
          replyTo: replyTo?.id || undefined,
        });
        if (result.message) {
          const confirmed = result.message;
          setMessages((current) => applyMessageFrame(current, confirmed, meId).messages);
        } else {
          setMessages((current) =>
            current.map((row) =>
              row.clientId === clientId ? { ...row, localState: "" as const } : row,
            ),
          );
        }
        setReplyTo(null);
        void refreshList();
      } catch (error) {
        setMessages((current) =>
          current.map((row) =>
            row.clientId === clientId
              ? { ...row, localState: "failed" as const, localError: apiErrorMessage(error) }
              : row,
          ),
        );
        announce("Sticker not sent. Retry from the message actions.");
      }
    },
    [announce, api, identity, meId, refreshList, replyTo],
  );

  /**
   * Upload and post composer attachments, one row per file.
   *
   * Attachments do not join the durable outbox: a Blob cannot be reliably
   * resurrected from IndexedDB in every browser, so an unsent file stays in the
   * composer and a failed upload marks its own bubble. The caption rides on the
   * first row only — repeating it on every row of a multi-photo send would
   * render it four times on the phone.
   */
  const sendAttachments = useCallback(
    async (items: readonly PendingAttachment[], caption: string) => {
      const conversation = selectedRef.current;
      if (!conversation || !meId || items.length === 0) return;
      if (isOneWayConversation(conversation)) {
        announce("This account only sends notifications; replies are not accepted.");
        return;
      }

      const trimmed = caption.trim();
      let sealedCaption = "";
      if (trimmed) {
        try {
          sealedCaption = await protectOutgoingBody(
            trimmed,
            { isGroup: conversation.isGroup, otherId: conversationPeerId(conversation) },
            conversationPeerKey(conversation),
            identity,
          );
        } catch (error) {
          announce((error as Error).message || SECURE_CHAT_WAITING);
          return;
        }
      }

      // One album id for a multi-photo send, so the phone groups them. A
      // view-once photo never joins an album — one tap is one opening, and the
      // Worker drops the id on such a row anyway.
      const photos = items.filter((item) => item.intent === "photo");
      const once = items.some((item) => item.viewOnce);
      const album = photos.length > 1 && !once ? albumId() : "";

      for (const [index, item] of items.entries()) {
        const clientId = newClientId();
        const meta = attachmentMeta(item, album || undefined);
        const preview = item.previewUrl ?? "";
        const echo = createLocalAttachmentEcho({
          clientId,
          senderId: meId,
          kind: "FILE",
          body: index === 0 ? trimmed : "",
          fileName: item.name,
          fileType: item.type,
          fileSize: item.size,
          mediaWidth: item.width,
          mediaHeight: item.height,
          meta,
          viewOnce: item.viewOnce,
          localPreview: preview,
          replyTo: index === 0 ? replyTo : null,
        });
        setMessages((current) => [...current, echo].sort(compareMessages));

        try {
          const uploaded = await uploadFile(api, {
            name: item.name,
            type: item.type,
            blob: item.blob,
            onProgress: (progress) => {
              const percent = progress.total
                ? Math.min(99, Math.round((progress.sent / progress.total) * 100))
                : 0;
              setMessages((current) =>
                current.map((row) =>
                  row.clientId === clientId ? { ...row, localProgress: percent } : row,
                ),
              );
            },
          });

          const result = await messagingApi.sendMessage(api, conversation.id, {
            kind: "FILE",
            body: index === 0 ? sealedCaption : "",
            clientId,
            replyTo: index === 0 ? replyTo?.id || undefined : undefined,
            fileName: item.name,
            fileType: item.type,
            fileSize: uploaded.size,
            fileKey: uploaded.fileKey,
            meta,
            // Android sends the flag in both places; the Worker reads `meta`.
            ...(item.viewOnce ? { viewOnce: true } : {}),
          });

          if (result.message) {
            const confirmed = result.message;
            setMessages((current) => {
              const next = applyMessageFrame(current, confirmed, meId).messages;
              // Keep the local object URL on the confirmed row: otherwise the
              // thumbnail blanks while the Bearer-gated download restarts.
              return next.map((row) =>
                row.id === confirmed.id && !row.localPreview
                  ? { ...row, localPreview: preview, localProgress: 100 }
                  : row,
              );
            });
          } else {
            setMessages((current) =>
              current.map((row) =>
                row.clientId === clientId
                  ? { ...row, localState: "" as const, localProgress: 100 }
                  : row,
              ),
            );
          }
        } catch (error) {
          setMessages((current) =>
            current.map((row) =>
              row.clientId === clientId
                ? { ...row, localState: "failed" as const, localError: apiErrorMessage(error) }
                : row,
            ),
          );
          announce(`${item.pickedName} did not send.`);
        }
      }

      setReplyTo(null);
      void refreshList();
    },
    [announce, api, identity, meId, refreshList, replyTo],
  );

  /**
   * A recorded voice note: the phone's `sendVoice`.
   *
   * Same shape as an attachment send, with three voice-specific rules:
   *   • the ceiling is `VOICE_MAX_BYTES`, checked here and not by
   *     `mediaLimitFor` — that function's video branch matches a `.webm` NAME
   *     before its audio branch runs, so it would answer 2 GB for a voice note
   *     (the phone's `Api.mediaLimit` orders the branches the same way, and
   *     `sendVoice` checks `Api.VOICE_MAX` for exactly this reason);
   *   • `meta` carries `voice`, whole `seconds` and the recorded `waveform`, so
   *     every client draws the same bars without decoding the audio. The worker
   *     clamps seconds to 0…600 and keeps at most 64 bars;
   *   • the recorded blob becomes the echo's `localPreview`, so the sender's own
   *     bubble plays instantly instead of downloading what it just uploaded.
   *     That object URL lives as long as the page — the row keeps pointing at
   *     it after the server confirms, exactly as a photo echo keeps its thumb.
   */
  const sendVoice = useCallback(
    async (take: VoiceTake, once: boolean) => {
      const conversation = selectedRef.current;
      if (!conversation || !meId) return;
      if (isOneWayConversation(conversation)) {
        announce("This account only sends notifications; replies are not accepted.");
        return;
      }
      if (take.size > VOICE_MAX_BYTES) {
        announce(voiceTooBigMessage(take.size));
        return;
      }

      const clientId = newClientId();
      const meta: Record<string, unknown> = {
        voice: true,
        seconds: Math.max(0, Math.min(VOICE_MAX_SECONDS, take.seconds)),
        // The echo and the confirmed row share this seed, so the bars do not
        // redraw when the server's id replaces the local one (Android's E3).
        clientId,
      };
      if (take.waveform.length > 0) meta.waveform = take.waveform;
      // The Worker's `viewOnceFlag` reads the flag from META (`meta.viewOnce !==
      // true` returns false), so a note sent with only the top-level flag would
      // be stored as an ordinary voice note — one opening nobody enforces.
      // Android sends it in both places for the same reason.
      if (once) meta.viewOnce = true;

      const preview =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(take.blob)
          : "";
      const currentReply = replyTo;
      const echo = createLocalAttachmentEcho({
        clientId,
        senderId: meId,
        kind: "FILE",
        body: "",
        fileName: take.name,
        fileType: take.mime,
        fileSize: take.size,
        meta,
        viewOnce: once,
        localPreview: preview,
        replyTo: currentReply,
      });
      setMessages((current) => [...current, echo].sort(compareMessages));
      setReplyTo(null);

      try {
        const uploaded = await uploadFile(api, {
          name: take.name,
          type: take.mime,
          blob: take.blob,
          onProgress: (progress) => {
            const percent = progress.total
              ? Math.min(99, Math.round((progress.sent / progress.total) * 100))
              : 0;
            setMessages((current) =>
              current.map((row) =>
                row.clientId === clientId ? { ...row, localProgress: percent } : row,
              ),
            );
          },
        });

        const result = await messagingApi.sendMessage(api, conversation.id, {
          kind: "FILE",
          body: "",
          clientId,
          replyTo: currentReply?.id || undefined,
          fileName: take.name,
          fileType: take.mime,
          fileSize: uploaded.size,
          fileKey: uploaded.fileKey,
          meta,
          // Android sends the flag in both places; the Worker reads `meta`.
          ...(once ? { viewOnce: true } : {}),
        });

        if (result.message) {
          const confirmed = result.message;
          setMessages((current) => {
            const next = applyMessageFrame(current, confirmed, meId).messages;
            return next.map((row) =>
              row.id === confirmed.id && !row.localPreview
                ? { ...row, localPreview: preview, localProgress: 100 }
                : row,
            );
          });
        } else {
          setMessages((current) =>
            current.map((row) =>
              row.clientId === clientId
                ? { ...row, localState: "" as const, localProgress: 100 }
                : row,
            ),
          );
        }
        void refreshList();
      } catch (error) {
        setMessages((current) =>
          current.map((row) =>
            row.clientId === clientId
              ? { ...row, localState: "failed" as const, localError: apiErrorMessage(error) }
              : row,
          ),
        );
        announce("That voice note did not send. Retry from the message actions.");
      }
    },
    [announce, api, meId, refreshList, replyTo],
  );

  /**
   * Copy selected rows into other chats: the phone's `forwardSelected` loop
   * around `forwardMessageTo`.
   *
   * Per target chat, one fresh album id when two or more photos are being
   * forwarded together (each chat owns its own group). Per row, the branch the
   * phone takes: a stored `fileKey` is re-used — the worker explicitly allows a
   * key to be referenced by more than one row, and refuses a key that belongs
   * to somebody else's view-once message — a `data:` row re-posts its inline
   * bytes, a server-hosted IMAGE row is downloaded and re-uploaded as a JPEG so
   * both chats own their own copy, and anything else is a TEXT post.
   *
   * The body is re-sealed for the TARGET's key: in a personal chat the source
   * row's `body` is an envelope only its own recipient can open, so forwarding
   * it verbatim would hand the new chat something unreadable. Where sealing is
   * not possible (no identity yet) the forward is refused for that chat and
   * said out loud — the phone falls back to plaintext here, and this client
   * does not send a body it cannot protect.
   */
  const forwardMessages = useCallback(
    async (items: readonly ForwardItem[], targetIds: readonly string[]) => {
      if (items.length === 0 || targetIds.length === 0) return;
      const grouped = albumForForward(items.map((item) => item.row)) !== "";
      const refused: string[] = [];
      let delivered = 0;

      for (const targetId of targetIds) {
        const target = conversationsRef.current.find((row) => row.id === targetId) ?? null;
        const isGroup = target ? target.isGroup : false;
        const otherId = target ? conversationPeerId(target) : "";
        const peerKey = target ? conversationPeerKey(target) : "";
        const album = grouped ? albumId() : "";
        let blocked = "";

        for (const item of items) {
          const row = item.row;
          let body = item.plaintext;
          if (body) {
            try {
              body = await protectOutgoingBody(body, { isGroup, otherId }, peerKey, identity);
            } catch (error) {
              blocked = (error as Error).message || SECURE_CHAT_WAITING;
              break;
            }
          }
          const shape = forwardShapeOf(row);
          try {
            if (shape === "fileKey") {
              await messagingApi.sendMessage(api, targetId, {
                kind: "FILE",
                body,
                clientId: newClientId(),
                fileName: forwardFileName(row),
                fileType: forwardFileType(row),
                fileSize: row.fileSize,
                fileKey: row.fileKey,
                meta: forwardMetaOf(row, album || undefined),
              });
            } else if (shape === "dataUrl") {
              await messagingApi.sendMessage(api, targetId, {
                kind: "IMAGE",
                body,
                clientId: newClientId(),
                imageData: row.mediaUrl,
                meta: forwardMetaOf(row, album || undefined),
              });
            } else if (shape === "reupload") {
              const fetched = await fetchMessageMediaBlob(api, row.id);
              const uploaded = await uploadFile(api, {
                name: row.fileName || REUPLOAD_PHOTO_NAME,
                type: REUPLOAD_PHOTO_TYPE,
                blob: fetched.blob,
              });
              await messagingApi.sendMessage(api, targetId, {
                kind: "FILE",
                body,
                clientId: newClientId(),
                fileName: row.fileName || REUPLOAD_PHOTO_NAME,
                fileType: REUPLOAD_PHOTO_TYPE,
                fileSize: uploaded.size,
                fileKey: uploaded.fileKey,
                meta: forwardMetaOf(row, album || undefined),
              });
            } else {
              await messagingApi.sendMessage(api, targetId, {
                kind: "TEXT",
                body,
                clientId: newClientId(),
              });
            }
            delivered += 1;
          } catch {
            // One row's failure does not stop the rest: the phone runs each
            // forward inside its own `runCatching` for the same reason.
          }
        }

        if (blocked) {
          refused.push(`${target ? conversationTitle(target) : targetId}: ${blocked}`);
        }
      }

      const expected = items.length * targetIds.length;
      if (refused.length > 0) {
        announce(
          `Forwarded ${delivered} of ${expected} message${expected === 1 ? "" : "s"}. Not forwarded — ${refused.join("; ")}`,
        );
      } else if (delivered === expected) {
        announce(
          forwardNotice(
            items.map((item) => item.row),
            targetIds,
          ),
        );
      } else {
        announce(`Forwarded ${delivered} of ${expected} messages; the rest were refused.`);
      }
      void refreshList();
    },
    [announce, api, identity, refreshList],
  );

  /**
   * A `typing` ping with a kind. "voice" is what the recorder sends while a
   * take is running (once on start, then every 3 s against the Worker's 6 s
   * lease) so the other side shows a microphone instead of typing dots.
   */
  const pingTyping = useCallback(
    (kind: "text" | "voice" | "clear") => {
      const conversation = selectedRef.current;
      if (!conversation || isOneWayConversation(conversation)) return;
      void messagingApi.setTyping(api, conversation.id, kind);
    },
    [api],
  );

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
      for (const timer of vanishTimers.current.values()) window.clearTimeout(timer);
      vanishTimers.current.clear();
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (typingIdleTimer.current) window.clearTimeout(typingIdleTimer.current);
    },
    [],
  );

  const totalUnread = useMemo(
    () => conversations.reduce((sum, row) => sum + row.unread, 0),
    [conversations],
  );

  /**
   * Slice I (chat-theme parity): optimistic PATCH, rolled back when the server
   * refuses (a non-owner cannot re-theme a group — the Worker answers 403).
   * The row keeps its theme across reloads because the Worker stores it on the
   * conversation and every list/detail payload carries it back.
   */
  const setChatTheme = useCallback(
    async (theme: ChatTheme) => {
      const current = selectedRef.current;
      if (!current) return;
      const nextTheme = chatThemeOr(theme);
      if (current.theme === nextTheme) return;
      const previous = current;
      const next = { ...current, theme: nextTheme };
      setSelected(next);
      setConversations((rows) => rows.map((row) => (row.id === next.id ? next : row)));
      try {
        await messagingApi.setConversationTheme(api, current.id, nextTheme);
      } catch {
        setSelected(previous);
        setConversations((rows) => rows.map((row) => (row.id === previous.id ? previous : row)));
        announce(
          current.isGroup
            ? "Only the group owner can change the chat theme — the phone app works the same way."
            : "The chat theme could not be saved. Check the connection and try again.",
        );
      }
    },
    [api, announce],
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
    typingKind,
    draft,
    replyTo,
    outbox,
    pendingSends: pendingCount(outbox),
    listSocket: listSocketStatus,
    chatSocket: chatSocketStatus,
    notice,
    oneWay: selected ? isOneWayConversation(selected) : false,
    durable: stores.durable,
    vanishingIds,
    hiddenMessageIds,
    sharedMedia,
    sharedMediaStatus,
    sharedMediaError,
    refreshList,
    selectConversation,
    loadOlder,
    setDraft,
    composerChanged,
    send,
    sendSticker,
    sendAttachments,
    sendVoice,
    forwardMessages,
    pingTyping,
    retry,
    discard,
    setReplyTo,
    react,
    editMessage,
    deleteMessage,
    spendViewOnce,
    hideMessages,
    openSharedMedia,
    retrySharedMedia,
    closeSharedMedia,
    dismissNotice,
    announce,
    setChatTheme,
  };
}

export { conversationTitle, parseConversationRow };
