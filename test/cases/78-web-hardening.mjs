// Slice I (hardening) static pins. The behaviour itself is proven by the
// browser suites (web/e2e-hardening/*): this case stops the SUPPORTING
// contracts from silently drifting back — the same discipline case 55 applies
// to the legacy PWA.
//
//  1. Both web clients read the conversation list from the Worker's real
//     { items } wrapper (production incident 2026-10-09: a stale key rendered
//     an empty list while the server answered 200).
//  2. The E2E mocks serve the same { items } shape — a mock that repeats a
//     removed key makes suites pass against a contract the server never had.
//  3. The React shell ships a Content-Security-Policy: same-origin app, one
//     allowlisted third party (Google Identity Services), no inline scripts.
//  4. Every https origin the clients reference is covered by that policy.
//  5. Account isolation: any sign-out (manual or 401-forced) deletes the
//     IndexedDB messaging database.
//  6. Chat themes ride the existing PATCH route; the pane re-skins through
//     CSS custom properties only.

import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const protocol = read("../../web/src/messaging/protocol.ts");
const legacyApp = read("../../public/app.js");
const messagingHelpers = read("../../web/e2e-messaging/helpers.ts");
const callsHelpers = read("../../web/e2e-calls/helpers.ts");
const statusHelpers = read("../../web/e2e-status/helpers.ts");
const forwardSpec = read("../../web/e2e-messaging/forward.spec.ts");
const indexHtml = read("../../web/index.html");
const authContext = read("../../web/src/auth/AuthContext.tsx");
const outbox = read("../../web/src/messaging/outbox.ts");
const messagingApi = read("../../web/src/messaging/messagingApi.ts");
const chatPane = read("../../web/src/messaging/ChatPane.tsx");
const chatTheme = read("../../web/src/messaging/chatTheme.ts");
const appTheme = read("../../web/src/theme/appTheme.ts");

// 1. clients read the real wrapper
check(
  "react client parses the list from payload.items",
  /payload\.items/.test(protocol) && !/payload\.conversations/.test(protocol),
);
check(
  "legacy client parses the list from r.items",
  /state\.convs = \(r\.items \|\| \[\]/.test(legacyApp) && !legacyApp.includes("r.conversations"),
);

// 2. mocks speak the server's shape
check(
  "messaging mock serves { items }",
  messagingHelpers.includes("json(route, { items: conversations })"),
);
check("calls mock serves { items }", callsHelpers.includes("items: conversationsFor("));
check("status mock serves { items }", statusHelpers.includes("{ items: [] }"));
check("forward spec override serves { items }", forwardSpec.includes("items: ["));

// 3. the CSP contract — slice J: the CSP moved from a <meta> tag to the
// Worker's assets rules header (frame-ancestors is impossible in meta), so
// the single source of truth is wrangler.toml.
const wranglerToml = read("../../wrangler.toml");
const cspMatch = wranglerToml.match(/Content-Security-Policy = "([^"]+)"/);
const csp = cspMatch?.[1] ?? "";
check("the assets rules ship a server CSP", csp !== "", csp.slice(0, 60));
check(
  "the react shell no longer carries a meta CSP (one source of truth)",
  !/http-equiv="Content-Security-Policy"/i.test(indexHtml),
);
check(
  "frame-ancestors is now enforced (deploy-day promise from slice I)",
  /frame-ancestors 'self'/.test(csp),
);
check("default-src is same-origin", /default-src 'self'/.test(csp));
check(
  "scripts come only from the app and Google Identity Services",
  /script-src 'self' https:\/\/accounts\.google\.com/.test(csp) &&
    !/script-src[^;]*'unsafe-inline'/.test(csp) &&
    !/script-src[^;]*'unsafe-eval'/.test(csp),
);
check("no plugins ever", /object-src 'none'/.test(csp));
check(
  "connections stay same-origin (sockets included) plus GSI",
  /connect-src 'self' ws: wss: https:\/\/accounts\.google\.com/.test(csp),
);
check(
  "navigations cannot leave the origin",
  /form-action 'self'/.test(csp) && /base-uri 'self'/.test(csp),
);

// 4. every https origin the clients reference is allowlisted by the CSP
const clientSources = [legacyApp, read("../../public/index.html"), indexHtml];
for (const [name, src] of [
  ["web/src/auth", read("../../web/src/auth/authApi.ts")],
  ["web/src/auth/google", read("../../web/src/auth/GoogleIdentityButton.tsx")],
]) {
  clientSources.push(src);
  void name;
}
const origins = new Set();
for (const src of clientSources) {
  for (const m of src.matchAll(/https:\/\/([a-z0-9.-]+)(?:[/:?]|["'])/gi)) {
    origins.add(m[1].toLowerCase());
  }
}
const covered = [...origins].every((origin) => csp.includes(origin));
check("every referenced https origin is covered by the CSP", covered, [...origins].join(", "));

// 5. account isolation
check(
  "the messaging database is deleted on sign-out",
  authContext.includes("deleteMessagingDatabase()") &&
    /export function deleteMessagingDatabase/.test(outbox),
);
check(
  "the delete is best-effort (a blocked handle never stops sign-out)",
  outbox.includes("request.onblocked = () => resolve()"),
);

// 6. chat theme parity
check(
  "chat themes PATCH through the existing Worker route",
  messagingApi.includes("async setConversationTheme") &&
    /body: JSON\.stringify\(\{ theme \}\)/.test(messagingApi),
);
check(
  "the pane re-skins through CSS custom properties",
  chatPane.includes("chatThemeCssVars") && chatTheme.includes("--chat-wallpaper"),
);
check(
  "the five Android palettes are all present",
  ["darkblue", "default", "mint", "rose", "night"].every((t) => chatTheme.includes(`"${t}"`)),
);
check(
  "the appearance switch persists device-local like Android's SharedPreferences",
  appTheme.includes('APP_THEME_STORAGE_KEY = "kp.app_theme"'),
);

console.log(lines.join("\n"));
