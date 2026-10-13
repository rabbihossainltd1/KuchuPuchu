export type FeatureBannerCategory =
  "all" | "overview" | "features" | "encryption" | "architecture" | "faq" | "legal";

export type AndroidFeatureItem = {
  num: string;
  tag: string;
  title: string;
  summary: string;
  modules: string;
};

/**
 * Exhaustive inventory of all 17 feature pillars in the KuchuPuchu Android app
 * (`native-android/app/src/main/java/app/kuchupuchu/android/`).
 */
export const ANDROID_APP_FEATURES: readonly AndroidFeatureItem[] = [
  {
    num: "01",
    tag: "E2EE CRYPTO",
    title: "KP1 Sealed 1:1 Personal Chats",
    summary:
      "On-device ECDH P-256 key agreement, HKDF-SHA256, and AES-256-GCM authenticated encryption with a fail-closed transport guard.",
    modules: "E2eeMsg.kt · E2eePolicy.kt",
  },
  {
    num: "02",
    tag: "KEY VAULT",
    title: "KP2 Cross-Device Key Backups",
    summary:
      "Lock your P-256 private key with a 6+ character passphrase (PBKDF2-SHA256, 210,000 iterations + AES-256-GCM) to restore history on Android & Web.",
    modules: "E2eeBackup.kt",
  },
  {
    num: "03",
    tag: "SECRET VAULT",
    title: "Hidden Chats with Secret Key Unlock",
    summary:
      "Hide any chat behind a custom free-form Secret Key. Hidden threads vanish from your inbox, mute all alerts, and reveal when you type the key in Search.",
    modules: "ChatListScreen.kt · SearchScreen.kt",
  },
  {
    num: "04",
    tag: "2.0S GESTURE",
    title: "Archived Chats & 2-Second Pull-to-Open Ring",
    summary:
      "Pull down from the top of your inbox for 2 seconds to fill the tactile progress ring and jump into Archived Chats, or archive/unarchive from the chat menu.",
    modules: "ArchiveList.kt · ChatListScreen.kt",
  },
  {
    num: "05",
    tag: "INBOX CONTROL",
    title: "Pin, Separate Call/Msg Mute, Multi-Select & Unread Privacy",
    summary:
      "Pin up to 3 top chats, mute messages or calls independently (1h, 8h, 24h, Forever), batch-select with rounded checkboxes, and mask unread previews.",
    modules: "ChatListScreen.kt · ChatPreviewText.kt",
  },
  {
    num: "06",
    tag: "3D FX & REPLY",
    title: "Swipe-to-Reply, Bare Emoji Reactions & 3D Lottie Emoji Burst FX",
    summary:
      "Swipe any message or photo to quote-reply, react with bare emojis, and tap animated 3D Lottie emojis to trigger full-screen particle bursts on both phones.",
    modules: "MessageReplySwipePolicy.kt · EmojiAnim.kt · ChatFx.kt",
  },
  {
    num: "07",
    tag: "COMPOSER MAGIC",
    title: "Slash Commands (/magic), Markdown Formatting & @Mentions",
    summary:
      "Send floating wave animations with /magic, format text with bold/italic/code/strikethrough markup, and autocomplete @mentions in groups.",
    modules: "ComposerCommands.kt · MagicMessageEffect.kt · MessageMarkup.kt",
  },
  {
    num: "08",
    tag: "TIMERS & SCHEDULE",
    title: "Disappearing Messages, Scheduled Delivery & Permanent Delete",
    summary:
      "Set per-chat auto-expiry timers (24h, 7d, 30d), schedule messages for future Dhaka delivery, and permanently delete messages for everyone with particle FX.",
    modules: "Reminders.kt · DeleteAnim.kt · ChatScreen.kt",
  },
  {
    num: "09",
    tag: "CUSTOMIZATION",
    title: "Conversation Nicknames & 5 Custom Per-Chat Themes",
    summary:
      "Assign custom nicknames inside any conversation and style each chat with Classic, Ocean, Forest, Sunset, or Midnight wallpapers.",
    modules: "ConversationNicknamesSheet.kt · Theme.kt",
  },
  {
    num: "10",
    tag: "1× MEDIA STUDIO",
    title: "View-Once (1×) Media & Built-in Photo/Video Crop, Draw & Trim Editor",
    summary:
      "Send 1× photos, videos, and voice notes that auto-wipe from R2 on first view, plus edit photos (crop, draw, text) and trim videos with an accidental-exit gate.",
    modules: "ViewOnceIcon.kt · MediaEditScreen.kt · CropTrimKit.kt · AttachmentExitGate.kt",
  },
  {
    num: "11",
    tag: "AUDIO & STICKERS",
    title: "Waveform Voice Notes (1×/1.5×/2×), 1,150+ Stickers & GIF Picker",
    summary:
      "Hold mic to record (slide to lock or cancel), scrub interactive waveforms at 1×/1.5×/2× speed with earpiece routing, and send 1,150+ stickers & GIFs.",
    modules: "VoiceNote.kt · AudioRouter.kt · StickerSheet.kt · GifRepo.kt",
  },
  {
    num: "12",
    tag: "5 GB FILES & DOCS",
    title: "Up to 5 GB Resumable Multipart Uploads & Built-in Document Viewer",
    summary:
      "8 MB chunked multipart uploads to Cloudflare R2 (up to 5 GB docs, 2 GB videos, 100 MB photos/audio) with in-app PDF, code, CSV, Markdown & TIFF preview.",
    modules: "Files.kt · DocViewerScreen.kt · ChatMediaScreen.kt · TiffDecoder.kt",
  },
  {
    num: "13",
    tag: "WEBRTC + SCREEN",
    title: "1:1 E2EE Audio/Video Calls, Live Screen Share + System Audio & Voice Isolation",
    summary:
      "DTLS-SRTP calls with 5-layer ring delivery, live Screen Sharing with System Audio Tap for gaming, Voice Isolation noise suppression, and minimized call timer banner.",
    modules: "CallEngine.kt · KpScreenCapturer.kt · SystemAudioTap.kt · VoiceIsolation.kt",
  },
  {
    num: "14",
    tag: "24H STORIES",
    title: "24-Hour Status Stories with Video Trim, Status Rings & Quote Replies",
    summary:
      "Post 24h photo, trimmed video, or styled text stories with unseen/viewed avatar rings, hold-to-pause, emoji reactions, viewer list, and chat quote replies.",
    modules: "StatusScreens.kt · StatusPickScreen.kt · VideoExport.kt",
  },
  {
    num: "15",
    tag: "GROUPS & SHIELD",
    title: "Group Chats, Private Profile (FLAG_SECURE Screenshot Block) & Block/Unblock",
    summary:
      "Create groups with member & theme controls, enable Private Profile to hardware-block screenshots/recording and media saves, or block/unblock peers.",
    modules: "CreateGroupScreen.kt · GroupInfoScreen.kt · KpSecure.kt · ProfileScreen.kt",
  },
  {
    num: "16",
    tag: "AUTH & OTP",
    title: "SIM-Aware Phone Auth, Compact 6-Digit Approval OTP & Google Recovery",
    summary:
      "Passwordless E.164 login with compact 6-digit copyable approval OTP in the official chat, Google Identity lost-device recovery, and 1 Android + 1 Web session.",
    modules: "LoginScreen.kt · PhoneVerifier.kt · GoogleAuth.kt",
  },
  {
    num: "17",
    tag: "GEMINI AI & OTA",
    title: "Verified KuchuPuchu Gemini AI, Launcher Camera, Shortcuts & In-App OTA Updater",
    summary:
      "Chat with verified KuchuPuchu AI (Google Gemini) in Bangla/Banglish/English with session history, plus Launcher Camera, Share Sheet intake, and R2 OTA APK updates.",
    modules: "AIHistoryScreen.kt · LauncherCameraScreen.kt · ShareIntake.kt · KpUpdate.kt",
  },
];

