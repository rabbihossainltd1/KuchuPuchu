/**
 * Group creation — the phone's CreateGroupScreen as a sheet over the chat
 * list: a "Group name" field, picked-member chips, the known 1:1 peers up
 * front (typing filters them and adds directory matches off `GET /api/users`),
 * and a Create button that talks to `POST /api/conversations/group`, then
 * opens the fresh group exactly like `nav.navigate("chat/$convId")` does.
 * The 50-member ceiling and the title cap mirror the Worker's own gates.
 */

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiErrorMessage } from "../api";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import type { Navigate } from "../useBrowserRouter";
import { useAvatar } from "./avatars";
import { BOT_IDS } from "./e2ee";
import { messagingApi } from "./messagingApi";
import type { ConversationPeer } from "./protocol";
import type { MessagingController } from "./useMessaging";

const MAX_MEMBERS = 50;
const TITLE_MAX = 50;

function MemberRow({
  api,
  peer,
  on,
  onToggle,
}: {
  api: ApiClient | null;
  peer: ConversationPeer;
  on: boolean;
  onToggle: () => void;
}) {
  const url = useAvatar(api, peer.avatarRef);
  return (
    <li>
      <button
        type="button"
        className={`group-create__row${on ? " on" : ""}`}
        aria-pressed={on}
        aria-label={`${on ? "Deselect" : "Add"} ${peer.displayName}`}
        onClick={onToggle}
      >
        <span className="conversation-row__avatar group-create__avatar" aria-hidden="true">
          {url ? (
            <img className="avatar-img" src={url} alt="" draggable={false} />
          ) : (
            (peer.displayName || "?").charAt(0).toUpperCase()
          )}
        </span>
        <span className="conversation-row__body">
          <span className="conversation-row__name">{peer.displayName}</span>
          {peer.username ? (
            <span className="conversation-row__preview">@{peer.username}</span>
          ) : null}
        </span>
        <span className="group-create__tick" aria-hidden="true">
          {on ? <Icon name="check" size={14} /> : null}
        </span>
      </button>
    </li>
  );
}

export function GroupCreatePane({
  controller,
  api,
  navigate,
  initialPeerIds = [],
  onClose,
}: {
  controller: MessagingController;
  api: ApiClient | null;
  navigate: Navigate;
  /** Slice MS: "Create group with X" rides the ticked 1:1 peers along. */
  initialPeerIds?: readonly string[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<readonly ConversationPeer[]>(() => {
    if (initialPeerIds.length === 0) return [];
    const seen = new Set<string>();
    const list: ConversationPeer[] = [];
    for (const row of controller.conversations) {
      const other = row.isGroup ? null : row.other;
      if (!other || !initialPeerIds.includes(other.id) || seen.has(other.id)) continue;
      seen.add(other.id);
      list.push(other);
    }
    return list;
  });
  const [extra, setExtra] = useState<readonly ConversationPeer[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Everyone I already chat with 1:1, once each, system accounts excluded —
  // the phone seeds its list from ScreenStore.convs the same way.
  const known = useMemo(() => {
    const seen = new Set<string>();
    const list: ConversationPeer[] = [];
    for (const row of controller.conversations) {
      const other = row.isGroup ? null : row.other;
      if (!other || !other.id || BOT_IDS.has(other.id) || seen.has(other.id)) continue;
      seen.add(other.id);
      list.push(other);
    }
    return list;
  }, [controller.conversations]);

  const needle = query.trim().toLowerCase();

  useEffect(() => {
    if (needle.length < 2 || !api) {
      setExtra([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      messagingApi
        .findPeople(api, needle, ctrl.signal)
        .then((users) => setExtra(users))
        .catch(() => setExtra([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [needle, api]);

  const found = useMemo(() => {
    const knownPart =
      needle.length < 2
        ? known
        : known.filter(
            (peer) =>
              peer.displayName.toLowerCase().includes(needle) ||
              peer.username.toLowerCase().includes(needle),
          );
    const merged = [...knownPart];
    for (const peer of extra) {
      if (!merged.some((row) => row.id === peer.id) && !BOT_IDS.has(peer.id)) {
        merged.push(peer);
      }
    }
    return merged;
  }, [known, extra, needle]);

  const toggle = (peer: ConversationPeer) => {
    setError("");
    setPicked((current) => {
      if (current.some((row) => row.id === peer.id)) {
        return current.filter((row) => row.id !== peer.id);
      }
      if (current.length >= MAX_MEMBERS) return current;
      return [...current, peer];
    });
  };

  const create = async () => {
    if (!api || busy || !title.trim() || picked.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const conversationId = await messagingApi.createGroup(
        api,
        title.trim(),
        picked.map((peer) => peer.id),
      );
      onClose();
      navigate({ kind: "conversation", conversationId });
    } catch (err) {
      // The web never paints raw Worker text: fixed copy for transport errors,
      // the phone's own sentence for the only local refusal.
      const message =
        err instanceof ApiError ? apiErrorMessage(err) : err instanceof Error ? err.message : "";
      setError(message || "Could not create the group.");
    } finally {
      setBusy(false);
    }
  };

  const noResults = needle.length >= 2 && found.length === 0 && !searching;

  return (
    <div className="group-create" role="dialog" aria-modal="true" aria-label="New group">
      <header className="group-create__bar">
        <button
          type="button"
          className="icon-button"
          aria-label="Close New group"
          onClick={onClose}
        >
          <Icon name="arrow" size={20} />
        </button>
        <h2>New group</h2>
      </header>

      <label className="search-field group-create__title">
        <Icon name="group" size={18} />
        <input
          value={title}
          maxLength={TITLE_MAX}
          placeholder="Group name"
          aria-label="Group name"
          onChange={(event) => setTitle(event.target.value.slice(0, TITLE_MAX))}
        />
      </label>

      {picked.length > 0 && (
        <div className="group-create__chips" aria-label="Picked members">
          <span className="group-create__count">
            {picked.length} member{picked.length === 1 ? "" : "s"}
          </span>
          {picked.map((peer) => (
            <span key={peer.id} className="group-create__chip">
              {peer.displayName}
              <button
                type="button"
                className="group-create__chip-x"
                aria-label={`Remove ${peer.displayName}`}
                onClick={() => toggle(peer)}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      <label className="search-field group-create__search">
        <Icon name="search" size={18} />
        <input
          value={query}
          placeholder="Search"
          aria-label="Search people to add"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {known.length === 0 && needle.length < 2 ? (
        <div className="group-create__empty">
          <Icon name="group" size={30} />
          <strong>No contacts yet</strong>
          <span>Search a name to add members</span>
        </div>
      ) : (
        <ul className="group-create__list">
          {found.map((peer) => (
            <MemberRow
              key={peer.id}
              api={api}
              peer={peer}
              on={picked.some((row) => row.id === peer.id)}
              onToggle={() => toggle(peer)}
            />
          ))}
          {noResults && <li className="group-create__none">No one found</li>}
        </ul>
      )}

      {error ? (
        <p className="group-create__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="primary-button group-create__create"
        disabled={busy || title.trim().length === 0 || picked.length === 0}
        onClick={() => void create()}
      >
        {busy ? "Creating…" : "Create"}
      </button>
    </div>
  );
}
