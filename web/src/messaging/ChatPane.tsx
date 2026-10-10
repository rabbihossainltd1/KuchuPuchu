/**
 * Open-chat pane: transcript, composer, message actions and the honest E2EE
 * state bar.
 *
 * Every action has a visible, labelled control. The parity plan forbids
 * hover-only and gesture-only affordances, so the per-message action row is
 * always in the tab order and revealed visually on hover *or* keyboard focus.
 *
 * Capability limits are stated rather than hidden: a browser cannot block
 * screen capture, media bytes are not sealed, and an envelope that cannot be
 * opened says so instead of rendering ciphertext.
 *
 * Slice E2 adds three surfaces the phone has had all along, each with its
 * desktop equivalent of the gesture that opens it on a phone:
 *
 *   • voice notes — the mic button records (a click arms the locked panel, a
 *     hold-and-release sends, a drag left cancels), and a note plays in its own
 *     bubble with a seekable waveform and a per-note speed;
 *   • document preview — a document row opens a full-screen reader (browser PDF
 *     viewer, selectable text, pictures, clips) which says plainly what a
 *     browser cannot render;
 *   • selection and forwarding — every row has a Select button, the selection
 *     bar carries Copy / Forward / Edit / Delete, and Forward opens the chat
 *     picker the phone uses.
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "../icons";
import { RouteLink } from "../RouteLink";
import type { Navigate } from "../useBrowserRouter";
import {
  CAPABILITY_COPY,
  LOCKED_BODY_PLACEHOLDER,
  QUICK_REACTIONS,
  type QuickReaction,
} from "./chatCopy";
import type { ApiClient } from "../auth/authApi";
import type { EditModel } from "../media/imageEdit";

import { attachmentCategory, formatBytes, isAttachmentKind } from "../media/uploadContract";
import { useAppTheme } from "../theme/appTheme";
import { CHAT_THEME_LABELS, chatThemeCssVars, chatThemeOr, chatThemeStyle } from "./chatTheme";
import { AttachMenu, type AttachSource } from "./AttachMenu";
import { AlbumGrid, AttachmentRow } from "./AttachmentRow";
import { OnceText } from "./OnceText";
import { VoiceRecorderBar } from "./VoiceRecorderBar";
import { StatusQuoteChip } from "../status/StatusQuoteChip";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { useVoicePlayer } from "./useVoicePlayer";
import {
  canDeleteForEveryone,
  canForwardRow,
  canForwardSelection,
  canSaveMedia,
  deleteAlsoLabel,
  selectionCanDeleteForEveryone,
  forwardContextOf,
  selectionFacts,
  type ForwardItem,
} from "./forward";
import { mediaSourceKey, useMediaUrls } from "./mediaUrl";
import { isViewOnce, viewOnceSpent } from "./viewOnce";
import { rowsForTab, visibleMedia, type SharedMediaTab } from "./sharedMedia";
import {
  applyRenderedEdit,
  describeAttachment,
  hasEdits,
  prepareAttachments,
  revokeAttachment,
  type AttachmentRejection,
  type PendingAttachment,
} from "./attachments";
import { ConversationAvatar } from "./Avatar";
import {
  MESSAGE_BODY_LIMIT,
  TICK_LABELS,
  clockTime,
  conversationPeerId,
  conversationTitle,
  foldAlbums,
  groupByDay,
  isBotConversation,
  isOneWayConversation,
  tickState,
  type ConversationRow,
  type MessageRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";
import { isWebFeatureEnabled } from "../featureFlags";
/* The two tiny calls modules the messaging chunk is allowed to import — a gate
   and a launcher bridge, no engine, no peer runtime, no call CSS. The engine
   itself stays in the lazy calls chunk. */
import { callPlacement } from "../calls/callGate";
import { launchCall } from "../calls/callBus";

// Both surfaces are heavy (a zoom/pan stage, a thumbnail grid that resolves
// every media URL) and neither is needed to read a chat, so they load on
// demand like the photo editor and the sticker picker do.
const MediaViewer = lazy(() =>
  import("./MediaViewer").then((module) => ({ default: module.MediaViewer })),
);
const MediaGallery = lazy(() =>
  import("./MediaGallery").then((module) => ({ default: module.MediaGallery })),
);
// The document reader pulls a whole file's bytes and the forward picker renders
// the entire conversation list; neither belongs in the chat's first paint.
const DocViewer = lazy(() => import("./DocViewer").then((m) => ({ default: m.DocViewer })));
const ForwardDialog = lazy(() =>
  import("./ForwardDialog").then((module) => ({ default: module.ForwardDialog })),
);

/** A stable empty list, so the viewer's URL hook has a constant dependency. */
const NO_ROWS: readonly MessageRow[] = Object.freeze([]);

/**
 * How long a sent TEXT row stays editable — Android's `canEdit` allows under 60
 * seconds, and the Worker enforces its own window on the PATCH.
 */
const EDITABLE_WINDOW_MS = 60_000;

const PhotoEditor = lazy(() =>
  import("../media/PhotoEditor").then((module) => ({ default: module.PhotoEditor })),
);
const StickerPicker = lazy(() =>
  import("../media/StickerPicker").then((module) => ({ default: module.StickerPicker })),
);

type Props = {
  controller: MessagingController;
  selectedId: string;
  navigate: Navigate;
  identityStatus: string;
  identityError: string;
  identityNotice: string;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onReloadIdentity: () => Promise<void> | void;
  onDismissIdentityNotice: () => void;
  meId: string;
  meName: string;
  /** Attachment bytes are Bearer-gated, so the transcript needs the client. */
  api: ApiClient | null;
};

function senderLabel(message: MessageRow, conversation: ConversationRow, meId: string): string {
  if (message.senderId === meId) return "You";
  if (message.senderName) return message.senderName;
  return conversation.isGroup ? "Member" : conversationTitle(conversation);
}

