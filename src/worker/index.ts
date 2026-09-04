/* KuchuPuchu v3 — WhatsApp-style messenger backend.
 * Locked designs: see ARCHITECTURE-v3.md. Voice/video calls are separate flows.
 * Push: FCM data messages (Messenger mode — no foreground service needed).
 * Files: R2 bucket `kp-media` (worker-mediated upload/download).
 */

import {
  BIO_MAX_LENGTH,
  LOGIN_REQUEST_TTL_MS,
  MESSAGE_MAX_LENGTH,
  ONLINE_WINDOW_MS,
  PENDING_SIGNUP_TTL_MS,
  RECOVERY_REQUEST_TTL_MS,
  SESSION_TTL_MS,
} from "../shared/constants.js";

// Durable Object classes this worker exports (see wrangler.toml bindings).
// Re-exported here because src/worker/index.ts is the upload entrypoint.
export { ChatRoom } from "./durable-objects/ChatRoom.js";
export { CallSignal } from "./durable-objects/CallSignal.js";

export type Env = {
  DB: D1Database;
  MEDIA?: R2Bucket;
  FCM_CONFIG?: string;
  FCM_CREDENTIALS?: string;
  /** Optional self-hosted/purchased TURN for reliable calls on strict NATs.
   *  Comma-separated URLs, e.g. "turn:turn.example.com:3478,turns:turn.example.com:5349". */
  TURN_URLS?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
  /** Cloudflare Realtime TURN (ex-"Calls"): key id + an API token holding
   *  Realtime Edit; /api/config/ice mints + caches short-lived credentials. */
  TURN_KEY_ID?: string;
  /** Shared key for GET /api/debug/errors (worker-side crash log). */
  DEBUG_KEY?: string;
  /** Base URL the hourly cron probes to measure §52's "backend latency" (see
   * probeBackendLatency). Config, not a secret, and deliberately not hardcoded: a
   * preview/alternative origin probes its own health endpoint instead. */
  SELF_ORIGIN?: string;
  TURN_API_TOKEN?: string;
  /** Realtime fan-out Durable Objects (Steps 2-3). Optional on purpose: the
   *  test harness and any deploy without the bindings keep the plain REST
   *  path — every broadcast call guards on presence and no-ops without it. */
  CHAT_ROOM?: DurableObjectNamespace;
  CALL_SIGNAL?: DurableObjectNamespace;
  /** Phone-auth Google binding: the OAuth 2.0 Web Client ID from the Firebase
   *  console (Authentication → Sign-in method → Google). The Android client
   *  gets it from /api/config/firebase and Credential Manager mints ID tokens
   *  with `aud` = this value; the worker rejects any token whose `aud` differs.
   *  Unset ⇒ google/bind and recovery answer 503 — fail-closed on purpose: a
   *  misconfigured deploy must break login loudly, never silently skip the
   *  audience check. */
  GOOGLE_WEB_CLIENT_ID?: string;
  /** Gemini API key (AI Studio) — powers the KuchuPuchu AI welcome message.
   *  Unset ⇒ the welcome falls back to a fixed friendly line, never a hole. */
  GEMINI_API_KEY?: string;
};

type Json = Record<string, unknown>;

/* ---------------- helpers ---------------- */

class ApiError extends Error {
  status: number;
  code: string;
  /** Set for the responses a client should back off for (429/503). */
  retryAfter?: string;
  constructor(status: number, message: string, code = "CLOUD", retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function json(data: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      ...extra,
    },
  });
}

function fail(status: number, message: string, code?: string, retryAfter?: string): never {
  throw new ApiError(status, message, code, retryAfter);
}

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const pairId = (a: string, b: string) => (a < b ? `c_${a}_${b}` : `c_${b}_${a}`);

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(hash));
}

// Password hashing (PBKDF2) was removed together with the email/password auth
// system: phone auth has no password to store or verify. The `password_hash`
// column stays in the database for the legacy rows that still carry one; no
// route reads it anymore.

/** Length-independent, branch-free comparison — avoids leaking hash bytes by timing. */
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- phone auth (OTP-less) ----------------
 *
 * Replaces the old email/password system. See PHONE_AUTH_PLAN.md for the
 * full mapping of PHONE_AUTH_COMPLETE_SPEC.md onto this repo. In short:
 *
 *  - The client normalizes to E.164 and checks the number against the ones
 *    the active SIMs expose (SubscriptionManager/TelephonyManager), then
 *    reports MATCH / MISMATCH / UNAVAILABLE / NO_SIM / PERMISSION_DENIED.
 *  - MISMATCH (a real, exposed, different number) is always blocked.
 *  - UNAVAILABLE / NO_SIM / PERMISSION_DENIED are allowed through as
 *    DEVICE_ONLY attestation — a deliberate product decision: most BD
 *    carriers never expose the SIM number, so a strict block would lock out
 *    the majority of real users. The new-device approval flow (old device
 *    must Accept) and the MISMATCH block are what keep this safe.
 *  - One account = one ACTIVE device; transfers are atomic D1 batches.
 *  - Every account binds a Google identity (server-verified ID token) for
 *    lost-device recovery; one Google subject maps to one account.
 */

/** Placeholder domain for phone-only accounts. The `users.email` column is
 *  NOT NULL UNIQUE from the legacy schema, so phone signups park a synthetic
 *  address there. It is never exposed to clients (see userSelf) and is
 *  rewritten on phone change to keep the UNIQUE constraint consistent. */
const PHONE_EMAIL_SUFFIX = "@phone.kuchupuchu.invalid";
const phoneEmail = (e164: string) => `${e164}${PHONE_EMAIL_SUFFIX}`;

/**
 * E.164 normalization, BD-first. Accepts 01XXXXXXXXX / 8801XXXXXXXXX /
 * +8801XXXXXXXXX (and generic international numbers with a leading +).
 * The client normalizes too (PhoneVerifier.kt) — both sides MUST agree,
 * and the server can never trust a client claim of "already normalized".
 */
function normalizePhone(raw: unknown): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) fail(400, "Enter your phone number.");
  const digits = trimmed.replace(/[\s\-().]/g, "").replace(/[^0-9+]/g, "");
  const hasPlus = digits.startsWith("+");
  let d = digits.replace(/\+/g, "");
  if (!d) fail(400, "Enter your phone number.");
  if (!hasPlus) {
    // Local form: default region BD. 8801… → 01…, then require a BD mobile.
    if (d.startsWith("880")) d = d.slice(3);
    if (!d.startsWith("0")) d = `0${d}`;
    if (!/^01[3-9]\d{8}$/.test(d))
      fail(400, "Enter a valid Bangladeshi mobile number, e.g. 01712345678.");
    return `+880${d.slice(1)}`;
  }
  if (d.startsWith("880")) {
    if (!/^8801[3-9]\d{8}$/.test(d))
      fail(400, "Enter a valid Bangladeshi mobile number, e.g. +8801712345678.");
    return `+${d}`;
  }
  if (!/^\d{8,15}$/.test(d))
    fail(400, "Enter a valid phone number with the country code, e.g. +8801712345678.");
  return `+${d}`;
}

/** The SIM results the client may report. Anything else is a bad request. */
const SIM_RESULTS = ["MATCH", "MISMATCH", "UNAVAILABLE", "NO_SIM", "PERMISSION_DENIED"] as const;
type SimResult = (typeof SIM_RESULTS)[number];

function parseSimResult(raw: unknown): SimResult {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!(SIM_RESULTS as readonly string[]).includes(v)) fail(400, "Bad phone verification result.");
  return v as SimResult;
}

function parseDeviceId(raw: unknown): string {
  const v = String(raw ?? "")
    .trim()
    .slice(0, 64);
  if (!v) fail(400, "Missing device id.");
  return v;
}

/**
 * Server-side Google ID token verification without any service account key:
 * Google's tokeninfo endpoint validates the signature, and THIS function owns
 * the trust decisions — audience, issuer, expiry. Credential Manager mints the
 * token with `aud` = the Web Client ID, so a token minted for any OTHER app
 * fails the aud check. When GOOGLE_WEB_CLIENT_ID is unset the whole route is
 * 503 — fail closed, never "verify without an audience".
 */
async function verifyGoogleIdToken(env: Env, rawToken: unknown) {
  if (!env.GOOGLE_WEB_CLIENT_ID)
    fail(503, "Google sign-in is not configured on the server.", "GOOGLE_NOT_CONFIGURED");
  const token = String(rawToken ?? "").trim();
  if (!token || token.length > 4096)
    fail(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  let info: Record<string, unknown> | null = null;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    );
    if (res.status === 200) info = (await res.json()) as Record<string, unknown>;
  } catch {
    /* network trouble is indistinguishable from a bad token here — reject */
  }
  if (!info) fail(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  const aud = String(info.aud ?? "");
  const iss = String(info.iss ?? "");
  const sub = String(info.sub ?? "");
  const exp = Number(info.exp ?? 0);
  if (aud !== env.GOOGLE_WEB_CLIENT_ID)
    fail(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com")
    fail(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  if (!sub || exp * 1000 < Date.now() - 60_000)
    fail(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  const email = String(info.email ?? "");
  const verified = info.email_verified === true || info.email_verified === "true";
  return { sub, email: verified ? email : "" };
}

/** Opaque session token + its INSERT statement, pre-hashed so callers can
 *  drop it into an atomic db.batch() alongside the rest of a transfer. */
async function sessionStmt(
  db: D1Database,
  userId: string,
  deviceId: string,
): Promise<{ token: string; stmt: D1PreparedStatement }> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const stmt = db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, device_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(token),
      userId,
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      nowIso(),
      deviceId,
    );
  return { token, stmt };
}

/** The device-transfer half every "activate a new device" path shares:
 *  kill the user's other sessions, revoke any ACTIVE device row, activate
 *  this install, and drop the OLD install's FCM push rows so a transferred
 *  -away phone stops lighting up. Callers put these in ONE batch with the
 *  request-state UPDATE that authorises the transfer — that is what makes
 *  the swap atomic (§15/§18). */
function deviceTransferStmts(
  db: D1Database,
  userId: string,
  deviceId: string,
  deviceName: string | null,
): D1PreparedStatement[] {
  const at = nowIso();
  return [
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `UPDATE auth_devices SET status = 'REVOKED', revoked_at = ?
          WHERE user_id = ? AND status = 'ACTIVE'`,
      )
      .bind(at, userId),
    db
      .prepare(
        `INSERT INTO auth_devices
           (id, user_id, device_id, device_name, status, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
         ON CONFLICT (user_id, device_id) DO UPDATE SET
           status = 'ACTIVE', revoked_at = NULL,
           device_name = COALESCE(excluded.device_name, auth_devices.device_name),
           last_seen_at = excluded.last_seen_at`,
      )
      .bind(id(), userId, deviceId, deviceName, at, at),
    // Old install's push handles die with the transfer. Rows with a NULL
    // device_id predate per-install identity; they cannot be proven to belong
    // to the surviving install, so they go too.
    db
      .prepare(`DELETE FROM devices WHERE user_id = ? AND (device_id IS NULL OR device_id != ?)`)
      .bind(userId, deviceId),
  ];
}