export function SkeuomorphicPhoneTrio() {
  return (
    <section className="kp-skeuo-showcase" aria-labelledby="kp-skeuo-heading">
      <div className="kp-section-head">
        <p className="eyebrow">3D SKEUOMORPHIC INTERACTIVE CONTROLS</p>
        <h2 id="kp-skeuo-heading">Tactile 3D surfaces built for privacy &amp; speed</h2>
        <p className="kp-section-sub">
          Sculpted dark-blue 3D cards, recessed input wells, tactile keypads, and circular gesture
          gauges across every screen.
        </p>
      </div>

      <div className="kp-phone-trio">
        {/* Phone 1: Hide & Unhide Secret Vault */}
        <article className="kp-phone-device" aria-label="Hide and Unhide Secret Chats showcase">
          <div className="kp-phone-device__top">
            <span className="kp-skeuo-icon-btn" aria-hidden="true">
              ←
            </span>
            <span className="kp-skeuo-pill-badge">Secret Vault</span>
          </div>

          <div className="kp-sculpt-row" aria-hidden="true">
            <div className="kp-sculpt-shape kp-sculpt-shape--circle" />
            <div className="kp-sculpt-shape kp-sculpt-shape--rect">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                <path
                  d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.7 10.7 0 0112 5c5 0 9.3 3.1 11 7.5a11.8 11.8 0 01-4.3 5.2M6.6 6.6C4.3 8.1 2.5 10.1 1 12.5c1.7 4.4 6 7.5 11 7.5 1.8 0 3.5-.4 5-1.1"
                  stroke="#60a5fa"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="kp-sculpt-shape kp-sculpt-shape--tri" />
          </div>

          <div className="kp-phone-mini-list" aria-hidden="true">
            <div className="kp-phone-mini-row kp-phone-mini-row--raised">
              <span className="kp-mini-avatar">R</span>
              <div className="kp-mini-meta">
                <strong>Rahi · Secret Key Set</strong>
                <span>Long-press → Hide chat (Key: 7788)</span>
              </div>
              <span className="kp-mini-tag">Hidden</span>
            </div>
            <div className="kp-phone-mini-row kp-phone-mini-row--inset">
              <span className="kp-mini-avatar kp-mini-avatar--teal">S</span>
              <div className="kp-mini-meta">
                <strong>Search Secret Key or ⋮ Menu</strong>
                <span>Type key in Search or open Hidden chats</span>
              </div>
              <span className="kp-mini-tag kp-mini-tag--bright">Unhide</span>
            </div>
          </div>

          <h3 className="kp-phone-device__title">Hide &amp; Unhide Chats</h3>
          <p className="kp-phone-device__copy">
            Lock private threads behind a custom Secret Key with zero lock-screen alerts, and reveal
            them anytime via Search or Hidden Vault.
          </p>
          <div className="kp-skeuo-cta-pill" aria-hidden="true">
            Secret Key Vault Ready
          </div>
        </article>

        {/* Phone 2: Passcode & Compact OTP Lock */}
        <article
          className="kp-phone-device kp-phone-device--center"
          aria-label="Compact Login Approval OTP showcase"
        >
          <div className="kp-phone-device__top">
            <span className="kp-skeuo-icon-btn" aria-hidden="true">
              ←
            </span>
            <span className="kp-skeuo-icon-btn kp-skeuo-icon-btn--glow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <path
                  d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                  stroke="#60a5fa"
                  strokeWidth="2"
                />
                <circle cx="12" cy="12" r="3" fill="#60a5fa" />
              </svg>
            </span>
            <span className="kp-skeuo-pill-badge">KP1 + OTP</span>
          </div>

          <h3 className="kp-phone-device__title kp-phone-device__title--top">
            Passcode &amp; Compact OTP
          </h3>
          <p className="kp-phone-device__sub">Official KuchuPuchu login approval code</p>

          <div className="kp-otp-well" aria-hidden="true">
            <span className="kp-otp-well__label">COMPACT 6-DIGIT APPROVAL CODE</span>
            <div className="kp-otp-well__row">
              <span className="kp-otp-well__digits">4 · 8 · 2 · 9 · 1 · 0</span>
              <span className="kp-otp-well__copy">Copy</span>
            </div>
          </div>

          <div className="kp-otp-meta" aria-hidden="true">
            <span>APPROVE IN APP</span>
            <span>00:45</span>
          </div>

          <div className="kp-keypad" aria-hidden="true">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span className="kp-keypad__key--raised">5</span>
            <span>6</span>
            <span>7</span>
            <span>8</span>
            <span>9</span>
            <span className="kp-keypad__key--empty" />
            <span>0</span>
            <span className="kp-keypad__key--accent">✓</span>
          </div>
        </article>

        {/* Phone 3: 2s Pull-to-Archive Circular Gauge */}
        <article className="kp-phone-device" aria-label="Archive Chats 2-second pull showcase">
          <div className="kp-phone-device__top">
            <span className="kp-skeuo-icon-btn" aria-hidden="true">
              ←
            </span>
            <span className="kp-skeuo-pill-badge">2.0s Hold</span>
          </div>

          <div className="kp-gauge-wrap" aria-hidden="true">
            <div className="kp-gauge-ring">
              <svg viewBox="0 0 140 140" className="kp-gauge-svg">
                <circle cx="70" cy="70" r="54" className="kp-gauge-track" />
                <circle cx="70" cy="70" r="54" className="kp-gauge-fill" />
              </svg>
              <div className="kp-gauge-center">
                <strong>100%</strong>
                <span>2.0s Pull &amp; Hold</span>
              </div>
            </div>
          </div>

          <h3 className="kp-phone-device__title">Pull-to-Archive Drawer</h3>
          <p className="kp-phone-device__copy">
            Pull down from the top of your inbox for 2 seconds to fill the tactile ring and open
            Archived Chats, or long-press any thread to archive.
          </p>
          <div className="kp-carousel-dots" aria-hidden="true">
            <i className="is-active" />
            <i />
            <i />
          </div>
          <div className="kp-skeuo-cta-pill" aria-hidden="true">
            Open Archived Chats
          </div>
        </article>
      </div>
    </section>
  );
}

