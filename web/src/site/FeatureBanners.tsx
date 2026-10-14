import type { ReactElement } from "react";

export type FeatureBannerCategory =
  "all" | "overview" | "features" | "encryption" | "architecture" | "faq" | "legal";

export interface FeatureBannerItem {
  id: string;
  number: string;
  badge: string;
  modules: string;
  title: string;
  subtitle: string;
  steps: [string, string, string];
  categories: readonly FeatureBannerCategory[];
}

/**
 * Complete 24-banner visual showcase — one dedicated 3D Skeuomorphic banner
 * with a bespoke SVG illustration and 3-step guide for EVERY single feature
 * across KuchuPuchu Android & Web.
 */
export const FEATURE_BANNERS: readonly FeatureBannerItem[] = [
  {
    id: "hide-chats",
    number: "01",
    badge: "SECRET CHAT VAULT",
    modules: "ChatListScreen.kt · SearchScreen.kt",
    title: "How to Hide & Unhide Secret Chats",
    subtitle:
      "Move sensitive conversations out of your main inbox behind a per-chat Secret Key. Hidden threads vanish completely from your chat list, unread badges, and notifications until you unlock them from the Search bar.",
    steps: [
      "Long-press any chat in your inbox (or open its menu) and tap Hide Chat.",
      "Create a Secret Key passphrase for that conversation — it disappears from the inbox immediately and mutes lock-screen alerts.",
      "To open or unhide it, tap Search, enter your exact Secret Key, or open Menu → Hidden Chats → Unhide.",
    ],
    categories: ["encryption", "faq", "legal"],
  },
  {
    id: "archive-chats",
    number: "02",
    badge: "2.0S PULL GESTURE",
    modules: "ArchiveList.kt · ChatListScreen.kt",
    title: "How to Archive Chats & Use the 2-Second Pull Gesture",
    subtitle:
      "Keep low-priority threads tucked away without losing history. KuchuPuchu hides even the Archive entry until you perform an intentional 2-second pull-down gesture on the inbox.",
    steps: [
      "Long-press any conversation and select Archive Chat to move it out of your active inbox.",
      "Pull down from the top of the chat list and hold for 2 full seconds to fill the circular gauge and reveal Archived Chats.",
      "Open Archived Chats anytime to read muted messages or tap Unarchive to restore a thread to the main inbox.",
    ],
    categories: ["faq"],
  },
  {
    id: "inbox-organization",
    number: "03",
    badge: "INBOX ORGANIZATION",
    modules: "ChatListScreen.kt · ChatPreviewText.kt",
    title: "Pin Top Chats, Separate Call/Msg Mute & Unread Preview Privacy",
    subtitle:
      "Stay in total control of busy inboxes with pinned priority threads, independent message vs. call mute timers (1h, 8h, 24h, Forever), batch multi-select, and unread preview masking.",
    steps: [
      "Long-press up to 3 important chats and tap Pin to lock them at the very top of your inbox.",
      "Mute message notifications or incoming call rings independently for 1 hour, 8 hours, 24 hours, or Forever.",
      "Toggle Unread Preview Privacy so locked or shared screens mask unread message text behind 'New message'.",
    ],
    categories: ["encryption", "legal"],
  },
  {
    id: "kp1-encryption",
    number: "04",
    badge: "ZERO-KNOWLEDGE CRYPTO",
    modules: "E2eeMsg.kt · E2eePolicy.kt",
    title: "KP1 End-to-End Encrypted 1:1 Personal Chats",
    subtitle:
      "Every personal 1:1 message is sealed on your device before upload using ECDH P-256 key agreement, HKDF-SHA256 key derivation, and AES-256-GCM authenticated encryption with a fail-closed guard.",
    steps: [
      "Your device generates an identity keypair in Android Keystore / Web Crypto API and derives a shared secret with your peer.",
      "Every message is encrypted locally into a KP1.<iv>.<ciphertext> AES-256-GCM envelope with a fresh 96-bit random IV.",
      "Verify peer identity anytime by comparing the safety fingerprint or scanning keys in Chat Info → Encryption.",
    ],
    categories: ["encryption", "architecture", "legal"],
  },
  {
    id: "kp2-backup",
    number: "05",
    badge: "ROAMING KEY VAULT",
    modules: "E2eeBackup.kt · Web Crypto PBKDF2",
    title: "KP2 Cross-Device Passphrase Key Backup (210,000 Iterations)",
    subtitle:
      "Switch phones or sign in on KuchuPuchu Web without losing your encrypted chat history. Your private key is wrapped locally using PBKDF2-HMAC-SHA256 (210,000 iterations) and AES-256-GCM.",
    steps: [
      "Open Settings → Encrypted Key Backup and create a 6+ character recovery passphrase.",
      "Your device derives a 256-bit wrapping key via 210,000 PBKDF2-SHA256 iterations with a random 16-byte salt.",
      "Only the sealed KP2 ciphertext is uploaded — enter your passphrase on KuchuPuchu Web or a new phone to unlock history.",
    ],
    categories: ["encryption", "architecture", "faq"],
  },
  {
    id: "rich-messaging",
    number: "06",
    badge: "CORE MESSAGING",
    modules: "MessageReplySwipePolicy.kt · ChatScreen.kt",
    title: "Swipe-to-Reply Quotes, Multi-Select & Batch Forwarding",
    subtitle:
      "Respond to exact messages in fast-moving threads with spring-physics swipe-to-reply, tap quoted headers to jump to the original bubble, and batch-forward across chats.",
    steps: [
      "Swipe right on any message bubble or photo (or click Reply on Web) to quote it above the composer.",
      "Tap any quoted reply chip inside a conversation to scroll and highlight the original message.",
      "Long-press to multi-select messages with rounded checkboxes and copy or forward them to multiple chats at once.",
    ],
    categories: ["faq"],
  },
  {
    id: "emoji-fx",
    number: "07",
    badge: "3D LOTTIE EMOJI FX",
    modules: "EmojiAnim.kt · ChatFx.kt",
    title: "Animated 3D Emoji Reactions & Fullscreen Particle Celebrations",
    subtitle:
      "Bring conversations to life with bare floating emoji reactions, jumbo animated single-emoji bubbles, and synchronized fullscreen particle bursts on both phones.",
    steps: [
      "Long-press or hover over any message bubble to pop up the floating bare emoji reaction bar.",
      "Send a single emoji on its own to render an oversized animated 3D Lottie sticker bubble.",
      "Tap an animated emoji or react with ❤️, 🔥, 🎉, or 😂 to trigger a fullscreen particle burst across both devices.",
    ],
    categories: ["faq"],
  },
  {
    id: "magic-commands",
    number: "08",
    badge: "COMPOSER /MAGIC",
    modules: "ComposerCommands.kt · MagicMessageEffect.kt · MessageMarkup.kt",
    title: "/magic Floating Wave Commands, Rich Markdown & @Mentions",
    subtitle:
      "Trigger iridescent floating-wave bubble animations with /magic, style text with inline bold/italic/code/strikethrough markup, and autocomplete @mentions in groups.",
    steps: [
      "Type / in the message composer to open the command popup and choose /magic followed by your message.",
      "Format text naturally using *bold*, _italic_, ~strikethrough~, and `inline code` markup.",
      "Type @ in any group conversation to filter members with instant avatar autocomplete pills.",
    ],
    categories: ["faq"],
  },
  {
    id: "disappearing-messages",
    number: "09",
    badge: "EPHEMERAL PRIVACY",
    modules: "ChatScreen.kt · Worker Cron Sweep",
    title: "Disappearing Messages Auto-Expiry Timer (24h · 7d · 30d)",
    subtitle:
      "Set a per-conversation vanish timer so messages automatically erase themselves from both devices and Cloudflare D1 storage once their countdown expires.",
    steps: [
      "Open any conversation's top menu or Chat Info sheet and tap Disappearing Messages.",
      "Select 24 Hours, 7 Days, or 30 Days (or turn the timer Off anytime).",
      "Every new message carries an expiry timestamp and is purged automatically by the client and Worker cron job.",
    ],
    categories: ["encryption", "legal"],
  },
  {
    id: "scheduled-messages",
    number: "10",
    badge: "SCHEDULED DELIVERY",
    modules: "Reminders.kt · Scheduled Queue",
    title: "Scheduled Messages & Dhaka Timezone Auto-Dispatch",
    subtitle:
      "Compose messages now and queue them for automatic delivery at an exact future date and time — even if your phone or browser goes offline afterwards.",
    steps: [
      "Type your message, then open the Schedule action from the composer to pick a future delivery time.",
      "Inspect all pending messages in the Scheduled Messages sheet inside the conversation.",
      "Edit, reschedule, send immediately, or cancel any queued message before the Worker dispatches it.",
    ],
    categories: ["architecture", "faq"],
  },
  {
    id: "delete-for-everyone",
    number: "11",
    badge: "TOTAL ERASURE FX",
    modules: "DeleteAnim.kt · R2 Object Purge",
    title: "Permanent Delete for Everyone with 3D Particle Shatter",
    subtitle:
      "Erase sent messages for yourself or permanently for everyone in the chat — complete with a custom 3D particle-disintegration animation and immediate R2 media object wipe.",
    steps: [
      "Long-press any message you sent (or select it on Web) and tap Delete.",
      "Choose Delete for Everyone to remove the message from every participant's device and server database.",
      "Watch the bubble disintegrate into glowing particles while any attached R2 media blob is permanently deleted.",
    ],
    categories: ["encryption", "legal"],
  },
  {
    id: "themes-nicknames",
    number: "12",
    badge: "PERSONALIZATION",
    modules: "ConversationNicknamesSheet.kt · Theme.kt",
    title: "Conversation Nicknames & 5 Custom Per-Chat Themes",
    subtitle:
      "Give every relationship its own identity with custom per-chat nicknames and five curated 3D skeuomorphic themes (Classic, Ocean, Forest, Sunset, and Midnight).",
    steps: [
      "Open Chat Info and tap Theme to preview Classic Blue, Ocean, Forest, Sunset, or Midnight.",
      "Tap Conversation Nicknames to assign custom display names for yourself and your chat partner.",
      "Your chosen theme and nicknames synchronize in real time across Android and KuchuPuchu Web.",
    ],
    categories: ["faq"],
  },
  {
    id: "view-once-media",
    number: "13",
    badge: "1× EPHEMERAL MEDIA",
    modules: "ViewOnceIcon.kt · R2 Single-Open Wipe",
    title: "View-Once (1×) Self-Destructing Photos, Videos & Voice Notes",
    subtitle:
      "Send sensitive photos, videos, and voice notes that can only be opened a single time. View-Once media blocks screenshots and wipes its encrypted R2 bytes the instant it closes.",
    steps: [
      "Attach a photo, video, or voice note and tap the 1× View-Once toggle badge before sending.",
      "The recipient taps the sealed 1× bubble to open it inside a screenshot-protected fullscreen viewer.",
      "On close, the server deletes the R2 media object and permanently marks the message as Opened.",
    ],
    categories: ["encryption", "legal"],
  },
  {
    id: "media-studio",
    number: "14",
    badge: "CREATIVE STUDIO",
    modules: "MediaEditScreen.kt · CropTrimKit.kt · AttachmentExitGate.kt",
    title: "Built-in Photo & Video Studio (Crop, Draw, Text & Trim)",
    subtitle:
      "Edit photos and videos before sending without leaving KuchuPuchu. Crop aspect ratios, draw freehand neon annotations, add text overlays, trim video clips, and prevent accidental discard.",
    steps: [
      "Pick any photo or video from your camera or gallery to launch the built-in Media Edit Studio.",
      "Use the studio toolbar to crop/rotate, draw freehand strokes, place text labels, or trim video start/end frames.",
      "If you press back while editing, AttachmentExitGate prompts before discarding your unsaved work.",
    ],
    categories: ["faq"],
  },
  {
    id: "voice-notes",
    number: "15",
    badge: "VOICE MESSAGING",
    modules: "VoiceNote.kt · AudioRouter.kt",
    title: "Voice Notes with 48-Bar Waveform Scrubbing & Speed Control",
    subtitle:
      "Record crystal-clear voice notes with hands-free slide-to-lock, interactive 48-bar waveform scrubbing, automatic ear-proximity earpiece routing, and 1× / 1.5× / 2× playback speed.",
    steps: [
      "Hold the microphone button to record, slide up to lock hands-free mode, or slide left to cancel.",
      "Drag anywhere along the 48-bar visual waveform to seek to an exact second in the voice note.",
      "Tap the 1× / 1.5× / 2× speed pill or raise your phone to your ear for private earpiece playback.",
    ],
    categories: ["faq"],
  },
  {
    id: "large-files",
    number: "16",
    badge: "5 GB CLOUD FILES",
    modules: "Files.kt · DocViewerScreen.kt · TiffDecoder.kt",
    title: "Up to 5 GB Resumable Multipart Uploads & Built-in Document Viewer",
    subtitle:
      "Send full-resolution videos, archives, and project files up to 5 GB via 8 MB chunked Cloudflare R2 multipart uploads — and preview PDFs, code, Markdown, CSV, and TIFF files in-app.",
    steps: [
      "Tap the attachment button and choose Document or File (up to 5 GB docs, 2 GB videos, 100 MB photos/audio).",
      "Large files stream in 8 MB multipart chunks to Cloudflare R2 with live progress and retry resilience.",
      "Tap any received PDF, source code, Markdown, CSV, or multi-page TIFF to open the built-in Document Viewer.",
    ],
    categories: ["architecture"],
  },
  {
    id: "stickers-gifs",
    number: "17",
    badge: "STICKERS & GIFS",
    modules: "StickerSheet.kt · GifRepo.kt · EmojiRepo.kt",
    title: "1,150+ Stickers (10 Curated Packs) & Live GIF Picker",
    subtitle:
      "Express every mood with 10 built-in high-resolution sticker packs (over 1,150 stickers), a live trending GIF search engine, favorites syncing, and recent sticker memory.",
    steps: [
      "Tap the Sticker icon in the composer to browse 10 packs including Koko, Blu, Mochi, and animated sets.",
      "Long-press any sticker to save it to your synced Favorites tab or access your Recent stickers.",
      "Switch to the GIF tab to search trending reaction GIFs and send with a single tap.",
    ],
    categories: ["faq"],
  },
  {
    id: "encrypted-calls",
    number: "18",
    badge: "WEBRTC CALLING",
    modules: "CallEngine.kt · CallScreens.kt · E2eeCall.kt · KpTelecom.kt",
    title: "1:1 Encrypted WebRTC Audio & HD Video Calls",
    subtitle:
      "Place low-latency 1:1 voice and HD video calls secured by DTLS-SRTP and per-call E2eeCall key verification, backed by 5-layer ring delivery and Android Telecom integration.",
    steps: [
      "Tap the Voice or Video Call icon in any 1:1 chat header to start an encrypted WebRTC session.",
      "Switch between Speaker, Earpiece, and Bluetooth or flip front/back cameras with a minimized call timer banner.",
      "Answer incoming rings straight from your Android lock screen or KuchuPuchu Web call banner.",
    ],
    categories: ["encryption", "architecture"],
  },
  {
    id: "screen-share-audio",
    number: "19",
    badge: "SCREEN SHARE + AUDIO",
    modules: "KpScreenCapturer.kt · SystemAudioTap.kt · VoiceIsolation.kt",
    title: "Live Screen Sharing with System Audio Tap & AI Voice Isolation",
    subtitle:
      "Share your phone or desktop screen during live calls complete with synchronized device system audio for gaming/videos and hardware-accelerated Voice Isolation noise suppression.",
    steps: [
      "During any active 1:1 call, tap the Screen Share button in the 3D call control dock.",
      "SystemAudioTap streams your device's internal game, video, or music audio alongside your live screen.",
      "Toggle Voice Isolation to strip wind, fan, and street background noise so only your voice comes through.",
    ],
    categories: ["architecture"],
  },
  {
    id: "status-stories",
    number: "20",
    badge: "24-HOUR STORIES",
    modules: "StatusScreens.kt · StatusPickScreen.kt · VideoExport.kt",
    title: "24-Hour Status Stories with Video Trim, Rings & Quote Replies",
    subtitle:
      "Post 24-hour photo, trimmed video, or styled text stories with unseen/viewed avatar rings, hold-to-pause viewer controls, quick emoji reactions, and private 1:1 quote replies.",
    steps: [
      "Open the Status tab and tap + Add Status to share a photo, trimmed video clip, or custom color card.",
      "Tap any contact's glowing status ring to watch full-screen (5-second auto-advance, hold to pause).",
      "React with ❤️ 🔥 👏 or type a reply to send a quoted status message directly into their 1:1 chat.",
    ],
    categories: ["faq"],
  },
  {
    id: "group-chats",
    number: "21",
    badge: "GROUP CONVERSATIONS",
    modules: "CreateGroupScreen.kt · GroupInfoScreen.kt",
    title: "Group Chats, Owner Admin Controls & Shared Media",
    subtitle:
      "Create multi-member group conversations with custom avatars, owner crown badges, member add/remove controls, owner-locked group themes, and live multi-user typing indicators.",
    steps: [
      "Open the main menu and tap New Group to select contacts, name the group, and upload a group photo.",
      "Group owners can add or remove members, manage group settings, and lock or customize the group theme.",
      "Browse all shared group photos, videos, files, and links from the Group Info media tabs.",
    ],
    categories: ["architecture"],
  },
  {
    id: "flag-secure",
    number: "22",
    badge: "SCREEN SHIELD",
    modules: "KpSecure.kt · ProfileScreen.kt",
    title: "Private Profile Shield & Screenshot Protection (FLAG_SECURE)",
    subtitle:
      "Enable Private Profile to activate Android hardware FLAG_SECURE across chats and calls with you — blocking screenshots, screen recording, and photo saving or forwarding.",
    steps: [
      "Open Account & Profile Settings and toggle Private Profile ON alongside granular field visibility.",
      "Android hardware FLAG_SECURE immediately blocks screenshots, screen recorders, and task-switcher previews.",
      "Media sent in protected chats disables Save to Gallery and Forward so your photos stay in the conversation.",
    ],
    categories: ["encryption", "legal"],
  },
  {
    id: "sim-auth-otp",
    number: "23",
    badge: "IDENTITY & OTP",
    modules: "LoginScreen.kt · PhoneVerifier.kt · GoogleAuth.kt",
    title: "SIM-Aware Phone Auth, Compact 6-Digit Copyable OTP & Google Recovery",
    subtitle:
      "Sign in with SIM-aware E.164 phone verification on Android, bind Google Identity for lost-device recovery, and approve Desktop Web logins with a compact 6-digit OTP + Copy button.",
    steps: [
      "Verify your phone number on Android and optionally link your Google account for one-tap recovery.",
      "On Desktop Web (/chats), enter your phone number to receive a live login approval card inside your Official chat.",
      "Tap Approve on your phone — or tap the compact Copy button next to the 6-digit OTP code to sign in.",
    ],
    categories: ["encryption", "faq", "legal"],
  },
  {
    id: "ai-push-ota",
    number: "24",
    badge: "GEMINI AI & ANDROID OTA",
    modules: "AIHistoryScreen.kt · LauncherCameraScreen.kt · PushSeal.kt · KpUpdate.kt",
    title: "Verified KuchuPuchu Gemini AI, Launcher Camera, Sealed Push & OTA Updater",
    subtitle:
      "Chat with the verified KuchuPuchu AI assistant powered exclusively by Google Gemini, capture from the Android Launcher Camera, receive PushSeal notifications, and install R2 OTA APK updates.",
    steps: [
      "Open KuchuPuchu AI from your inbox to chat in Bangla, Banglish, or English with multi-session history.",
      "Use Android Launcher Camera, dynamic app shortcuts, and Direct Share targets for instant media sharing.",
      "Receive content-free/sealed push notifications and install signed Android APK updates in-app via KpUpdate.",
    ],
    categories: ["architecture", "faq"],
  },
];

