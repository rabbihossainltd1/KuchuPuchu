/**
 * "All contacts" — the web mirror of the phone's AllContactsScreen
 * (round 28). The browser has no phone book, so the contact list here is the
 * user's KuchuPuchu people: every 1:1 peer they have a chat with (hidden
 * chats stay hidden — the controller only hands over visible rows). The
 * phone's layout carries over: back + "All contacts" + count subtitle, the
 * person-add shortcut to New contact, the refresh button, the search pill,
 * and the "On KuchuPuchu" rows with a Chat action.
 */

import { useId, useMemo, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import type { Navigate } from "../useBrowserRouter";
import type { MessagingController } from "./useMessaging";
import { conversationTitle } from "./protocol";
import { messagingApi } from "./messagingApi";
import { ConversationAvatar } from "./Avatar";
import { Icon } from "../icons";

type Props = {
  controller: MessagingController;
  api: ApiClient | null;
  navigate: Navigate;
};

export function ContactsPane({ controller, api, navigate }: Props) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState("");

  const contacts = useMemo(
    () => controller.conversations.filter((row) => !row.isGroup && row.other),
    [controller.conversations],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? contacts
        : contacts.filter((row) => {
            const peer = row.other;
            return (
              conversationTitle(row).toLowerCase().includes(needle) ||
              (peer?.username ?? "").toLowerCase().includes(needle)
            );
          }),
    [contacts, needle],
  );

  const chat = (rowId: string, peerId: string) => {
    if (!api || opening) return;
    const known = controller.conversations.find((row) => row.id === rowId);
    if (known) {
      navigate({ kind: "conversation", conversationId: rowId });
      return;
    }
    setOpening(peerId);
    void (async () => {
      try {
        const row = await messagingApi.createConversation(api, peerId);
        if (row) navigate({ kind: "conversation", conversationId: row.id });
      } catch {
        controller.announce("That did not work. Check your connection and try again.");
      } finally {
        setOpening("");
      }
    })();
  };

  return (
    <section className="list-pane contacts-pane" aria-labelledby="contacts-heading">
      <header className="list-header">
        <button
          type="button"
          className="icon-button contacts-pane__back"
          aria-label="Back"
          onClick={() => navigate({ kind: "section", section: "chats" })}
        >
          <Icon name="arrow" size={22} />
        </button>
        <div className="contacts-pane__titles">
          <h1 id="contacts-heading" className="list-heading">
            All contacts
          </h1>
          <p className="contacts-pane__subtitle" role="status">
            {controller.listStatus === "loading" ? "Syncing…" : `${contacts.length} on KuchuPuchu`}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="New contact"
          onClick={() => navigate({ kind: "section", section: "newcontact" })}
        >
          <Icon name="personAdd" size={22} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh"
          disabled={controller.listStatus === "loading"}
          onClick={() => void controller.refreshList()}
        >
          <Icon name="search" size={20} />
        </button>
      </header>

      <label className="search-field contacts-pane__filter" htmlFor={filterId}>
        <Icon name="search" size={18} />
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search contacts"
          placeholder="Search"
        />
      </label>

      <div className="list-content">
        {contacts.length === 0 && controller.listStatus === "ready" && (
          <div className="list-state">
            <div className="empty-list-icon">
              <Icon name="contactsBook" size={22} />
            </div>
            <h2>No contacts</h2>
            <p>Your phone book is empty.</p>
          </div>
        )}

        {contacts.length === 0 && controller.listStatus === "loading" && (
          <p className="list-state" role="status">
            Syncing…
          </p>
        )}

        {shown.length > 0 && (
          <>
            <p className="contacts-pane__section">On KuchuPuchu</p>
            <ul className="conversation-rows contacts-pane__rows" aria-label="Contacts">
              {shown.map((row) => {
                const peer = row.other;
                return (
                  <li key={row.id}>
                    <div className="conversation-row contact-row">
                      <ConversationAvatar
                        api={api}
                        conversation={row}
                        className="conversation-row__avatar"
                      />
                      <span className="conversation-row__body">
                        <span className="conversation-row__name">{conversationTitle(row)}</span>
                        {(peer?.username ?? "") !== "" && (
                          <span className="conversation-row__preview">@{peer?.username}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="contact-row__action"
                        disabled={opening !== ""}
                        aria-label={`Chat with ${conversationTitle(row)}`}
                        onClick={() => chat(row.id, peer?.id ?? "")}
                      >
                        Chat
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {contacts.length > 0 && shown.length === 0 && (
          <p className="list-state" role="status">
            No contact matches "{query.trim()}"
          </p>
        )}
      </div>
    </section>
  );
}
