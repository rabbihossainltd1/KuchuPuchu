# Authority-owned FCM registration / website avatar bridge

After cutover `/api/devices` is handled by the shared communication core, but FCM credentials deliberately remain on the KP edge. The old private relay looked up recipient tokens in the frozen edge database, so fresh registrations never received calls/messages while the app was not polling.

The authority now reads its own recipient registrations and includes `deviceTokens` in the existing server-to-server authenticated relay. The edge validates shape/bounds, deduplicates and sends to these exact tokens. An explicitly empty authority list cannot fall back to stale edge devices. Old relay callers without this optional field retain old semantics. Bearer/key, device tokens, SDP and ICE secrets are never exposed to a browser or included in audit output. No FCM-key copying/new project/always-on native service.

Optional signed `avatarUrl` on the Laravel VX assertion accepts only existing safe raster data-URI policy and ≤80 KB. Provisioning updates only that resolved VX identity, bumps the avatar version on change, preserves existing photos when omitted, and clears only on explicit signed null. Existing blocked/contact/privacy avatar checks are untouched. Originals stay in website R2; the core's small JPEG copy is compatible with existing KP/VX avatar clients.

Case 130 drives two real Worker modules against separate DBs: authority registration vs stale edge registration, private relay authentication and malformed input, explicit empty list, backward compatibility, actual message/call FCM payload, signed photo retrieval from KP, omitted photo preservation, unsafe media rejection and explicit removal. Full contracts: 112/112 /4151 assertions, format/typecheck passed. The same scenario also runs against the narrowly patched live-format bundles before upload.

Production patching must keep bindings/secrets/assets/settings and unrelated code intact; verify fresh baseline and exact uploaded bytes. Android source/version stays v304 /3.9.227. Actual handset background delivery/connectivity is not certified by these tests.
