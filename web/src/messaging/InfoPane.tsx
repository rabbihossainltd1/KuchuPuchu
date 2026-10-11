/**
 * Slice T — the phone's profile / group-info screen as a right-hand drawer.
 *
 * Solo chats (and search people) get the person card: picture, name, badge,
 * @username, presence line and about, with Message / Mute / Block. Groups get
 * the info card: title, member count, the private-group state, the member
 * list with roles, and the role-gated actions the Worker enforces — add and
 * remove for the owner only, leave for every member. Everything writes
 * through the same routes the phone uses; refusals surface verbatim.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import type { Navigate } from "../useBrowserRouter";
import { useAvatar } from "./avatars";
import { messagingApi } from "./messagingApi";
import {
  conversationTitle,
  headerSubtitle,
  isBotConversation,
  peerPresence,
  type ConversationMember,
  type ConversationPeer,
  type ConversationRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

function MemberRow({
  member,
  meId,
  isOwner,
  busy,
  onRemove,
}: {
  member: ConversationMember;
  meId: string;
  isOwner: boolean;
  busy: string;
  onRemove: (userId: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const url = useAvatar(null, member.user.avatarRef);
  const self = member.user.id === meId;
  const removable = isOwner && !self && member.role !== "owner";

  return (
    <li className="info-pane__member">
      <span className="conversation-row__avatar" aria-hidden="true">
        {url ? (
          <img className="avatar-img" src={url} alt="" draggable={false} />
        ) : (
          (member.user.displayName || "?").charAt(0).toUpperCase()
        )}
      </span>
      <span className="conversation-row__body">
        <span className="conversation-row__name">
          {member.user.nickname || member.user.displayName}
          {self ? " (you)" : ""}
        </span>
        <span className="conversation-row__preview">
          {member.role === "owner" ? "owner" : member.role === "admin" ? "admin" : "member"}
        </span>
      </span>
      {removable &&
        (confirm ? (
          <button
            type="button"
            className="text-button is-danger"
            disabled={busy !== ""}
            onClick={() => onRemove(member.user.id)}
          >
            Remove — confirm
          </button>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={busy !== ""}
            onClick={() => setConfirm(true)}
            aria-label={`Remove ${member.user.displayName} from the group`}
          >
            Remove
          </button>
        ))}
    </li>
  );
}

export function InfoPane({
  api,
  conversation,
  peer,
  meId,
  controller,
  onClose,
  navigate,
}: {
  api: ApiClient | null;
  /** Set when opened from an open chat; null for a search person. */
  conversation: ConversationRow | null;
  /** Set when opened from search without a conversation yet. */
  peer: ConversationPeer | null;
  meId: string;
  controller: MessagingController | null;
  onClose: () => void;
  navigate: Navigate;
}) {
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<readonly ConversationPeer[]>([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [nicknameView, setNicknameView] = useState<"closed" | "list" | "edit">("closed");
  const [nicknameTarget, setNicknameTarget] = useState<ConversationPeer | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameValues, setNicknameValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setNicknameValues({});
    setNicknameTarget(null);
    setNicknameDraft("");
    setNicknameView("closed");
    setProfileMenuOpen(false);
  }, [conversation?.id]);

  const person = conversation ? conversation.other : peer;
  const group = conversation?.isGroup ?? false;
  const isOwner = Boolean(conversation && conversation.ownerId === meId);
  const bot = conversation ? isBotConversation(conversation) : false;
  const nicknameTargets = (
    group
      ? (conversation?.members.map((member) => member.user).filter((user) => user.id !== meId) ??
        [])
      : person
        ? [person]
        : []
  ).map((user) => ({
    ...user,
    nickname: nicknameValues[user.id] ?? user.nickname,
  }));
  const canOpenProfileMenu = Boolean(conversation && !bot);

  const personUrl = useAvatar(api, person?.avatarRef ?? "");
  const groupUrl = useAvatar(api, conversation?.avatarRef ?? "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!api || !group || !isOwner || addQuery.trim().length < 2) {
      setAddResults([]);
      return;
    }
    const controllerAbort = new AbortController();
    const timer = window.setTimeout(() => {
      void messagingApi
        .search(api, addQuery.trim(), controllerAbort.signal)
        .then((results) =>
          setAddResults(
            results.users.filter(
              (user) => !conversation?.members.some((member) => member.user.id === user.id),
            ),
          ),
        )
        .catch(() => {
          if (!controllerAbort.signal.aborted) setAddResults([]);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controllerAbort.abort();
    };
  }, [api, group, isOwner, addQuery, conversation?.members]);

  const run = async (name: string, job: (client: ApiClient) => Promise<void>) => {
    if (!api || busy) return;
    const client = api;
    setBusy(name);
    try {
      await job(client);
      await controller?.refreshList();
    } catch (error) {
      controller?.announce(
        error instanceof Error && error.message
          ? error.message
          : "That did not work. Check your connection and try again.",
      );
    } finally {
      setBusy("");
      setConfirm("");
    }
  };

  const openChat = () => {
    if (conversation) {
      navigate({ kind: "conversation", conversationId: conversation.id });
    } else if (peer && api) {
      void (async () => {
        const created = await messagingApi.createConversation(api, peer.id, {
          request: true,
        });
        if (created) navigate({ kind: "conversation", conversationId: created.id });
        else controller?.announce("The chat could not be opened.");
      })();
    }
    onClose();
  };

  const title = conversation ? conversationTitle(conversation) : (person?.displayName ?? "");

  return (
    <aside className="info-pane" role="dialog" aria-label={`${title} profile`}>
      <header className="info-pane__header">
        <h2>{nicknameView === "closed" ? (group ? "Group info" : "Profile") : "Nicknames"}</h2>
        <div className="info-pane__header-actions">
          {nicknameView !== "closed" ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (nicknameView === "edit") {
                  setNicknameView("list");
                } else {
                  setNicknameView("closed");
                  setNicknameTarget(null);
                }
              }}
            >
              Back
            </button>
          ) : null}
          {canOpenProfileMenu && nicknameView === "closed" ? (
            <div className="info-pane__menu-wrap">
              <button
                type="button"
                className="icon-button"
                aria-label="More profile options"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <Icon name="more" size={20} />
              </button>
              {profileMenuOpen ? (
                <div className="info-pane__menu" role="menu" aria-label="Profile options">
                  <button
                    type="button"
                    role="menuitem"
                    className="info-pane__menu-item"
                    disabled={busy !== ""}
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setNicknameView("list");
                    }}
                  >
                    <Icon name="pencil" size={18} />
                    <span>Nicknames</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Close profile"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </header>

      {nicknameView === "closed" ? (
        <>
          <div className="info-pane__card">
            <span className="info-pane__avatar" aria-hidden="true">
              {(group ? groupUrl : personUrl) ? (
                <img
                  className="avatar-img"
                  src={(group ? groupUrl : personUrl) ?? ""}
                  alt=""
                  draggable={false}
                />
              ) : (
                (title || "?").charAt(0).toUpperCase()
              )}
            </span>
            <p className="info-pane__name">
              {title}
              {!group && person?.verified ? (
                <span className="conversation-row__tag">Verified</span>
              ) : null}
            </p>
            {!group && person ? (
              <>
                <p className="info-pane__line">@{person.username}</p>
                <p className="info-pane__line">{bot ? "Official account" : peerPresence(person)}</p>
                {person.about ? <p className="info-pane__about">{person.about}</p> : null}
              </>
            ) : null}
            {group && conversation ? (
              <>
                <p className="info-pane__line">{headerSubtitle(conversation)}</p>
                {conversation.privateGroup ? (
                  <p className="info-pane__line">Private group</p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="info-pane__actions">
            {!group && (
              <button
                type="button"
                className="text-button"
                onClick={openChat}
                disabled={busy !== ""}
              >
                Message
              </button>
            )}
            {!group && conversation && !bot && (
              <button
                type="button"
                className="text-button"
                disabled={busy !== ""}
                onClick={() =>
                  void run(conversation.mutedMsg ? "Unmute" : "Mute", async (client) => {
                    await messagingApi.setMute(client, conversation.id, {
                      call: conversation.mutedCall,
                      msg: !conversation.mutedMsg,
                    });
                    controller?.announce(conversation.mutedMsg ? "Unmuted." : "Messages muted.");
                  })
                }
              >
                {conversation.mutedMsg ? "Unmute messages" : "Mute messages"}
              </button>
            )}
            {!group && !bot && person && (
              <button
                type="button"
                className="text-button is-danger"
                disabled={busy !== ""}
                onClick={() => {
                  const blocked = conversation?.blockedByMe ?? false;
                  if (!blocked && confirm !== "block") {
                    setConfirm("block");
                    return;
                  }
                  void run(blocked ? "Unblock" : "Block", async (client) => {
                    if (blocked) await messagingApi.unblockUser(client, person.id);
                    else await messagingApi.blockUser(client, person.id);
                    controller?.announce(blocked ? "Unblocked." : "Blocked.");
                  });
                }}
              >
                {conversation?.blockedByMe
                  ? "Unblock"
                  : confirm === "block"
                    ? "Block — confirm"
                    : "Block"}
              </button>
            )}
          </div>

          {group && conversation ? (
            <>
              <h3 className="search-group">Members</h3>
              <ul className="info-pane__members" aria-label="Group members">
                {conversation.members.map((member) => (
                  <MemberRow
                    key={member.user.id}
                    member={member}
                    meId={meId}
                    isOwner={isOwner}
                    busy={busy}
                    onRemove={(userId) =>
                      void run("Remove", async (client) => {
                        await messagingApi.removeMember(client, conversation.id, userId);
                        controller?.announce("Removed from the group.");
                      })
                    }
                  />
                ))}
              </ul>

              {isOwner && !conversation.privateGroup ? (
                <>
                  <h3 className="search-group">Add member</h3>
                  <label className="search-field info-pane__add-field" htmlFor="add-member">
                    <Icon name="search" size={16} />
                    <input
                      id="add-member"
                      type="search"
                      value={addQuery}
                      onChange={(event) => setAddQuery(event.target.value)}
                      placeholder="Search people"
                      aria-label="Search people to add to the group"
                      autoComplete="off"
                    />
                  </label>
                  <ul className="info-pane__members" aria-label="People to add">
                    {addResults.map((user) => (
                      <li key={user.id} className="info-pane__member">
                        <span className="conversation-row__body">
                          <span className="conversation-row__name">{user.displayName}</span>
                          <span className="conversation-row__preview">@{user.username}</span>
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy !== ""}
                          onClick={() =>
                            void run("Add", async (client) => {
                              await messagingApi.addMember(client, conversation.id, user.id);
                              setAddQuery("");
                              controller?.announce(`${user.displayName} added.`);
                            })
                          }
                          aria-label={`Add ${user.displayName} to the group`}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <div className="info-pane__actions">
                <button
                  type="button"
                  className="text-button is-danger"
                  disabled={busy !== ""}
                  onClick={() => {
                    if (confirm !== "leave") {
                      setConfirm("leave");
                      return;
                    }
                    void run("Leave", async (client) => {
                      await messagingApi.leaveGroup(client, conversation.id, meId);
                      onClose();
                      navigate({ kind: "section", section: "chats" });
                    });
                  }}
                >
                  {confirm === "leave" ? "Leave group — confirm" : "Leave Group"}
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <section className="info-pane__nickname-page" aria-label="Conversation nicknames">
          {nicknameView === "list" ? (
            <>
              <p className="info-pane__nickname-note">
                Aliases are shared only with people in this chat; profile names stay unchanged.
              </p>
              {nicknameTargets.length > 0 ? (
                nicknameTargets.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="info-pane__nickname-target"
                    disabled={busy !== ""}
                    onClick={() => {
                      setNicknameTarget(user);
                      setNicknameDraft(user.nickname ?? "");
                      setNicknameView("edit");
                    }}
                  >
                    <Icon name="pencil" size={17} />
                    <span>
                      {user.nickname && user.displayName !== user.nickname
                        ? `${user.displayName} · ${user.nickname}`
                        : user.displayName}
                    </span>
                  </button>
                ))
              ) : (
                <p className="info-pane__nickname-note">No other chat members are available.</p>
              )}
            </>
          ) : nicknameTarget ? (
            <>
              <p className="info-pane__nickname-note">
                For {nicknameTarget.displayName} in this chat.
              </p>
              <label className="info-pane__nickname-field" htmlFor="profile-nickname">
                <span>Nickname</span>
                <input
                  id="profile-nickname"
                  value={nicknameDraft}
                  maxLength={40}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  placeholder={nicknameTarget.displayName}
                  disabled={busy !== ""}
                  autoFocus
                />
              </label>
              <div className="info-pane__nickname-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy !== "" || !nicknameDraft.trim()}
                  onClick={() =>
                    void run("Nickname", async (client) => {
                      await messagingApi.setNickname(
                        client,
                        conversation!.id,
                        nicknameTarget.id,
                        nicknameDraft,
                      );
                      const nickname = nicknameDraft.trim();
                      setNicknameValues((values) => ({ ...values, [nicknameTarget.id]: nickname }));
                      controller?.announce("Nickname saved for this chat.");
                      setNicknameTarget({ ...nicknameTarget, nickname });
                      setNicknameView("list");
                    })
                  }
                >
                  Save
                </button>
                {nicknameTarget.nickname ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy !== ""}
                    onClick={() =>
                      void run("Nickname", async (client) => {
                        await messagingApi.setNickname(
                          client,
                          conversation!.id,
                          nicknameTarget.id,
                          "",
                        );
                        setNicknameDraft("");
                        setNicknameValues((values) => ({ ...values, [nicknameTarget.id]: "" }));
                        setNicknameTarget({ ...nicknameTarget, nickname: "" });
                        controller?.announce("Nickname cleared.");
                        setNicknameView("list");
                      })
                    }
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy !== ""}
                  onClick={() => setNicknameView("list")}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </aside>
  );
}