export const ANDROID_APP_FEATURES = FEATURE_BANNERS.map((b) => ({
  num: b.number,
  tag: b.badge,
  title: b.title,
  summary: b.subtitle,
  modules: b.modules,
}));

function BannerVisual({ id }: { id: string }): ReactElement {
  switch (id) {
    case "hide-chats":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <defs>
            <linearGradient id="hb-panel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1b3564" />
              <stop offset="100%" stopColor="#0a162c" />
            </linearGradient>
            <linearGradient id="hb-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe28a" />
              <stop offset="100%" stopColor="#d99616" />
            </linearGradient>
            <linearGradient id="hb-blue" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4f96ff" />
              <stop offset="100%" stopColor="#1e56cc" />
            </linearGradient>
          </defs>
          <rect
            x="8"
            y="10"
            width="114"
            height="200"
            rx="16"
            fill="url(#hb-panel)"
            stroke="#4c78c8"
            strokeOpacity="0.45"
          />
          <text x="20" y="30" fill="#9bc2ff" fontSize="9.5" fontWeight="700">
            1 · LONG-PRESS CHAT
          </text>
          <rect
            x="16"
            y="40"
            width="98"
            height="34"
            rx="9"
            fill="#102244"
            stroke="#6aa6ff"
            strokeOpacity="0.4"
          />
          <circle cx="30" cy="57" r="9" fill="url(#hb-blue)" />
          <text x="44" y="54" fill="#f0f6ff" fontSize="8.5" fontWeight="700">
            Rahi Ahmed
          </text>
          <text x="44" y="65" fill="#8cb4f5" fontSize="7.5">
            Secret plan tonight…
          </text>
          <rect
            x="20"
            y="82"
            width="90"
            height="72"
            rx="10"
            fill="#0d1b36"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="30" y="99" fill="#cbd5e1" fontSize="8">
            Pin Conversation
          </text>
          <rect x="25" y="106" width="80" height="22" rx="6" fill="url(#hb-gold)" />
          <text x="33" y="120" fill="#091326" fontSize="8.5" fontWeight="800">
            🔒 Hide Chat
          </text>
          <text x="30" y="143" fill="#cbd5e1" fontSize="8">
            Archive Chat
          </text>

          <rect
            x="133"
            y="10"
            width="114"
            height="200"
            rx="16"
            fill="url(#hb-panel)"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="145" y="30" fill="#fde68a" fontSize="9.5" fontWeight="700">
            2 · SET SECRET KEY
          </text>
          <circle cx="190" cy="72" r="22" fill="#102244" stroke="url(#hb-gold)" strokeWidth="2" />
          <path d="M183 72v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#fde68a" strokeWidth="2.2" />
          <rect x="180" y="72" width="20" height="15" rx="4" fill="url(#hb-gold)" />
          <rect
            x="147"
            y="108"
            width="86"
            height="26"
            rx="8"
            fill="#081224"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="163" y="125" fill="#fde68a" fontSize="12" fontWeight="800" letterSpacing="3">
            ••••••
          </text>
          <rect x="152" y="146" width="76" height="24" rx="8" fill="url(#hb-blue)" />
          <text x="167" y="161" fill="#ffffff" fontSize="8.5" fontWeight="700">
            Seal &amp; Hide
          </text>

          <rect
            x="258"
            y="10"
            width="114"
            height="200"
            rx="16"
            fill="url(#hb-panel)"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="269" y="30" fill="#7dd3fc" fontSize="9.5" fontWeight="700">
            3 · SEARCH TO UNLOCK
          </text>
          <rect
            x="268"
            y="42"
            width="94"
            height="26"
            rx="8"
            fill="#081224"
            stroke="#38bdf8"
            strokeOpacity="0.7"
          />
          <text x="276" y="58" fill="#e0f2fe" fontSize="8.5" fontWeight="700">
            🔍 Key: ••••••
          </text>
          <rect
            x="268"
            y="78"
            width="94"
            height="62"
            rx="10"
            fill="#10264a"
            stroke="#fde68a"
            strokeOpacity="0.65"
          />
          <text x="276" y="95" fill="#fde68a" fontSize="8" fontWeight="800">
            🔓 HIDDEN VAULT
          </text>
          <circle cx="283" cy="115" r="9" fill="url(#hb-gold)" />
          <text x="297" y="113" fill="#ffffff" fontSize="8.5" fontWeight="700">
            Rahi Ahmed
          </text>
          <text x="297" y="125" fill="#93c5fd" fontSize="7.5">
            Tap to unhide/open
          </text>
        </svg>
      );

    case "archive-chats":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="10"
            y="12"
            width="172"
            height="196"
            rx="16"
            fill="#112344"
            stroke="#5b8def"
            strokeOpacity="0.45"
          />
          <text x="24" y="34" fill="#9bc2ff" fontSize="9.5" fontWeight="700">
            PULL &amp; HOLD 2.0 SECONDS
          </text>
          <circle cx="96" cy="94" r="34" fill="#0a162c" stroke="#2b4c85" strokeWidth="5" />
          <path
            d="M96 60 A34 34 0 1 1 64 106"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <text x="79" y="98" fill="#f0f9ff" fontSize="12" fontWeight="800">
            2.0s
          </text>
          <path
            d="M96 135v22m-8-8 8 8 8-8"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <text x="38" y="182" fill="#bae6fd" fontSize="8.5" fontWeight="600">
            Hold pull gesture to reveal
          </text>

          <rect
            x="198"
            y="12"
            width="172"
            height="196"
            rx="16"
            fill="#112344"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="214" y="34" fill="#fde68a" fontSize="9.5" fontWeight="700">
            ARCHIVED CHATS VAULT
          </text>
          <rect
            x="212"
            y="48"
            width="144"
            height="40"
            rx="10"
            fill="#0b1830"
            stroke="#4f86eb"
            strokeOpacity="0.4"
          />
          <circle cx="230" cy="68" r="11" fill="#1e40af" />
          <text x="247" y="65" fill="#f8fafc" fontSize="9" fontWeight="700">
            Project Group
          </text>
          <text x="247" y="77" fill="#93c5fd" fontSize="7.5">
            Muted · 12 new messages
          </text>
          <rect
            x="212"
            y="96"
            width="144"
            height="40"
            rx="10"
            fill="#0b1830"
            stroke="#4f86eb"
            strokeOpacity="0.4"
          />
          <circle cx="230" cy="116" r="11" fill="#0284c7" />
          <text x="247" y="113" fill="#f8fafc" fontSize="9" fontWeight="700">
            University Alumni
          </text>
          <text x="247" y="125" fill="#93c5fd" fontSize="7.5">
            Archived · Tap to restore
          </text>
          <rect x="226" y="152" width="116" height="28" rx="9" fill="#1d4ed8" />
          <text x="246" y="170" fill="#ffffff" fontSize="9" fontWeight="700">
            📤 Unarchive Chat
          </text>
        </svg>
      );

    case "inbox-organization":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="12"
            width="356"
            height="196"
            rx="16"
            fill="#102242"
            stroke="#5b8def"
            strokeOpacity="0.45"
          />
          <rect x="28" y="26" width="64" height="24" rx="12" fill="#1e3a6d" />
          <text x="44" y="42" fill="#cbd5e1" fontSize="9" fontWeight="700">
            All · 18
          </text>
          <rect
            x="100"
            y="26"
            width="84"
            height="24"
            rx="12"
            fill="#2563eb"
            stroke="#93c5fd"
            strokeOpacity="0.6"
          />
          <text x="114" y="42" fill="#ffffff" fontSize="9" fontWeight="800">
            Unread · 4
          </text>
          <rect
            x="216"
            y="26"
            width="136"
            height="24"
            rx="12"
            fill="#0b172e"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="228" y="42" fill="#fde68a" fontSize="8.5" fontWeight="700">
            👁 Preview Mask: ON
          </text>

          <rect
            x="28"
            y="62"
            width="324"
            height="42"
            rx="11"
            fill="#162e58"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <circle cx="50" cy="83" r="13" fill="#2563eb" />
          <text x="72" y="79" fill="#ffffff" fontSize="10" fontWeight="800">
            Nadia Islam
          </text>
          <text x="72" y="93" fill="#93c5fd" fontSize="8.5">
            📌 Pinned · Call Mute: 8h
          </text>
          <rect x="290" y="72" width="48" height="20" rx="10" fill="#f59e0b" />
          <text x="302" y="85" fill="#091326" fontSize="8.5" fontWeight="800">
            PIN
          </text>

          <rect
            x="28"
            y="112"
            width="324"
            height="42"
            rx="11"
            fill="#0b1830"
            stroke="#3b82f6"
            strokeOpacity="0.4"
          />
          <circle cx="50" cy="133" r="13" fill="#0ea5e9" />
          <text x="72" y="129" fill="#ffffff" fontSize="10" fontWeight="700">
            Tanvir Hasan
          </text>
          <text x="72" y="143" fill="#fde68a" fontSize="8.5">
            🔒 New message (Preview hidden for privacy)
          </text>
          <circle cx="332" cy="133" r="10" fill="#3b82f6" />
          <text x="329" y="137" fill="#ffffff" fontSize="8.5" fontWeight="800">
            2
          </text>

          <rect
            x="28"
            y="160"
            width="324"
            height="34"
            rx="10"
            fill="#0b1830"
            stroke="#38bdf8"
            strokeOpacity="0.3"
          />
          <text x="44" y="181" fill="#7dd3fc" fontSize="8.5" fontWeight="700">
            ☑ Multi-Select Mode · Independent Msg &amp; Call Mute Timers
          </text>
        </svg>
      );

    case "kp1-encryption":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="10"
            y="24"
            width="102"
            height="172"
            rx="15"
            fill="#112447"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="22" y="48" fill="#93c5fd" fontSize="9" fontWeight="800">
            SENDER DEVICE
          </text>
          <rect x="20" y="60" width="82" height="36" rx="8" fill="#0a162c" />
          <text x="27" y="75" fill="#e2e8f0" fontSize="8" fontWeight="700">
            ECDH P-256
          </text>
          <text x="27" y="88" fill="#38bdf8" fontSize="7.5">
            HKDF-SHA256
          </text>
          <rect x="20" y="106" width="82" height="36" rx="8" fill="#1e3a8a" />
          <text x="26" y="121" fill="#ffffff" fontSize="8" fontWeight="700">
            AES-256-GCM
          </text>
          <text x="26" y="133" fill="#fde68a" fontSize="7.5">
            96-bit fresh IV
          </text>
          <text x="22" y="166" fill="#86efac" fontSize="8" fontWeight="700">
            ✓ Sealed Locally
          </text>

          <rect
            x="132"
            y="38"
            width="116"
            height="144"
            rx="15"
            fill="#0a152a"
            stroke="#fbbf24"
            strokeOpacity="0.65"
          />
          <text x="148" y="60" fill="#fde68a" fontSize="9" fontWeight="800">
            KP1 CIPHERTEXT
          </text>
          <rect x="144" y="72" width="92" height="52" rx="9" fill="#132548" />
          <text x="152" y="90" fill="#93c5fd" fontSize="8" fontFamily="monospace">
            0x9F4A..E81C
          </text>
          <text x="152" y="104" fill="#93c5fd" fontSize="8" fontFamily="monospace">
            TAG: 128-BIT
          </text>
          <text x="152" y="117" fill="#fbbf24" fontSize="7.5" fontWeight="700">
            Zero Plaintext
          </text>
          <text x="145" y="150" fill="#cbd5e1" fontSize="7.5">
            Worker sees only
          </text>
          <text x="145" y="162" fill="#cbd5e1" fontSize="7.5">
            sealed binary blobs
          </text>

          <rect
            x="268"
            y="24"
            width="102"
            height="172"
            rx="15"
            fill="#112447"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="280" y="48" fill="#93c5fd" fontSize="9" fontWeight="800">
            PEER DEVICE
          </text>
          <rect
            x="278"
            y="60"
            width="82"
            height="50"
            rx="8"
            fill="#0a162c"
            stroke="#38bdf8"
            strokeOpacity="0.4"
          />
          <text x="285" y="76" fill="#fde68a" fontSize="7.5" fontWeight="700">
            KEY VERIFICATION
          </text>
          <text x="285" y="89" fill="#e2e8f0" fontSize="7.5" fontFamily="monospace">
            48291 04921
          </text>
          <text x="285" y="101" fill="#e2e8f0" fontSize="7.5" fontFamily="monospace">
            88310 77419
          </text>
          <rect x="278" y="122" width="82" height="36" rx="8" fill="#065f46" />
          <text x="286" y="139" fill="#ecfdf5" fontSize="8" fontWeight="700">
            🔓 Decrypted
          </text>
          <text x="286" y="151" fill="#a7f3d0" fontSize="7.5">
            Verified Peer
          </text>
        </svg>
      );

    case "kp2-backup":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="14"
            y="18"
            width="352"
            height="184"
            rx="18"
            fill="#102244"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="30" y="42" fill="#fde68a" fontSize="10" fontWeight="800">
            KP2 ROAMING KEY VAULT · PBKDF2-HMAC-SHA256 (210,000 ITERATIONS)
          </text>
          <rect
            x="30"
            y="58"
            width="98"
            height="118"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="40" y="80" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            1 · PASSPHRASE
          </text>
          <rect x="40" y="92" width="78" height="24" rx="6" fill="#13284c" />
          <text x="48" y="108" fill="#fde68a" fontSize="10" fontWeight="800">
            ••••••••••
          </text>
          <text x="40" y="136" fill="#cbd5e1" fontSize="7.5">
            Never leaves your
          </text>
          <text x="40" y="148" fill="#cbd5e1" fontSize="7.5">
            device or browser
          </text>

          <rect
            x="141"
            y="58"
            width="98"
            height="118"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="151" y="80" fill="#fde68a" fontSize="8.5" fontWeight="700">
            2 · 210K PBKDF2
          </text>
          <circle cx="190" cy="115" r="22" fill="#172e58" stroke="#fbbf24" strokeWidth="2" />
          <text x="174" y="119" fill="#ffffff" fontSize="9" fontWeight="800">
            KP2
          </text>
          <text x="149" y="154" fill="#93c5fd" fontSize="7.5">
            AES-256-GCM Key Wrap
          </text>

          <rect
            x="252"
            y="58"
            width="98"
            height="118"
            rx="12"
            fill="#09152b"
            stroke="#34d399"
            strokeOpacity="0.5"
          />
          <text x="262" y="80" fill="#6ee7b7" fontSize="8.5" fontWeight="700">
            3 · RESTORE ANYWHERE
          </text>
          <rect x="264" y="94" width="74" height="28" rx="7" fill="#064e3b" />
          <text x="271" y="112" fill="#ecfdf5" fontSize="8" fontWeight="700">
            📱 Android + 💻 Web
          </text>
          <text x="264" y="142" fill="#a7f3d0" fontSize="7.5">
            Instant history unlock
          </text>
          <text x="264" y="154" fill="#a7f3d0" fontSize="7.5">
            across devices
          </text>
        </svg>
      );

    case "rich-messaging":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="28" y="38" fill="#93c5fd" fontSize="9.5" fontWeight="800">
            SWIPE-TO-REPLY · QUOTED THREADS · MULTI-FORWARD
          </text>
          <path
            d="M36 74h18m-6-6 6 6-6 6"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect
            x="64"
            y="52"
            width="220"
            height="44"
            rx="12"
            fill="#1b386b"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="78" y="70" fill="#fde68a" fontSize="8.5" fontWeight="700">
            ↩ Swipe Right to Quote
          </text>
          <text x="78" y="85" fill="#f8fafc" fontSize="9">
            Are we launching v4 tonight at 9 PM?
          </text>

          <rect
            x="96"
            y="108"
            width="252"
            height="56"
            rx="12"
            fill="#1e40af"
            stroke="#93c5fd"
            strokeOpacity="0.6"
          />
          <rect x="106" y="115" width="232" height="20" rx="6" fill="#0f2347" />
          <text x="114" y="128" fill="#93c5fd" fontSize="8" fontWeight="700">
            Rahi: Are we launching v4 tonight at 9 PM?
          </text>
          <text x="108" y="152" fill="#ffffff" fontSize="9.5" fontWeight="700">
            Yes! Everything is green &amp; ready 🚀
          </text>

          <rect x="28" y="172" width="324" height="24" rx="8" fill="#09152b" />
          <text x="42" y="188" fill="#fde68a" fontSize="8.5" fontWeight="700">
            ✓ 3 Selected · [↩ Reply] · [📋 Copy] · [↪ Forward to 5 Chats]
          </text>
        </svg>
      );

    case "emoji-fx":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#f59e0b"
            strokeOpacity="0.5"
          />
          <circle cx="52" cy="54" r="6" fill="#fbbf24" />
          <circle cx="328" cy="48" r="5" fill="#38bdf8" />
          <circle cx="300" cy="170" r="7" fill="#f43f5e" />
          <circle cx="72" cy="168" r="5" fill="#a855f7" />
          <rect
            x="64"
            y="34"
            width="252"
            height="44"
            rx="22"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.65"
          />
          <text x="84" y="62" fontSize="20">
            ❤️ 🔥 😂 🎉 👍 😢
          </text>

          <rect
            x="92"
            y="96"
            width="196"
            height="58"
            rx="16"
            fill="#1d4ed8"
            stroke="#93c5fd"
            strokeOpacity="0.65"
          />
          <text x="112" y="122" fill="#ffffff" fontSize="10" fontWeight="800">
            3D Lottie Emoji Burst!
          </text>
          <text x="112" y="139" fill="#dbeafe" fontSize="8.5">
            Synchronized fullscreen confetti FX
          </text>
          <rect x="246" y="140" width="54" height="24" rx="12" fill="#09152b" stroke="#fbbf24" />
          <text x="256" y="156" fill="#fde68a" fontSize="9.5" fontWeight="800">
            ❤️ 🔥 4
          </text>
        </svg>
      );

    case "magic-commands":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <defs>
            <linearGradient id="magic-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="50%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#db2777" />
            </linearGradient>
          </defs>
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#a855f7"
            strokeOpacity="0.55"
          />
          <text x="28" y="38" fill="#e9d5ff" fontSize="9.5" fontWeight="800">
            /MAGIC SLASH COMMANDS &amp; @MENTION AUTOCOMPLETE
          </text>
          <rect
            x="28"
            y="52"
            width="324"
            height="54"
            rx="14"
            fill="url(#magic-grad)"
            stroke="#fde68a"
            strokeOpacity="0.7"
          />
          <text x="46" y="76" fill="#fde68a" fontSize="9" fontWeight="800">
            ✨ /magic FLOATING WAVE EFFECT ACTIVE
          </text>
          <text x="46" y="94" fill="#ffffff" fontSize="10" fontWeight="700">
            Happy Anniversary! ✨ Glowing animated bubble
          </text>

          <rect
            x="28"
            y="118"
            width="324"
            height="40"
            rx="10"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="42" y="135" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            COMMAND &amp; MENTION PALETTE
          </text>
          <text x="42" y="149" fill="#fde68a" fontSize="8.5" fontFamily="monospace">
            /magic *bold* _italic_ @rahi @nadia
          </text>

          <rect x="28" y="166" width="324" height="28" rx="9" fill="#152c55" />
          <text x="42" y="184" fill="#ffffff" fontSize="9" fontFamily="monospace">
            &gt; /magic Welcome to KuchuPuchu 3D!
          </text>
        </svg>
      );

    case "disappearing-messages":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <circle cx="88" cy="110" r="54" fill="#09152b" stroke="#2563eb" strokeWidth="4" />
          <path
            d="M88 56 A54 54 0 1 1 42 138"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <text x="64" y="106" fill="#fde68a" fontSize="13" fontWeight="800">
            24h
          </text>
          <text x="58" y="124" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            7d · 30d · Off
          </text>

          <rect
            x="164"
            y="42"
            width="188"
            height="58"
            rx="12"
            fill="#17305c"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="178" y="64" fill="#ffffff" fontSize="9.5" fontWeight="700">
            Door code is 8492#
          </text>
          <text x="178" y="84" fill="#fde68a" fontSize="8.5" fontWeight="700">
            ⏱ Self-destructs in 23:59:41
          </text>

          <rect
            x="164"
            y="114"
            width="188"
            height="64"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <text x="178" y="136" fill="#93c5fd" fontSize="9" fontWeight="800">
            AUTOMATIC SERVER SWEEP
          </text>
          <text x="178" y="152" fill="#cbd5e1" fontSize="8">
            Erased from Android, Web &amp;
          </text>
          <text x="178" y="165" fill="#cbd5e1" fontSize="8">
            Cloudflare D1 when timer hits 0s.
          </text>
        </svg>
      );

    case "scheduled-messages":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#fde68a" fontSize="9.5" fontWeight="800">
            SCHEDULED DELIVERY &amp; DHAKA TIMEZONE DISPATCH
          </text>
          <rect
            x="28"
            y="52"
            width="150"
            height="134"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="42" y="74" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            📅 PICK DATE &amp; TIME
          </text>
          <rect x="42" y="86" width="122" height="26" rx="7" fill="#162e58" />
          <text x="52" y="103" fill="#ffffff" fontSize="8.5" fontWeight="700">
            Tomorrow · Oct 15
          </text>
          <rect x="42" y="118" width="122" height="26" rx="7" fill="#162e58" />
          <text x="52" y="135" fill="#fde68a" fontSize="8.5" fontWeight="700">
            🕘 09:00 AM (BST)
          </text>
          <rect x="42" y="152" width="122" height="22" rx="7" fill="#2563eb" />
          <text x="60" y="167" fill="#ffffff" fontSize="8" fontWeight="800">
            Schedule Send
          </text>

          <rect
            x="194"
            y="52"
            width="158"
            height="134"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.45"
          />
          <text x="208" y="74" fill="#fde68a" fontSize="8.5" fontWeight="700">
            ⏳ QUEUED TRAY (2)
          </text>
          <rect x="208" y="86" width="130" height="42" rx="8" fill="#152c55" />
          <text x="216" y="102" fill="#ffffff" fontSize="8.5" fontWeight="700">
            Happy Birthday! 🎂
          </text>
          <text x="216" y="118" fill="#93c5fd" fontSize="7.5">
            Sends at 12:00 AM · [Cancel]
          </text>
          <rect x="208" y="136" width="130" height="38" rx="8" fill="#152c55" />
          <text x="216" y="152" fill="#ffffff" fontSize="8.5" fontWeight="700">
            🔔 Standup notes
          </text>
          <text x="216" y="166" fill="#fde68a" fontSize="7.5">
            Auto-dispatched by Worker
          </text>
        </svg>
      );

    case "delete-for-everyone":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#f43f5e"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#fda4af" fontSize="9.5" fontWeight="800">
            DELETE FOR EVERYONE · 3D PARTICLE DISINTEGRATION
          </text>
          <rect
            x="28"
            y="56"
            width="164"
            height="58"
            rx="12"
            fill="#172e58"
            stroke="#f43f5e"
            strokeDasharray="5 3"
          />
          <text x="42" y="78" fill="#cbd5e1" fontSize="9">
            Sent attachment_v1.pdf
          </text>
          <text x="42" y="96" fill="#fda4af" fontSize="8" fontWeight="700">
            🗑 Disintegrating…
          </text>
          <circle cx="212" cy="64" r="5" fill="#fb7185" />
          <circle cx="228" cy="78" r="4" fill="#fbbf24" />
          <circle cx="244" cy="60" r="6" fill="#60a5fa" />
          <circle cx="262" cy="86" r="3.5" fill="#fb7185" />
          <circle cx="220" cy="98" r="4.5" fill="#38bdf8" />
          <circle cx="250" cy="104" r="3" fill="#fde68a" />

          <rect
            x="28"
            y="128"
            width="324"
            height="60"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.45"
          />
          <rect x="42" y="142" width="144" height="32" rx="8" fill="#be123c" />
          <text x="58" y="162" fill="#ffffff" fontSize="9" fontWeight="800">
            🗑 Delete for Everyone
          </text>
          <text x="200" y="155" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            ✓ Wipes D1 message row
          </text>
          <text x="200" y="170" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            ✓ Purges R2 media objects
          </text>
        </svg>
      );

    case "themes-nicknames":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="28" y="38" fill="#93c5fd" fontSize="9.5" fontWeight="800">
            5 PER-CHAT 3D THEMES &amp; CUSTOM CONVERSATION NICKNAMES
          </text>
          <circle cx="58" cy="78" r="18" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="112" cy="78" r="18" fill="#0284c7" stroke="#7dd3fc" strokeWidth="1.5" />
          <circle cx="166" cy="78" r="18" fill="#059669" stroke="#6ee7b7" strokeWidth="1.5" />
          <circle cx="220" cy="78" r="18" fill="#ea580c" stroke="#fed7aa" strokeWidth="1.5" />
          <circle cx="274" cy="78" r="18" fill="#4f46e5" stroke="#c7d2fe" strokeWidth="1.5" />
          <text x="42" y="108" fill="#dbeafe" fontSize="7.5" fontWeight="700">
            Classic
          </text>
          <text x="99" y="108" fill="#bae6fd" fontSize="7.5" fontWeight="700">
            Ocean
          </text>
          <text x="152" y="108" fill="#a7f3d0" fontSize="7.5" fontWeight="700">
            Forest
          </text>
          <text x="206" y="108" fill="#fed7aa" fontSize="7.5" fontWeight="700">
            Sunset
          </text>
          <text x="256" y="108" fill="#c7d2fe" fontSize="7.5" fontWeight="700">
            Midnight
          </text>

          <rect
            x="28"
            y="124"
            width="324"
            height="64"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="44" y="146" fill="#fde68a" fontSize="9" fontWeight="800">
            ✏️ NICKNAME SHEET · SYNCED ACROSS ANDROID &amp; WEB
          </text>
          <text x="44" y="166" fill="#ffffff" fontSize="9.5" fontWeight="700">
            Peer Nickname: &quot;My KuchuPuchu 💙&quot; · Your Nickname: &quot;Captain&quot;
          </text>
        </svg>
      );

    case "view-once-media":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#fde68a" fontSize="9.5" fontWeight="800">
            VIEW-ONCE (1×) EPHEMERAL PHOTOS, VIDEOS &amp; VOICE
          </text>
          <rect
            x="28"
            y="54"
            width="152"
            height="132"
            rx="14"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.6"
          />
          <circle
            cx="104"
            cy="102"
            r="24"
            fill="#172e58"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeDasharray="5 3"
          />
          <text x="93" y="108" fill="#fde68a" fontSize="15" fontWeight="800">
            1×
          </text>
          <text x="52" y="146" fill="#ffffff" fontSize="9.5" fontWeight="700">
            View-Once Media
          </text>
          <text x="44" y="164" fill="#93c5fd" fontSize="8">
            Tap to open · Screenshot blocked
          </text>

          <rect
            x="200"
            y="54"
            width="152"
            height="132"
            rx="14"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <circle cx="276" cy="102" r="24" fill="#112240" stroke="#64748b" strokeWidth="2" />
          <text x="268" y="108" fill="#94a3b8" fontSize="14" fontWeight="800">
            ✓
          </text>
          <text x="234" y="146" fill="#cbd5e1" fontSize="9.5" fontWeight="700">
            Opened · Erased
          </text>
          <text x="218" y="164" fill="#6ee7b7" fontSize="8">
            R2 ciphertext wiped on close
          </text>
        </svg>
      );

    case "media-studio":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="28" y="36" fill="#7dd3fc" fontSize="9.5" fontWeight="800">
            BUILT-IN PHOTO &amp; VIDEO STUDIO · CROP · DRAW · TEXT · TRIM
          </text>
          <rect
            x="28"
            y="48"
            width="210"
            height="110"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeDasharray="6 3"
          />
          <path
            d="M52 126 Q95 68 142 112 T214 82"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <rect x="78" y="64" width="96" height="24" rx="6" fill="#1d4ed8" />
          <text x="88" y="80" fill="#ffffff" fontSize="8.5" fontWeight="800">
            ✨ Sunset Vibes
          </text>

          <rect
            x="250"
            y="48"
            width="102"
            height="110"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.45"
          />
          <text x="262" y="70" fill="#fde68a" fontSize="8.5" fontWeight="700">
            🛠 STUDIO TOOLS
          </text>
          <text x="262" y="90" fill="#e2e8f0" fontSize="8">
            📐 crop / rotate
          </text>
          <text x="262" y="108" fill="#e2e8f0" fontSize="8">
            🖌 neon brush
          </text>
          <text x="262" y="126" fill="#e2e8f0" fontSize="8">
            🔤 text sticker
          </text>
          <text x="262" y="144" fill="#e2e8f0" fontSize="8">
            🎬 video trim
          </text>

          <rect
            x="28"
            y="168"
            width="324"
            height="24"
            rx="7"
            fill="#09152b"
            stroke="#f59e0b"
            strokeOpacity="0.5"
          />
          <text x="42" y="184" fill="#fde68a" fontSize="8.5" fontWeight="700">
            🎞 Video Timeline: [00:02 ━━━━━━━━●━━ 00:18] · AttachmentExitGate Protected
          </text>
        </svg>
      );

    case "voice-notes":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#93c5fd" fontSize="9.5" fontWeight="800">
            VOICE NOTES · 48-BAR WAVEFORM SCRUBBING · SPEED CONTROL
          </text>
          <rect
            x="28"
            y="54"
            width="324"
            height="72"
            rx="16"
            fill="#162e58"
            stroke="#60a5fa"
            strokeOpacity="0.55"
          />
          <circle cx="58" cy="90" r="18" fill="#2563eb" />
          <polygon points="53,81 53,99 68,90" fill="#ffffff" />
          <g fill="#fbbf24">
            <rect x="90" y="78" width="4" height="24" rx="2" />
            <rect x="98" y="70" width="4" height="40" rx="2" />
            <rect x="106" y="74" width="4" height="32" rx="2" />
            <rect x="114" y="64" width="4" height="52" rx="2" />
            <rect x="122" y="72" width="4" height="36" rx="2" />
            <rect x="130" y="68" width="4" height="44" rx="2" />
            <rect x="138" y="76" width="4" height="28" rx="2" />
            <rect x="146" y="62" width="4" height="56" rx="2" />
            <rect x="154" y="70" width="4" height="40" rx="2" />
            <rect x="162" y="74" width="4" height="32" rx="2" />
          </g>
          <g fill="#60a5fa" opacity="0.65">
            <rect x="170" y="78" width="4" height="24" rx="2" />
            <rect x="178" y="68" width="4" height="44" rx="2" />
            <rect x="186" y="74" width="4" height="32" rx="2" />
            <rect x="194" y="80" width="4" height="20" rx="2" />
            <rect x="202" y="72" width="4" height="36" rx="2" />
            <rect x="210" y="66" width="4" height="48" rx="2" />
            <rect x="218" y="76" width="4" height="28" rx="2" />
            <rect x="226" y="82" width="4" height="16" rx="2" />
          </g>
          <rect x="284" y="76" width="52" height="28" rx="14" fill="#09152b" stroke="#fbbf24" />
          <text x="296" y="94" fill="#fde68a" fontSize="10" fontWeight="800">
            1.5×
          </text>

          <rect
            x="28"
            y="140"
            width="324"
            height="48"
            rx="12"
            fill="#09152b"
            stroke="#38bdf8"
            strokeOpacity="0.4"
          />
          <text x="44" y="161" fill="#fde68a" fontSize="8.5" fontWeight="700">
            🔒 Slide-Up Mic Lock (Hands-Free)
          </text>
          <text x="44" y="177" fill="#93c5fd" fontSize="8">
            👂 AudioRouter Ear-Proximity Earpiece Switch · 1× / 1.5× / 2× Speed
          </text>
        </svg>
      );

    case "large-files":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#7dd3fc" fontSize="9.5" fontWeight="800">
            UP TO 5 GB MULTIPART R2 UPLOADS &amp; BUILT-IN DOC VIEWER
          </text>
          <rect
            x="28"
            y="52"
            width="324"
            height="68"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <rect x="42" y="66" width="40" height="40" rx="9" fill="#1d4ed8" />
          <text x="49" y="90" fill="#ffffff" fontSize="10" fontWeight="800">
            5GB
          </text>
          <text x="94" y="78" fill="#ffffff" fontSize="9.5" fontWeight="800">
            4K_Master_Archive.zip (4.2 GB)
          </text>
          <rect x="94" y="88" width="200" height="10" rx="5" fill="#1e293b" />
          <rect x="94" y="88" width="168" height="10" rx="5" fill="#38bdf8" />
          <text x="94" y="111" fill="#fde68a" fontSize="8" fontWeight="700">
            8 MB Chunks · 84% · Resumable R2 Stream
          </text>

          <rect
            x="28"
            y="132"
            width="324"
            height="56"
            rx="12"
            fill="#152c55"
            stroke="#fbbf24"
            strokeOpacity="0.45"
          />
          <text x="44" y="153" fill="#fde68a" fontSize="8.5" fontWeight="800">
            📄 BUILT-IN DOCUMENT &amp; MEDIA VIEWER
          </text>
          <text x="44" y="172" fill="#e2e8f0" fontSize="8.5">
            PDF · Source Code · Markdown · JSON/CSV · Multi-page TIFF · Shared Media Tabs
          </text>
        </svg>
      );

    case "stickers-gifs":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#fde68a" fontSize="9.5" fontWeight="800">
            1,150+ STICKERS (10 PACKS) &amp; LIVE GIF ENGINE
          </text>
          <rect x="28" y="50" width="324" height="26" rx="8" fill="#09152b" />
          <text x="40" y="67" fill="#93c5fd" fontSize="8.5" fontWeight="700">
            ⭐ Favorites · 🕒 Recents · 🐻 Koko · 🦊 Blu · 🐼 Mochi · 🎬 GIFs
          </text>

          <rect
            x="28"
            y="86"
            width="74"
            height="64"
            rx="12"
            fill="#162e58"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <text x="52" y="126" fontSize="24">
            🐻
          </text>
          <rect
            x="111"
            y="86"
            width="74"
            height="64"
            rx="12"
            fill="#162e58"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <text x="135" y="126" fontSize="24">
            🦊
          </text>
          <rect
            x="194"
            y="86"
            width="74"
            height="64"
            rx="12"
            fill="#162e58"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <text x="218" y="126" fontSize="24">
            🐼
          </text>
          <rect x="277" y="86" width="75" height="64" rx="12" fill="#1d4ed8" stroke="#fbbf24" />
          <text x="295" y="122" fill="#fde68a" fontSize="14" fontWeight="800">
            GIF
          </text>

          <rect x="28" y="160" width="324" height="30" rx="8" fill="#09152b" />
          <text x="42" y="179" fill="#cbd5e1" fontSize="8.5">
            🔍 Instant sticker &amp; GIF search · Synced across Android &amp; KuchuPuchu Web
          </text>
        </svg>
      );

    case "encrypted-calls":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#34d399"
            strokeOpacity="0.5"
          />
          <rect x="28" y="28" width="184" height="22" rx="11" fill="#064e3b" stroke="#34d399" />
          <text x="40" y="43" fill="#ecfdf5" fontSize="8.5" fontWeight="800">
            🔒 E2EE DTLS-SRTP · 🔑🔥🎧🚀
          </text>

          <rect
            x="28"
            y="58"
            width="210"
            height="92"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <circle cx="133" cy="94" r="20" fill="#1d4ed8" />
          <text x="125" y="100" fill="#ffffff" fontSize="12" fontWeight="800">
            RA
          </text>
          <text x="92" y="134" fill="#e2e8f0" fontSize="9" fontWeight="700">
            Rahi Ahmed · 04:18 HD
          </text>

          <rect
            x="250"
            y="58"
            width="102"
            height="92"
            rx="12"
            fill="#162e58"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="266" y="96" fill="#fde68a" fontSize="9" fontWeight="700">
            📱 You (PiP)
          </text>
          <text x="262" y="114" fill="#93c5fd" fontSize="8">
            Front Cam 60fps
          </text>

          <rect
            x="58"
            y="160"
            width="264"
            height="34"
            rx="17"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <circle cx="96" cy="177" r="11" fill="#1e3a8a" />
          <circle cx="148" cy="177" r="11" fill="#1e3a8a" />
          <circle cx="200" cy="177" r="11" fill="#1e3a8a" />
          <circle cx="268" cy="177" r="12" fill="#e11d48" />
        </svg>
      );

    case "screen-share-audio":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#7dd3fc" fontSize="9.5" fontWeight="800">
            LIVE SCREEN SHARE + SYSTEM AUDIO TAP &amp; VOICE ISOLATION
          </text>
          <rect
            x="28"
            y="52"
            width="196"
            height="136"
            rx="12"
            fill="#09152b"
            stroke="#38bdf8"
            strokeOpacity="0.6"
          />
          <text x="42" y="74" fill="#38bdf8" fontSize="8.5" fontWeight="800">
            🖥 LIVE SCREEN CAST (60 FPS)
          </text>
          <rect x="42" y="84" width="168" height="60" rx="8" fill="#152c55" />
          <text x="54" y="112" fill="#ffffff" fontSize="8.5" fontWeight="700">
            Sharing App Window + Audio
          </text>
          <text x="54" y="128" fill="#fde68a" fontSize="8">
            🔊 SystemAudioTap Stereo Stream
          </text>
          <text x="42" y="168" fill="#93c5fd" fontSize="8">
            KpScreenCapturer · Android &amp; Web
          </text>

          <rect
            x="238"
            y="52"
            width="114"
            height="136"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="250" y="74" fill="#fde68a" fontSize="8.5" fontWeight="800">
            🎙 VOICE ISOLATION
          </text>
          <rect x="250" y="90" width="90" height="32" rx="8" fill="#065f46" />
          <text x="258" y="110" fill="#ecfdf5" fontSize="8.5" fontWeight="700">
            Noise Cut: -38 dB
          </text>
          <text x="250" y="144" fill="#cbd5e1" fontSize="7.5">
            Strips fan, wind &amp;
          </text>
          <text x="250" y="156" fill="#cbd5e1" fontSize="7.5">
            street background
          </text>
          <text x="250" y="168" fill="#6ee7b7" fontSize="7.5" fontWeight="700">
            ✓ Crystal Voice
          </text>
        </svg>
      );

    case "status-stories":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#fde68a" fontSize="9.5" fontWeight="800">
            24-HOUR STATUS STORIES · PHOTO, VIDEO &amp; COLOR CARDS
          </text>
          <circle
            cx="62"
            cy="96"
            r="26"
            fill="#09152b"
            stroke="#38bdf8"
            strokeWidth="3.5"
            strokeDasharray="16 4"
          />
          <circle cx="62" cy="96" r="19" fill="#1d4ed8" />
          <text x="55" y="101" fill="#ffffff" fontSize="11" fontWeight="800">
            +
          </text>
          <text x="40" y="138" fill="#e2e8f0" fontSize="8" fontWeight="700">
            My Status
          </text>

          <circle
            cx="132"
            cy="96"
            r="26"
            fill="#09152b"
            stroke="#fbbf24"
            strokeWidth="3.5"
            strokeDasharray="22 5"
          />
          <circle cx="132" cy="96" r="19" fill="#0284c7" />
          <text x="124" y="101" fill="#ffffff" fontSize="10" fontWeight="800">
            NI
          </text>
          <text x="116" y="138" fill="#fde68a" fontSize="8" fontWeight="700">
            Nadia
          </text>

          <rect
            x="184"
            y="54"
            width="168"
            height="132"
            rx="14"
            fill="#162e58"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <rect x="196" y="64" width="144" height="4" rx="2" fill="#fbbf24" />
          <text x="200" y="88" fill="#ffffff" fontSize="9.5" fontWeight="800">
            Chattogram Sunset 🌅
          </text>
          <text x="200" y="106" fill="#93c5fd" fontSize="8">
            5s Auto-Advance · Hold to Pause
          </text>
          <rect x="196" y="148" width="144" height="24" rx="12" fill="#09152b" />
          <text x="208" y="164" fill="#fde68a" fontSize="8" fontWeight="700">
            👁 14 Viewers · ❤️ 🔥 👏 Reply…
          </text>
        </svg>
      );

    case "group-chats":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#93c5fd" fontSize="9.5" fontWeight="800">
            GROUP CHATS · OWNER ADMIN CONTROLS &amp; SHARED MEDIA
          </text>
          <rect
            x="28"
            y="50"
            width="324"
            height="46"
            rx="12"
            fill="#162e58"
            stroke="#fbbf24"
            strokeOpacity="0.5"
          />
          <circle cx="52" cy="73" r="14" fill="#2563eb" />
          <text x="76" y="70" fill="#ffffff" fontSize="10" fontWeight="800">
            Product Launch Squad (18 Members)
          </text>
          <text x="76" y="85" fill="#fde68a" fontSize="8" fontWeight="700">
            👑 Owner Theme Lock · @mentions · Live Group Typing
          </text>

          <rect
            x="28"
            y="106"
            width="324"
            height="82"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.4"
          />
          <text x="44" y="128" fill="#ffffff" fontSize="9" fontWeight="700">
            👑 Rabbi Hossain (Owner) · [Manage Group]
          </text>
          <text x="44" y="148" fill="#93c5fd" fontSize="8.5">
            👤 Rahi Ahmed · Member · [Remove]
          </text>
          <text x="44" y="168" fill="#6ee7b7" fontSize="8.5" fontWeight="700">
            ➕ Add Members · Shared Group Media Gallery
          </text>
        </svg>
      );

    case "flag-secure":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <text x="28" y="38" fill="#fde68a" fontSize="9.5" fontWeight="800">
            PRIVATE PROFILE SHIELD &amp; ANDROID FLAG_SECURE
          </text>
          <rect
            x="28"
            y="54"
            width="154"
            height="132"
            rx="14"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.6"
          />
          <circle cx="105" cy="100" r="24" fill="#1d4ed8" stroke="#fbbf24" strokeWidth="2.5" />
          <text x="95" y="106" fill="#ffffff" fontSize="12" fontWeight="800">
            🛡️
          </text>
          <text x="46" y="144" fill="#ffffff" fontSize="9" fontWeight="800">
            Private Profile ON
          </text>
          <text x="44" y="162" fill="#93c5fd" fontSize="8">
            Disables Save &amp; Forward
          </text>

          <rect
            x="198"
            y="54"
            width="154"
            height="132"
            rx="14"
            fill="#09152b"
            stroke="#f43f5e"
            strokeOpacity="0.6"
          />
          <circle cx="275" cy="100" r="24" fill="#4c0519" stroke="#f43f5e" strokeWidth="2.5" />
          <line x1="258" y1="83" x2="292" y2="117" stroke="#fda4af" strokeWidth="3" />
          <text x="214" y="144" fill="#fda4af" fontSize="9" fontWeight="800">
            Screenshot Blocked
          </text>
          <text x="212" y="162" fill="#cbd5e1" fontSize="8">
            FLAG_SECURE hardware lock
          </text>
        </svg>
      );

    case "sim-auth-otp":
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#60a5fa"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#93c5fd" fontSize="9.5" fontWeight="800">
            SIM-AWARE AUTH · COMPACT 6-DIGIT OTP + COPY · GOOGLE LINK
          </text>
          <rect
            x="28"
            y="52"
            width="144"
            height="134"
            rx="12"
            fill="#09152b"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="42" y="74" fill="#7dd3fc" fontSize="8.5" fontWeight="800">
            📱 ANDROID SIM VERIFY
          </text>
          <rect x="42" y="86" width="116" height="28" rx="7" fill="#162e58" />
          <text x="50" y="104" fill="#ffffff" fontSize="8.5" fontWeight="700">
            SIM 1: +880 17•• ••••
          </text>
          <rect x="42" y="124" width="116" height="28" rx="7" fill="#065f46" />
          <text x="50" y="142" fill="#ecfdf5" fontSize="8" fontWeight="700">
            ✓ Google Recovery Linked
          </text>

          <rect
            x="188"
            y="52"
            width="164"
            height="134"
            rx="12"
            fill="#09152b"
            stroke="#fbbf24"
            strokeOpacity="0.6"
          />
          <text x="202" y="74" fill="#fde68a" fontSize="8.5" fontWeight="800">
            💻 WEB LOGIN APPROVAL
          </text>
          <rect
            x="202"
            y="86"
            width="136"
            height="32"
            rx="8"
            fill="#152c55"
            stroke="#fbbf24"
            strokeOpacity="0.6"
          />
          <text
            x="212"
            y="106"
            fill="#fde68a"
            fontSize="11"
            fontWeight="800"
            fontFamily="monospace"
          >
            482 910
          </text>
          <rect x="286" y="92" width="44" height="20" rx="5" fill="#2563eb" />
          <text x="296" y="105" fill="#ffffff" fontSize="8" fontWeight="800">
            Copy
          </text>
          <rect x="202" y="132" width="64" height="26" rx="7" fill="#059669" />
          <text x="215" y="149" fill="#ffffff" fontSize="8.5" fontWeight="800">
            Approve
          </text>
          <rect x="274" y="132" width="64" height="26" rx="7" fill="#be123c" />
          <text x="294" y="149" fill="#ffffff" fontSize="8.5" fontWeight="800">
            Deny
          </text>
        </svg>
      );

    case "ai-push-ota":
    default:
      return (
        <svg viewBox="0 0 380 220" className="kp-banner-svg" aria-hidden="true">
          <rect
            x="12"
            y="14"
            width="356"
            height="192"
            rx="16"
            fill="#102242"
            stroke="#38bdf8"
            strokeOpacity="0.5"
          />
          <text x="28" y="38" fill="#7dd3fc" fontSize="9.5" fontWeight="800">
            KUCHUPUCHU AI (GOOGLE GEMINI) · SEALED PUSH · OTA UPDATER
          </text>
          <rect
            x="28"
            y="52"
            width="324"
            height="62"
            rx="12"
            fill="#162e58"
            stroke="#fbbf24"
            strokeOpacity="0.55"
          />
          <circle cx="54" cy="83" r="16" fill="#2563eb" />
          <text x="46" y="88" fill="#ffffff" fontSize="11" fontWeight="800">
            AI
          </text>
          <text x="80" y="76" fill="#fde68a" fontSize="9.5" fontWeight="800">
            KuchuPuchu AI ✓ · Powered by Google Gemini
          </text>
          <text x="80" y="95" fill="#e2e8f0" fontSize="8.5">
            Bangla, Banglish &amp; English · Session History · Image Q&amp;A
          </text>

          <rect
            x="28"
            y="124"
            width="156"
            height="64"
            rx="12"
            fill="#09152b"
            stroke="#60a5fa"
            strokeOpacity="0.45"
          />
          <text x="40" y="146" fill="#93c5fd" fontSize="8.5" fontWeight="800">
            🔔 PUSHSEAL &amp; CAMERA
          </text>
          <text x="40" y="164" fill="#cbd5e1" fontSize="8">
            Zero-knowledge sealed push
          </text>
          <text x="40" y="177" fill="#cbd5e1" fontSize="8">
            + Launcher Camera &amp; Share
          </text>

          <rect
            x="196"
            y="124"
            width="156"
            height="64"
            rx="12"
            fill="#09152b"
            stroke="#34d399"
            strokeOpacity="0.5"
          />
          <text x="208" y="146" fill="#6ee7b7" fontSize="8.5" fontWeight="800">
            📲 IN-APP OTA UPDATER
          </text>
          <rect x="208" y="156" width="132" height="10" rx="5" fill="#065f46" />
          <rect x="208" y="156" width="118" height="10" rx="5" fill="#34d399" />
          <text x="208" y="179" fill="#a7f3d0" fontSize="8">
            KpUpdate R2 signed APK ready
          </text>
        </svg>
      );
  }
}

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

