/**
 * Conversation list pane.
 *
 * Rows are real links, so a chat is reachable by keyboard, middle-click and
 * deep link alike — the parity plan rules out hover-only or gesture-only
 * access. The filter only narrows chats already loaded, and says so.
 */

import { useId, useMemo, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import { RouteLink } from "../RouteLink";
import type { Navigate } from "../useBrowserRouter";
import { ArchivePane } from "./ArchivePane";
import { ConversationAvatar } from "./Avatar";
import { setArchivedFlag, setPinnedFlag, useConvFlags } from "./convFlags";
import { GroupCreatePane } from "./GroupCreatePane";
import {
  clockTime,
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
  api: ApiClient | null;
};

export function ConversationList({ controller, selectedId, navigate, isOnline, api }: Props) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const flags = useConvFlags();

  // The phone's main list hides archived chats and floats pinned ones to
  // the top (ScreenStore order otherwise).
  const visible = useMemo(() => {
    const rows = controller.conversations.filter((row) => !flags.archived.includes(row.id));
    rows.sort((a, b) => Number(flags.pinned.includes(b.id)) - Number(flags.pinned.includes(a.id)));
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => conversationTitle(row).toLowerCase().includes(needle));
  }, [controller.conversations, query, flags]);

  const archivedCount = controller.conversations.filter(
    (row) => flags.archived.includes(row.id) && !row.hidden,
  ).length;

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
        <button
          type="button"
          className="icon-button"
          aria-label="New chat"
          title="New chat"
          onClick={() => navigate({ kind: "section", section: "search" })}
        >
          <Icon name="plus" size={21} />
        </button>
        {/* The phone's home ⋮ menu; only the entries the web has are offered. */}
        <div className="list-header__menu">
          <button
            type="button"
            className="icon-button"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Icon name="more" size={21} />
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                className="menu-backdrop"
                aria-label="Close menu"
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
              />
              <div className="list-menu" role="menu" aria-label="Chat list menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate({ kind: "section", section: "newcontact" });
                  }}
                >
                  <Icon name="personAdd" size={18} />
                  New contact
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate({ kind: "section", section: "contacts" });
                  }}
                >
                  <Icon name="contactsBook" size={18} />
                  All contacts
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <Icon name="group" size={18} />
                  New group
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {createOpen && api && (
        <GroupCreatePane
          controller={controller}
          api={api}
          navigate={navigate}
          onClose={() => setCreateOpen(false)}
        />
      )}

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
        <button type="button" className="archive-entry" onClick={() => setArchiveOpen(true)}>
          <Icon name="archive" size={18} />
          <span>Archived</span>
          <span className="archive-entry__count">({archivedCount})</span>
        </button>

        {archiveOpen && (
          <ArchivePane
            controller={controller}
            navigate={navigate}
            api={api}
            onClose={() => setArchiveOpen(false)}
          />
        )}

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
                : "Start one with the New chat button. Hidden chats never appear here."}
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
              const pinned = flags.pinned.includes(row.id);
              return (
                <li key={row.id} className="conversation-rows__item">
                  <RouteLink
                    route={{ kind: "conversation", conversationId: row.id }}
                    navigate={navigate}
                    className={`conversation-row${isSelected ? " is-selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={`${conversationTitle(row)}${unreadLabel(row)}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setRowMenu((current) => (current === row.id ? null : row.id));
                    }}
                  >
                    <ConversationAvatar
                      api={api}
                      conversation={row}
                      className="conversation-row__avatar"
                    />
                    <span className="conversation-row__body">
                      <span className="conversation-row__line">
                        <span className="conversation-row__name">
                          {conversationTitle(row)}
                          {pinned && (
                            <span className="conversation-row__pin" title="Pinned">
                              <Icon name="pin" size={13} />
                              <span className="sr-only">Pinned</span>
                            </span>
                          )}
                        </span>
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
                  <button
                    type="button"
                    className="icon-button conversation-row__more"
                    aria-label={`Options for ${conversationTitle(row)}`}
                    aria-haspopup="menu"
                    aria-expanded={rowMenu === row.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRowMenu((current) => (current === row.id ? null : row.id));
                    }}
                  >
                    <Icon name="more" size={18} />
                  </button>
                  {rowMenu === row.id && (
                    <>
                      <button
                        type="button"
                        className="menu-backdrop"
                        aria-label="Close menu"
                        tabIndex={-1}
                        onClick={() => setRowMenu(null)}
                      />
                      <div
                        className="list-menu row-menu"
                        role="menu"
                        aria-label={`Options for ${conversationTitle(row)}`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setPinnedFlag(row.id, !pinned);
                            setRowMenu(null);
                          }}
                        >
                          <Icon name="pin" size={18} />
                          {pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setArchivedFlag(row.id, true);
                            setRowMenu(null);
                          }}
                        >
                          <Icon name="archive" size={18} />
                          Archive
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="list-footer">
        <span className="list-footer__live" role="status" aria-live="polite">
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
        </span>
      </footer>
    </section>
  );
}