/** Best-effort audit trail (§11 audit_logs). Never blocks a login. */
async function audit(
  db: D1Database,
  event: string,
  userId: string | null,
  deviceId: string | null,
  meta: Record<string, unknown> = {},
) {
  try {
    await run(
      db,
      `INSERT INTO auth_audit (id, user_id, device_id, event, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id(),
      userId,
      deviceId,
      event,
      JSON.stringify(meta).slice(0, 1000),
      nowIso(),
    );
  } catch {
    /* audit must never take a login down */
  }
}

/** Masked phone for logs (§29): never print a full number in tail/console. */
function maskPhone(e164: string) {
  return e164.length <= 5 ? "***" : `${e164.slice(0, 5)}***${e164.slice(-2)}`;
}

/** The official in-app account ("KuchuPuchu") that delivers login-approval
 *  messages (§14, owner design): a real chat message with the device details
 *  and Accept/Decline on it — not a system dialog and not a raw push. */
const OFFICIAL_BOT_ID = "kp_official_bot";

/** The bundled KuchuPuchu logo (256px JPEG data-URI, ~10KB) — the profile
 *  photo of both bot accounts. Avatars live as data-URIs in users.avatar_url
 *  (the same shape a user profile photo has), so every client avatar path
 *  (avatarRef cache → /api/users/:id/avatar) serves it unchanged. */
const BOT_LOGO_DATA_URL =
  "data:image/jpeg;base64,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";

async function ensureOfficialBot(db: D1Database): Promise<string> {
  const existing = await one<{ id: string }>(
    db,
    "SELECT id FROM users WHERE id = ?",
    OFFICIAL_BOT_ID,
  );
  if (existing) {
    // Idempotent badge/photo top-up for databases created before either
    // existed. The WHERE keeps it a no-op write once applied.
    await run(
      db,
      `UPDATE users SET verified = 1, avatar_url = COALESCE(avatar_url, ?)
        WHERE id = ? AND (verified IS NULL OR verified = 0 OR avatar_url IS NULL)`,
      BOT_LOGO_DATA_URL,
      OFFICIAL_BOT_ID,
    );
    return existing.id;
  }
  const created = nowIso();
  // username `kuchupuchu` may already belong to a real user (usernames are
  // first-come); fall back to a reserved one. Either way the DISPLAY name is
  // what the app shows.
  for (const username of ["kuchupuchu", "kuchupuchu_official"]) {
    await run(
      db,
      `INSERT OR IGNORE INTO users
         (id, email, password_hash, username, display_name, avatar_url, about,
          created_at, last_active_at, auth_status, verified)
       VALUES (?, ?, '', ?, 'KuchuPuchu', ?, 'Official account · login & security alerts', ?, ?, 'ACTIVE', 1)`,
      OFFICIAL_BOT_ID,
      "official@kuchupuchu.invalid",
      username,
      BOT_LOGO_DATA_URL,
      created,
      created,
    );
    const row = await one<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", OFFICIAL_BOT_ID);
    if (row) return row.id;
  }
  return OFFICIAL_BOT_ID;
}

/** 1:1 conversation between the bot and a user, created on first use. */
async function officialBotConvId(db: D1Database, botId: string, userId: string) {
  const convId = pairId(botId, userId);
  if (!(await one(db, "SELECT id FROM conversations WHERE id = ?", convId))) {
    const created = nowIso();
    await run(
      db,
      "INSERT OR IGNORE INTO conversations (id, kind, created_at, hidden_json) VALUES (?, 'SOLO', ?, '{}')",
      convId,
      created,
    );
    await run(
      db,
      "INSERT OR IGNORE INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
      convId,
      botId,
      created,
    );
    await run(
      db,
      "INSERT OR IGNORE INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
      convId,
      userId,
      created,
    );
  } else {
    // A deleted chat must resurface for the approval: drop the user's hide
    // watermark exactly like POST /api/conversations does on re-open.
    const hidden = parseJson<Record<string, unknown>>(await hiddenJson(db, convId), {});
    if (hidden[userId] !== undefined) {
      delete hidden[userId];
      await run(
        db,
        "UPDATE conversations SET hidden_json = ? WHERE id = ?",
        JSON.stringify(hidden),
        convId,
      );
    }
  }
  return convId;
}

/** Drops the approval card message into the bot chat and pushes it through
 *  the normal message pipeline, so the old device sees a chat notification
 *  from "KuchuPuchu" whose tap opens the conversation with the buttons. */
async function sendApprovalMessage(
  env: Env,
  db: D1Database,
  ctx: ExecutionContext,
  userId: string,
  requestId: string,
  deviceName: string | null,
  expiresAt: string,
  request: Request,
) {
  const botId = await ensureOfficialBot(db);
  const convId = await officialBotConvId(db, botId, userId);
  const mid = id();
  const created = nowIso();
  const label = deviceName?.trim() || "Another device";
  // Where the attempt came from (owner rule: the card shows everything —
  // device, place, IP, time — so the approver can judge the request).
  const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf;
  const ip = clientIp(request);
  const place = [cf?.city, cf?.country].filter(Boolean).join(", ");
  const where = place ? ` · ${place}` : "";
  const meta = {
    requestId,
    deviceName: label,
    expiresAt,
    status: "PENDING",
    ip,
    city: cf?.city ?? null,
    country: cf?.country ?? null,
    time: created,
  };
  await run(
    db,
    `INSERT INTO messages (id, conv_id, sender_id, kind, body, meta_json, created_at)
     VALUES (?, ?, ?, 'LOGIN_APPROVAL', ?, ?, ?)`,
    mid,
    convId,
    botId,
    `New sign-in attempt on ${label}${where}`,
    JSON.stringify(meta),
    created,
  );
  await run(
    db,
    "UPDATE conversations SET last_message_at = ?, last_message = ? WHERE id = ?",
    created,
    `New sign-in attempt on ${label}${where}`,
    convId,
  );
  await run(
    db,
    "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id = ?",
    convId,
    userId,
  );
  const message = msgFrom({
    id: mid,
    conv_id: convId,
    sender_id: botId,
    kind: "LOGIN_APPROVAL",
    body: `New sign-in attempt on ${label}${where}`,
    media: null,
    meta_json: JSON.stringify(meta),
    created_at: created,
    delivered_at: null,
  } as MsgRow);
  ctx.waitUntil(
    broadcastRoomEvent(env, convId, { type: "message", conversationId: convId, message }),
  );
  ctx.waitUntil(
    broadcastRoomEvent(env, `user:${userId}`, { type: "conv", conversationId: convId }),
  );
  ctx.waitUntil(
    pushToUser(
      env,
      db,
      userId,
      {
        type: "message",
        convoId: convId,
        mid,
        kind: "SOLO",
        fromName: "KuchuPuchu",
        body: `New sign-in attempt on ${label}${where}. Tap to review it.`,
        kp_chat: convId,
        muted: "0",
      },
      {
        title: "KuchuPuchu",
        body: `New sign-in attempt on ${label}${where}. Tap to review it.`,
        channel: "kp_messages_v2",
      },
    ),
  );
}

/** Flips the approval card's status and drops a short follow-up from the bot,
 *  so the conversation reads as a dialogue: request → outcome. */
async function resolveApprovalMessage(db: D1Database, requestId: string, status: string) {
  try {
    const row = await one<{ id: string; conv_id: string }>(
      db,
      `SELECT id, conv_id FROM messages
        WHERE kind = 'LOGIN_APPROVAL' AND json_extract(meta_json, '$.requestId') = ?`,
      requestId,
    );
    if (!row) return;
    await run(
      db,
      `UPDATE messages SET meta_json = json_set(meta_json, '$.status', ?) WHERE id = ?`,
      status,
      row.id,
    );
    const botId = await ensureOfficialBot(db);
    const text =
      status === "APPROVED"
        ? "✅ Login approved — the new device has been signed in."
        : status === "DECLINED"
          ? "⛔ Login request declined. No new device was signed in."
          : "⏰ Login request expired without a response.";
    const mid = id();
    const created = nowIso();
    await run(
      db,
      `INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at)
       VALUES (?, ?, ?, 'TEXT', ?, ?)`,
      mid,
      row.conv_id,
      botId,
      text,
      created,
    );
    await run(
      db,
      "UPDATE conversations SET last_message_at = ?, last_message = ? WHERE id = ?",
      created,
      text,
      row.conv_id,
    );
    await run(
      db,
      "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id != ?",
      row.conv_id,
      botId,
    );
  } catch {
    /* the approval decision itself must never fail because of the card */
  }
}

/* ---------------- KuchuPuchu AI (owner feature) ----------------
 *
 * A second verified bot account, "KuchuPuchu AI", whose first message
 * welcomes every new user the moment their account goes live (at Google
 * bind — the exact moment they land in the app for the first time). The
 * greeting is generated by Gemini when GEMINI_API_KEY is set and falls
 * back to a fixed warm line otherwise, so the welcome never depends on
 * a third-party API being awake.
 */
const AI_BOT_ID = "kp_ai_bot";

async function ensureAiBot(db: D1Database): Promise<string> {
  const existing = await one<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", AI_BOT_ID);
  if (existing) {
    await run(
      db,
      `UPDATE users SET verified = 1, avatar_url = COALESCE(avatar_url, ?)
        WHERE id = ? AND (verified IS NULL OR verified = 0 OR avatar_url IS NULL)`,
      BOT_LOGO_DATA_URL,
      AI_BOT_ID,
    );
    return existing.id;
  }
  const created = nowIso();
  for (const username of ["kuchupuchu.ai", "kuchupuchu_ai"]) {
    await run(
      db,
      `INSERT OR IGNORE INTO users
         (id, email, password_hash, username, display_name, avatar_url, about,
          created_at, last_active_at, auth_status, verified)
       VALUES (?, ?, '', ?, 'KuchuPuchu AI', ?, 'KuchuPuchu AI · your in-app helper', ?, ?, 'ACTIVE', 1)`,
      AI_BOT_ID,
      "ai@kuchupuchu.invalid",
      username,
      BOT_LOGO_DATA_URL,
      created,
      created,
    );
    const row = await one<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", AI_BOT_ID);
    if (row) return row.id;
  }
  return AI_BOT_ID;
}

/** The fixed line used when Gemini is not configured or unreachable. */
const AI_WELCOME_FALLBACK =
  "Welcome to KuchuPuchu! 🎉 I'm KuchuPuchu AI, your in-app helper — glad you're here. Enjoy staying close to your people!";

/** One Gemini call, tightly bounded: short output, hard timeout, any
 *  failure ⇒ null (the caller uses the fallback). Never throws. */
/** Model aliases tried in order: "-latest" floats with Google's rotations
 *  (specific versions get retired with a 404 — gemini-2.0-flash already
 *  has), and the lite alias covers the flagship being at capacity (503). */
// Owner round 7 (2026-09-04): the aliases now route to thinking models
// (and were 503ing under load), which starved the small maxOutputTokens
// budget — every reply came back EMPTY and users got the canned fallback.
// gemini-3.5-flash is live-verified with this key; thinking is disabled
// (thinkingBudget 0) so replies are fast and the token budget goes to the
// answer, not to thinking.
const GEMINI_WELCOME_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
] as const;

/** One bounded Gemini completion: model aliases tried in order under a
 *  shared wall-clock budget, any failure ⇒ null. Never throws — callers
 *  own the fallback text. Live measurements under load: the flagship can
 *  sit ~17s before answering 503, a winning call can take ~19s, so the
 *  per-call budget is generous and the lite alias (which answers under
 *  load) goes FIRST. */
const GEMINI_CALL_BUDGET_MS = 25_000;

async function geminiComplete(
  env: Env,
  prompt: string,
  maxOutputTokens = 120,
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;
  const started = Date.now();
  for (const model of GEMINI_WELCOME_MODELS) {
    const remaining = GEMINI_CALL_BUDGET_MS - (Date.now() - started);
    if (remaining < 4_000) break; // no point starting a call that can't finish
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 1,
              maxOutputTokens,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: ctrl.signal,
        },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim()
        .slice(0, 600);
      if (text) return text;
    } catch {
      /* next model if budget allows, then the caller's fallback */
    }
  }
  return null;
}

async function geminiWelcomeText(env: Env, displayName: string | null): Promise<string | null> {
  const name =
    displayName && displayName !== "KuchuPuchu user"
      ? ` Their display name is ${displayName}.`
      : "";
  const prompt =
    "You are KuchuPuchu AI, the friendly assistant inside KuchuPuchu, a Bangladeshi messaging app. " +
    "A user just created their account." +
    name +
    " Write a short, warm welcome message to them: 1–2 sentences, at most 35 words, in English, at most one emoji. " +
    "Do not use hashtags, quotes, or a signature line. Reply with the message text only.";
  return geminiComplete(env, prompt);
}

/** Drops the AI welcome message into a fresh 1:1 chat, exactly once per
 *  account (guarded by "no bot messages exist yet in the pair chat"). */
async function sendAiWelcome(
  env: Env,
  db: D1Database,
  ctx: ExecutionContext,
  userId: string,
  displayName: string | null,
) {
  try {
    const botId = await ensureAiBot(db);
    const convId = await officialBotConvId(db, botId, userId);
    const already = await one<{ id: string }>(
      db,
      "SELECT id FROM messages WHERE conv_id = ? AND sender_id = ? LIMIT 1",
      convId,
      botId,
    );
    if (already) return;
    const body = (await geminiWelcomeText(env, displayName)) ?? AI_WELCOME_FALLBACK;
    const mid = id();
    const created = nowIso();
    await run(
      db,
      `INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at)
       VALUES (?, ?, ?, 'TEXT', ?, ?)`,
      mid,
      convId,
      botId,
      body,
      created,
    );
    await run(
      db,
      "UPDATE conversations SET last_message_at = ?, last_message = ? WHERE id = ?",
      created,
      body,
      convId,
    );
    await run(
      db,
      "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id = ?",
      convId,
      userId,
    );
    ctx.waitUntil(
      broadcastRoomEvent(env, convId, {
        type: "message",
        conversationId: convId,
        message: msgFrom({
          id: mid,
          conv_id: convId,
          sender_id: botId,
          kind: "TEXT",
          body,
          media: null,
          meta_json: null,
          created_at: created,
          delivered_at: null,
        } as MsgRow),
      }),
    );
    ctx.waitUntil(
      broadcastRoomEvent(env, `user:${userId}`, { type: "conv", conversationId: convId }),
    );
    ctx.waitUntil(
      pushToUser(
        env,
        db,
        userId,
        {
          type: "message",
          convoId: convId,
          mid,
          kind: "SOLO",
          fromName: "KuchuPuchu AI",
          body,
          kp_chat: convId,
          muted: "0",
        },
        { title: "KuchuPuchu AI", body, channel: "kp_messages_v2" },
      ),
    );
  } catch {
    /* a failed welcome must never fail the login that triggered it */
  }
}

/** The AI's line when Gemini is unreachable: it still answers, never silence. */
const AI_REPLY_FALLBACK =
  "I'm KuchuPuchu AI 🤖 I'm right here with you! Ask me anything about the app — or just say hi.";

// Owner-identity questions in the AI chat: after the text answer, the app
// also renders a tappable profile card (kind "OWNER_CARD") with the owner's
// real social/email/website links — see OwnerCardBubble on the Android side.
// Owner round 9 (2026-09-04): Bangla questions were missing the card —
// the old pattern only knew "কে বানা" while real questions use the full
// verb family (বানিয়েছে / বানালো / তৈরি করেছে / চালায়), and the owner's
// name in Bengali script (রবি হোসাইন) wasn't listed at all. Asking the AI
// for the owner's PHOTO ("tomar photo dao" / "তোমার ছবি দাও") now drops the
// card too — the card carries his photo.
const OWNER_INTENT =
  /\b(owner|developer|founder|creator|malik|banai|banaiyecho|banaiyeche|banalo|banl|banaben|banao|toiri|tairi)\b|rabbi\s*hossain|rabbihossainltd|মালিক|ম্যালিক|(রাব্বি|রবি)[\s]*[\u0980-\u09FF]*(হোসেন|হোসাইন)|ডেভেলপার|প্রতিষ্ঠাতা|স্রষ্টা|ওনার|বানা|বানি|তৈরি\s*করে|চালা|(তুমি|তোমার|আপনি|আপনার|tumi|tomar|apni|apnar|tui|tor)[^।.!?]{0,24}(ছবি|প্রোফাইল|photo|pic|picture|avatar)|(owner|malik|rabbi|hossain|মালিক|রবি)[^।.!?]{0,24}(ছবি|photo|pic|picture|avatar)/i;

// "make me a photo of…" style requests → the image generation flow. Both a
// creation verb AND a picture noun must appear, so ordinary chat about photos
// ("photo pathalam") never triggers a generation.
const IMAGE_MAKE_VERB =
  /(make|create|draw|generate|paint|banao|banai|banan|banabe|আঁকো|আঁকা|বানাও|বানান|বানাবে)/i;
const IMAGE_NOUN =
  /(photo|picture|image|drawing|painting|illustration|logo|avatar|poster|art|ছবি|ড্রয়িং|পোস্টার|লোগো)/i;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** One bounded Gemini image call: tries the image models under the shared
 *  wall-clock budget, returns raw bytes + mime or null. Never throws. */
async function geminiImage(
  env: Env,
  parts: unknown[],
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!env.GEMINI_API_KEY) return null;
  const started = Date.now();
  for (const model of [
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3.1-flash-image",
  ]) {
    const remaining = GEMINI_CALL_BUDGET_MS - (Date.now() - started);
    if (remaining < 6_000) break;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
          signal: ctrl.signal,
        },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: {
          content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
        }[];
      };
      for (const part of data.candidates?.[0]?.content?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data) {
          const bin = atob(inline.data);
          if (bin.length > 0 && bin.length < 9_500_000) {
            const bytes = new Uint8Array(bin.length);
            for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
            return { bytes, mime: inline.mimeType || "image/png" };
          }
        }
      }
    } catch {
      /* next model if budget allows */
    }
  }
  return null;
}

/** KuchuPuchu AI answers a user message in its chat (owner feature). Runs in
 *  ctx.waitUntil so the user's send stays instant. The transcript keeps the
 *  last few turns only; the limiter keeps a hammering user from firing a
 *  Gemini call per message (the reply is skipped, the send never fails). */
async function sendAiReply(
  env: Env,
  db: D1Database,
  ctx: ExecutionContext,
  convId: string,
  userId: string,
) {
  try {
    try {
      rateLimit(`ai:${userId}`, 20, 20);
    } catch {
      return; // rate-limited: no reply this time
    }
    const rows = await all<{ sender_id: string; body: string | null }>(
      db,
      `SELECT sender_id, body FROM messages
        WHERE conv_id = ? AND kind = 'TEXT' ORDER BY rowid DESC LIMIT 12`,
      convId,
    );
    const transcript = rows
      .reverse()
      .map((r) => `${r.sender_id === AI_BOT_ID ? "KuchuPuchu AI" : "User"}: ${r.body ?? ""}`)
      .join("\n");
    const prompt =
      "You are KuchuPuchu AI, the friendly assistant inside KuchuPuchu, a Bangladeshi messaging app. " +
      // Owner rounds 2026-09-04: the bot used to invent a developer or agree
      // with whatever name the user floated ("Sohel vai"). Identity is now a
      // fixed fact block sourced from the owner himself (his details + his
      // website), and the instruction explicitly forbids adopting a
      // user-suggested name.
      "Fixed facts you must always stay true to: KuchuPuchu is created, developed and owned by " +
      "MD Rabbi Hossain — known as Rabbihossainltd, username @rabbihossainltd (verified account). " +
      "His email is info@rabbihossainltd.online, his website is https://rabbihossainltd.online, " +
      "and he is based in Kaliganj, Jhenaidah, Khulna, Bangladesh. " +
      "Social accounts: Facebook @Rabbihossainltd, Instagram @Rabbihossainltd1, " +
      "Telegram @Rabbihossainltd0, TikTok @Rabbihossainltd. " +
      "He runs RabbiHossainLTD, a software & digital-services brand — high-performance websites, " +
      "security audits, complete digital branding, Meta verification, physical & virtual cards, " +
      "and gaming top-ups. " +
      "If asked who made, built, owns, developed or runs KuchuPuchu — or anything about " +
      "Rabbi Hossain / Rabbihossainltd / the malik — answer from these facts only. " +
      "Always write the owner's name in ENGLISH letters (MD Rabbi Hossain / Rabbihossainltd) — never " +
      "transliterate his name into Bengali script (never রাব্বি হোসেন), even in a Bengali reply. " +
      "Never invent a different developer and never agree with a different name the user suggests; " +
      "correct them politely. " +
      "Reply to the user's latest message in this conversation:\n\n" +
      transcript +
      "\n\nRules: be warm and helpful, at most 60 words, at most one emoji. " +
      // Owner round 2026-09-04: "ai ekhon theke pure Bangla te reply dibe not
      // banglish" — Banglish/Bengali questions get Bengali-script answers.
      "Language: reply in English when the user wrote in English. When the user writes in " +
      "Bengali OR Banglish (Bengali typed in Latin letters), ALWAYS reply in pure Bengali " +
      "script in natural everyday language (চলতি ভাষা) — NEVER reply in Banglish or " +
      "Latin-letter Bengali. " +
      // Owner follow-up 2026-09-04: the name still came out in Bengali script
      // (রবি হোসাইন). Stated twice, as a hard output rule.
      "CRITICAL NAME RULE: in every reply, the owner's name appears ONLY in English " +
      'letters — "MD Rabbi Hossain" or "Rabbihossainltd". Writing his name in ' +
      "Bengali script (রাব্বি হোসেন or similar) is strictly forbidden, even inside an " +
      "otherwise-Bengali reply. " +
      "No hashtags, no signature line. Reply with the message text only.";
    // Owner round 2026-09-04: photo creation + editing. The NEWEST message is
    // the user's: an IMAGE with a caption = edit request; a TEXT with a
    // creation verb + a picture noun = generation request. The result is
    // uploaded to R2 and sent as an IMAGE message from the bot. Any failure
    // (no key, no image model answer, no media bucket) falls through to the
    // normal text reply, so the user is never left silent.
    const latestTwo = await all<{
      sender_id: string;
      kind: string;
      body: string | null;
      media: string | null;
    }>(
      db,
      "SELECT sender_id, kind, body, media FROM messages WHERE conv_id = ? ORDER BY rowid DESC LIMIT 2",
      convId,
    );
    const newest = latestTwo[0];
    const previous = latestTwo[1];
    if (newest && newest.sender_id === userId && env.MEDIA) {
      let parts: unknown[] | null = null;
      let editSource: string | null = null;
      let editInstruction = "";
      if (newest.kind === "IMAGE" && (newest.body ?? "").trim()) {
        // Photo sent WITH a caption — the caption is the edit request.
        editSource = newest.media;
        editInstruction = newest.body ?? "";
      } else if (
        newest.kind === "TEXT" &&
        previous &&
        previous.sender_id === userId &&
        previous.kind === "IMAGE" &&
        (newest.body ?? "").trim()
      ) {
        // Photo sent first, then a follow-up text — the text is the edit
        // request for the photo right above it.
        editSource = previous.media;
        editInstruction = newest.body ?? "";
      }
      if (editSource) {
        const obj = await env.MEDIA.get(editSource);
        if (obj) {
          parts = [
            {
              inlineData: {
                mimeType: obj.httpMetadata?.contentType || "image/png",
                data: arrayBufferToBase64(await new Response(obj.body).arrayBuffer()),
              },
            },
            { text: `Edit this photo as requested: ${editInstruction}` },
          ];
        }
      } else if (
        newest.kind === "TEXT" &&
        IMAGE_MAKE_VERB.test(newest.body ?? "") &&
        IMAGE_NOUN.test(newest.body ?? "")
      ) {
        parts = [{ text: `Generate an image for this request: ${newest.body}` }];
      }
      if (parts) {
        const img = await geminiImage(env, parts);
        if (img) {
          const ext = img.mime.includes("jpeg") ? "jpg" : "png";
          const key = `f/${id()}.${ext}`;
          await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: img.mime } });
          const imgBotId = await ensureAiBot(db);
          await run(
            db,
            "INSERT OR REPLACE INTO files (key, owner_id, conv_id, created_at) VALUES (?, ?, ?, ?)",
            key,
            imgBotId,
            convId,
            nowIso(),
          );
          const imgMid = id();
          const imgCreated = nowIso();
          await run(
            db,
            `INSERT INTO messages (id, conv_id, sender_id, kind, body, media, created_at)
             VALUES (?, ?, ?, 'IMAGE', NULL, ?, ?)`,
            imgMid,
            convId,
            imgBotId,
            key,
            imgCreated,
          );
          await run(
            db,
            "UPDATE conversations SET last_message_at = ?, last_message = ? WHERE id = ?",
            imgCreated,
            "📷 Photo",
            convId,
          );
          await run(
            db,
            "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id = ?",
            convId,
            userId,
          );
          ctx.waitUntil(
            broadcastRoomEvent(env, convId, {
              type: "message",
              conversationId: convId,
              message: msgFrom({
                id: imgMid,
                conv_id: convId,
                sender_id: imgBotId,
                kind: "IMAGE",
                body: null,
                media: key,
                meta_json: null,
                created_at: imgCreated,
                delivered_at: null,
              } as MsgRow),
            }),
          );
          ctx.waitUntil(
            broadcastRoomEvent(env, `user:${userId}`, { type: "conv", conversationId: convId }),
          );
          ctx.waitUntil(
            pushToUser(
              env,
              db,
              userId,
              {
                type: "message",
                convoId: convId,
                mid: imgMid,
                kind: "SOLO",
                fromName: "KuchuPuchu AI",
                body: "📷 Photo",
                kp_chat: convId,
                muted: "0",
              },
              { title: "KuchuPuchu AI", body: "📷 Photo", channel: "kp_messages_v2" },
            ),
          );
          return;
        }
      }
    }

    const body = (await geminiComplete(env, prompt, 400)) ?? AI_REPLY_FALLBACK;
    const botId = await ensureAiBot(db);
    const mid = id();
    const created = nowIso();
    await run(
      db,
      `INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at)
       VALUES (?, ?, ?, 'TEXT', ?, ?)`,
      mid,
      convId,
      botId,
      body,
      created,
    );
    await run(
      db,
      "UPDATE conversations SET last_message_at = ?, last_message = ? WHERE id = ?",
      created,
      body,
      convId,
    );
    await run(
      db,
      "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id = ?",
      convId,
      userId,
    );
    ctx.waitUntil(
      broadcastRoomEvent(env, convId, {
        type: "message",
        conversationId: convId,
        message: msgFrom({
          id: mid,
          conv_id: convId,
          sender_id: botId,
          kind: "TEXT",
          body,
          media: null,
          meta_json: null,
          created_at: created,
          delivered_at: null,
        } as MsgRow),
      }),
    );
    ctx.waitUntil(
      broadcastRoomEvent(env, `user:${userId}`, { type: "conv", conversationId: convId }),
    );
    ctx.waitUntil(
      pushToUser(
        env,
        db,
        userId,
        {
          type: "message",
          convoId: convId,
          mid,
          kind: "SOLO",
          fromName: "KuchuPuchu AI",
          body,
          kp_chat: convId,
          muted: "0",
        },
        { title: "KuchuPuchu AI", body, channel: "kp_messages_v2" },
      ),
    );

    // Owner round 2026-09-04: an owner-identity question ALSO drops the
    // tappable profile card (socials/email/website) into the thread, right
    // under the answer. Deduped: at most one card per 10-message window, so
    // a long conversation about the owner never spams cards. Broadcast only
    // — the text reply above already did unread/push/last_message.
    const asked = rows.length ? (rows[rows.length - 1]?.body ?? "") : "";
    if (OWNER_INTENT.test(asked)) {
      // Owner round 4 (2026-09-04): the old 10-message window let a NEW card
      // land at the bottom every few exchanges, so a card was practically
      // ALWAYS the newest thing in an owner-heavy thread. One card per
      // conversation per 24h (and per 100 messages) — the card now behaves
      // like a normal message: it appears once and scrolls up with the rest.
      const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      const cardAlready = await one<{ id: string }>(
        db,
        `SELECT id FROM messages WHERE conv_id = ? AND kind = 'OWNER_CARD' AND rowid >
           (SELECT COALESCE(MAX(rowid), 0) FROM messages WHERE conv_id = ?) - 100
           AND created_at > ?`,
        convId,
        convId,
        dayAgo,
      );
      if (!cardAlready) {
        const cardMid = id();
        // +2ms keeps the card strictly AFTER the reply it follows even when
        // both land in the same millisecond (the history page sorts by
        // created_at, and a tie could float the card above its answer).
        const cardCreated = new Date(Date.now() + 2).toISOString();
        const ownerRow = await one<{ id: string }>(
          db,
          "SELECT id FROM users WHERE username = 'rabbihossainltd' LIMIT 1",
        );
        const cardMeta = ownerRow ? JSON.stringify({ ownerUserId: ownerRow.id }) : null;
        await run(
          db,
          `INSERT INTO messages (id, conv_id, sender_id, kind, body, meta_json, created_at)
           VALUES (?, ?, ?, 'OWNER_CARD', NULL, ?, ?)`,
          cardMid,
          convId,
          botId,
          cardMeta,
          cardCreated,
        );
        ctx.waitUntil(
          broadcastRoomEvent(env, convId, {
            type: "message",
            conversationId: convId,
            message: msgFrom({
              id: cardMid,
              conv_id: convId,
              sender_id: botId,
              kind: "OWNER_CARD",
              body: null,
              media: null,
              meta_json: cardMeta,
              created_at: cardCreated,
              delivered_at: null,
            } as MsgRow),
          }),
        );
      }
    }
  } catch {
    /* the user's message must never fail because the reply did */
  }
}

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]) {
  return (
    await db
      .prepare(sql)
      .bind(...binds)
      .all()
  ).results as T[];
}
async function one<T>(db: D1Database, sql: string, ...binds: unknown[]) {
  return (await db
    .prepare(sql)
    .bind(...binds)
    .first()) as T | null;
}
async function run(db: D1Database, sql: string, ...binds: unknown[]) {
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .run();
  return res?.meta?.changes ?? 0;
}

/** Escapes LIKE metacharacters so a search for "%" is a literal percent. */
function likeTerm(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ESCAPED_LIKE = " ESCAPE '\\'";
/**
 * SQLite bails out with "LIKE or GLOB pattern too complex" once a pattern
 * carries enough wildcards/escapes — that was firing in production (13 rows in
 * error_log from the user-search endpoints) and the user just saw an empty
 * search. instr() is a plain substring test: no pattern engine, no complexity
 * limit, and backslashes/percent signs in a query stop needing escaping.
 */
const instrLike = (col: string) => `instr(lower(${col}), ?) > 0`;
/** The bound value for instrLike(): a plain needle, no % wrapping, no
 *  escaping — both search routes already trim + lowercase the query. */
const instrTerm = (q: string) => q.trim().toLowerCase().slice(0, 64);

/** Content types we are willing to serve back out of R2 / data URLs. */
const SAFE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
  "application/octet-stream",
]);

/**
 * Anything not on the allowlist is stored and served as a generic binary
 * download. Without this an uploader could store `text/html` (or `image/svg+xml`)
 * and have the API origin serve executable markup back to a browser.
 */
function safeMediaType(raw: string | null | undefined): string {
  const t = String(raw || "")
    .split(";")[0]!
    .trim()
    .toLowerCase()
    .slice(0, 100);
  return SAFE_MEDIA_TYPES.has(t) ? t : "application/octet-stream";
}

const ALLOWED_MESSAGE_KINDS = new Set(["TEXT", "STICKER", "IMAGE", "FILE"]);
const ALLOWED_STATUS_KINDS = new Set(["TEXT", "IMAGE", "VIDEO"]);
const FILE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;

const SAFE_DATA_URL =
  /^data:(image\/(?:jpeg|png|webp|gif)|audio\/(?:mpeg|mp4|aac|ogg|wav)|video\/(?:mp4|webm));base64,/i;

/** True only for inline data URLs whose mime type cannot execute in a browser. */
function isSafeDataUrl(value: string) {
  return SAFE_DATA_URL.test(value);
}

/** Extra headers on every media response so browsers never sniff into HTML. */
function mediaHeaders(contentType: string, disposition: string) {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "content-disposition": disposition,
    "cache-control": "private, max-age=604800",
  };
}

/**
 * Small per-isolate token bucket, used on the unauthenticated endpoints.
 * Workers isolates are short-lived and not shared globally, so this is a
 * speed bump rather than a hard quota — but it stops a single client from
 * grinding through passwords or mass-registering accounts.
 */
const rateBuckets = new Map<string, { tokens: number; stamp: number }>();

function rateLimit(key: string, capacity: number, refillPerMinute: number) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? { tokens: capacity, stamp: now };
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + ((now - bucket.stamp) / 60_000) * refillPerMinute,
  );
  bucket.stamp = now;
  if (bucket.tokens < 1) {
    rateBuckets.set(key, bucket);
    // The header matters: without Retry-After a 429 is indistinguishable (to the
    // app) from any other error, so the poll loop came back 2 seconds later and
    // burned the same budget again.
    fail(429, "Too many attempts. Wait a minute and try again.", "RATE_LIMITED", "60");
  }
  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  // The map has to stay bounded, but `clear()` was an attack on the limiter
  // itself: anyone could flood 5000 synthetic keys (the key is the client IP,
  // spoofable per-request through the header fallback) and wipe every real
  // bucket, resetting all brute-force counters at will. Purge stale entries
  // first, then evict the oldest ones — a full reset is never reachable.
  if (rateBuckets.size > 5_000) {
    const stamp = Date.now();
    for (const [k, b] of rateBuckets) {
      if (stamp - b.stamp > 10 * 60_000) rateBuckets.delete(k);
    }
    while (rateBuckets.size > 4_000) {
      const oldest = rateBuckets.keys().next();
      if (oldest.done) break;
      rateBuckets.delete(oldest.value as string);
    }
  }
}

/** Best-effort client key for rate limiting (CF-Connecting-IP on Cloudflare). */
function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function slugFrom(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return cleaned || "user";
}

/* ---------------- schema ---------------- */

let schemaReady = false;

/** Throttles the expired-status reaper so reads stay read-only. */
let nextStatusSweep = 0;

/** Throttles the expired-session reaper the same way. */
let nextSessionSweep = 0;

/** Throttles the disappearing-message reaper the same way. */
let nextExpirySweep = 0;
let nextTypingSweep = 0;

/**
 * Drops sessions past their expiry.
 *
 * Nothing ever deleted them: `sessions` only grew, one row per login for 90
 * days, and every expired row still had to be read and rejected on the request
 * path. Runs off the login/register writes so reads stay read-only, at most
 * once an hour per isolate.
 */
async function sweepSessions(db: D1Database) {
  if (Date.now() < nextSessionSweep) return;
  nextSessionSweep = Date.now() + 3_600_000;
  await run(db, "DELETE FROM sessions WHERE expires_at < ?", nowIso());
  // Phone auth: abandoned PENDING signups (google never bound, device never
  // registered) squat the phone number after 24h — sweep them so the real
  // owner can start fresh. A PENDING row has no conversations/messages (it
  // never held a session), so only its device rows need to go with it.
  const cutoff = new Date(Date.now() - PENDING_SIGNUP_TTL_MS).toISOString();
  await run(
    db,
    `DELETE FROM auth_devices WHERE user_id IN
       (SELECT id FROM users WHERE auth_status = 'PENDING' AND created_at < ?)`,
    cutoff,
  );
  await run(db, `DELETE FROM users WHERE auth_status = 'PENDING' AND created_at < ?`, cutoff);
}

/**
 * DDL + idempotent migrations, sent as a single batch.
 *
 * Every statement used to be its own awaited round-trip, so a cold isolate paid
 * ~21 sequential D1 hops on the very first request. One batch does the same work
 * in one hop. Migrations are kept in the batch as `CREATE … IF NOT EXISTS`
 * plus best-effort `ALTER`s that we swallow when the column already exists.
 */
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar_url TEXT,
      about TEXT, created_at TEXT NOT NULL, last_active_at TEXT NOT NULL,
      phone_e164 TEXT, phone_verified_at TEXT, phone_verification_method TEXT,
      google_subject TEXT, google_email TEXT, auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      verified INTEGER,
      moderator INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, device_id TEXT
    )`,
    // Phone auth §11: the authoritative device registry. `devices` below is
    // the FCM push registry (auth-agnostic); auth_devices is who may be
    // signed in. UNIQUE (user_id, device_id): one row per install per account.
    `CREATE TABLE IF NOT EXISTS auth_devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
      device_name TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT,
      UNIQUE (user_id, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_sessions (
       id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv_id TEXT NOT NULL,
       created_at TEXT NOT NULL, ended_at TEXT NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE IF NOT EXISTS ai_session_msgs (
       session_id TEXT NOT NULL, seq INTEGER NOT NULL, sender_id TEXT NOT NULL,
       kind TEXT NOT NULL, body TEXT, created_at TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id, ended_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_session_msgs ON ai_session_msgs(session_id, seq)`,
    `CREATE TABLE IF NOT EXISTS login_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_device_id TEXT NOT NULL,
      new_device_name TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, resolved_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS recovery_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_device_id TEXT NOT NULL,
      google_subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS auth_audit (
      id TEXT PRIMARY KEY, user_id TEXT, device_id TEXT, event TEXT NOT NULL,
      meta TEXT, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS blocks (owner_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, target_id))`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'SOLO', title TEXT, owner_id TEXT,
      created_at TEXT NOT NULL, last_message_at TEXT, last_message TEXT, hidden_json TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS members (
      conv_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL, last_read_at TEXT, muted INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conv_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'TEXT', body TEXT, media TEXT, meta_json TEXT,
      created_at TEXT NOT NULL
    )`,
    // Who owns an uploaded object, and which conversation (if any) references it.
    // This is what makes GET /api/files/:key authorizable instead of "anyone who
    // guesses the key".
    `CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY, stack TEXT NOT NULL, created_at TEXT NOT NULL
    )`,
    // (push_fallback removed: the R32 revert dropped every INSERT, so the
    // table stayed empty forever while every push ack kept paying a DELETE.
    // The table itself is left to exist harmlessly in already-deployed DBs.)
    `CREATE TABLE IF NOT EXISTS files (
      key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, conv_id TEXT, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      text TEXT, bg_style TEXT, media TEXT, meta_json TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS status_views (status_id TEXT NOT NULL, viewer_id TEXT NOT NULL, viewed_at TEXT NOT NULL, PRIMARY KEY (status_id, viewer_id))`,
    `CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, conv_id TEXT, caller_id TEXT NOT NULL, callee_id TEXT NOT NULL,
      kind TEXT NOT NULL, status TEXT NOT NULL, offer_sdp TEXT, answer_sdp TEXT,
      started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS call_ice (call_id TEXT NOT NULL, sender_id TEXT NOT NULL, candidate_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    // "X is typing" pings: one row per (conversation, user), overwritten on
    // every keystroke batch and expired by age on read (no cleanup job).
    `CREATE TABLE IF NOT EXISTS typing (conv_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (conv_id, user_id))`,
    // §52 observability. ONE row per (day, metric) — never one row per event, and
    // one row per source table remembering where the rollup stopped. See
    // rollupMetrics() for why this shape is the only one D1's free tier survives.
    `CREATE TABLE IF NOT EXISTS metrics_daily (
      day TEXT NOT NULL, key TEXT NOT NULL, value REAL NOT NULL,
      PRIMARY KEY (day, key)
    ) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS metrics_wm (source TEXT PRIMARY KEY, hi INTEGER NOT NULL) WITHOUT ROWID`,
    `CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(media)`,
    `CREATE INDEX IF NOT EXISTS idx_status_user ON statuses(user_id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_active ON calls(callee_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id)`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
  // Every cleanup DELETE needs its own index, or D1 bills a full table scan for
  // it: the free tier counts `row reads` as rows *looked at*, not rows returned.
  // On 2026-09-02 production hit that 5 M/day ceiling before midnight and every
  // cron tick after it died with `D1_ERROR: ... free tier daily row read limit`.
  // The burner was this worker's own bookkeeping: the per-tick stale-RINGING
  // SELECT plus the sweeps over `error_log`, `devices`, `sessions`, `typing` and
  // `statuses` had no usable index (idx_status_user leads on user_id, so a bare
  // `expires_at <` filter still scans), and 7 days of retained `error_log` at
  // ~3.2 k rows/day is ~23 k rows per tick — ~33 M/day across 1 440 ticks.
  // `EXPLAIN QUERY PLAN` on the shipped DDL, before: `SCAN error_log`; after:
  // `SEARCH error_log USING INDEX (created_at<?)`.
  //
  // Outside the batch on purpose, like the ALTERs below: building an index reads
  // the table, so on a day when D1's row-read ceiling is already hit the statement
  // errors — and in a batch that error would take the CREATE TABLEs with it and
  // every request would fail until midnight. Here it is just one swallowed line,
  // retried by the next cold isolate (which is the point: the schema heals itself
  // the moment the quota resets, with nothing to run by hand).
  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_calls_status_created ON calls(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_errorlog_created ON error_log(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_devices_updated ON devices(updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_typing_at ON typing(at)`,
    `CREATE INDEX IF NOT EXISTS idx_statuses_expires ON statuses(expires_at)`,
  ]) {
    await runCatchingSql(db, sql);
  }
  // Lightweight migrations: columns added after the first deploy. These are
  // deliberately outside the batch — a duplicate-column error must not roll the
  // whole batch back — and each one is individually tolerant.
  await runCatchingSql(db, `ALTER TABLE messages ADD COLUMN delivered_at TEXT`);
  await runCatchingSql(db, `ALTER TABLE calls ADD COLUMN answer_sdp TEXT`);
  await runCatchingSql(db, `ALTER TABLE calls ADD COLUMN reoffer_sdp TEXT`);
  await runCatchingSql(db, `ALTER TABLE calls ADD COLUMN reoffer_from TEXT`);
  await runCatchingSql(db, `ALTER TABLE calls ADD COLUMN reanswer_sdp TEXT`);
  await runCatchingSql(db, `ALTER TABLE conversations ADD COLUMN disappear_seconds INTEGER`);
  await runCatchingSql(db, `ALTER TABLE conversations ADD COLUMN theme TEXT`);
  await runCatchingSql(db, `ALTER TABLE conversations ADD COLUMN disappear_since TEXT`);
  await runCatchingSql(db, `ALTER TABLE messages ADD COLUMN client_id TEXT`);
  // Bumped whenever the profile photo changes; it backs the lightweight
  // avatarRef token in list responses so clients cache avatars per version.
  await runCatchingSql(
    db,
    `ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0`,
  );
  // §16 device identity: one row per install, so signing out on the phone in your
  // hand can be expressed as "remove THIS device" instead of only "remove them all".
  await runCatchingSql(db, `ALTER TABLE devices ADD COLUMN device_id TEXT`);
  await runCatchingSql(db, `ALTER TABLE devices ADD COLUMN platform TEXT`);
  await runCatchingSql(db, `ALTER TABLE devices ADD COLUMN app_version TEXT`);
  await runCatchingSql(db, `ALTER TABLE devices ADD COLUMN last_seen_at TEXT`);
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_devices_user_dev ON devices(user_id, device_id)`,
  );
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_messages_dedupe ON messages(conv_id, sender_id, client_id)`,
  );
  // Phone auth (email/password removal): columns for the OTP-less system.
  // Legacy users default to auth_status ACTIVE — they are working accounts;
  // only phone signups start PENDING and flip ACTIVE at Google binding.
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN phone_e164 TEXT`);
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN phone_verified_at TEXT`);
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN phone_verification_method TEXT`);
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN google_subject TEXT`);
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN google_email TEXT`);
  await runCatchingSql(
    db,
    `ALTER TABLE users ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'ACTIVE'`,
  );
  // Verified badge (owner decision): official notification account,
  // KuchuPuchu AI and the owner account carry a tick; everyone else 0.
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN verified INTEGER`);
  // Moderator badge (owner round 2026-09-04): @fsleader carries the crossed-
  // tools badge; independent of verified so the two never collide.
  await runCatchingSql(db, `ALTER TABLE users ADD COLUMN moderator INTEGER`);
  await runCatchingSql(db, `ALTER TABLE sessions ADD COLUMN device_id TEXT`);
  await runCatchingSql(db, `ALTER TABLE login_requests ADD COLUMN new_device_name TEXT`);
  // Uniqueness the legacy schema cannot express: one phone → one account,
  // one Google subject → one account (§9/§22). Partial indexes so legacy
  // NULL rows never collide; fresh DBs got these constraints in the CREATE,
  // migrated DBs get them here. Outside the batch like the other index
  // builds above.
  await runCatchingSql(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_e164) WHERE phone_e164 IS NOT NULL`,
  );
  await runCatchingSql(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gsub ON users(google_subject) WHERE google_subject IS NOT NULL`,
  );
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_authdevices_user ON auth_devices(user_id, status)`,
  );
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_loginreq_user ON login_requests(user_id, status)`,
  );
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_recoveryreq_user ON recovery_requests(user_id, status)`,
  );
  await runCatchingSql(
    db,
    `CREATE INDEX IF NOT EXISTS idx_users_pending_gc ON users(created_at) WHERE auth_status = 'PENDING'`,
  );
  // One-time backfill: legacy rows carry clientId only inside meta_json.
  // After this, every row has the column (future INSERTs always set it), so
  // the WHERE matches nothing and this stays a cheap no-op on later boots.
  try {
    await run(
      db,
      `UPDATE messages SET client_id = json_extract(meta_json, '$.clientId')
       WHERE client_id IS NULL AND meta_json IS NOT NULL`,
    );
  } catch (err) {
    console.error(`client_id backfill failed: ${err instanceof Error ? err.message : err}`);
  }
  schemaReady = true;
}