export function AllAndroidFeatureBanners({
  category = "all",
  heading = "Every feature built into KuchuPuchu Android & Web",
  subheading = "All 24 features from the KuchuPuchu Android app and Web platform — each presented as its own dedicated 3D Skeuomorphic visual banner with custom diagram and step-by-step guide.",
}: {
  category?: FeatureBannerCategory;
  heading?: string;
  subheading?: string;
}) {
  const items =
    category === "all" || category === "overview" || category === "features"
      ? FEATURE_BANNERS
      : FEATURE_BANNERS.filter((item) => item.categories.includes(category));

  return (
    <section className="kp-feature-banners" aria-label={heading}>
      <div className="kp-section-head">
        <p className="eyebrow">
          3D SKEUOMORPHIC VISUAL FEATURE BANNERS ({items.length} DEDICATED BANNERS)
        </p>
        <h2>{heading}</h2>
        <p className="kp-section-sub">{subheading}</p>
      </div>

      {items.map((banner, idx) => (
        <article
          key={banner.id}
          id={`banner-${banner.id}`}
          className={`kp-feature-banner${idx % 2 === 1 ? " kp-feature-banner--reverse" : ""}`}
        >
          <div className="kp-feature-banner__copy">
            <span className="kp-banner-badge">
              BANNER {banner.number} · {banner.badge} · {banner.modules}
            </span>
            <h3>{banner.title}</h3>
            <p>{banner.subtitle}</p>
            <ol className="kp-step-list">
              {banner.steps.map((step, stepIdx) => (
                <li key={stepIdx}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="kp-feature-banner__art" aria-hidden="true">
            <BannerVisual id={banner.id} />
          </div>
        </article>
      ))}
    </section>
  );
}

export function AndroidMasterFeatureGrid() {
  return <AllAndroidFeatureBanners category="all" />;
}
