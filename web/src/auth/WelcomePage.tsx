import { useEffect, useState } from "react";
import { RouteLink } from "../RouteLink";
import { HEADER_PAGES, PublicHeader, SITE_PAGE_LABELS } from "../site/PublicHeader";
import { SITE_PAGE_BLURBS } from "../site/SitePages";
import type { Navigate } from "../useBrowserRouter";
import "./welcome.css";

const APK_URL = "/download/apk";

export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return mobile;
}

export function MobileGate({ onContinueToWeb }: { onContinueToWeb?: () => void }) {
  return (
    <main className="kp-gate" aria-labelledby="gate-title">
      <div className="kp-gate__card">
        <img className="kp-gate__logo" src="/logo.png" alt="KuchuPuchu logo" />
        <p className="kp-gate__eyebrow">KUCHUPUCHU FOR ANDROID &amp; WEB</p>
        <h1 id="gate-title">Get the KuchuPuchu App or Continue on Web</h1>
        <p className="kp-gate__copy">
          Install the native Android APK for background call notifications, or explore all features
          and sign in directly in your mobile browser.
        </p>
        <a className="kp-gate__download" href={APK_URL}>
          Download Android APK
        </a>
        {onContinueToWeb ? (
          <button type="button" className="kp-mobile-banner__web" onClick={onContinueToWeb}>
            Explore Features &amp; Web App
          </button>
        ) : null}
      </div>
    </main>
  );
}

type WelcomeProps = {
  onSignIn: () => void;
  navigate?: Navigate;
  showMobileBanner?: boolean;
};

const HIGHLIGHTS = [
  {
    title: "Sealed KP1 personal chats",
    badge: "ECDH P-256",
    body: "1:1 messages are encrypted on your device with AES-256-GCM before upload.",
  },
  {
    title: "1:1 voice & video calls",
    badge: "WebRTC",
    body: "Peer-to-peer DTLS-SRTP audio and video calls across Android and Web.",
  },
  {
    title: "Media, voice notes & 24h status",
    badge: "View-Once",
    body: "Share HD photos, documents, voice notes, and ephemeral 24-hour stories.",
  },
  {
    title: "KuchuPuchu AI assistant",
    badge: "Gemini AI",
    body: "Built-in assistant for Bengali, Banglish, and English text and image help.",
  },
] as const;

export function WelcomePage({ onSignIn, navigate }: WelcomeProps) {
  useEffect(() => {
    document.title = "KuchuPuchu — Private Messenger for Android & Web";
  }, []);

  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <PublicHeader active="welcome" navigate={navigate} onSignIn={onSignIn} />

      <section className="kp-welcome__hero">
        <div className="kp-welcome__hero-copy">
          <p className="kp-welcome__eyebrow">END-TO-END ENCRYPTED · ANDROID &amp; WEB</p>
          <h1 id="welcome-title">Messages that stay yours.</h1>
          <p className="kp-welcome__sub">
            Private personal chats, 1:1 voice &amp; video calls, 24-hour status stories, and
            KuchuPuchu AI — synced across your Android phone and browser.
          </p>
          <div className="kp-welcome__cta">
            <button type="button" onClick={onSignIn}>
              Open KuchuPuchu Web
            </button>
            <a href={APK_URL}>Download Android APK</a>
          </div>
        </div>
        <div className="kp-welcome__hero-art" aria-hidden="true">
          <img src="/banner.jpg" alt="" />
        </div>
      </section>

      <section className="kp-welcome__overview-cards" aria-label="Core capabilities">
        <div className="kp-site__grid">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="kp-site__card">
              <div className="kp-site__card-head">
                <strong>{item.title}</strong>
                <span className="kp-site__badge">{item.badge}</span>
              </div>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="kp-welcome__pages" aria-labelledby="pages-heading">
        <div className="kp-welcome__pages-head">
          <h2 id="pages-heading">Dedicated pages</h2>
          <p>Switch tabs at the top or open any page directly below.</p>
        </div>
        <div className="kp-welcome__page-grid">
          {HEADER_PAGES.map((page) =>
            navigate ? (
              <RouteLink
                key={page}
                route={{ kind: "site", page }}
                navigate={navigate}
                className="kp-welcome__page-card"
              >
                <strong>{SITE_PAGE_LABELS[page]}</strong>
                <span>{SITE_PAGE_BLURBS[page]}</span>
              </RouteLink>
            ) : (
              <a key={page} href={`/${page}`} className="kp-welcome__page-card">
                <strong>{SITE_PAGE_LABELS[page]}</strong>
                <span>{SITE_PAGE_BLURBS[page]}</span>
              </a>
            ),
          )}
        </div>
      </section>

      <footer className="kp-welcome__foot">
        <span>KuchuPuchu · End-to-end encrypted · </span>
        <a href={APK_URL}>Android APK</a>
        {HEADER_PAGES.map((page) => (
          <span key={page}>
            {" · "}
            {navigate ? (
              <RouteLink route={{ kind: "site", page }} navigate={navigate} className="link-button">
                {SITE_PAGE_LABELS[page]}
              </RouteLink>
            ) : (
              <a href={`/${page}`} className="link-button">
                {SITE_PAGE_LABELS[page]}
              </a>
            )}
          </span>
        ))}
      </footer>
    </main>
  );
}