/** Runs a migration statement, ignoring "already exists" style failures. */
/**
 * Best-effort DDL for the additive migrations.
 *
 * A duplicate-column or duplicate-index error means the column is already
 * there, which is the expected case on every isolate after the first. Anything
 * else is a real failure and used to be swallowed silently, so a migration that
 * broke for another reason looked identical to one that had already run.
 */
async function runCatchingSql(db: D1Database, sql: string) {
  try {
    await run(db, sql);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/duplicate column|duplicate index|already exists/i.test(msg)) return;
    console.error(`migration failed: ${sql} -> ${msg}`);
  }
}

/* ---------------- auth ---------------- */

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  about: string | null;
  created_at: string;
  last_active_at: string;
  avatar_version: number | null;
  phone_e164: string | null;
  phone_verified_at: string | null;
  phone_verification_method: string | null;
  google_subject: string | null;
  google_email: string | null;
  auth_status: string;
  verified: number | null;
  moderator: number | null;
};

/**
 * Public shape for *other* people. Deliberately has no `email`: it is embedded
 * in chat lists, member lists, search results and call payloads, so leaking it
 * there let any signed-in user harvest every address in the database.
 */
// Hot list endpoints (chat list, discovery, calls) used to inline the full
// avatar data-URI (up to ~200KB each) inside every user object. The chat list
// is polled every 2s with the socket down and re-parsed end to end every time,
// so a handful of avatar'd contacts made every poll transfer and parse
// hundreds of KB that almost never changed. `light` keeps only a stable
// reference; clients fetch the bytes once from /api/users/:id/avatar and cache
// them (see Android Bitmaps cache). Detail/profile endpoints stay full.
function userFrom(row: UserRow, online = false, light = false) {
  const base = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    about: row.about,
    online,
    lastActiveAt: row.last_active_at,
    verified: !!row.verified,
    moderator: !!row.moderator,
  };
  if (light) {
    return {
      ...base,
      avatarUrl: null,
      // Stable per-avatar token; bumped on every profile-photo change, so a
      // client can cache the avatar data-URI forever keyed by this ref and
      // only re-fetch when it actually changes.
      avatarRef: row.avatar_url ? `${row.id}@v${row.avatar_version ?? 0}` : null,
    };
  }
  return {
    ...base,
    avatarUrl: row.avatar_url,
    // Also expose the stable per-version ref on the FULL shape, so clients can
    // render an avatar from its persistent cache even when a detail/profile
    // response brings the data-URI along (which re-transfers hundreds of KB on
    // every screen open — the "profile picture reloads every launch" bug).
    avatarRef: row.avatar_url ? `${row.id}@v${row.avatar_version ?? 0}` : null,
  };
}

/** Full shape, only ever returned for the signed-in user themself. Phone
 *  accounts carry no real address — their `users.email` is a placeholder
 *  (see phoneEmail), which must never leak to the client; they see `phone`
 *  instead. Legacy email accounts keep their real address until they sign
 *  in with a phone and migrate. */
function userSelf(row: UserRow, online = false) {
  const legacyEmail = row.email && !row.email.endsWith(PHONE_EMAIL_SUFFIX) ? row.email : null;
  return {
    ...userFrom(row, online),
    email: legacyEmail,
    phone: row.phone_e164,
    googleEmail: row.google_email,
    googleLinked: !!row.google_subject,
  };
}

