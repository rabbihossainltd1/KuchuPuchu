import { useEffect, useState } from "react";
import { externalApiOrigin } from "../api";
import "./welcome.css";

/** The public APK endpoint on the Worker (same-origin or the configured API
 *  origin when the shell is hosted elsewhere, e.g. Firebase). */
export function apkDownloadUrl(): string {
  const origin = externalApiOrigin();
  return origin ? `${origin}/download/apk` : "/download/apk";
}

function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const narrow = window.matchMedia("(max-width: 860px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return uaMobile || (narrow && coarse);
}

export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(detectMobile);
  useEffect(() => {
    const onChange = () => setMobile(detectMobile());
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);
  return mobile;
}

/** Mobile visitors get the app, not the desktop-only web client. */
export function MobileGate() {
  return (
    <main className="kp-gate" aria-labelledby="gate-title">
      <section className="kp-gate__card">
        <img className="kp-gate__logo" src="/logo.png" alt="KuchuPuchu logo" />
        <p className="kp-gate__eyebrow">KUCHUPUCHU</p>
        <h1 id="gate-title">The web app is for desktop</h1>
        <p className="kp-gate__copy">
          On phone and tablet screens KuchuPuchu lives in the Android app — the browser client needs
          a desktop window. Get the app to keep your chats, calls and status in your pocket.
        </p>
        <a className="kp-gate__download" href={apkDownloadUrl()}>
          Download the Android app
        </a>
        <p className="kp-gate__note">
          Latest signed APK · direct download · open the file to install.
        </p>
      </section>
    </main>
  );
}

type WelcomeProps = {
  readonly onSignIn: () => void;
};

/** Pre-login welcome screen: brand, features and the policy / E2EE sections,
 *  with sign-in and the Android download as the two doors in. */
export function WelcomePage({ onSignIn }: WelcomeProps) {
  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <header className="kp-welcome__top">
        <span className="kp-welcome__brand">
          <img src="/logo.png" alt="KuchuPuchu logo" />
          KuchuPuchu
        </span>
        <nav className="kp-welcome__nav" aria-label="Page sections">
          <a href="#features">Features</a>
          <a href="#e2ee">Encryption</a>
          <a href="#privacy">Privacy</a>
          <a href="#data">Data</a>
          <a href="#terms">Terms</a>
        </nav>
        <button type="button" className="kp-welcome__signin" onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <section className="kp-welcome__hero">
        <img className="kp-welcome__logo" src="/logo.png" alt="" />
        <h1 id="welcome-title">Messages that stay yours.</h1>
        <p className="kp-welcome__sub">
          KuchuPuchu is a private messenger for Bangladesh — sealed chats, photos, voice and video
          calls, 24-hour status and groups, on your phone and now in your desktop browser.
        </p>
        <div className="kp-welcome__cta">
          <button type="button" onClick={onSignIn}>
            Open KuchuPuchu Web
          </button>
          <a href={apkDownloadUrl()}>Get the Android app</a>
        </div>
      </section>

      <section id="features" className="kp-welcome__section">
        <h2>Features</h2>
        <ul className="kp-welcome__grid">
          <li>
            <strong>Sealed chats</strong> — texts are end-to-end encrypted between your devices;
            servers only carry sealed bytes.
          </li>
          <li>
            <strong>Photos, video, voice & docs</strong> — media is encrypted with per-file keys
            before upload.
          </li>
          <li>
            <strong>Voice & video calls</strong> — 1:1 calls on Android and in the desktop browser,
            with missed-call alerts.
          </li>
          <li>
            <strong>24-hour status</strong> — photos and clips that expire in a day, with view-once
            options.
          </li>
          <li>
            <strong>Groups</strong> — shared history, roles, themes and group calls from the phone.
          </li>
          <li>
            <strong>Hidden chats</strong> — a secret key keeps a conversation out of the list; only
            its hash is stored.
          </li>
          <li>
            <strong>Read receipts, reactions, replies</strong> — the small things, done quietly.
          </li>
          <li>
            <strong>Desktop web</strong> — the same account in a browser tab, synced live with your
            phone.
          </li>
        </ul>
      </section>

      <section id="e2ee" className="kp-welcome__section">
        <h2>End-to-end encryption, explained</h2>
        <ul>
          <li>
            Every device generates its own encryption identity. The phone keeps the master copy; a
            browser adopts it from your encrypted key backup, never by minting a second identity.
          </li>
          <li>
            Message text is sealed with the recipient’s public key (the <code>KP1.</code> envelopes
            you see in transit). Only a device holding the matching private key can open it.
          </li>
          <li>
            Photos, videos, voice notes and documents get a random per-file key; the encrypted bytes
            live in storage, the key travels inside the sealed message.
          </li>
          <li>
            The server never holds plaintext text or media keys. If a device has no key yet, the
            chat honestly shows a lock instead of pretending.
          </li>
          <li>
            Call signalling is relayed, but media flows peer-to-peer over DTLS-SRTP with keys
            exchanged in the signalling — the relay cannot listen.
          </li>
        </ul>
      </section>

      <section id="privacy" className="kp-welcome__section">
        <h2>Privacy policy</h2>
        <ul>
          <li>No advertising, no ad trackers, no third-party analytics in the messenger.</li>
          <li>
            Push notifications carry no message text, sender identity, conversation id or photos —
            only a coarse “something happened” nudge; details load after you open the app.
          </li>
          <li>
            Your phone number identifies your account; it is never placed in URLs or shown to other
            users without your choice.
          </li>
          <li>
            Profile photos and about text are served to people you chat with, exactly as on any
            messenger; private profiles restrict who sees them.
          </li>
          <li>Blocked users cannot call or message you; blocks are stored per account.</li>
        </ul>
      </section>

      <section id="data" className="kp-welcome__section">
        <h2>Data policy</h2>
        <ul>
          <li>
            <strong>Stored for your account:</strong> phone number, username, display name, profile
            photo, and the encrypted key backup that lets new devices adopt your identity.
          </li>
          <li>
            <strong>Stored for your chats:</strong> sealed message envelopes, encrypted media,
            delivery/read markers and reaction metadata, until you delete them.
          </li>
          <li>
            <strong>Stored briefly:</strong> session tokens (revocable any time from Settings),
            sign-in request expiries of about five minutes, and crash breadcrumbs without message
            content.
          </li>
          <li>
            <strong>Deleted on request:</strong> deleting a chat or a message for everyone removes
            it from storage; account deletion removes the account row and sessions.
          </li>
          <li>
            Infrastructure runs on Cloudflare (Workers, D1, R2); media bytes live encrypted at rest
            in R2.
          </li>
        </ul>
      </section>

      <section id="terms" className="kp-welcome__section">
        <h2>Terms & conditions</h2>
        <ul>
          <li>
            KuchuPuchu is provided as-is, for personal use. You must be 18+ or have guardian
            consent.
          </li>
          <li>
            No abuse: no spam, no impersonation, no illegal content. Accounts that break this can be
            moderated.
          </li>
          <li>
            The web client is a companion to the Android app; some phone-only capabilities (SIM
            verification, custom capture) are not claimed in a browser.
          </li>
          <li>
            Updates ship regularly; continuing to use the service after an update accepts the
            current terms.
          </li>
        </ul>
      </section>

      <footer className="kp-welcome__foot">
        <p>KuchuPuchu · made with care in Bangladesh</p>
        <p>
          <button type="button" className="link-button" onClick={onSignIn}>
            Sign in to the web app
          </button>
          {" · "}
          <a href={apkDownloadUrl()}>Android APK</a>
        </p>
      </footer>
    </main>
  );
}
