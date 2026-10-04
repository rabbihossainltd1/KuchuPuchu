/**
 * Conversation list pane.
 *
 * Rows are real links, so a chat is reachable by keyboard, middle-click and
 * deep link alike — the parity plan rules out hover-only or gesture-only
 * access. The filter only narrows chats already loaded, and says so.
 */

import { useId, useMemo, useState } from "react";
import { Icon } from "../icons";
import { RouteLink } from "../RouteLink";
import type { Navigate } from "../useBrowserRouter";
import {
  clockTime,
  conversationInitial,
  conversationPreviewText,
  conversationTitle,
  isOneWayConversation,
  type ConversationRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

type Props = {
  controller: MessagingController;
  selectedId: string;
  navigate: Navigate;
  isOnline: boolean;
};

export function ConversationList({ controller, selectedId, navigate, isOnline }: Props) {
  const filterId = useId();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return controller.conversations;
    return controller.conversations.filter((row) =>
      conversationTitle(row).toLowerCase().includes(needle),
    );
  }, [controller.conversations, query]);

  const unreadLabel = (row: ConversationRow) =>
    row.unread > 0 ? `, ${row.unread > 99 ? "more than 99" : row.unread} unread` : "";

  return (
    <section
      className={`list-pane${selectedId ? " is-mobile-hidden" : ""}`}
      aria-labelledby="list-heading"
    >
      <header className="list-header">
        <div>
          <p className="eyebrow">KUCHUPUCHU WEB</p>
          <h1 id="list-heading">Chats</h1>
        </div>
        <span className="list-header__count" aria-live="polite">
          {controller.totalUnread > 0 ? `${controller.totalUnread} unread` : "All read"}
        </span>
      </header>

      <label className="search-field" htmlFor={filterId}>
        <Icon name="search" size={18} />
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter loaded chats by name"
          placeholder="Filter loaded chats"
        />
      </label>

      <div className="list-content">
        {controller.listStatus === "loading" && controller.conversations.length === 0 && (
          <p className="list-state" role="status">
            Loading your chats…
          </p>
        )}

        {controller.listStatus === "error" && (
          <div className="list-state list-state--error" role="alert">
            <p>{controller.listError || "Chats could not be loaded."}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void controller.refreshList()}
            >
              Try again
            </button>
          </div>
        )}

        {controller.listStatus === "ready" && visible.length === 0 && (
          <div className="list-state">
            <div className="empty-list-icon">
              <Icon name="chats" size={22} />
            </div>
            <h2>{query ? "No loaded chat matches" : "No chats yet"}</h2>
            <p>
              {query
                ? "Clear the filter to see every loaded chat."
                : "Start a chat from the phone app, or from New chat once contacts arrive in a later slice. Hidden chats never appear here."}
            </p>
            {query && (
              <button type="button" className="secondary-button" onClick={() => setQuery("")}>
                Clear filter
              </button>
            )}
          </div>
        )}

        {visible.length > 0 && (
          <ul className="conversation-rows" aria-label="Conversations">
            {visible.map((row) => {
              const isSelected = row.id === selectedId;
              return (
                <li key={row.id}>
                  <RouteLink
                    route={{ kind: "conversation", conversationId: row.id }}
                    navigate={navigate}
                    className={`conversation-row${isSelected ? " is-selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={`${conversationTitle(row)}${unreadLabel(row)}`}
                  >
                    <span className="conversation-row__avatar" aria-hidden="true">
                      {conversationInitial(row)}
                    </span>
                    <span className="conversation-row__body">
                      <span className="conversation-row__line">
                        <span className="conversation-row__name">{conversationTitle(row)}</span>
                        <span className="conversation-row__time">
                          {clockTime(row.lastMessageAt)}
                        </span>
                      </span>
                      <span className="conversation-row__line">
                        <span className="conversation-row__preview">
                          {isOneWayConversation(row) && (
                            <span className="conversation-row__tag">Notifications</span>
                          )}
                          {row.muted && <span className="conversation-row__tag">Muted</span>}
                          {conversationPreviewText(row)}
                        </span>
                        {row.unread > 0 && (
                          <span className="conversation-row__badge">
                            {row.unread > 99 ? "99+" : row.unread}
                            <span className="sr-only"> unread messages</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </RouteLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="list-footer" role="status" aria-live="polite">
        <span
          className={`connection-indicator${
            isOnline && controller.listSocket === "open" ? "" : " is-offline"
          }`}
        />
        <span>
          {!isOnline
            ? "Browser offline"
            : controller.listSocket === "open"
              ? "Live"
              : controller.listSocket === "reconnecting"
                ? "Reconnecting…"
                : "Connected"}
        </span>
        <span className="list-footer__spacer" />
        <span className="footer-version">
          {controller.durable ? "Drafts saved" : "Drafts in memory only"}
        </span>
      </footer>
    </section>
  );
}