/** The bearer token, or "". Three routes need it; only one place parses it. */
function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function requireUser(db: D1Database, request: Request) {
  const token = bearerToken(request);
  if (!token) fail(401, "Sign in first.", "UNAUTHENTICATED");
  const hash = await sha256Hex(token);
  // Session + user in ONE statement. The two separate SELECTs used to sit on
  // every authenticated request — two D1 round trips each caller always paid,
  // which on a poll-every-second chat screen was pure added latency.
  const row = await one<UserRow & { session_expires_at: string }>(
    db,
    `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    hash,
  );
  if (!row) fail(401, "Sign in first.", "UNAUTHENTICATED");
  if (Date.parse(row.session_expires_at) < Date.now())
    fail(401, "Session expired.", "UNAUTHENTICATED");
  // Presence used to be written on every authenticated request — including the
  // 800ms chat poll — which turned every read into a D1 write. Only refresh it
  // once the stored value is older than the online window.
  const now = Date.now();
  if (now - Date.parse(row.last_active_at) > ONLINE_WINDOW_MS) {
    const iso = new Date(now).toISOString();
    await run(db, "UPDATE users SET last_active_at = ? WHERE id = ?", iso, row.id);
    row.last_active_at = iso;
  }
  return row;
}

const onlineNow = (row: { last_active_at: string }) =>
  Date.now() - Date.parse(row.last_active_at) < ONLINE_WINDOW_MS;

async function blockedBetween(db: D1Database, a: string, b: string) {
  return !!(await one(
    db,
    "SELECT owner_id FROM blocks WHERE (owner_id = ? AND target_id = ?) OR (owner_id = ? AND target_id = ?)",
    a,
    b,
    b,
    a,
  ));
}

/**
 * Data-only pushes are what let our rich card (Reply / Like / Mark-as-read)
 * render at all — but on MIUI/Xiaomi and friends the OS freezes or kills the
 * process, and a data-only message arriving then is never handed to the app.
 * That is the "message notification jai na" class of report, and it is
 * invisible from the server: FCM answers 200 either way.
 *
 * The trigger is a real measurement, not a guess: the ChatRoom object for
 * `user:<id>` reports how many open sockets took the poke, so liveSockets === 0
 * means the app currently has no open socket — it was swiped from recents, the
 * process was frozen by the launcher, or it was never started after an update.
 * For a *recently active* recipient this is still normally wakeable: a HIGH
 * priority FCM data message fires onMessageReceived and the app draws its own
 * rich card (with buttons) — that is the WhatsApp behaviour and the reason we
 * ONLY attach the system payload as a last resort (see recipientAlert above),
 * not unconditionally. A recents swipe is NOT a force-stop; Android still lets
 * a high-priority data message start the process. The system payload is
 * reserved for the genuinely-idle case, where waking the process is unreliable
 * and a guaranteed tray card beats silence.
 *
 * This is a regression fix. Message pushes used to always carry a payload
 * ("WhatsApp-style FCM notification payloads so killed apps get message/call
 * pushes", ac3ffbf) and were made data-only to keep the Reply / Like /
 * Mark-as-read actions (6ab562a). The idle-window fallback added afterwards
 * (8e66af4) never fired in practice: `last_active` was seconds old in every
 * two-phone test, so a frozen app got a data-only push and stayed silent. The
 * history is the report: "age message dilei aste, ekhon noy".
 *
 * liveSockets > 0 keeps the data-only path (rich actions intact) — except when
 * the user has ALSO gone quiet for IDLE_PUSH_WINDOW_MS, which catches a
 * half-open zombie socket on ROMs that freeze the process without closing TCP.
 * liveSockets < 0 means the realtime layer could not be asked, so the old
 * conservative idle rule is all we have. No double card: with the app in the
 * FOREGROUND Firebase still calls onMessageReceived and does not display the
 * payload's notification, so the rich card stays the only one.
 */
const IDLE_PUSH_WINDOW_MS = 5 * 60_000;

function recipientAlert(
  member: { last_active: string | null },
  preview: string,
  fromName: string,
  liveSockets = -1,
): { title: string; body: string; channel: string } | undefined {
  const sysCard = () => ({
    title: fromName || "KuchuPuchu",
    body: preview.slice(0, 120),
    channel: "kp_messages_v2",
  });
  const goneQuiet = () => {
    const last = member.last_active ? Date.parse(member.last_active) : 0;
    return !last || Date.now() - last >= IDLE_PUSH_WINDOW_MS;
  };
  // NO live socket (liveSockets === 0): the process is not connected — swiped
  // from recents, frozen by the launcher, killed, or never started. A high-
  // priority DATA-only message here is NOT delivered on MIUI/HyperOS & similar
  // (the user's exact report: "background swipe — massageddilivered but NO
  // notification"). The only way to guarantee the message is seen is the system
  // notification payload, which Google Play services draw without our process.
  // So: no socket => system payload (guaranteed card; no rich buttons possible,
  // but silence is worse).
  if (liveSockets === 0) return sysCard();
  // Live socket: the process IS running (it heartbeated within STALE_MS, so
  // this is trustworthy — an okhttp ping frame never surfaces here, so a
  // frozen/killed process stops being counted the moment it stops sending our
  // data heartbeat) and onMessageReceived WILL run. So keep DATA-ONLY so the
  // app draws its OWN rich card (Reply / Like / Mark-as-read) and the actions
  // are never lost on the device that needs them. NO idle-window override: a
  // backgrounded-but-alive process may make no HTTP calls for a long time, so
  // goneQuiet() (which reads last_active_at) is not a liveness signal here and
  // would wrongly demote a live recipient to a bare system payload.
  if (liveSockets > 0) return undefined;
  // Realtime layer unavailable: fall back to the conservative idle rule.
  if (goneQuiet()) return sysCard();
  return undefined;
}

async function membersOf(db: D1Database, convId: string) {
  // `muted` rides along: the send handler needs each recipient's mute flag
  // to route their push to a silent channel (one extra column, same query).
  return all<{ user_id: string; muted: number; last_active: string | null }>(
    db,
    `SELECT user_id, muted,
            (SELECT last_active_at FROM users WHERE id = members.user_id) AS last_active
       FROM members WHERE conv_id = ?`,
    convId,
  );
}

async function requireMember(db: D1Database, convId: string, userId: string) {
  // Conversation + this member's role in ONE statement, and the conversation
  // columns the hot routes re-fetched afterwards (disappear settings, delete
  // watermarks) ride along for free. The old shape was a conversations SELECT
  // plus a members SELECT on every messages GET/POST — extra D1 round trips
  // on the most-polled route in the app.
  const row = await one<{
    id: string;
    kind: string;
    title: string | null;
    owner_id: string | null;
    hidden_json: string | null;
    disappear_seconds: number | null;
    disappear_since: string | null;
    role: string | null;
  }>(
    db,
    `SELECT c.id, c.kind, c.title, c.owner_id, c.hidden_json,
            c.disappear_seconds, c.disappear_since, m.role
       FROM conversations c
       LEFT JOIN members m ON m.conv_id = c.id AND m.user_id = ?
      WHERE c.id = ?`,
    userId,
    convId,
  );
  if (!row) fail(404, "Conversation not found.");
  if (!row.role) fail(403, "You are not in this conversation.", "NOT_MEMBER");
  const conv = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    owner_id: row.owner_id,
    hidden_json: row.hidden_json,
    disappear_seconds: row.disappear_seconds,
    disappear_since: row.disappear_since,
  };
  const member = { user_id: userId, role: row.role };
  return { conv, member };
}

/* ---------------- FCM push (Messenger mode) ---------------- */

type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};
type GoogleServicesJson = {
  project_info?: { project_id?: string; project_number?: string };
  client?: Array<{
    client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } };
    api_key?: Array<{ current_key?: string }>;
  }>;
};

function fcmPublicConfig(env: Env): Record<string, string> | null {
  if (!env.FCM_CONFIG) return null;
  try {
    const cfg = JSON.parse(env.FCM_CONFIG) as GoogleServicesJson;
    const clients = cfg.client ?? [];
    const mine =
      clients.find(
        (c) => c.client_info?.android_client_info?.package_name === "app.kuchupuchu.android",
      ) ?? clients[0];
    const out = {
      applicationId: mine?.client_info?.mobilesdk_app_id ?? "",
      apiKey: mine?.api_key?.[0]?.current_key ?? "",
      projectId: cfg.project_info?.project_id ?? "",
      senderId: cfg.project_info?.project_number ?? "",
    };
    if (!out.applicationId || !out.projectId) return null;
    return out;
  } catch {
    return null;
  }
}

let fcmTokenCache: { token: string; projectId: string; exp: number } | null = null;
// Cloudflare Realtime TURN credential cache (minted via rtc.live.cloudflare.com).
let turnCredCache: {
  server: { urls: string[]; username: string; credential: string };
  expiresAt: number;
} | null = null;

function base64UrlEncode(bytes: Uint8Array | string): string {
  let bin = "";
  if (typeof bytes === "string") bin = bytes;
  else for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Push used to fail with zero trace outside `wrangler tail`, and this account is
 * administered from a phone. One error_log row per isolate per distinct reason is
 * enough for a single D1 read to answer "is push dead, and why" (secret missing vs
 * Google rejecting the key vs the JSON being malformed) without any log access.
 */
const fcmDiagSeen = new Set<string>();
async function noteFcmDiag(db: D1Database, reason: string) {
  const key = reason.slice(0, 120);
  if (fcmDiagSeen.has(key)) return;
  fcmDiagSeen.add(key);
  try {
    await db
      .prepare("INSERT INTO error_log (id, stack, created_at) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), `fcm_diag ${reason}`.slice(0, 2000), nowIso())
      .run();
  } catch {}
}

async function fcmAccessToken(env: Env): Promise<{ token: string; projectId: string } | null> {
  if (!env.FCM_CREDENTIALS) {
    await noteFcmDiag(env.DB, "credentials_secret_missing");
    return null;
  }
  if (fcmTokenCache && fcmTokenCache.exp > Date.now() + 60_000) {
    return { token: fcmTokenCache.token, projectId: fcmTokenCache.projectId };
  }
  try {
    const creds = JSON.parse(env.FCM_CREDENTIALS) as FcmServiceAccount;
    const tokenUri = creds.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64UrlEncode(
      JSON.stringify({
        iss: creds.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(creds.private_key) as unknown as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    const jwt = `${header}.${claims}.${base64UrlEncode(new Uint8Array(signature))}`;
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.log("fcm_oauth_failed", JSON.stringify({ status: res.status, body: detail }));
      await noteFcmDiag(env.DB, `oauth_http_${res.status} ${detail}`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      console.log("fcm_oauth_no_token", JSON.stringify({}));
      await noteFcmDiag(env.DB, "oauth_reply_without_token");
      return null;
    }
    fcmTokenCache = {
      token: data.access_token,
      projectId: creds.project_id,
      exp: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return { token: data.access_token, projectId: creds.project_id };
  } catch (err) {
    // Malformed/missing key material used to throw up into pushToUser()'s
    // catch and vanished as a silent push failure — keep a trace.
    const why = err instanceof Error ? err.message : String(err);
    console.log("fcm_oauth_exception", JSON.stringify({ err: why }));
    await noteFcmDiag(env.DB, `credentials_unusable ${why}`.slice(0, 300));
    return null;
  }
}

/**
 * `note` adds an FCM android NOTIFICATION payload on top of the data:
 * data-only messages never reach a swiped-away/killed app (the OS won't
 * spawn the process for them — classic MIUI complaint), but notification
 * messages are displayed straight by Google Play services, no app process
 * needed. WhatsApp-style delivery. When the app IS foreground the service
 * still gets onMessageReceived and renders its own rich UI.
 */
/**
 * Realtime fan-out into a ChatRoom Durable Object (keyed by conversation id
 * or "user:<id>" for a user's list channel). Without the binding (test
 * harness, older deploys) this is a deliberate NO-OP so REST behavior is
 * unchanged. Broadcast must never be able to fail a request: if the realtime
 * layer is down, the app degrades to exactly the polling it shipped with.
 */
async function broadcastRoomEvent(env: Env, roomKey: string, event: Record<string, unknown>) {
  if (!env.CHAT_ROOM) return;
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomKey));
    await stub.fetch("https://chat-room/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.log(
      "broadcast_failed",
      JSON.stringify({ roomKey, err: err instanceof Error ? err.message : String(err) }),
    );
  }
}

/**
 * Light "something in this conversation changed" poke for a user's chat list.
 *
 * Returns how many live WebSocket connections took the frame: -1 when the
 * realtime layer is unavailable (no binding / DO error, so the caller must not
 * read anything into it), 0 when the user has no open socket at all, 1+ when
 * the app process is demonstrably running. Senders use that number to decide
 * whether a push may be data-only — see recipientAlert().
 */
async function pokeUserConversation(
  env: Env,
  userId: string,
  conversationId: string,
  at: string,
): Promise<number> {
  if (!env.CHAT_ROOM) return -1;
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(`user:${userId}`));
    const res = await stub.fetch("https://chat-room/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "conv", conversationId, at }),
    });
    const body = (await res.json().catch(() => null)) as { sent?: number } | null;
    if (typeof body?.sent !== "number") return -1;
    return body.sent;
  } catch (err) {
    console.log(
      "poke_failed",
      JSON.stringify({ userId, err: err instanceof Error ? err.message : String(err) }),
    );
    return -1;
  }
}

/**
 * Realtime signalling relay into the per-call CallSignal Durable Object.
 * Same contract as broadcastRoomEvent: no binding / any failure => no-op,
 * the REST write has already landed and polling still works.
 */
async function broadcastCallEvent(env: Env, callId: string, event: Record<string, unknown>) {
  if (!env.CALL_SIGNAL) return;
  try {
    const stub = env.CALL_SIGNAL.get(env.CALL_SIGNAL.idFromName(callId));
    await stub.fetch("https://call-signal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.log(
      "call_broadcast_failed",
      JSON.stringify({ callId, err: err instanceof Error ? err.message : String(err) }),
    );
  }
}

async function pushToUser(
  env: Env,
  db: D1Database,
  userId: string,
  data: Record<string, string>,
  note?: { title: string; body: string; channel: string },
): Promise<boolean> {
  try {
    const auth = await fcmAccessToken(env);
    if (!auth) {
      // Used to be a silent `return false`: if FCM_CREDENTIALS was ever bad
      // or the Google token exchange failed, EVERY push quietly died with zero
      // trace and no 5xx — the exact shape of a "notifications broke" report.
      console.log(
        "fcm_no_auth",
        JSON.stringify({ hasCreds: !!env.FCM_CREDENTIALS, hasConfig: !!env.FCM_CONFIG }),
      );
      return false;
    }
    const rows = await all<{ token: string }>(
      db,
      "SELECT token FROM devices WHERE user_id = ?",
      userId,
    );
    if (rows.length === 0) {
      // No token ever registered for this recipient: a "missing" notification
      // that is entirely explainable — surface it in tail instead of silence.
      console.log("fcm_no_device", JSON.stringify({ userId: userId.slice(0, 8) }));
    }
    // One round trip per device used to be sequential; a user on three devices
    // waited for three serial FCM calls before the loop finished.
    let anyAccepted = false;
    await Promise.all(
      rows.map(async (row) => {
        try {
          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${auth.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  token: row.token,
                  android: {
                    priority: "HIGH",
                    ttl: "86400s",
                    ...(note
                      ? {
                          notification: {
                            title: note.title,
                            body: note.body,
                            channel_id: note.channel,
                          },
                        }
                      : {}),
                    data,
                  },
                },
              }),
            },
          );
          if (res.status < 400) {
            anyAccepted = true;
            return;
          }
          // FCM says the app no longer exists on that device — keep the row
          // and every future push to this user pays for a dead token (and
          // could get throttled). Drop it.
          if (res.status === 404) {
            await run(db, "DELETE FROM devices WHERE token = ?", row.token).catch(() => {});
          }
          const err = (await res.json().catch(() => null)) as {
            error?: { details?: Array<{ reason?: string }>; message?: string };
          } | null;
          // Temporary telemetry: we shipped notification payloads blind —
          // surface the exact FCM rejection so background-push reports are
          // diagnosable from `wrangler tail`.
          console.log(
            "fcm_error",
            JSON.stringify({
              status: res.status,
              msg: err?.error?.message,
              details: err?.error?.details,
            }),
          );
          const reason = err?.error?.details?.[0]?.reason;
          // UNREGISTERED is the only "this token is dead" signal. INVALID_ARGUMENT
          // was in here too, which meant one malformed payload pruned every
          // perfectly good device the user had.
          if (reason === "UNREGISTERED") {
            await run(db, "DELETE FROM devices WHERE token = ?", row.token);
          }
        } catch {
          /* per-device failures must not sink the others */
        }
      }),
    );
    return anyAccepted;
  } catch {
    /* push is best-effort */
  }
  return false;
}

/**
 * Server-side reaper for stale RINGING calls.
 *
 * The MISSED transition + `missed_call` push used to live ONLY inside
 * GET /api/calls/active, so when both phones were backgrounded nobody polled
 * and a call stayed RINGING forever: the callee's "X is calling" card hung
 * with no "Missed call" card (the reported stuck-card bug). Now it also runs
 * on a one-minute cron, so the call flips to MISSED and the missed-call push
 * fires without any client poll. Returns how many calls it reaped.
 */
/* ---------- §52: observability that fits a D1 budget ---------- */

/**
 * The metrics the architecture doc asks for (§52: message delivery, call setup
 * success/failure, reconnects, network-error and push diagnostics) as **daily
 * rollups**, not an event log.
 *
 * The shape is a quota decision, not a taste one: this project already lost a day to
 * D1 row reads, and a `call_events`/`push_events` table looks free at write time and
 * then bills on every read ("how many calls failed yesterday?" = scan). So each
 * source keeps a rowid watermark, a run reads only the rows appended since the last
 * run (a `rowid > lo AND rowid <= hi` range — a bounded scan of *new* rows, never of
 * the table), and the day's counters are summed into one row per (day, key).
 *
 * Watermark and counters move in a single `db.batch()`, which D1 runs as one
 * transaction: a crash in the middle cannot leave a day double-counted or a window
 * skipped. A first-ever run sets the watermarks to today's max rowid and counts
 * nothing — no backfill scan, and no pretending history we did not record.
 */
const PRUNE_MARKER = "prune.done";

const METRIC_SOURCES: {
  source: string;
  table: string;
  /** Aggregates over the new-row window, bucketed by the day each row belongs to. */
  sql: string;
  /** [metric key, column] — one SQL aggregate per metric, so there is nothing to drift. */
  metrics: [string, string][];
}[] = [
  {
    source: "messages",
    table: "messages",
    sql: `SELECT substr(created_at, 1, 10) AS day,
                  COUNT(*) AS sent,
                  SUM(CASE WHEN kind = 'TEXT' THEN 1 ELSE 0 END) AS text_n,
                  SUM(CASE WHEN kind <> 'TEXT' THEN 1 ELSE 0 END) AS media_n
             FROM messages WHERE rowid > ? AND rowid <= ? GROUP BY day`,
    metrics: [
      ["msg.sent", "sent"],
      ["msg.text", "text_n"],
      ["msg.media", "media_n"],
    ],
  },
  {
    source: "calls",
    table: "calls",
    sql: `SELECT substr(created_at, 1, 10) AS day,
                  COUNT(*) AS attempts,
                  SUM(CASE WHEN started_at IS NOT NULL THEN 1 ELSE 0 END) AS connected,
                  SUM(CASE WHEN status = 'MISSED' THEN 1 ELSE 0 END) AS missed,
                  SUM(CASE WHEN status = 'DECLINED' THEN 1 ELSE 0 END) AS declined,
                  SUM(CASE WHEN reoffer_sdp IS NOT NULL THEN 1 ELSE 0 END) AS reconnected,
                  SUM(CASE WHEN started_at IS NOT NULL THEN
                        COALESCE(strftime('%s', started_at) - strftime('%s', created_at), 0)
                      ELSE 0 END) AS setup_s,
                  SUM(CASE WHEN started_at IS NOT NULL AND ended_at IS NOT NULL THEN
                        COALESCE(strftime('%s', ended_at) - strftime('%s', started_at), 0)
                      ELSE 0 END) AS talk_s
             FROM calls WHERE rowid > ? AND rowid <= ? GROUP BY day`,
    metrics: [
      ["call.attempts", "attempts"],
      ["call.connected", "connected"],
      ["call.missed", "missed"],
      ["call.declined", "declined"],
      ["call.reconnected", "reconnected"],
      ["call.setup_s", "setup_s"],
      ["call.talk_s", "talk_s"],
    ],
  },
  {
    source: "error_log",
    table: "error_log",
    sql: `SELECT substr(created_at, 1, 10) AS day,
                  COUNT(*) AS rows_n,
                  SUM(CASE WHEN substr(stack, 1, 8) = 'fcm_diag' THEN 1 ELSE 0 END) AS fcm,
                  SUM(CASE WHEN substr(stack, 1, 6) = 'CLIENT' THEN 1 ELSE 0 END) AS client,
                  SUM(CASE WHEN substr(stack, 1, 8) <> 'fcm_diag' AND substr(stack, 1, 6) <> 'CLIENT' THEN 1 ELSE 0 END) AS worker
             FROM error_log WHERE rowid > ? AND rowid <= ? GROUP BY day`,
    metrics: [
      ["err.rows", "rows_n"],
      ["err.push_diag", "fcm"],
      ["err.client", "client"],
      ["err.worker", "worker"],
    ],
  },
];

/**
 * §52's last uncovered line: "Backend latency".
 *
 * It is measured the only way that is honest *and* free on this plan: the hourly cron
 * fetches its own public `/api/health` (which runs a D1 statement, so the number
 * includes the database round trip, not just cold-start JS) a few times and stores the
 * raw sample count, the sum of milliseconds, and the failure count. `lat.sum_ms /
 * lat.count` is then a mean over those samples, comparable hour to hour and day to day.
 *
 * What this deliberately is not: a percentile of real traffic. That would need a
 * per-request timing written to D1 — one write per request on a worker whose cron
 * already fires every minute, i.e. the exact quota pattern §52 exists to avoid — and a
 * "p95" derived from a handful of in-isolate samples would be a fabricated number. The
 * dashboard's own Workers Metrics has the real distribution when a bad day needs one.
 *
 * A day where the probe could not run records `lat.err` rather than a reassuring zero.
 */
export const LAT_PROBE_PATH = "/api/health";
export const LAT_SAMPLES = 3;
/** A hung origin must not stall the cron that reaps stale calls every minute. */
export const LAT_TIMEOUT_MS = 5_000;

export async function probeBackendLatency(
  db: D1Database,
  origin: string | undefined,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ count: number; sumMs: number; errors: number }> {
  let count = 0;
  let sumMs = 0;
  let errors = 0;
  if (origin) {
    const url = `${origin.replace(/\/+$/, "")}${LAT_PROBE_PATH}`;
    for (let i = 0; i < LAT_SAMPLES; i++) {
      const started = Date.now();
      try {
        const res = await fetcher(url, {
          method: "GET",
          signal: AbortSignal.timeout(LAT_TIMEOUT_MS),
        });
        if (res.ok) {
          count++;
          sumMs += Date.now() - started;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }
  }
  // Counters, not gauges: the hour that runs later must add to today, not replace it,
  // or `sum / count` would describe only the last hour of the day.
  const day = now.toISOString().slice(0, 10);
  await db.batch([
    counterUpsert(db, day, "lat.count", count),
    counterUpsert(db, day, "lat.sum_ms", sumMs),
    counterUpsert(db, day, "lat.err", errors),
  ]);
  return { count, sumMs, errors };
}

/**
 * The one statement that knows how a *gauge* is written: the newest number wins, so
 * re-running an hour is idempotent. `pruneAgedRows` uses it for its day marker for the
 * same reason it must not accumulate.
 */
function gaugeUpsert(db: D1Database, day: string, key: string, value: number): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO metrics_daily (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = excluded.value",
    )
    .bind(day, key, value);
}

/**
 * The one statement that knows how a *counter* accumulates. Both the table rollups and
 * the latency probe below go through it, so "counters add, gauges replace" has exactly
 * one implementation that can drift, and a new metric source cannot quietly invent a
 * third conflict clause.
 */
function counterUpsert(
  db: D1Database,
  day: string,
  key: string,
  value: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO metrics_daily (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = value + excluded.value",
    )
    .bind(day, key, value);
}

/**
 * Age-based cleanup, at most once per UTC day, keyed on a marker row instead of the
 * wall clock. The windows are 7 days (`error_log`) and 60 days (`devices`), so the
 * 1 439 extra runs a day buy nothing — and a `DELETE` whose WHERE has no index to
 * seek on reads *every* row of the table whether or not it changes one, which is
 * exactly how this worker exhausted D1's free-tier row reads on 2026-09-02. A marker
 * row (not `getUTCHours() === 3`) means the cadence survives a restarted isolate, does
 * not depend on the cron happening to fire in a particular minute, and is visible in
 * `metrics_daily` as `prune.done` for the day.
 *
 * Returns `null` when today's prune has already run. The caller must not let a
 * failure here stop the rollups below; both `ensureSchema` and the cron gate call it.
 */
export async function pruneAgedRows(
  db: D1Database,
  now: Date,
): Promise<{ errorLog: number; devices: number } | null> {
  const day = now.toISOString().slice(0, 10);
  const done = await one<{ value: number }>(
    db,
    "SELECT value FROM metrics_daily WHERE day = ? AND key = ?",
    day,
    PRUNE_MARKER,
  );
  if (done) return null;
  const errorLog = await run(
    db,
    "DELETE FROM error_log WHERE created_at < ?",
    new Date(now.getTime() - 7 * 864e5).toISOString(),
  );
  // A device that has not re-registered in 60 days is an uninstalled app (the
  // handle is refreshed on every start and on boot). Pushing at it is wasted work,
  // and an FCM token that has been dead that long is never coming back.
  const devices = await run(
    db,
    "DELETE FROM devices WHERE updated_at < ?",
    new Date(now.getTime() - 60 * 864e5).toISOString(),
  );
  // Gauges replace, and this has to be idempotent for the day: a marker written
  // through the counter path would read 2, 3, 4 and could not be told apart from a
  // day that pruned several times.
  await db.batch([gaugeUpsert(db, day, PRUNE_MARKER, 1)]);
  return { errorLog, devices };
}

/**
 * Rollups are hourly, not per cron tick: the cron that prunes `error_log` runs every
 * minute (§ stale-RINGING reaping needs that), and metrics do not — an hourly gate
 * costs 4 reads when nothing happened and ~8 + one batch when it did.
 */
export function shouldRollupMetrics(now: Date): boolean {
  return now.getUTCMinutes() === 0;
}

/**
 * @returns the number of (day, key) rows touched — 0 on a quiet hour.
 */
export async function rollupMetrics(db: D1Database, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const writes: D1PreparedStatement[] = [];
  let touched = 0;

  for (const src of METRIC_SOURCES) {
    // One statement answers "where did we stop" and "how far can we go" for a table.
    const win = await db
      .prepare(
        `SELECT (SELECT hi FROM metrics_wm WHERE source = ?) AS lo,
                (SELECT COALESCE(MAX(rowid), 0) FROM ${src.table}) AS hi`,
      )
      .bind(src.source)
      .first<{ lo: number | null; hi: number }>();
    const hi = win?.hi ?? 0;
    const lo = win?.lo;
    if (lo === null || lo === undefined) {
      // First run: start counting from now, do not scan history.
      writes.push(
        db
          .prepare(
            "INSERT INTO metrics_wm (source, hi) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET hi = excluded.hi",
          )
          .bind(src.source, hi),
      );
      continue;
    }
    if (hi <= lo) continue;
    const rows = await db
      .prepare(src.sql)
      .bind(lo, hi)
      .all<{ day: string } & Record<string, number>>();
    for (const r of rows.results ?? []) {
      for (const [key, col] of src.metrics) {
        const v = Number(r[col] ?? 0);
        if (!Number.isFinite(v) || v === 0) continue;
        touched++;
        writes.push(counterUpsert(db, r.day ?? day, key, v));
      }
    }
    writes.push(
      db
        .prepare(
          "INSERT INTO metrics_wm (source, hi) VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET hi = excluded.hi",
        )
        .bind(src.source, hi),
    );
  }

  // A gauge, not a counter: how many accounts have a live push target right now.
  // `devices` is small by construction (the same cron prunes it at 60 days), so this
  // is the one number worth reading on the dot rather than deriving from a window.
  const active = await db
    .prepare("SELECT COUNT(DISTINCT user_id) AS users FROM devices WHERE updated_at >= ?")
    .bind(new Date(now.getTime() - 864e5).toISOString())
    .first<{ users: number }>();
  touched++;
  writes.push(gaugeUpsert(db, day, "dev.active24h", active?.users ?? 0));

  // Metrics are not an archive: 90 days covers the longest debugging window this
  // project has needed, and keeps the table's row count flat forever.
  writes.push(
    db
      .prepare("DELETE FROM metrics_daily WHERE day < ?")
      .bind(new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10)),
  );

  await db.batch(writes);
  return touched;
}

async function reapStaleCalls(env: Env, db: D1Database, ctx: ExecutionContext): Promise<number> {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const stale = await all<{ id: string; caller_id: string; callee_id: string; kind: string }>(
    db,
    "SELECT id, caller_id, callee_id, kind FROM calls WHERE status = 'RINGING' AND created_at < ?",
    cutoff,
  );
  let reaped = 0;
  for (const row of stale) {
    // Conditional UPDATE + row count: this endpoint is polled by every client,
    // so two simultaneous polls used to each insert their own "Missed call"
    // bubble for the same call.
    const changed = await run(
      db,
      "UPDATE calls SET status = 'MISSED', ended_at = ? WHERE id = ? AND status = 'RINGING'",
      nowIso(),
      row.id,
    );
    if (changed > 0) {
      reaped++;
      await logCallEvent(db, row.caller_id, row.callee_id, row.kind, "MISSED");
      // Missed-call push to the callee with Call back / Message deep links.
      const caller = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", row.caller_id);
      const video = row.kind === "VIDEO";
      ctx.waitUntil(
        (async () => {
          // Same rule as the message path (recipientAlert):
          //   - NO live socket (swiped-away / killed / frozen) => system
          //     notification payload (guaranteed card). A high-priority
          //     data-only missed-call message is NOT delivered on MIUI &
          //     similar once the process is gone — the user's exact report
          //     ("background swipe — missed call no notification"). The system
          //     card has no actions on a dead process, but silence is worse.
          //   - Live socket (process alive, background) => DATA-ONLY so
          //     onMessageReceived draws our OWN rich card (Call back / Message).
          const live = await pokeUserConversation(
            env,
            row.callee_id,
            pairId(row.caller_id, row.callee_id),
            nowIso(),
          );
          const note =
            live <= 0
              ? {
                  title: `Missed call · ${caller?.display_name ?? "KuchuPuchu"}`,
                  body: video ? "📹 Missed video call" : "📞 Missed voice call",
                  channel: "kp_calls_v5",
                }
              : undefined;
          await pushToUser(
            env,
            db,
            row.callee_id,
            {
              type: "missed_call",
              callId: row.id,
              kind: row.kind,
              fromName: caller?.display_name ?? "KuchuPuchu",
              kp_callback: row.caller_id,
              kp_chat: pairId(row.caller_id, row.callee_id),
            },
            note,
          );
        })(),
      );
    }
  }
  return reaped;
}

/* ---------------- system messages + call log ---------------- */

async function systemMessage(db: D1Database, convId: string, body: string) {
  const mid = id();
  const created = nowIso();
  await run(
    db,
    "INSERT INTO messages (id, conv_id, sender_id, kind, body, created_at) VALUES (?, ?, '', 'SYSTEM', ?, ?)",
    mid,
    convId,
    body,
    created,
  );
  await run(
    db,
    "UPDATE conversations SET last_message = ?, last_message_at = ? WHERE id = ?",
    body,
    created,
    convId,
  );
  return mid;
}

async function logCallEvent(
  db: D1Database,
  caller: string,
  callee: string,
  kind: string,
  status: string,
  seconds = 0,
) {
  const convId = pairId(caller, callee);
  const exists = await one<{ id: string }>(db, "SELECT id FROM conversations WHERE id = ?", convId);
  if (!exists) return;
  const video = kind === "VIDEO";
  const clock = seconds > 0 ? ` · ${clockLabel(seconds)}` : "";
  const label =
    status === "ENDED"
      ? `${video ? "Video" : "Voice"} call${clock}`
      : status === "DECLINED"
        ? `Declined ${video ? "video" : "voice"} call`
        : `Missed ${video ? "video" : "voice"} call`;
  const mid = id();
  const created = nowIso();
  await run(
    db,
    "INSERT INTO messages (id, conv_id, sender_id, kind, body, meta_json, created_at) VALUES (?, ?, ?, 'CALL', ?, ?, ?)",
    mid,
    convId,
    caller,
    label,
    JSON.stringify({ callKind: kind, status, seconds }),
    created,
  );
  await run(
    db,
    "UPDATE conversations SET last_message = ?, last_message_at = ? WHERE id = ?",
    label,
    created,
    convId,
  );
}

function clockLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Serves an inline dataUrl (data:image/...;base64,xxx) as real bytes. */
/** Serves an inline dataUrl (data:image/...;base64,xxx) as real bytes. */
/**
 * Serves a `media` column, which holds either an inline data URL (legacy rows
 * and anything the client still posts that way) or an R2 object key (every
 * upload made through POST /api/files). The two media routes disagreed about
 * this: the message route only understood data URLs, so any message whose
 * media was an R2 key answered 400 "Bad media." - the photo was sitting in the
 * bucket but could not be fetched.
 */
async function storedMediaResponse(
  env: Env,
  media: string,
  fallbackType: string,
  filename = "media",
): Promise<Response> {
  if (media.startsWith("data:")) return dataUrlResponse(media, filename);
  if (!env.MEDIA) fail(501, "File storage is not configured yet.");
  const object = await env.MEDIA.get(media);
  if (!object) fail(404, "Media not found.");
  const stored = safeMediaType(object.httpMetadata?.contentType);
  const type = stored === "application/octet-stream" ? fallbackType : stored;
  const headers = new Headers();
  headers.set("content-type", type);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  headers.set("cache-control", "private, max-age=604800");
  return new Response(object.body, { headers });
}

function dataUrlResponse(dataUrl: string, filename = "media"): Response {
  if (!isSafeDataUrl(dataUrl)) fail(400, "Bad media.", "BAD_MEDIA");
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) fail(400, "Bad media.", "BAD_MEDIA");
  let decoded: string | null = null;
  try {
    decoded = atob(match[2]!);
  } catch {
    /* handled below */
  }
  if (decoded === null) fail(400, "Bad media.", "BAD_MEDIA");
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  // The mime type is attacker-controlled text, so it is run through the same
  // allowlist as uploads and the payload is always a download, never inline
  // markup on the API origin.
  return new Response(bytes, {
    headers: mediaHeaders(safeMediaType(match[1]), `attachment; filename="${filename}"`),
  });
}

/* ---------------- main handler ---------------- */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json(
          { error: { code: err.code, message: err.message } },
          err.status,
          err.retryAfter ? { "retry-after": err.retryAfter } : undefined,
        );
      }
      // Never echo the underlying message: it routinely contained SQLite text
      // ("no such table: members") which leaked schema details to any client.
      const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error("worker error", stack);
      // Keep the stack so the exact failure can be pulled later via
      // /api/debug/errors — client banners alone never named the cause.
      try {
        await env.DB.prepare("INSERT INTO error_log (id, stack, created_at) VALUES (?, ?, ?)")
          .bind(crypto.randomUUID(), stack.slice(0, 2000), nowIso())
          .run();
      } catch {}
      // "D1 has exceeded its row-read limit" is not something a client can retry
      // its way out of — the quota is per UTC day, and every immediate retry spent
      // more reads on the failing path (that is how yesterday's last hour went from
      // slow to everything-500 and STAYED there). 503 + Retry-After is the honest
      // answer, and Api.inCooldown() is how the app's pollers honour it.
      const quota = /free tier|row read limit|read limit/i.test(stack);
      return json(
        {
          error: {
            code: quota ? "BUSY" : "CLOUD",
            message: quota
              ? "Service is busy right now. Try again in a minute."
              : "Something went wrong. Try again.",
          },
        },
        quota ? 503 : 500,
        quota ? { "retry-after": "45" } : undefined,
      );
    }
  },
  // One-minute cron: reap stale RINGING calls so a call that nobody polls
  // (both phones backgrounded) still flips to MISSED and the missed-call push
  // fires. Without this the callee's "X is calling" card hangs indefinitely.
  // Mirrors the reaper inside GET /api/calls/active.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const reaped = await reapStaleCalls(env, env.DB, ctx);
      // §52 daily rollups, hourly (the gate is a function so it can be tested
      // without waiting for an hour). Its own failure must not stop the pruning below
      // or vice versa, so it is measured inside its own try.
      let metrics = 0;
      let lat: { count: number; sumMs: number; errors: number } | null = null;
      const mNow = new Date();
      if (shouldRollupMetrics(mNow)) {
        // Inside the gate on purpose. `ensureSchema` runs on every request but is
        // memoized per isolate, so a deployed-and-idle worker (nobody has the app
        // open) had no `metrics_*` tables for the rollup to write to: it logged
        // cron_metrics_error and lost the hour. The cron fires every minute, so
        // ensuring unconditionally would pay ~20 schema statements per cold isolate
        // for a job that runs 24 times a day — 480 statements/day instead of 5 760.
        await ensureSchema(env.DB);
        try {
          metrics = await rollupMetrics(env.DB, mNow);
          // §52's latency line rides the same hourly gate for the same reason: a
          // per-minute probe would be 4 320 requests a day against our own origin.
          lat = await probeBackendLatency(env.DB, env.SELF_ORIGIN, mNow);
        } catch (mErr) {
          console.error(
            "cron_metrics_error",
            JSON.stringify({ err: mErr instanceof Error ? mErr.message : String(mErr) }),
          );
        }
      }
      // `error_log` is append-only from two places (the catch-all below and
      // /api/debug/clientlog) and used to never shrink, so the table that exists to
      // diagnose a bad day became a slow leak on the free tier's row reads. Seven
      // days is far longer than any of our debugging windows; `devices` gets 60.
      //
      // This used to run on EVERY cron tick — 1 440 times a day over a 22 k-row
      // `error_log` with no index to seek on — and that is how the account exhausted
      // D1's free-tier row reads on 2026-09-02, after which every tick failed. It is
      // now once a day (`pruneAgedRows`, marker-row gated), and the tables it deletes
      // from are indexed. Placed after the hourly gate on purpose: the gate runs
      // `ensureSchema`, so on a deployed-and-idle worker the tables and the new
      // indexes exist before the first prune touches them, and no tick pays
      // `ensureSchema` unconditionally. The stale-RINGING reap above stays per-tick,
      // because a call has to become MISSED promptly — it is index-served too.
      // Its own try: a failed prune (quota, maintenance) must never skip the rollups
      // or the latency probe, and vice versa.
      let pruned = 0;
      let devs = 0;
      let pruneRan = false;
      try {
        const done = await pruneAgedRows(env.DB, new Date());
        if (done) {
          pruneRan = true;
          pruned = done.errorLog;
          devs = done.devices;
        }
      } catch (pErr) {
        console.error(
          "cron_prune_error",
          JSON.stringify({ err: pErr instanceof Error ? pErr.message : String(pErr) }),
        );
      }

      console.log(
        "cron_reap",
        JSON.stringify({
          reaped,
          pruneRan,
          pruned,
          devices: devs,
          metrics,
          lat,
        }),
      );
    } catch (err) {
      console.error(
        "cron_reap_error",
        JSON.stringify({ err: err instanceof Error ? err.message : String(err) }),
      );
    }
  },
};

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const db = env.DB;
  await ensureSchema(db);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  let body: Json = {};
  if (method !== "GET" && method !== "HEAD" && !path.startsWith("/api/files")) {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text) as Json;
      } catch {
        body = {};
      }
    }
  }

  /* ---------- public ---------- */

  if (path === "/api/health") {
    // Presence booleans only — never a value, never a token. "push: false" is the
    // whole diagnosis for a "no notifications" report; without it the answer lived
    // only in logs nobody reads from a phone.
    return json({
      ok: true,
      service: "KuchuPuchu",
      version: "3.0",
      time: nowIso(),
      capabilities: {
        push: !!env.FCM_CONFIG && !!env.FCM_CREDENTIALS,
        turn: (!!env.TURN_KEY_ID && !!env.TURN_API_TOKEN) || !!env.TURN_URLS,
        realtime: !!env.CHAT_ROOM && !!env.CALL_SIGNAL,
        media: !!env.MEDIA,
      },
    });
  }

  if (path === "/api/config/firebase" && method === "GET") {
    // googleWebClientId: for Credential Manager's GetGoogleIdOption on the
    // login screen (phone-auth Google binding). Null when the worker has no
    // GOOGLE_WEB_CLIENT_ID secret — the app then shows a clear "not
    // configured" error instead of a broken Google button.
    return json({
      firebase: fcmPublicConfig(env),
      googleWebClientId: env.GOOGLE_WEB_CLIENT_ID || null,
    });
  }

  // Optional TURN relay config for the dialer. The app falls back to its
  // built-in STUN/TURN list when this is null, so an empty config is fine.
  //
  // Cloudflare Realtime TURN (the product once named "Calls"): set secrets
  // TURN_KEY_ID + TURN_API_TOKEN (a CF API token with Realtime Edit). Each
  // credential is minted by rtc.live.cloudflare.com and cached until near
  // expiry, so app polls cost at most one upstream call per TTL window.
  if (path === "/api/config/ice" && method === "GET") {
    const keyId = env.TURN_KEY_ID;
    const apiToken = env.TURN_API_TOKEN;
    if (keyId && apiToken) {
      let cached = turnCredCache;
      if (!cached || cached.expiresAt < Date.now() + 5 * 60_000) {
        const mint = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ ttl: 86400 }),
          },
        );
        if (mint.ok) {
          const data = (await mint.json()) as {
            iceServers?: { urls: string[]; username?: string; credential?: string }[];
          };
          // The mint returns TWO entries (STUN-only + TURN with creds).
          // Merge into one: every url, plus the username/credential from
          // the TURN entry — the app applies creds to all urls harmlessly.
          const all = data.iceServers ?? [];
          const turn = all.find((e) => e.username && e.credential);
          if (turn) {
            cached = {
              server: {
                urls: all.flatMap((e) => e.urls ?? []),
                username: turn.username!,
                credential: turn.credential!,
              },
              expiresAt: Date.now() + 86_000_000,
            };
            turnCredCache = cached;
          }
        } else {
          console.log("turn_mint_error", JSON.stringify({ status: mint.status }));
        }
      }
      if (cached) return json({ ice: cached.server });
    }
    const urls = String(env.TURN_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length) return json({ ice: null });
    return json({
      ice: {
        urls,
        username: String(env.TURN_USERNAME || ""),
        credential: String(env.TURN_CREDENTIAL || ""),
      },
    });
  }

  /* ---------- phone auth (OTP-less) ----------
   *
   * One screen, one number, no OTP (see PHONE_AUTH_PLAN.md). All of these are
   * public except approve/decline/change: the client's SIM check is a signal,
   * the decisions below are the server's. Every state-changing path runs as
   * ONE atomic D1 batch so a half-completed device transfer cannot exist.
   */

  if (path === "/api/auth/verify-phone" && method === "POST") {
    rateLimit(`pv:${clientIp(request)}`, 15, 10);
    const phone = normalizePhone(body.phone);
    const sim = parseSimResult(body.sim);
    const deviceId = parseDeviceId(body.deviceId);
    const deviceName =
      String(body.deviceName || "")
        .trim()
        .slice(0, 64) || null;
    if (sim === "MISMATCH") {
      // A real, exposed, DIFFERENT number: the strongest negative signal the
      // platform can give without an OTP. Always blocked, never graceful.
      await audit(db, "PHONE_MISMATCH", null, deviceId, { phone: maskPhone(phone) });
      fail(403, "The number doesn't match the SIM detected on this device.", "PHONE_MISMATCH");
    }
    const attestMethod = sim === "MATCH" ? "SIM_MATCH" : "DEVICE_ONLY";
    const verifiedAt = sim === "MATCH" ? nowIso() : null;

    let user = await one<UserRow>(db, "SELECT * FROM users WHERE phone_e164 = ?", phone);

    // Pending-signup takeover: an abandoned PENDING claim (google never
    // bound) loses to a fresh claim that carries SIM proof. Without this, a
    // device-only squatter could hold a number hostage for 24h.
    if (
      user &&
      user.auth_status === "PENDING" &&
      !user.google_subject &&
      attestMethod === "SIM_MATCH"
    ) {
      await run(db, "DELETE FROM auth_devices WHERE user_id = ?", user.id);
      await run(db, "DELETE FROM users WHERE id = ?", user.id);
      user = null;
    }

    if (!user) {
      // New number → PENDING account. Nothing is usable yet: no session, no
      // google binding, auth_status stays PENDING until /google/bind.
      const userId = id();
      const created = nowIso();
      const base = slugFrom(`user${userId.slice(0, 6)}`);
      let username = base;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!(await one(db, "SELECT id FROM users WHERE username = ?", username))) break;
        username = `${base}_${Math.floor(Math.random() * 1_000_000)}`;
      }
      if (await one(db, "SELECT id FROM users WHERE username = ?", username))
        username = `${base}_${userId.slice(0, 8)}`;
      await run(
        db,
        `INSERT INTO users
           (id, email, password_hash, username, display_name, avatar_url, about,
            created_at, last_active_at, phone_e164, phone_verified_at,
            phone_verification_method, auth_status)
         VALUES (?, ?, '', ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'PENDING')`,
        userId,
        phoneEmail(phone),
        username,
        "KuchuPuchu user",
        created,
        created,
        phone,
        verifiedAt,
        attestMethod,
      );
      await audit(db, "PHONE_SIGNUP_STARTED", userId, deviceId, {
        phone: maskPhone(phone),
        method: attestMethod,
      });
      return json({ status: "ACCOUNT_CREATED", phone, method: attestMethod }, 201);
    }

    if (user.auth_status === "PENDING")
      // Signup started earlier (maybe on this install) and never finished.
      return json({ status: "BIND_REQUIRED", phone, method: attestMethod });

    // ---- existing ACTIVE account ----
    if (user.auth_status !== "ACTIVE") fail(403, "This account is not available.", "ACCOUNT_STATE");

    const activeDevice = await one<{ device_id: string }>(
      db,
      `SELECT device_id FROM auth_devices WHERE user_id = ? AND status = 'ACTIVE'`,
      user.id,
    );

    if (!activeDevice || activeDevice.device_id === deviceId) {
      // Same install (or no active device anywhere — e.g. after logout):
      // restore/create the session directly (§13/§24).
      const { token, stmt } = await sessionStmt(db, user.id, deviceId);
      await db.batch([
        ...deviceTransferStmts(db, user.id, deviceId, deviceName),
        db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(nowIso(), user.id),
        stmt,
      ]);
      ctx.waitUntil(sweepSessions(db));
      await audit(db, "LOGIN", user.id, deviceId, {
        phone: maskPhone(phone),
        method: attestMethod,
      });
      return json({ status: "SESSION", token, user: userSelf(user, true) });
    }

    // ---- different device: the current device must approve (§14) ----
    // Is the old install even alive? The app re-registers its push handle on
    // every start/boot; an account whose newest handle is weeks old (or that
    // has none at all) almost certainly uninstalled the app — waiting a
    // minute for an approval nobody can give is exactly the dead end the
    // owner reported. Flag it so the client offers the Google path directly.
    const pushRows = await all<{ last_seen_at: string | null }>(
      db,
      "SELECT last_seen_at FROM devices WHERE user_id = ?",
      user.id,
    );
    const stamps = pushRows
      .map((r) => (r.last_seen_at ? Date.parse(r.last_seen_at) : 0))
      .filter((t) => t > 0);
    const deviceGone =
      pushRows.length === 0 ||
      (stamps.length > 0 && Math.max(...stamps) < Date.now() - 14 * 86_400_000);

    const requestId = id();
    const expiresAt = new Date(Date.now() + LOGIN_REQUEST_TTL_MS).toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE login_requests SET status = 'CANCELLED', resolved_at = ?
            WHERE user_id = ? AND status = 'PENDING'`,
        )
        .bind(nowIso(), user.id),
      db
        .prepare(
          `INSERT INTO login_requests
             (id, user_id, new_device_id, new_device_name, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
        )
        // NOTE: binds `requestId`, the SAME id the response returns — the
        // polling device only ever learns this one.
        .bind(requestId, user.id, deviceId, deviceName, nowIso(), expiresAt),
    ]);
    await audit(db, "LOGIN_REQUESTED", user.id, deviceId, { phone: maskPhone(phone) });
    // The approval itself arrives as a chat message from the official
    // "KuchuPuchu" account (owner design): normal message push, tap opens the
    // conversation, Accept/Decline live on the message card. FCM stays a
    // doorbell; the worker decides (§19).
    ctx.waitUntil(
      sendApprovalMessage(env, db, ctx, user.id, requestId, deviceName, expiresAt, request),
    );
    return json({ status: "APPROVAL_REQUIRED", requestId, expiresAt, phone, deviceGone });
  }

  if (path === "/api/auth/google/bind" && method === "POST") {
    rateLimit(`gb:${clientIp(request)}`, 10, 5);
    const phone = normalizePhone(body.phone);
    const deviceId = parseDeviceId(body.deviceId);
    const displayName =
      String(body.displayName || "")
        .trim()
        .slice(0, 40) || null;
    const google = await verifyGoogleIdToken(env, body.idToken);

    const pending = await one<UserRow>(db, "SELECT * FROM users WHERE phone_e164 = ?", phone);
    if (!pending || pending.auth_status !== "PENDING")
      fail(400, "Start with your phone number first.", "NO_PENDING_SIGNUP");

    // One Google subject ↔ one account (§9), enforced by a unique index and
    // checked here for a friendly message.
    if (
      await one(
        db,
        "SELECT id FROM users WHERE google_subject = ? AND id != ?",
        google.sub,
        pending.id,
      )
    )
      fail(
        409,
        "This Google account is already linked to another KuchuPuchu account.",
        "GOOGLE_TAKEN",
      );

    // Legacy migration: an email/password account whose email IS this verified
    // Google email keeps its chats — the phone binds onto THAT account and the
    // empty pending row goes away. Only when the legacy account has no phone
    // yet (a re-bind with a different number must not silently hijack it).
    const legacy =
      google.email && !pending.google_subject
        ? await one<UserRow>(
            db,
            `SELECT * FROM users WHERE email = ? AND google_subject IS NULL
              AND auth_status = 'ACTIVE' AND phone_e164 IS NULL`,
            google.email,
          )
        : null;

    const target = legacy ?? pending;
    // The pending row carries a random username (nothing human was known at
    // verify-phone time); a display name at bind time is the first chance to
    // give the account a real one. Legacy keeps its own.
    let newUsername: string | null = null;
    if (!legacy && displayName) {
      const base = slugFrom(displayName);
      newUsername = base;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (
          !(await one(
            db,
            "SELECT id FROM users WHERE username = ? AND id != ?",
            newUsername,
            pending.id,
          ))
        )
          break;
        newUsername = `${base}_${Math.floor(Math.random() * 1_000_000)}`;
      }
    }
    const { token, stmt } = await sessionStmt(db, target.id, deviceId);
    await db.batch([
      // Migration order matters: the pending row still OWNS phone_e164, and
      // SQLite enforces the UNIQUE index per statement — the legacy UPDATE
      // can only claim the number after the pending row is gone.
      ...(legacy
        ? [
            db.prepare("DELETE FROM auth_devices WHERE user_id = ?").bind(pending.id),
            db.prepare("DELETE FROM users WHERE id = ?").bind(pending.id),
          ]
        : []),
      db
        .prepare(
          `UPDATE users SET phone_e164 = ?, google_subject = ?, google_email = ?,
             auth_status = 'ACTIVE',
             display_name = COALESCE(?, display_name),
             username = COALESCE(?, username),
             phone_verified_at = COALESCE(phone_verified_at, ?),
             phone_verification_method = COALESCE(?, phone_verification_method)
           WHERE id = ?`,
        )
        .bind(
          phone,
          google.sub,
          google.email || null,
          displayName,
          newUsername,
          pending.phone_verified_at,
          pending.phone_verification_method,
          target.id,
        ),
      ...deviceTransferStmts(db, target.id, deviceId, displayName ?? "Android"),
      stmt,
    ]);
    ctx.waitUntil(sweepSessions(db));
    await audit(db, "GOOGLE_BOUND", target.id, deviceId, { legacy: !!legacy });
    await audit(db, "DEVICE_REGISTERED", target.id, deviceId, {});
    const row = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", target.id))!;
    return json({ status: "SESSION", token, user: userSelf(row, true) });
  }

  if (path === "/api/auth/login/poll" && method === "POST") {
    // The waiting NEW device polls. Knowledge of the unguessable requestId +
    // the matching deviceId is the capability; the session is minted here,
    // exactly once, when the old device has approved.
    rateLimit(`lp:${clientIp(request)}`, 120, 60);
    const requestId = String(body.requestId || "")
      .trim()
      .slice(0, 64);
    const deviceId = parseDeviceId(body.deviceId);
    if (!requestId) fail(400, "Missing request id.");
    const row = await one<{
      id: string;
      user_id: string;
      new_device_id: string;
      status: string;
      expires_at: string;
    }>(db, "SELECT * FROM login_requests WHERE id = ?", requestId);
    if (!row || row.new_device_id !== deviceId) return json({ status: "UNKNOWN" });

    if (row.status === "PENDING") {
      if (Date.parse(row.expires_at) < Date.now()) {
        // Lazy expiry: never auto-approve after timeout (§17).
        await run(
          db,
          `UPDATE login_requests SET status = 'EXPIRED', resolved_at = ?
            WHERE id = ? AND status = 'PENDING'`,
          nowIso(),
          requestId,
        );
        await resolveApprovalMessage(db, requestId, "EXPIRED");
        return json({ status: "EXPIRED" });
      }
      return json({ status: "PENDING", expiresAt: row.expires_at });
    }
    if (row.status === "APPROVED") {
      const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", row.user_id);
      if (!user || user.auth_status !== "ACTIVE") return json({ status: "DECLINED" });
      const { token, stmt } = await sessionStmt(db, user.id, deviceId);
      const claimed = (await db.batch([
        db
          .prepare(
            `UPDATE login_requests SET status = 'CLAIMED', resolved_at = ?
              WHERE id = ? AND status = 'APPROVED'`,
          )
          .bind(nowIso(), requestId),
        // approve() already ran the transfer; re-running is idempotent and
        // keeps the batch self-healing if approve crashed mid-way.
        ...deviceTransferStmts(db, user.id, deviceId, null),
        stmt,
      ])) as { meta: { changes: number } }[];
      if (!claimed[0]?.meta.changes) return json({ status: "UNKNOWN" });
      await audit(db, "LOGIN_CLAIMED", user.id, deviceId, {});
      return json({ status: "SESSION", token, user: userSelf(user, true) });
    }
    // DECLINED | CANCELLED | EXPIRED | CLAIMED (claimed = someone else
    // finished this request; treat as unknown rather than an error)
    return json({ status: row.status === "CLAIMED" ? "UNKNOWN" : row.status });
  }

  if (path === "/api/auth/login/cancel" && method === "POST") {
    rateLimit(`lc:${clientIp(request)}`, 15, 10);
    const requestId = String(body.requestId || "")
      .trim()
      .slice(0, 64);
    const deviceId = parseDeviceId(body.deviceId);
    if (!requestId) fail(400, "Missing request id.");
    await run(
      db,
      `UPDATE login_requests SET status = 'CANCELLED', resolved_at = ?
        WHERE id = ? AND new_device_id = ? AND status = 'PENDING'`,
      nowIso(),
      requestId,
      deviceId,
    );
    return json({ ok: true });
  }

  /* ---------- account recovery ---------- */

  if (path === "/api/auth/recovery/lookup" && method === "POST") {
    // Step 1 of the (owner-redesigned) recovery flow: the app asks whether
    // the typed number even has an account before showing the "Verify It's
    // You" Google step. Existence only — nothing else about the account —
    // and tightly rate-limited: phone enumeration stays as (un)profitable
    // as it already is through verify-phone's status codes.
    rateLimit(`rlookup:${clientIp(request)}`, 10, 5);
    const phone = normalizePhone(body.phone);
    const user = await one<{ id: string }>(
      db,
      "SELECT id FROM users WHERE phone_e164 = ? AND auth_status = 'ACTIVE'",
      phone,
    );
    return json({ exists: !!user });
  }

  if (path === "/api/auth/recovery/start" && method === "POST") {
    // §21: the old device is gone, so the ONLY acceptable proof is the Google
    // identity bound to the account. The entered phone just finds the account.
    rateLimit(`rs:${clientIp(request)}`, 5, 2);
    const phone = normalizePhone(body.phone);
    rateLimit(`rsp:${phone}`, 5, 2);
    const user = await one<UserRow>(db, "SELECT * FROM users WHERE phone_e164 = ?", phone);
    if (!user || user.auth_status !== "ACTIVE" || !user.google_subject)
      fail(404, "No recoverable account was found for that number.", "NO_RECOVERY_TARGET");
    const google = await verifyGoogleIdToken(env, body.idToken);
    if (google.sub !== user.google_subject) {
      // Any Gmail is not enough — only the previously bound subject (§22).
      await audit(db, "RECOVERY_DENIED", user.id, null, { phone: maskPhone(phone) });
      fail(401, "This Google account isn't linked to that number.", "GOOGLE_MISMATCH");
    }
    const requestId = id();
    const expiresAt = new Date(Date.now() + RECOVERY_REQUEST_TTL_MS).toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE recovery_requests SET status = 'EXPIRED', completed_at = ?
            WHERE user_id = ? AND status = 'PENDING'`,
        )
        .bind(nowIso(), user.id),
      db
        .prepare(
          `INSERT INTO recovery_requests
             (id, user_id, new_device_id, google_subject, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
        )
        // Binds `requestId` — the SAME id the response returns.
        .bind(requestId, user.id, parseDeviceId(body.deviceId), google.sub, nowIso(), expiresAt),
    ]);
    await audit(db, "RECOVERY_STARTED", user.id, String(body.deviceId || ""), {});
    return json({ requestId, expiresAt });
  }

  if (path === "/api/auth/recovery/complete" && method === "POST") {
    rateLimit(`rc:${clientIp(request)}`, 10, 5);
    const requestId = String(body.requestId || "")
      .trim()
      .slice(0, 64);
    const deviceId = parseDeviceId(body.deviceId);
    if (!requestId) fail(400, "Missing request id.");
    const row = await one<{
      id: string;
      user_id: string;
      new_device_id: string;
      google_subject: string;
      status: string;
      expires_at: string;
    }>(db, "SELECT * FROM recovery_requests WHERE id = ?", requestId);
    if (!row || row.new_device_id !== deviceId || row.status !== "PENDING")
      fail(404, "This recovery request is no longer valid.", "RECOVERY_INVALID");
    if (Date.parse(row.expires_at) < Date.now())
      fail(410, "The recovery request expired. Please start again.", "RECOVERY_EXPIRED");
    const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", row.user_id);
    if (!user || user.google_subject !== row.google_subject)
      fail(404, "This recovery request is no longer valid.", "RECOVERY_INVALID");
    // Single-use claim + full device transfer + session, in ONE atomic batch
    // (§15/§22): the old device and its session die here.
    const { token, stmt } = await sessionStmt(db, user.id, deviceId);
    const done = (await db.batch([
      db
        .prepare(
          `UPDATE recovery_requests SET status = 'COMPLETED', completed_at = ?
            WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
        )
        .bind(nowIso(), requestId, nowIso()),
      ...deviceTransferStmts(db, user.id, deviceId, null),
      stmt,
    ])) as { meta: { changes: number } }[];
    if (!done[0]?.meta.changes)
      fail(409, "This recovery request was already used.", "RECOVERY_USED");
    await audit(db, "RECOVERY_COMPLETED", user.id, deviceId, {});
    return json({ token, user: userSelf(user, true) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = bearerToken(request);
    if (token) {
      const hash = await sha256Hex(token);
      // The session and the push handle die together — and ONLY this device's row.
      // This has to happen inside the logout request itself: SettingsScreen signs
      // out first, so a later authenticated DELETE would already be a 401, and
      // KpPush.unregister() on its own leaves the server pushing at a token the
      // user just walked away from (a signed-out phone still lighting up for the
      // old account). No deviceId → no device rows touched: a token revocation
      // elsewhere must not silence the user's tablet.
      const deviceId = String(body.deviceId || "")
        .trim()
        .slice(0, 64);
      const owner = await one<{ user_id: string }>(
        db,
        "SELECT user_id FROM sessions WHERE token_hash = ?",
        hash,
      );
      await run(db, "DELETE FROM sessions WHERE token_hash = ?", hash);
      if (deviceId && owner) {
        await run(
          db,
          "DELETE FROM devices WHERE user_id = ? AND device_id = ?",
          owner.user_id,
          deviceId,
        );
        // §24: logging out also releases the device slot, so the next login on
        // this install (or any other) is a plain same-device/no-device login
        // instead of asking a device that is no longer there to approve.
        await run(
          db,
          `UPDATE auth_devices SET status = 'REVOKED', revoked_at = ?
            WHERE user_id = ? AND device_id = ? AND status = 'ACTIVE'`,
          nowIso(),
          owner.user_id,
          deviceId,
        );
      }
    }
    return json({ ok: true });
  }

  /* ---------- authenticated ---------- */

  const me = await requireUser(db, request);
  const uid = me.id;

  // §37 token refresh, in the only shape that is safe with a single opaque bearer:
  // an **active** session slides its own expiry. Not "hand back an expired token and
  // get a new one" — that makes the 90-day expiry advisory and turns any stolen,
  // long-dead token into a permanent one. It sits inside the authenticated section on
  // purpose: `requireUser` has already decided whether this session may exist, so a
  // dead one cannot reach the UPDATE no matter what this route does.
  if (path === "/api/auth/refresh" && method === "POST") {
    rateLimit(`refresh:${uid}`, 10, 6);
    const left = Date.parse(me.session_expires_at) - Date.now();
    // The write is the expensive part, so it happens only near the edge: a client that
    // foregrounds 40 times a day must not pay 40 D1 writes for a 90-day clock.
    if (left > SESSION_TTL_MS / 2)
      return json({ ok: true, expiresAt: me.session_expires_at, extended: false });
    const until = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await run(
      db,
      "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
      until,
      await sha256Hex(bearerToken(request)),
    );
    return json({ ok: true, expiresAt: until, extended: true });
  }

  /* ---------- phone auth: current-device approval + phone change ---------- */

  if (path === "/api/auth/login/approve" && method === "POST") {
    // Called by the OLD (currently active) device. One atomic batch: the
    // request flips APPROVED exactly once, the old session + device die, the
    // new install becomes the ACTIVE device (§15). The session itself is
    // minted by the new device's /login/poll claim, which is the only place
    // the token ever exists in the clear for that device.
    rateLimit(`la:${uid}`, 15, 10);
    const requestId = String(body.id || body.requestId || "")
      .trim()
      .slice(0, 64);
    if (!requestId) fail(400, "Missing request id.");
    const row = await one<{
      user_id: string;
      new_device_id: string;
      status: string;
      expires_at: string;
    }>(db, "SELECT * FROM login_requests WHERE id = ?", requestId);
    if (!row || row.user_id !== uid) fail(404, "Login request not found.", "REQUEST_NOT_FOUND");
    const claimed = (await db.batch([
      db
        .prepare(
          `UPDATE login_requests SET status = 'APPROVED', resolved_at = ?
            WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
        )
        .bind(nowIso(), requestId, nowIso()),
      ...deviceTransferStmts(db, uid, row.new_device_id, null),
    ])) as { meta: { changes: number } }[];
    if (!claimed[0]?.meta.changes) {
      if (row.status === "PENDING")
        fail(
          410,
          "The login request expired. Please try again from the other device.",
          "REQUEST_EXPIRED",
        );
      fail(409, "The login request was already handled.", "REQUEST_NOT_PENDING");
    }
    await resolveApprovalMessage(db, requestId, "APPROVED");
    await audit(db, "LOGIN_APPROVED", uid, row.new_device_id, {});
    return json({ ok: true });
  }

  if (path === "/api/auth/login/decline" && method === "POST") {
    rateLimit(`ld:${uid}`, 15, 10);
    const requestId = String(body.id || body.requestId || "")
      .trim()
      .slice(0, 64);
    if (!requestId) fail(400, "Missing request id.");
    // Owner round 3 (2026-09-04): a request can only be acted on inside its
    // 5-minute window — after that the answer is EXPIRED, whatever it is.
    const declined = await run(
      db,
      `UPDATE login_requests SET status = 'DECLINED', resolved_at = ?
        WHERE id = ? AND user_id = ? AND status = 'PENDING' AND expires_at > ?`,
      nowIso(),
      requestId,
      uid,
      nowIso(),
    );
    if (!declined) {
      const stale = await one<{ status: string; expires_at: string }>(
        db,
        "SELECT status, expires_at FROM login_requests WHERE id = ?",
        requestId,
      );
      if (stale?.status === "PENDING")
        fail(
          410,
          "The login request expired. Please try again from the other device.",
          "REQUEST_EXPIRED",
        );
      fail(409, "The login request was already handled.", "REQUEST_NOT_PENDING");
    }
    await resolveApprovalMessage(db, requestId, "DECLINED");
    await audit(db, "LOGIN_DECLINED", uid, null, {});
    return json({ ok: true });
  }

  if (path === "/api/auth/phone/change" && method === "POST") {
    // §23. Strict here on purpose: a number change re-points the account's
    // login identity, so the grace policy does NOT apply — the new number
    // must literally be present on this device's SIM (MATCH), or no change.
    rateLimit(`pc:${uid}`, 5, 2);
    const phone = normalizePhone(body.phone);
    const sim = parseSimResult(body.sim);
    if (sim !== "MATCH")
      fail(
        400,
        "We couldn't verify the new number on this device's SIM, so the number wasn't changed.",
        "MATCH_REQUIRED",
      );
    if (await one(db, "SELECT id FROM users WHERE phone_e164 = ? AND id != ?", phone, uid))
      fail(409, "That number is already linked to another account.", "PHONE_TAKEN");
    await run(
      db,
      `UPDATE users SET phone_e164 = ?, phone_verification_method = 'SIM_MATCH',
         phone_verified_at = ?,
         email = CASE WHEN email LIKE ? THEN ? ELSE email END
       WHERE id = ?`,
      phone,
      nowIso(),
      `%${PHONE_EMAIL_SUFFIX}`,
      phoneEmail(phone),
      uid,
    );
    await audit(db, "PHONE_CHANGED", uid, null, { phone: maskPhone(phone) });
    const row = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", uid))!;
    return json({ user: userSelf(row, true) });
  }

  /* ---------- realtime WebSocket upgrades (ChatRoom fan-out) ---------- */

  // One socket per open chat screen. Membership is verified HERE, before the
  // upgrade is forwarded to the Durable Object — the DO trusts the worker,
  // never the client. Auth rides the Authorization header (OkHttp sends it
  // on WS opens, unlike browsers).
  const wsChatMatch = path.match(/^\/ws\/chat\/([^/]+)$/);
  if (wsChatMatch && method === "GET" && env.CHAT_ROOM) {
    const convId = wsChatMatch[1]!;
    await requireMember(db, convId, uid);
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(convId));
    return stub.fetch(
      new Request("https://chat-room/connect", {
        headers: { upgrade: "websocket", "x-kp-user": uid },
      }),
    );
  }

  // Per-user chat-list channel: badges, previews, ordering updates.
  if (path === "/ws/user" && method === "GET" && env.CHAT_ROOM) {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(`user:${uid}`));
    return stub.fetch(
      new Request("https://chat-room/connect", {
        headers: { upgrade: "websocket", "x-kp-user": uid },
      }),
    );
  }

  // Per-call signalling channel (Step 3): state changes, ICE, renegotiation.
  // Only the two call participants may hold a socket to it.
  const wsCallMatch = path.match(/^\/ws\/call\/([^/]+)$/);
  if (wsCallMatch && method === "GET" && env.CALL_SIGNAL) {
    const callId = wsCallMatch[1]!;
    const row = await one<{ caller_id: string; callee_id: string }>(
      db,
      "SELECT caller_id, callee_id FROM calls WHERE id = ?",
      callId,
    );
    if (!row) fail(404, "Call not found.");
    if (row.caller_id !== uid && row.callee_id !== uid) fail(403, "Not your call.", "FORBIDDEN");
    const stub = env.CALL_SIGNAL.get(env.CALL_SIGNAL.idFromName(callId));
    return stub.fetch(
      new Request("https://call-signal/connect", {
        headers: { upgrade: "websocket", "x-kp-user": uid },
      }),
    );
  }

  if (path === "/api/me" && method === "GET") return json({ user: userSelf(me, true) });

  if (path === "/api/me" && method === "PATCH") {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.displayName !== undefined) {
      const name = String(body.displayName).trim().slice(0, 40);
      if (!name) fail(400, "Name can't be empty.");
      sets.push("display_name = ?");
      values.push(name);
    }
    if (body.about !== undefined) {
      sets.push("about = ?");
      values.push(String(body.about).slice(0, BIO_MAX_LENGTH));
    }
    if (body.username !== undefined) {
      const username = slugFrom(String(body.username));
      const taken = await one(
        db,
        "SELECT id FROM users WHERE username = ? AND id != ?",
        username,
        uid,
      );
      if (taken) fail(400, "That username is taken.");
      sets.push("username = ?");
      values.push(username);
    }
    if (body.avatarUrl !== undefined) {
      const avatar = String(body.avatarUrl || "");
      // data:text/html used to be accepted here and then served back verbatim by
      // the media endpoints — a stored XSS on the API origin.
      if (avatar && !isSafeDataUrl(avatar)) fail(400, "Bad avatar.", "BAD_MEDIA");
      // Avatars render at ~54dp; a 200KB data-URI inlined into every hot poll
      // was pure bandwidth/parse cost. 60KB still looks crisp at avatar size.
      if (avatar.length > 80_000) fail(400, "Avatar too large — pick a smaller image.");
      sets.push("avatar_url = ?");
      values.push(avatar || null);
      // Bump the cache token so every client refreshes this avatar once.
      sets.push("avatar_version = avatar_version + 1");
    }
    if (sets.length) {
      values.push(uid);
      await run(db, `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...values);
    }
    const row = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", uid))!;
    return json({ user: userSelf(row, true) });
  }

  /* ---------- KuchuPuchu AI ---------- */

  if (path === "/api/ai/welcome" && method === "POST") {
    // The client calls this once right after its FIRST login lands in the app
    // (idempotent: an account that already has its welcome gets a cheap
    // no-op). Driving it from the client keeps signup/login itself free of
    // the extra conversation + broadcast pokes, which every other flow that
    // mints a session would otherwise pay for.
    await sendAiWelcome(env, db, ctx, uid, me.display_name);
    return json({ ok: true });
  }

  if (path === "/api/devices" && method === "POST") {
    const token = String(body.token || "")
      .trim()
      .slice(0, 512);
    if (!token) fail(400, "Missing push token.");
    const deviceId = String(body.deviceId || "")
      .trim()
      .slice(0, 64);
    const platform = String(body.platform || "")
      .trim()
      .slice(0, 24);
    const appVersion = String(body.appVersion || "")
      .trim()
      .slice(0, 32);
    const at = nowIso();
    // Re-registering the same install refreshes last_seen_at, which is what makes
    // the cron's stale-device prune safe: an app that is still installed says so
    // on every start and on every boot.
    await run(
      db,
      `INSERT OR REPLACE INTO devices
         (token, user_id, updated_at, device_id, platform, app_version, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      token,
      uid,
      at,
      deviceId || null,
      platform || null,
      appVersion || null,
      at,
    );
    return json({ ok: true });
  }
  if (path === "/api/devices" && method === "DELETE") {
    // Targeted on purpose. The old blanket `WHERE user_id = ?` deleted every
    // device for the account, so "log out of this phone" switched off push on the
    // tablet too — §16: never assume one account has one device.
    const wantToken = (url.searchParams.get("token") || "").trim().slice(0, 512);
    const wantDevice = (url.searchParams.get("deviceId") || "").trim().slice(0, 64);
    const res = wantDevice
      ? await db
          .prepare("DELETE FROM devices WHERE user_id = ? AND device_id = ?")
          .bind(uid, wantDevice)
          .run()
      : wantToken
        ? await db
            .prepare("DELETE FROM devices WHERE user_id = ? AND token = ?")
            .bind(uid, wantToken)
            .run()
        : await db.prepare("DELETE FROM devices WHERE user_id = ?").bind(uid).run();
    return json({ ok: true, removed: res?.meta?.changes ?? 0 });
  }

  /* ---------- users & discovery ---------- */

  if (path === "/api/users" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    const rows = q
      ? await all<UserRow>(
          db,
          `SELECT * FROM users WHERE (${instrLike("username")} OR ${instrLike("display_name")}) AND id != ? ORDER BY last_active_at DESC LIMIT 20`,
          instrTerm(q),
          instrTerm(q),
          uid,
        )
      : await all<UserRow>(
          db,
          "SELECT * FROM users WHERE id != ? ORDER BY last_active_at DESC LIMIT 20",
          uid,
        );
    // Block filtering in one two-sided query instead of a blockedBetween()
    // round trip per row — the new-chat screen was 2+N for a 20-user page.
    const blocked = new Set<string>();
    for (const group of chunked(rows.map((r) => r.id))) {
      const hit = await all<{ owner_id: string; target_id: string }>(
        db,
        `SELECT owner_id, target_id FROM blocks
          WHERE (owner_id = ? AND target_id IN (${inSql(group.length)}))
             OR (target_id = ? AND owner_id IN (${inSql(group.length)}))`,
        uid,
        ...group,
        uid,
        ...group,
      );
      for (const b of hit) blocked.add(b.owner_id === uid ? b.target_id : b.owner_id);
    }
    const list = rows
      .filter((row) => !blocked.has(row.id))
      // Light: discovery pages render rows of 54dp avatars — the data-URI
      // for every result is fetched once per avatarRef by the client.
      .map((row) => userFrom(row, onlineNow(row), true));
    return json({ users: list });
  }

  // Avatar bytes keyed by the user id; the data-URI only (the list endpoints
  // send a tiny avatarRef instead). ETag/If-None-Match plus a long CDN lifetime
  // make this one fetch per avatar *change* — not per poll.
  const avatarMatch = path.match(/^\/api\/users\/([^/]+)\/avatar$/);
  if (avatarMatch && method === "GET") {
    const row = await one<{ avatar_url: string | null; avatar_version: number | null }>(
      db,
      "SELECT avatar_url, avatar_version FROM users WHERE id = ?",
      avatarMatch[1]!,
    );
    // The profile route scrubs the blob when blocked; this is the same blob, so
    // it has to refuse too — otherwise the guard is one URL away.
    if (await blockedBetween(db, uid, avatarMatch[1]!)) fail(404, "Not found.", "NOT_FOUND");
    const version = row?.avatar_version ?? 0;
    const etag = `"av-${avatarMatch[1]!.slice(0, 8)}-v${version}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    if (!row?.avatar_url)
      return new Response(JSON.stringify({ avatarUrl: null, avatarRef: null }), {
        headers: {
          "content-type": "application/json",
          etag,
          "cache-control": "private, max-age=300",
        },
      });
    return new Response(
      JSON.stringify({ avatarUrl: row.avatar_url, avatarRef: `${avatarMatch[1]}@v${version}` }),
      {
        headers: {
          "content-type": "application/json",
          etag,
          // data-URIs are immutable per version; let the client keep them.
          "cache-control": "private, max-age=86400",
        },
      },
    );
  }

  const userNameMatch = path.match(/^\/api\/users\/username\/([a-z0-9_]+)$/);
  if (userNameMatch && method === "GET") {
    const row = await one<UserRow>(db, "SELECT * FROM users WHERE username = ?", userNameMatch[1]!);
    if (!row) fail(404, "User not found.");
    if (await blockedBetween(db, uid, row.id)) fail(403, "You can't reach this user.", "BLOCKED");
    return json({ user: userFrom(row, onlineNow(row)) });
  }

  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "GET") {
    const row = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", userMatch[1]!);
    if (!row) fail(404, "User not found.");
    // Blocked in either direction used to hand the full profile — including the
    // 200 KB avatar data-URI — across the wall, while the username route already
    // refused. A hard 403 here would be worse though: this screen is the only
    // place Unblock exists, so 403-ing it would trap someone in their own block
    // list. So: the identity stays (that is what a blocked list needs to show),
    // everything private stops at the wall, and `blocked` is finally a server
    // answer instead of a client guess — which is what made the button read
    // "Block" for users already blocked, and re-POST on tap.
    if (await blockedBetween(db, uid, row.id)) {
      return json({
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          about: null,
          online: false,
          lastActiveAt: null,
          avatarUrl: null,
          avatarRef: null,
          blocked: true,
        },
      });
    }
    return json({ user: { ...userFrom(row, onlineNow(row)), blocked: false } });
  }

  // Profile lookups embedded by the search/chats screens were full
  // userFrom() rows including the data-URI avatar; keep those hot lists light.

  /* ---------- blocks ---------- */

  if (path === "/api/blocks" && method === "POST") {
    const target = String(body.userId || "");
    if (!target || target === uid) fail(400, "Bad user.");
    // The system accounts can't be blocked — they deliver security notices.
    if (target === OFFICIAL_BOT_ID || target === AI_BOT_ID)
      fail(403, "You can't block an official account.", "BOT_ACCOUNT");
    await run(
      db,
      "INSERT OR IGNORE INTO blocks (owner_id, target_id, created_at) VALUES (?, ?, ?)",
      uid,
      target,
      nowIso(),
    );
    return json({ ok: true });
  }
  const blockMatch = path.match(/^\/api\/blocks\/([^/]+)$/);
  if (blockMatch && method === "DELETE") {
    await run(db, "DELETE FROM blocks WHERE owner_id = ? AND target_id = ?", uid, blockMatch[1]!);
    return json({ ok: true });
  }
  if (path === "/api/blocks" && method === "GET") {
    const rows = await all<{ target_id: string }>(
      db,
      "SELECT target_id FROM blocks WHERE owner_id = ?",
      uid,
    );
    const list = [];
    for (const row of rows) {
      const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", row.target_id);
      if (user) list.push(userFrom(user, false));
    }
    return json({ users: list });
  }

  /* ---------- conversations ---------- */

  if (path === "/api/conversations" && method === "POST") {
    const other = String(body.userId || "");
    if (!other || other === uid) fail(400, "Bad user.");
    // The group route checks this; the 1:1 one did not, so a made-up id
    // minted a conversation plus a member row that no one can ever read — and
    // `userFrom(null)` downstream is exactly the kind of ghost that shows up as
    // an empty chat card forever.
    if (!(await one<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", other)))
      fail(404, "User not found.");
    if (await blockedBetween(db, uid, other)) fail(403, "You can't reach this user.", "BLOCKED");
    const convId = pairId(uid, other);
    if (!(await one(db, "SELECT id FROM conversations WHERE id = ?", convId))) {
      const created = nowIso();
      await run(
        db,
        "INSERT INTO conversations (id, kind, created_at, hidden_json) VALUES (?, 'SOLO', ?, '{}')",
        convId,
        created,
      );
      await run(
        db,
        "INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
        convId,
        uid,
        created,
      );
      await run(
        db,
        "INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
        convId,
        other,
        created,
      );
    } else {
      const hidden = parseJson<Record<string, number>>(await hiddenJson(db, convId), {});
      delete hidden[uid];
      await run(
        db,
        "UPDATE conversations SET hidden_json = ? WHERE id = ?",
        JSON.stringify(hidden),
        convId,
      );
    }
    const conv = await conversationDetail(db, convId, uid);
    return json({ conversation: conv });
  }

  if (path === "/api/conversations/group" && method === "POST") {
    const title =
      String(body.title || "")
        .trim()
        .slice(0, 50) || "New group";
    const requested = Array.isArray(body.memberIds)
      ? [...new Set((body.memberIds as unknown[]).map(String).filter((x) => x && x !== uid))].slice(
          0,
          50,
        )
      : [];
    if (!requested.length) fail(400, "Pick at least one member.");
    // Ids used to go straight into `members` unchecked, so a group could be
    // created around accounts that do not exist (leaving rows that render as
    // blank members) and around people who had blocked the creator.
    const memberIds: string[] = [];
    for (const candidate of requested) {
      // System accounts live in 1:1 chats only (owner rule): they deliver
      // security notices / AI help, not group chatter.
      if (candidate === OFFICIAL_BOT_ID || candidate === AI_BOT_ID) continue;
      if (!(await one(db, "SELECT id FROM users WHERE id = ?", candidate))) continue;
      if (await blockedBetween(db, uid, candidate)) continue;
      memberIds.push(candidate);
    }
    if (!memberIds.length) fail(400, "None of those players can be added.", "NO_MEMBERS");
    const convId = id();
    const created = nowIso();
    await run(
      db,
      "INSERT INTO conversations (id, kind, title, owner_id, created_at, hidden_json) VALUES (?, 'GROUP', ?, ?, ?, '{}')",
      convId,
      title,
      uid,
      created,
    );
    await run(
      db,
      "INSERT INTO members (conv_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      convId,
      uid,
      created,
    );
    for (const memberId of memberIds) {
      await run(
        db,
        "INSERT OR IGNORE INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
        convId,
        memberId,
        created,
      );
    }
    await systemMessage(db, convId, `${me.display_name} created "${title}"`);
    const conv = await conversationDetail(db, convId, uid);
    return json({ conversation: conv }, 201);
  }

  if (path === "/api/conversations" && method === "GET") {
    const rows = await all<{ id: string }>(
      db,
      "SELECT c.id FROM conversations c JOIN members m ON m.conv_id = c.id WHERE m.user_id = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC",
      uid,
    );
    // One statement each for the conversations, their members and those
    // members' user rows. This used to call conversationDetail() per chat,
    // which fetched its own conversation, members and every member's user row
    // inside the loop - 1 + 5N round trips, so five chats cost 29 statements
    // and a busy user paid for it on every 2.5s poll.
    const ids = rows.map((r) => r.id);
    const convs = new Map<string, ConvRow>();
    const membersByConv = new Map<string, ConvMemberRow[]>();
    const userIds: string[] = [];
    for (const group of chunked(ids)) {
      for (const c of await all<ConvRow>(
        db,
        `SELECT ${CONV_COLS} FROM conversations WHERE id IN (${inSql(group.length)})`,
        ...group,
      )) {
        convs.set(c.id, c);
      }
      for (const m of await all<ConvMemberRow>(
        db,
        `SELECT ${MEMBER_COLS} FROM members WHERE conv_id IN (${inSql(group.length)})`,
        ...group,
      )) {
        const bucket = membersByConv.get(m.conv_id!);
        if (bucket) bucket.push(m);
        else membersByConv.set(m.conv_id!, [m]);
        userIds.push(m.user_id);
      }
    }
    const users = await usersById(db, userIds);

    // The newest-rowid probe exists ONLY for the "delete chat" watermark, and a
    // watermark only ever exists on a SOLO chat somebody deleted. It used to be a
    // correlated subquery in the conversation SELECT, so SQLite walked that chat's
    // whole index range on EVERY list poll, for EVERY chat the user has: the read
    // cost per tick was ~ the total message count of the account. With a 2s
    // fallback poll that is 43k ticks a day — which is how an 8.6 MB database
    // burned 11M row reads and hit D1's free-tier cap (2026-09-01: 75k queries,
    // 11M rows read, every endpoint 500 for the last hour). Now it runs once, and
    // only for the handful of conversations that actually carry a numeric mark.
    const marks = new Map<string, ReturnType<typeof watermarkFor>>();
    for (const c of convs.values()) {
      marks.set(
        c.id,
        c.kind === "SOLO"
          ? watermarkFor(parseJson<HiddenMap>(c.hidden_json ?? "{}", {}), uid)
          : null,
      );
    }
    const needMax = [...convs.values()]
      .filter((c) => (marks.get(c.id)?.row ?? -1) >= 0)
      .map((c) => c.id);
    for (const group of chunked(needMax)) {
      for (const r of await all<{ conv_id: string; max_row: number }>(
        db,
        `SELECT conv_id, MAX(rowid) AS max_row FROM messages WHERE conv_id IN (${inSql(group.length)}) GROUP BY conv_id`,
        ...group,
      )) {
        const c = convs.get(r.conv_id!);
        if (c) c.max_row = r.max_row;
      }
    }
    const list = [];
    for (const row of rows) {
      const conv = convs.get(row.id);
      if (!conv) continue;
      // hidden_json[uid] is the epoch-ms at which this member deleted the chat.
      // It stays hidden until a message newer than that arrives. The old test
      // only hid chats that had *never* had a message, so deleting any real
      // conversation was a no-op and the row came straight back.
      // hidden_json is only ever written for SOLO chats - deleting a group
      // makes the member leave it instead.
      const mark = marks.get(conv.id) ?? null;
      if (mark && conv.kind === "SOLO") {
        if (mark.row >= 0) {
          if (Number(conv.max_row || 0) <= mark.row) continue;
        } else {
          const lastAt = conv.last_message_at ? Date.parse(conv.last_message_at) : 0;
          if (!lastAt || lastAt <= Date.parse(mark.at)) continue;
        }
      }
      list.push(buildConvDetail(conv, membersByConv.get(conv.id) ?? [], users, uid, true));
    }
    // Freshness marker: everything the client renders (order fields, unread,
    // preview, mute, hidden-state) folded into one hash. Unchanged marker =>
    // skip the payload entirely on the client.
    // title + other member's identity are in the hash too: a group rename or
    // a contact changing their name/avatar must reach marker-gated clients.
    // (Presence/online is deliberately excluded - it flips too often and
    // would turn every poll back into a full fetch.)
    const marker = hashSig(
      JSON.stringify([
        list.map((c: Record<string, unknown>) => [
          c.id,
          c.lastMessageAt,
          c.lastMessage,
          c.unread,
          c.muted,
          c.title,
          c.other
            ? [
                (c.other as Record<string, unknown>).displayName,
                // avatarUrl is null in the light list shape; the avatar cache
                // token is what must change here when a contact swaps photos.
                (c.other as Record<string, unknown>).avatarRef ??
                  (c.other as Record<string, unknown>).avatarUrl,
              ]
            : null,
        ]),
      ]),
    );
    const clientMarker = url.searchParams.get("marker");
    if (clientMarker && clientMarker === marker) return json({ marker, unchanged: true });
    return json({ items: list, marker });
  }

  const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (convMatch && method === "GET") {
    const convId = convMatch[1]!;
    await requireMember(db, convId, uid);
    const conv = await conversationDetail(db, convId, uid);
    return json({ conversation: conv });
  }
  if (convMatch && method === "PATCH") {
    const convId = convMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    // The disappearing timer deletes messages for *everyone* in the chat, so in
    // a group only the owner may change it (or the theme). Any member being
    // able to set it meant any member could wipe the whole group's history.
    const changesSharedSettings = body.disappearSeconds !== undefined || body.theme !== undefined;
    if (conv.kind === "GROUP" && changesSharedSettings && conv.owner_id !== uid) {
      fail(403, "Only the group owner can change these settings.", "FORBIDDEN");
    }
    if (body.disappearSeconds !== undefined) {
      const sec = Math.max(0, Number(body.disappearSeconds) || 0);
      // Stamp the moment the timer is turned on. The reaper used to delete
      // every message older than the TTL with no lower bound, so switching on a
      // 24h timer destroyed the chat's entire existing history for both people
      // instead of only applying to what was sent afterwards.
      await run(
        db,
        "UPDATE conversations SET disappear_seconds = ?, disappear_since = ? WHERE id = ?",
        sec,
        sec > 0 ? nowIso() : null,
        convId,
      );
    }
    if (body.theme !== undefined) {
      const theme = String(body.theme || "default").slice(0, 20);
      await run(db, "UPDATE conversations SET theme = ? WHERE id = ?", theme, convId);
    }
    return json({ conversation: await conversationDetail(db, convId, uid) });
  }

  const convSearch = path.match(/^\/api\/conversations\/([^/]+)\/messages\/search$/);
  if (convSearch && method === "GET") {
    const convId = convSearch[1]!;
    await requireMember(db, convId, uid);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (q.length < 2) return json({ items: [] });
    const rows = await all<MsgRow>(
      db,
      `SELECT * FROM messages WHERE conv_id = ? AND kind IN ('TEXT','IMAGE','FILE') AND LOWER(IFNULL(body,'')) LIKE ?${ESCAPED_LIKE}
       ORDER BY created_at DESC, rowid DESC LIMIT 40`,
      convId,
      likeTerm(q),
    );
    return json({ items: rows.map((row) => msgFrom(row)) });
  }

  const convMedia = path.match(/^\/api\/conversations\/([^/]+)\/media$/);
  if (convMedia && method === "GET") {
    const convId = convMedia[1]!;
    await requireMember(db, convId, uid);
    const rows = await all<MsgRow>(
      db,
      "SELECT * FROM messages WHERE conv_id = ? ORDER BY created_at DESC LIMIT 400",
      convId,
    );
    const images: ReturnType<typeof msgFrom>[] = [];
    const docs: ReturnType<typeof msgFrom>[] = [];
    const links: ReturnType<typeof msgFrom>[] = [];
    const urlRe = /https?:\/\/[^\s]+/gi;
    for (const row of rows) {
      const m = msgFrom(row);
      if (row.kind === "IMAGE" || m.hasImage) images.push(m);
      else if (row.kind === "FILE") docs.push(m);
      else if (row.body && urlRe.test(row.body)) {
        urlRe.lastIndex = 0;
        links.push(m);
      }
    }
    return json({ images, docs, links });
  }

  const memberAddMatch = path.match(/^\/api\/conversations\/([^/]+)\/members$/);
  if (memberAddMatch && method === "POST") {
    const convId = memberAddMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    if (conv.kind !== "GROUP") fail(400, "Only groups can add members.");
    // Matches the rule the remove endpoint already enforced ("Only the group
    // owner can remove others"); before this any member could add anyone.
    if (conv.owner_id !== uid) fail(403, "Only the group owner can add members.", "FORBIDDEN");
    const target = String(body.userId || "");
    if (!target) fail(400, "Bad user.");
    const targetUser = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", target);
    if (!targetUser) fail(404, "User not found.");
    // System accounts live in 1:1 chats only (owner rule).
    if (target === OFFICIAL_BOT_ID || target === AI_BOT_ID)
      fail(400, "Official accounts can't be added to groups.", "BOT_ACCOUNT");
    if (await blockedBetween(db, uid, target)) fail(403, "You can't add this player.", "BLOCKED");
    await run(
      db,
      "INSERT OR IGNORE INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
      convId,
      target,
      nowIso(),
    );
    await systemMessage(db, convId, `${me.display_name} added ${targetUser.display_name}`);
    return json({ ok: true });
  }

  const memberRemoveMatch = path.match(/^\/api\/conversations\/([^/]+)\/members\/([^/]+)$/);
  if (memberRemoveMatch && method === "DELETE") {
    const convId = memberRemoveMatch[1]!;
    const targetId = memberRemoveMatch[2]!;
    const { conv } = await requireMember(db, convId, uid);
    if (conv.kind !== "GROUP") fail(400, "Only groups can remove members.");
    if (conv.owner_id !== uid && targetId !== uid)
      fail(403, "Only the group owner can remove others.");
    const targetUser = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", targetId);
    await run(db, "DELETE FROM members WHERE conv_id = ? AND user_id = ?", convId, targetId);
    if (targetUser) {
      await systemMessage(
        db,
        convId,
        targetId === uid
          ? `${targetUser.display_name} left`
          : `${me.display_name} removed ${targetUser.display_name}`,
      );
    }
    return json({ ok: true });
  }

  const readMatch = path.match(/^\/api\/conversations\/([^/]+)\/read$/);
  if (readMatch && method === "POST") {
    await requireMember(db, readMatch[1]!, uid);
    const at = nowIso();
    await run(
      db,
      "UPDATE members SET last_read_at = ?, unread = 0 WHERE conv_id = ? AND user_id = ?",
      at,
      readMatch[1]!,
      uid,
    );
    // Realtime: the sender's ticks flip blue the moment this lands, not on
    // their next poll. (WS only — the poll fallback still reads it from the
    // messages endpoint.)
    ctx.waitUntil(
      broadcastRoomEvent(env, readMatch[1]!, {
        type: "read",
        conversationId: readMatch[1]!,
        userId: uid,
        at,
      }),
    );
    return json({ ok: true });
  }

  const muteMatch = path.match(/^\/api\/conversations\/([^/]+)\/mute$/);
  if (muteMatch && method === "POST") {
    await requireMember(db, muteMatch[1]!, uid);
    await run(
      db,
      "UPDATE members SET muted = ? WHERE conv_id = ? AND user_id = ?",
      body.muted ? 1 : 0,
      muteMatch[1]!,
      uid,
    );
    return json({ ok: true });
  }

  if (convMatch && method === "DELETE") {
    const convId = convMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    if (conv.kind === "GROUP") {
      await run(db, "DELETE FROM members WHERE conv_id = ? AND user_id = ?", convId, uid);
      await systemMessage(db, convId, `${me.display_name} left`);
    } else {
      const hidden = parseJson<HiddenMap>(await hiddenJson(db, convId), {});
      const newest = await one<{ row: number | null }>(
        db,
        "SELECT MAX(rowid) AS row FROM messages WHERE conv_id = ?",
        convId,
      );
      hidden[uid] = { row: Number(newest?.row || 0), at: nowIso() };
      await run(
        db,
        "UPDATE conversations SET hidden_json = ? WHERE id = ?",
        JSON.stringify(hidden),
        convId,
      );
    }
    return json({ ok: true });
  }

  // Owner round 7 (2026-09-04, fixed round 8): AI-chat "New chat" /
  // "Incognito" — archives the current session (so History can show it) and
  // clears the conversation so the bot starts fresh. NOTE: this route needs
  // its OWN regex — `convMatch` is anchored with `$` to the conversation id
  // and never matched ".../reset", which is why the first version 404'd and
  // the menu items did nothing.
  const convResetMatch = path.match(/^\/api\/conversations\/([^/]+)\/reset$/);
  if (convResetMatch && method === "POST") {
    const convId = convResetMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    const other =
      conv.kind === "GROUP"
        ? null
        : await one<{ id: string }>(
            db,
            `SELECT id FROM users WHERE id =
               (SELECT user_id FROM members WHERE conv_id = ? AND user_id != ? LIMIT 1)`,
            convId,
            uid,
          );
    if (!other || (other.id !== AI_BOT_ID && other.id !== OFFICIAL_BOT_ID))
      fail(403, "Only bot chats can be reset.");
    // Archive the outgoing session for the in-app History list, then clear.
    const sessionId = id();
    await run(
      db,
      `INSERT INTO ai_sessions (id, user_id, conv_id, created_at, ended_at, msg_count)
       SELECT ?, ?, ?, COALESCE(MIN(created_at), ?), ?, COUNT(*)
         FROM messages WHERE conv_id = ?`,
      sessionId,
      uid,
      convId,
      nowIso(),
      nowIso(),
      convId,
    );
    await run(
      db,
      `INSERT INTO ai_session_msgs (session_id, seq, sender_id, kind, body, created_at)
       SELECT ?, ROW_NUMBER() OVER (ORDER BY rowid), sender_id, kind, body, created_at
         FROM messages WHERE conv_id = ?`,
      sessionId,
      convId,
    );
    await run(db, "DELETE FROM messages WHERE conv_id = ?", convId);
    await run(
      db,
      "UPDATE conversations SET last_message = NULL, last_message_at = NULL WHERE id = ?",
      convId,
    );
    return json({ ok: true });
  }

  // Owner round 8 (2026-09-04): AI session History — the archived sessions
  // of the signed-in user, newest first.
  if (path === "/api/ai/sessions" && method === "GET") {
    const rows = await all<{
      id: string;
      created_at: string;
      ended_at: string;
      msg_count: number;
    }>(
      db,
      "SELECT id, created_at, ended_at, msg_count FROM ai_sessions WHERE user_id = ? ORDER BY ended_at DESC LIMIT 50",
      uid,
    );
    return json({
      sessions: rows.map((r) => ({
        id: r.id,
        startedAt: r.created_at,
        endedAt: r.ended_at,
        messages: r.msg_count,
      })),
    });
  }
  const aiSessionMatch = path.match(/^\/api\/ai\/sessions\/([^/]+)$/);
  if (aiSessionMatch && method === "GET") {
    const sess = await one<{ id: string; user_id: string }>(
      db,
      "SELECT id, user_id FROM ai_sessions WHERE id = ?",
      aiSessionMatch[1]!,
    );
    if (!sess || sess.user_id !== uid) fail(404, "Session not found.");
    const msgs = await all<{
      sender_id: string;
      kind: string;
      body: string | null;
      created_at: string;
    }>(
      db,
      "SELECT sender_id, kind, body, created_at FROM ai_session_msgs WHERE session_id = ? ORDER BY seq",
      sess.id,
    );
    return json({
      messages: msgs.map((m) => ({
        senderId: m.sender_id,
        kind: m.kind,
        body: m.body,
        createdAt: m.created_at,
      })),
    });
  }

  // A/B push tester: shape A = notification payload (system-drawn card, no
  // actions possible), shape B = data-only (our own notification draws
  // Reply/Like — but only if the OS wakes/hands it to the app process).
  // This decides the whole push architecture with EVIDENCE, not guesses.
  if (path === "/api/debug/push" && method === "POST") {
    if (!env.DEBUG_KEY || url.searchParams.get("key") !== env.DEBUG_KEY)
      fail(404, "Not found.", "NOT_FOUND");
    const shape = url.searchParams.get("shape") === "B" ? "B" : "A";
    const target = String(body.userId || "");
    if (!target) fail(400, "userId required.");
    const auth = await fcmAccessToken(env);
    if (!auth) fail(501, "FCM not configured.");
    const rows = await all<{ token: string }>(
      db,
      "SELECT token FROM devices WHERE user_id = ?",
      target,
    );
    const label = shape === "A" ? "TEST-A payload-card" : "TEST-B data-only-actions";
    const results: Array<{ token: string; status: number; err?: string }> = [];
    await Promise.all(
      rows.map(async (row) => {
        const msg: Record<string, unknown> = {
          token: row.token,
          android: { priority: "HIGH", ttl: "3600s" },
          data: {
            type: "message",
            convoId: String(body.convoId || ""),
            fromName: label,
            body: `${label} — ${nowIso().slice(11, 19)}`,
            kp_chat: String(body.convoId || ""),
          },
        };
        if (shape === "A") {
          (msg as { android: { notification?: unknown } }).android.notification = {
            title: label,
            body: `${label} — ${nowIso().slice(11, 19)}`,
            channel_id: "kp_messages_v2",
          };
        }
        try {
          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${auth.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ message: msg }),
            },
          );
          results.push({
            token: row.token.slice(0, 12),
            status: res.status,
            err:
              res.status >= 400
                ? JSON.stringify(await res.json().catch(() => null)).slice(0, 200)
                : undefined,
          });
        } catch (e) {
          results.push({ token: row.token.slice(0, 12), status: 0, err: String(e).slice(0, 120) });
        }
      }),
    );
    return json({ devices: rows.length, shape, results });
  }

  // Delivery ack for data-only pushes. The R31 payload-fallback table this
  // used to clean up has had NO writers since the R32 revert, so the per-ack
  // DELETE was a wasted D1 write on every single push receive. Kept as a
  // no-op endpoint: older app builds still POST it.
  if (path === "/api/push/ack" && method === "POST") {
    return json({ ok: true });
  }

  // Client breadcrumbs: the app reports doc-open/push-receive stages so
  // "kichui hoi na" becomes exact evidence instead of a guess.
  if (path === "/api/debug/clientlog" && method === "POST") {
    // Already inside the authenticated section: `uid` is the caller.
    // Every 500 in the API inserts a row here too, so an unthrottled client log
    // was an unbounded write primitive — one logged-in account could grow
    // `error_log` as fast as it could loop.
    rateLimit(`clog:${uid}`, 30, 10);
    const stage = String(body.stage || "").slice(0, 60);
    const detail = String(body.detail || "").slice(0, 500);
    if (stage) {
      await run(
        db,
        "INSERT INTO error_log (id, stack, created_at) VALUES (?, ?, ?)",
        crypto.randomUUID(),
        `CLIENT[${uid.slice(0, 8)}] ${stage} :: ${detail}`,
        nowIso(),
      );
    }
    return json({ ok: true });
  }

  const debugMatch = path.match(/^\/api\/debug\/errors$/);
  if (debugMatch && method === "GET") {
    if (!env.DEBUG_KEY || url.searchParams.get("key") !== env.DEBUG_KEY)
      fail(404, "Not found.", "NOT_FOUND");
    const rows = await all<{ id: string; stack: string; created_at: string }>(
      db,
      "SELECT id, stack, created_at FROM error_log ORDER BY rowid DESC LIMIT 20",
    );
    return json({ items: rows });
  }

  /* ---------- messages ---------- */

  const typingMatch = path.match(/^\/api\/conversations\/([^/]+)\/typing$/);
  if (typingMatch && method === "POST") {
    const convId = typingMatch[1]!;
    await requireMember(db, convId, uid);
    const at = nowIso();
    await run(
      db,
      `INSERT INTO typing (conv_id, user_id, at) VALUES (?, ?, ?)
       ON CONFLICT (conv_id, user_id) DO UPDATE SET at = excluded.at`,
      convId,
      uid,
      at,
    );
    // Realtime typing indicator: the other side's "typing…" header lights up
    // instantly instead of on its next poll tick.
    ctx.waitUntil(
      broadcastRoomEvent(env, convId, {
        type: "typing",
        conversationId: convId,
        userId: uid,
        at,
      }),
    );
    // Cheap lazy expiry: pings older than a minute are dead weight.
    if (Date.now() > nextTypingSweep) {
      nextTypingSweep = Date.now() + 30_000;
      ctx.waitUntil(
        run(
          db,
          "DELETE FROM typing WHERE at < ?",
          new Date(Date.now() - 60_000).toISOString(),
        ).then(() => undefined),
      );
    }
    return json({ ok: true });
  }

  const msgMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgMatch && method === "GET") {
    const convId = msgMatch[1]!;
    // requireMember now carries the disappear settings and the delete
    // watermarks in its single JOIN — two dedicated SELECTs used to run here
    // on every poll tick before the page query even started.
    const { conv } = await requireMember(db, convId, uid);
    const ttl = Number(conv.disappear_seconds || 0);
    const disappearSince = conv.disappear_since || null;
    // Nothing expires before the timer was switched on, so history predating it
    // survives. The rows are filtered out of the response below rather than
    // relying on the DELETE having run, and the DELETE itself is throttled: it
    // used to write to the messages table on every single read of the chat.
    const expiry = ttl > 0 ? new Date(Date.now() - ttl * 1000).toISOString() : null;
    if (expiry) {
      if (Date.now() > nextExpirySweep) {
        nextExpirySweep = Date.now() + 60_000;
        ctx.waitUntil(
          run(
            db,
            `DELETE FROM messages WHERE conv_id = ? AND created_at < ?${disappearSince ? " AND created_at >= ?" : ""}`,
            convId,
            expiry,
            ...(disappearSince ? [disappearSince] : []),
          ).then(() => undefined),
        );
      }
    }
    // Messages the member deleted for themselves stay deleted. Without this a
    // chat that reappeared after a new message came back with its whole
    // history, which is not what "delete chat" means.
    const mark = watermarkFor(parseJson<HiddenMap>(conv.hidden_json ?? "{}", {}), uid);
    const sinceClause = mark ? (mark.row >= 0 ? "AND rowid > ?" : "AND created_at > ?") : "";
    const sinceArgs = mark ? [mark.row >= 0 ? mark.row : mark.at] : [];
    // Live means "not expired yet" OR "sent before the timer was armed". The
    // second arm is what keeps existing history alive: a message only counts as
    // expiring if it was written after the timer went on. Rows from before the
    // disappear_since column existed have no stamp and fall back to the plain
    // TTL cut.
    const liveClause = expiry
      ? disappearSince
        ? "AND (created_at >= ? OR created_at < ?)"
        : "AND created_at >= ?"
      : "";
    const liveArgs = expiry ? (disappearSince ? [expiry, disappearSince] : [expiry]) : [];
    // §39 cursor: `created_at` alone is ambiguous (ms resolution), so the client
    // pages back with (createdAt, rowid) and `PAGE + 1` rows are read to learn
    // whether anything older exists. A COUNT(*) probe would cost the same read on
    // the hottest route in the app, and a page-full test converges anyway.
    const beforeRaw = url.searchParams.get("before");
    // A cursor the client made up (or that survived a code change) must not be
    // compared as TEXT: `created_at < 'not-a-date'` is true for every real row, so
    // a garbage cursor used to silently return the NEWEST page and the client
    // would re-add rows it already had. Reject it; the app resets paging on a 400.
    const before =
      beforeRaw && beforeRaw.length <= 40 && Number.isFinite(Date.parse(beforeRaw))
        ? beforeRaw
        : null;
    if (beforeRaw && before === null) fail(400, "Malformed pagination cursor.", "BAD_CURSOR");
    // created_at is millisecond-resolution text, so several messages routinely
    // share one value. Without a rowid tiebreaker both the ORDER BY and the
    // `created_at < ?` cursor were ambiguous and paging back silently dropped
    // every message that shared the boundary timestamp.
    const PAGE = 50;
    const rows = before
      ? await all<MsgRow & { kp_rowid?: number }>(
          db,
          `SELECT *, rowid AS kp_rowid FROM messages WHERE conv_id = ? ${sinceClause} ${liveClause}
             AND (created_at < ? OR (created_at = ? AND rowid < ?))
           ORDER BY created_at DESC, rowid DESC LIMIT ${PAGE + 1}`,
          convId,
          ...sinceArgs,
          ...liveArgs,
          before,
          before,
          Number(url.searchParams.get("beforeRowid") || 0) || Number.MAX_SAFE_INTEGER,
        )
      : await all<MsgRow & { kp_rowid?: number }>(
          db,
          `SELECT *, rowid AS kp_rowid FROM messages WHERE conv_id = ? ${sinceClause} ${liveClause}
           ORDER BY created_at DESC, rowid DESC LIMIT ${PAGE + 1}`,
          convId,
          ...sinceArgs,
          ...liveArgs,
        );
    const hasMore = rows.length > PAGE;
    if (hasMore) rows.pop();
    // Captured NOW, while `rows` is still DESC: `items` below is built with
    // rows.reverse(), which mutates the array in place — reading rows[last] after
    // that hands back the NEWEST row, i.e. a cursor that pages forward forever.
    const oldestRow = rows[rows.length - 1];
    // Sender names in ONE round trip (chunked IN), not one SELECT per distinct
    // sender. A 50-message group page used to issue up to 50 extra D1 round
    // trips — every one of them edge→primary latency on the caller.
    const names = new Map<string, string>();
    for (const group of chunked([...new Set(rows.map((r) => r.sender_id).filter(Boolean))])) {
      const sent = await all<{ id: string; display_name: string }>(
        db,
        `SELECT id, display_name FROM users WHERE id IN (${inSql(group.length)})`,
        ...group,
      );
      for (const u of sent) names.set(u.id, u.display_name);
    }
    const items = rows
      .reverse()
      .map((row) => ({ ...msgFrom(row), senderName: names.get(row.sender_id) }));
    // Delivery receipts: the fetching member has now received every message
    // in this page that someone else sent (only mark the ones still pending).
    const inboxIds = rows
      .filter((r) => r.sender_id && r.sender_id !== uid && !r.delivered_at)
      .map((r) => r.id);
    if (inboxIds.length) {
      const deliveredAt = nowIso();
      await run(
        db,
        `UPDATE messages SET delivered_at = ? WHERE id IN (${inboxIds.map(() => "?").join(",")})`,
        deliveredAt,
        ...inboxIds,
      );
      // The rows were read BEFORE that UPDATE, so the in-memory page still says
      // `deliveredAt: null` while the database now says otherwise. The freshness
      // marker below is hashed from this same page — so the marker handed to the
      // client was the pre-delivery one, and the very next poll (the common case,
      // right after a message arrives) could never answer `unchanged`: a full
      // refetch of 50 messages plus the delivery UPDATE, every time, for every
      // chat. Reflect the write here so the marker describes what was served.
      for (const item of items) {
        if (inboxIds.includes(String(item.id))) item.deliveredAt = deliveredAt;
      }
      // An offline recipient has just pulled these messages. Notify every
      // affected sender immediately; otherwise a sender whose room socket is
      // healthy never polls and their tick remains stuck on "sent".
      const senderIds = [
        ...new Set(
          rows
            .filter((r) => inboxIds.includes(r.id) && r.sender_id && r.sender_id !== uid)
            .map((r) => r.sender_id),
        ),
      ];
      ctx.waitUntil(
        broadcastRoomEvent(env, convId, {
          type: "delivered",
          conversationId: convId,
          messageIds: inboxIds,
          senderIds,
          at: deliveredAt,
        }),
      );
      for (const senderId of senderIds) {
        ctx.waitUntil(pokeUserConversation(env, senderId, convId, deliveredAt));
      }
    }
    // Read receipts for the sender. In a group this is the *oldest* read time
    // and only when every other member has read something — MAX() used to flip
    // everyone's ticks blue as soon as one person out of five opened the chat.
    const readRow = await one<{ r: string | null; unreadMembers: number }>(
      db,
      `SELECT MIN(last_read_at) AS r,
              SUM(CASE WHEN last_read_at IS NULL THEN 1 ELSE 0 END) AS unreadMembers
       FROM members WHERE conv_id = ? AND user_id != ?`,
      convId,
      uid,
    );
    const readAt = readRow && Number(readRow.unreadMembers || 0) === 0 ? readRow.r : null;
    // Typing indicator: the OTHER members' freshest ping, if any. The client
    // treats it as typing while it is younger than ~6s.
    const typingRow = await one<{ at: string }>(
      db,
      "SELECT at FROM typing WHERE conv_id = ? AND user_id != ? ORDER BY at DESC LIMIT 1",
      convId,
      uid,
    );
    const typingAt =
      typingRow && Date.now() - Date.parse(typingRow.at) < 6_000 ? typingRow.at : null;
    // Freshness marker: page contents (id/text/edited/delivery per row) +
    // read + typing, so every field the client consumes participates in the
    // check - including repeat edits of the same row.
    const marker = hashSig(
      JSON.stringify([items.map((m) => [m.id, m.body, m.edited, m.deliveredAt]), readAt, typingAt]),
    );
    const clientMarker = url.searchParams.get("marker");
    if (clientMarker && clientMarker === marker) return json({ marker, unchanged: true });
    return json({
      items,
      readAt: readAt ?? null,
      typingAt,
      marker,
      // The next cursor back. `kp_rowid` stays here, deliberately NOT inside the
      // items: an internal rowid has no business in a message payload (the client
      // has no use for it, and it would advertise insertion order of every row).
      oldest: oldestRow
        ? { at: oldestRow.created_at, rowid: Number(oldestRow.kp_rowid || 0) }
        : null,
      hasMore,
    });
  }

  if (msgMatch && method === "POST") {
    const convId = msgMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    const members = await membersOf(db, convId);
    // The official notification account is one-way (owner rule): nobody can
    // reply into it, in-app or via the API.
    if (conv.kind === "SOLO" && members.some((m) => m.user_id === OFFICIAL_BOT_ID))
      fail(403, "This account doesn't accept replies.", "NO_REPLIES");
    // Block check for the whole member list in ONE statement (either
    // direction), instead of a blockedBetween() round trip per member.
    const others = members.map((m) => m.user_id).filter((mid) => mid !== uid);
    for (const group of chunked(others)) {
      const hit = await one(
        db,
        `SELECT owner_id FROM blocks
          WHERE (owner_id = ? AND target_id IN (${inSql(group.length)}))
             OR (target_id = ? AND owner_id IN (${inSql(group.length)}))
          LIMIT 1`,
        uid,
        ...group,
        uid,
        ...group,
      );
      if (hit) fail(403, "You can't reach this player.", "BLOCKED");
    }
    const text = String(body.body || "")
      .trim()
      .slice(0, MESSAGE_MAX_LENGTH);
    // Whitelisted on purpose: SYSTEM and CALL bubbles are written by the server
    // only. Accepting an arbitrary client kind let anyone forge "Alice paid 500
    // coins" notices and fake call-log entries in someone else's chat.
    const requestedKind = String(body.kind || "TEXT").toUpperCase();
    const kind = ALLOWED_MESSAGE_KINDS.has(requestedKind) ? requestedKind : "TEXT";
    const imageData =
      typeof body.imageData === "string" && isSafeDataUrl(body.imageData) ? body.imageData : null;
    if (typeof body.imageData === "string" && body.imageData.startsWith("data:") && !imageData) {
      fail(400, "Unsupported image format.", "BAD_MEDIA");
    }
    const fileKey =
      typeof body.fileKey === "string" && FILE_KEY_RE.test(body.fileKey) ? body.fileKey : null;
    if (imageData && imageData.length > 450_000)
      fail(400, "Photo too large — pick a smaller image.");
    if (kind === "STICKER" && !text) fail(400, "Pick a sticker.");
    if (kind === "STICKER" && text.length > 16) fail(400, "Bad sticker.");
    if (!text && !imageData && !fileKey) fail(400, "Write a message.");
    const created = nowIso();
    const clientId =
      typeof body.clientId === "string" && body.clientId.trim()
        ? body.clientId.trim().slice(0, 64)
        : null;
    // Idempotent send: a retried POST (timeout after the row already landed,
    // Outbox flush after a kill) used to insert a SECOND row carrying the
    // same clientId — the app keys its list items by clientId, so that
    // duplicate crashed the chat on open ("Key was already used").
    if (clientId) {
      // Exact indexed lookup (client_id column). The earlier meta_json LIKE
      // probe blew up on real conversations — D1 raised "LIKE or GLOB pattern
      // too complex", which turned EVERY send in a busy chat into a 500.
      const dup = await one<MsgRow>(
        db,
        "SELECT * FROM messages WHERE conv_id = ? AND sender_id = ? AND client_id = ? LIMIT 1",
        convId,
        uid,
        clientId,
      );
      if (dup) return json({ message: msgFrom(dup), duplicate: true }, 200);
    }
    const mid = id();
    const incomingMeta = (body.meta as Record<string, unknown> | undefined) ?? {};
    const dims = imageDims(kind, imageData ?? fileKey, incomingMeta);
    const metaObj: Record<string, unknown> = {
      ...(kind === "FILE" && fileKey
        ? {
            name: String(body.fileName || "file").slice(0, 120),
            type: String(body.fileType || "application/octet-stream").slice(0, 100),
            size: Number(body.fileSize || 0),
            voice: incomingMeta.voice === true,
            seconds: Math.max(0, Math.min(600, Number(incomingMeta.seconds || 0))),
          }
        : {}),
      ...(Object.keys(dims).length ? dims : {}),
    };
    if (clientId) metaObj.clientId = clientId;
    const meta = Object.keys(metaObj).length ? JSON.stringify(metaObj) : null;
    try {
      await run(
        db,
        "INSERT INTO messages (id, conv_id, sender_id, kind, body, media, meta_json, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        mid,
        convId,
        uid,
        imageData ? "IMAGE" : fileKey ? "FILE" : kind,
        text,
        imageData ?? fileKey ?? null,
        meta,
        created,
        clientId,
      );
    } catch (err) {
      // Two identical POSTs racing past the dup check: the UNIQUE index lets
      // exactly one win — the loser returns the winner's row (never a 500).
      if (!/UNIQUE/i.test(String(err instanceof Error ? err.message : err))) throw err;
      const winner = await one<MsgRow>(
        db,
        "SELECT * FROM messages WHERE conv_id = ? AND sender_id = ? AND client_id = ? LIMIT 1",
        convId,
        uid,
        clientId ?? "",
      );
      if (winner) return json({ message: msgFrom(winner), duplicate: true }, 200);
      throw err;
    }
    // Bind the uploaded object to this conversation so GET /api/files/:key can
    // authorize every other member. Without this the authz check would reject
    // the recipient, who is not the uploader.
    if (fileKey) {
      await run(
        db,
        "UPDATE files SET conv_id = ? WHERE key = ? AND owner_id = ? AND conv_id IS NULL",
        convId,
        fileKey,
        uid,
      );
    }
    const preview =
      kind === "STICKER"
        ? "Sticker"
        : text ||
          (imageData ? "Photo" : kind === "FILE" ? String(body.fileName || "File") : "Message");
    // A new message has to un-hide the conversation for everyone, but it must
    // not erase the other members' delete watermarks: those are what keep the
    // history they deleted away when the chat reappears. The old statement
    // reset hidden_json to '{}' wholesale, so one member sending a message
    // silently undeleted the chat for everybody. Only the sender's own entry
    // is cleared - they just wrote into it, so it is obviously visible again.
    await run(
      db,
      `UPDATE conversations
         SET last_message = ?, last_message_at = ?, hidden_json = json_remove(hidden_json, ?)
       WHERE id = ?`,
      preview.slice(0, 120),
      created,
      `$."${uid}"`,
      convId,
    );
    // One statement bumps unread for every other member — the per-member
    // UPDATE loop was one D1 round trip per recipient on every send.
    await run(
      db,
      "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id != ?",
      convId,
      uid,
    );
    // The response row is exactly what we just wrote (a fresh insert has no
    // delivered_at), so re-SELECTing it cost one more round trip per send.
    const message = msgFrom({
      id: mid,
      conv_id: convId,
      sender_id: uid,
      kind: imageData ? "IMAGE" : fileKey ? "FILE" : kind,
      body: text,
      media: imageData ?? fileKey ?? null,
      meta_json: meta,
      created_at: created,
      delivered_at: null,
    });
    // Realtime: anyone with this chat open hears about the message the
    // instant it lands; everyone else's chat list gets a light poke. FCM
    // (below) still wakes fully backgrounded apps — WS is the foreground path.
    ctx.waitUntil(
      broadcastRoomEvent(env, convId, { type: "message", conversationId: convId, message }),
    );
    // Push: every other member gets a high-priority message. The chat-list poke
    // doubles as a live-connectivity probe, and its answer decides whether the
    // push is data-only (app connected -> our rich card with actions) or
    // carries a system payload (app not connected -> only the tray can show it).
    for (const memberId of members) {
      if (memberId.user_id === uid) continue;
      ctx.waitUntil(
        (async () => {
          const live = await pokeUserConversation(env, memberId.user_id, convId, created);
          await pushMessageToMember(memberId, live);
        })(),
      );
    }
    // Hoisted below so the poke + the push stay one fire-and-forget unit.
    async function pushMessageToMember(memberId: (typeof members)[number], live: number) {
      // Shape is decided per recipient, by the socket count above, not globally:
      // data-only routes through onMessageReceived -> KpNotify.message() and so
      // carries our rich card (Reply / Like / Mark-as-read); a combined
      // notification+data payload is instead drawn straight into the tray by
      // Google Play services while the app is backgrounded, and onMessageReceived
      // never runs — rich actions would be lost on exactly the device that needs
      // them. So: connected recipient => data-only; disconnected recipient =>
      // recipientAlert() attaches the system payload, because a tray card beats
      // silence. (Before this, the payload was dropped for everyone, which is
      // when "background e message ashe na" started: ac3ffbf had it, 6ab562a
      // removed it, and the idle-only fallback in 8e66af4 almost never fired.)
      // ("from" is a reserved FCM key — hence fromName.)
      // `muted`: the recipient's per-conversation mute. The push still goes
      // out (the badge/list must update) but the client routes it to a
      // silent channel — previously nobody checked the flag, so a muted
      // chat still rang with a full heads-up.
      // `mid`: the message id, so the client's notification card carries a
      // stable, recomputable id. The Reply/Like/Mark-as-read actions cancel
      // THAT exact card; the old random high bits made nm.cancel() miss the
      // card ~127/128 of the time.
      //
      // MUST be awaited (it was a bare `pushToUser(...).then(...)` dangling
      // promise before). The outer ctx.waitUntil() only tracks the promise it
      // is handed — an un-awaited promise created inside an async function is
      // NOT part of it, so the runtime could (and did, in live tests) end the
      // worker's work before the FCM fetch promise settled. Consequences, all
      // invisible from the server side:
      //   - the FCM v1 send was fired but its RESPONSE was often never read,
      //   - fcm_error telemetry never appeared in wrangler tail even when the
      //     send failed (dead/INVALID_ARGUMENT tokens logged nothing),
      //   - UNREGISTERED-token pruning in pushToUser() could be skipped,
      //     leaving dead device rows forever,
      //   - the delivered_at write in the .then() never ran for the push path.
      // From the phone this reads exactly as "background e message push ashe
      // na": FCM accepts and 200s what the worker fires, so nothing looks
      // wrong server-side, but the sends themselves were racing teardown.
      const ok = await pushToUser(
        env,
        db,
        memberId.user_id,
        {
          type: "message",
          convoId: convId,
          mid,
          kind: conv.kind,
          fromName: me.display_name,
          body: preview.slice(0, 120),
          kp_chat: convId,
          muted: memberId.muted === 1 ? "1" : "0",
        },
        recipientAlert(memberId, preview, me.display_name, live),
      );
      if (ok) {
        await run(
          db,
          "UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL",
          nowIso(),
          mid,
        );
      }
    }
    // KuchuPuchu AI answers in its chat (owner feature): the reply generates
    // in the background so the send itself stays instant.
    if (conv.kind === "SOLO" && members.some((m) => m.user_id === AI_BOT_ID))
      ctx.waitUntil(sendAiReply(env, db, ctx, convId, uid));
    return json({ message }, 201);
  }

  const msgDeleteMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  if (msgDeleteMatch && method === "PATCH") {
    // Edit: sender only, text only, within one minute of sending.
    const msg = await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", msgDeleteMatch[1]!);
    if (!msg) fail(404, "Message not found.");
    if (msg.sender_id !== uid) fail(403, "You can only edit your own messages.");
    if (msg.kind !== "TEXT") fail(400, "Only text messages can be edited.");
    if (Date.now() - Date.parse(msg.created_at) > 60_000)
      fail(400, "You can no longer edit this message.");
    const text = String(body.body ?? "").slice(0, MESSAGE_MAX_LENGTH);
    if (!text.trim()) fail(400, "Message can't be empty.");
    const meta = parseJson<Record<string, unknown>>(msg.meta_json, {});
    meta.edited = true;
    await run(
      db,
      "UPDATE messages SET body = ?, meta_json = ? WHERE id = ?",
      text,
      JSON.stringify(meta),
      msg.id,
    );
    const fresh = (await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", msg.id))!;
    // An edit used to rewrite only the message row: the chat list kept showing
    // the pre-edit text forever (its preview is a denormalised column), and the
    // other side's open chat only caught up on its next poll.
    await syncPreviewAfterEdit(db, msg, text);
    ctx.waitUntil(afterMessageChanged(env, db, msg.conv_id, msgFrom(fresh)));
    return json({ message: msgFrom(fresh) });
  }
  if (msgDeleteMatch && method === "DELETE") {
    const row = await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", msgDeleteMatch[1]!);
    if (!row) fail(404, "Message not found.");
    if (row.sender_id !== uid) fail(403, "You can only delete your own messages.");
    await run(
      db,
      "UPDATE messages SET body = NULL, media = NULL, meta_json = NULL, kind = 'DELETED' WHERE id = ?",
      row.id,
    );
    await syncPreviewAfterDelete(db, row);
    // Reuse the frame the client already knows how to paint: a "message" event
    // carrying the full row replaces the bubble by id (see ChatScreen's fast
    // paint), so a deleted message disappears on the other devices without a new
    // event type to teach the app about.
    const afterDelete = await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", row.id);
    if (afterDelete) ctx.waitUntil(afterMessageChanged(env, db, row.conv_id, msgFrom(afterDelete)));
    return json({ ok: true });
  }

  /* ---------- files (R2) ---------- */

  if (path === "/api/files" && method === "POST") {
    if (!env.MEDIA) fail(501, "File storage is not configured yet.");
    rateLimit(`upload:${uid}`, 120, 60);
    // Size is measured from the bytes we actually received. Reading the
    // client-supplied content-length header let an uploader claim 10 bytes and
    // stream 3 MB straight into the bucket.
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) fail(400, "File is empty.");
    if (data.byteLength > 26_214_400) fail(400, "File too large (max 25 MB).");
    const type = safeMediaType(url.searchParams.get("type"));
    const ext =
      (url.searchParams.get("name") || "file")
        .split(".")
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10) || "bin";
    const key = `f/${id()}.${ext}`;
    await env.MEDIA.put(key, data, { httpMetadata: { contentType: type } });
    await run(
      db,
      "INSERT OR REPLACE INTO files (key, owner_id, conv_id, created_at) VALUES (?, ?, NULL, ?)",
      key,
      uid,
      nowIso(),
    );
    return json({ fileKey: key, size: data.byteLength }, 201);
  }

  const fileGetMatch = path.match(/^\/api\/files\/(.+)$/);
  if (fileGetMatch && method === "GET") {
    if (!env.MEDIA) fail(501, "File storage is not configured yet.");
    const key = decodeURIComponent(fileGetMatch[1]!);
    // Authorization: the uploader, or a member of a conversation that actually
    // references this key. Before this any signed-in user who knew (or guessed)
    // a key could download anyone else's file.
    const meta = await one<{ owner_id: string; conv_id: string | null }>(
      db,
      "SELECT owner_id, conv_id FROM files WHERE key = ?",
      key,
    );
    if (meta) {
      const allowed =
        meta.owner_id === uid ||
        (!!meta.conv_id &&
          !!(await one(
            db,
            "SELECT user_id FROM members WHERE conv_id = ? AND user_id = ?",
            meta.conv_id,
            uid,
          )));
      if (!allowed) fail(403, "File not found.", "FORBIDDEN");
    } else {
      // Object uploaded before the files table existed: fall back to "is this
      // key referenced by a message in one of my conversations?".
      const ref = await one<{ conv_id: string }>(
        db,
        `SELECT m.conv_id FROM messages m
         JOIN members mem ON mem.conv_id = m.conv_id AND mem.user_id = ?
         WHERE m.media = ? LIMIT 1`,
        uid,
        key,
      );
      if (!ref) fail(403, "File not found.", "FORBIDDEN");
    }
    const object = await env.MEDIA.get(key);
    if (!object) fail(404, "File not found.");
    const contentType = safeMediaType(object.httpMetadata?.contentType);
    return new Response(object.body, {
      headers: mediaHeaders(contentType, `attachment; filename="${key.split("/").pop()}"`),
    });
  }

  /* ---------- statuses (24h stories) ---------- */

  if (path === "/api/statuses" && method === "POST") {
    // VIDEO used to be folded into TEXT here, so a video status was stored as a
    // text post with an orphaned blob attached and the client's video player was
    // unreachable dead code.
    const requested = String(body.kind || "TEXT").toUpperCase();
    const kind = ALLOWED_STATUS_KINDS.has(requested) ? requested : "TEXT";
    const text = String(body.text || "").slice(0, 500);
    const bgStyle = String(body.bgStyle || "amber").slice(0, 20);
    const imageData =
      typeof body.imageData === "string" && isSafeDataUrl(body.imageData) ? body.imageData : null;
    if (typeof body.imageData === "string" && body.imageData.startsWith("data:") && !imageData) {
      fail(400, "Unsupported media format.", "BAD_MEDIA");
    }
    const fileKey =
      typeof body.fileKey === "string" && FILE_KEY_RE.test(body.fileKey) ? body.fileKey : null;
    if (imageData && imageData.length > 450_000)
      fail(400, "Photo too large — pick a smaller image.");
    if ((kind === "IMAGE" || kind === "VIDEO") && !imageData && !fileKey) {
      fail(400, kind === "VIDEO" ? "Pick a video for the status." : "Pick a photo for the status.");
    }
    if (kind === "TEXT" && !text) fail(400, "Write something for the status.");
    const seconds = kind === "VIDEO" ? Math.max(0, Math.min(120, Number(body.seconds || 0))) : 0;
    const sid = id();
    const created = nowIso();
    const expiresAt = new Date(Date.now() + 864e5).toISOString();
    await run(
      db,
      "INSERT INTO statuses (id, user_id, kind, text, bg_style, media, meta_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      sid,
      uid,
      kind,
      text || null,
      bgStyle,
      imageData ?? fileKey ?? null,
      seconds ? JSON.stringify({ seconds, fileKey: !!fileKey }) : null,
      created,
      expiresAt,
    );
    if (fileKey) {
      // Statuses are visible to contacts, not to one conversation; mark the
      // object as owned so its author can always re-read it.
      await run(db, "UPDATE files SET conv_id = NULL WHERE key = ? AND owner_id = ?", fileKey, uid);
    }
    return json(
      {
        status: {
          id: sid,
          kind,
          text,
          bgStyle,
          hasMedia: !!(imageData ?? fileKey),
          seconds,
          createdAt: created,
          expiresAt,
        },
      },
      201,
    );
  }

  if (path === "/api/statuses" && method === "GET") {
    // Expired rows are filtered below and reaped at most once a minute per
    // isolate. This used to be an unconditional DELETE on every single read, so
    // one client's poll wrote to the whole statuses table for everybody.
    if (Date.now() > nextStatusSweep) {
      nextStatusSweep = Date.now() + 60_000;
      ctx.waitUntil(
        run(db, "DELETE FROM statuses WHERE expires_at < ?", nowIso()).then(() => undefined),
      );
    }
    // ONE statement per concern, for every contact at once.
    //
    // This handler used to run `membersOf()` for every conversation the caller is
    // in, then three more statements (statuses, user, status_views) for every
    // contact. At 75 conversations / 162 users that is several HUNDRED D1
    // statements per status poll — and the status bar polls. That is what
    // exhausted the account's free-tier daily row-read limit on 2026-09-01 and
    // made every endpoint answer "Something went wrong." for the last hour of the
    // UTC day; the queries were never slow, they were just enormous in number.
    // The response shape is byte-for-byte what it was, so no client changes.
    const now = nowIso();
    const out: Array<Record<string, unknown>> = [];
    const mine = await all<StatusRow>(
      db,
      "SELECT * FROM statuses WHERE user_id = ? ORDER BY created_at ASC",
      uid,
    );
    const others = await all<StatusRow>(
      db,
      `SELECT s.* FROM statuses s
        WHERE s.expires_at > ?
          AND s.user_id IN (
            SELECT m2.user_id FROM members m1
              JOIN members m2 ON m2.conv_id = m1.conv_id
             WHERE m1.user_id = ? AND m2.user_id <> ?
          )
        ORDER BY s.user_id, s.created_at ASC`,
      now,
      uid,
      uid,
    );
    // Every view row for every live status, in one go. The primary key is
    // (status_id, viewer_id), so the per-contact `WHERE viewer_id = ?` scan that
    // used to repeat for each contact is gone.
    const views = await all<{ status_id: string; viewer_id: string }>(
      db,
      `SELECT status_id, viewer_id FROM status_views
        WHERE status_id IN (SELECT id FROM statuses WHERE expires_at > ? OR user_id = ?)`,
      now,
      uid,
    );
    const viewersByStatus = new Map<string, number>();
    const iViewed = new Set<string>();
    for (const view of views) {
      if (view.viewer_id === uid) iViewed.add(view.status_id);
      viewersByStatus.set(view.status_id, (viewersByStatus.get(view.status_id) ?? 0) + 1);
    }
    const shape = (row: StatusRow) => ({
      id: row.id,
      kind: row.kind,
      text: row.text,
      bgStyle: row.bg_style,
      hasMedia: !!row.media,
      seconds: parseJson<{ seconds?: number }>(row.meta_json, {}).seconds ?? 0,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
    if (mine.length) {
      out.push({
        user: userFrom(me, true),
        mine: true,
        statuses: mine.map((row) => ({ ...shape(row), viewers: viewersByStatus.get(row.id) ?? 0 })),
      });
    }
    const byContact = new Map<string, StatusRow[]>();
    for (const row of others) {
      const list = byContact.get(row.user_id) ?? [];
      list.push(row);
      byContact.set(row.user_id, list);
    }
    const users = await usersById(db, [...byContact.keys()]);
    for (const [contactId, rows] of byContact) {
      const userRow = users.get(contactId);
      if (!userRow) continue;
      out.push({
        user: userFrom(userRow, onlineNow(userRow)),
        mine: false,
        allViewed: rows.every((r) => iViewed.has(r.id)),
        statuses: rows.map(shape),
      });
    }
    return json({ items: out });
  }

  const statusViewMatch = path.match(/^\/api\/statuses\/([^/]+)\/view$/);
  if (statusViewMatch && method === "POST") {
    const sid = statusViewMatch[1]!;
    const row = await one<{ user_id: string }>(
      db,
      "SELECT user_id FROM statuses WHERE id = ?",
      sid,
    );
    if (row && row.user_id !== uid) {
      await run(
        db,
        "INSERT OR IGNORE INTO status_views (status_id, viewer_id, viewed_at) VALUES (?, ?, ?)",
        sid,
        uid,
        nowIso(),
      );
    }
    return json({ ok: true });
  }

  const statusViewsMatch = path.match(/^\/api\/statuses\/([^/]+)\/viewers$/);
  if (statusViewsMatch && method === "GET") {
    const sid = statusViewsMatch[1]!;
    const row = await one<{ user_id: string }>(
      db,
      "SELECT user_id FROM statuses WHERE id = ?",
      sid,
    );
    if (!row) fail(404, "Status not found.");
    if (row.user_id !== uid) fail(403, "Not your status.");
    const views = await all<{ viewer_id: string; viewed_at: string }>(
      db,
      "SELECT viewer_id, viewed_at FROM status_views WHERE status_id = ? ORDER BY viewed_at DESC",
      sid,
    );
    const list = [];
    for (const view of views) {
      const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", view.viewer_id);
      if (user) list.push({ user: userFrom(user, onlineNow(user)), viewedAt: view.viewed_at });
    }
    return json({ viewers: list });
  }

  const statusMediaMatch = path.match(/^\/api\/statuses\/([^/]+)\/media$/);
  if (statusMediaMatch && method === "GET") {
    const row = await one<StatusRow>(
      db,
      "SELECT * FROM statuses WHERE id = ?",
      statusMediaMatch[1]!,
    );
    if (!row || !row.media) fail(404, "Media not found.");
    const isContact = !!(await one(
      db,
      `SELECT m1.conv_id FROM members m1 JOIN members m2 ON m1.conv_id = m2.conv_id
       WHERE m1.user_id = ? AND m2.user_id = ?`,
      uid,
      row.user_id,
    ));
    if (row.user_id !== uid && !isContact) fail(403, "Not allowed.");
    return storedMediaResponse(env, row.media, row.kind === "VIDEO" ? "video/mp4" : "image/jpeg");
  }

  const msgMediaMatch = path.match(/^\/api\/messages\/([^/]+)\/media$/);
  if (msgMediaMatch && method === "GET") {
    const row = await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", msgMediaMatch[1]!);
    if (!row || !row.media) fail(404, "Media not found.");
    await requireMember(db, row.conv_id, uid);
    return storedMediaResponse(env, row.media, row.kind === "VIDEO" ? "video/mp4" : "image/jpeg");
  }

  const statusMatch = path.match(/^\/api\/statuses\/([^/]+)$/);
  if (statusMatch && method === "DELETE") {
    await run(db, "DELETE FROM statuses WHERE id = ? AND user_id = ?", statusMatch[1]!, uid);
    return json({ ok: true });
  }

  /* ---------- calls ---------- */

  if (path === "/api/calls" && method === "POST") {
    const other = String(body.userId || "");
    const kind = body.kind === "VIDEO" ? "VIDEO" : "AUDIO";
    if (!other || other === uid) fail(400, "Bad user.");
    if (!(await one<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", other)))
      fail(404, "User not found.");
    // System accounts are not callable (owner rule — the app hides the
    // buttons; the API refuses on principle).
    if (other === OFFICIAL_BOT_ID || other === AI_BOT_ID)
      fail(403, "This account can't be called.", "BOT_ACCOUNT");
    if (await blockedBetween(db, uid, other)) fail(403, "You can't call this user.", "BLOCKED");
    const convId = pairId(uid, other);
    if (!(await one(db, "SELECT id FROM conversations WHERE id = ?", convId))) {
      const createdConv = nowIso();
      await run(
        db,
        "INSERT INTO conversations (id, kind, created_at, hidden_json) VALUES (?, 'SOLO', ?, '{}')",
        convId,
        createdConv,
      );
      await run(
        db,
        "INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
        convId,
        uid,
        createdConv,
      );
      await run(
        db,
        "INSERT INTO members (conv_id, user_id, joined_at) VALUES (?, ?, ?)",
        convId,
        other,
        createdConv,
      );
    }
    const callId = id();
    const created = nowIso();
    await run(
      db,
      "INSERT INTO calls (id, conv_id, caller_id, callee_id, kind, status, offer_sdp, created_at) VALUES (?, ?, ?, ?, ?, 'RINGING', ?, ?)",
      callId,
      pairId(uid, other),
      uid,
      other,
      kind,
      String(body.offerSdp ?? "") || null,
      created,
    );
    // Delay ~1.8s, then only push while STILL RINGING: cutting a call
    // before it ever rang used to let the in-flight push ring the other
    // phone anyway ("call cut korleo call chole gelo").
    ctx.waitUntil(
      (async () => {
        await new Promise((r) => setTimeout(r, 1_800));
        const fresh = await one<{ status: string }>(
          db,
          "SELECT status FROM calls WHERE id = ?",
          callId,
        );
        if (!fresh || fresh.status !== "RINGING") return;
        // Instant foreground path: the callee's always-on user channel rings
        // them the same moment FCM fires, under the SAME still-RINGING gate.
        await broadcastRoomEvent(env, `user:${other}`, {
          type: "call",
          callId,
          kind,
          fromId: uid,
          fromName: me.display_name,
        });
        // Delivery rule (same as messages / missed calls):
        //   - NO live socket (swiped-away / killed / frozen) => system
        //     notification payload, so an incoming call is never silent on
        //     MIUI & similar where a high-priority data-only message is not
        //     delivered once the process is gone. Tapping the card launches
        //     MainActivity (kp_call extra) straight to the ringing screen.
        //   - Live socket (process alive) => DATA-ONLY. The engine's poll
        //     already raises its OWN full-screen ring (CallNotify.incoming +
        //     fullScreenIntent + Accept/Decline) — a payload here would only
        //     duplicate it and could outlive a cancellation on a live process.
        const live = await pokeUserConversation(env, other, pairId(uid, other), nowIso());
        await pushToUser(
          env,
          db,
          other,
          {
            type: "call",
            callId,
            kind,
            fromName: me.display_name,
            fromId: uid,
            // delivered as a launch-intent extra when the system notification
            // is tapped -> MainActivity jumps straight to the ringing screen
            kp_call: callId,
          },
          live <= 0
            ? {
                title: `${me.display_name} is calling`,
                body: kind === "VIDEO" ? "Incoming video call" : "Incoming voice call",
                channel: "kp_calls_v5",
              }
            : undefined,
        );
      })(),
    );
    // Realtime: the caller's own devices flip to the ringing screen without
    // waiting for a poll. The CALLEE is not pinged here — their instant path
    // is the delayed, still-RINGING-checked relay inside the waitUntil block
    // below, which carries the same anti-phantom gate as the FCM push.
    ctx.waitUntil(
      broadcastCallEvent(env, callId, {
        type: "call",
        callId,
        status: "RINGING",
        kind,
        callerId: uid,
        calleeId: other,
      }),
    );
    const otherUser = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", other);
    return json(
      {
        call: {
          id: callId,
          kind,
          status: "RINGING",
          callerId: uid,
          calleeId: other,
          offerSdp: body.offerSdp ?? null,
          incoming: false,
          other: otherUser ? userFrom(otherUser, onlineNow(otherUser)) : null,
        },
      },
      201,
    );
  }

  if (path === "/api/calls/active" && method === "GET") {
    // Reap stale RINGING calls + fire their missed-call pushes. Also runs as a
    // one-minute cron (see the `scheduled` handler) so the transition happens
    // even when BOTH phones are backgrounded and nobody polls — the stuck
    // "X is calling" card bug.
    await reapStaleCalls(env, db, ctx);
    const rows = await all<CallRow>(
      db,
      "SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status IN ('RINGING', 'ACTIVE') ORDER BY created_at DESC",
      uid,
      uid,
    );
    const othersById = await usersById(
      db,
      rows.map((row) => (row.caller_id === uid ? row.callee_id : row.caller_id)),
    );
    const items = [];
    for (const row of rows) {
      // Anti-phantom grace: a RINGING call younger than 1.6s is invisible to
      // the CALLEE. The push carries the same gate, so a call cancelled
      // before it ever rang cannot ring the other phone from EITHER path
      // (FCM payload or the callee's own /active poll).
      if (
        row.status === "RINGING" &&
        row.callee_id === uid &&
        Date.now() - Date.parse(row.created_at) < 1_600
      ) {
        continue;
      }
      const otherId = row.caller_id === uid ? row.callee_id : row.caller_id;
      items.push(callFrom(row, uid, othersById.get(otherId) ?? null));
    }
    return json({ items });
  }

  if (path === "/api/calls/history" && method === "GET") {
    const rows = await all<CallRow>(
      db,
      "SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status IN ('ENDED', 'DECLINED', 'MISSED') ORDER BY created_at DESC LIMIT 100",
      uid,
      uid,
    );
    // One batched usersById() instead of a per-row SELECT — the Calls tab was
    // 2+N round trips, so a 100-call history read as ~8s from South Asia.
    const others = await usersById(
      db,
      rows.map((row) => (row.caller_id === uid ? row.callee_id : row.caller_id)),
    );
    const items = rows.map((row) =>
      callHistoryFrom(
        row,
        uid,
        others.get(row.caller_id === uid ? row.callee_id : row.caller_id) ?? null,
      ),
    );
    return json({ items });
  }

  const answerMatch = path.match(/^\/api\/calls\/([^/]+)\/answer$/);
  if (answerMatch && method === "POST") {
    const callId = answerMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    if (row.callee_id !== uid) fail(403, "Not your call to answer.");
    if (row.status !== "RINGING")
      return json({ call: callFrom(row, uid, await otherUser(db, row, uid)) });
    await run(
      db,
      "UPDATE calls SET status = 'ACTIVE', answer_sdp = ?, started_at = ? WHERE id = ?",
      String(body.answerSdp ?? "") || null,
      nowIso(),
      callId,
    );
    const fresh = (await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId))!;
    // Tell the CALLER instantly that the call was picked up — without this the
    // caller's phone sat on "Ringing…" for the whole poll interval, reading as
    // a stuck call even though the callee had answered.
    ctx.waitUntil(
      pushToUser(env, db, row.caller_id, {
        type: "call_answer",
        callId,
        kind: row.kind,
      }),
    );
    // Realtime: both live sockets hear ANSWERED the instant the row flips.
    ctx.waitUntil(broadcastCallEvent(env, callId, { type: "call", callId, status: "ACTIVE" }));
    return json({ call: callFrom(fresh, uid, await otherUser(db, fresh, uid)) });
  }

  const declineMatch = path.match(/^\/api\/calls\/([^/]+)\/decline$/);
  if (declineMatch && method === "POST") {
    const callId = declineMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    if (row.status === "RINGING" && row.callee_id === uid) {
      await run(
        db,
        "UPDATE calls SET status = 'DECLINED', ended_at = ? WHERE id = ?",
        nowIso(),
        callId,
      );
      await logCallEvent(db, row.caller_id, row.callee_id, row.kind, "DECLINED");
      ctx.waitUntil(broadcastCallEvent(env, callId, { type: "call", callId, status: "DECLINED" }));
    }
    return json({ ok: true });
  }

  const endMatch = path.match(/^\/api\/calls\/([^/]+)\/end$/);
  if (endMatch && method === "POST") {
    const callId = endMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    // Only the two people on the call may end it. /ice and /decline already had
    // this check; /end did not, so any signed-in user could hang up on anyone.
    if (row.caller_id !== uid && row.callee_id !== uid) fail(403, "Not your call.", "FORBIDDEN");
    if (row.status === "ACTIVE" || row.status === "RINGING") {
      const seconds = Math.max(
        0,
        Math.round(
          ((row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at)) -
            Date.now()) /
            -1000,
        ),
      );
      // Guarded on the current status so two clients ending at once cannot both
      // write an "ENDED" call-log bubble.
      const changed = await run(
        db,
        "UPDATE calls SET status = 'ENDED', ended_at = ? WHERE id = ? AND status IN ('ACTIVE','RINGING')",
        nowIso(),
        callId,
      );
      if (changed > 0) {
        ctx.waitUntil(broadcastCallEvent(env, callId, { type: "call", callId, status: "ENDED" }));
      }
      if (changed > 0 && row.started_at) {
        await logCallEvent(db, row.caller_id, row.callee_id, row.kind, "ENDED", seconds);
      }
    }
    return json({ ok: true });
  }

  const iceMatch = path.match(/^\/api\/calls\/([^/]+)\/ice$/);
  if (iceMatch) {
    const callId = iceMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    if (row.caller_id !== uid && row.callee_id !== uid) fail(403, "Not your call.");
    if (method === "POST") {
      // The app sends { candidate: { candidate, sdpMid, sdpMLineIndex } } —
      // store the whole object so nothing is lost (stringifying an object
      // here used to save "[object Object]" and break every call).
      const raw = (body.candidate ?? {}) as Record<string, unknown>;
      const candidate =
        typeof body.candidate === "string" ? body.candidate : String(raw.candidate ?? "");
      if (!candidate || candidate === "[object Object]") fail(400, "Missing candidate.");
      const payload =
        typeof body.candidate === "string"
          ? JSON.stringify({ candidate: body.candidate })
          : JSON.stringify({
              candidate,
              sdpMid: raw.sdpMid ?? null,
              sdpMLineIndex: raw.sdpMLineIndex ?? 0,
            });
      const iceAt = nowIso();
      await run(
        db,
        "INSERT INTO call_ice (call_id, sender_id, candidate_json, created_at) VALUES (?, ?, ?, ?)",
        callId,
        uid,
        payload.slice(0, 4000),
        iceAt,
      );
      // Realtime: the peer applies this candidate immediately instead of on
      // its next ICE poll. Payload shape == one GET /ice item.
      ctx.waitUntil(
        broadcastCallEvent(env, callId, {
          type: "ice",
          callId,
          candidate: parseJson<Record<string, unknown>>(payload, {}),
          createdAt: iceAt,
        }),
      );
      return json({ ok: true }, 201);
    }
    if (method === "GET") {
      const since = url.searchParams.get("since") || "";
      const rows = since
        ? await all<{
            rowid: number;
            sender_id: string;
            candidate_json: string;
            created_at: string;
          }>(
            db,
            "SELECT rowid AS rowid, sender_id, candidate_json, created_at FROM call_ice WHERE call_id = ? AND sender_id != ? AND created_at > ? ORDER BY created_at ASC, rowid ASC",
            callId,
            uid,
            since,
          )
        : await all<{
            rowid: number;
            sender_id: string;
            candidate_json: string;
            created_at: string;
          }>(
            db,
            "SELECT rowid AS rowid, sender_id, candidate_json, created_at FROM call_ice WHERE call_id = ? AND sender_id != ? ORDER BY created_at ASC, rowid ASC",
            callId,
            uid,
          );
      const items = rows.map((r) => ({
        id: `${r.created_at}:${r.rowid}`,
        candidate: parseJson<Record<string, unknown>>(r.candidate_json, {}),
        createdAt: r.created_at,
      }));
      return json({ items, now: nowIso() });
    }
  }

  // Mid-call renegotiation (screen share / camera on a voice call):
  // one side posts a fresh offer, the other answers. Data-only pushes
  // nudge both live clients to poll immediately.
  const reofferMatch = path.match(/^\/api\/calls\/([^/]+)\/reoffer$/);
  if (reofferMatch && method === "POST") {
    const callId = reofferMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    if (row.caller_id !== uid && row.callee_id !== uid) fail(403, "Not your call.", "FORBIDDEN");
    const sdp = String(body.sdp ?? "");
    if (!sdp) fail(400, "Missing sdp.");
    await run(
      db,
      "UPDATE calls SET reoffer_sdp = ?, reoffer_from = ?, reanswer_sdp = NULL WHERE id = ?",
      sdp.slice(0, 60_000),
      uid,
      callId,
    );
    const other = row.caller_id === uid ? row.callee_id : row.caller_id;
    ctx.waitUntil(pushToUser(env, db, other, { type: "reoffer", callId }));
    ctx.waitUntil(broadcastCallEvent(env, callId, { type: "reoffer", callId }));
    return json({ ok: true }, 201);
  }

  const reanswerMatch = path.match(/^\/api\/calls\/([^/]+)\/reanswer$/);
  if (reanswerMatch && method === "POST") {
    const callId = reanswerMatch[1]!;
    const row = await one<CallRow>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    if (row.caller_id !== uid && row.callee_id !== uid) fail(403, "Not your call.", "FORBIDDEN");
    const sdp = String(body.sdp ?? "");
    if (!sdp) fail(400, "Missing sdp.");
    await run(db, "UPDATE calls SET reanswer_sdp = ? WHERE id = ?", sdp.slice(0, 60_000), callId);
    const other = row.caller_id === uid ? row.callee_id : row.caller_id;
    ctx.waitUntil(pushToUser(env, db, other, { type: "reanswer", callId }));
    ctx.waitUntil(broadcastCallEvent(env, callId, { type: "reanswer", callId }));
    return json({ ok: true }, 201);
  }

  /* ---------- search ---------- */

  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    if (q.length < 2) return json({ users: [], messages: [], chats: [] });
    const userRows = await all<UserRow>(
      db,
      `SELECT * FROM users WHERE (${instrLike("username")} OR ${instrLike("display_name")}) AND id != ? LIMIT 10`,
      instrTerm(q),
      instrTerm(q),
      uid,
    );
    const users = [];
    for (const row of userRows) {
      if (!(await blockedBetween(db, uid, row.id))) users.push(userFrom(row, onlineNow(row)));
    }
    const msgRows = await all<MsgRow & { title: string | null; kind_c: string }>(
      db,
      `SELECT m.*, c.title FROM messages m
       JOIN members mem ON mem.conv_id = m.conv_id AND mem.user_id = ?
       JOIN conversations c ON c.id = m.conv_id
       WHERE m.kind IN ('TEXT','IMAGE','FILE') AND LOWER(m.body) LIKE ?${ESCAPED_LIKE}
       ORDER BY m.created_at DESC, m.rowid DESC LIMIT 20`,
      uid,
      likeTerm(q),
    );
    // Batched conversation/members/users lookups (the list route's pattern)
    // instead of conversationDetail() — 3 queries — per matched chat.
    const convIdList = [...new Set(msgRows.map((row) => row.conv_id))];
    const convs = new Map<string, ConvRow>();
    const membersByConv = new Map<string, ConvMemberRow[]>();
    const userIds: string[] = [];
    for (const group of chunked(convIdList)) {
      for (const c of await all<ConvRow>(
        db,
        `SELECT ${CONV_COLS} FROM conversations WHERE id IN (${inSql(group.length)})`,
        ...group,
      ))
        convs.set(c.id, c);
      for (const m of await all<ConvMemberRow>(
        db,
        `SELECT ${MEMBER_COLS} FROM members WHERE conv_id IN (${inSql(group.length)})`,
        ...group,
      )) {
        const bucket = membersByConv.get(m.conv_id!);
        if (bucket) bucket.push(m);
        else membersByConv.set(m.conv_id!, [m]);
        userIds.push(m.user_id);
      }
    }
    const chatUsers = await usersById(db, userIds);
    const chats = convIdList
      .filter((id) => convs.has(id))
      .map((id) => buildConvDetail(convs.get(id)!, membersByConv.get(id) ?? [], chatUsers, uid));
    return json({
      users,
      chats,
      messages: msgRows.map((row) => ({
        ...msgFrom(row),
        convoId: row.conv_id,
        convTitle: row.title,
      })),
    });
  }

  fail(404, "Not found.");
}

