/**
 * Slice AP — the phone's ArchiveScreen on the web: "Archived (n)" lists the
 * device-archived chats (swipe right on the phone); a row still opens its
 * chat, and its kebab offers Unarchive. Hidden chats never appear here.
 */

import { useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import { RouteLink } from "../RouteLink";
import type { Navigate } from "../useBrowserRouter";
import { ConversationAvatar } from "./Avatar";
import { setArchivedFlag, useConvFlags } from "./convFlags";
import {
  clockTime,
  conversationPreviewText,
  conversationTitle,
  isOneWayConversation,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

export function ArchivePane({
  controller,
  navigate,
  api,
  onClose,
}: {
  controller: MessagingController;
  navigate: Navigate;
  api: ApiClient | null;
  onClose: () => void;
}) {
  const flags = useConvFlags();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const archived = controller.conversations.filter(
    (row) => flags.archived.includes(row.id) && !row.hidden,
  );

  return (
    <div className="ai-history-overlay" role="presentation" onClick={onClose}>
      <section
        className="ai-history archive-pane"
        role="dialog"
        aria-label="Archived"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-history__header">
          <button
            type="button"
            className="icon-button contacts-pane__back"
            aria-label="Back"
            onClick={onClose}
          >
            <Icon name="arrow" size={22} />
          </button>
          <p className="ai-history__title">Archived</p>
          <p className="ai-history__sub">({archived.length})</p>
        </header>

        {archived.length === 0 && (
          <div className="archive-empty">
            <span className="empty-list-icon">
              <Icon name="archive" size={22} />
            </span>
            <h2>No archived chats</h2>
            <p>Swipe a chat right to archive it</p>
          </div>
        )}

        {archived.length > 0 && (
          <ul className="conversation-rows archive-pane__rows" aria-label="Archived chats">
            {archived.map((row) => (
              <li key={row.id} className="archive-row">
                <RouteLink
                  route={{ kind: "conversation", conversationId: row.id }}
                  navigate={(route) => {
                    onClose();
                    navigate(route);
                  }}
                  className="conversation-row"
                  aria-label={conversationTitle(row)}
                >
                  <ConversationAvatar
                    api={api}
                    conversation={row}
                    className="conversation-row__avatar"
                  />
                  <span className="conversation-row__body">
                    <span className="conversation-row__line">
                      <span className="conversation-row__name">{conversationTitle(row)}</span>
                      <span className="conversation-row__time">{clockTime(row.lastMessageAt)}</span>
                    </span>
                    <span className="conversation-row__line">
                      <span className="conversation-row__preview">
                        {isOneWayConversation(row) && (
                          <span className="conversation-row__tag">Notifications</span>
                        )}
                        {row.muted && <span className="conversation-row__tag">Muted</span>}
                        {conversationPreviewText(row)}
                      </span>
                    </span>
                  </span>
                </RouteLink>
                <div className="archive-row__menu">
                  <button
                    type="button"
                    className="icon-button conversation-row__more"
                    aria-label={`Options for ${conversationTitle(row)}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === row.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuFor((current) => (current === row.id ? null : row.id));
                    }}
                  >
                    <Icon name="more" size={18} />
                  </button>
                  {menuFor === row.id && (
                    <>
                      <button
                        type="button"
                        className="menu-backdrop"
                        aria-label="Close menu"
                        tabIndex={-1}
                        onClick={() => setMenuFor(null)}
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
                            setArchivedFlag(row.id, false);
                            setMenuFor(null);
                          }}
                        >
                          <Icon name="archive" size={18} />
                          Unarchive
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
