/**
 * Slice S — global search + new chat.
 *
 * The phone's search covers people, chats and message text behind one field;
 * this pane draws the same three result groups off `GET /api/search`, and a
 * person row is the Web's New chat: opening the 1:1 with `request: true` so a
 * stranger arrives as a message request, exactly like a username search on the
 * phone. Sealed bodies never render as ciphertext here — a KP1 match previews
 * as its category word, the same rule the list rows follow. View-once rows are
 * skipped client-side the way the phone excludes them from search.
 */

import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import type { Navigate } from "../useBrowserRouter";
import { useAvatar } from "./avatars";
import { messagingApi, type SearchMessageRow } from "./messagingApi";
import {
  clockTime,
  conversationPreviewText,
  conversationTitle,
  setPendingMessageJump,
  type ConversationPeer,
  type ConversationRow,
} from "./protocol";
import { RouteLink } from "../RouteLink";
import { ConversationAvatar } from "./Avatar";
import { Icon } from "../icons";

export function searchSnippet(
  row: SearchMessageRow | { kind: string; body: string; fileName?: string },
): string {
  if (row.body.startsWith("KP1.")) return "Message";
  switch (row.kind) {
    case "TEXT":
      return row.body;
    case "IMAGE":
      return "Photo";
    case "VIDEO":
      return "Video";
    case "VOICE":
      return "Voice message";
    case "FILE":
      return row.fileName || "Document";
    default:
      return "Message";
  }
}

function PersonRow({
  api,
  peer,
  navigate,
  onStatus,
}: {
  api: ApiClient | null;
  peer: ConversationPeer;
  navigate: Navigate;
  onStatus: (message: string) => void;
}) {
  const url = useAvatar(api, peer.avatarRef);
  const [busy, setBusy] = useState(false);

  const open = () => {
    if (busy || !api) return;
    setBusy(true);
    void (async () => {
      try {
        const conversation = await messagingApi.createConversation(api, peer.id, {
          request: true,
        });
        if (conversation) navigate({ kind: "conversation", conversationId: conversation.id });
        else onStatus("The chat could not be opened.");
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "The chat could not be opened.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <li className="search-row">
      <span className="conversation-row__avatar search-row__avatar" aria-hidden="true">
        {url ? (
          <img className="avatar-img" src={url} alt="" draggable={false} />
        ) : (
          (peer.displayName || "?").charAt(0).toUpperCase()
        )}
      </span>
      <span className="conversation-row__body">
        <span className="conversation-row__name">{peer.displayName}</span>
        <span className="conversation-row__preview">@{peer.username}</span>
      </span>
      <button
        type="button"
        className="text-button search-row__open"
        onClick={open}
        disabled={busy}
        aria-label={`Message ${peer.displayName}`}
      >
        {busy ? "Opening…" : "Message"}
      </button>
    </li>
  );
}

export function SearchPane({ api, navigate }: { api: ApiClient | null; navigate: Navigate }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<readonly ConversationPeer[]>([]);
  const [chats, setChats] = useState<readonly ConversationRow[]>([]);
  const [messages, setMessages] = useState<readonly SearchMessageRow[]>([]);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const needle = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    if (!api || needle.length < 2) {
      setUsers([]);
      setChats([]);
      setMessages([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = await messagingApi.search(api, needle, controller.signal);
          setUsers(results.users);
          setChats(results.chats);
          // View-once never surfaces through search, matching the phone.
          setMessages(results.messages.filter((row) => !row.viewOnce));
          setStatus("");
        } catch (error) {
          if (controller.signal.aborted) return;
          setUsers([]);
          setChats([]);
          setMessages([]);
          setStatus(error instanceof Error ? error.message : "Search failed.");
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, needle]);

  const openMessage = (row: SearchMessageRow) => {
    setPendingMessageJump(row.id);
    navigate({ kind: "conversation", conversationId: row.convoId });
  };

  const empty =
    needle.length >= 2 && !searching && !users.length && !chats.length && !messages.length;

  return (
    <section className="list-pane search-pane" aria-labelledby="search-heading">
      <header className="list-header">
        <div>
          <p className="eyebrow">KUCHUPUCHU WEB</p>
          <h1 id="search-heading">Search</h1>
        </div>
      </header>

      <label className="search-field" htmlFor="global-search">
        <Icon name="search" size={18} />
        <input
          id="global-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search people, chats and messages"
          placeholder="Search people, chats and messages"
          autoComplete="off"
        />
        <kbd>/</kbd>
      </label>

      <div className="list-content search-results" role="status" aria-live="polite">
        {status && <p className="workspace-notice">{status}</p>}
        {needle.length < 2 ? (
          <>
            <div className="empty-list-icon">
              <Icon name="search" size={22} />
            </div>
            <h2>Search KuchuPuchu</h2>
            <p>People, chats and message text. Two characters are enough to start.</p>
          </>
        ) : empty ? (
          <>
            <div className="empty-list-icon">
              <Icon name="search" size={22} />
            </div>
            <h2>No results</h2>
            <p>Nothing found for “{needle}”.</p>
          </>
        ) : (
          <>
            {chats.length > 0 && (
              <>
                <h2 className="search-group">Chats</h2>
                <ul className="conversation-rows" aria-label="Chat results">
                  {chats.map((row) => (
                    <li key={row.id}>
                      <RouteLink
                        route={{ kind: "conversation", conversationId: row.id }}
                        navigate={navigate}
                        className="conversation-row"
                      >
                        <ConversationAvatar
                          api={api}
                          conversation={row}
                          className="conversation-row__avatar"
                        />
                        <span className="conversation-row__body">
                          <span className="conversation-row__name">{conversationTitle(row)}</span>
                          <span className="conversation-row__preview">
                            {conversationPreviewText(row)}
                          </span>
                        </span>
                      </RouteLink>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {messages.length > 0 && (
              <>
                <h2 className="search-group">Messages</h2>
                <ul className="conversation-rows" aria-label="Message results">
                  {messages.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="conversation-row search-row"
                        onClick={() => openMessage(row)}
                      >
                        <span className="conversation-row__body">
                          <span className="conversation-row__line">
                            <span className="conversation-row__name">
                              {row.convTitle || "Chat"}
                            </span>
                            <span className="conversation-row__time">
                              {clockTime(row.createdAt)}
                            </span>
                          </span>
                          <span className="conversation-row__preview search-row__snippet">
                            {searchSnippet(row)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {users.length > 0 && (
              <>
                <h2 className="search-group">People</h2>
                <ul className="conversation-rows" aria-label="People results">
                  {users.map((peer) => (
                    <PersonRow
                      key={peer.id}
                      api={api}
                      peer={peer}
                      navigate={navigate}
                      onStatus={setStatus}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
