import { useEffect, type ReactNode } from "react";
import { RouteLink } from "../RouteLink";
import { SITE_PAGES, type SitePageId } from "../router";
import type { Navigate } from "../useBrowserRouter";
import { PublicHeader, SITE_PAGE_LABELS } from "./PublicHeader";

type SiteCard = {
  title: string;
  badge: string;
  body: string;
};

type SitePageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  cards: readonly SiteCard[];
  detailsHeading: string;
  items: readonly ReactNode[];
};

const APK_URL = "/download/apk";

const PAGES: Record<SitePageId, SitePageContent> = {
  features: {
    eyebrow: "WHAT YOU GET",
    title: "Built for everyday privacy",
    intro:
      "One account across the Android phone app and KuchuPuchu Web — sealed personal chats, media, voice notes, 1:1 calls, 24-hour status, and KuchuPuchu AI.",
    cards: [
      {
        title: "End-to-end sealed chats",
        badge: "KP1 E2EE",
        body: "Personal 1:1 messages are sealed on your device using ECDH P-256 + AES-256-GCM before upload.",
      },
      {
        title: "Photos, video, files & voice",
        badge: "R2 Media",
        body: "HD photos, videos, documents, stickers, and push-to-talk voice notes with view-once support.",
      },
      {
        title: "1:1 voice & video calls",
        badge: "WebRTC",
        body: "Peer-to-peer DTLS-SRTP audio and video calls across Android and Web with TURN fallback.",
      },
      {
        title: "24-hour status stories",
        badge: "Ephemeral",
        body: "Share text and photo status updates with contacts that expire automatically after 24 hours.",
      },
      {
        title: "Groups & hidden chats",
        badge: "Controls",
        body: "Owner-managed groups, @mentions, reactions, polls, and PIN-protected hidden conversations.",
      },
      {
        title: "KuchuPuchu AI assistant",
        badge: "Gemini AI",
        body: "Official built-in AI assistant supporting Bengali, Banglish, and English text and image questions.",
      },
    ],
    detailsHeading: "Feature breakdown across Android & Web",
    items: [
      <>
        <strong>End-to-end sealed personal chats (KP1):</strong> Every 1:1 text message is encrypted
        on the sender&apos;s device with an ECDH P-256 shared secret and AES-256-GCM before it
        leaves the phone or browser.
      </>,
      <>
        <strong>Photos, videos, files and voice notes:</strong> Send high-resolution photos, video
        clips, documents, stickers and push-to-talk voice notes, including view-once media that
        wipes its bytes from storage the moment the recipient closes it.
      </>,
      <>
        <strong>1:1 voice and video calls:</strong> Peer-to-peer WebRTC calls with DTLS-SRTP media
        encryption, Bluetooth and speaker routing on Android, and full ring/answer support in the
        browser.
      </>,
      <>
        <strong>24-hour status updates:</strong> Post text or photo status stories visible to your
        contacts for 24 hours, with viewer lists and one-tap replies.
      </>,
      <>
        <strong>Groups, nicknames and hidden chats:</strong> Create group conversations with owner
        controls, set custom member nicknames, pin or archive threads, and lock private chats behind
        a 4-digit PIN.
      </>,
      <>
        <strong>Scheduled messages & disappearing timers:</strong> Queue messages for automatic
        future delivery or enable per-chat vanish timers that purge messages on expiry.
      </>,
    ],
  },
  encryption: {
    eyebrow: "CRYPTOGRAPHY",
    title: "End-to-end encryption (KP1 & KP2)",
    intro:
      "How personal messages, key backups, and calls are protected on the wire and at rest — with keys generated inside your device.",
    cards: [
      {
        title: "Device identity keys",
        badge: "ECDH P-256",
        body: "Generated in Android Keystore or Web Crypto API; the server only ever receives the public JWK.",
      },
      {
        title: "Per-message sealing",
        badge: "AES-256-GCM",
        body: "Fresh 96-bit IV per message with HKDF-SHA-256 session derivation and authenticated tags.",
      },
      {
        title: "Passphrase key backup",
        badge: "KP2 PBKDF2",
        body: "210,000-iteration PBKDF2-HMAC-SHA256 + AES-256-GCM client-side key wrapping for Web restore.",
      },
      {
        title: "Encrypted WebRTC media",
        badge: "DTLS-SRTP",
        body: "All 1:1 audio and video call streams negotiate ephemeral DTLS-SRTP keys peer-to-peer.",
      },
      {
        title: "Content-free Web Push",
        badge: "Zero-Content",
        body: "Browser push notifications carry only a generic doorbell wake signal — never message text.",
      },
      {
        title: "Per-install isolation",
        badge: "Bearer Hash",
        body: "Each device has its own SHA-256 hashed session token that can be revoked independently.",
      },
    ],
    detailsHeading: "Cryptographic specification",
    items: [
      <>
        <strong>Identity keys:</strong> Each signed-in device generates an NIST P-256 ECDH key pair
        locally (Android Keystore on the phone, Web Crypto API in the browser). Only the public key
        JWK is uploaded to <code>/api/e2ee/keys</code>; the private key never leaves the device in
        plaintext.
      </>,
      <>
        <strong>KP1 message sealing:</strong> For every personal 1:1 message, the sender derives a
        shared key via ECDH P-256 + HKDF-SHA-256 and encrypts the UTF-8 payload with AES-256-GCM and
        a fresh 96-bit random IV. The Worker stores only the <code>KP1.&lt;iv&gt;.&lt;ct&gt;</code>{" "}
        ciphertext envelope.
      </>,
      <>
        <strong>KP2 passphrase key backup:</strong> Moving your identity key to KuchuPuchu Web uses
        a <code>KP2</code> envelope: your passphrase is stretched on-device with PBKDF2-HMAC-SHA256
        (210,000 iterations, random 16-byte salt) to derive an AES-256-GCM wrapping key. The server
        never sees your passphrase or unwrapped private key.
      </>,
      <>
        <strong>Call encryption:</strong> 1:1 voice and video calls run over WebRTC with mandatory
        DTLS-SRTP encryption between peers. Signaling frames travel over authenticated TLS
        WebSockets.
      </>,
      <>
        <strong>Content-free push doorbells:</strong> Browser Web Push notifications carry no sender
        name and no message body — only a generic wake-up signal so the browser fetches and decrypts
        the message locally.
      </>,
    ],
  },
  architecture: {
    eyebrow: "INFRASTRUCTURE",
    title: "System architecture",
    intro:
      "KuchuPuchu runs on a globally distributed edge architecture combining a Cloudflare Worker API, D1 relational storage, R2 media storage, and native Android + React 19 Web clients.",
    cards: [
      {
        title: "Cloudflare Worker Edge",
        badge: "API & WS",
        body: "Handles REST endpoints, WebSocket real-time fan-out, WebRTC signaling, and cron maintenance.",
      },
      {
        title: "Cloudflare D1 Database",
        badge: "SQLite Edge",
        body: "Stores accounts, device sessions, conversation membership, and KP1 ciphertext envelopes.",
      },
      {
        title: "Cloudflare R2 Object Store",
        badge: "Media & APK",
        body: "Holds authenticated chat attachments, status media, and the signed Android APK release.",
      },
      {
        title: "Native Android Client",
        badge: "Kotlin + Compose",
        body: "Primary device client with Keystore E2EE, foreground call service, and FCM push delivery.",
      },
      {
        title: "Companion Web Client",
        badge: "React 19 PWA",
        body: "Strict-CSP browser workspace with Web Crypto KP1/KP2 decryption, calls, status, and push.",
      },
      {
        title: "Automated CI/CD Pipeline",
        badge: "GitHub Actions",
        body: "Runs unit, contract, Playwright E2E, ktlint, Android Gradle build, and R2 APK sync.",
      },
    ],
    detailsHeading: "End-to-end system flow",
    items: [
      <>
        <strong>Client layer (Android & Web):</strong> The Android app (Kotlin, Jetpack Compose,
        Material 3, WebRTC) and the Web client (React 19, TypeScript, Vite, Web Crypto API) share
        the exact same wire protocol, KP1/KP2 E2EE format, and REST/WebSocket endpoints.
      </>,
      <>
        <strong>Edge API & WebSocket signaling:</strong> A single Cloudflare Worker validates bearer
        sessions (stored as SHA-256 digests), enforces per-user privacy rules, and coordinates live
        message, typing, presence, and call events.
      </>,
      <>
        <strong>Data & media separation:</strong> Structured metadata and sealed ciphertexts live in
        Cloudflare D1, while binary media blobs live in Cloudflare R2 behind authenticated
        conversation-membership checks.
      </>,
      <>
        <strong>Scheduled edge hygiene:</strong> Worker cron triggers automatically dispatch due
        scheduled messages, expire 24-hour status stories, clean up vanished messages, and sweep
        unattached media uploads.
      </>,
    ],
  },
  faq: {
    eyebrow: "QUESTIONS & ANSWERS",
    title: "Frequently asked questions",
    intro:
      "Common questions about signing in on KuchuPuchu Web, restoring end-to-end encryption keys, and using Android and Web together.",
    cards: [
      {
        title: "How do I sign in on Web?",
        badge: "Sign-In",
        body: "Enter your phone number and approve from your signed-in Android phone, enter the 6-digit code, or verify with linked Google.",
      },
      {
        title: "How do sealed chats unlock?",
        badge: "KP2 Backup",
        body: "Save a passphrase-protected KP2 key backup in Settings and enter that passphrase in your browser.",
      },
      {
        title: "Can I use Web on mobile?",
        badge: "Mobile Web",
        body: "Yes — KuchuPuchu Web works in mobile and desktop browsers, alongside the native Android APK.",
      },
      {
        title: "Are calls encrypted?",
        badge: "DTLS-SRTP",
        body: "All 1:1 voice and video calls use encrypted WebRTC media streams across Android and Web.",
      },
      {
        title: "How do I revoke a browser?",
        badge: "Devices",
        body: "Open Account & Settings → Linked Devices on Android or Web to sign out any session immediately.",
      },
      {
        title: "What can KuchuPuchu AI do?",
        badge: "AI Assistant",
        body: "Ask questions in Bengali, Banglish, or English, or attach an image for instant visual analysis.",
      },
    ],
    detailsHeading: "Detailed answers",
    items: [
      <>
        <strong>Why does Web sign-in ask for device approval or Google verification?</strong> A web
        browser cannot read your phone&apos;s SIM card. To prevent unauthorized access, KuchuPuchu
        requires either approval from your active Android phone (via one-tap Approve or the compact
        6-digit code in your KuchuPuchu chat) or verification of your linked Google account.
      </>,
      <>
        <strong>What happens if I clear my browser data?</strong> Your session token and local
        IndexedDB key cache are cleared. When you sign back in, enter your KP2 backup passphrase
        once to restore your P-256 private key and read your historical sealed messages.
      </>,
      <>
        <strong>Do push notifications on Web expose message text?</strong> No. Web Push payloads are
        strictly content-free doorbells. Your browser wakes up, fetches the sealed ciphertext over
        HTTPS, and decrypts it locally.
      </>,
      <>
        <strong>Where do I get the official Android app?</strong> Tap{" "}
        <a href={APK_URL}>Download Android APK</a> on any page to download the latest signed release
        directly from KuchuPuchu&apos;s edge storage.
      </>,
    ],
  },
  privacy: {
    eyebrow: "PRIVACY POLICY",
    title: "Your privacy, in plain words",
    intro:
      "What KuchuPuchu collects to run your account, who can see your profile details, and the controls you have over every field.",
    cards: [
      {
        title: "Granular field visibility",
        badge: "3 Levels",
        body: "Set Phone, Avatar, Last Seen, Status, Groups, and Messages to Everyone, Contacts, or Nobody.",
      },
      {
        title: "Private profile lock",
        badge: "One Toggle",
        body: "Enable Private Profile to restrict your profile details to approved contacts in one step.",
      },
      {
        title: "Phone number masking",
        badge: "No Leaks",
        body: "When hidden, the Worker omits your phone number before the response leaves the server.",
      },
      {
        title: "Zero ad trackers",
        badge: "No Ads",
        body: "No advertising SDKs, no third-party analytics scripts, and no cross-site tracking cookies.",
      },
      {
        title: "Block & mute controls",
        badge: "Server-Enforced",
        body: "Blocked users are immediately barred from messaging, calling, or viewing your status.",
      },
      {
        title: "Session transparency",
        badge: "Audit List",
        body: "Inspect every signed-in phone and browser install with platform and last-active timestamps.",
      },
    ],
    detailsHeading: "Privacy rules & enforcement",
    items: [
      <>
        <strong>Account identifiers:</strong> Your account is keyed by your phone number, a chosen{" "}
        <code>@username</code>, and a display name. Linking a Google account is optional and used
        only for browser sign-in proof and account recovery.
      </>,
      <>
        <strong>Granular visibility controls:</strong> In Account &amp; Settings you independently
        choose who can see your <em>phone number</em>, <em>profile photo</em>,{" "}
        <em>last-seen timestamp</em>, <em>status updates</em>, who can <em>message</em> you, and who
        can <em>add you to groups</em> (<code>Everyone</code>, <code>Contacts</code>, or{" "}
        <code>Nobody</code>).
      </>,
      <>
        <strong>Phone number protection:</strong> When your phone visibility is set to{" "}
        <code>Nobody</code> or <code>Contacts</code>, the Worker redacts the number on the server
        before returning profile or search responses to non-contacts.
      </>,
      <>
        <strong>No ad trackers or third-party analytics:</strong> KuchuPuchu does not embed ad
        networks, behavioral trackers, or third-party analytics scripts. The only external script
        permitted by the Web Content-Security-Policy is Google Identity Services when you explicitly
        use Google sign-in.
      </>,
      <>
        <strong>Blocking &amp; muting:</strong> Blocking a user immediately prevents them from
        sending you messages, calling you, or viewing your status updates, enforced server-side.
      </>,
    ],
  },
  data: {
    eyebrow: "DATA POLICY",
    title: "How your data is stored & deleted",
    intro:
      "Where KuchuPuchu stores account records and media, how long temporary items live, and how deletion works.",
    cards: [
      {
        title: "D1 relational metadata",
        badge: "Hashed Tokens",
        body: "Session tokens are stored as SHA-256 hashes alongside conversation rows and KP1 envelopes.",
      },
      {
        title: "R2 authenticated media",
        badge: "Access-Gated",
        body: "Attachments require an active bearer token from a verified member of that conversation.",
      },
      {
        title: "View-once auto-wipe",
        badge: "Single Open",
        body: "View-once photos and videos delete their R2 bytes immediately after being viewed once.",
      },
      {
        title: "24h status & vanish sweep",
        badge: "Cron Purge",
        body: "Scheduled Worker cron jobs purge expired statuses and vanished messages automatically.",
      },
      {
        title: "Orphan upload cleanup",
        badge: "24h TTL",
        body: "Uploaded media blobs never attached to a message within 24 hours are swept from R2.",
      },
      {
        title: "Browser local storage",
        badge: "Revocable",
        body: "Signing out wipes local tokens, cached keys, and service-worker caches immediately.",
      },
    ],
    detailsHeading: "Storage, retention & deletion lifecycle",
    items: [
      <>
        <strong>Cloudflare D1 &amp; R2 storage:</strong> Account metadata, conversation membership,
        and sealed message rows are stored in Cloudflare D1. Media attachments (photos, videos,
        audio, documents) are stored in Cloudflare R2 and served only through authenticated Worker
        routes after verifying conversation membership.
      </>,
      <>
        <strong>Session tokens:</strong> Bearer tokens are hashed with SHA-256 before being stored
        in the database. Signing out — or revoking a device from Account &amp; Settings — deletes or
        revokes that device&apos;s session immediately.
      </>,
      <>
        <strong>Ephemeral &amp; view-once data:</strong> Status updates expire automatically after
        24 hours. View-once attachments are deleted from R2 and marked consumed as soon as the
        recipient closes the viewer. Disappearing messages are purged by the Worker&apos;s scheduled
        cron job once their timer elapses.
      </>,
      <>
        <strong>Unattached uploads:</strong> Media blobs uploaded but never attached to a message or
        status within 24 hours are automatically swept from R2 and D1.
      </>,
      <>
        <strong>Message &amp; account deletion:</strong> Deleting a message for everyone removes its
        body and deletes its backing R2 media object. You can clear conversation history or sign out
        all devices at any time from Settings.
      </>,
    ],
  },
  terms: {
    eyebrow: "TERMS OF SERVICE",
    title: "Terms of use",
    intro:
      "The ground rules for using KuchuPuchu on Android and the Web — kept short, fair, and readable.",
    cards: [
      {
        title: "One real account",
        badge: "Identity",
        body: "Register only with a phone number you own and keep your approval codes private.",
      },
      {
        title: "Respectful conduct",
        badge: "No Abuse",
        body: "No spam, harassment, malware, unauthorized automation, or unlawful content.",
      },
      {
        title: "Companion Web security",
        badge: "Device Approval",
        body: "Never approve a login request or share a 6-digit code you did not initiate yourself.",
      },
      {
        title: "User-owned content",
        badge: "Your Rights",
        body: "You retain full ownership of your messages and media; KuchuPuchu only routes them.",
      },
      {
        title: "Key backup responsibility",
        badge: "Zero-Knowledge",
        body: "Because KP2 passphrases are never sent to the server, only you can unlock your backup.",
      },
      {
        title: "Service protection",
        badge: "Rate Limits",
        body: "Automated abuse or attempts to probe endpoints may be rate-limited or suspended.",
      },
    ],
    detailsHeading: "Terms & conditions",
    items: [
      <>
        <strong>Your account:</strong> You must register with a phone number you control and keep
        your linked devices and KP2 backup passphrase secure. You are responsible for activity on
        devices you approve.
      </>,
      <>
        <strong>Acceptable use:</strong> Do not use KuchuPuchu to send spam, malware, harassment,
        unlawful content, or automated bulk traffic, or to probe or disrupt the Worker API or other
        users&apos; sessions.
      </>,
      <>
        <strong>Companion Web sessions:</strong> KuchuPuchu Web is a companion client to your
        account. Sign-in requires device approval, a one-time approval code, or linked Google
        verification. Never share your 6-digit approval code with anyone.
      </>,
      <>
        <strong>Content &amp; availability:</strong> You retain ownership of the content you send.
        KuchuPuchu processes and stores encrypted payloads and media solely to deliver them to your
        intended recipients across your signed-in devices.
      </>,
      <>
        <strong>Enforcement:</strong> Accounts that abuse the service, impersonate official
        accounts, or violate these terms may be rate-limited or suspended to protect other users.
      </>,
    ],
  },
};

