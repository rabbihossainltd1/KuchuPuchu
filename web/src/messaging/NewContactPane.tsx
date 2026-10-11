/**
 * "New contact" — the web mirror of the phone's NewContactScreen (round 28).
 * The browser can't write into the device phone book (the phone's Save
 * action hands the system contact editor), so this pane keeps everything the
 * web can actually do: name + number, the live E.164 preview, Check against
 * KuchuPuchu via `/api/contacts/match`, then the phone's match card —
 * "on KuchuPuchu" with Chat, or "not on KuchuPuchu yet" with the WhatsApp
 * invite.
 */

import { useId, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import type { Navigate } from "../useBrowserRouter";
import type { MessagingController } from "./useMessaging";
import { messagingApi } from "./messagingApi";
import { inviteUrl, toE164, type ContactMatchUser } from "./contacts";
import { Icon } from "../icons";

type Props = {
  controller: MessagingController;
  api: ApiClient | null;
  navigate: Navigate;
};

export function NewContactPane({ controller, api, navigate }: Props) {
  const nameId = useId();
  const phoneId = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [match, setMatch] = useState<ContactMatchUser | null>(null);
  const [checkedPhone, setCheckedPhone] = useState("");
  const [opening, setOpening] = useState(false);

  const e164 = toE164(phone);

  const lookup = () => {
    if (!api) return;
    if (!e164) {
      setError("Enter a valid phone number, e.g. 01712345678 or +8801712345678.");
      return;
    }
    setError("");
    setChecking(true);
    void (async () => {
      try {
        const users = await messagingApi.matchContacts(api, [e164]);
        setMatch(users[0] ?? null);
        setCheckedPhone(e164);
      } catch {
        controller.announce("That did not work. Check your connection and try again.");
      } finally {
        setChecking(false);
      }
    })();
  };

  const chatWith = (user: ContactMatchUser) => {
    if (!api || opening) return;
    setOpening(true);
    void (async () => {
      try {
        const row = await messagingApi.createConversation(api, user.id);
        if (row) navigate({ kind: "conversation", conversationId: row.id });
      } catch {
        controller.announce("That did not work. Check your connection and try again.");
      } finally {
        setOpening(false);
      }
    })();
  };

  const showResult = checkedPhone !== "" && checkedPhone === e164;

  return (
    <section className="list-pane contacts-pane" aria-labelledby="new-contact-heading">
      <header className="list-header">
        <button
          type="button"
          className="icon-button contacts-pane__back"
          aria-label="Back"
          onClick={() => navigate({ kind: "section", section: "contacts" })}
        >
          <Icon name="arrow" size={22} />
        </button>
        <h1 id="new-contact-heading" className="list-heading">
          New contact
        </h1>
      </header>

      <div className="new-contact__form">
        <label className="search-field" htmlFor={nameId}>
          <Icon name="profile" size={18} />
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            autoComplete="off"
          />
        </label>
        <label className="search-field" htmlFor={phoneId}>
          <Icon name="phone" size={18} />
          <input
            id={phoneId}
            type="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setMatch(null);
              setCheckedPhone("");
            }}
            placeholder="Phone"
            autoComplete="off"
          />
        </label>
        {e164 && <p className="new-contact__e164">{e164}</p>}
        {error !== "" && (
          <p className="new-contact__error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="primary-button new-contact__check"
          disabled={!e164 || checking}
          onClick={lookup}
        >
          {checking ? "Checking…" : "Check"}
        </button>

        {showResult && match && (
          <div className="conversation-row contact-row new-contact__result">
            <span className="new-contact__avatar" aria-hidden="true">
              {(match.displayName || match.username || checkedPhone)
                .trim()
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="conversation-row__body">
              <span className="conversation-row__name">
                {match.displayName || name.trim() || checkedPhone}
              </span>
              <span className="conversation-row__preview">
                {match.username !== "" ? `@${match.username} · ` : ""}on KuchuPuchu
              </span>
            </span>
            <button
              type="button"
              className="contact-row__action"
              disabled={opening}
              onClick={() => chatWith(match)}
            >
              Chat
            </button>
          </div>
        )}

        {showResult && !match && (
          <div className="conversation-row contact-row new-contact__result">
            <span className="new-contact__avatar" aria-hidden="true">
              {(name.trim() || checkedPhone).slice(0, 2).toUpperCase()}
            </span>
            <span className="conversation-row__body">
              <span className="conversation-row__name">{name.trim() || checkedPhone}</span>
              <span className="conversation-row__preview">
                {checkedPhone} · not on KuchuPuchu yet
              </span>
            </span>
            <a
              className="contact-row__action contact-row__action--invite"
              href={inviteUrl(checkedPhone)}
              target="_blank"
              rel="noreferrer"
            >
              Invite
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
