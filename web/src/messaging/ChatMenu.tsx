import { useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon, type IconName } from "../icons";
import type { Navigate } from "../useBrowserRouter";
import { CAPABILITY_COPY } from "./chatCopy";
import { chatThemeOr, CHAT_THEME_LABELS } from "./chatTheme";
import { messagingApi } from "./messagingApi";
import {
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
}: {
  api: ApiClient | null;
  conversation: ConversationRow;
  controller: MessagingController;
  canPickTheme: boolean;
  onClose: () => void;
  onOpenMedia: () => void;
  navigate: Navigate;
  meId: string;
}) {
  const [view, setView] = useState<"root" | "mute" | "privacy" | "notes" | "theme">("root");
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
