import { STORE_CATALOG } from "../shared/catalog";

export type Env = { DB: D1Database };

type Json = Record<string, unknown>;

const COIN_PACKS = [
  { id: "pkg_80", name: "Starter pouch", coins: 80, priceBdt: 49 },
  { id: "pkg_200", name: "Squad pack", coins: 200, priceBdt: 99 },
  { id: "pkg_500", name: "Custom night", coins: 500, priceBdt: 199 },
  { id: "pkg_1200", name: "Season chest", coins: 1200, priceBdt: 399 },
];

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "CLOUD") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data: unknown, status = 200, extra?: HeadersInit) {
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

function fail(status: number, message: string, code?: string): never {
  throw new ApiError(status, message, code);
}

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function pairId(a: string, b: string) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function slugFrom(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  return cleaned || "player";
}

function defaultProfile() {
  return {
    ffUid: null as string | null,
    ffIgn: null as string | null,
    serverRegion: "SOUTH_ASIA" as string | null,
    level: null as number | null,
    rank: null as string | null,
    preferredModes: [] as string[],
    playStyle: null as string | null,
    languages: ["bn"] as string[],
    availability: [] as string[],
    micPreference: null as string | null,
    ageRange: null as string | null,
    gender: null as string | null,
    genderPreference: null as string | null,
    relationshipStatus: null as string | null,
    facebookId: null as string | null,
    instagram: null as string | null,
    whatsapp: null as string | null,
    verifiedFf: false,
    verifiedIdentity: false,
    onboardingComplete: true,
  };
}

function defaultPrivacy() {
  return {
    showCountry: true,
    showDistrict: false,
    showApproximateArea: false,
    showRelationship: false,
    showFfUid: false,
    allowMessages: "FRIENDS",
    allowRequests: "EVERYONE",
    allowGifts: "FRIENDS",
    discoverable: true,
  };
}

function defaultNotif() {
  return {
    messaging: true,
    calls: true,
    requests: true,
    likes: true,
    comments: true,
    follow: true,
    gifting: true,
    wallet: true,
  };
}

type UserRow = {
  id: string;
  email: string | null;
  email_verified: number;
  password_hash: string | null;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  district: string | null;
  approximate_area: string | null;
  status: string;
  referral_code: string;
  wallet_balance: number;
  last_daily_reward: string | null;
  profile_json: string;
  privacy_json: string;
  created_at: string;
  last_active_at: string;
  notif_json?: string | null;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseMessageMedia(imageUrl?: string | null) {
  if (!imageUrl)
    return {
      imageUrls: [] as string[],
      sticker: null as string | null,
      call: null as string | null,
    };
  if (imageUrl.startsWith("call:")) return { imageUrls: [], sticker: null, call: imageUrl };
  if (imageUrl.startsWith("sticker:"))
    return { imageUrls: [], sticker: imageUrl.slice(8), call: null };
  if (imageUrl.startsWith("data:")) return { imageUrls: [imageUrl], sticker: null, call: null };
  if (imageUrl.startsWith("[")) {
    const list = parseJson<unknown[]>(imageUrl, []).filter(
      (item): item is string => typeof item === "string" && item.startsWith("data:"),
    );
    return { imageUrls: list, sticker: null, call: null };
  }
  return { imageUrls: [], sticker: null, call: null };
}

function clockLabel(sec: number) {
  const n = Math.max(0, Math.floor(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

async function ensureConv(db: D1Database, a: string, b: string) {
  const cid = `c_${pairId(a, b)}`;
  const existing = await one(db, "SELECT id FROM conversations WHERE id = ?", cid);
  if (!existing) {
    await run(
      db,
      "INSERT INTO conversations (id, members_json, last_message, last_message_at, unread_json, created_at) VALUES (?, ?, NULL, NULL, ?, ?)",
      cid,
      JSON.stringify([a, b]),
      JSON.stringify({ [a]: 0, [b]: 0 }),
      nowIso(),
    );
  }
  await run(db, "INSERT OR IGNORE INTO conversation_members (conv_id, user_id) VALUES (?, ?)", cid, a);
  await run(db, "INSERT OR IGNORE INTO conversation_members (conv_id, user_id) VALUES (?, ?)", cid, b);
  return cid;
}

async function logCallEvent(
  db: D1Database,
  caller: string,
  callee: string,
  kind: string,
  status: string,
  seconds = 0,
) {
  const cid = await ensureConv(db, caller, callee);
  const video = kind === "VIDEO";
  const label =
    status === "ENDED"
      ? `${video ? "Video" : "Voice"} call · ${clockLabel(seconds)}`
      : status === "DECLINED"
        ? `Declined ${video ? "video" : "voice"} call`
        : `Missed ${video ? "video" : "voice"} call`;
  const created = nowIso();
  await run(
    db,
    "INSERT INTO messages (id, conversation_id, sender_id, body, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id(),
    cid,
    caller,
    label,
    `call:${kind}:${status}:${seconds}`,
    created,
  );
  await run(
    db,
    "UPDATE conversations SET last_message = ?, last_message_at = ? WHERE id = ?",
    label,
    created,
    cid,
  );
}

function meFrom(row: UserRow) {
  const profile = { ...defaultProfile(), ...parseJson(row.profile_json, {}) };
  const privacy = { ...defaultPrivacy(), ...parseJson(row.privacy_json, {}) };
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    country: row.country,
    district: row.district,
    approximateArea: row.approximate_area,
    status: row.status,
    referralCode: row.referral_code,
    referralLink: "",
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    reputation: 0,
    adminRole: null,
    wallet: { balance: Number(row.wallet_balance || 0) },
    profile,
    privacy,
    notificationPreferences: {
      ...defaultNotif(),
      ...parseJson(row.notif_json ?? "{}", {}),
    },
  };
}

function publicFrom(row: UserRow, viewer?: string) {
  const me = meFrom(row);
  const showDistrict = me.privacy.showDistrict || viewer === me.id;
  const showUid = me.privacy.showFfUid || viewer === me.id;
  const showRel = me.privacy.showRelationship || viewer === me.id;
  const last = Date.parse(me.lastActiveAt);
  return {
    userId: me.id,
    displayName: me.displayName,
    username: me.username,
    avatarUrl: me.avatarUrl,
    bio: me.bio,
    country: me.privacy.showCountry ? me.country : null,
    district: showDistrict ? me.district : null,
    approximateArea: me.privacy.showApproximateArea ? me.approximateArea : null,
    ffUid: showUid ? me.profile.ffUid : null,
    ffIgn: me.profile.ffIgn,
    serverRegion: me.profile.serverRegion,
    level: me.profile.level,
    rank: me.profile.rank,
    preferredModes: me.profile.preferredModes,
    playStyle: me.profile.playStyle,
    languages: me.profile.languages,
    availability: me.profile.availability,
    micPreference: me.profile.micPreference,
    relationshipStatus: showRel ? me.profile.relationshipStatus : null,
    facebookId: me.profile.facebookId,
    instagram: me.profile.instagram,
    whatsapp: me.profile.whatsapp,
    verifiedFf: me.profile.verifiedFf,
    verifiedIdentity: me.profile.verifiedIdentity,
    reputation: me.reputation,
    lastActiveAt: me.lastActiveAt,
    online: Number.isFinite(last) && Date.now() - last < 5 * 60 * 1000,
  };
}

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]) {
  const stmt = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

async function one<T>(db: D1Database, sql: string, ...binds: unknown[]) {
  const stmt = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  return stmt.first<T>();
}

async function run(db: D1Database, sql: string, ...binds: unknown[]) {
  const stmt = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  return stmt.run();
}

function bytesToHex(buf: ArrayBuffer | Uint8Array) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(digest);
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
  return `${bytesToHex(salt)}:${bytesToHex(bits)}`;
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
  return bytesToHex(bits) === hashHex;
}

async function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

async function createSession(db: D1Database, userId: string) {
  const token = await randomToken();
  const hash = await sha256Hex(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await run(
    db,
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    hash,
    userId,
    expires,
    nowIso(),
  );
  return token;
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
  if (!row || row.status === "DELETED") fail(401, "Sign in first.", "UNAUTHENTICATED");
  await run(db, "UPDATE users SET last_active_at = ? WHERE id = ?", nowIso(), row.id);
  return row;
}

async function userPublic(db: D1Database, uid: string, viewer?: string) {
  const row = await one<UserRow>(
    db,
    "SELECT * FROM users WHERE id = ? AND status != 'DELETED'",
    uid,
  );
  return row ? publicFrom(row, viewer) : null;
}

async function blockedSet(db: D1Database, uid: string) {
  const rows = await all<{ target_id: string }>(
    db,
    "SELECT target_id FROM blocks WHERE owner_id = ?",
    uid,
  );
  return new Set(rows.map((r) => r.target_id));
}

async function friendIds(db: D1Database, uid: string) {
  const rows = await all<{ users_json: string }>(
    db,
    "SELECT users_json FROM friendships WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)",
    uid,
    uid,
  );
  const ids = new Set<string>();
  for (const row of rows) {
    const users = parseJson<string[]>(row.users_json, []);
    for (const other of users) if (other !== uid) ids.add(other);
  }
  return ids;
}

async function areFriends(db: D1Database, a: string, b: string) {
  const row = await one<{ status: string }>(
    db,
    "SELECT status FROM friendships WHERE id = ? AND status = 'accepted'",
    pairId(a, b),
  );
  return Boolean(row);
}

async function requestBetween(db: D1Database, a: string, b: string) {
  const row = await one<{ from_id: string }>(
    db,
    "SELECT from_id FROM friendships WHERE id = ? AND status = 'pending'",
    pairId(a, b),
  );
  if (!row) return { state: "none", id: null as string | null };
  return { state: row.from_id === a ? "outgoing" : "incoming", id: pairId(a, b) };
}

function messageRule(privacyJson: string) {
  const privacy = { ...defaultPrivacy(), ...parseJson(privacyJson, {}) };
  const rule = String(privacy.allowMessages ?? "FRIENDS").toUpperCase();
  return rule === "EVERYONE" || rule === "NO_ONE" ? rule : "FRIENDS";
}

async function messageGate(db: D1Database, fromId: string, targetId: string, verb = "message") {
  const target = await one<{ privacy_json: string; status: string }>(
    db,
    "SELECT privacy_json, status FROM users WHERE id = ?",
    targetId,
  );
  if (!target || target.status === "DELETED") fail(404, "Player not found.");
  const blockEither = await one(
    db,
    "SELECT id FROM blocks WHERE (owner_id = ? AND target_id = ?) OR (owner_id = ? AND target_id = ?)",
    targetId,
    fromId,
    fromId,
    targetId,
  );
  if (blockEither) fail(403, "You can't reach this player.", "BLOCKED");
  const rule = messageRule(target.privacy_json);
  if (rule === "EVERYONE") return;
  if (rule === "NO_ONE") fail(403, `This player is not accepting ${verb}s right now.`, "MESSAGES_CLOSED");
  const friends = await areFriends(db, fromId, targetId);
  if (!friends) fail(403, `Only friends can ${verb} this player.`, "FRIENDS_ONLY");
}

async function listPeople(db: D1Database, viewer: string) {
  const rows = await all<UserRow>(
    db,
    "SELECT * FROM users WHERE id != ? AND status != 'DELETED' LIMIT 80",
    viewer,
  );
  const blocked = await blockedSet(db, viewer);
  return rows.map((row) => publicFrom(row, viewer)).filter((p) => !blocked.has(p.userId));
}

async function notify(
  db: D1Database,
  userId: string,
  title: string,
  body: string,
  link?: string,
  kind: keyof ReturnType<typeof defaultNotif> = "messaging",
) {
  const row = await one<{ notif_json: string | null }>(
    db,
    "SELECT notif_json FROM users WHERE id = ?",
    userId,
  );
  const prefs = { ...defaultNotif(), ...parseJson(row?.notif_json ?? "{}", {}) };
  if (prefs[kind] === false) return;
  await run(
    db,
    "INSERT INTO notifications (id, user_id, title, body, link, kind, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    id(),
    userId,
    title,
    body,
    link ?? "/notifications",
    kind,
    nowIso(),
  );
}

async function loadPost(db: D1Database, postId: string, uid: string) {
  const post = await one<{
    id: string;
    author_id: string;
    body: string;
    visibility: string;
    like_count: number;
    comment_count: number;
    created_at: string;
  }>(db, "SELECT * FROM posts WHERE id = ?", postId);
  if (!post) fail(404, "Post not found.");
  const author = await userPublic(db, post.author_id, uid);
  if (!author) fail(404, "Post not found.");
  const liked = await one(
    db,
    "SELECT user_id FROM post_likes WHERE post_id = ? AND user_id = ?",
    postId,
    uid,
  );
  const comments = await all<{ id: string; author_id: string; body: string; created_at: string }>(
    db,
    "SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 40",
    postId,
  );
  const mapped = [];
  for (const c of comments) {
    mapped.push({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      author: await userPublic(db, c.author_id, uid),
    });
  }
  return {
    post: {
      id: post.id,
      body: post.body,
      visibility: post.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC",
      createdAt: post.created_at,
      author,
      likeCount: Number(post.like_count || 0),
      liked: Boolean(liked),
      commentCount: Number(post.comment_count || mapped.length),
      comments: mapped,
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });
    try {
      return await handle(request, env.DB);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code, message: err.message } }, err.status);
      }
      return json(
        { error: { code: "CLOUD", message: err instanceof Error ? err.message : "Server error." } },
        500,
      );
    }
  },
};

