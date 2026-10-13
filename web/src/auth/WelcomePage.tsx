import { useEffect, useState } from "react";
import { externalApiOrigin } from "../api";
import { PublicHeader, SITE_PAGE_LABELS } from "../site/PublicHeader";
import { SITE_PAGE_BLURBS } from "../site/SitePages";
import { RouteLink } from "../RouteLink";
import { SITE_PAGES } from "../router";
import type { Navigate } from "../useBrowserRouter";
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
  readonly navigate: Navigate;
  readonly showMobileBanner?: boolean;
};

type WelcomeTabId = "overview" | "features" | "architecture" | "faq" | "pages";

/** Pre-login welcome screen: brand, banner hero and the two doors in.
 *
 *  Owner (2026-10-13): the policy sections that used to live on this page as
 *  one long scroll of anchors are now standalone pages (/features … /terms);
 *  the landing links to them from the page cards below the hero, and also
 *  provides interactive tabs and full mobile access alongside the APK banner. */
export function WelcomePage({ onSignIn, navigate, showMobileBanner = false }: WelcomeProps) {
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<WelcomeTabId>("overview");

  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <PublicHeader active="welcome" navigate={navigate} onSignIn={onSignIn} />

      {showMobileBanner && !mobileBannerDismissed && (
        <section className="kp-mobile-banner" aria-label="KuchuPuchu Android app">
          <div className="kp-mobile-banner__card">
            <img className="kp-mobile-banner__logo" src="/logo.png" alt="KuchuPuchu logo" />
            <div className="kp-mobile-banner__copy">
              <p className="kp-gate__eyebrow">KUCHUPUCHU FOR ANDROID</p>
              <h2>Install the Android app or continue on Web</h2>
              <p>
                Get the signed Android APK for background push notifications, SIM-bound verification
                and native calls — or explore all features and sign in right here in your browser.
              </p>
            </div>
            <div className="kp-mobile-banner__actions">
              <a className="kp-gate__download" href={apkDownloadUrl()}>
                Download the Android app
              </a>
              <button type="button" className="kp-mobile-banner__web" onClick={onSignIn}>
                Sign in on Web
              </button>
              <button
                type="button"
                className="kp-mobile-banner__dismiss"
                aria-label="Dismiss app download prompt"
                onClick={() => setMobileBannerDismissed(true)}
              >
                Explore features
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="kp-welcome__tabs" role="tablist" aria-label="Welcome sections">
        {(
          [
            ["overview", "Overview"],
            ["features", "Features"],
            ["architecture", "Architecture"],
            ["faq", "FAQ"],
            ["pages", "Policy & Pages"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`kp-welcome__tab${activeTab === id ? " is-active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {(activeTab === "overview" || activeTab === "features") && (
        <section className="kp-welcome__hero">
          <div className="kp-welcome__hero-copy">
            <img className="kp-welcome__logo" src="/logo.png" alt="" />
            <h1 id="welcome-title">Messages that stay yours.</h1>
            <p className="kp-welcome__sub">
              KuchuPuchu is a private messenger for Bangladesh — sealed chats, photos, voice and
              video calls, 24-hour status and groups, on your phone and now in your browser.
            </p>
            <div className="kp-welcome__cta">
              <button type="button" onClick={onSignIn}>
                Open KuchuPuchu Web
              </button>
              <a href={apkDownloadUrl()}>Get the Android app</a>
            </div>
          </div>
          {/* Owner (2026-10-13): the homepage banner — headline on the left, the
              brand artwork on the right. Decorative only, so it is skipped by
              assistive tech. */}
          <div className="kp-welcome__hero-art" aria-hidden="true">
            <img src="/banner.jpg" alt="" />
          </div>
        </section>
      )}

      {(activeTab === "overview" || activeTab === "pages") && (
        <section className="kp-welcome__pages" aria-labelledby="pages-heading">
          <h2 id="pages-heading">Everything, in full pages</h2>
          <div className="kp-welcome__page-grid">
            {SITE_PAGES.map((page) => (
              <RouteLink
                key={page}
                className="kp-welcome__page-card"
                route={{ kind: "site", page }}
                navigate={navigate}
              >
                <strong>{SITE_PAGE_LABELS[page]}</strong>
                <span>{SITE_PAGE_BLURBS[page]}</span>
                <em>Read the full page →</em>
              </RouteLink>
            ))}
          </div>
        </section>
      )}

      {(activeTab === "overview" || activeTab === "features") && (
        <section id="features" className="kp-welcome__section">
          <h2>Core features</h2>
          <ul className="kp-welcome__grid">
            <li>
              <strong>1:1 &amp; group chats</strong> — real-time delivery, replies, reactions, read
              receipts, pins and archive.
            </li>
            <li>
              <strong>Voice, photos &amp; files</strong> — record voice notes, share images, video
              and documents inline.
            </li>
            <li>
              <strong>24-hour status</strong> — share text or photo updates with your contacts, with
              per-post audience controls.
            </li>
            <li>
              <strong>Voice &amp; video calls</strong> — peer-to-peer WebRTC calls straight from a
              chat header.
            </li>
            <li>
              <strong>Built-in AI assistant</strong> — optional @ai helper powered by Gemini for
              quick drafts, coding and translations.
            </li>
            <li>
              <strong>Multi-device</strong> — stay signed in on your phone and browser at the same
              time, with remote sign-out from Settings.
            </li>
          </ul>
        </section>
      )}

      {(activeTab === "overview" || activeTab === "architecture") && (
        <section id="architecture" className="kp-welcome__section">
          <h2>System architecture</h2>
          <ul>
            <li>
              <strong>Edge runtime</strong> — stateless Cloudflare Worker handles API routing, rate
              limiting and auth verification close to the user.
            </li>
            <li>
              <strong>Durable Objects</strong> — per-conversation rooms fan out typing, presence,
              delivery and call signalling over WebSockets without central polling.
            </li>
            <li>
              <strong>Storage</strong> — relational metadata in D1 (SQLite at the edge); media blobs
              in R2 behind authenticated fetches.
            </li>
            <li>
              <strong>End-to-end encryption</strong> — client-side ECDH (P-256) + HKDF-SHA256 +
              AES-256-GCM seals 1:1 text and captions (`KP1.` envelopes); the Worker relays
              ciphertext and never holds your private key.
            </li>
          </ul>
        </section>
      )}

      {(activeTab === "overview" || activeTab === "faq") && (
        <section id="faq" className="kp-welcome__section">
          <h2>FAQ</h2>
          <ul>
            <li>
              <strong>Why does the web app ask for my phone?</strong> Your account is anchored to
              your phone number. If you already use KuchuPuchu on Android, open the app — a 6-digit
              approval code appears there automatically.
            </li>
            <li>
              <strong>What if I don&apos;t have the phone nearby?</strong> Accounts with a linked
              Google address can verify with Google instead.
            </li>
            <li>
              <strong>Can I use the web app on my phone?</strong> Yes — you can explore all pages
              and sign in from your mobile browser, or install the native Android APK above for
              background push and native calls.
            </li>
          </ul>
        </section>
      )}

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