/* ---------------- row mappers ---------------- */

type MsgRow = {
  id: string;
  conv_id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  media: string | null;
  meta_json: string | null;
  created_at: string;
  delivered_at?: string | null;
};

/**
 * Pixel size of an uploaded image, as told by the sender.
 *
 * Why it exists: the chat bubble must be laid out at the photo's real aspect
 * ratio on its FIRST frame. Without it the bubble starts at the generic
 * placeholder size and snaps when the pixels arrive — and that resize cascades
 * layout through the whole LazyColumn exactly while the user is doing their first
 * scroll after a cold start (the "first scroll lags, the second one is smooth"
 * report). The ratio is 8 bytes of metadata that removes a re-layout storm.
 *
 * It is display metadata from an untrusted client, so both numbers are clamped
 * and the pair is dropped unless it is usable — a bad value must never be able to
 * blow up a layout.
 */
function imageDims(
  kind: string,
  hasMedia: unknown,
  meta: Record<string, unknown>,
): { w: number; h: number } | Record<string, never> {
  if (kind !== "IMAGE" && kind !== "FILE") return {};
  if (!hasMedia) return {};
  const w = Math.floor(Number(meta.w));
  const h = Math.floor(Number(meta.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 20000 || h > 20000)
    return {};
  return { w, h };
}

function msgFrom(row: MsgRow) {
  const meta = parseJson<{
    name?: string;
    type?: string;
    size?: number;
    clientId?: string;
    voice?: boolean;
    seconds?: number;
    edited?: boolean;
    w?: number;
    h?: number;
  }>(row.meta_json, {});
  const imageFile = row.kind === "FILE" && String(meta.type || "").startsWith("image/");
  return {
    id: row.id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    hasImage: (row.kind === "IMAGE" && !!row.media) || imageFile,
    mediaUrl: row.kind === "IMAGE" && row.media ? `/api/messages/${row.id}/media` : undefined,
    // Set only when the sender supplied usable dimensions (see imageDims). The
    // client seeds its ratio cache from these, so even the very first view of a
    // photo on a brand-new device reserves the right box.
    mediaW: meta.w,
    mediaH: meta.h,
    fileKey: row.kind === "FILE" ? row.media : undefined,
    fileName: meta.name,
    fileType: meta.type,
    fileSize: meta.size,
    meta: Object.keys(meta).length ? meta : undefined,
    clientId: meta.clientId,
    deliveredAt: row.delivered_at ? row.delivered_at : undefined,
    createdAt: row.created_at,
    edited: !!meta.edited,
  };
}

type StatusRow = {
  id: string;
  user_id: string;
  kind: string;
  text: string | null;
  bg_style: string | null;
  media: string | null;
  meta_json: string | null;
  created_at: string;
  expires_at: string;
};

type CallRow = {
  id: string;
  conv_id: string | null;
  caller_id: string;
  callee_id: string;
  kind: string;
  status: string;
  offer_sdp: string | null;
  answer_sdp: string | null;
  started_at: string | null;
  reoffer_sdp?: string | null;
  reoffer_from?: string | null;
  reanswer_sdp?: string | null;
  ended_at: string | null;
  created_at: string;
};

function callFrom(row: CallRow, uid: string, other: UserRow | null, light = false) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    incoming: row.callee_id === uid,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    offerSdp: row.offer_sdp,
    answerSdp: row.answer_sdp,
    reofferSdp: row.reoffer_sdp ?? undefined,
    reofferFrom: row.reoffer_from ?? undefined,
    reanswerSdp: row.reanswer_sdp ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    other: other ? userFrom(other, onlineNow(other), light) : null,
  };
}