let schemaReady = false;

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  try {
    await run(db, "ALTER TABLE messages ADD COLUMN image_url TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE users ADD COLUMN notif_json TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE notifications ADD COLUMN kind TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE messages ADD COLUMN reaction TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE conversations ADD COLUMN muted_json TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE conversations ADD COLUMN hidden_json TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "ALTER TABLE conversations ADD COLUMN read_json TEXT");
  } catch {
    /* column already exists */
  }
  try {
    await run(db, "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, status)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, status)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_call_ice_call ON call_ice(call_id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_friendships_from ON friendships(from_id, status)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_friendships_to ON friendships(to_id, status)");
    await run(
      db,
      "CREATE TABLE IF NOT EXISTS conversation_members (conv_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (conv_id, user_id))",
    );
    const backfill = await one<{ value: string }>(
      db,
      "SELECT value FROM meta WHERE key = 'conv_members_backfill'",
    );
    if (!backfill) {
      const convs = await all<{ id: string; members_json: string }>(
        db,
        "SELECT id, members_json FROM conversations",
      );
      for (const conv of convs) {
        for (const member of parseJson<string[]>(conv.members_json, [])) {
          await run(
            db,
            "INSERT OR IGNORE INTO conversation_members (conv_id, user_id) VALUES (?, ?)",
            conv.id,
            member,
          );
        }
      }
      await run(
        db,
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('conv_members_backfill', ?)",
        nowIso(),
      );
    }
    const privacyShift = await one<{ value: string }>(
      db,
      "SELECT value FROM meta WHERE key = 'allow_messages_default_friends'",
    );
    if (!privacyShift) {
      await run(
        db,
        "UPDATE users SET privacy_json = json_set(privacy_json, '$.allowMessages', 'FRIENDS') WHERE json_extract(privacy_json, '$.allowMessages') IS NULL OR json_extract(privacy_json, '$.allowMessages') = 'EVERYONE'",
      );
      await run(
        db,
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('allow_messages_default_friends', ?)",
        nowIso(),
      );
    }
  } catch {
    /* migrations already applied or not needed */
  }
  schemaReady = true;
}

