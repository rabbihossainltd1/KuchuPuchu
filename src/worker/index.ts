/* KuchuPuchu v3 — WhatsApp-style messenger backend.
 * Locked designs: see ARCHITECTURE-v3.md. Voice/video calls are separate flows.
 * Push: FCM data messages (Messenger mode — no foreground service needed).
 * Files: R2 bucket `kp-media` (worker-mediated upload/download).
 */

import {
  BIO_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  ONLINE_WINDOW_MS,
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
  TURN_API_TOKEN?: string;
  /** Realtime fan-out Durable Objects (Steps 2-3). Optional on purpose: the
   *  test harness and any deploy without the bindings keep the plain REST
   *  path — every broadcast call guards on presence and no-ops without it. */
  CHAT_ROOM?: DurableObjectNamespace;
  CALL_SIGNAL?: DurableObjectNamespace;
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

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return timingSafeEqualHex(bytesToHex(new Uint8Array(bits)), hashHex);
}

/** Length-independent, branch-free comparison — avoids leaking hash bytes by timing. */
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
      about TEXT, created_at TEXT NOT NULL, last_active_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
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

/** Full shape, only ever returned for the signed-in user themself. */
function userSelf(row: UserRow, online = false) {
  return { ...userFrom(row, online), email: row.email };
}

async function requireUser(db: D1Database, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
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
      // `error_log` is append-only from two places (the catch-all below and
      // /api/debug/clientlog) and used to never shrink, so the table that exists
      // to diagnose a bad day became a slow leak on the free tier's row reads.
      // Seven days is far longer than any of our debugging windows.
      const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
      const pruned = await env.DB.prepare("DELETE FROM error_log WHERE created_at < ?")
        .bind(cutoff)
        .run();
      // A device that has not re-registered in 60 days is an uninstalled app (the
      // handle is refreshed on every start and on boot). Pushing at it is wasted
      // work, and an FCM token that has been dead that long is never coming back.
      const devCutoff = new Date(Date.now() - 60 * 864e5).toISOString();
      const devs = await env.DB.prepare("DELETE FROM devices WHERE updated_at < ?")
        .bind(devCutoff)
        .run();
      console.log(
        "cron_reap",
        JSON.stringify({
          reaped,
          pruned: pruned?.meta?.changes ?? 0,
          devices: devs?.meta?.changes ?? 0,
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
    return json({ firebase: fcmPublicConfig(env) });
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

  if (path === "/api/auth/register" && method === "POST") {
    rateLimit(`reg:${clientIp(request)}`, 10, 5);
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim() || email.split("@")[0] || "User";
    if (!email || !email.includes("@")) fail(400, "Enter a valid email.");
    if (password.length < 6) fail(400, "Password needs at least 6 characters.");
    if (await one(db, "SELECT id FROM users WHERE email = ?", email))
      fail(400, "That email is already in use.");
    // One random suffix used to be the whole strategy; if that suffix was also
    // taken the INSERT hit the UNIQUE index and the signup 500'd.
    const baseUsername = slugFrom(String(body.username || displayName));
    let username = baseUsername;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!(await one(db, "SELECT id FROM users WHERE username = ?", username))) break;
      username = `${baseUsername}_${Math.floor(Math.random() * 1_000_000)}`;
    }
    if (await one(db, "SELECT id FROM users WHERE username = ?", username)) {
      username = `${baseUsername}_${id().slice(0, 8)}`;
    }
    const userId = id();
    const created = nowIso();
    await run(
      db,
      "INSERT INTO users (id, email, password_hash, username, display_name, avatar_url, about, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
      userId,
      email,
      await hashPassword(password),
      username,
      displayName,
      created,
      created,
    );
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await run(
      db,
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      await sha256Hex(token),
      userId,
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      created,
    );
    ctx.waitUntil(sweepSessions(db));
    const row = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", userId))!;
    return json({ token, user: userSelf(row, true) }, 201);
  }

  if (path === "/api/auth/login" && method === "POST") {
    rateLimit(`login:${clientIp(request)}`, 15, 10);
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const row = await one<UserRow>(db, "SELECT * FROM users WHERE email = ?", email);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      fail(401, "Wrong email or password.");
    }
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await run(
      db,
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      await sha256Hex(token),
      row.id,
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      nowIso(),
    );
    ctx.waitUntil(sweepSessions(db));
    await run(db, "UPDATE users SET last_active_at = ? WHERE id = ?", nowIso(), row.id);
    return json({ token, user: userSelf(row, true) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const header = request.headers.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
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
      if (deviceId && owner)
        await run(
          db,
          "DELETE FROM devices WHERE user_id = ? AND device_id = ?",
          owner.user_id,
          deviceId,
        );
    }
    return json({ ok: true });
  }

  /* ---------- authenticated ---------- */

  const me = await requireUser(db, request);
  const uid = me.id;

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
    const before = url.searchParams.get("before");
    // created_at is millisecond-resolution text, so several messages routinely
    // share one value. Without a rowid tiebreaker both the ORDER BY and the
    // `created_at < ?` cursor were ambiguous and paging back silently dropped
    // every message that shared the boundary timestamp.
    const rows = before
      ? await all<MsgRow>(
          db,
          `SELECT * FROM messages WHERE conv_id = ? ${sinceClause} ${liveClause}
             AND (created_at < ? OR (created_at = ? AND rowid < ?))
           ORDER BY created_at DESC, rowid DESC LIMIT 50`,
          convId,
          ...sinceArgs,
          ...liveArgs,
          before,
          before,
          Number(url.searchParams.get("beforeRowid") || 0) || Number.MAX_SAFE_INTEGER,
        )
      : await all<MsgRow>(
          db,
          `SELECT * FROM messages WHERE conv_id = ? ${sinceClause} ${liveClause}
           ORDER BY created_at DESC, rowid DESC LIMIT 50`,
          convId,
          ...sinceArgs,
          ...liveArgs,
        );
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
    return json({ items, readAt: readAt ?? null, typingAt, marker });
  }

  if (msgMatch && method === "POST") {
    const convId = msgMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    const members = await membersOf(db, convId);
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
