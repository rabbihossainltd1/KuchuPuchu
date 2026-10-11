import { useEffect, useRef, useState } from "react";

import type { ApiClient } from "../auth/authApi";
import { Icon, type IconName } from "../icons";
import type { Navigate } from "../useBrowserRouter";
import { CAPABILITY_COPY } from "./chatCopy";
import { chatThemeOr, CHAT_THEME_LABELS } from "./chatTheme";
import { hiddenKeyHash } from "./e2ee";
import { DAY_OPTIONS, customPick, quickPicks, scheduleStamp, type ScheduledRow } from "./schedule";
import { messagingApi } from "./messagingApi";
import { MuteChooser } from "./MuteChooser";
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
  scheduledCount = 0,
  initialView = "root",
  aiIncognito = false,
  onToggleIncognito,
  onOpenHistory,
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
  /** Pending scheduled rows — the phone only shows the menu row with rows. */
  scheduledCount?: number;
  /** The composer's long-press opens the sheet straight on the schedule view. */
  initialView?: "root" | "sendlater" | "scheduled";
  /** Slice AI: the phone's AI-chat menu state. */
  aiIncognito?: boolean;
  onToggleIncognito?: () => void;
  onOpenHistory?: () => void;
}) {
  const [view, setView] = useState<
    | "root"
    | "mute"
    | "privacy"
    | "notes"
    | "theme"
    | "find"
    | "hide"
    | "delete"
    | "sendlater"
    | "scheduled"
    | "disappear"
  >(initialView);
  const [scheduledRows, setScheduledRows] = useState<readonly ScheduledRow[]>([]);
  const [sendCustom, setSendCustom] = useState(false);
  const [dayOff, setDayOff] = useState(0);
  const [hour12, setHour12] = useState((new Date().getHours() + 1) % 12 || 12);
  const [minute, setMinute] = useState(0);
  const [pm, setPm] = useState((new Date().getHours() + 1) % 24 >= 12);
  const [hideKey, setHideKey] = useState("");
  const [alsoForThem, setAlsoForThem] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState<readonly MessageRow[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [priv, setPriv] = useState(conversation.privacy);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (view !== "scheduled" || !api) return;
    const client = api;
    let live = true;
    void messagingApi
      .listScheduled(client, conversation.id)
      .then((rows) => {
        if (live) setScheduledRows(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [view, api, conversation.id]);

  const muted = conversation.mutedCall || conversation.mutedMsg;
  const peerId = conversationPeerId(conversation);
  const bot = isBotConversation(conversation);
  const ai = peerId === "kp_ai_bot";

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
        role="dialog"
        aria-label={`Conversation options for ${conversationTitle(conversation)}`}
        onClick={(event) => event.stopPropagation()}
      >
        {view === "root" && ai && (
          <>
            <p className="chat-menu__title">{conversationTitle(conversation)}</p>
            {scheduledCount > 0
              ? row("schedule", "Scheduled messages", () => setView("scheduled"))
              : null}
            {row("schedule", "History", () => {
              onClose();
              onOpenHistory?.();
            })}
            {row(
              "chats",
              "New chat",
              () =>
                void run("New", async (client) => {
                  await messagingApi.resetAiConversation(client, conversation.id);
                  await controller.selectConversation(conversation.id);
                  onClose();
                }),
            )}
            {row("bellOff", muted ? "Unmute…" : "Mute…", () => setView("mute"))}
            {row("palette", "Chat theme", () => setView("theme"))}
            {row("hide", aiIncognito ? "Close incognito mode" : "Incognito mode", () => {
              onClose();
              onToggleIncognito?.();
            })}
            {row("search", "Search in chat", () => setView("find"))}
          </>
        )}

        {view === "root" && !ai && (
          <>
            <p className="chat-menu__title">{conversationTitle(conversation)}</p>
            {row(
              "photo",
              conversation.isGroup ? "Group Media" : "Media, links, and docs",
              onOpenMedia,
            )}
            {scheduledCount > 0
              ? row("schedule", "Scheduled messages", () => setView("scheduled"))
              : null}
            {row("search", "Search in chat", () => setView("find"))}
            {row("bellOff", muted ? "Unmute…" : "Mute…", () => setView("mute"))}
            {!conversation.isGroup && !bot
              ? row("timer", "Disappearing messages", () => setView("disappear"))
              : null}
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
              : null}
            {!bot ? row("hide", "Hide chat", () => setView("hide")) : null}
            {!conversation.isGroup && !bot
              ? row("trash", "Delete chat", () => setView("delete"), { danger: true })
              : null}
          </>
        )}

        {view === "hide" && (
          <>
            <p className="chat-menu__title">Hide chat</p>
            <p className="chat-menu__notes">
              The chat leaves your list and returns only when its secret key is typed in Search. The
              key is hashed on this device — it is never sent or stored as text.
            </p>
            <label className="search-field chat-menu__field">
              <Icon name="lock" size={18} />
              <input
                value={hideKey}
                maxLength={64}
                placeholder="Secret key"
                aria-label="Secret key"
                onChange={(event) => setHideKey(event.target.value.slice(0, 64))}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={busy !== "" || hideKey.trim().length === 0}
              onClick={() =>
                void run("Hide", async (client) => {
                  const hash = await hiddenKeyHash(hideKey);
                  await messagingApi.hideConversation(client, conversation.id, true, hash);
                  controller.announce("Chat hidden");
                  onClose();
                  backToChats();
                })
              }
            >
              Hide
            </button>
          </>
        )}

        {view === "delete" && (
          <>
            <p className="chat-menu__title">Delete Chat</p>
            <p className="chat-menu__notes">
              Permanently delete the chat with {conversationTitle(conversation)}?
            </p>
            <label className="chat-menu__toggle">
              <span>Also delete for {conversationTitle(conversation)}</span>
              <input
                type="checkbox"
                checked={alsoForThem}
                onChange={(event) => setAlsoForThem(event.target.checked)}
              />
            </label>
            <button
              type="button"
              className="primary-button chat-menu__danger"
              disabled={busy !== ""}
              onClick={() =>
                void run("Delete", async (client) => {
                  await messagingApi.deleteConversation(client, conversation.id, alsoForThem);
                  controller.announce("Chat deleted");
                  onClose();
                  backToChats();
                })
              }
            >
              Delete Chat
            </button>
          </>
        )}

        {view === "sendlater" && (
          <>
            <p className="chat-menu__title">Send later</p>
            {quickPicks(new Date()).map((pick) =>
              row("schedule", pick.label, () => {
                void (async () => {
                  if (await controller.scheduleSend(pick.at.toISOString())) onClose();
                })();
              }),
            )}
            {!sendCustom ? row("pencil", "Pick date & time", () => setSendCustom(true)) : null}
            {sendCustom && (
              <div className="chat-menu__sched-custom">
                <div className="chat-menu__sched-days" role="radiogroup" aria-label="Day">
                  {DAY_OPTIONS.map((option) => (
                    <button
                      key={option.offset}
                      type="button"
                      role="radio"
                      aria-checked={dayOff === option.offset}
                      className={`chat-menu__chip${dayOff === option.offset ? " is-on" : ""}`}
                      onClick={() => setDayOff(option.offset)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="chat-menu__sched-clock">
                  <div className="chat-menu__wheel" aria-label="Hour">
                    <button
                      type="button"
                      aria-label="Hour up"
                      onClick={() => setHour12((hour12 % 12) + 1)}
                    >
                      +
                    </button>
                    <span>{hour12}</span>
                    <button
                      type="button"
                      aria-label="Hour down"
                      onClick={() => setHour12(((hour12 + 10) % 12) + 1)}
                    >
                      −
                    </button>
                  </div>
                  <span className="chat-menu__sched-colon">:</span>
                  <div className="chat-menu__wheel" aria-label="Minute">
                    <button
                      type="button"
                      aria-label="Minute up"
                      onClick={() => setMinute((minute + 5) % 60)}
                    >
                      +
                    </button>
                    <span>{String(minute).padStart(2, "0")}</span>
                    <button
                      type="button"
                      aria-label="Minute down"
                      onClick={() => setMinute((minute + 55) % 60)}
                    >
                      −
                    </button>
                  </div>
                  <div className="chat-menu__sched-ampm" role="radiogroup" aria-label="AM or PM">
                    {([false, true] as const).map((isPm) => (
                      <button
                        key={String(isPm)}
                        type="button"
                        role="radio"
                        aria-checked={pm === isPm}
                        className={`chat-menu__chip${pm === isPm ? " is-on" : ""}`}
                        onClick={() => setPm(isPm)}
                      >
                        {isPm ? "PM" : "AM"}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const picked = customPick(new Date(), dayOff, hour12, minute, pm);
                  const valid = picked.getTime() > Date.now();
                  return (
                    <>
                      <p className={`chat-menu__sched-stamp${valid ? "" : " is-bad"}`}>
                        {valid ? scheduleStamp(picked.toISOString()) : "Pick a later time"}
                      </p>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!valid || busy !== ""}
                        onClick={() => {
                          void (async () => {
                            if (await controller.scheduleSend(picked.toISOString())) onClose();
                          })();
                        }}
                      >
                        Schedule
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {view === "scheduled" && (
          <>
            <p className="chat-menu__title">Scheduled</p>
            {scheduledRows.length === 0 && (
              <p className="chat-menu__notes">Nothing is waiting to send.</p>
            )}
            {scheduledRows.map((item) => (
              <div className="chat-menu__sched-row" key={item.id}>
                <Icon name="schedule" size={18} />
                <span className="chat-menu__sched-body">
                  <span className="chat-menu__sched-preview">{item.preview || "Message"}</span>
                  <span className="chat-menu__sched-stamp">{scheduleStamp(item.sendAt)}</span>
                </span>
                <button
                  type="button"
                  className="icon-button chat-menu__sched-cancel"
                  aria-label="Cancel scheduled message"
                  onClick={() =>
                    void run("Cancel", async (client) => {
                      await messagingApi.cancelScheduled(client, item.id);
                      setScheduledRows((current) =>
                        current.filter((rowItem) => rowItem.id !== item.id),
                      );
                    })
                  }
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </>
        )}

        {view === "disappear" && (
          <>
            <p className="chat-menu__title">Disappearing messages</p>
            {(
              [
                [0, "Off"],
                [86400, "24 hours"],
                [604800, "7 days"],
                [7776000, "90 days"],
              ] as const
            ).map(([seconds, label]) => (
              <button
                key={seconds}
                type="button"
                className="chat-menu__row"
                disabled={busy !== ""}
                onClick={() =>
                  void run("Disappearing", async (client) => {
                    await messagingApi.setDisappearSeconds(client, conversation.id, seconds);
                    onClose();
                  })
                }
              >
                <span>{label}</span>
                {conversation.disappearSeconds === seconds ? <Icon name="check" size={18} /> : null}
              </button>
            ))}
          </>
        )}

        {view === "mute" && (
          <>
            <p className="chat-menu__title">Mute…</p>
            <MuteChooser
              callMuted={conversation.mutedCall}
              msgMuted={conversation.mutedMsg}
              onPick={(call, msg) =>
                void run("Mute", async (client) => {
                  await messagingApi.setMute(client, conversation.id, { call, msg });
                })
              }
            />
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
