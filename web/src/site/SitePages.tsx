import type { Navigate } from "../useBrowserRouter";
import { SITE_PAGES, type SitePageId } from "../router";
import { PublicHeader } from "./PublicHeader";
import "../auth/welcome.css";

/**
 * Owner (2026-10-13): "shob web page jemon popup lagche statics full separate
 * page na keno" — the landing page's policy content used to be one endless
 * scroll of #anchor sections. Every one of them is now a real, separately
 * addressable page under its own path, so a support reply, a store listing or
 * a hash-less link can point straight at it.
 *
 * The copy is deliberately identical to the sections it replaces; only the
 * presentation moved.
 */

type PageContent = {
  readonly title: string;
  readonly eyebrow: string;
  readonly intro: string;
  readonly items: readonly React.ReactNode[];
};

/** One-liners the landing cards show for each page. */
export const SITE_PAGE_BLURBS: Record<SitePageId, string> = {
  features: "Sealed chats, media, calls, status, groups and hidden chats.",
  encryption: "What is sealed, what a server can see, and what it cannot.",
  privacy: "No ads, no trackers, no third-party analytics.",
  data: "Stored data, retention windows and how deletions work.",
  terms: "The short, readable conditions of use.",
};

const PAGES: Record<SitePageId, PageContent> = {
  features: {
    eyebrow: "KUCHUPUCHU",
    title: "Features",
    intro:
      "Everything the phone app does — and what the desktop browser can safely do alongside it.",
    items: [
      <>
        <strong>Sealed chats</strong> — texts are end-to-end encrypted between your devices; servers
        only carry sealed bytes.
      </>,
      <>
        <strong>Photos, video, voice &amp; docs</strong> — media is encrypted with per-file keys
        before upload.
      </>,
      <>
        <strong>Voice &amp; video calls</strong> — 1:1 calls on Android and in the desktop browser,
        with missed-call alerts.
      </>,
      <>
        <strong>24-hour status</strong> — photos and clips that expire in a day, with view-once
        options.
      </>,
      <>
        <strong>Groups</strong> — shared history, roles, themes and group calls from the phone.
      </>,
      <>
        <strong>Hidden chats</strong> — a secret key keeps a conversation out of the list; only its
        hash is stored.
      </>,
      <>
        <strong>Read receipts, reactions, replies</strong> — the small things, done quietly.
      </>,
      <>
        <strong>Desktop web</strong> — the same account in a browser tab, synced live with your
        phone.
      </>,
    ],
  },
  encryption: {
    eyebrow: "KUCHUPUCHU",
    title: "End-to-end encryption, explained",
    intro: "What is sealed, what a server can see, and what it honestly cannot.",
    items: [
      <>
        Every device generates its own encryption identity. The phone keeps the master copy; a
        browser adopts it from your encrypted key backup, never by minting a second identity.
      </>,
      <>
        Message text is sealed with the recipient’s public key (the <code>KP1.</code> envelopes you
        see in transit). Only a device holding the matching private key can open it.
      </>,
      <>
        Photos, videos, voice notes and documents get a random per-file key; the encrypted bytes
        live in storage, the key travels inside the sealed message.
      </>,
      <>
        The server never holds plaintext text or media keys. If a device has no key yet, the chat
        honestly shows a lock instead of pretending.
      </>,
      <>
        Call signalling is relayed, but media flows peer-to-peer over DTLS-SRTP with keys exchanged
        in the signalling — the relay cannot listen.
      </>,
    ],
  },
  privacy: {
    eyebrow: "KUCHUPUCHU",
    title: "Privacy policy",
    intro:
      "No ads, no ad trackers, no third-party analytics — and a short list of what that means.",
    items: [
      <>No advertising, no ad trackers, no third-party analytics in the messenger.</>,
      <>
        Push notifications carry no message text, sender identity, conversation id or photos — only
        a coarse “something happened” nudge; details load after you open the app.
      </>,
      <>
        Your phone number identifies your account; it is never placed in URLs or shown to other
        users without your choice.
      </>,
      <>
        Profile photos and about text are served to people you chat with, exactly as on any
        messenger; private profiles restrict who sees them.
      </>,
      <>Blocked users cannot call or message you; blocks are stored per account.</>,
    ],
  },
  data: {
    eyebrow: "KUCHUPUCHU",
    title: "Data policy",
    intro: "What is stored, for how long, and how it is removed.",
    items: [
      <>
        <strong>Stored for your account:</strong> phone number, username, display name, profile
        photo, and the encrypted key backup that lets new devices adopt your identity.
      </>,
      <>
        <strong>Stored for your chats:</strong> sealed message envelopes, encrypted media,
        delivery/read markers and reaction metadata, until you delete them.
      </>,
      <>
        <strong>Stored briefly:</strong> session tokens (revocable any time from Settings), sign-in
        request expiries of about five minutes, and crash breadcrumbs without message content.
      </>,
      <>
        <strong>Deleted on request:</strong> deleting a chat or a message for everyone removes it
        from storage; account deletion removes the account row and sessions.
      </>,
      <>
        Infrastructure runs on Cloudflare (Workers, D1, R2); media bytes live encrypted at rest in
        R2.
      </>,
    ],
  },
  terms: {
    eyebrow: "KUCHUPUCHU",
    title: "Terms & conditions",
    intro: "The short, readable version of using KuchuPuchu.",
    items: [
      <>
        KuchuPuchu is provided as-is, for personal use. You must be 18+ or have guardian consent.
      </>,
      <>
        No abuse: no spam, no impersonation, no illegal content. Accounts that break this can be
        moderated.
      </>,
      <>
        The web client is a companion to the Android app; some phone-only capabilities (SIM
        verification, custom capture) are not claimed in a browser.
      </>,
      <>
        Updates ship regularly; continuing to use the service after an update accepts the current
        terms.
      </>,
    ],
  },
};

type SitePageProps = {
  readonly page: SitePageId;
  readonly navigate: Navigate;
  readonly onSignIn: () => void;
  readonly onHome: () => void;
};

/** One full, standalone static page (features / encryption / privacy / data / terms). */
export function SitePage({ page, navigate, onSignIn, onHome }: SitePageProps) {
  const content = PAGES[page];
  const others = SITE_PAGES.filter((candidate) => candidate !== page);

  return (
    <main className="kp-welcome kp-site" aria-labelledby="site-title">
      <PublicHeader onSignIn={onSignIn} navigate={navigate} onHome={onHome} />

      <article className="kp-site__body">
        <p className="kp-site__eyebrow">{content.eyebrow}</p>
        <h1 id="site-title">{content.title}</h1>
        <p className="kp-site__intro">{content.intro}</p>
        <ul className="kp-site__list">
          {content.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        <nav className="kp-site__more" aria-label="Other pages">
          <span>More pages:</span>
          {others.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => navigate({ kind: "site", page: candidate })}
            >
              {PAGES[candidate].title}
            </button>
          ))}
        </nav>

        <div className="kp-site__actions">
          <button type="button" className="kp-site__home" onClick={onHome}>
            ← Back to home
          </button>
          <button type="button" className="kp-site__signin" onClick={onSignIn}>
            Sign in to the web app
          </button>
        </div>
      </article>
    </main>
  );
}
