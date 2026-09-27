# r76-26 অডিট: যেখানে অ্যাপ abrupt (animation/haptics দরকার)

স্ক্যান: ChatScreen, ChatListScreen, MediaViewer, StatusScreens, SettingsScreen, KpApp (NavHost), Ui.kt।
✅ = আগে থেকেই ঠিক আছে (ধরার দরকার নেই)। 🔧 = করা দরকার।

## আগে থেকেই ঠিক আছে (তালিকা পূর্ণতার জন্য)

| # | জায়গা | অবস্থা |
|---|-------|--------|
| ✅ | স্ক্রিন ট্রানজিশন (NavHost) | fade + slide (KpApp.kt:205) আছে |
| ✅ | সব bottom sheet (KpSheet/KpConfirmSheet) | ModalBottomSheet-এর নিজস্ব slide আছে |
| ✅ | টগল সুইচ (সব স্ক্রিনে) | AnimatedToggleSwitch, r76-23 থেকে app-wide |
| ✅ | মেসেজ arrival flight | r76-25 FlightAnims (swap-proof, once-per-key) |
| ✅ | ভয়েস রেকর্ড hold-bar/locked panel | r76-1 geometry + animation |
| ✅ | ছবি লোড | Coil crossfade(true) + shimmer placeholder |
| ✅ | Double-tap zoom | spring walk (v165/v166) |
| ✅ | রিঅ্যাকশন arc + buzz | r67 |
| ✅ | টাইপিং ডটস | realtime, r55 |

## 🔧 Animation দরকার (abrupt জায়গা)

| # | জায়গা | এখন যা হয় | যা দরকার | Haptic? |
|---|-------|-----------|----------|---------|
| 1 | ছবি/ভিডিও ভিউয়ার খোলা (MediaViewer.kt:275 `Dialog(`) | ফুলস্ক্রিন Dialog হুট করে বসে যায় | thumbnail থেকে scale+fade hero transition (~250ms) | হালকা tick খোলার সময় |
| 2 | স্ট্যাটাস ভিউয়ার (StatusScreens.kt:344, 1360) | একই — হার্ড pop | একই hero fade+scale | tick |
| 3 | এডিট-মেসেজ ডায়ালগ (ChatScreen.kt:6397) | হার্ড pop | fade + 0.95→1.0 scale | — |
| 4 | চ্যাট লিস্টে pin/unpin/delete/reorder | LazyColumn-এ `animateItem` নেই — সারি লাফ দেয় | `animateItem()` (fade+slide), delete-এ collapse | delete-এ soft thud |
| 5 | অ্যাটাচ প্যানেল (ক্লিপ/গ্যালারি/ডক গ্রিড) | শর্ত সাপেক্ষে হুট করে আসে (AnimatedVisibility নেই) | slide-up + fade (~200ms), ক্লোজে উল্টোটা | — |
| 6 | ইমোজি/স্টিকার শিট খোলা-বন্ধ | শিট ঠিকই slide করে, কিন্তু চ্যাট এরিয়া resize লাফ দেয় | IME-এর মতো smooth height animation | — |
| 7 | রিপ্লাই কোট-বার (compose box-এর উপরে) | হুট করে আসে/যায় | slide-down + fade | কোট খোলার সময় tick |
| 8 | মাল্টি-সিলেক্ট মোডের টপ-বার | সাধারণ বার হুট করে বদলে যায় | fade-through (crossfade 180ms) | প্রথম টিকে tick (আছে), মোডে ঢোকা/বেরোনোয় tick |
| 9 | আনরিড ব্যাজ কাউন্ট | নতুন সংখ্যা pop করে | scale-in spring (~200ms) + সংখ্যা বদলে fade | — |
| 10 | online/offline সবুজ ডট | রং হুট করে বদলায় | color crossfade 300ms | — |
| 11 | থিম/ওয়ালপেপার বদল | instant swap | crossfade 350ms | — |
| 12 | "Message deleted" chip (delete for everyone) | সারি হুট করে বদলায় | fade-through | soft |
| 13 | নোটিফিকেশন-পারমিশন ব্যানার | হুট করে নামে | slide-down + fade | — |
| 14 | সেভ সফল টোস্ট (Saved to Pictures) | সিস্টেম Toast (স্টাইল করা যায় না) | ছোট কাস্টম snackbar slide-in | success tick |
| 15 | ভিউ-ওয়ান্স খোলার পর VANISHED হয়ে সারি মিলিয়ে যাওয়া | সারি হুট করে উধাও | fade + collapse (~250ms) | — |

## 🔧 Haptic দরকার (কম্পন এখন নেই)

| # | জায়গা | কী কম্পন |
|---|-------|----------|
| 1 | মিডিয়া সেভ সফল (ফটো+ভিডিও) | success tick (MediaViewer-এ মাত্র ২টা haptic কল আছে) |
| 2 | মিডিয়া ভিউয়ার নিচে টেনে বন্ধ — থ্রেশহোল্ড ছোঁয়ার মুহূর্তে | light tick |
| 3 | পাসফ্রেজ ব্যাকআপ সেভ/আনলক সফল | success tick |
| 4 | স্ক্রিনশট-অ্যালার্ট নোটিফিকেশন কার্ডে ট্যাপ | tap (কার্ডে এখন নেই) |
| 5 | চ্যাট লিস্ট সারি swipe-archive থ্রেশহোল্ড | light tick |

## এই রাউন্ডেই ঠিক হয়ে গেছে (r76-26)

- সাব-সুইচ দুটো (Screenshot alert / Screen record alert) এক লাইনে — toggle এখন ডান প্রান্তে ফিক্সড।
- GIF-এর নোটিফিকেশন/প্রিভিউ "Photo" নয়, "GIF"।
- Owner-এর view-once মিডিয়া সেভ — viewer এখন নিজের ফেচ করা বাইট থেকেই সেভ করে (দ্বিতীয় ডাউনলোডের 410 error আর হয় না)।
- অ্যানিমেটর-স্কেল binder রিড ক্যাশ (প্রতি সারির composition-এ Settings কল বন্ধ) — লিস্ট স্ক্রল হালকা।
- পাসফ্রেজ-লকড key backup — reinstall/নতুন ফোনে পুরনো মেসেজ আনলক।