export const SITE_PAGE_BLURBS: Record<SitePageId, string> = {
  features: "Sealed 1:1 chats, media, 1:1 calls, 24h status, groups, and KuchuPuchu AI.",
  encryption: "KP1 ECDH P-256 + AES-256-GCM sealing, KP2 key backups, and DTLS-SRTP calls.",
  architecture: "Cloudflare Worker edge API, D1 database, R2 media storage, Android & Web.",
  faq: "Answers on Web sign-in, device approval, key backups, and mobile browser support.",
  privacy: "Per-field visibility controls, phone redaction, and zero ad trackers.",
  data: "How D1 and R2 store your data, view-once deletion, and 24-hour retention.",
  terms: "Account ownership, acceptable use, and companion Web security rules.",
};

type SitePageProps = {
  page: SitePageId;
  onSignIn: () => void;
  onHome: () => void;
  navigate?: Navigate;
};

export function SitePage({ page, onSignIn, onHome, navigate }: SitePageProps) {
  const content = PAGES[page];
  const others = SITE_PAGES.filter((candidate) => candidate !== page);

  useEffect(() => {
    document.title = `${SITE_PAGE_LABELS[page]} — KuchuPuchu`;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [page]);

  return (
    <main className="kp-welcome kp-site" aria-labelledby="site-title">
      <PublicHeader active={page} onSignIn={onSignIn} navigate={navigate} onHome={onHome} />

      <article className="kp-site__body">
        <header className="kp-site__hero">
          <p className="kp-site__eyebrow">{content.eyebrow}</p>
          <h1 id="site-title">{content.title}</h1>
          <p className="kp-site__intro">{content.intro}</p>
          <div className="kp-site__actions">
            <button type="button" className="kp-site__signin" onClick={onSignIn}>
              Open KuchuPuchu Web
            </button>
            <a className="kp-site__apk" href={APK_URL}>
              Download Android APK
            </a>
            {navigate ? (
              <RouteLink
                route={{ kind: "section", section: "chats" }}
                navigate={navigate}
                className="kp-site__home"
              >
                ← Back to Overview
              </RouteLink>
            ) : (
              <button type="button" className="kp-site__home" onClick={onHome}>
                ← Back to Overview
              </button>
            )}
          </div>
        </header>

        <section
          className="kp-site__cards-section"
          aria-label={`${SITE_PAGE_LABELS[page]} highlights`}
        >
          <div className="kp-site__grid">
            {content.cards.map((card) => (
              <div key={card.title} className="kp-site__card">
                <div className="kp-site__card-head">
                  <strong>{card.title}</strong>
                  <span className="kp-site__badge">{card.badge}</span>
                </div>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="kp-site__detail-section" aria-labelledby="site-detail-heading">
          <h2 id="site-detail-heading">{content.detailsHeading}</h2>
          <ul className="kp-site__list">
            {content.items.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </section>

        <nav className="kp-site__more" aria-label="Other pages">
          <span>Switch to another page:</span>
          {others.map((other) =>
            navigate ? (
              <RouteLink
                key={other}
                route={{ kind: "site", page: other }}
                navigate={navigate}
                className="kp-site__more-link"
              >
                {SITE_PAGE_LABELS[other]}
              </RouteLink>
            ) : (
              <a key={other} href={`/${other}`} className="kp-site__more-link">
                {SITE_PAGE_LABELS[other]}
              </a>
            ),
          )}
        </nav>
      </article>

      <footer className="kp-welcome__foot">
        <span>KuchuPuchu · End-to-end encrypted · </span>
        <a href={APK_URL}>Android APK</a>
        {SITE_PAGES.map((slug) => (
          <span key={slug}>
            {" · "}
            {navigate ? (
              <RouteLink
                route={{ kind: "site", page: slug }}
                navigate={navigate}
                className="link-button"
              >
                {SITE_PAGE_LABELS[slug]}
              </RouteLink>
            ) : (
              <a href={`/${slug}`} className="link-button">
                {SITE_PAGE_LABELS[slug]}
              </a>
            )}
          </span>
        ))}
      </footer>
    </main>
  );
}
