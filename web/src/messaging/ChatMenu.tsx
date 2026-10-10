import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon, type IconName } from "../icons";
import type { Navigate } from "../useBrowserRouter";
import { CAPABILITY_COPY } from "./chatCopy";
import { chatThemeOr, CHAT_THEME_LABELS } from "./chatTheme";
import { messagingApi } from "./messagingApi";
import type { MessageRow } from "./protocol";
import { searchSnippet } from "./SearchPane";

import {
  clockTime,
  conversationPeerId,
  conversationTitle,
  isBotConversation,
  type ConversationRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

/**
 * The phone's ⋮ bottom sheet, row for row. Solo chats get the person's list
 * (media, mute chooser, chat privacy, theme, notes, block, delete), groups
 * the group's (media, mute, theme, notes, leave). Every write goes through
 * the same Worker routes the phone uses.
 */
export function ChatMenu({
  api,
  conversation,
  controller,
  canPickTheme,
  onClose,
  onOpenMedia,
  navigate,
  meId,
  onJumpToMessage,
}: {
  api: ApiClient | null;
  conversation: ConversationRow;
  controller: MessagingController;
  canPickTheme: boolean;
  onClose: () => void;
  onOpenMedia: () => void;
  navigate: Navigate;
  meId: string;
  onJumpToMessage: (messageId: string) => void;
}) {
  const [view, setView] = useState<"root" | "mute" | "privacy" | "notes" | "theme" | "find">(
    "root",
  );
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState<readonly MessageRow[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [muteCall, setMuteCall] = useState(conversation.mutedCall);
  const [muteMsg, setMuteMsg] = useState(conversation.mutedMsg);
  const [priv, setPriv] = useState(conversation.privacy);

  const muted = conversation.mutedCall || conversation.mutedMsg;
  const peerId = conversationPeerId(conversation);
  const bot = isBotConversation(conversation);

  const themeLabel =
    CHAT_THEME_LABELS.find((option) => option.value === chatThemeOr(conversation.theme))?.label ??
    "Dark Blue";

  const run = async (name: string, job: (client: ApiClient) => Promise<void>) => {
    if (!api || busy) return;
    const client = api;
    setBusy(name);
    try {
      await job(client);
      await controller.refreshList();
    } catch {
      controller.announce("That did not work. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  };

  const backToChats = () => navigate({ kind: "section", section: "chats" });

  const row = (
    icon: IconName,
    label: string,
    onClick: () => void,
    opts: { danger?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      type="button"
      className={`chat-menu__row${opts.danger ? " is-danger" : ""}`}
      disabled={opts.disabled || busy !== ""}
      onClick={onClick}
    >
      <Icon name={icon} size={19} />
      <span>{label}</span>
      {busy !== "" && label.startsWith(busy) ? <em>…</em> : null}
    </button>
  );

  return (
    <div className="chat-menu-overlay" role="presentation" onClick={onClose}>
      <div
        className="chat-menu"
        role="menu"
        aria-label={`Conversation options for ${conversationTitle(conversation)}`}
        onClick={(event) => event.stopPropagation()}
      >
        {view === "root" && (
          <>
            <p className="chat-menu__title">{conversationTitle(conversation)}</p>
            {row(
              "photo",
              conversation.isGroup ? "Group Media" : "Media, links, and docs",
              onOpenMedia,
            )}
            {row("search", "Search in chat", () => setView("find"))}
            {row("bellOff", muted ? "Unmute…" : "Mute…", () => setView("mute"))}
            {!conversation.isGroup && !bot
              ? row("lock", "Chat privacy", () => setView("privacy"))
              : null}
            {row("palette", "Chat theme", () => setView("theme"))}
            {row("eye", "Privacy notes", () => setView("notes"))}
            {!conversation.isGroup && !bot
              ? row(
                  "block",
                  conversation.blockedByMe ? "Unblock" : "Block",
                  () =>
                    void run(conversation.blockedByMe ? "Unblock" : "Block", async (client) => {
                      if (conversation.blockedByMe) await messagingApi.unblockUser(client, peerId);
                      else await messagingApi.blockUser(client, peerId);
                      controller.announce(conversation.blockedByMe ? "Unblocked." : "Blocked.");
                      onClose();
                    }),
                  { danger: !conversation.blockedByMe },
                )
              : null}
            {conversation.isGroup
              ? row(
                  "logout",
                  confirm === "leave" ? "Leave group — confirm" : "Leave Group",
                  () => {
                    if (confirm !== "leave") {
                      setConfirm("leave");
                      return;
                    }
                    void run("Leave", async (client) => {
                      await messagingApi.leaveGroup(client, conversation.id, meId);
                      onClose();
                      backToChats();
                    });
                  },
                  { danger: true },
                )
              : row(
                  "trash",
                  confirm === "delete" ? "Delete chat — confirm" : "Delete chat",
                  () => {
                    if (confirm !== "delete") {
                      setConfirm("delete");
                      return;
                    }
                    void run("Delete", async (client) => {
                      await messagingApi.hideConversation(client, conversation.id, true);
                      onClose();
                      backToChats();
                    });
                  },
                  { danger: true },
                )}
          </>
        )}

        {view === "mute" && (
          <>
            <p className="chat-menu__title">Mute…</p>
            <label className="chat-menu__toggle">
              <span>Calls</span>
              <input
                type="checkbox"
                checked={muteCall}
                onChange={(event) => {
                  const call = event.target.checked;
                  setMuteCall(call);
                  void run("Mute", async (client) => {
                    await messagingApi.setMute(client, conversation.id, { call, msg: muteMsg });
                  });
                }}
              />
            </label>
            <label className="chat-menu__toggle">
              <span>Messages</span>
              <input
                type="checkbox"
                checked={muteMsg}
                onChange={(event) => {
                  const msg = event.target.checked;
                  setMuteMsg(msg);
                  void run("Mute", async (client) => {
                    await messagingApi.setMute(client, conversation.id, { call: muteCall, msg });
                  });
                }}
              />
            </label>
            <p className="chat-menu__note">
              Muting calls hides this chat&apos;s call buttons and silences the ring; muting
              messages silences only the message tone — the phone&apos;s two halves.
            </p>
          </>
        )}

        {view === "privacy" && (
          <>
            <p className="chat-menu__title">Chat privacy</p>
            {(
              [
                ["shot", "They may screenshot what I send"],
                ["rec", "They may record what I send"],
                ["save", "I may keep what they send"],
                ["readReceipts", "Share my read receipts"],
              ] as const
            ).map(([key, label]) => (
              <label className="chat-menu__toggle" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={priv[key]}
                  onChange={(event) => {
                    const next = { ...priv, [key]: event.target.checked };
                    setPriv(next);
                    void run("Chat", async (client) => {
                      await messagingApi.setChatPrivacy(client, conversation.id, {
                        shot: next.shot,
                        rec: next.rec,
                        save: next.save,
                        readReceipts: next.readReceipts,
                      });
                    });
                  }}
                />
              </label>
            ))}
          </>
        )}

        {view === "theme" && (
          <>
            <p className="chat-menu__title">
              Chat theme <span>{themeLabel}</span>
            </p>
            {canPickTheme ? (
              <div className="chat-theme-picker__options" role="radiogroup" aria-label="Chat theme">
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
                      aria-label={`Chat theme ${option.label}`}
                      onClick={() => void controller.setChatTheme(option.value)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="chat-menu__note">
                Only the group owner can change this chat&apos;s theme.
              </p>
            )}
          </>
        )}

        {view === "find" && (
          <FindView
            api={api}
            conversationId={conversation.id}
            inputRef={findInputRef}
            results={findResults}
            setResults={setFindResults}
            query={findQuery}
            setQuery={setFindQuery}
            onPick={(id) => {
              onJumpToMessage(id);
              onClose();
            }}
          />
        )}

        {view === "notes" && (
          <>
            <p className="chat-menu__title">Privacy notes</p>
            <ul className="chat-menu__notes">
              <li>{CAPABILITY_COPY.mediaNotEncrypted}</li>
              <li>{CAPABILITY_COPY.captureWarning}</li>
              <li>{CAPABILITY_COPY.stillPending}</li>
              <li>{CAPABILITY_COPY.voiceRecorderNotice}</li>
              <li>{CAPABILITY_COPY.documentPreviewNotice}</li>
              <li>{CAPABILITY_COPY.forwardingNotice}</li>
              {conversation.isGroup && (
                <li>Group calls stay on the phone: the Web runs no group mesh yet.</li>
              )}
              {conversation.mutedCall && <li>Calls are muted for this chat.</li>}
            </ul>
          </>
        )}

        {view !== "root" && (
          <button type="button" className="chat-menu__row" onClick={() => setView("root")}>
            <Icon name="arrow" size={19} />
            <span>Back</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** The ⋮ sheet's in-chat search: server-side LIKE over this conversation's
 *  TEXT/IMAGE/FILE rows, view-once excluded, debounce + abort like the global
 *  pane. Picking a row closes the sheet and asks the transcript to scroll. */
function FindView({
  api,
  conversationId,
  inputRef,
  results,
  setResults,
  query,
  setQuery,
  onPick,
}: {
  api: ApiClient | null;
  conversationId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  results: readonly MessageRow[];
  setResults: (rows: readonly MessageRow[]) => void;
  query: string;
  setQuery: (value: string) => void;
  onPick: (messageId: string) => void;
}) {
  const needle = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  useEffect(() => {
    if (!api || needle.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void messagingApi
        .searchMessages(api, conversationId, needle, controller.signal)
        .then((rows) => setResults(rows.filter((row) => !row.viewOnce)))
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, conversationId, needle, setResults]);

  return (
    <>
      <p className="chat-menu__title">Search in chat</p>
      <label className="search-field chat-menu__find-field" htmlFor="chat-find">
        <Icon name="search" size={16} />
        <input
          id="chat-find"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Message text"
          aria-label="Search messages in this chat"
          autoComplete="off"
        />
      </label>
      <ul className="chat-menu__find-results" aria-label="Message matches">
        {results.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="chat-menu__row chat-menu__find-row"
              onClick={() => onPick(row.id)}
            >
              <span className="chat-menu__find-snippet">{searchSnippet(row)}</span>
              <span className="chat-menu__find-time">{clockTime(row.createdAt)}</span>
            </button>
          </li>
        ))}
        {needle.length >= 2 && results.length === 0 && (
          <li className="chat-menu__note">No matches in this chat.</li>
        )}
      </ul>
    </>
  );
}
