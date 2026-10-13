import { useEffect, useState } from "react";
import { RouteLink } from "../RouteLink";
import { PublicHeader, SITE_PAGE_LABELS } from "../site/PublicHeader";
import { SITE_PAGE_BLURBS } from "../site/SitePages";
import type { Navigate } from "../useBrowserRouter";
import { SITE_PAGES } from "../router";
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

export function WelcomePage({ onSignIn, navigate }: WelcomeProps) {
  useEffect(() => {
    document.title = "KuchuPuchu — Private Messenger for Android & Web";
  }, []);

  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <PublicHeader active="welcome" navigate={navigate} onSignIn={onSignIn} />

      <section className="kp-welcome__hero">
        <div className="kp-welcome__hero-copy">
          <div className="kp-welcome__hero-brand">
            <img className="kp-welcome__logo" src="/logo.png" alt="KuchuPuchu app logo" />
            <span className="kp-welcome__badge">DARK BLUE EDITION · ANDROID &amp; WEB</span>
          </div>
          <h1 id="welcome-title">Messages that stay yours.</h1>
          <p className="kp-welcome__sub">
            Private, end-to-end encrypted personal chats, 1:1 voice &amp; video calls, 24-hour
            status updates, and KuchuPuchu AI — built for Android and the companion Web app.
          </p>
          <div className="kp-welcome__cta">
            <button type="button" onClick={onSignIn}>
              Open KuchuPuchu Web
            </button>
            <a href={APK_URL}>Download Android APK</a>
          </div>
          <div className="kp-welcome__highlights" aria-label="Platform highlights">
            <span>KP1 E2EE · ECDH P-256 + AES-256-GCM</span>
            <span>WebRTC DTLS-SRTP 1:1 Calls</span>
            <span>Mobile &amp; Desktop Web Ready</span>
          </div>
        </div>
        <div className="kp-welcome__hero-art" aria-hidden="true">
          <img src="/banner.jpg" alt="" />
        </div>
      </section>

      <section className="kp-welcome__pages" aria-labelledby="pages-heading">
        <div className="kp-welcome__pages-head">
          <h2 id="pages-heading">Explore dedicated pages</h2>
          <p>
            Every section lives on its own standalone page — select any tab above or open a page
            below.
          </p>
        </div>
        <div className="kp-welcome__page-grid">
          {SITE_PAGES.map((page) =>
            navigate ? (
              <RouteLink
                key={page}
                route={{ kind: "site", page }}
                navigate={navigate}
                className="kp-welcome__page-card"
              >
                <strong>{SITE_PAGE_LABELS[page]}</strong>
                <span>{SITE_PAGE_BLURBS[page]}</span>
                <em>Open /{page} →</em>
              </RouteLink>
            ) : (
              <a key={page} href={`/${page}`} className="kp-welcome__page-card">
                <strong>{SITE_PAGE_LABELS[page]}</strong>
                <span>{SITE_PAGE_BLURBS[page]}</span>
                <em>Open /{page} →</em>
              </a>
            ),
          )}
        </div>
      </section>

      <footer className="kp-welcome__foot">
        <span>KuchuPuchu · End-to-end encrypted · </span>
        <a href={APK_URL}>Android APK</a>
        {SITE_PAGES.map((page) => (
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