// History rows are display-only. SDP belongs to the live signalling routes;
// returning four large SDP documents for each of up to 100 rows made this
// endpoint ~19x larger and dominated Calls-tab startup on mobile networks.
// `other` is also LIGHT (avatarUrl:null + avatarRef, no 200KB data-URI per
// row), so a 100-call history is a tiny payload and the client renders each
// avatar from its persistent per-version cache instead of re-transferring and
// re-parsing hundreds of KB (the "call history laggy / avatar reloads on
// scroll" bug). Live /api/calls/active + start-call responses keep the full
// shape (light=false).
function callHistoryFrom(row: CallRow, uid: string, other: UserRow | null) {
  const { offerSdp, answerSdp, reofferSdp, reofferFrom, reanswerSdp, ...history } = callFrom(
    row,
    uid,
    other,
    true,
  );
  return history;
}

async function hiddenJson(db: D1Database, convId: string) {
  const row = await one<{ hidden_json: string }>(
    db,
    "SELECT hidden_json FROM conversations WHERE id = ?",
    convId,
  );
  return row?.hidden_json ?? "{}";
}

type ConvRow = {
  id: string;
  kind: string;
  title: string | null;
  owner_id: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message: string | null;
  disappear_seconds: number | null;
  theme: string | null;
  hidden_json?: string | null;
  /** Newest messages rowid in the conversation; only the list query selects it. */
  max_row?: number | null;
};