async function handle(request: Request, db: D1Database): Promise<Response> {
  await ensureSchema(db);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();
  let body: Json = {};
  if (method !== "GET" && method !== "HEAD") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text) as Json;
      } catch {
        body = {};
      }
    }
  }

  if (path === "/api/health") return json({ ok: true, service: "KuchuPuchu", time: nowIso() });
  if (path === "/api/auth/providers") return json({ google: false, email: true });

  if (path === "/api/auth/register" && method === "POST") {
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim() || email.split("@")[0] || "Player";
    if (!email || !email.includes("@")) fail(400, "Enter a valid email.");
    if (password.length < 6) fail(400, "Password needs at least 6 characters.");
    const exists = await one(db, "SELECT id FROM users WHERE email = ?", email);
    if (exists) fail(400, "That email is already in use.");
    let username = slugFrom(String(body.username || displayName));
    const taken = await one(db, "SELECT id FROM users WHERE username = ?", username);
    if (taken) username = `${username}_${Math.floor(Math.random() * 999)}`;
    const userId = id();
    const created = nowIso();
    await run(
      db,
      `INSERT INTO users (
        id, email, email_verified, password_hash, username, display_name, avatar_url, bio,
        country, district, approximate_area, status, referral_code, wallet_balance,
        profile_json, privacy_json, created_at, last_active_at
      ) VALUES (?, ?, 0, ?, ?, ?, NULL, NULL, 'Bangladesh', NULL, NULL, 'ACTIVE', ?, 80, ?, ?, ?, ?)`,
      userId,
      email,
      await hashPassword(password),
      username,
      displayName,
      userId.slice(0, 8).toUpperCase(),
      JSON.stringify(defaultProfile()),
      JSON.stringify(defaultPrivacy()),
      created,
      created,
    );
    const token = await createSession(db, userId);
    const row = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", userId))!;
    return json({ ok: true, token, user: meFrom(row) }, 201);
  }

  if (path === "/api/auth/session" && method === "POST") {
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const row = await one<UserRow>(db, "SELECT * FROM users WHERE email = ?", email);
    if (!row || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
      fail(401, "Email or password is wrong.", "INVALID_CREDENTIALS");
    }
    if (row.status === "DELETED") fail(401, "Email or password is wrong.", "INVALID_CREDENTIALS");
    const token = await createSession(db, row.id);
    return json({ ok: true, token, user: meFrom(row) });
  }

  if (path === "/api/auth/password-reset" && method === "POST") {
    return json({ ok: true });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const header = request.headers.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (token) await run(db, "DELETE FROM sessions WHERE token_hash = ?", await sha256Hex(token));
    return json({ ok: true });
  }

  const me = await requireUser(db, request);
  const uid = me.id;
  const search = url.searchParams;

  if ((path === "/api/me" || path === "/api/me/profile") && method === "GET") {
    return json({ user: meFrom(me) });
  }

  if ((path === "/api/me" || path === "/api/me/profile") && method === "PATCH") {
    const profile = { ...defaultProfile(), ...parseJson(me.profile_json, {}) };
    const next: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      next.push(`${col} = ?`);
      values.push(value);
    };
    if (body.displayName !== undefined)
      set("display_name", String(body.displayName).trim() || me.display_name);
    if (body.username !== undefined) set("username", slugFrom(String(body.username)));
    if (body.bio !== undefined) set("bio", String(body.bio));
    if (body.avatarUrl !== undefined) set("avatar_url", body.avatarUrl);
    if (body.country !== undefined) set("country", body.country);
    if (body.district !== undefined) set("district", body.district);
    const keys = [
      "ffUid",
      "ffIgn",
      "serverRegion",
      "level",
      "rank",
      "preferredModes",
      "playStyle",
      "languages",
      "availability",
      "micPreference",
      "ageRange",
      "gender",
      "genderPreference",
      "relationshipStatus",
      "facebookId",
      "instagram",
      "whatsapp",
    ] as const;
    let changed = false;
    for (const key of keys) {
      if (body[key] !== undefined) {
        (profile as Record<string, unknown>)[key] = body[key];
        changed = true;
      }
    }
    if (changed) set("profile_json", JSON.stringify(profile));
    if (next.length) {
      values.push(uid);
      await run(db, `UPDATE users SET ${next.join(", ")} WHERE id = ?`, ...values);
    }
    const fresh = (await one<UserRow>(db, "SELECT * FROM users WHERE id = ?", uid))!;
    return json({ user: meFrom(fresh) });
  }

  if (path === "/api/me/privacy" && method === "PATCH") {
    const privacy = { ...defaultPrivacy(), ...parseJson(me.privacy_json, {}), ...body };
    await run(db, "UPDATE users SET privacy_json = ? WHERE id = ?", JSON.stringify(privacy), uid);
    return json({ ok: true });
  }

  if (path === "/api/me/notifications" && method === "PATCH") {
    const current = { ...defaultNotif(), ...parseJson(me.notif_json ?? "{}", {}) };
    const next = { ...current };
    for (const key of Object.keys(defaultNotif()) as Array<keyof ReturnType<typeof defaultNotif>>) {
      if (typeof body[key] === "boolean") next[key] = body[key] as boolean;
    }
    await run(db, "UPDATE users SET notif_json = ? WHERE id = ?", JSON.stringify(next), uid);
    return json({ ok: true, notificationPreferences: next });
  }

  if (path === "/api/feed") {
    const friends = await friendIds(db, uid);
    const posts = await all<{
      id: string;
      author_id: string;
      body: string;
      visibility: string;
      like_count: number;
      comment_count: number;
      created_at: string;
    }>(db, "SELECT * FROM posts ORDER BY created_at DESC LIMIT 60");
    const items = [];
    for (const post of posts) {
      const visibility = post.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC";
      if (visibility === "FRIENDS" && post.author_id !== uid && !friends.has(post.author_id))
        continue;
      const loaded = await loadPost(db, post.id, uid);
      items.push(loaded.post);
    }
    return json({ items });
  }

  if (path === "/api/posts" && method === "POST") {
    const text = String(body.body || "").trim();
    if (!text) fail(400, "Write something first.");
    const visibility = body.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC";
    const postId = id();
    const created = nowIso();
    await run(
      db,
      "INSERT INTO posts (id, author_id, body, visibility, like_count, comment_count, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
      postId,
      uid,
      text.slice(0, 500),
      visibility,
      created,
    );
    return json(await loadPost(db, postId, uid), 201);
  }

  const postIdMatch = path.match(/^\/api\/posts\/([^/]+)$/);
  if (postIdMatch && method === "GET") return json(await loadPost(db, postIdMatch[1]!, uid));
  if (postIdMatch && method === "DELETE") {
    const post = await one<{ author_id: string }>(
      db,
      "SELECT author_id FROM posts WHERE id = ?",
      postIdMatch[1],
    );
    if (!post) fail(404, "Post not found.");
    if (post.author_id !== uid) fail(403, "You can only delete your post.");
    await run(db, "DELETE FROM posts WHERE id = ?", postIdMatch[1]);
    return json({ ok: true });
  }

  const likeMatch = path.match(/^\/api\/posts\/([^/]+)\/like$/);
  if (likeMatch && method === "POST") {
    const postId = likeMatch[1]!;
    const liked = await one(
      db,
      "SELECT user_id FROM post_likes WHERE post_id = ? AND user_id = ?",
      postId,
      uid,
    );
    if (liked) {
      await run(db, "DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", postId, uid);
      await run(db, "UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?", postId);
    } else {
      await run(
        db,
        "INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
        postId,
        uid,
        nowIso(),
      );
      await run(db, "UPDATE posts SET like_count = like_count + 1 WHERE id = ?", postId);
      const post = await one<{ author_id: string }>(
        db,
        "SELECT author_id FROM posts WHERE id = ?",
        postId,
      );
      if (post && post.author_id !== uid) {
        const actor = publicFrom(me, post.author_id);
        await notify(
          db,
          post.author_id,
          "New like",
          `${actor.displayName} liked your post`,
          "/home",
          "likes",
        );
      }
    }
    return json(await loadPost(db, postId, uid));
  }

  const commentMatch = path.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (commentMatch && method === "POST") {
    const postId = commentMatch[1]!;
    const text = String(body.body || "").trim();
    if (!text) fail(400, "Write a comment.");
    await run(
      db,
      "INSERT INTO post_comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      id(),
      postId,
      uid,
      text.slice(0, 280),
      nowIso(),
    );
    await run(db, "UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?", postId);
    const post = await one<{ author_id: string }>(
      db,
      "SELECT author_id FROM posts WHERE id = ?",
      postId,
    );
    if (post && post.author_id !== uid) {
      await notify(
        db,
        post.author_id,
        "New comment",
        `${me.display_name} commented`,
        "/home",
        "comments",
      );
    }
    return json(await loadPost(db, postId, uid), 201);
  }

  if (path === "/api/stories" && method === "GET") {
    const rows = await all<{
      id: string;
      author_id: string;
      body: string | null;
      image_url: string | null;
      created_at: string;
      expires_at: string;
    }>(db, "SELECT * FROM stories ORDER BY created_at DESC LIMIT 80");
    const now = Date.now();
    const groups = new Map<
      string,
      {
        author: ReturnType<typeof publicFrom>;
        seen: boolean;
        stories: Array<Record<string, unknown>>;
      }
    >();
    for (const row of rows) {
      if (Date.parse(row.expires_at) < now) continue;
      const author = await userPublic(db, row.author_id, uid);
      if (!author) continue;
      const seenRow = await one(
        db,
        "SELECT story_id FROM story_views WHERE story_id = ? AND viewer_id = ?",
        row.id,
        uid,
      );
      const story = {
        id: row.id,
        body: row.body,
        imageUrl: row.image_url,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        seen: Boolean(seenRow),
        mine: row.author_id === uid,
      };
      const group = groups.get(author.userId) ?? { author, seen: true, stories: [] };
      group.stories.push(story);
      group.seen = group.seen && story.seen;
      groups.set(author.userId, group);
    }
    const items = [...groups.values()].sort((a, b) => Number(a.seen) - Number(b.seen));
    return json({ items });
  }

  if (path === "/api/stories" && method === "POST") {
    let imageUrl: string | null = null;
    if (typeof body.imageData === "string" && body.imageData.startsWith("data:")) {
      if (body.imageData.length > 700000) fail(400, "Photo is too large. Pick a smaller image.");
      imageUrl = body.imageData;
    }
    const caption = body.body ? String(body.body).slice(0, 200) : null;
    if (!imageUrl && !caption) fail(400, "Add a photo or a caption.");
    await run(
      db,
      "INSERT INTO stories (id, author_id, body, image_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      id(),
      uid,
      caption,
      imageUrl,
      nowIso(),
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    );
    return json({ ok: true });
  }

  const storyView = path.match(/^\/api\/stories\/([^/]+)\/view$/);
  if (storyView && method === "POST") {
    await run(
      db,
      "INSERT OR IGNORE INTO story_views (story_id, viewer_id, created_at) VALUES (?, ?, ?)",
      storyView[1],
      uid,
      nowIso(),
    );
    return json({ ok: true });
  }
  const storyDel = path.match(/^\/api\/stories\/([^/]+)$/);
  if (storyDel && method === "DELETE") {
    const story = await one<{ author_id: string }>(
      db,
      "SELECT author_id FROM stories WHERE id = ?",
      storyDel[1],
    );
    if (!story) fail(404, "Story not found.");
    if (story.author_id !== uid) fail(403, "You can only delete your story.");
    await run(db, "DELETE FROM stories WHERE id = ?", storyDel[1]);
    return json({ ok: true });
  }

  if (path === "/api/discover" || path === "/api/discover/recommendations") {
    let people = await listPeople(db, uid);
    const q = (search.get("q") ?? "").trim().toLowerCase();
    if (q) {
      people = people.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q) ||
          (p.ffIgn ?? "").toLowerCase().includes(q),
      );
    }
    const myProfile = meFrom(me).profile;
    const ranked = people.map((p) => {
      const reasons: string[] = [];
      let score = 0;
      if (myProfile.serverRegion && p.serverRegion === myProfile.serverRegion) {
        score += 3;
        reasons.push("Same server");
      }
      if (myProfile.rank && p.rank === myProfile.rank) {
        score += 2;
        reasons.push("Same rank");
      }
      if (myProfile.preferredModes.some((m) => p.preferredModes.includes(m))) {
        score += 2;
        reasons.push("Same mode");
      }
      if (p.online) score += 1;
      return { ...p, score, reasons };
    });
    ranked.sort((a, b) => b.score - a.score);
    return json({ items: ranked });
  }

  const userGet = path.match(/^\/api\/users\/([^/]+)$/);
  if (userGet && method === "GET") {
    const targetId = userGet[1]!;
    const user = await userPublic(db, targetId, uid);
    if (!user) fail(404, "Player not found.");
    const friend = await areFriends(db, uid, targetId);
    const rule = await (async () => {
      const target = await one<{ privacy_json: string }>(
        db,
        "SELECT privacy_json FROM users WHERE id = ?",
        targetId,
      );
      return messageRule(target?.privacy_json ?? "{}");
    })();
    const request = friend ? { state: "none", id: null } : await requestBetween(db, uid, targetId);
    const count = await one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)",
      targetId,
      targetId,
    );
    return json({
      user: {
        ...user,
        friend,
        canMessage: rule === "EVERYONE" || (rule === "FRIENDS" && friend),
        requestState: request.state,
        requestId: request.id ?? undefined,
        friendsCount: Number(count?.n ?? 0),
      },
    });
  }
  const follow = path.match(/^\/api\/users\/([^/]+)\/follow$/);
  if (follow && method === "POST") {
    await run(
      db,
      "INSERT OR REPLACE INTO follows (id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)",
      `${uid}_${follow[1]}`,
      uid,
      follow[1],
      nowIso(),
    );
    await notify(
      db,
      follow[1]!,
      "New follow",
      `${me.display_name} followed you`,
      `/players/${uid}`,
      "follow",
    );
    return json({ ok: true });
  }
  const block = path.match(/^\/api\/users\/([^/]+)\/block$/);
  if (block && method === "POST") {
    await run(
      db,
      "INSERT INTO blocks (id, owner_id, target_id, created_at) VALUES (?, ?, ?, ?)",
      id(),
      uid,
      block[1],
      nowIso(),
    );
    return json({ ok: true });
  }

  if (path === "/api/reports" && method === "POST") {
    await run(
      db,
      "INSERT INTO reports (id, reporter_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
      id(),
      uid,
      JSON.stringify(body),
      nowIso(),
    );
    return json({ ok: true });
  }

  if (path === "/api/friends") {
    const ids = await friendIds(db, uid);
    const items = [];
    for (const other of ids) {
      const person = await userPublic(db, other, uid);
      if (person) items.push(person);
    }
    return json({ items });
  }

  if (path === "/api/friend-requests" && method === "GET") {
    const rows = await all<{ id: string; from_id: string; created_at: string }>(
      db,
      "SELECT id, from_id, created_at FROM friendships WHERE to_id = ? AND status = 'pending'",
      uid,
    );
    const items = [];
    for (const row of rows) {
      const from = await userPublic(db, row.from_id, uid);
      if (from)
        items.push({ id: row.id, createdAt: row.created_at, from, fromUserId: from.userId });
    }
    return json({ items });
  }

  if (path === "/api/friend-requests" && method === "POST") {
    const target = String(body.userId || "");
    if (!target || target === uid) fail(400, "Pick someone else.");
    const fid = pairId(uid, target);
    const existing = await one<{ status: string }>(
      db,
      "SELECT status FROM friendships WHERE id = ?",
      fid,
    );
    if (existing?.status === "accepted") fail(400, "You are already friends.");
    await run(
      db,
      "INSERT OR REPLACE INTO friendships (id, users_json, from_id, to_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      fid,
      JSON.stringify([uid, target]),
      uid,
      target,
      nowIso(),
    );
    await notify(
      db,
      target,
      "Friend request",
      `${me.display_name} sent you a friend request`,
      "/requests",
      "requests",
    );
    return json({ ok: true });
  }

  const accept = path.match(/^\/api\/friend-requests\/([^/]+)\/accept$/);
  const decline = path.match(/^\/api\/friend-requests\/([^/]+)\/decline$/);
  const reqId = accept?.[1] ?? decline?.[1];
  if (reqId && method === "POST") {
    const row = await one<{ from_id: string }>(
      db,
      "SELECT from_id FROM friendships WHERE id = ?",
      reqId,
    );
    if (!row) fail(404, "Request not found.");
    await run(
      db,
      "DELETE FROM notifications WHERE kind = 'requests' AND title = 'Friend request' AND (user_id = ? OR user_id = ?)",
      uid,
      row.from_id,
    );
    if (decline) {
      await run(db, "DELETE FROM friendships WHERE id = ?", reqId);
      return json({ ok: true });
    }
    await run(db, "UPDATE friendships SET status = 'accepted' WHERE id = ?", reqId);
    return json({ ok: true });
  }

  if (path === "/api/duo-requests" && method === "GET") {
    const rows = await all<{
      id: string;
      from_id: string;
      to_id: string;
      mode: string;
      status: string;
    }>(db, "SELECT * FROM duo_requests WHERE from_id = ? OR to_id = ?", uid, uid);
    const items = [];
    for (const row of rows) {
      items.push({
        id: row.id,
        mode: row.mode,
        status: row.status,
        requester: await userPublic(db, row.from_id, uid),
      });
    }
    return json({ items });
  }
  if (path === "/api/duo-requests" && method === "POST") {
    const target = String(body.targetId || body.userId || "");
    if (!target) fail(400, "Pick a player.");
    const added = id();
    await run(
      db,
      "INSERT INTO duo_requests (id, from_id, to_id, mode, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)",
      added,
      uid,
      target,
      body.mode || "CLASH_SQUAD",
      nowIso(),
    );
    await notify(
      db,
      target,
      "Duo invite",
      `${me.display_name} invited you to queue`,
      "/requests",
      "requests",
    );
    return json({ id: added });
  }
  const duoAct = path.match(/^\/api\/duo-requests\/([^/]+)\/(accept|decline|cancel)$/);
  if (duoAct && method === "POST") {
    const status =
      duoAct[2] === "accept" ? "ACCEPTED" : duoAct[2] === "decline" ? "DECLINED" : "CANCELLED";
    await run(db, "UPDATE duo_requests SET status = ? WHERE id = ?", status, duoAct[1]);
    return json({ ok: true });
  }

  if (path === "/api/conversations" && method === "GET") {
    const rows = await all<{
      id: string;
      members_json: string;
      last_message: string | null;
      last_message_at: string | null;
      unread_json: string;
      muted_json?: string | null;
      hidden_json?: string | null;
      read_json?: string | null;
    }>(
      db,
      `SELECT c.* FROM conversations c
         JOIN conversation_members m ON m.conv_id = c.id
         WHERE m.user_id = ?`,
      uid,
    );
    const items = [];
    for (const row of rows) {
      const members = parseJson<string[]>(row.members_json, []);
      if (!members.includes(uid)) continue;
      const hiddenMap = parseJson<Record<string, boolean>>(row.hidden_json ?? "{}", {});
      if (hiddenMap[uid]) continue;
      const otherId = members.find((m) => m !== uid);
      const other = otherId ? await userPublic(db, otherId, uid) : null;
      if (!other) continue;
      const unreadMap = parseJson<Record<string, number>>(row.unread_json, {});
      const mutedMap = parseJson<Record<string, boolean>>(row.muted_json ?? "{}", {});
      const readMap = parseJson<Record<string, string>>(row.read_json ?? "{}", {});
      items.push({
        id: row.id,
        other,
        lastMessage: row.last_message
          ? { body: row.last_message, createdAt: row.last_message_at }
          : null,
        unread: Number(unreadMap[uid] || 0),
        lastMessageAt: row.last_message_at ?? undefined,
        muted: Boolean(mutedMap[uid]),
        otherReadAt: otherId ? (readMap[otherId] ?? null) : null,
      });
    }
    items.sort((a, b) =>
      String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? "")),
    );
    return json({ items });
  }

  if (path === "/api/conversations" && method === "POST") {
    const other = String(body.userId || "");
    if (!other) fail(400, "Pick someone to message.");
    await messageGate(db, uid, other);
    const cid = `c_${pairId(uid, other)}`;
    const existing = await one(db, "SELECT id FROM conversations WHERE id = ?", cid);
    if (!existing) {
      await run(
        db,
        "INSERT INTO conversations (id, members_json, last_message, last_message_at, unread_json, created_at) VALUES (?, ?, NULL, NULL, ?, ?)",
        cid,
        JSON.stringify([uid, other]),
        JSON.stringify({ [uid]: 0, [other]: 0 }),
        nowIso(),
      );
    }
    await run(db, "INSERT OR IGNORE INTO conversation_members (conv_id, user_id) VALUES (?, ?)", cid, uid);
    await run(db, "INSERT OR IGNORE INTO conversation_members (conv_id, user_id) VALUES (?, ?)", cid, other);
    return json({ conversation: { id: cid } });
  }

  const msgs = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgs) {
    const cid = msgs[1]!;
    const conv = await one<{ members_json: string; unread_json: string }>(
      db,
      "SELECT members_json, unread_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    if (method === "GET") {
      const unread = parseJson<Record<string, number>>(conv.unread_json, {});
      unread[uid] = 0;
      const full = await one<{ read_json?: string | null }>(
        db,
        "SELECT read_json FROM conversations WHERE id = ?",
        cid,
      );
      const readMap = parseJson<Record<string, string>>(full?.read_json ?? "{}", {});
      readMap[uid] = nowIso();
      await run(
        db,
        "UPDATE conversations SET unread_json = ?, read_json = ? WHERE id = ?",
        JSON.stringify(unread),
        JSON.stringify(readMap),
        cid,
      );
      const items = await all<{
        id: string;
        sender_id: string;
        body: string;
        img?: string | null;
        reaction?: string | null;
        created_at: string;
      }>(
        db,
        `SELECT id, sender_id, body, reaction, created_at,
          CASE
            WHEN image_url IS NULL OR image_url = '' THEN NULL
            WHEN image_url LIKE 'call:%' THEN image_url
            WHEN image_url LIKE 'sticker:%' THEN image_url
            ELSE 'img'
          END AS img
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200`,
        cid,
      );
      const otherId = members.find((m) => m !== uid);
      return json({
        otherReadAt: otherId ? (readMap[otherId] ?? null) : null,
        items: items.map((row) => {
          const media = parseMessageMedia(row.img && row.img !== "img" ? row.img : null);
          const hasImage = row.img === "img";
          return {
            id: row.id,
            senderId: row.sender_id,
            body: row.body,
            hasImage,
            imageUrl: hasImage ? "inline" : null,
            imageUrls: hasImage ? ["inline"] : [],
            sticker: media.sticker || undefined,
            call: media.call || undefined,
            reaction: row.reaction || undefined,
            createdAt: row.created_at,
          };
        }),
      });
    }
    const text = String(body.body || "").trim();
    const otherMember = members.find((m) => m !== uid);
    if (otherMember) await messageGate(db, uid, otherMember);
    const rawImages = Array.isArray(body.imageData)
      ? body.imageData
      : body.imageData
        ? [body.imageData]
        : [];
    const images = rawImages
      .filter((item): item is string => typeof item === "string" && item.startsWith("data:"))
      .slice(0, 4);
    if (images.some((item) => item.length > 450000)) {
      fail(400, "Photo is too large. Pick a smaller image.");
    }
    const sticker =
      typeof body.sticker === "string" && body.sticker.trim()
        ? body.sticker.trim().slice(0, 16)
        : null;
    if (!text && !images.length && !sticker) fail(400, "Write a message.");
    const mid = id();
    const created = nowIso();
    const preview = text.slice(0, 2000) || sticker || "Photo";
    const stored = sticker
      ? `sticker:${sticker}`
      : images.length === 1
        ? images[0]!
        : images.length
          ? JSON.stringify(images)
          : null;
    await run(
      db,
      "INSERT INTO messages (id, conversation_id, sender_id, body, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      mid,
      cid,
      uid,
      text.slice(0, 2000),
      stored,
      created,
    );
    const unread = parseJson<Record<string, number>>(conv.unread_json, {});
    unread[uid] = 0;
    const other = members.find((m) => m !== uid);
    if (other) unread[other] = Number(unread[other] || 0) + 1;
    await run(
      db,
      "UPDATE conversations SET last_message = ?, last_message_at = ?, unread_json = ? WHERE id = ?",
      preview,
      created,
      JSON.stringify(unread),
      cid,
    );
    return json(
      {
        message: {
          id: mid,
          senderId: uid,
          body: text.slice(0, 2000),
          hasImage: images.length > 0,
          imageUrl: images.length ? "inline" : null,
          imageUrls: images.length ? ["inline"] : [],
          sticker,
          createdAt: created,
        },
      },
      201,
    );
  }

  const msgImage = path.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/image$/);
  if (msgImage && method === "GET") {
    const cid = msgImage[1]!;
    const mid = msgImage[2]!;
    const conv = await one<{ members_json: string }>(
      db,
      "SELECT members_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    const row = await one<{ image_url?: string | null }>(
      db,
      "SELECT image_url FROM messages WHERE id = ? AND conversation_id = ?",
      mid,
      cid,
    );
    const media = parseMessageMedia(row?.image_url ?? null);
    if (!media.imageUrls.length) fail(404, "Photo not found.");
    return json({ imageUrl: media.imageUrls[0], imageUrls: media.imageUrls });
  }

  const reactMsg = path.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/react$/);
  if (reactMsg && method === "POST") {
    const cid = reactMsg[1]!;
    const mid = reactMsg[2]!;
    const conv = await one<{ members_json: string }>(
      db,
      "SELECT members_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    const emoji = String(body.emoji || "")
      .trim()
      .slice(0, 8);
    if (!emoji) fail(400, "Pick a reaction.");
    await run(
      db,
      "UPDATE messages SET reaction = ? WHERE id = ? AND conversation_id = ?",
      emoji,
      mid,
      cid,
    );
    return json({ ok: true, reaction: emoji });
  }

  const convMute = path.match(/^\/api\/conversations\/([^/]+)\/mute$/);
  if (convMute && method === "POST") {
    const cid = convMute[1]!;
    const conv = await one<{ members_json: string; muted_json?: string | null }>(
      db,
      "SELECT members_json, muted_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    const mutedMap = parseJson<Record<string, boolean>>(conv.muted_json ?? "{}", {});
    mutedMap[uid] = body.muted !== false;
    await run(
      db,
      "UPDATE conversations SET muted_json = ? WHERE id = ?",
      JSON.stringify(mutedMap),
      cid,
    );
    return json({ ok: true, muted: mutedMap[uid] });
  }

  const convClear = path.match(/^\/api\/conversations\/([^/]+)\/clear$/);
  if (convClear && method === "POST") {
    const cid = convClear[1]!;
    const conv = await one<{ members_json: string }>(
      db,
      "SELECT members_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    await run(db, "DELETE FROM messages WHERE conversation_id = ?", cid);
    await run(
      db,
      "UPDATE conversations SET last_message = NULL, last_message_at = NULL WHERE id = ?",
      cid,
    );
    return json({ ok: true });
  }

  const convDel = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (convDel && method === "DELETE") {
    const cid = convDel[1]!;
    const conv = await one<{ members_json: string; hidden_json?: string | null }>(
      db,
      "SELECT members_json, hidden_json FROM conversations WHERE id = ?",
      cid,
    );
    if (!conv) fail(404, "Conversation not found.");
    const members = parseJson<string[]>(conv.members_json, []);
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    const hiddenMap = parseJson<Record<string, boolean>>(conv.hidden_json ?? "{}", {});
    hiddenMap[uid] = true;
    await run(
      db,
      "UPDATE conversations SET hidden_json = ? WHERE id = ?",
      JSON.stringify(hiddenMap),
      cid,
    );
    return json({ ok: true });
  }

  if (path === "/api/calls/clear" && method === "POST") {
    const rows = await all<{ id: string; callee_id: string; kind: string }>(
      db,
      "SELECT id, callee_id, kind FROM calls WHERE caller_id = ? AND status = 'RINGING'",
      uid,
    );
    for (const row of rows) {
      await run(db, "UPDATE calls SET status = 'ENDED' WHERE id = ?", row.id);
      await logCallEvent(db, uid, row.callee_id, row.kind, "MISSED", 0);
    }
    return json({ ok: true });
  }

  if (path === "/api/calls" && method === "POST") {
    const other = String(body.userId || "");
    const kind = body.kind === "VIDEO" ? "VIDEO" : "AUDIO";
    await messageGate(db, uid, other, "call");
    const callId = id();
    await run(
      db,
      "INSERT INTO calls (id, caller_id, callee_id, kind, status, offer_sdp, answer_sdp, created_at) VALUES (?, ?, ?, ?, 'RINGING', ?, NULL, ?)",
      callId,
      uid,
      other,
      kind,
      body.offerSdp ?? null,
      nowIso(),
    );
    const otherUser = (await userPublic(db, other, uid)) ?? {
      userId: other,
      displayName: "Player",
      username: "player",
      avatarUrl: null,
      bio: null,
      country: null,
      district: null,
      approximateArea: null,
      ffUid: null,
      ffIgn: null,
      serverRegion: null,
      level: null,
      rank: null,
      preferredModes: [],
      playStyle: null,
      languages: [],
      availability: [],
      micPreference: null,
      relationshipStatus: null,
      facebookId: null,
      instagram: null,
      whatsapp: null,
      verifiedFf: false,
      verifiedIdentity: false,
      reputation: 0,
      lastActiveAt: nowIso(),
      online: false,
    };
    if (other) await ensureConv(db, uid, other);
    return json({
      call: {
        id: callId,
        kind,
        status: "RINGING",
        callerId: uid,
        calleeId: other,
        offerSdp: body.offerSdp ?? null,
        answerSdp: null,
        incoming: false,
        other: otherUser,
      },
    });
  }

  if (path === "/api/calls/active") {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const stale = await all<{ id: string; caller_id: string; callee_id: string; kind: string }>(
      db,
      "SELECT id, caller_id, callee_id, kind FROM calls WHERE status = 'RINGING' AND created_at < ?",
      cutoff,
    );
    for (const row of stale) {
      await logCallEvent(db, row.caller_id, row.callee_id, row.kind, "MISSED", 0);
      await run(db, "UPDATE calls SET status = 'MISSED' WHERE id = ?", row.id);
    }
    const rows = await all<{
      id: string;
      caller_id: string;
      callee_id: string;
      kind: string;
      status: string;
      offer_sdp: string | null;
      answer_sdp: string | null;
    }>(
      db,
      "SELECT * FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status IN ('RINGING', 'ACTIVE')",
      uid,
      uid,
    );
    const items = [];
    for (const row of rows) {
      const otherId = row.caller_id === uid ? row.callee_id : row.caller_id;
      const other = await userPublic(db, otherId, uid);
      if (!other) continue;
      items.push({
        id: row.id,
        kind: row.kind === "VIDEO" ? "VIDEO" : "AUDIO",
        status: row.status,
        callerId: row.caller_id,
        calleeId: row.callee_id,
        offerSdp: row.offer_sdp,
        answerSdp: row.answer_sdp,
        incoming: row.callee_id === uid,
        other,
      });
    }
    return json({ items });
  }

  const ice = path.match(/^\/api\/calls\/([^/]+)\/ice$/);
  if (ice) {
    const callId = ice[1]!;
    if (method === "POST") {
      await run(
        db,
        "INSERT INTO call_ice (id, call_id, from_id, candidate_json, created_at) VALUES (?, ?, ?, ?, ?)",
        id(),
        callId,
        uid,
        JSON.stringify(body.candidate ?? null),
        nowIso(),
      );
      return json({ ok: true });
    }
    const rows = await all<{ id: string; from_id: string; candidate_json: string }>(
      db,
      "SELECT * FROM call_ice WHERE call_id = ?",
      callId,
    );
    return json({
      items: rows
        .filter((row) => row.from_id !== uid)
        .map((row) => ({ id: row.id, candidate: parseJson(row.candidate_json, null) })),
    });
  }

  const callAct = path.match(/^\/api\/calls\/([^/]+)\/(answer|hangup|decline)$/);
  if (callAct && method === "POST") {
    const callId = callAct[1]!;
    const verb = callAct[2];
    const prev = await one<{
      caller_id: string;
      callee_id: string;
      kind: string;
      status: string;
    }>(db, "SELECT caller_id, callee_id, kind, status FROM calls WHERE id = ?", callId);
    if (verb === "answer") {
      await run(
        db,
        "UPDATE calls SET status = 'ACTIVE', answer_sdp = ? WHERE id = ?",
        body.answerSdp ?? null,
        callId,
      );
    } else if (verb === "decline") {
      await run(db, "UPDATE calls SET status = 'DECLINED' WHERE id = ?", callId);
      if (prev) await logCallEvent(db, prev.caller_id, prev.callee_id, prev.kind, "DECLINED", 0);
    } else {
      await run(db, "UPDATE calls SET status = 'ENDED' WHERE id = ?", callId);
      if (prev) {
        await logCallEvent(
          db,
          prev.caller_id,
          prev.callee_id,
          prev.kind,
          prev.status === "ACTIVE" ? "ENDED" : "MISSED",
          Number(body.seconds || 0),
        );
      }
    }
    const row = await one<{
      caller_id: string;
      callee_id: string;
      kind: string;
      status: string;
      offer_sdp: string | null;
      answer_sdp: string | null;
    }>(db, "SELECT * FROM calls WHERE id = ?", callId);
    if (!row) fail(404, "Call not found.");
    const otherId = row.caller_id === uid ? row.callee_id : row.caller_id;
    return json({
      call: {
        id: callId,
        kind: row.kind === "VIDEO" ? "VIDEO" : "AUDIO",
        status: row.status,
        callerId: row.caller_id,
        calleeId: row.callee_id,
        offerSdp: row.offer_sdp,
        answerSdp: row.answer_sdp,
        incoming: row.callee_id === uid,
        other: (await userPublic(db, otherId, uid)) ?? {
          userId: otherId,
          displayName: "Player",
          username: "player",
          avatarUrl: null,
          bio: null,
          country: null,
          district: null,
          approximateArea: null,
          ffUid: null,
          ffIgn: null,
          serverRegion: null,
          level: null,
          rank: null,
          preferredModes: [],
          playStyle: null,
          languages: [],
          availability: [],
          micPreference: null,
          relationshipStatus: null,
          facebookId: null,
          instagram: null,
          whatsapp: null,
          verifiedFf: false,
          verifiedIdentity: false,
          reputation: 0,
          lastActiveAt: nowIso(),
          online: false,
        },
      },
    });
  }

  if (path === "/api/notifications" && method === "GET") {
    const rows = await all<{
      id: string;
      title: string;
      body: string;
      link: string | null;
      kind?: string | null;
      read_at: string | null;
      created_at: string;
    }>(db, "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", uid);
    const items = rows
      .filter((row) => {
        const kind = row.kind ?? "";
        const title = (row.title ?? "").toLowerCase();
        const link = row.link ?? "";
        if (kind === "calls" || kind === "messaging") return false;
        if (title.includes("incoming call") || title.includes("incoming video")) return false;
        if (title === "friend request" || title === "request accepted") return false;
        if (link.startsWith("/messages/")) return false;
        return true;
      })
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        link: row.link ?? undefined,
        kind: row.kind ?? undefined,
        readAt: row.read_at,
        createdAt: row.created_at,
      }));
    return json({ items, unread: items.filter((item) => !item.readAt).length });
  }
  if (path === "/api/notifications/read" && method === "POST") {
    await run(
      db,
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
      nowIso(),
      uid,
    );
    return json({ ok: true });
  }

  if (path === "/api/store/products") {
    const category = search.get("category");
    const items = STORE_CATALOG.filter((item) => !category || item.category === category);
    return json({ items });
  }
  if (path === "/api/store/orders" && method === "GET") {
    const rows = await all<{ id: string; created_at: string; product_json: string }>(
      db,
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      uid,
    );
    return json({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        product: parseJson(row.product_json, {}),
      })),
    });
  }
  if (path === "/api/store/orders" && method === "POST") {
    const product = STORE_CATALOG.find((item) => item.id === body.productId);
    if (!product) fail(404, "Item not found.");
    if (me.wallet_balance < product.priceCoins)
      fail(400, "Not enough coins. Claim the daily reward or add funds later.");
    const invId = id();
    await run(
      db,
      "INSERT INTO inventory (id, user_id, product_id, product_json, equipped, giftable, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      invId,
      uid,
      product.id,
      JSON.stringify(product),
      product.giftable !== false ? 1 : 0,
      nowIso(),
    );
    await run(
      db,
      "INSERT INTO orders (id, user_id, product_json, created_at) VALUES (?, ?, ?, ?)",
      id(),
      uid,
      JSON.stringify(product),
      nowIso(),
    );
    await run(
      db,
      "INSERT INTO ledger (id, user_id, type, amount, source, created_at) VALUES (?, ?, 'DEBIT', ?, 'store', ?)",
      id(),
      uid,
      -product.priceCoins,
      nowIso(),
    );
    await run(
      db,
      "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?",
      product.priceCoins,
      uid,
    );
    return json({ order: { id: invId } });
  }
  if (path === "/api/inventory") {
    const rows = await all<{
      id: string;
      equipped: number;
      giftable: number;
      product_json: string;
    }>(db, "SELECT * FROM inventory WHERE user_id = ?", uid);
    return json({
      items: rows.map((row) => ({
        id: row.id,
        equipped: Boolean(row.equipped),
        giftable: Boolean(row.giftable),
        product: parseJson(row.product_json, {}),
      })),
    });
  }
  const equip = path.match(/^\/api\/inventory\/([^/]+)\/(equip|unequip)$/);
  if (equip && method === "POST") {
    await run(
      db,
      "UPDATE inventory SET equipped = ? WHERE id = ? AND user_id = ?",
      equip[2] === "equip" ? 1 : 0,
      equip[1],
      uid,
    );
    return json({ ok: true });
  }
  if (path === "/api/gifts" && method === "POST") {
    const invId = String(body.inventoryId || "");
    const receiverId = String(body.receiverId || "");
    const inv = await one<{ giftable: number; product_json: string; product_id: string }>(
      db,
      "SELECT * FROM inventory WHERE id = ? AND user_id = ?",
      invId,
      uid,
    );
    if (!inv || !inv.giftable) fail(400, "That item cannot be gifted.");
    await run(
      db,
      "INSERT INTO inventory (id, user_id, product_id, product_json, equipped, giftable, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)",
      id(),
      receiverId,
      inv.product_id,
      inv.product_json,
      nowIso(),
    );
    await run(db, "DELETE FROM inventory WHERE id = ?", invId);
    await notify(
      db,
      receiverId,
      "Gift received",
      "Someone sent you a store item.",
      "/inventory",
      "gifting",
    );
    return json({ ok: true });
  }

  if (path === "/api/payments/packages") return json({ items: COIN_PACKS });
  if (path === "/api/wallet/topup" && method === "POST") {
    const pack = COIN_PACKS.find((item) => item.id === body.packageId);
    if (!pack) fail(404, "Pack not found.");
    await run(
      db,
      "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
      pack.coins,
      uid,
    );
    await run(
      db,
      "INSERT INTO ledger (id, user_id, type, amount, source, created_at) VALUES (?, ?, 'CREDIT', ?, 'topup', ?)",
      id(),
      uid,
      pack.coins,
      nowIso(),
    );
    return json({ ok: true, coins: pack.coins });
  }
  if (path === "/api/payments/orders") {
    if (method === "POST") {
      const pack = COIN_PACKS.find((item) => item.id === body.packageId);
      if (!pack) fail(404, "Pack not found.");
      await run(
        db,
        "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
        pack.coins,
        uid,
      );
      await run(
        db,
        "INSERT INTO ledger (id, user_id, type, amount, source, created_at) VALUES (?, ?, 'CREDIT', ?, 'topup', ?)",
        id(),
        uid,
        pack.coins,
        nowIso(),
      );
      return json({ order: { id: pack.id, checkoutUrl: "/wallet" } });
    }
    return json({ items: [] });
  }
  if (path === "/api/wallet/transactions") {
    const rows = await all<{
      id: string;
      type: string;
      amount: number;
      source: string;
      created_at: string;
    }>(db, "SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 40", uid);
    return json({
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        source: row.source,
        createdAt: row.created_at,
      })),
    });
  }
  if (path === "/api/wallet/referrals") return json({ items: [] });
  if (path === "/api/wallet/daily-reward" && method === "POST") {
    const today = new Date().toISOString().slice(0, 10);
    if (me.last_daily_reward === today) fail(400, "Daily reward already claimed today.");
    await run(
      db,
      "UPDATE users SET wallet_balance = wallet_balance + 20, last_daily_reward = ? WHERE id = ?",
      today,
      uid,
    );
    await run(
      db,
      "INSERT INTO ledger (id, user_id, type, amount, source, created_at) VALUES (?, ?, 'CREDIT', 20, 'daily', ?)",
      id(),
      uid,
      nowIso(),
    );
    return json({ ok: true });
  }

  if (path === "/api/auth/logout-all" && method === "POST") {
    await run(db, "DELETE FROM sessions WHERE user_id = ?", uid);
    return json({ ok: true });
  }
  if (path === "/api/auth/verify-email/resend" && method === "POST") return json({ ok: true });
  if (path === "/api/account" && method === "DELETE") {
    await run(
      db,
      "UPDATE users SET status = 'DELETED', display_name = 'Deleted player' WHERE id = ?",
      uid,
    );
    await run(db, "DELETE FROM sessions WHERE user_id = ?", uid);
    return json({ ok: true });
  }
  if (path === "/api/dev/mailbox") return json({ items: [] });
  if (path.startsWith("/api/admin")) fail(403, "Admin tools need the server.");

  fail(404, "Not found.");
}
