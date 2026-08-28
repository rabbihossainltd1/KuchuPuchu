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

export type Env = {
  DB: D1Database;
  MEDIA?: R2Bucket;
  FCM_CONFIG?: string;
  FCM_CREDENTIALS?: string;
};

type Json = Record<string, unknown>;

/* ---------------- helpers ---------------- */

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "CLOUD") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    },
  });
}

function fail(status: number, message: string, code?: string): never {
  throw new ApiError(status, message, code);
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
    fail(429, "Too many attempts. Wait a minute and try again.", "RATE_LIMITED");
  }
  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5_000) rateBuckets.clear();
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
  await runCatchingSql(db, `ALTER TABLE conversations ADD COLUMN disappear_seconds INTEGER`);
  await runCatchingSql(db, `ALTER TABLE conversations ADD COLUMN theme TEXT`);
  schemaReady = true;
}

/** Runs a migration statement, ignoring "already exists" style failures. */
async function runCatchingSql(db: D1Database, sql: string) {
  try {
    await run(db, sql);
  } catch {
    /* duplicate column / index — already migrated */
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
};

/**
 * Public shape for *other* people. Deliberately has no `email`: it is embedded
 * in chat lists, member lists, search results and call payloads, so leaking it
 * there let any signed-in user harvest every address in the database.
 */
function userFrom(row: UserRow, online = false) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    about: row.about,
    online,
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
  const session = await one<{ user_id: string; expires_at: string }>(
    db,
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    hash,
  );
  if (!session) fail(401, "Sign in first.", "UNAUTHENTICATED");
  if (Date.parse(session.expires_at) < Date.now()) fail(401, "Session expired.", "UNAUTHENTICATED");
  const row = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", session.user_id);
  if (!row) fail(401, "Sign in first.", "UNAUTHENTICATED");
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

async function membersOf(db: D1Database, convId: string) {
  return all<{ user_id: string }>(db, "SELECT user_id FROM members WHERE conv_id = ?", convId);
}

async function requireMember(db: D1Database, convId: string, userId: string) {
  const conv = await one<{
    id: string;
    kind: string;
    title: string | null;
    owner_id: string | null;
  }>(db, "SELECT id, kind, title, owner_id FROM conversations WHERE id = ?", convId);
  if (!conv) fail(404, "Conversation not found.");
  const member = await one<{ user_id: string; role: string }>(
    db,
    "SELECT user_id, role FROM members WHERE conv_id = ? AND user_id = ?",
    convId,
    userId,
  );
  if (!member) fail(403, "You are not in this conversation.", "NOT_MEMBER");
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

async function fcmAccessToken(env: Env): Promise<{ token: string; projectId: string } | null> {
  if (!env.FCM_CREDENTIALS) return null;
  if (fcmTokenCache && fcmTokenCache.exp > Date.now() + 60_000) {
    return { token: fcmTokenCache.token, projectId: fcmTokenCache.projectId };
  }
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
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  fcmTokenCache = {
    token: data.access_token,
    projectId: creds.project_id,
    exp: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return { token: data.access_token, projectId: creds.project_id };
}

async function pushToUser(env: Env, db: D1Database, userId: string, data: Record<string, string>) {
  try {
    const auth = await fcmAccessToken(env);
    if (!auth) return;
    const rows = await all<{ token: string }>(
      db,
      "SELECT token FROM devices WHERE user_id = ?",
      userId,
    );
    // One round trip per device used to be sequential; a user on three devices
    // waited for three serial FCM calls before the loop finished.
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
                message: { token: row.token, android: { priority: "HIGH", ttl: "86400s", data } },
              }),
            },
          );
          if (res.status < 400) return;
          const err = (await res.json().catch(() => null)) as {
            error?: { details?: Array<{ reason?: string }> };
          } | null;
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
  } catch {
    /* push is best-effort */
  }
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
        return json({ error: { code: err.code, message: err.message } }, err.status);
      }
      // Never echo the underlying message: it routinely contained SQLite text
      // ("no such table: members") which leaked schema details to any client.
      console.error(
        "worker error",
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
      return json({ error: { code: "CLOUD", message: "Something went wrong. Try again." } }, 500);
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

  if (path === "/api/health")
    return json({ ok: true, service: "KuchuPuchu", version: "3.0", time: nowIso() });

  if (path === "/api/config/firebase" && method === "GET") {
    return json({ firebase: fcmPublicConfig(env) });
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
    if (token) await run(db, "DELETE FROM sessions WHERE token_hash = ?", await sha256Hex(token));
    return json({ ok: true });
  }

  /* ---------- authenticated ---------- */

  const me = await requireUser(db, request);
  const uid = me.id;

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
      if (avatar.length > 200_000) fail(400, "Avatar too large — pick a smaller image.");
      sets.push("avatar_url = ?");
      values.push(avatar || null);
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
    await run(
      db,
      "INSERT OR REPLACE INTO devices (token, user_id, updated_at) VALUES (?, ?, ?)",
      token,
      uid,
      nowIso(),
    );
    return json({ ok: true });
  }
  if (path === "/api/devices" && method === "DELETE") {
    await run(db, "DELETE FROM devices WHERE user_id = ?", uid);
    return json({ ok: true });
  }

  /* ---------- users & discovery ---------- */

  if (path === "/api/users" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    const rows = q
      ? await all<UserRow>(
          db,
          `SELECT * FROM users WHERE (LOWER(username) LIKE ?${ESCAPED_LIKE} OR LOWER(display_name) LIKE ?${ESCAPED_LIKE}) AND id != ? ORDER BY last_active_at DESC LIMIT 20`,
          likeTerm(q),
          likeTerm(q),
          uid,
        )
      : await all<UserRow>(
          db,
          "SELECT * FROM users WHERE id != ? ORDER BY last_active_at DESC LIMIT 20",
          uid,
        );
    const list = [];
    for (const row of rows) {
      if (await blockedBetween(db, uid, row.id)) continue;
      list.push(userFrom(row, onlineNow(row)));
    }
    return json({ users: list });
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
    return json({ user: userFrom(row, onlineNow(row)) });
  }

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
        `SELECT ${CONV_COLS},
                (SELECT MAX(rowid) FROM messages m WHERE m.conv_id = conversations.id) AS max_row
           FROM conversations WHERE id IN (${inSql(group.length)})`,
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
      const mark = watermarkFor(parseJson<HiddenMap>(conv.hidden_json, {}), uid);
      if (mark && conv.kind === "SOLO") {
        if (mark.row >= 0) {
          if (Number(conv.max_row || 0) <= mark.row) continue;
        } else {
          const lastAt = conv.last_message_at ? Date.parse(conv.last_message_at) : 0;
          if (!lastAt || lastAt <= Date.parse(mark.at)) continue;
        }
      }
      list.push(buildConvDetail(conv, membersByConv.get(conv.id) ?? [], users, uid));
    }
    return json({ items: list });
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
      await run(db, "UPDATE conversations SET disappear_seconds = ? WHERE id = ?", sec, convId);
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
    await run(
      db,
      "UPDATE members SET last_read_at = ?, unread = 0 WHERE conv_id = ? AND user_id = ?",
      nowIso(),
      readMatch[1]!,
      uid,
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

  /* ---------- messages ---------- */

  const msgMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgMatch && method === "GET") {
    const convId = msgMatch[1]!;
    await requireMember(db, convId, uid);
    const settings = await one<{ disappear_seconds: number | null }>(
      db,
      "SELECT disappear_seconds FROM conversations WHERE id = ?",
      convId,
    );
    const ttl = Number(settings?.disappear_seconds || 0);
    if (ttl > 0) {
      await run(
        db,
        "DELETE FROM messages WHERE conv_id = ? AND created_at < ?",
        convId,
        new Date(Date.now() - ttl * 1000).toISOString(),
      );
    }
    // Messages the member deleted for themselves stay deleted. Without this a
    // chat that reappeared after a new message came back with its whole
    // history, which is not what "delete chat" means.
    const mark = watermarkFor(parseJson<HiddenMap>(await hiddenJson(db, convId), {}), uid);
    const sinceClause = mark ? (mark.row >= 0 ? "AND rowid > ?" : "AND created_at > ?") : "";
    const sinceArgs = mark ? [mark.row >= 0 ? mark.row : mark.at] : [];
    const before = url.searchParams.get("before");
    // created_at is millisecond-resolution text, so several messages routinely
    // share one value. Without a rowid tiebreaker both the ORDER BY and the
    // `created_at < ?` cursor were ambiguous and paging back silently dropped
    // every message that shared the boundary timestamp.
    const rows = before
      ? await all<MsgRow>(
          db,
          `SELECT * FROM messages WHERE conv_id = ? ${sinceClause}
             AND (created_at < ? OR (created_at = ? AND rowid < ?))
           ORDER BY created_at DESC, rowid DESC LIMIT 50`,
          convId,
          ...sinceArgs,
          before,
          before,
          Number(url.searchParams.get("beforeRowid") || 0) || Number.MAX_SAFE_INTEGER,
        )
      : await all<MsgRow>(
          db,
          `SELECT * FROM messages WHERE conv_id = ? ${sinceClause}
           ORDER BY created_at DESC, rowid DESC LIMIT 50`,
          convId,
          ...sinceArgs,
        );
    const senderIds = [...new Set(rows.map((r) => r.sender_id).filter(Boolean))];
    const names = new Map<string, string>();
    for (const sid of senderIds) {
      const u = await one<{ display_name: string }>(
        db,
        "SELECT display_name FROM users WHERE id = ?",
        sid,
      );
      if (u) names.set(sid, u.display_name);
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
      await run(
        db,
        `UPDATE messages SET delivered_at = ? WHERE id IN (${inboxIds.map(() => "?").join(",")})`,
        nowIso(),
        ...inboxIds,
      );
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
    return json({ items, readAt: readAt ?? null });
  }

  if (msgMatch && method === "POST") {
    const convId = msgMatch[1]!;
    const { conv } = await requireMember(db, convId, uid);
    const members = await membersOf(db, convId);
    for (const memberId of members) {
      if (memberId.user_id !== uid && (await blockedBetween(db, uid, memberId.user_id))) {
        fail(403, "You can't reach this player.", "BLOCKED");
      }
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
    const mid = id();
    const created = nowIso();
    const clientId =
      typeof body.clientId === "string" && body.clientId.trim()
        ? body.clientId.trim().slice(0, 64)
        : null;
    const incomingMeta = (body.meta as Record<string, unknown> | undefined) ?? {};
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
    };
    if (clientId) metaObj.clientId = clientId;
    const meta = Object.keys(metaObj).length ? JSON.stringify(metaObj) : null;
    await run(
      db,
      "INSERT INTO messages (id, conv_id, sender_id, kind, body, media, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      mid,
      convId,
      uid,
      imageData ? "IMAGE" : fileKey ? "FILE" : kind,
      text,
      imageData ?? fileKey ?? null,
      meta,
      created,
    );
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
    for (const memberId of members) {
      if (memberId.user_id === uid) continue;
      await run(
        db,
        "UPDATE members SET unread = unread + 1 WHERE conv_id = ? AND user_id = ?",
        convId,
        memberId.user_id,
      );
    }
    const message = msgFrom((await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", mid))!);
    // Push: every other member gets a high-priority data message.
    for (const memberId of members) {
      if (memberId.user_id === uid) continue;
      ctx.waitUntil(
        pushToUser(env, db, memberId.user_id, {
          type: "message",
          convoId: convId,
          kind: conv.kind,
          from: me.display_name,
          body: preview.slice(0, 120),
        }),
      );
    }
    return json({ message }, 201);
  }

  const msgDeleteMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  if (msgDeleteMatch && method === "DELETE") {
    const row = await one<MsgRow>(db, "SELECT * FROM messages WHERE id = ?", msgDeleteMatch[1]!);
    if (!row) fail(404, "Message not found.");
    if (row.sender_id !== uid) fail(403, "You can only delete your own messages.");
    await run(
      db,
      "UPDATE messages SET body = NULL, media = NULL, meta_json = NULL, kind = 'DELETED' WHERE id = ?",
      row.id,
    );
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
    const contactRows = await all<{ conv_id: string }>(
      db,
      "SELECT conv_id FROM members WHERE user_id = ?",
      uid,
    );
    const contactIds = new Set<string>();
    for (const row of contactRows) {
      for (const member of await membersOf(db, row.conv_id)) {
        if (member.user_id !== uid) contactIds.add(member.user_id);
      }
    }
    const out: Array<Record<string, unknown>> = [];
    const mine = await all<StatusRow>(
      db,
      "SELECT * FROM statuses WHERE user_id = ? ORDER BY created_at ASC",
      uid,
    );
    if (mine.length) {
      const views = await all<{ status_id: string; viewer_id: string; viewed_at: string }>(
        db,
        "SELECT status_id, viewer_id, viewed_at FROM status_views WHERE status_id IN (SELECT id FROM statuses WHERE user_id = ?)",
        uid,
      );
      const viewersByStatus = new Map<string, string[]>();
      for (const view of views) {
        const list = viewersByStatus.get(view.status_id) ?? [];
        list.push(view.viewer_id);
        viewersByStatus.set(view.status_id, list);
      }
      out.push({
        user: userFrom(me, true),
        mine: true,
        statuses: mine.map((row) => ({
          id: row.id,
          kind: row.kind,
          text: row.text,
          bgStyle: row.bg_style,
          hasMedia: !!row.media,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          viewers: (viewersByStatus.get(row.id) ?? []).length,
        })),
      });
    }
    for (const contactId of contactIds) {
      const rows = await all<StatusRow>(
        db,
        "SELECT * FROM statuses WHERE user_id = ? AND expires_at > ? ORDER BY created_at ASC",
        contactId,
        nowIso(),
      );
      if (!rows.length) continue;
      const userRow = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", contactId);
      if (!userRow) continue;
      const viewed = new Set(
        (
          await all<{ status_id: string }>(
            db,
            "SELECT status_id FROM status_views WHERE viewer_id = ? AND status_id IN (SELECT id FROM statuses WHERE user_id = ?)",
            uid,
            contactId,
          )
        ).map((r) => r.status_id),
      );
      out.push({
        user: userFrom(userRow, onlineNow(userRow)),
        mine: false,
        allViewed: rows.every((r) => viewed.has(r.id)),
        statuses: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          text: row.text,
          bgStyle: row.bg_style,
          hasMedia: !!row.media,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        })),
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
    ctx.waitUntil(
      pushToUser(env, db, other, {
        type: "call",
        callId,
        kind,
        from: me.display_name,
        fromId: uid,
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
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const stale = await all<{ id: string; caller_id: string; callee_id: string; kind: string }>(
      db,
      "SELECT id, caller_id, callee_id, kind FROM calls WHERE status = 'RINGING' AND created_at < ?",
      cutoff,
    );
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
      if (changed > 0) await logCallEvent(db, row.caller_id, row.callee_id, row.kind, "MISSED");
    }
    const rows = await all<CallRow>(
      db,
      "SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status IN ('RINGING', 'ACTIVE') ORDER BY created_at DESC",
      uid,
      uid,
    );
    const items = [];
    for (const row of rows) {
      const otherId = row.caller_id === uid ? row.callee_id : row.caller_id;
      const other = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", otherId);
      items.push(callFrom(row, uid, other));
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
    const items = [];
    for (const row of rows) {
      const otherId = row.caller_id === uid ? row.callee_id : row.caller_id;
      const other = await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", otherId);
      items.push(callFrom(row, uid, other));
    }
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
      await run(
        db,
        "INSERT INTO call_ice (call_id, sender_id, candidate_json, created_at) VALUES (?, ?, ?, ?)",
        callId,
        uid,
        payload.slice(0, 4000),
        nowIso(),
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

  /* ---------- search ---------- */

  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    if (q.length < 2) return json({ users: [], messages: [], chats: [] });
    const userRows = await all<UserRow>(
      db,
      `SELECT * FROM users WHERE (LOWER(username) LIKE ?${ESCAPED_LIKE} OR LOWER(display_name) LIKE ?${ESCAPED_LIKE}) AND id != ? LIMIT 10`,
      likeTerm(q),
      likeTerm(q),
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
    const convIds = new Set(msgRows.map((row) => row.conv_id));
    const chats = [];
    for (const convId of convIds) {
      const conv = await conversationDetail(db, convId, uid);
      chats.push(conv);
    }
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

function msgFrom(row: MsgRow) {
  const meta = parseJson<{
    name?: string;
    type?: string;
    size?: number;
    clientId?: string;
    voice?: boolean;
    seconds?: number;
  }>(row.meta_json, {});
  const imageFile = row.kind === "FILE" && String(meta.type || "").startsWith("image/");
  return {
    id: row.id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    hasImage: (row.kind === "IMAGE" && !!row.media) || imageFile,
    mediaUrl: row.kind === "IMAGE" && row.media ? `/api/messages/${row.id}/media` : undefined,
    fileKey: row.kind === "FILE" ? row.media : undefined,
    fileName: meta.name,
    fileType: meta.type,
    fileSize: meta.size,
    meta: Object.keys(meta).length ? meta : undefined,
    clientId: meta.clientId,
    deliveredAt: row.delivered_at ? row.delivered_at : undefined,
    createdAt: row.created_at,
  };
}

type StatusRow = {
  id: string;
  user_id: string;
  kind: string;
  text: string | null;
  bg_style: string | null;
  media: string | null;
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
  ended_at: string | null;
  created_at: string;
};

function callFrom(row: CallRow, uid: string, other: UserRow | null) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    incoming: row.callee_id === uid,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    offerSdp: row.offer_sdp,
    answerSdp: row.answer_sdp,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    other: other ? userFrom(other, onlineNow(other)) : null,
  };
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

/** Keeps an IN(...) clause inside SQLite's bound-parameter limit. */
function chunked<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every user referenced by a set of member rows, in one pass. */
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
) {
  const members = [];
  let other = null;
  let meMuted = false;
  let unread = 0;
  for (const row of memberRows) {
    const user = users.get(row.user_id);
    if (!user) continue;
    members.push({
      user: userFrom(user, onlineNow(user)),
      role: row.role,
      lastReadAt: row.last_read_at,
    });
    if (row.user_id !== uid && conv.kind === "SOLO") other = userFrom(user, onlineNow(user));
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