export function ChatPane({
  controller,
  selectedId,
  navigate,
  identityStatus,
  identityError,
  identityNotice,
  onUnlock,
  onReloadIdentity,
  onDismissIdentityNotice,
  meId,
  meName,
  api,
}: Props) {
  const composerId = useId();
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<PendingAttachment | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // The full-screen viewer: the rows it pages through, and which one is current.
  const [viewer, setViewer] = useState<{ items: readonly MessageRow[]; index: number } | null>(
    null,
  );
  const [rejections, setRejections] = useState<readonly AttachmentRejection[]>([]);
  // Multi-select: the ids ticked in the transcript, and the rows waiting for a
  // chat to be picked. Android keeps `selected` and `forwarding` the same way.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [forwardFor, setForwardFor] = useState<readonly ForwardItem[] | null>(null);
  const [docTarget, setDocTarget] = useState<MessageRow | null>(null);
  // The bytes as picked, kept so re-opening the editor never re-compresses an
  // already-baked JPEG (each bake would cost another generation of quality).
  const originals = useRef<Map<string, { blob: Blob; width: number; height: number }>>(new Map());

  const conversation = controller.selected;
  const isEditing = editingId !== "";

  // Slice I chat themes: the palette rides on CSS custom properties scoped to
  // this pane, so two open conversations can never leak colours into each
  // other and the app-wide appearance switch still re-keys every surface.
  const appTheme = useAppTheme();
  const chatPaneStyle = useMemo(
    () =>
      conversation
        ? (chatThemeCssVars(
            chatThemeStyle(chatThemeOr(conversation.theme), appTheme),
          ) as CSSProperties)
        : undefined,
    [conversation, appTheme],
  );
  const canPickTheme = !!conversation && (!conversation.isGroup || conversation.ownerId === meId);
  const chatThemeLabel = (value: string): string =>
    CHAT_THEME_LABELS.find((option) => option.value === chatThemeOr(value))?.label ?? "Dark Blue";
  // Photos that share an album id and a sender fold into one row, exactly as
  // the phone's `foldAlbums` does, so a five-photo send is one bubble.
  const days = useMemo(() => groupByDay(foldAlbums(controller.messages)), [controller.messages]);

  // One hook resolves every URL the viewer needs; it stays mounted (with an
  // empty list) so the hook order never changes when the viewer opens.
  const viewerUrls = useMediaUrls(api, viewer?.items ?? NO_ROWS);

  // One player for every voice note in the transcript: starting a note stops
  // the one before it, and each note keeps its own speed (r76-16).
  const player = useVoicePlayer(api);

  /** What this chat allows, before any single row is considered. */
  const forwardContext = useMemo(() => forwardContextOf(conversation), [conversation]);

  /** Every row the transcript can act on, albums unfolded. */
  const rowsById = useMemo(() => {
    const map = new Map<string, MessageRow>();
    controller.messages.forEach((row) => {
      map.set(row.id, row);
      row.albumMembers.forEach((member) => map.set(member.id, member));
    });
    return map;
  }, [controller.messages]);

  const selectedRows = useMemo(
    () =>
      selectedIds
        .map((id) => rowsById.get(id))
        .filter((row): row is MessageRow => row !== undefined),
    [rowsById, selectedIds],
  );

  const isOwnRow = useCallback((row: MessageRow) => row.senderId === meId, [meId]);

  const displayBodyOf = useCallback(
    (row: MessageRow) => controller.displayBodies[row.id] ?? row.body,
    [controller.displayBodies],
  );

  const toggleSelect = useCallback((row: MessageRow) => {
    // Selecting one photo of an album selects the whole group: an album is one
    // bubble, and the phone adds `albumIds` to the selection for the same reason.
    const ids =
      row.albumMembers.length > 1 ? row.albumMembers.map((member) => member.id) : [row.id];
    setSelectedIds((current) => {
      const allIn = ids.every((id) => current.includes(id));
      if (allIn) return current.filter((id) => !ids.includes(id));
      return [...new Set([...current, ...ids])];
    });
    setConfirmDeleteId("");
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setConfirmDeleteId("");
  }, []);

  /**
   * Arm the forward picker for these rows.
   *
   * A body this device cannot open is not forwarded: the row's own `body` is a
   * `KP1.` envelope in a personal chat, and re-sealing needs the plaintext. A
   * TEXT row with nothing readable is dropped; an attachment keeps its bytes
   * and loses only a caption nobody here can read.
   */
  const openForward = useCallback(
    (rows: readonly MessageRow[]) => {
      const readable = (value: string) =>
        value !== LOCKED_BODY_PLACEHOLDER && !value.startsWith("KP1.");
      const items: ForwardItem[] = [];
      let dropped = 0;
      rows.forEach((row) => {
        const body = displayBodyOf(row);
        const ok = readable(body);
        if (!ok) dropped += 1;
        if (row.kind === "TEXT" && !ok) return;
        items.push({ row, plaintext: ok ? body : "" });
      });
      if (items.length === 0) {
        controller.announce(
          "Those messages cannot be opened on this device, so there is nothing to forward.",
        );
        return;
      }
      if (dropped > 0) {
        controller.announce(
          "A caption this device cannot open will not be forwarded with its file.",
        );
      }
      setForwardFor(items);
    },
    [controller, displayBodyOf],
  );

  /**
   * What the selection bar may draw, from the same predicates the phone uses:
   * Copy when any selected row is a readable TEXT row, Forward when every row
   * clears the chat's and the sender's gates, Edit for a single own TEXT row
   * inside the window, and one Delete whose confirm panel asks the scope.
   */
  const selection = useMemo(
    () =>
      selectionFacts(selectedRows, controller.displayBodies, forwardContext, {
        isOwn: isOwnRow,
        canEditRow: (row) =>
          isOwnRow(row) &&
          row.kind === "TEXT" &&
          row.localState === "" &&
          Date.now() - Date.parse(row.createdAt) <= EDITABLE_WINDOW_MS &&
          displayBodyOf(row) !== LOCKED_BODY_PLACEHOLDER &&
          !displayBodyOf(row).startsWith("KP1."),
      }),
    [controller.displayBodies, displayBodyOf, forwardContext, isOwnRow, selectedRows],
  );

  /** The recorder: a finished take goes straight to the voice send. */
  const recorder = useVoiceRecorder({
    enabled: conversation !== null && !isOneWayConversation(conversation),
    onTake: (take, once) => controller.sendVoice(take, once),
    onTyping: (kind) => controller.pingTyping(kind),
    onError: (message) => controller.announce(message),
  });

  // Rows that have left the transcript (deleted, or a spent view-once) must
  // leave the media panel too: the panel has to agree with the chat.
  const goneIds = useMemo(
    () => new Set(controller.hiddenMessageIds),
    [controller.hiddenMessageIds],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const list = transcriptRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    setStickToBottom(true);
    setConfirmDeleteId("");
    setEditingId("");
    setEditText("");
    setAttachOpen(false);
    setStickerOpen(false);
    setEditorTarget(null);
    setRejections([]);
    setGalleryOpen(false);
    setViewer(null);
    setSelectedIds([]);
    setForwardFor(null);
    setDocTarget(null);
    // An unsent attachment belongs to the chat it was picked in: leaving the
    // conversation drops it rather than leaking it into another person's chat.
    setPending((current) => {
      current.forEach(revokeAttachment);
      return [];
    });
    originals.current.clear();
  }, [selectedId]);

  useEffect(() => {
    if (stickToBottom) scrollToBottom();
  }, [controller.messages.length, scrollToBottom, stickToBottom]);

  const onTranscriptScroll = useCallback(() => {
    const list = transcriptRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    setStickToBottom(distance < 80);
    // The phone pulls the next page as the finger nears the top; the web does
    // the same instead of making the reader hunt for the Load-older button.
    if (
      list.scrollTop < 48 &&
      controller.hasMore &&
      !controller.loadingOlder &&
      controller.messagesStatus === "ready"
    ) {
      void controller.loadOlder();
    }
  }, [controller]);

  const copyText = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        controller.announce("Message text copied.");
      } catch {
        // Clipboard permission can be denied; the text stays selectable, so the
        // failure is reported rather than silently swallowed.
        controller.announce("Copying was blocked. Select the message text to copy it manually.");
      }
    },
    [controller],
  );

  const beginEdit = useCallback((message: MessageRow) => {
    setEditingId(message.id);
    setEditText(message.body.startsWith("KP1.") ? "" : message.body);
    setConfirmDeleteId("");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

  const commitEdit = useCallback(async () => {
    if (!editingId) return;
    const text = editText.trim();
    if (!text) return;
    await controller.editMessage(editingId, text);
    setEditingId("");
    setEditText("");
  }, [controller, editingId, editText]);

  const submitUnlock = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!passphrase.trim()) return;
      setUnlockBusy(true);
      setUnlockError("");
      const unlocked = await onUnlock(passphrase);
      setUnlockBusy(false);
      if (unlocked) setPassphrase("");
      else setUnlockError("That passphrase did not unlock the backup.");
    },
    [onUnlock, passphrase],
  );

  /* ---------------------------------------------------------- attachments */

  const onPickFiles = useCallback(
    async (
      files: readonly File[],
      source: AttachSource,
      asDocument: boolean,
      viewOnce: boolean,
    ) => {
      const result = await prepareAttachments(files, {
        asDocument: asDocument || source === "document",
        viewOnce,
        alreadyQueued: pending.length,
      });
      setRejections(result.rejected);
      if (!result.items.length) return;
      result.items.forEach((item) => {
        if (item.intent === "photo") {
          originals.current.set(item.id, {
            blob: item.blob,
            width: item.width,
            height: item.height,
          });
        }
      });
      setPending((current) => [...current, ...result.items]);
    },
    [pending.length],
  );

  const removeAttachment = useCallback((id: string) => {
    setPending((current) => {
      const target = current.find((item) => item.id === id);
      if (target) revokeAttachment(target);
      return current.filter((item) => item.id !== id);
    });
    originals.current.delete(id);
  }, []);

  const onEditorDone = useCallback(
    (rendered: { blob: Blob; width: number; height: number }, edit: EditModel) => {
      const target = editorTarget;
      setEditorTarget(null);
      if (!target) return;
      setPending((current) =>
        current.map((row) => (row.id === target.id ? applyRenderedEdit(row, rendered, edit) : row)),
      );
      controller.announce(`Photo edited. It sends at ${rendered.width} by ${rendered.height}.`);
    },
    [controller, editorTarget],
  );

  const submit = useCallback(async () => {
    if (pending.length) {
      const items = pending;
      const caption = controller.draft;
      // Object URLs deliberately survive this: the optimistic rows keep showing
      // the local bytes while the upload runs, so revoking here would blank
      // every thumbnail in the transcript mid-send.
      setPending([]);
      setRejections([]);
      originals.current.clear();
      controller.setDraft("");
      await controller.sendAttachments(items, caption);
      return;
    }
    await controller.send();
  }, [controller, pending]);

  const onComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        if (editingId) {
          setEditingId("");
          setEditText("");
        } else if (controller.replyTo) {
          controller.setReplyTo(null);
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !editingId) {
        event.preventDefault();
        void submit();
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && editingId) {
        event.preventDefault();
        void commitEdit();
      }
    },
    [commitEdit, controller, editingId, submit],
  );

  if (!conversation) {
    return (
      <main className="conversation-pane" aria-labelledby="conversation-heading">
        <header className="conversation-header">
          <div className="conversation-header__identity">
            <div className="conversation-avatar conversation-avatar--empty">
              <Icon name="message" size={20} />
            </div>
            <div className="conversation-header__copy">
              <h2 id="conversation-heading">Choose a conversation</h2>
              <p>Pick a chat from the list, or open a deep link to jump straight in.</p>
            </div>
          </div>
        </header>
        <section className="conversation-canvas" aria-label="No conversation open">
          <div className="welcome-card">
            <p className="eyebrow">DESKTOP WORKSPACE</p>
            <h3>Conversation, contacts and context—together.</h3>
            <p className="welcome-card__body">
              Chats load from your account and update live. Text bodies in a personal chat are
              sealed on this device with the same KP1 scheme the phone app uses.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const oneWay = isOneWayConversation(conversation);
  const editableWindowMs = EDITABLE_WINDOW_MS;

  /**
   * ChatScreen.kt:3799 decides whether a chat header carries the two call
   * buttons, and the Web asks the same question of the same facts: not a group,
   * not a bot, no open message request, no block wall, not muted for calls, and a
   * peer to call. A group gets the pair drawn but DISABLED with the reason —
   * the Web runs no mesh yet, and a button that silently did nothing would be
   * worse than one that says why.
   */
  const callGate = callPlacement({
    isGroup: conversation.isGroup,
    botChat: isBotConversation(conversation) || oneWay,
    requestOpen: conversation.requestPending,
    blockWall: conversation.blockedByMe || conversation.blockedMe,
    callMuted: conversation.mutedCall,
    peerId: conversationPeerId(conversation),
    callsEnabled: isWebFeatureEnabled("calls"),
  });
  const peerName = conversationTitle(conversation);
  const startCall = (kind: "AUDIO" | "VIDEO") => {
    const launched = launchCall({ id: conversationPeerId(conversation), name: peerName }, kind);
    if (!launched) {
      controller.announce(
        callGate.group
          ? "Group calls are not on the Web yet — start them from the phone."
          : "Calling is not available in this browser session.",
      );
    }
  };
  const groupedOwn = (message: MessageRow) => message.senderId === meId;

  /**
   * Open the viewer on one row — or on its whole album, so the reader can page
   * between photos that were sent together. The album arrives either from the
   * folded head row or from the grid cell that was clicked.
   */
  const openViewerAt = (message: MessageRow, album?: readonly MessageRow[]) => {
    const items =
      album && album.length > 1
        ? album
        : message.albumMembers.length > 1
          ? message.albumMembers
          : [message];
    const found = items.findIndex((row) => row.id === message.id);
    setViewer({ items, index: found < 0 ? 0 : found });
  };

  const galleryRows = visibleMedia(controller.sharedMedia, goneIds);

  /**
   * Whether the whole selection may be deleted for everyone: own rows always,
   * somebody else's only in a 1:1 with a real person (Ui.kt's
   * `canDeleteForEveryone`). When it is false the panel offers the local hide
   * alone, rather than a button the server would refuse.
   */
  const canDeleteEverything = selectionCanDeleteForEveryone(selectedRows, conversation, isOwnRow);

  const openGalleryItem = (message: MessageRow, tab: SharedMediaTab) => {
    if (tab !== "Media") return;
    const items = rowsForTab(galleryRows, "Media");
    const found = items.findIndex((row) => row.id === message.id);
    setViewer({ items, index: found < 0 ? 0 : found });
  };

  const viewerItems = (viewer?.items ?? NO_ROWS).map((row) => {
    const category = attachmentCategory(row.fileType, row.meta);
    const own = row.senderId === meId;
    const verdict = canForwardRow(row, forwardContext, own);
    return {
      id: row.id,
      url: viewerUrls[row.id]?.url ?? "",
      category: category === "video" ? ("video" as const) : ("photo" as const),
      title: row.fileName || (category === "video" ? "Video" : "Photo"),
      createdAt: row.createdAt,
      senderName: senderLabel(row, conversation, meId),
      own,
      viewOnce: isViewOnce(row),
      spent: viewOnceSpent(row),
      // The Worker deletes for everyone; a local echo has nothing to delete.
      canDelete: own && row.localState === "",
      // r71-18: the sender's "Media Save permission" decides whether their
      // media may be kept or copied out of this chat. Reading it is allowed.
      canSave: canSaveMedia(row, forwardContext, own),
      canForward: verdict.allowed,
      forwardReason: verdict.reason,
      width: row.mediaWidth,
      height: row.mediaHeight,
    };
  });

  return (
    <main
      className={`conversation-pane${selectedId ? " is-mobile-visible" : ""}`}
      aria-labelledby="conversation-heading"
      style={chatPaneStyle}
      data-chat-theme={chatThemeOr(conversation.theme)}
    >
      <header className="conversation-header">
        <div className="conversation-header__identity">
          <RouteLink
            route={{ kind: "section", section: "chats" }}
            navigate={navigate}
            className="conversation-back"
            aria-label="Back to Chats"
            title="Back to Chats"
          >
            <Icon name="arrow" size={19} />
          </RouteLink>
          <ConversationAvatar
            api={api}
            conversation={conversation}
            className="conversation-avatar"
          />
          <div className="conversation-header__copy">
            <h2 id="conversation-heading">{conversationTitle(conversation)}</h2>
            <p>
              {controller.typingActive
                ? controller.typingKind === "voice"
                  ? "ভয়েস রেকর্ড করছে… recording a voice note"
                  : "টাইপ করছে… typing"
                : oneWay
                  ? "Notification account · one-way"
                  : conversation.isGroup
                    ? "Group chat"
                    : "Direct chat · times shown in Dhaka time"}
            </p>
          </div>
        </div>
        <div className="conversation-actions" aria-label="Conversation actions">
          <span className={`socket-pill${controller.chatSocket === "open" ? " is-open" : ""}`}>
            {controller.chatSocket === "open" ? "Live" : "Reconnecting"}
          </span>
          {/* The phone's two header glyphs. Disabled-with-reason for a group,
              absent for every case ChatScreen.kt leaves absent. */}
          {callGate.show ? (
            <>
              <button
                type="button"
                className="icon-button"
                aria-label={
                  callGate.group
                    ? "Group voice call is not available on the Web"
                    : `Voice call ${peerName}`
                }
                title={
                  callGate.group
                    ? "Group calls are not on the Web yet — start them from the phone."
                    : undefined
                }
                disabled={callGate.group}
                onClick={() => startCall("AUDIO")}
              >
                <Icon name="phone" size={19} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={
                  callGate.group
                    ? "Group video call is not available on the Web"
                    : `Video call ${peerName}`
                }
                title={
                  callGate.group
                    ? "Group calls are not on the Web yet — start them from the phone."
                    : undefined
                }
                disabled={callGate.group}
                onClick={() => startCall("VIDEO")}
              >
                <Icon name="videoCall" size={21} />
              </button>
            </>
          ) : null}
          {/* Native-only gaps are disclosed, not silently dropped: the browser
              cannot block screen capture, and media bytes are not sealed. */}
          <button
            type="button"
            className="text-button"
            aria-haspopup="dialog"
            onClick={() => {
              setGalleryOpen(true);
              void controller.openSharedMedia();
            }}
          >
            Media, links and docs
          </button>
          <details className="chat-notes">
            <summary>Privacy notes</summary>
            <ul>
              <li>{CAPABILITY_COPY.mediaNotEncrypted}</li>
              <li>{CAPABILITY_COPY.captureWarning}</li>
              <li>{CAPABILITY_COPY.stillPending}</li>
              <li>{CAPABILITY_COPY.voiceRecorderNotice}</li>
              <li>{CAPABILITY_COPY.documentPreviewNotice}</li>
              <li>{CAPABILITY_COPY.forwardingNotice}</li>
              {conversation.mutedCall ? (
                <li>
                  Calls are muted for this chat, so its call buttons are hidden — the phone does the
                  same. Unmute it in the chat's mute chooser to bring them back.
                </li>
              ) : null}
              {callGate.group ? (
                <li>Group calls stay on the phone: the Web runs no group mesh yet.</li>
              ) : null}
            </ul>
          </details>

          {canPickTheme ? (
            <details className="chat-theme-menu">
              <summary>Theme · থিম</summary>
              <div className="chat-theme-menu__panel" role="radiogroup" aria-label="Chat theme">
                <p className="chat-theme-picker__label">
                  Chat theme <span>{chatThemeLabel(conversation.theme)}</span>
                </p>
                <div className="chat-theme-picker__options">
                  {CHAT_THEME_LABELS.map((option) => {
                    const active = chatThemeOr(conversation.theme) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`chat-theme-swatch${active ? " is-active" : ""}`}
                        data-theme={option.value}
                        title={`${option.label} · ${option.bangla}`}
                        aria-label={`Chat theme ${option.label} (${option.bangla})`}
                        onClick={() => void controller.setChatTheme(option.value)}
                      >
                        <span aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
                <p className="chat-theme-picker__note">
                  Saved for everyone in this chat — the phone shows the same five themes.
                </p>
              </div>
            </details>
          ) : (
            <p className="chat-theme-picker__locked">
              Only the group owner can change this chat&apos;s theme.
            </p>
          )}
        </div>
      </header>

      {identityStatus === "locked" && (
        <form className="e2ee-bar e2ee-bar--locked" onSubmit={submitUnlock}>
          <Icon name="lock" size={16} />
          <div className="e2ee-bar__copy">
            <strong>Secure chat is locked</strong>
            <span>
              Enter your KuchuPuchu backup passphrase to read and send encrypted messages. This
              browser never creates a second identity.
            </span>
          </div>
          <label className="sr-only" htmlFor="kp-passphrase">
            Backup passphrase
          </label>
          <input
            id="kp-passphrase"
            type="password"
            value={passphrase}
            autoComplete="current-password"
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
          />
          <button type="submit" className="primary-button" disabled={unlockBusy}>
            {unlockBusy ? "Unlocking…" : "Unlock"}
          </button>
          {unlockError && (
            <p className="e2ee-bar__error" role="alert">
              {unlockError}
            </p>
          )}
        </form>
      )}

      {identityStatus === "nokeys" && (
        <div className="e2ee-bar e2ee-bar--locked" role="status">
          <Icon name="lock" size={16} />
          <div className="e2ee-bar__copy">
            <strong>Secure chat keys are not on this browser</strong>
            <span>
              Your messages are sealed to your phone&apos;s key, so this browser can never mint its
              own. On the phone: Settings → Message key backup → create a backup; then press Check
              here and unlock with the passphrase. Sealed bodies stay sealed until then.
            </span>
          </div>
          <button type="button" className="primary-button" onClick={() => void onReloadIdentity()}>
            Check for backup
          </button>
        </div>
      )}

      {!controller.durable && (
        <div className="capability-banner" role="status">
          {CAPABILITY_COPY.draftsNotDurable}
        </div>
      )}

      {identityStatus === "unavailable" && identityError && (
        <div className="e2ee-bar e2ee-bar--error" role="alert">
          <Icon name="lock" size={16} />
          <span>{identityError}</span>
        </div>
      )}

      {identityNotice && (
        <div className="e2ee-bar e2ee-bar--info" role="status">
          <Icon name="lock" size={16} />
          <span>{identityNotice}</span>
          <button
            type="button"
            className="text-button"
            onClick={onDismissIdentityNotice}
            aria-label="Dismiss secure chat notice"
          >
            Dismiss
          </button>
        </div>
      )}

      <ol
        className="transcript"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
        aria-label={`Messages with ${conversationTitle(conversation)}`}
      >
        {controller.hasMore && (
          <li className="transcript__more">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void controller.loadOlder()}
              disabled={controller.loadingOlder}
            >
              {controller.loadingOlder ? "Loading older messages…" : "Load older messages"}
            </button>
          </li>
        )}

        {controller.messagesStatus === "loading" && (
          <li className="transcript__state" role="status">
            Loading messages…
          </li>
        )}
        {controller.messagesStatus === "error" && (
          <li className="transcript__state" role="alert">
            {controller.messagesError || "Messages could not be loaded."}
          </li>
        )}
        {controller.messagesStatus === "ready" && controller.messages.length === 0 && (
          <li className="transcript__state">
            No messages yet. Sent messages are sealed on this device before they leave it.
          </li>
        )}

        {days.map((group) => (
          <li key={`${group.day}-${group.items[0]?.id ?? ""}`} className="transcript__day">
            <span>{group.day}</span>
            <ol className="transcript__group">
              {group.items.map((message) => {
                const own = groupedOwn(message);
                const body = controller.displayBodies[message.id] ?? message.body;
                const isPlaceholder = body === LOCKED_BODY_PLACEHOLDER;
                const ticks = tickState(message, { meId, otherReadAt: controller.otherReadAt });
                const canEdit =
                  own &&
                  message.kind === "TEXT" &&
                  !message.localState &&
                  Date.now() - Date.parse(message.createdAt) <= editableWindowMs &&
                  !isPlaceholder;
                const reactions = Object.entries(message.reactions);
                const selected = selectedIds.includes(message.id);
                // An album forwards and selects as one group, as it does on the
                // phone (`selected.addAll(albumIds)`).
                const groupRows =
                  message.albumMembers.length > 1 ? message.albumMembers : [message];
                const forwardVerdict = canForwardSelection(groupRows, forwardContext, isOwnRow);
                const rowCategory = attachmentCategory(
                  message.fileType,
                  (message.meta ?? {}) as Record<string, unknown>,
                );

                return (
                  <li
                    key={message.id}
                    /* A stable hook: the browser tests address one row by id,
                       which is what an accessible name cannot do when three
                       notes in a row all say "Play voice message". */
                    data-message-id={message.id}
                    className={`bubble-row${own ? " bubble-row--own" : ""}${
                      message.kind === "DELETED" ? " bubble-row--deleted" : ""
                    }${controller.vanishingIds.includes(message.id) ? " bubble-row--vanishing" : ""}${
                      selected ? " bubble-row--selected" : ""
                    }`}
                  >
                    {selectedIds.length > 0 && message.kind !== "DELETED" ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        className={`row-select${selected ? " is-on" : ""}`}
                        onClick={() => toggleSelect(message)}
                        aria-label={
                          selected
                            ? `Unselect the message from ${senderLabel(message, conversation, meId)}`
                            : `Select the message from ${senderLabel(message, conversation, meId)}`
                        }
                      >
                        {selected ? <Icon name="check" size={13} /> : null}
                      </button>
                    ) : null}
                    <article
                      className={`bubble${own ? " bubble--own" : ""}${
                        message.localState === "failed" ? " bubble--failed" : ""
                      }${message.kind === "STICKER" ? " bubble--sticker" : ""}${
                        isAttachmentKind(message.kind) ? " bubble--attachment" : ""
                      }`}
                      aria-label={`${senderLabel(message, conversation, meId)} at ${clockTime(
                        message.createdAt,
                      )}`}
                    >
                      {!own && conversation.isGroup && (
                        <p className="bubble__sender">{senderLabel(message, conversation, meId)}</p>
                      )}

                      {/* A reply to a status quotes the status first, exactly
                          as the phone's bubble does (StatusQuote above replyTo). */}
                      {message.statusQuote ? (
                        <StatusQuoteChip quote={message.statusQuote} api={api} />
                      ) : null}

                      {message.replyTo && (
                        <blockquote className="bubble__reply">
                          <span className="bubble__reply-sender">
                            {message.replyTo.senderName || "Reply"}
                          </span>
                          <span className="bubble__reply-body">
                            {message.replyTo.body.startsWith("KP1.")
                              ? LOCKED_BODY_PLACEHOLDER
                              : message.replyTo.body}
                          </span>
                        </blockquote>
                      )}

                      {message.kind === "DELETED" ? (
                        <p className="bubble__deleted">This message was deleted.</p>
                      ) : message.albumMembers.length > 1 ? (
                        <AlbumGrid rows={message.albumMembers} api={api} onOpen={openViewerAt} />
                      ) : isAttachmentKind(message.kind) || message.kind === "STICKER" ? (
                        <AttachmentRow
                          message={message}
                          api={api}
                          body={body}
                          locked={isPlaceholder}
                          onOpen={openViewerAt}
                          onOpenDoc={setDocTarget}
                          player={player}
                          own={own}
                          onOpenedOnce={(row) => controller.spendViewOnce(row.id)}
                          canSave={canSaveMedia(message, forwardContext, own)}
                        />
                      ) : isViewOnce(message) && !viewOnceSpent(message) && !isPlaceholder ? (
                        <OnceText
                          body={body}
                          onSpent={() => controller.spendViewOnce(message.id)}
                        />
                      ) : (
                        <p className="bubble__body">
                          {isPlaceholder && <Icon name="lock" size={13} className="bubble__lock" />}
                          {body}
                        </p>
                      )}

                      {reactions.length > 0 && (
                        <ul className="bubble__reactions" aria-label="Reactions">
                          {reactions.map(([userId, emoji]) => (
                            <li key={userId}>
                              <span aria-hidden="true">{emoji}</span>
                              <span className="sr-only">
                                {userId === meId ? "You reacted" : "A member reacted"} {emoji}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <footer className="bubble__meta">
                        {message.edited && <span>Edited</span>}
                        {message.localState === "pending" && (
                          <span>
                            {message.kind === "FILE"
                              ? message.localProgress > 0
                                ? `Uploading… ${message.localProgress}%`
                                : "Uploading…"
                              : "Sending…"}
                          </span>
                        )}
                        <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
                        {own && message.kind !== "DELETED" && (
                          <span className={`bubble__tick bubble__tick--${ticks}`}>
                            {ticks === "read" || ticks === "delivered"
                              ? "✓✓"
                              : ticks === "failed"
                                ? "!"
                                : "✓"}
                            <span className="sr-only"> {TICK_LABELS[ticks]}</span>
                          </span>
                        )}
                      </footer>

                      {message.localState === "failed" && (
                        <p className="bubble__error" role="alert">
                          {message.localError || "Not sent."}
                        </p>
                      )}

                      {message.kind !== "DELETED" && (
                        <div className="message-actions">
                          <button
                            type="button"
                            onClick={() => {
                              controller.setReplyTo({
                                id: message.id,
                                senderId: message.senderId,
                                senderName: senderLabel(message, conversation, meId),
                                body,
                                kind: message.kind,
                              });
                              composerRef.current?.focus();
                            }}
                            aria-label={`Reply to ${senderLabel(message, conversation, meId)}`}
                          >
                            Reply
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyText(body)}
                            disabled={isPlaceholder}
                            aria-label={`Copy message from ${senderLabel(
                              message,
                              conversation,
                              meId,
                            )}`}
                          >
                            Copy
                          </button>
                          {forwardVerdict.allowed ? (
                            <button
                              type="button"
                              onClick={() => openForward(groupRows)}
                              aria-label={`Forward ${
                                groupRows.length > 1 ? `${groupRows.length} photos` : "this message"
                              } to another chat`}
                            >
                              Forward
                            </button>
                          ) : (
                            <span
                              className="message-actions__refused"
                              title={forwardVerdict.reason}
                              aria-disabled="true"
                            >
                              Forward
                            </span>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => beginEdit(message)}
                              aria-label="Edit your message"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleSelect(message)}
                            aria-pressed={selected}
                            aria-label={selected ? "Unselect this message" : "Select this message"}
                          >
                            Select
                          </button>
                          {own && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDeleteId(confirmDeleteId === message.id ? "" : message.id)
                              }
                              aria-expanded={confirmDeleteId === message.id}
                              aria-label="Delete your message"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}

                      {!own && message.kind !== "DELETED" && (
                        <div className="reaction-bar" aria-label="Quick reactions">
                          {QUICK_REACTIONS.map((reaction: QuickReaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              onClick={() => void controller.react(message.id, reaction.emoji)}
                              aria-label={`React ${reaction.label}`}
                              title={reaction.label}
                            >
                              <span aria-hidden="true">{reaction.emoji}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {confirmDeleteId === message.id && (
                        <div className="confirm-panel" role="group" aria-label="Confirm delete">
                          <p>
                            Delete for everyone? This removes the message permanently for both
                            sides.
                          </p>
                          <div className="confirm-panel__actions">
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => {
                                void controller.deleteMessage(message.id);
                                setConfirmDeleteId("");
                              }}
                            >
                              Delete for everyone
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setConfirmDeleteId("")}
                            >
                              Keep message
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>

      {!stickToBottom && controller.messages.length > 0 && (
        <button
          type="button"
          className="jump-to-latest"
          onClick={() => {
            setStickToBottom(true);
            scrollToBottom("smooth");
          }}
        >
          Jump to latest
        </button>
      )}

      {controller.outbox.length > 0 && (
        <div className="outbox-bar" role="status">
          <span>
            {controller.pendingSends > 0
              ? `${controller.pendingSends} message(s) still sending`
              : `${controller.outbox.length} message(s) need attention`}
          </span>
          {controller.outbox
            .filter((item) => item.state === "failed" || item.state === "refused")
            .map((item) => (
              <span key={item.clientId} className="outbox-bar__item">
                <span className="outbox-bar__text">{item.plaintext.slice(0, 40)}</span>
                <button type="button" onClick={() => void controller.retry(item.clientId)}>
                  Retry
                </button>
                <button type="button" onClick={() => void controller.discard(item.clientId)}>
                  Discard
                </button>
              </span>
            ))}
        </div>
      )}

      {controller.notice && (
        <p className="composer-notice" role="status" aria-live="polite">
          {controller.notice}
        </p>
      )}

      {selectedIds.length > 0 ? (
        /* The phone puts the selection bar in the header's seat; here it takes
           the composer's, which is where a desktop reader's hands already are.
           One Delete, and the panel that opens asks the scope — r68-8. */
        <div
          className="selection-bar"
          role="toolbar"
          aria-label="Actions for the selected messages"
        >
          <button
            type="button"
            className="icon-button"
            onClick={clearSelection}
            aria-label="Clear the selection"
          >
            <Icon name="close" size={18} />
          </button>
          <span className="selection-bar__count" role="status">
            {selectedIds.length} selected
          </span>
          <span className="selection-bar__spacer" />
          {selection.canCopy ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void copyText(selection.copyText);
                clearSelection();
              }}
            >
              Copy
            </button>
          ) : null}
          {selection.canForward ? (
            <button type="button" className="text-button" onClick={() => openForward(selectedRows)}>
              <Icon name="send" size={16} /> Forward
            </button>
          ) : (
            <span
              className="text-button is-disabled"
              aria-disabled="true"
              title={selection.forwardReason || "These cannot be forwarded."}
            >
              <Icon name="send" size={16} /> Forward
            </span>
          )}
          {selection.canEdit ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const row = selectedRows[0];
                clearSelection();
                if (row) beginEdit(row);
              }}
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            className="text-button is-danger"
            onClick={() => setConfirmDeleteId(confirmDeleteId === "selection" ? "" : "selection")}
            aria-expanded={confirmDeleteId === "selection"}
          >
            <Icon name="trash" size={16} /> Delete
          </button>
          {confirmDeleteId === "selection" ? (
            <div className="confirm-panel" role="group" aria-label="Confirm delete">
              <p>
                Delete {selectedIds.length} message{selectedIds.length === 1 ? "" : "s"}?
              </p>
              {canDeleteEverything ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    const rows = selectedRows;
                    clearSelection();
                    rows.forEach((row) => {
                      if (row.localState === "") void controller.deleteMessage(row.id);
                      else controller.hideMessages([row.id]);
                    });
                  }}
                >
                  {deleteAlsoLabel(conversation)}
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const ids = selectedRows.map((row) => row.id);
                  clearSelection();
                  controller.hideMessages(ids);
                  controller.announce(
                    "Hidden on this device for this session. A browser has no local message store, so they come back if you reload.",
                  );
                }}
              >
                Hide for me (this session)
              </button>
              <button type="button" className="text-button" onClick={() => setConfirmDeleteId("")}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <footer className="composer">
          {controller.replyTo && (
            <div className="composer__reply">
              <span className="composer__reply-copy">
                Replying to {controller.replyTo.senderName || "message"}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => controller.setReplyTo(null)}
                aria-label="Cancel reply"
              >
                Cancel
              </button>
            </div>
          )}

          {isEditing && (
            <div className="composer__reply">
              <span className="composer__reply-copy">Editing your message</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditingId("");
                  setEditText("");
                }}
                aria-label="Cancel edit"
              >
                Cancel
              </button>
            </div>
          )}

          {rejections.length > 0 && (
            <ul
              className="composer__rejections"
              role="alert"
              aria-label="Files that could not be attached"
            >
              {rejections.map((item) => (
                <li key={`${item.name}-${item.reason}`}>
                  <strong>{item.name}</strong> {item.reason}
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRejections([])}
                  aria-label="Dismiss attachment warnings"
                >
                  Dismiss
                </button>
              </li>
            </ul>
          )}

          {pending.length > 0 && (
            <ul className="composer__attachments" aria-label="Attachments ready to send">
              {pending.map((item) => (
                <li key={item.id} className="composer-attachment">
                  {item.previewUrl ? (
                    <img className="composer-attachment__thumb" src={item.previewUrl} alt="" />
                  ) : (
                    <span className="composer-attachment__icon" aria-hidden="true">
                      {item.intent === "video" ? "🎬" : item.intent === "audio" ? "🎵" : "📄"}
                    </span>
                  )}
                  <span className="composer-attachment__copy">
                    <strong>{item.pickedName}</strong>
                    <span>
                      {formatBytes(item.size)}
                      {item.width ? ` · ${item.width}×${item.height}` : ""}
                      {hasEdits(item) ? " · edited" : ""}
                    </span>
                    <span className="sr-only">{describeAttachment(item)}</span>
                  </span>
                  {item.intent === "photo" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditorTarget(item)}
                      aria-label={`Edit photo ${item.pickedName}`}
                    >
                      {hasEdits(item) ? "Edit again" : "Edit"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => removeAttachment(item.id)}
                    aria-label={`Remove ${item.pickedName} from this message`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {recorder.recording ? (
            <VoiceRecorderBar controller={recorder} onAnnounce={controller.announce} />
          ) : (
            <div className="composer__row">
              {/* The phone's composer pill: sticker glyph LEFT inside the
                  pill, the field mid, attach RIGHT inside the pill; the
                  mic / send circle rides OUTSIDE the pill, right of it. */}
              <div className="composer__pill">
                <div className="composer__attach">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Send a sticker"
                    aria-expanded={stickerOpen}
                    disabled={oneWay}
                    onClick={() => {
                      setAttachOpen(false);
                      setStickerOpen((value) => !value);
                    }}
                  >
                    <Icon name="mood" size={20} />
                  </button>
                  {stickerOpen && !oneWay && (
                    <Suspense fallback={<p className="attach-loading">Loading stickers…</p>}>
                      <StickerPicker
                        onPick={(glyph) => {
                          setStickerOpen(false);
                          void controller.sendSticker(glyph);
                        }}
                        onClose={() => setStickerOpen(false)}
                        onAnnounce={controller.announce}
                      />
                    </Suspense>
                  )}
                </div>

                <label className="sr-only" htmlFor={composerId}>
                  {oneWay
                    ? "This account does not accept replies"
                    : pending.length > 0
                      ? "Caption for the attached files"
                      : "Message text"}
                </label>
                <textarea
                  id={composerId}
                  ref={composerRef}
                  className="composer__input"
                  rows={1}
                  value={isEditing ? editText : controller.draft}
                  disabled={oneWay}
                  placeholder={
                    oneWay
                      ? "Notification account — replies are not accepted"
                      : pending.length > 0
                        ? "Add a caption… (optional, sealed in a personal chat)"
                        : "Message"
                  }
                  title="Enter sends, Shift+Enter adds a line"
                  maxLength={MESSAGE_BODY_LIMIT}
                  onChange={(event) => {
                    if (isEditing) {
                      setEditText(event.target.value);
                      return;
                    }
                    controller.setDraft(event.target.value);
                    controller.composerChanged();
                  }}
                  onKeyDown={onComposerKeyDown}
                />

                <div className="composer__attach">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Attach a photo, video or document"
                    aria-expanded={attachOpen}
                    aria-haspopup="dialog"
                    disabled={oneWay}
                    onClick={() => {
                      setStickerOpen(false);
                      setAttachOpen((value) => !value);
                    }}
                  >
                    <Icon name="attach" size={20} />
                  </button>
                  <AttachMenu
                    open={attachOpen && !oneWay}
                    onClose={() => setAttachOpen(false)}
                    onFiles={(files, source, asDocument, viewOnce) =>
                      void onPickFiles(files, source, asDocument, viewOnce)
                    }
                    disabled={oneWay}
                    onAnnounce={controller.announce}
                  />
                </div>
              </div>

              {isEditing ? (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void commitEdit()}
                  disabled={!editText.trim()}
                  aria-label="Save edited message"
                >
                  Save
                </button>
              ) : controller.draft.trim() || pending.length > 0 ? (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void submit()}
                  disabled={oneWay}
                  aria-label={
                    oneWay
                      ? "Replies are not accepted"
                      : pending.length > 0
                        ? `Send ${pending.length} attachment${pending.length === 1 ? "" : "s"}`
                        : "Send message"
                  }
                >
                  <Icon name="send" size={18} />
                </button>
              ) : (
                /* The mic/send swap the phone has: with nothing typed and nothing
               attached the circle records. A click arms the locked panel (the
               phone's tap-is-lock rule), a hold sends on release, and a drag to
               the left throws the take away — all three also exist as labelled
               buttons once the panel is up, so none of them is gesture-only. */
                <button
                  type="button"
                  className="send-button send-button--mic"
                  disabled={oneWay || !recorder.supported}
                  aria-label={
                    oneWay
                      ? "Replies are not accepted"
                      : recorder.supported
                        ? "Record a voice note — click to open the recording panel, or hold and release to send"
                        : "This browser cannot record audio"
                  }
                  title={
                    recorder.supported
                      ? "Hold and release to send · click to lock the panel · drag left to cancel"
                      : "This browser has no MediaRecorder, so voice notes cannot be recorded here"
                  }
                  onPointerDown={(event) => {
                    if (!recorder.supported || oneWay) return;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    recorder.press({ clientX: event.clientX, clientY: event.clientY });
                  }}
                  onPointerMove={(event) =>
                    recorder.move({ clientX: event.clientX, clientY: event.clientY })
                  }
                  onPointerUp={(event) =>
                    recorder.release({ clientX: event.clientX, clientY: event.clientY })
                  }
                  onPointerCancel={() => recorder.cancel()}
                  onClick={(event) => {
                    // detail 0 = a keyboard activation, which never fired pointer
                    // events; the pointer path already decided by the time a mouse
                    // click lands here.
                    if (event.detail === 0) recorder.activate();
                  }}
                >
                  <Icon name="mic" size={18} />
                </button>
              )}
            </div>
          )}

          {recorder.error && !recorder.recording ? (
            <p className="composer__error" role="alert">
              {recorder.error}
            </p>
          ) : null}

          <p className="composer__hint">
            {oneWay
              ? "One-way notification account."
              : identityStatus === "ready"
                ? "Personal chat bodies are sealed on this device (KP1). Times are Asia/Dhaka."
                : "Secure chat is not ready yet, so personal messages cannot be sent."}
            <span className="composer__counter" aria-hidden="true">
              {(isEditing ? editText : controller.draft).length}/{MESSAGE_BODY_LIMIT}
            </span>
          </p>
        </footer>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {`Signed in as ${meName}. ${controller.messages.length} messages loaded.`}
      </p>

      {galleryOpen && (
        <div className="gallery-overlay">
          <Suspense fallback={<p className="attach-loading">Loading shared media…</p>}>
            <MediaGallery
              api={api}
              media={galleryRows}
              loading={controller.sharedMediaStatus === "loading"}
              error={controller.sharedMediaStatus === "error" ? controller.sharedMediaError : ""}
              onRetry={() => void controller.retrySharedMedia()}
              onClose={() => setGalleryOpen(false)}
              onOpen={openGalleryItem}
              onAnnounce={controller.announce}
            />
          </Suspense>
        </div>
      )}

      {viewer && (
        <div className="viewer-overlay">
          <Suspense fallback={<p className="attach-loading">Loading the viewer…</p>}>
            <MediaViewer
              items={viewerItems}
              index={viewer.index}
              onIndexChange={(index) => setViewer({ items: viewer.items, index })}
              onClose={() => setViewer(null)}
              onDelete={(item) => {
                setViewer(null);
                void controller.deleteMessage(item.id);
              }}
              onForward={(item) => {
                // A row opened from the shared-media panel is not in the
                // transcript's index, so the viewer's own rows are the fallback.
                const row =
                  rowsById.get(item.id) ??
                  viewer?.items.find((candidate) => candidate.id === item.id);
                setViewer(null);
                if (row) openForward(row.albumMembers.length > 1 ? row.albumMembers : [row]);
              }}
              onShown={(item) => {
                // The single opening: the picture is on screen, so report it.
                if (item.viewOnce && !item.spent) controller.spendViewOnce(item.id);
              }}
              onAnnounce={controller.announce}
            />
          </Suspense>
        </div>
      )}

      {docTarget && (
        <div className="doc-overlay">
          <Suspense fallback={<p className="attach-loading">Loading the document…</p>}>
            <DocViewer
              message={docTarget}
              api={api}
              own={docTarget.senderId === meId}
              onClose={() => setDocTarget(null)}
              onDelete={
                canDeleteForEveryone(docTarget, conversation, docTarget.senderId === meId)
                  ? (row) => {
                      setDocTarget(null);
                      void controller.deleteMessage(row.id);
                    }
                  : undefined
              }
              onForward={
                canForwardRow(docTarget, forwardContext, docTarget.senderId === meId).allowed
                  ? (row) => {
                      setDocTarget(null);
                      openForward([row]);
                    }
                  : undefined
              }
              onAnnounce={controller.announce}
            />
          </Suspense>
        </div>
      )}

      {forwardFor && (
        <div className="forward-overlay">
          <Suspense fallback={<p className="attach-loading">Loading your chats…</p>}>
            <ForwardDialog
              conversations={controller.conversations}
              count={forwardFor.length}
              api={api}
              onClose={() => setForwardFor(null)}
              onSend={(targets) => {
                const items = forwardFor;
                setForwardFor(null);
                clearSelection();
                setViewer(null);
                setDocTarget(null);
                if (items) void controller.forwardMessages(items, [...targets]);
              }}
            />
          </Suspense>
        </div>
      )}

      {editorTarget && (
        <div className="editor-overlay">
          <Suspense fallback={<p className="attach-loading">Loading the photo editor…</p>}>
            <PhotoEditor
              file={originals.current.get(editorTarget.id)?.blob ?? editorTarget.blob}
              fileName={editorTarget.pickedName}
              sourceWidth={originals.current.get(editorTarget.id)?.width ?? editorTarget.width}
              sourceHeight={originals.current.get(editorTarget.id)?.height ?? editorTarget.height}
              initialEdit={editorTarget.edit}
              onCancel={() => setEditorTarget(null)}
              onDone={onEditorDone}
              onAnnounce={controller.announce}
            />
          </Suspense>
        </div>
      )}
    </main>
  );
}
