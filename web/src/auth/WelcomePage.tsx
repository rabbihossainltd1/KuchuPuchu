import { useEffect, useState } from "react";
import { RouteLink } from "../RouteLink";
import { AllAndroidFeatureBanners, SkeuomorphicPhoneTrio } from "../site/FeatureBanners";
import { HEADER_PAGES, LEGAL_PAGES, PublicHeader, SITE_PAGE_LABELS } from "../site/PublicHeader";
import { SITE_PAGE_BLURBS } from "../site/SitePages";
import type { Navigate } from "../useBrowserRouter";
import "./welcome.css";

/** Same-origin Worker redirect to the latest signed Android release APK. */
export const APK_DOWNLOAD_HREF = "/download/apk";

const MOBILE_MAX_WIDTH_PX = 900;

function readMobileMatch(): boolean {
  if (typeof window === "undefined") return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
  }
  return window.innerWidth <= MOBILE_MAX_WIDTH_PX;
}

export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState<boolean>(readMobileMatch);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
    const update = () => setMobile(readMobileMatch());
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return mobile;
}

export function WelcomePage({
  onSignIn,
  navigate,
  showMobileBanner = false,
}: {
  onSignIn?: () => void;
  navigate?: Navigate;
  showMobileBanner?: boolean;
}) {
  const isMobile = useIsMobileViewport();
  const hideLogin = showMobileBanner || isMobile;

  return (
    <main className="kp-welcome" aria-labelledby="kp-welcome-heading">
      <div className="kp-welcome__glow kp-welcome__glow--blue" aria-hidden="true" />
      <div className="kp-welcome__glow kp-welcome__glow--teal" aria-hidden="true" />

      <PublicHeader
        active="welcome"
        navigate={navigate}
        onSignIn={hideLogin ? undefined : onSignIn}
      />

      {/* HERO SECTION */}
      <section className="kp-welcome__hero">
        <div className="kp-welcome__copy">
          <p className="eyebrow">TACTILE SKEUOMORPHIC · END-TO-END ENCRYPTED</p>
          <h1 id="kp-welcome-heading">Messages that stay yours.</h1>
          <p className="kp-welcome__lede">
            All 17 native Android &amp; Web capabilities — KP1 sealed 1:1 chats, KP2 key backups,
            Secret-Key hidden chats, 2-second pull-to-archive, 3D Lottie emoji FX,{" "}
            <code>/magic</code> slash commands, view-once studio, 5 GB multipart files, 1:1 WebRTC
            calls with screen share &amp; system audio, 24h stories, and verified Google Gemini AI.
          </p>

          <div className="kp-welcome__cta">
            {onSignIn && !hideLogin && (
              <button
                type="button"
                className="primary-button kp-welcome__primary kp-desktop-only"
                onClick={onSignIn}
              >
                Open KuchuPuchu Web
              </button>
            )}
            <a className="secondary-button kp-welcome__secondary" href={APK_DOWNLOAD_HREF}>
              Download Android APK
            </a>
          </div>
        </div>

        <figure className="kp-welcome__visual">
          <img
            className="kp-welcome__hero-img"
            src="/hero-illustration.jpg"
            alt="Encrypted chat bubbles and lock shields around a smartphone"
            width={1408}
            height={768}
          />
        </figure>
      </section>

      {/* 3D SKEUOMORPHIC PHONE TRIO SHOWCASE */}
      <SkeuomorphicPhoneTrio />

      {/* ALL 24 DEDICATED 3D SKEUOMORPHIC VISUAL FEATURE BANNERS */}
      <AllAndroidFeatureBanners
        category="overview"
        heading="Every feature built into KuchuPuchu Android & Web"
        subheading="All 24 features in the KuchuPuchu Android app and Web platform — each with its own dedicated 3D Skeuomorphic visual banner and step-by-step guide."
      />

      {/* EXPLORE PRODUCT & TECHNICAL PAGES */}
      {navigate && (
        <section className="kp-welcome__pages" aria-labelledby="kp-pages-heading">
          <div className="kp-welcome__pages-head">
            <div>
              <h2 id="kp-pages-heading">Explore dedicated visual feature &amp; technical pages</h2>
              <p>
                Every tab at the top includes visual 3D Skeuomorphic banners and deep-dive guides.
              </p>
            </div>
          </div>
          <div className="kp-welcome__page-grid">
            {HEADER_PAGES.map((id) => (
              <RouteLink
                key={id}
                route={{ kind: "site", page: id }}
                navigate={navigate}
                className="kp-welcome__page-card"
              >
                <strong>{SITE_PAGE_LABELS[id]}</strong>
                <span>{SITE_PAGE_BLURBS[id]}</span>
              </RouteLink>
            ))}
          </div>
        </section>
      )}

      {/* FOOTER — ONLY PLACE FOR LEGAL LINKS */}
      <footer className="kp-welcome__foot">
        <div className="kp-welcome__foot-inner">
          <span>KuchuPuchu · End-to-end encrypted</span>
          <span className="kp-welcome__foot-links">
            <a href={APK_DOWNLOAD_HREF}>Android APK</a>
            {LEGAL_PAGES.map((slug) => (
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
          </span>
        </div>
      </footer>
    </main>
  );
}