/**
 * Where a member's "delete chat" cut off.
 *
 * Older rows stored a bare epoch-ms number, and comparing message timestamps
 * against it lost messages: `created_at` is only millisecond-resolution, so a
 * message written in the same millisecond as the delete fell on the wrong side
 * of `created_at > watermark` and disappeared. `row` is the messages rowid the
 * chat was deleted at, which is strictly monotonic, so `rowid > row` has no
 * boundary to get wrong. Legacy numeric watermarks are still honoured by
 * timestamp, since they cannot be converted.
 */
type Watermark = { row: number; at: string };
type HiddenMap = Record<string, Watermark | number>;

/** The watermark for one member, or null when the chat was never deleted. */
/**
 * Cheap change-marker for polling: clients send back the last marker they
 * saw and get `unchanged: true` instead of the full payload when nothing
 * moved. Computed from data the handler already has in memory.
 */
function hashSig(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // The 32-bit digest alone was a real (if rare) way to make a poll answer
  // `unchanged: true` after a genuine edit: two different payloads could hash
  // identically. Length is free to include and cannot collide with a different
  // payload of a different size, which covers the realistic case.
  return `${(h >>> 0).toString(36)}.${input.length.toString(36)}`;
}

function watermarkFor(hidden: HiddenMap, uid: string): Watermark | null {
  const raw = hidden[uid];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw > 0 ? { row: -1, at: new Date(raw).toISOString() } : null;
  return typeof raw.row === "number" ? raw : null;
}

