# KP cold push audit /305 candidate

Owner: Realme, build304. Home/recent delivery works; recents swipe delivery fails. No force-stop reported. Latency issue is owner-confirmed solved.

Source finding: build304 ships runtime Firebase options, no google-services resource, and initializes FirebaseApp from MainActivity/KpPush.tryInit only. No Application subclass restores the default FirebaseApp when FCM launches a fresh process with no Activity. New305 candidate caches only four public Firebase identifiers after valid initialization, restores synchronously without network in Application.onCreate, and ensures notification channels there. No session/FCM token/service-account credentials in this config. Existing high-priority handler, encryption, mute, privacy and rich notification logic remain unchanged.

This is a cold-start robustness fix, not handset certification or proof that Realme's auto-launch policy permits delivery. A new signed update and real recents-swipe test are required. No Worker push/proxy policy change in this candidate.
