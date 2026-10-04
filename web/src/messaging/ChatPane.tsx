/**
 * Open-chat pane: transcript, composer, message actions and the honest E2EE
 * state bar.
 *
 * Every action has a visible, labelled control. The parity plan forbids
 * hover-only and gesture-only affordances, so the per-message action row is
 * always in the tab order and revealed visually on hover *or* keyboard focus.
 *
 * Capability limits are stated rather than hidden: attachments arrive in a
 * later slice, a browser cannot block screen capture, and an envelope that
 * cannot be opened says so instead of rendering ciphertext.
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
import { AttachMenu, type AttachSource } from "./AttachMenu";
import { AlbumGrid, AttachmentRow } from "./AttachmentRow";
import { OnceText } from "./OnceText";
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
import {
  MESSAGE_BODY_LIMIT,
  TICK_LABELS,
  clockTime,
  conversationInitial,
  conversationTitle,
  foldAlbums,
  groupByDay,
  isOneWayConversation,
  tickState,
  type ConversationRow,
  type MessageRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

// Both surfaces are heavy (a zoom/pan stage, a thumbnail grid that resolves
// every media URL) and neither is needed to read a chat, so they load on
// demand like the photo editor and the sticker picker do.
const MediaViewer = lazy(() =>
  import("./MediaViewer").then((module) => ({ default: module.MediaViewer })),
);
const MediaGallery = lazy(() =>
  import("./MediaGallery").then((module) => ({ default: module.MediaGallery })),
);

/** A stable empty list, so the viewer's URL hook has a constant dependency. */
const NO_ROWS: readonly MessageRow[] = Object.freeze([]);

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
  // The bytes as picked, kept so re-opening the editor never re-compresses an
  // already-baked JPEG (each bake would cost another generation of quality).
  const originals = useRef<Map<string, { blob: Blob; width: number; height: number }>>(new Map());

  const conversation = controller.selected;
  const isEditing = editingId !== "";
  // Photos that share an album id and a sender fold into one row, exactly as
  // the phone's `foldAlbums` does, so a five-photo send is one bubble.
  const days = useMemo(() => groupByDay(foldAlbums(controller.messages)), [controller.messages]);

  // One hook resolves every URL the viewer needs; it stays mounted (with an
  // empty list) so the hook order never changes when the viewer opens.
  const viewerUrls = useMediaUrls(api, viewer?.items ?? NO_ROWS);

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
  }, []);

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
  const editableWindowMs = 60_000;
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

  const openGalleryItem = (message: MessageRow, tab: SharedMediaTab) => {
    if (tab !== "Media") return;
    const items = rowsForTab(galleryRows, "Media");
    const found = items.findIndex((row) => row.id === message.id);
    setViewer({ items, index: found < 0 ? 0 : found });
  };

  const viewerItems = (viewer?.items ?? NO_ROWS).map((row) => {
    const category = attachmentCategory(row.fileType, row.meta);
    return {
      id: row.id,
      url: viewerUrls[row.id]?.url ?? "",
      category: category === "video" ? ("video" as const) : ("photo" as const),
      title: row.fileName || (category === "video" ? "Video" : "Photo"),
      createdAt: row.createdAt,
      senderName: senderLabel(row, conversation, meId),
      own: row.senderId === meId,
      viewOnce: isViewOnce(row),
      spent: viewOnceSpent(row),
      // The Worker deletes for everyone; a local echo has nothing to delete.
      canDelete: row.senderId === meId && row.localState === "",
      width: row.mediaWidth,
      height: row.mediaHeight,
    };
  });

  return (
    <main
      className={`conversation-pane${selectedId ? " is-mobile-visible" : ""}`}
      aria-labelledby="conversation-heading"
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
          <div className="conversation-avatar" aria-hidden="true">
            {conversationInitial(conversation)}
          </div>
          <div className="conversation-header__copy">
            <h2 id="conversation-heading">{conversationTitle(conversation)}</h2>
            <p>
              {controller.typingActive
                ? "টাইপ করছে… typing"
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
              <li>{CAPABILITY_COPY.voiceAndPreviewPending}</li>
            </ul>
          </details>
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

                return (
                  <li
                    key={message.id}
                    className={`bubble-row${own ? " bubble-row--own" : ""}${
                      message.kind === "DELETED" ? " bubble-row--deleted" : ""
                    }${controller.vanishingIds.includes(message.id) ? " bubble-row--vanishing" : ""}`}
                  >
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
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => beginEdit(message)}
                              aria-label="Edit your message"
                            >
                              Edit
                            </button>
                          )}
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

        <div className="composer__row">
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
              <Icon name="plus" size={20} />
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
              <span aria-hidden="true">🙂</span>
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
                  : "Type a message. Enter sends, Shift+Enter adds a line."
            }
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
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={() => void submit()}
              disabled={oneWay || (!controller.draft.trim() && pending.length === 0)}
              aria-label={
                oneWay
                  ? "Replies are not accepted"
                  : pending.length > 0
                    ? `Send ${pending.length} attachment${pending.length === 1 ? "" : "s"}`
                    : "Send message"
              }
            >
              <Icon name="message" size={18} />
            </button>
          )}
        </div>

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
              onShown={(item) => {
                // The single opening: the picture is on screen, so report it.
                if (item.viewOnce && !item.spent) controller.spendViewOnce(item.id);
              }}
              onAnnounce={controller.announce}
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
