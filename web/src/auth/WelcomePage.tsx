import { useEffect, useState } from "react";
import { RouteLink } from "../RouteLink";
import { HEADER_PAGES, LEGAL_PAGES, PublicHeader, SITE_PAGE_LABELS } from "../site/PublicHeader";
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
        <p className="kp-gate__eyebrow">KUCHUPUCHU FOR ANDROID</p>
        <h1 id="gate-title">Get the KuchuPuchu Android App</h1>
        <p className="kp-gate__copy">
          Install the native Android APK for end-to-end encrypted chats, 1:1 voice &amp; video
          calls, hidden chats, and 24-hour status stories.
        </p>
        <a className="kp-gate__download" href={APK_URL}>
          Download Android APK
        </a>
        {onContinueToWeb ? (
          <button type="button" className="kp-mobile-banner__web" onClick={onContinueToWeb}>
            Explore Features
          </button>
        ) : null}
      </div>
    </main>
  );
}

type WelcomeProps = {
  onSignIn?: () => void;
  navigate?: Navigate;
  showMobileBanner?: boolean;
};

export function WelcomePage({ onSignIn, navigate }: WelcomeProps) {
  const isMobile = useIsMobileViewport();

  useEffect(() => {
    document.title = "KuchuPuchu — Private Messenger for Android & Web";
  }, []);

  return (
    <main className="kp-welcome" aria-labelledby="welcome-title">
      <PublicHeader
        active="welcome"
        navigate={navigate}
        onSignIn={!isMobile ? onSignIn : undefined}
      />

      {/* Hero Section */}
      <section className="kp-welcome__hero">
        <div className="kp-welcome__hero-copy">
          <p className="kp-welcome__eyebrow">TACTILE SKEUOMORPHIC · END-TO-END ENCRYPTED</p>
          <h1 id="welcome-title">Messages that stay yours.</h1>
          <p className="kp-welcome__sub">
            Sealed KP1 personal chats, hidden &amp; archived conversation vaults, 1:1 WebRTC voice
            &amp; video calls, 24-hour status stories, and KuchuPuchu Gemini AI.
          </p>
          <div
            className={`kp-welcome__cta${!isMobile && onSignIn ? "" : " kp-welcome__cta--single"}`}
          >
            {!isMobile && onSignIn ? (
              <button type="button" className="kp-desktop-only" onClick={onSignIn}>
                Open KuchuPuchu Web
              </button>
            ) : null}
            <a href={APK_URL} className="kp-welcome__apk-btn">
              Download Android APK
            </a>
          </div>
        </div>
        <div className="kp-welcome__hero-art" aria-hidden="true">
          <img src="/banner.jpg" alt="" />
        </div>
      </section>

      {/* 3D Skeuomorphic Phone Trio Showcase (Hide Chat · OTP Passcode Lock · Pull-to-Archive Gauge) */}
      <section className="kp-skeuo-showcase" aria-labelledby="showcase-heading">
        <div className="kp-section-head">
          <p className="kp-welcome__eyebrow">TACTILE INTERACTIVE CONTROLS</p>
          <h2 id="showcase-heading">Built for tactile privacy &amp; effortless control</h2>
          <p>
            Every screen uses sculpted 3D Skeuomorphic surfaces — raised tactile keys, carved input
            wells, and smooth gesture rings.
          </p>
        </div>

        <div className="kp-phone-trio">
          {/* Phone 1: Hide & Lock Chats */}
          <article className="kp-phone-device" aria-label="How to hide chats">
            <div className="kp-phone-device__top">
              <span className="kp-phone-device__back" aria-hidden="true">
                ←
              </span>
              <span className="kp-phone-device__pill-tag">Vault</span>
            </div>
            <div className="kp-phone-device__sculpt" aria-hidden="true">
              <div className="kp-sculpt-shape kp-sculpt-shape--circle" />
              <div className="kp-sculpt-shape kp-sculpt-shape--square">
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </div>
              <div className="kp-sculpt-shape kp-sculpt-shape--tri" />
            </div>
            <div className="kp-phone-device__well">
              <div className="kp-mini-row">
                <span className="kp-mini-avatar">R</span>
                <div className="kp-mini-copy">
                  <strong>Rahi · Secret Chat</strong>
                  <span>Long-press or ⋮ → Hide chat</span>
                </div>
                <span className="kp-mini-chip">Hidden</span>
              </div>
              <div className="kp-mini-row">
                <span className="kp-mini-avatar">S</span>
                <div className="kp-mini-copy">
                  <strong>Open Hidden Vault</strong>
                  <span>Home ⋮ Menu → Hidden chats</span>
                </div>
                <span className="kp-mini-chip">Unlock</span>
              </div>
            </div>
            <h3>Hide &amp; Unhide Chats</h3>
            <p>
              Remove private threads from your main inbox with zero notification leaks, and restore
              them anytime from the Hidden Vault.
            </p>
            <div className="kp-phone-device__cta-pill">Hide My Secret Chats</div>
          </article>

          {/* Phone 2: Passcode / Compact OTP Approval Lock */}
          <article className="kp-phone-device" aria-label="Compact OTP and login approval lock">
            <div className="kp-phone-device__top">
              <span className="kp-phone-device__back" aria-hidden="true">
                ←
              </span>
              <span className="kp-phone-device__eye" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              <span className="kp-phone-device__pill-tag">KP1</span>
            </div>
            <h3>Passcode &amp; OTP Lock</h3>
            <p className="kp-phone-device__sub">Approval code sent to +880 ••••••3003</p>
            <div className="kp-otp-well" aria-hidden="true">
              <span className="kp-otp-well__label">COMPACT 6-DIGIT APPROVAL CODE</span>
              <div className="kp-otp-well__slot">
                <span className="kp-otp-dots">4 · 8 · 2 · 9 · 1 · 0</span>
                <span className="kp-otp-copy-chip">Copy</span>
              </div>
              <div className="kp-otp-well__meta">
                <span>RESEND</span>
                <span>00:45</span>
              </div>
            </div>
            <div className="kp-keypad" aria-hidden="true">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span className="kp-keypad__raised">5</span>
              <span>6</span>
              <span>7</span>
              <span>8</span>
              <span>9</span>
              <span className="kp-keypad__empty" />
              <span>0</span>
              <span className="kp-keypad__check">✓</span>
            </div>
          </article>

          {/* Phone 3: 2-Second Pull-to-Archive Progress Ring */}
          <article className="kp-phone-device" aria-label="Pull and hold to archive chats">
            <div className="kp-phone-device__top">
              <span className="kp-phone-device__back" aria-hidden="true">
                ←
              </span>
              <span className="kp-phone-device__pill-tag">2.0s Hold</span>
            </div>
            <div className="kp-gauge-wrap" aria-hidden="true">
              <div className="kp-gauge-ring">
                <svg viewBox="0 0 140 140" className="kp-gauge-svg">
                  <defs>
                    <linearGradient id="kpArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="55%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>
                  <circle cx="70" cy="70" r="52" className="kp-gauge-track" />
                  <circle
                    cx="70"
                    cy="70"
                    r="52"
                    className="kp-gauge-fill"
                    stroke="url(#kpArcGrad)"
                    strokeDasharray="265 327"
                  />
                </svg>
                <div className="kp-gauge-center">
                  <strong>80%</strong>
                  <span>Pull &amp; Hold</span>
                </div>
              </div>
            </div>
            <h3>Pull-to-Archive Drawer</h3>
            <p>
              Pull down at the top of your inbox for 2 seconds to fill the tactile ring and open
              Archived chats, or long-press any chat to archive.
            </p>
            <div className="kp-pager-dots" aria-hidden="true">
              <span />
              <span className="is-active" />
              <span />
            </div>
            <div className="kp-phone-device__cta-pill">Open Archived Chats</div>
          </article>
        </div>
      </section>

      {/* Step-by-Step Visual Feature Banners (Hide Chat, Archive Chat, E2EE, Calls, Media, AI) */}
      <section className="kp-feature-banners" aria-labelledby="banners-heading">
        <div className="kp-section-head">
          <p className="kp-welcome__eyebrow">COMPLETE FEATURE GUIDE &amp; VISUAL BANNERS</p>
          <h2 id="banners-heading">Every KuchuPuchu feature &amp; how it works</h2>
          <p>
            Visual guides for hiding chats, archiving conversations, sealed KP1 encryption, 1:1
            voice &amp; video calls, 24h status, and Gemini AI.
          </p>
        </div>

        <div className="kp-banner-stack">
          {/* Banner 1: How to Hide & Unhide a Chat */}
          <article className="kp-feature-banner">
            <div className="kp-feature-banner__copy">
              <span className="kp-site__badge">STEP-BY-STEP GUIDE</span>
              <h3>How to Hide &amp; Unhide Secret Chats</h3>
              <p>
                Keep sensitive conversations completely out of sight from your main inbox list while
                preserving every encrypted message and media attachment.
              </p>
              <ol className="kp-step-list">
                <li>
                  <strong>Hide a conversation:</strong> Long-press any chat row in your inbox (or
                  open the conversation&apos;s top-right <code>⋮</code> menu) and tap{" "}
                  <strong>Hide chat</strong>.
                </li>
                <li>
                  <strong>Zero inbox trace:</strong> Hidden chats do not appear in your main chat
                  list and never pop up preview banners on your lock screen.
                </li>
                <li>
                  <strong>Access or Unhide anytime:</strong> Tap the top-right <code>⋮</code> menu
                  on the home screen → select <strong>Hidden chats</strong> → tap{" "}
                  <strong>Unhide</strong> to bring the conversation back to your inbox.
                </li>
              </ol>
            </div>
            <div className="kp-feature-banner__art" aria-hidden="true">
              <svg viewBox="0 0 460 250" className="kp-banner-svg">
                <rect
                  x="12"
                  y="14"
                  width="436"
                  height="222"
                  rx="22"
                  fill="#0f182a"
                  stroke="#28406c"
                />
                <rect
                  x="28"
                  y="32"
                  width="190"
                  height="62"
                  rx="14"
                  fill="#172540"
                  stroke="#365792"
                />
                <circle cx="56" cy="63" r="18" fill="#2f6fed" />
                <text x="56" y="68" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">
                  R
                </text>
                <text x="84" y="57" fill="#eaf0fa" fontSize="13" fontWeight="700">
                  Rahi
                </text>
                <text x="84" y="75" fill="#93a2be" fontSize="11">
                  Long-press → Hide chat
                </text>

                <path
                  d="M226 63 L254 63"
                  stroke="#60a5fa"
                  strokeWidth="2.5"
                  strokeDasharray="4 4"
                />
                <polygon points="254,58 264,63 254,68" fill="#60a5fa" />

                <rect
                  x="270"
                  y="32"
                  width="162"
                  height="62"
                  rx="14"
                  fill="#1b2d4f"
                  stroke="#60a5fa"
                />
                <text
                  x="351"
                  y="56"
                  textAnchor="middle"
                  fill="#93c5fd"
                  fontSize="11"
                  fontWeight="700"
                >
                  HIDDEN VAULT
                </text>
                <text
                  x="351"
                  y="76"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="13"
                  fontWeight="700"
                >
                  Locked &amp; Muted
                </text>

                <rect
                  x="28"
                  y="114"
                  width="404"
                  height="102"
                  rx="16"
                  fill="#0b1220"
                  stroke="#223559"
                />
                <text x="48" y="142" fill="#60a5fa" fontSize="11" fontWeight="700">
                  HOW TO RESTORE HIDDEN CHATS
                </text>
                <rect
                  x="48"
                  y="156"
                  width="112"
                  height="40"
                  rx="10"
                  fill="#16233d"
                  stroke="#2f6fed"
                />
                <text
                  x="104"
                  y="180"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="12"
                  fontWeight="600"
                >
                  1. Tap ⋮ Menu
                </text>
                <rect
                  x="174"
                  y="156"
                  width="122"
                  height="40"
                  rx="10"
                  fill="#16233d"
                  stroke="#2f6fed"
                />
                <text
                  x="235"
                  y="180"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="12"
                  fontWeight="600"
                >
                  2. Hidden chats
                </text>
                <rect x="310" y="156" width="104" height="40" rx="10" fill="#2563eb" />
                <text
                  x="362"
                  y="180"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="700"
                >
                  3. Unhide ✓
                </text>
              </svg>
            </div>
          </article>

          {/* Banner 2: How to Archive Chats & 2s Pull-Hold Gesture */}
          <article className="kp-feature-banner kp-feature-banner--reverse">
            <div className="kp-feature-banner__copy">
              <span className="kp-site__badge">INBOX ORGANIZATION</span>
              <h3>How to Archive Chats &amp; Use the 2-Second Pull Gesture</h3>
              <p>
                Keep your inbox clean by moving inactive or low-priority chats into the Archived
                drawer without deleting history.
              </p>
              <ol className="kp-step-list">
                <li>
                  <strong>Archive any chat:</strong> Long-press a conversation (or open its{" "}
                  <code>⋮</code> menu) and tap <strong>Archive chat</strong>.
                </li>
                <li>
                  <strong>2-second pull-and-hold gesture:</strong> Pull down from the top of your
                  chat list and hold for 2 seconds — watch the circular progress ring fill to jump
                  straight into your Archived folder, or tap the <strong>Archived</strong> row at
                  the top of Chats.
                </li>
                <li>
                  <strong>Unarchive with one tap:</strong> Open the Archived list and tap{" "}
                  <strong>Unarchive</strong> on any conversation to move it back to your main inbox.
                </li>
              </ol>
            </div>
            <div className="kp-feature-banner__art" aria-hidden="true">
              <svg viewBox="0 0 460 250" className="kp-banner-svg">
                <rect
                  x="12"
                  y="14"
                  width="436"
                  height="222"
                  rx="22"
                  fill="#0f182a"
                  stroke="#28406c"
                />
                <circle cx="96" cy="125" r="58" fill="#0b1220" stroke="#23365c" strokeWidth="8" />
                <circle
                  cx="96"
                  cy="125"
                  r="58"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="310 365"
                  transform="rotate(-90 96 125)"
                />
                <text
                  x="96"
                  y="120"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="18"
                  fontWeight="800"
                >
                  2.0s
                </text>
                <text
                  x="96"
                  y="140"
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="11"
                  fontWeight="700"
                >
                  PULL &amp; HOLD
                </text>

                <rect
                  x="182"
                  y="38"
                  width="246"
                  height="48"
                  rx="13"
                  fill="#172540"
                  stroke="#3b82f6"
                />
                <text x="204" y="67" fill="#eaf0fa" fontSize="13" fontWeight="700">
                  Archived Chats (4)
                </text>
                <text x="408" y="67" textAnchor="end" fill="#60a5fa" fontSize="12" fontWeight="700">
                  Open →
                </text>

                <rect
                  x="182"
                  y="98"
                  width="246"
                  height="52"
                  rx="13"
                  fill="#131f36"
                  stroke="#24385e"
                />
                <circle cx="208" cy="124" r="15" fill="#2563eb" />
                <text
                  x="208"
                  y="129"
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="12"
                  fontWeight="700"
                >
                  S
                </text>
                <text x="232" y="120" fill="#eaf0fa" fontSize="12" fontWeight="700">
                  Squad Group
                </text>
                <text x="232" y="136" fill="#93a2be" fontSize="11">
                  Muted · Tap Unarchive
                </text>

                <rect
                  x="182"
                  y="160"
                  width="246"
                  height="52"
                  rx="13"
                  fill="#131f36"
                  stroke="#24385e"
                />
                <circle cx="208" cy="186" r="15" fill="#1d4ed8" />
                <text
                  x="208"
                  y="191"
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="12"
                  fontWeight="700"
                >
                  A
                </text>
                <text x="232" y="182" fill="#eaf0fa" fontSize="12" fontWeight="700">
                  Amina
                </text>
                <text x="232" y="198" fill="#93a2be" fontSize="11">
                  Archived · History intact
                </text>
              </svg>
            </div>
          </article>

          {/* Banner 3: KP1 End-to-End Encryption & KP2 Passphrase Key Backup */}
          <article className="kp-feature-banner">
            <div className="kp-feature-banner__copy">
              <span className="kp-site__badge">ZERO-KNOWLEDGE CRYPTO</span>
              <h3>KP1 End-to-End Encryption &amp; KP2 Key Backups</h3>
              <p>
                Every 1:1 personal message is sealed on your device before upload using ECDH P-256
                key agreement, HKDF-SHA256, and AES-256-GCM authenticated encryption.
              </p>
              <ul className="kp-step-list">
                <li>
                  <strong>Sealed on-device (`KP1`):</strong> The Cloudflare Worker and D1 database
                  only store ciphertext envelopes — never your private keys or plaintext.
                </li>
                <li>
                  <strong>Cross-device KP2 backup:</strong> Lock your P-256 identity key with a 6+
                  character passphrase (PBKDF2-SHA256, 210,000 iterations) to unlock your sealed
                  history on KuchuPuchu Web.
                </li>
              </ul>
            </div>
            <div className="kp-feature-banner__art" aria-hidden="true">
              <svg viewBox="0 0 460 250" className="kp-banner-svg">
                <rect
                  x="12"
                  y="14"
                  width="436"
                  height="222"
                  rx="22"
                  fill="#0f182a"
                  stroke="#28406c"
                />
                <rect
                  x="28"
                  y="44"
                  width="116"
                  height="162"
                  rx="16"
                  fill="#16233d"
                  stroke="#3b82f6"
                />
                <text
                  x="86"
                  y="76"
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="11"
                  fontWeight="700"
                >
                  YOUR DEVICE
                </text>
                <text
                  x="86"
                  y="102"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="13"
                  fontWeight="700"
                >
                  ECDH P-256
                </text>
                <text x="86" y="124" textAnchor="middle" fill="#93a2be" fontSize="11">
                  AES-256-GCM
                </text>
                <rect
                  x="44"
                  y="146"
                  width="84"
                  height="36"
                  rx="9"
                  fill="#0b1220"
                  stroke="#253659"
                />
                <text
                  x="86"
                  y="168"
                  textAnchor="middle"
                  fill="#93c5fd"
                  fontSize="11"
                  fontWeight="700"
                >
                  Private Key
                </text>

                <rect
                  x="166"
                  y="64"
                  width="128"
                  height="122"
                  rx="16"
                  fill="#0b1220"
                  stroke="#2563eb"
                />
                <text
                  x="230"
                  y="94"
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="11"
                  fontWeight="700"
                >
                  KP1 ENVELOPE
                </text>
                <text
                  x="230"
                  y="118"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="12"
                  fontWeight="700"
                >
                  Ciphertext Only
                </text>
                <text x="230" y="140" textAnchor="middle" fill="#93a2be" fontSize="10.5">
                  IV + AuthTag + Blob
                </text>
                <text
                  x="230"
                  y="164"
                  textAnchor="middle"
                  fill="#38bdf8"
                  fontSize="10.5"
                  fontWeight="700"
                >
                  KP2 Backup Vault
                </text>

                <rect
                  x="316"
                  y="44"
                  width="116"
                  height="162"
                  rx="16"
                  fill="#16233d"
                  stroke="#3b82f6"
                />
                <text
                  x="374"
                  y="76"
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="11"
                  fontWeight="700"
                >
                  PEER DEVICE
                </text>
                <text
                  x="374"
                  y="102"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="13"
                  fontWeight="700"
                >
                  Verified Peer
                </text>
                <text x="374" y="124" textAnchor="middle" fill="#93a2be" fontSize="11">
                  HKDF-SHA256
                </text>
                <rect x="332" y="146" width="84" height="36" rx="9" fill="#2563eb" />
                <text
                  x="374"
                  y="168"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="700"
                >
                  Decrypted ✓
                </text>
              </svg>
            </div>
          </article>

          {/* Banner 4: 1:1 Voice & Video Calls + View-Once Media & Gemini AI */}
          <article className="kp-feature-banner kp-feature-banner--reverse">
            <div className="kp-feature-banner__copy">
              <span className="kp-site__badge">CALLS · STATUS · AI</span>
              <h3>1:1 WebRTC Calls, View-Once Media, 24h Status &amp; Gemini AI</h3>
              <p>
                Everything you need for daily communication — built into one fast, dark-blue
                Skeuomorphic workspace.
              </p>
              <ul className="kp-step-list">
                <li>
                  <strong>1:1 Voice &amp; Video Calls:</strong> DTLS-SRTP encrypted WebRTC calls
                  with profile avatars, camera switch, mute, and call history sync.
                </li>
                <li>
                  <strong>View-Once &amp; Media Studio:</strong> Send photos, videos, and voice
                  notes that auto-delete from R2 after one view, plus built-in crop/draw/text photo
                  editing and 1,150+ stickers.
                </li>
                <li>
                  <strong>24h Status &amp; KuchuPuchu AI:</strong> Share 24-hour photo/video/text
                  stories and chat with the verified <strong>KuchuPuchu AI</strong> assistant
                  (powered by Google Gemini) in Bangla, Banglish, or English.
                </li>
              </ul>
            </div>
            <div className="kp-feature-banner__art" aria-hidden="true">
              <svg viewBox="0 0 460 250" className="kp-banner-svg">
                <rect
                  x="12"
                  y="14"
                  width="436"
                  height="222"
                  rx="22"
                  fill="#0f182a"
                  stroke="#28406c"
                />
                <rect
                  x="28"
                  y="32"
                  width="194"
                  height="186"
                  rx="18"
                  fill="#15223b"
                  stroke="#3b82f6"
                />
                <circle cx="125" cy="84" r="28" fill="#2563eb" stroke="#93c5fd" strokeWidth="3" />
                <text x="125" y="91" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800">
                  R
                </text>
                <text
                  x="125"
                  y="132"
                  textAnchor="middle"
                  fill="#eaf0fa"
                  fontSize="14"
                  fontWeight="700"
                >
                  Rahi · HD Call
                </text>
                <text
                  x="125"
                  y="150"
                  textAnchor="middle"
                  fill="#60a5fa"
                  fontSize="11"
                  fontWeight="600"
                >
                  04:18 · DTLS-SRTP
                </text>
                <circle cx="85" cy="184" r="16" fill="#1e3256" />
                <circle cx="125" cy="184" r="16" fill="#dc2626" />
                <circle cx="165" cy="184" r="16" fill="#1e3256" />

                <rect
                  x="240"
                  y="32"
                  width="192"
                  height="86"
                  rx="16"
                  fill="#15223b"
                  stroke="#2d497a"
                />
                <text x="260" y="58" fill="#60a5fa" fontSize="11" fontWeight="700">
                  VIEW-ONCE &amp; 24H STATUS
                </text>
                <text x="260" y="80" fill="#eaf0fa" fontSize="13" fontWeight="700">
                  1× Photo &amp; Voice Notes
                </text>
                <text x="260" y="99" fill="#93a2be" fontSize="11">
                  Auto-wiped after viewing
                </text>

                <rect
                  x="240"
                  y="132"
                  width="192"
                  height="86"
                  rx="16"
                  fill="#15223b"
                  stroke="#2d497a"
                />
                <text x="260" y="158" fill="#38bdf8" fontSize="11" fontWeight="700">
                  GEMINI AI ASSISTANT
                </text>
                <text x="260" y="180" fill="#eaf0fa" fontSize="13" fontWeight="700">
                  KuchuPuchu AI ✓
                </text>
                <text x="260" y="199" fill="#93a2be" fontSize="11">
                  Bangla · Banglish · English
                </text>
              </svg>
            </div>
          </article>
        </div>
      </section>

      {/* Product & Technical Deep-Dive Pages (No legal cards here) */}
      <section className="kp-welcome__pages" aria-labelledby="pages-heading">
        <div className="kp-welcome__pages-head">
          <h2 id="pages-heading">Explore product &amp; technical pages</h2>
          <p>Switch tabs at the top or open any dedicated page below.</p>
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

      {/* Footer: Legal links live exclusively here */}
      <footer className="kp-welcome__foot">
        <div className="kp-welcome__foot-inner">
          <span>KuchuPuchu · End-to-end encrypted · </span>
          <a href={APK_URL}>Android APK</a>
          <span className="kp-welcome__foot-links">
            {LEGAL_PAGES.map((page) => (
              <span key={page}>
                {" · "}
                {navigate ? (
                  <RouteLink
                    route={{ kind: "site", page }}
                    navigate={navigate}
                    className="link-button"
                  >
                    {SITE_PAGE_LABELS[page]}
                  </RouteLink>
                ) : (
                  <a href={`/${page}`} className="link-button">
                    {SITE_PAGE_LABELS[page]}
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