export function AndroidMasterFeatureGrid() {
  return (
    <section className="kp-master-grid-section" aria-labelledby="kp-master-grid-heading">
      <div className="kp-section-head">
        <p className="eyebrow">COMPLETE ANDROID APP FEATURE INVENTORY (17 PILLARS)</p>
        <h2 id="kp-master-grid-heading">Every feature built into KuchuPuchu Android &amp; Web</h2>
        <p className="kp-section-sub">
          All 17 feature modules from the native Android app (v282 / 3.9.205) and Cloudflare Worker
          edge platform — sculpted in 3D Skeuomorphism.
        </p>
      </div>

      <div className="kp-master-grid">
        {ANDROID_APP_FEATURES.map((item) => (
          <article key={item.num} className="kp-master-card">
            <div className="kp-master-card__top">
              <span className="kp-master-card__num">{item.num}</span>
              <span className="kp-master-card__tag">{item.tag}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <span className="kp-master-card__modules">{item.modules}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AllAndroidFeatureBanners({
  category = "all",
  heading = "Visual Feature & How-To Banners",
  subheading = "Step-by-step 3D Skeuomorphic visual banners for hiding chats, archiving with the 2s pull gesture, swipe-to-reply, 3D emoji FX, /magic commands, disappearing timers, view-once studio, 5 GB files, screen-share calls, 24h stories, and Gemini AI.",
}: {
  category?: FeatureBannerCategory;
  heading?: string;
  subheading?: string;
}) {
  const show = (cats: FeatureBannerCategory[]) =>
    category === "all" ||
    category === "overview" ||
    category === "features" ||
    cats.includes(category);

  return (
    <section className="kp-feature-banners" aria-label={heading}>
      <div className="kp-section-head">
        <p className="eyebrow">VISUAL FEATURE BANNERS &amp; STEP-BY-STEP GUIDES</p>
        <h2>{heading}</h2>
        <p className="kp-section-sub">{subheading}</p>
      </div>

      {/* BANNER 1: How to Hide & Unhide Secret Chats */}
      {show(["encryption", "faq", "legal"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 01 · SECRET CHAT VAULT</span>
            <h3>How to Hide &amp; Unhide Secret Chats</h3>
            <p>
              Keep sensitive conversations completely invisible in your main inbox while preserving
              every KP1 encrypted message, voice note, and attachment.
            </p>
            <ol className="kp-step-list">
              <li>
                <strong>Set a Secret Key &amp; Hide:</strong> Long-press any conversation row in
                your inbox (or open the peer profile / top-right <code>⋮</code> menu), choose{" "}
                <strong>Hide chat</strong>, and assign your free-form Secret Key.
              </li>
              <li>
                <strong>Zero inbox &amp; lock-screen trace:</strong> Hidden conversations vanish
                from your chat list and suppress all lock-screen notification banners and sounds.
              </li>
              <li>
                <strong>Reveal via Search or Unhide anytime:</strong> Type your exact{" "}
                <strong>Secret Key</strong> into the Search bar to reveal the thread, or open the
                home <code>⋮</code> menu → <strong>Hidden chats</strong> → tap{" "}
                <strong>Unhide</strong>.
              </li>
            </ol>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="30" y="32" width="175" height="62" rx="14" fill="#182846" stroke="#3b82f6" />
              <circle cx="56" cy="63" r="16" fill="#2563eb" />
              <text x="51" y="68" fill="#ffffff" fontSize="13" fontWeight="700">
                R
              </text>
              <text x="80" y="57" fill="#f0f5ff" fontSize="12" fontWeight="700">
                Rahi · Secret Key
              </text>
              <text x="80" y="75" fill="#93c5fd" fontSize="10">
                Long-press → Hide chat
              </text>
              <path d="M212 63 H236" stroke="#60a5fa" strokeWidth="2.5" strokeDasharray="4 4" />
              <rect
                x="244"
                y="32"
                width="146"
                height="62"
                rx="14"
                fill="#0b1426"
                stroke="#4f8ff7"
              />
              <text x="262" y="56" fill="#60a5fa" fontSize="10" fontWeight="700">
                HIDDEN VAULT
              </text>
              <text x="262" y="74" fill="#e2ecff" fontSize="12" fontWeight="700">
                Locked &amp; Muted
              </text>
              <rect
                x="30"
                y="112"
                width="360"
                height="104"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="48" y="136" fill="#93c5fd" fontSize="10" fontWeight="700">
                HOW TO REVEAL OR UNHIDE SECRET CHATS
              </text>
              <rect
                x="48"
                y="148"
                width="104"
                height="48"
                rx="10"
                fill="#0d172a"
                stroke="#2b446e"
              />
              <text x="58" y="170" fill="#dbeafe" fontSize="10" fontWeight="600">
                1. Type Secret Key
              </text>
              <text x="58" y="184" fill="#93a2be" fontSize="9">
                in Search bar
              </text>
              <rect
                x="164"
                y="148"
                width="104"
                height="48"
                rx="10"
                fill="#0d172a"
                stroke="#2b446e"
              />
              <text x="174" y="170" fill="#dbeafe" fontSize="10" fontWeight="600">
                2. Or Tap ⋮ Menu
              </text>
              <text x="174" y="184" fill="#93a2be" fontSize="9">
                → Hidden chats
              </text>
              <rect x="280" y="148" width="92" height="48" rx="10" fill="#2563eb" />
              <text x="296" y="176" fill="#ffffff" fontSize="11" fontWeight="700">
                3. Unhide ✓
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 2: How to Archive Chats & 2-Second Pull Gesture */}
      {show(["faq"]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 02 · ARCHIVE DRAWER &amp; 2S GESTURE</span>
            <h3>How to Archive Chats &amp; Use the 2-Second Pull Gesture</h3>
            <p>
              Declutter your primary chat list by moving low-priority or inactive threads into the
              Archived drawer without losing a single message.
            </p>
            <ol className="kp-step-list">
              <li>
                <strong>Archive any chat:</strong> Long-press any conversation (or open its{" "}
                <code>⋮</code> menu) and select <strong>Archive chat</strong>.
              </li>
              <li>
                <strong>2-second pull-and-hold gesture:</strong> Pull down from the top of your chat
                list and hold for <strong>2 seconds</strong> — watch the 3D circular progress ring
                fill to 100% to jump straight into <strong>Archived Chats</strong>.
              </li>
              <li>
                <strong>One-tap Unarchive:</strong> Open the Archived drawer and tap{" "}
                <strong>Unarchive</strong> on any thread to return it to your main inbox.
              </li>
            </ol>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <circle cx="96" cy="125" r="56" fill="#0b1426" stroke="#23385c" strokeWidth="10" />
              <circle
                cx="96"
                cy="125"
                r="56"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="10"
                strokeDasharray="285 360"
                strokeLinecap="round"
              />
              <text x="72" y="122" fill="#ffffff" fontSize="18" fontWeight="800">
                2.0s
              </text>
              <text x="64" y="140" fill="#93c5fd" fontSize="10" fontWeight="700">
                PULL &amp; HOLD
              </text>
              <rect
                x="182"
                y="42"
                width="202"
                height="48"
                rx="12"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="200" y="71" fill="#ffffff" fontSize="12" fontWeight="700">
                Archived Chats (4) · Open →
              </text>
              <rect
                x="182"
                y="102"
                width="202"
                height="48"
                rx="12"
                fill="#15223b"
                stroke="#2b426b"
              />
              <circle cx="206" cy="126" r="12" fill="#2563eb" />
              <text x="202" y="130" fill="#ffffff" fontSize="10" fontWeight="700">
                S
              </text>
              <text x="226" y="123" fill="#e2ecff" fontSize="11" fontWeight="700">
                Squad Group
              </text>
              <text x="226" y="138" fill="#93c5fd" fontSize="9.5">
                Muted · Tap Unarchive
              </text>
              <rect
                x="182"
                y="160"
                width="202"
                height="48"
                rx="12"
                fill="#15223b"
                stroke="#2b426b"
              />
              <circle cx="206" cy="184" r="12" fill="#1d4ed8" />
              <text x="202" y="188" fill="#ffffff" fontSize="10" fontWeight="700">
                A
              </text>
              <text x="226" y="181" fill="#e2ecff" fontSize="11" fontWeight="700">
                Amina
              </text>
              <text x="226" y="196" fill="#93c5fd" fontSize="9.5">
                Archived · History intact
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 3: Inbox Pin, Mute, Multi-Select & Unread Privacy */}
      {show(["faq"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 03 · SMART INBOX &amp; UNREAD PRIVACY</span>
            <h3>Pin Top Chats, Independent Call/Msg Mute &amp; Masked Unread Previews</h3>
            <p>
              Organize your inbox with long-press bottom sheets, rounded multi-select checkboxes,
              and privacy-first unread message masking.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Pin &amp; Multi-Select:</strong> Long-press any chat row to{" "}
                <strong>Pin</strong> priority conversations to the top, batch-select multiple rows
                with rounded checkboxes, or create a group immediately.
              </li>
              <li>
                <strong>Separate Message &amp; Call Mute:</strong> Mute notifications for{" "}
                <strong>1 hour, 8 hours, 24 hours, or Forever</strong> with independent toggles for
                chat messages (`muted_msg`) and incoming calls (`muted_call`).
              </li>
              <li>
                <strong>Unread Preview Privacy:</strong> Unread threads mask message text behind a
                category/count badge until you open the conversation.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="32" y="32" width="356" height="54" rx="14" fill="#182846" stroke="#3b82f6" />
              <rect x="48" y="49" width="20" height="20" rx="6" fill="#2563eb" />
              <text x="54" y="63" fill="#ffffff" fontSize="12" fontWeight="800">
                ✓
              </text>
              <text x="80" y="56" fill="#ffffff" fontSize="12" fontWeight="700">
                Rahi · Pinned to Top
              </text>
              <text x="80" y="72" fill="#93c5fd" fontSize="10">
                2 new messages · Unread content masked
              </text>
              <rect x="314" y="46" width="58" height="24" rx="12" fill="#0d172a" />
              <text x="326" y="62" fill="#60a5fa" fontSize="10" fontWeight="700">
                PINNED
              </text>
              <rect x="32" y="98" width="356" height="54" rx="14" fill="#15233d" stroke="#2c446e" />
              <text x="52" y="122" fill="#e2ecff" fontSize="12" fontWeight="700">
                Mute Options: 1h · 8h · 24h · Forever
              </text>
              <text x="52" y="138" fill="#93c5fd" fontSize="10">
                Independent toggles: Mute Messages | Mute Calls
              </text>
              <rect
                x="32"
                y="164"
                width="356"
                height="52"
                rx="14"
                fill="#0b1426"
                stroke="#2c446e"
              />
              <text x="52" y="194" fill="#93c5fd" fontSize="11" fontWeight="700">
                Long-Press Sheet: Pin · Mute · Hide · Archive · Select · Delete
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 4: Swipe-to-Reply, Reactions, 3D Lottie Emoji FX & /magic */}
      {show(["faq"]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 04 · EXPRESSIVE CHAT &amp; 3D EMOJI FX</span>
            <h3>
              Swipe-to-Reply, Bare Emoji Reactions, 3D Lottie Emojis &amp; <code>/magic</code> Slash
              Commands
            </h3>
            <p>
              Every conversation is tactile and alive with gesture replies, synchronized 3D emoji
              bursts, and live text formatting.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Swipe-to-Reply &amp; Bare Reactions:</strong> Swipe right on any text,
                photo, or voice bubble to quote-reply, or long-press to react with any emoji.
              </li>
              <li>
                <strong>3D Lottie Animated Emojis &amp; Tap-to-Replay Burst:</strong> Single,
                double, and triple emoji messages animate in 3D; tap the emoji to trigger a
                synchronized full-screen particle burst on both devices.
              </li>
              <li>
                <strong>
                  <code>/magic</code> &amp; Rich Markup:
                </strong>{" "}
                Type <code>/magic</code> for floating wave text, use <code>*bold*</code>,{" "}
                <code>_italic_</code>, <code>~strike~</code>, and <code>`code`</code>, or tag{" "}
                <code>@mentions</code> in groups.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="32" y="34" width="235" height="56" rx="14" fill="#182846" stroke="#3b82f6" />
              <text x="48" y="56" fill="#93c5fd" fontSize="9.5" fontWeight="700">
                ↪ SWIPE RIGHT TO QUOTE-REPLY
              </text>
              <text x="48" y="75" fill="#ffffff" fontSize="12" fontWeight="700">
                Dropping into Free Fire lobby at 9 PM!
              </text>
              <rect x="234" y="74" width="44" height="22" rx="11" fill="#2563eb" />
              <text x="244" y="89" fill="#ffffff" fontSize="11">
                🔥 2
              </text>
              <rect
                x="286"
                y="34"
                width="102"
                height="96"
                rx="18"
                fill="#0b1426"
                stroke="#4f8ff7"
              />
              <text x="322" y="78" fontSize="28">
                🎉
              </text>
              <text x="300" y="102" fill="#ffffff" fontSize="10" fontWeight="700">
                3D Lottie FX
              </text>
              <text x="302" y="116" fill="#93c5fd" fontSize="9">
                Tap for burst
              </text>
              <rect
                x="32"
                y="144"
                width="356"
                height="72"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="50" y="170" fill="#60a5fa" fontSize="11" fontWeight="700">
                /magic · Floating Animated Wave Bubble + @mentions
              </text>
              <text x="50" y="192" fill="#e2ecff" fontSize="11">
                Supports *bold*, _italic_, ~strikethrough~, and `inline code`
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 5: Disappearing Messages, Scheduled Delivery & Permanent Delete */}
      {show(["faq"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER 05 · TIMERS, SCHEDULING &amp; CLEAN DELETE
            </span>
            <h3>
              Disappearing Timers, Scheduled Messages (Dhaka Time) &amp; Permanent Delete for
              Everyone
            </h3>
            <p>
              Control the exact lifetime and delivery schedule of your messages with server-enforced
              timers and zero-trace deletion.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Disappearing Message Timers:</strong> Set any conversation to auto-expire
                messages after <strong>24 hours, 7 days, or 30 days</strong>, swept every minute by
                the Cloudflare Worker cron.
              </li>
              <li>
                <strong>Scheduled Messages:</strong> Write messages ahead of time and queue them in{" "}
                <code>scheduled_messages</code> for automatic delivery at your chosen Dhaka time.
              </li>
              <li>
                <strong>Permanent Delete for Everyone:</strong> Remove any message in 1:1 chats for
                both participants with a particle disintegration animation and no lingering
                &ldquo;Deleted&rdquo; or &ldquo;Edited&rdquo; banner.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect
                x="30"
                y="36"
                width="112"
                height="178"
                rx="16"
                fill="#0b1426"
                stroke="#3b82f6"
              />
              <text x="44" y="66" fill="#60a5fa" fontSize="10" fontWeight="700">
                AUTO-EXPIRE
              </text>
              <text x="44" y="96" fill="#ffffff" fontSize="15" fontWeight="800">
                24 Hours
              </text>
              <text x="44" y="122" fill="#dbeafe" fontSize="13" fontWeight="700">
                7 Days
              </text>
              <text x="44" y="148" fill="#dbeafe" fontSize="13" fontWeight="700">
                30 Days
              </text>
              <text x="44" y="186" fill="#93c5fd" fontSize="9.5">
                Worker Cron Sweep
              </text>
              <rect
                x="154"
                y="36"
                width="236"
                height="82"
                rx="16"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="172" y="62" fill="#93c5fd" fontSize="10" fontWeight="700">
                SCHEDULED MESSAGE · ASIA/DHAKA
              </text>
              <text x="172" y="84" fill="#ffffff" fontSize="12" fontWeight="700">
                Sends automatically at 10:30 PM
              </text>
              <text x="172" y="102" fill="#93c5fd" fontSize="10">
                Delivered even if your phone is offline
              </text>
              <rect
                x="154"
                y="132"
                width="236"
                height="82"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="172" y="158" fill="#60a5fa" fontSize="10" fontWeight="700">
                PERMANENT DELETE FOR EVERYONE
              </text>
              <text x="172" y="180" fill="#ffffff" fontSize="12" fontWeight="700">
                Particle Disintegration FX
              </text>
              <text x="172" y="198" fill="#93c5fd" fontSize="10">
                Vanishes cleanly · No &ldquo;Edited&rdquo; trail
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 6: Conversation Nicknames & 5 Custom Per-Chat Themes */}
      {show([]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 06 · NICKNAMES &amp; 5 CHAT THEMES</span>
            <h3>
              Custom Conversation Nicknames &amp; 5 Per-Chat Themes (Classic, Ocean, Forest, Sunset,
              Midnight)
            </h3>
            <p>
              Personalize every 1:1 and group conversation with custom nicknames and distinct
              per-chat gradient wallpapers synced across Android and Web.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Conversation Nicknames:</strong> Open the chat info sheet to set custom
                display nicknames for yourself and your peer inside that specific thread.
              </li>
              <li>
                <strong>5 Per-Chat Wallpapers:</strong> Switch any chat between{" "}
                <strong>Classic, Ocean, Forest, Sunset, and Midnight</strong> themes — owner-locked
                in groups and instant in 1:1 chats.
              </li>
              <li>
                <strong>Tap-to-Reveal Timestamps:</strong> Keep transcripts compact by showing the
                latest status stamp by default and tapping any older bubble to inspect its exact
                delivery/read time.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="32" y="34" width="356" height="58" rx="14" fill="#182846" stroke="#3b82f6" />
              <text x="50" y="58" fill="#93c5fd" fontSize="10" fontWeight="700">
                CONVERSATION NICKNAMES SHEET
              </text>
              <text x="50" y="77" fill="#ffffff" fontSize="12" fontWeight="700">
                Rahi → &ldquo;Squad Captain&rdquo; · Synced in Chat Header
              </text>
              <rect x="32" y="110" width="64" height="96" rx="14" fill="#1b3a6b" />
              <text x="44" y="164" fill="#ffffff" fontSize="10" fontWeight="700">
                Classic
              </text>
              <rect x="105" y="110" width="64" height="96" rx="14" fill="#0e4f6e" />
              <text x="119" y="164" fill="#ffffff" fontSize="10" fontWeight="700">
                Ocean
              </text>
              <rect x="178" y="110" width="64" height="96" rx="14" fill="#14532d" />
              <text x="192" y="164" fill="#ffffff" fontSize="10" fontWeight="700">
                Forest
              </text>
              <rect x="251" y="110" width="64" height="96" rx="14" fill="#7c2d12" />
              <text x="264" y="164" fill="#ffffff" fontSize="10" fontWeight="700">
                Sunset
              </text>
              <rect x="324" y="110" width="64" height="96" rx="14" fill="#1e1b4b" />
              <text x="333" y="164" fill="#ffffff" fontSize="10" fontWeight="700">
                Midnight
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 7: View-Once (1x) Media & Built-in Photo/Video Editor */}
      {show(["encryption"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 07 · VIEW-ONCE (1×) &amp; MEDIA STUDIO</span>
            <h3>View-Once (1×) Self-Destructing Media &amp; Built-in Photo/Video Editor</h3>
            <p>
              Edit photos and videos right inside KuchuPuchu before sending, or mark sensitive media
              as View-Once (`1×`) so the server deletes the bytes on first open.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Server-Enforced View-Once (`1×`):</strong> Send photos, videos, voice notes,
                or text as <code>1×</code> — the Cloudflare Worker spends the token on first fetch
                and deletes the R2 object immediately.
              </li>
              <li>
                <strong>Built-in Photo &amp; Video Editor:</strong> Crop, rotate, draw freehand
                annotations, place text overlays on photos, and trim video clips (with a 1-minute
                smart default) before upload.
              </li>
              <li>
                <strong>Attachment Exit Gate:</strong> A protective bottom-sheet confirmation guards
                your edited media batch against accidental Back gestures.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect
                x="30"
                y="34"
                width="172"
                height="182"
                rx="18"
                fill="#0b1426"
                stroke="#3b82f6"
              />
              <circle cx="116" cy="96" r="34" fill="#182846" stroke="#60a5fa" strokeWidth="2.5" />
              <text x="103" y="103" fill="#ffffff" fontSize="20" fontWeight="800">
                1×
              </text>
              <text x="52" y="154" fill="#ffffff" fontSize="12" fontWeight="700">
                View-Once Media
              </text>
              <text x="48" y="174" fill="#93c5fd" fontSize="10">
                Wiped from R2 on fetch
              </text>
              <rect
                x="218"
                y="34"
                width="172"
                height="84"
                rx="16"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="234" y="60" fill="#93c5fd" fontSize="10" fontWeight="700">
                PHOTO &amp; VIDEO STUDIO
              </text>
              <text x="234" y="80" fill="#ffffff" fontSize="12" fontWeight="700">
                Crop · Draw · Text · Trim
              </text>
              <text x="234" y="98" fill="#93c5fd" fontSize="10">
                JPEG q90 + 1-min Video Trim
              </text>
              <rect
                x="218"
                y="132"
                width="172"
                height="84"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="234" y="158" fill="#60a5fa" fontSize="10" fontWeight="700">
                ATTACHMENT EXIT GATE
              </text>
              <text x="234" y="178" fill="#ffffff" fontSize="11.5" fontWeight="700">
                Protects Unsent Edits
              </text>
              <text x="234" y="196" fill="#93c5fd" fontSize="10">
                Confirm sheet on Back press
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 8: Voice Notes, 1,150+ Stickers & Up to 5 GB Multipart File Sharing */}
      {show(["architecture"]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER 08 · VOICE NOTES, 1,150+ STICKERS &amp; 5 GB FILES
            </span>
            <h3>Waveform Voice Notes, 1,150+ Stickers &amp; Up to 5 GB Multipart File Uploads</h3>
            <p>
              Record crystal-clear voice notes with interactive waveform scrubbing, express yourself
              with 1,150+ stickers, and send massive files via Cloudflare R2 multipart uploads.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Interactive Voice Notes:</strong> Hold the mic button to record (slide left
                to cancel, slide up to lock hands-free), scrub the live waveform bar, and toggle{" "}
                <strong>1× / 1.5× / 2×</strong> playback speed with automatic earpiece routing.
              </li>
              <li>
                <strong>Up to 5 GB Multipart Uploads &amp; Doc Viewer:</strong> Upload up to{" "}
                <strong>5 GB documents, 2 GB videos, and 100 MB photos/audio</strong> in 8 MB
                resumable chunks, and preview PDFs, code, CSV, Markdown, and TIFF files in-app.
              </li>
              <li>
                <strong>1,150+ Stickers &amp; GIFs:</strong> Instant sticker pack browser and GIF
                sheet built right into the composer pill.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="30" y="32" width="360" height="62" rx="16" fill="#182846" stroke="#3b82f6" />
              <circle cx="58" cy="63" r="16" fill="#2563eb" />
              <text x="53" y="68" fill="#ffffff" fontSize="12" fontWeight="800">
                ▶
              </text>
              <rect x="86" y="54" width="6" height="18" rx="3" fill="#60a5fa" />
              <rect x="98" y="46" width="6" height="34" rx="3" fill="#60a5fa" />
              <rect x="110" y="52" width="6" height="22" rx="3" fill="#60a5fa" />
              <rect x="122" y="42" width="6" height="42" rx="3" fill="#3b82f6" />
              <rect x="134" y="50" width="6" height="26" rx="3" fill="#3b82f6" />
              <rect x="146" y="56" width="6" height="14" rx="3" fill="#93c5fd" />
              <text x="170" y="60" fill="#ffffff" fontSize="11.5" fontWeight="700">
                Voice Note · Waveform Scrubber
              </text>
              <text x="170" y="76" fill="#93c5fd" fontSize="10">
                Hold-to-Record · Earpiece Routing
              </text>
              <rect x="334" y="50" width="42" height="26" rx="8" fill="#0b1426" />
              <text x="343" y="67" fill="#60a5fa" fontSize="10" fontWeight="700">
                1.5×
              </text>
              <rect
                x="30"
                y="108"
                width="174"
                height="108"
                rx="16"
                fill="#0b1426"
                stroke="#3b82f6"
              />
              <text x="46" y="136" fill="#60a5fa" fontSize="10" fontWeight="700">
                R2 MULTIPART (8 MB PARTS)
              </text>
              <text x="46" y="158" fill="#ffffff" fontSize="13" fontWeight="800">
                5 GB Docs · 2 GB Video
              </text>
              <text x="46" y="178" fill="#93c5fd" fontSize="10">
                In-App PDF, Code, CSV &amp; TIFF
              </text>
              <text x="46" y="196" fill="#93c5fd" fontSize="10">
                Shared Media / Docs / Links
              </text>
              <rect
                x="216"
                y="108"
                width="174"
                height="108"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="232" y="136" fill="#60a5fa" fontSize="10" fontWeight="700">
                STICKER &amp; GIF STUDIO
              </text>
              <text x="232" y="158" fill="#ffffff" fontSize="13" fontWeight="800">
                1,150+ Stickers &amp; GIFs
              </text>
              <text x="232" y="178" fill="#93c5fd" fontSize="10">
                Instant Composer Picker
              </text>
              <text x="232" y="196" fill="#93c5fd" fontSize="10">
                Zero-lag WebP &amp; Animated Packs
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 9: 1:1 WebRTC Calls, Screen Share + System Audio & Voice Isolation */}
      {show(["architecture", "encryption"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER 09 · 1:1 WEBRTC CALLS &amp; LIVE SCREEN SHARE
            </span>
            <h3>1:1 HD Audio/Video Calls, Screen Share with System Audio &amp; Voice Isolation</h3>
            <p>
              Engineered for gamers and everyday calling with DTLS-SRTP encryption, 5-layer ring
              delivery, and live screen + game audio streaming.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Live Screen Share + System Audio Tap:</strong> Share your phone screen and
                internal game/media audio live during a call (`KpScreenCapturer.kt`,{" "}
                `SystemAudioTap.kt`).
              </li>
              <li>
                <strong>Voice Isolation &amp; Smart Audio Routing:</strong> Hardware/DSP noise
                suppression (`VoiceIsolation.kt`) and seamless Bluetooth, speaker, and earpiece
                switching with profile avatars on every call screen.
              </li>
              <li>
                <strong>5-Layer Ring Delivery &amp; Call Minimize Banner:</strong> Combines
                WebSocket DO, high-priority FCM, TelecomManager, and relay polling; press Back to
                minimize into a floating Return-to-Call timer bar.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect
                x="30"
                y="32"
                width="166"
                height="186"
                rx="20"
                fill="#162644"
                stroke="#3b82f6"
              />
              <circle cx="113" cy="82" r="26" fill="#2563eb" stroke="#93c5fd" strokeWidth="2" />
              <text x="106" y="89" fill="#ffffff" fontSize="16" fontWeight="800">
                R
              </text>
              <text x="68" y="128" fill="#ffffff" fontSize="12.5" fontWeight="700">
                Rahi · HD Call
              </text>
              <text x="62" y="145" fill="#93c5fd" fontSize="10">
                08:42 · DTLS-SRTP E2EE
              </text>
              <circle cx="76" cy="182" r="14" fill="#1e3a6d" />
              <circle cx="113" cy="182" r="14" fill="#2563eb" />
              <circle cx="150" cy="182" r="14" fill="#dc2626" />
              <rect
                x="212"
                y="32"
                width="178"
                height="86"
                rx="16"
                fill="#0b1426"
                stroke="#3b82f6"
              />
              <text x="228" y="58" fill="#60a5fa" fontSize="10" fontWeight="700">
                SCREEN SHARE + SYSTEM AUDIO
              </text>
              <text x="228" y="78" fill="#ffffff" fontSize="12" fontWeight="700">
                Stream Free Fire &amp; Audio
              </text>
              <text x="228" y="96" fill="#93c5fd" fontSize="10">
                KpScreenCapturer + SystemAudioTap
              </text>
              <rect
                x="212"
                y="132"
                width="178"
                height="86"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="228" y="158" fill="#60a5fa" fontSize="10" fontWeight="700">
                VOICE ISOLATION + 5-LAYER RING
              </text>
              <text x="228" y="178" fill="#ffffff" fontSize="12" fontWeight="700">
                Noise Cancel &amp; Telecom UI
              </text>
              <text x="228" y="196" fill="#93c5fd" fontSize="10">
                Floating Return-to-Call Timer
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 10: 24-Hour Status Stories */}
      {show([]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">BANNER 10 · 24-HOUR STATUS STORIES</span>
            <h3>
              24-Hour Status Stories with Video Crop/Trim, Avatar Rings, Reactions &amp; Viewer List
            </h3>
            <p>
              Share ephemeral moments that automatically vanish after 24 hours, with rich viewer
              analytics and one-tap quote replies into encrypted chat.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Photo, Trimmed Video &amp; Styled Text Stories:</strong> Post photos,
                cropped/trimmed videos (first-minute smart default), or custom-background text
                cards.
              </li>
              <li>
                <strong>Unseen Status Rings &amp; Hold-to-Pause:</strong> Avatars light up with a
                dark-blue ring for unseen updates (gray once viewed); hold to pause the 5-second
                timer and release to resume.
              </li>
              <li>
                <strong>Viewer Sheet &amp; Quote Replies:</strong> Inspect who viewed your story and
                their emoji reactions in the Viewer Sheet, or reply directly into your 1:1 chat.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <circle
                cx="96"
                cy="125"
                r="52"
                fill="#162644"
                stroke="#3b82f6"
                strokeWidth="4"
                strokeDasharray="96 10"
              />
              <text x="86" y="132" fill="#ffffff" fontSize="22" fontWeight="800">
                R
              </text>
              <text x="54" y="200" fill="#93c5fd" fontSize="10.5" fontWeight="700">
                Unseen Status Ring
              </text>
              <rect
                x="178"
                y="36"
                width="210"
                height="82"
                rx="16"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="196" y="62" fill="#93c5fd" fontSize="10" fontWeight="700">
                24H PHOTO · VIDEO · TEXT
              </text>
              <text x="196" y="82" fill="#ffffff" fontSize="12" fontWeight="700">
                5s Auto-Advance · Hold to Pause
              </text>
              <text x="196" y="100" fill="#93c5fd" fontSize="10">
                Auto-swept by Worker after 24 hours
              </text>
              <rect
                x="178"
                y="132"
                width="210"
                height="82"
                rx="16"
                fill="#0b1426"
                stroke="#2c446e"
              />
              <text x="196" y="158" fill="#60a5fa" fontSize="10" fontWeight="700">
                VIEWERS &amp; QUICK REACTIONS
              </text>
              <text x="196" y="178" fill="#ffffff" fontSize="12" fontWeight="700">
                ❤️ 🔥 👏 Reactions + Quote Chip
              </text>
              <text x="196" y="196" fill="#93c5fd" fontSize="10">
                Reactions land in Viewer Sheet
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 11: Groups, Private Profile (FLAG_SECURE) & Verified Gemini AI */}
      {show(["encryption", "architecture"]) && (
        <article className="kp-feature-banner">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER 11 · GROUPS, FLAG_SECURE SHIELD &amp; GEMINI AI
            </span>
            <h3>
              Group Chats, Private Profile (<code>FLAG_SECURE</code>) &amp; Verified KuchuPuchu
              Gemini AI
            </h3>
            <p>
              Collaborate in multi-member groups, hardware-block screenshots of your conversations
              with Private Profile, and chat with the verified Google Gemini assistant.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>Private Profile (`FLAG_SECURE` Protection):</strong> Turning on Private
                Profile activates Android <code>FLAG_SECURE</code> in chats and calls with you —
                blocking screenshots, screen recording, and photo saving/forwarding.
              </li>
              <li>
                <strong>Group Conversations &amp; Owner Controls:</strong> Create groups, add/remove
                members, browse Group Media, and lock group themes to the group owner.
              </li>
              <li>
                <strong>Verified KuchuPuchu AI (Google Gemini):</strong> Dedicated AI assistant with
                multi-session history (`AIHistoryScreen.kt`) fluent in Bangla, Banglish, and
                English.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect
                x="30"
                y="34"
                width="174"
                height="182"
                rx="16"
                fill="#0b1426"
                stroke="#3b82f6"
              />
              <text x="48" y="64" fill="#60a5fa" fontSize="10" fontWeight="700">
                PRIVATE PROFILE SHIELD
              </text>
              <text x="48" y="90" fill="#ffffff" fontSize="14" fontWeight="800">
                FLAG_SECURE ON
              </text>
              <text x="48" y="114" fill="#93c5fd" fontSize="10">
                • Blocks Screenshots
              </text>
              <text x="48" y="134" fill="#93c5fd" fontSize="10">
                • Blocks Screen Recording
              </text>
              <text x="48" y="154" fill="#93c5fd" fontSize="10">
                • Disables Save &amp; Forward
              </text>
              <text x="48" y="188" fill="#dbeafe" fontSize="10" fontWeight="600">
                Active in Chat + Calls
              </text>
              <rect
                x="218"
                y="34"
                width="172"
                height="84"
                rx="16"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="234" y="60" fill="#60a5fa" fontSize="10" fontWeight="700">
                VERIFIED GOOGLE GEMINI AI
              </text>
              <text x="234" y="80" fill="#ffffff" fontSize="12" fontWeight="700">
                KuchuPuchu AI ✓
              </text>
              <text x="234" y="98" fill="#93c5fd" fontSize="10">
                Bangla · Banglish · Session History
              </text>
              <rect
                x="218"
                y="132"
                width="172"
                height="84"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="234" y="158" fill="#60a5fa" fontSize="10" fontWeight="700">
                GROUPS &amp; MODERATION
              </text>
              <text x="234" y="178" fill="#ffffff" fontSize="12" fontWeight="700">
                Owner Themes &amp; Media
              </text>
              <text x="234" y="196" fill="#93c5fd" fontSize="10">
                @mentions · Block &amp; Unblock
              </text>
            </svg>
          </div>
        </article>
      )}

      {/* BANNER 12: KP1/KP2 Crypto, Compact OTP Login, Launcher Camera & OTA Updater */}
      {show(["encryption", "architecture", "faq", "legal"]) && (
        <article className="kp-feature-banner kp-feature-banner--reverse">
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER 12 · KP1/KP2 CRYPTO, COMPACT OTP &amp; ANDROID INTEGRATIONS
            </span>
            <h3>
              KP1/KP2 Encryption, Compact 6-Digit Login OTP, Google Recovery &amp; OTA APK Updater
            </h3>
            <p>
              End-to-end cryptographic security paired with SIM-aware login, one-tap OTP copy,
              Android Launcher Camera, and in-app R2 APK updates.
            </p>
            <ul className="kp-step-list">
              <li>
                <strong>KP1 E2EE + KP2 Key Backup:</strong> ECDH P-256 + AES-256-GCM personal chat
                sealing with PBKDF2-SHA256 (210,000 iterations) passphrase key backup across Android
                and Desktop Web.
              </li>
              <li>
                <strong>Compact 6-Digit Login Approval OTP &amp; Google Recovery:</strong> Approve
                new devices from the official KuchuPuchu chat with a compact copyable 6-digit OTP,
                or recover your account via bound Google Identity.
              </li>
              <li>
                <strong>Launcher Camera, Shortcuts, Sealed Push &amp; OTA Updater:</strong> Capture
                photos straight from the Android launcher, reply/👍 from sealed notifications, and
                update your APK in-app from Cloudflare R2.
              </li>
            </ul>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <svg viewBox="0 0 420 250" className="kp-banner-svg">
              <rect
                x="14"
                y="14"
                width="392"
                height="222"
                rx="22"
                fill="#111d34"
                stroke="#2d4673"
                strokeWidth="1.5"
              />
              <rect x="28" y="34" width="112" height="92" rx="14" fill="#182846" stroke="#3b82f6" />
              <text x="42" y="58" fill="#60a5fa" fontSize="9.5" fontWeight="700">
                KP1 ON-DEVICE
              </text>
              <text x="42" y="78" fill="#ffffff" fontSize="11.5" fontWeight="700">
                ECDH P-256
              </text>
              <text x="42" y="96" fill="#93c5fd" fontSize="10">
                AES-256-GCM
              </text>
              <rect
                x="154"
                y="34"
                width="112"
                height="92"
                rx="14"
                fill="#0b1426"
                stroke="#4f8ff7"
              />
              <text x="168" y="58" fill="#60a5fa" fontSize="9.5" fontWeight="700">
                KP2 KEY BACKUP
              </text>
              <text x="168" y="78" fill="#ffffff" fontSize="11.5" fontWeight="700">
                PBKDF2 210k
              </text>
              <text x="168" y="96" fill="#93c5fd" fontSize="10">
                Passphrase Vault
              </text>
              <rect
                x="280"
                y="34"
                width="112"
                height="92"
                rx="14"
                fill="#182846"
                stroke="#3b82f6"
              />
              <text x="294" y="58" fill="#60a5fa" fontSize="9.5" fontWeight="700">
                COMPACT OTP
              </text>
              <text x="294" y="78" fill="#ffffff" fontSize="11.5" fontWeight="700">
                482910 [Copy]
              </text>
              <text x="294" y="96" fill="#93c5fd" fontSize="10">
                + Google Recovery
              </text>
              <rect
                x="28"
                y="142"
                width="364"
                height="74"
                rx="16"
                fill="#15233d"
                stroke="#2c446e"
              />
              <text x="46" y="168" fill="#60a5fa" fontSize="10" fontWeight="700">
                NATIVE ANDROID INTEGRATIONS · V282 (3.9.205)
              </text>
              <text x="46" y="190" fill="#ffffff" fontSize="11.5" fontWeight="700">
                Launcher Camera · Dynamic Shortcuts · Share Sheet · Sealed Push · R2 OTA Updater
              </text>
            </svg>
          </div>
        </article>
      )}
    </section>
  );
}