type ConvMemberRow = {
  conv_id?: string;
  user_id: string;
  role: string;
  muted: number;
  unread: number;
  last_read_at: string | null;
};

const CONV_COLS =
  "id, kind, title, owner_id, created_at, last_message_at, last_message, disappear_seconds, theme, hidden_json";
const MEMBER_COLS = "conv_id, user_id, role, muted, unread, last_read_at";

/** Placeholder list for an IN(...) clause. */
const inSql = (n: number) => Array.from({ length: n }, () => "?").join(",");

/**
 * Keeps an IN(...) clause inside D1's bound-parameter limit.
 *
 * D1 enforces a hard cap of 100 bound parameters per statement (SQLite's
 * default is 999, but D1 lowered it). Two-sided block-check queries use
 * 2 + 2n binds, so n=44 is the safe ceiling (2 + 2*44 = 90, leaving
 * 10 slots of headroom). One-sided IN queries can use up to ~90.
 *
 * The old default of 200 meant a group with 51+ members or a user with
 * 101+ conversations hit `7500 too many SQL variables` on every hot
 * route — and CI never caught it because the test harness uses
 * better-sqlite3 (limit 999).
 */
function chunked<T>(items: T[], size = 44): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every user referenced by a set of member rows, in one pass. */
/** Only the newest row owns the chat-list preview, so a guarded rewrite here
 *  can never clobber a message that arrived after the one being edited. */
async function syncPreviewAfterEdit(db: D1Database, msg: MsgRow, body: string) {
  const conv = await one<{ last_message_at: string | null }>(
    db,
    "SELECT last_message_at FROM conversations WHERE id = ?",
    msg.conv_id,
  );
  if (!conv || conv.last_message_at !== msg.created_at) return;
  await run(
    db,
    "UPDATE conversations SET last_message = ? WHERE id = ?",
    // The NEW text — the caller still holds the pre-edit row, so reading
    // `msg.body` here would rewrite the preview with exactly what was there.
    body.slice(0, 120),
    msg.conv_id,
  );
}

async function syncPreviewAfterDelete(db: D1Database, row: MsgRow) {
  const conv = await one<{ last_message_at: string | null }>(
    db,
    "SELECT last_message_at FROM conversations WHERE id = ?",
    row.conv_id,
  );
  if (!conv || conv.last_message_at !== row.created_at) return;
  await run(
    db,
    "UPDATE conversations SET last_message = ? WHERE id = ?",
    "Message deleted",
    row.conv_id,
  );
}

/** Edit/delete fan-out: the room for the open chat, `user:<id>` for everyone's
 *  chat LIST (a client on the list screen is not joined to any chat room, so a
 *  room broadcast alone leaves the stale preview until the next foreground). */
async function afterMessageChanged(env: Env, db: D1Database, convId: string, message: unknown) {
  await broadcastRoomEvent(env, convId, { type: "message", conversationId: convId, message });
  try {
    for (const m of await membersOf(db, convId)) {
      const id = (m as { user_id: string }).user_id;
      if (id !== String((message as { senderId?: string })?.senderId ?? "")) {
        await broadcastRoomEvent(env, `user:${id}`, { type: "conv", conversationId: convId });
      }
    }
  } catch {
    // list poke is best-effort: the poll path still catches up
  }
}

async function usersById(db: D1Database, userIds: string[]) {
  const map = new Map<string, UserRow>();
  for (const group of chunked([...new Set(userIds.filter(Boolean))])) {
    for (const u of await all<UserRow>(
      db,
      `SELECT * FROM users WHERE id IN (${inSql(group.length)})`,
      ...group,
    )) {
      map.set(u.id, u);
    }
  }
  return map;
}

function buildConvDetail(
  conv: ConvRow,
  memberRows: ConvMemberRow[],
  users: Map<string, UserRow>,
  uid: string,
  // The chat LIST is the hottest endpoint in the app (polled every 2s with
  // the socket down) — there avatars go as a tiny avatarRef and the client
  // fetches each data-URI once per version from /api/users/:id/avatar.
  // Opening a conversation is a one-off call, so it keeps the full shape.
  light = false,
) {
  const members = [];
  let other = null;
  let meMuted = false;
  let unread = 0;
  for (const row of memberRows) {
    const user = users.get(row.user_id);
    if (!user) continue;
    members.push({
      user: userFrom(user, onlineNow(user), light),
      role: row.role,
      lastReadAt: row.last_read_at,
    });
    if (row.user_id !== uid && conv.kind === "SOLO") other = userFrom(user, onlineNow(user), light);
    if (row.user_id === uid) {
      meMuted = row.muted === 1;
      unread = row.unread;
    }
  }
  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.title,
    ownerId: conv.owner_id,
    createdAt: conv.created_at,
    lastMessageAt: conv.last_message_at,
    lastMessage: conv.last_message,
    other,
    members,
    muted: meMuted,
    unread,
    isGroup: conv.kind === "GROUP",
    disappearSeconds: Number(conv.disappear_seconds || 0),
    theme: conv.theme || "default",
  };
}

async function conversationDetail(db: D1Database, convId: string, uid: string) {
  const conv = await one<ConvRow>(
    db,
    `SELECT ${CONV_COLS} FROM conversations WHERE id = ?`,
    convId,
  );
  if (!conv) fail(404, "Conversation not found.");
  const memberRows = await all<ConvMemberRow>(
    db,
    `SELECT ${MEMBER_COLS} FROM members WHERE conv_id = ?`,
    convId,
  );
  return buildConvDetail(
    conv,
    memberRows,
    await usersById(
      db,
      memberRows.map((m) => m.user_id),
    ),
    uid,
  );
}

async function otherUser(db: D1Database, call: CallRow, uid: string) {
  const otherId = call.caller_id === uid ? call.callee_id : call.caller_id;
  return one<UserRow>(db, "SELECT * FROM users WHERE id = ?", otherId);
}
