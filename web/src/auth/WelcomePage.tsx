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
};

/** Pre-login welcome screen: brand, banner hero and the two doors in.
 *
 *  Owner (2026-10-13): the policy sections that used to live on this page as
 *  one long scroll of anchors are now standalone pages (/features … /terms);
 *  the landing links to them from the page cards below the hero. */
export function WelcomePage({ onSignIn, navigate }: WelcomeProps) {
  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <PublicHeader navigate={navigate} onSignIn={onSignIn} />

      <section className="kp-welcome__hero">
        <div className="kp-welcome__hero-copy">
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
        </div>
        {/* Owner (2026-10-13): the homepage banner — headline on the left, the
            brand artwork on the right. Decorative only, so it is skipped by
            assistive tech. */}
        <div className="kp-welcome__hero-art" aria-hidden="true">
          <img src="/banner.jpg" alt="" />
        </div>
      </section>

      {/* Owner (2026-10-13): compact cards instead of five inline sections —
          every policy/static page is its own URL now. */}
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
