// Avatar payload contract (regression guard for the "profile photo never loads
// in the chat list / Calls tab, and reloads every time in the chat box" bug).
//
// The client resolves an avatar in exactly two ways: an inline `avatarUrl`
// (full payloads) or a `GET /api/users/:id/avatar` fetch keyed by `avatarRef`
// (light payloads). That contract is all the renderer has, and it broke the day
// the hot endpoints went light, because org.json's optString() turns a JSON null
// into the STRING "null" — non-blank, so `avatarUrl: null` was read as a URL and
// the avatarRef lookup was skipped entirely. These assertions pin the shape the
// client parses, so a payload that renames, stringifies or drops either field
// fails here instead of showing up as a missing photo on a phone.
//
// Also guards the flip side: a user with NO photo must send null for BOTH fields,
// otherwise the app fires a pointless avatar request per row.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;

let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG_ALT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function mk() {
  const worker = await freshWorker();
  const env = { DB: makeD1(), MEDIA: makeR2() };
  const ctx = makeCtx();
  let ipSeq = 0;
  const call = async (method, path, body, token, extraHeaders = {}) => {
    const headers = { "content-type": "application/json", ...extraHeaders };
    // Auth routes are rate limited per client IP; give each register its own.
    if (path.startsWith("/api/auth/register"))
      headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const text = await res.text();
    await ctx.drain();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text.slice(0, 80) };
    }
    return { status: res.status, json, headers: res.headers, text };
  };
  const reg = async (email, username) => {
    const r = await call("POST", "/api/auth/register", {
      email,
      password: "secret123",
      username,
      displayName: username,
    });
    if (!r.json.user)
      throw new Error(`register ${username} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  /** Open a 1:1 chat and leave one message so the row is in the list at all. */
  const openChat = async (me) => {
    const c = await call("POST", "/api/conversations", { userId: me.peerId }, me.token);
    const convId = c.json.conversation.id;
    await call(
      "POST",
      `/api/conversations/${convId}/messages`,
      { kind: "TEXT", body: "hi" },
      me.token,
    );
    return convId;
  };
  return { call, reg, openChat, env, ctx };
}

/** The exact bug this file guards: a JSON null read through optString() comes
 * back as the text "null", which is not blank, so `if (url.isNullOrBlank())`
 * style checks treat it as a URL and the avatarRef lookup never runs. */

async function main() {
  /* ─────────── 1. peer HAS a photo: light rows must carry the ref ─────────── */
  {
    const k = await mk();
    const me = await k.reg("a@a.com", "alice");
    const peer = await k.reg("b@b.com", "bob");
    await k.call("PATCH", "/api/me", { avatarUrl: PNG_1x1 }, peer.token);

    const convId = await k.openChat({ ...me, peerId: peer.user.id });

    const list = await k.call("GET", "/api/conversations", undefined, me.token);
    const row = (list.json.items ?? []).find((c) => c.id === convId);
    const other = row?.other ?? {};
    check(
      'chat list: light row sends avatarUrl as JSON null, never the string "null"',
      other.avatarUrl === null,
      JSON.stringify(other.avatarUrl),
    );
    check(
      "chat list: avatarRef is <userId>@v<n> so the client can fetch + cache it",
      other.avatarRef === `${peer.user.id}@v1`,
      other.avatarRef,
    );

    const one = await k.call("GET", `/api/conversations/${convId}`, undefined, me.token);
    const full = one.json.conversation?.other ?? {};
    check(
      "chat box: opened conversation still inlines the data-URI (old APKs keep working)",
      typeof full.avatarUrl === "string" && full.avatarUrl.startsWith("data:"),
    );
    check(
      "chat box: the full shape ALSO carries the ref, so the client can key its cache",
      full.avatarRef === `${peer.user.id}@v1`,
      full.avatarRef,
    );

    const meSelf = await k.call("GET", "/api/me", undefined, me.token);
    check(
      "/api/me: own avatar exposes the ref too (self row resolves from cache)",
      "avatarRef" in (meSelf.json.user ?? {}),
    );

    /* the ref endpoint the client hits once per avatar version */
    const av = await k.call("GET", `/api/users/${peer.user.id}/avatar`, undefined, me.token);
    check("avatar endpoint: 200 for a light-row ref", av.status === 200, `status ${av.status}`);
    check(
      "avatar endpoint: returns the data-URI plus the same ref",
      av.json.avatarUrl?.startsWith("data:") && av.json.avatarRef === other.avatarRef,
    );
    check(
      "avatar endpoint: cacheable response (long private max-age) so it is not refetched per open",
      /max-age=\d{4,}/.test(av.headers.get("cache-control") ?? ""),
      av.headers.get("cache-control"),
    );
    const etag = av.headers.get("etag");
    const reval = await k.call("GET", `/api/users/${peer.user.id}/avatar`, undefined, me.token, {
      "if-none-match": etag ?? "",
    });
    check(
      "avatar endpoint: honours If-None-Match with 304 (zero bytes on revalidation)",
      reval.status === 304,
      `status ${reval.status}`,
    );

    /* photo changes => ref changes => no stale avatar pinned in the cache */
    await k.call("PATCH", "/api/me", { avatarUrl: PNG_ALT }, peer.token);
    const list2 = await k.call("GET", "/api/conversations", undefined, me.token);
    const ref2 = (list2.json.items ?? []).find((c) => c.id === convId)?.other?.avatarRef;
    check(
      "avatar_version bump: new photo yields a new ref (v1 -> v2)",
      ref2 === `${peer.user.id}@v2`,
      ref2,
    );
    const av2 = await k.call("GET", `/api/users/${peer.user.id}/avatar`, undefined, me.token);
    check(
      "avatar bump: the endpoint serves the new bytes under the new ref",
      av2.json.avatarRef === ref2,
    );
    const avOld = await k.call("GET", `/api/users/${peer.user.id}/avatar`, undefined, me.token, {
      "if-none-match": etag ?? "",
    });
    check(
      "avatar bump: the stale ETag no longer matches (client must not keep the old photo)",
      avOld.status === 200,
      `status ${avOld.status}`,
    );

    /* Calls tab: history rows are light too, and that is what its rows parse */
    const place = await k.call(
      "POST",
      "/api/calls",
      { userId: peer.user.id, kind: "AUDIO", offerSdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" },
      me.token,
    );
    const callId = place.json.call?.id ?? place.json.id;
    await k.call("POST", `/api/calls/${callId}/end`, {}, me.token);
    const hist = await k.call("GET", "/api/calls/history", undefined, me.token);
    const hrow = (hist.json.items ?? [])[0];
    check(
      "call history: row carries the peer with a light avatar pair (null url + ref)",
      hrow?.other?.avatarUrl === null && typeof hrow?.other?.avatarRef === "string",
      JSON.stringify({ url: hrow?.other?.avatarUrl, ref: hrow?.other?.avatarRef }),
    );
    check(
      "call history: /api/calls/active stays FULL so the in-call avatar needs no extra fetch",
      await (async () => {
        const act = await k.call(
          "POST",
          "/api/calls",
          { userId: peer.user.id, kind: "AUDIO", offerSdp: "v=0\r\no=- 2 1 IN IP4 127.0.0.1\r\n" },
          me.token,
        );
        const got = await k.call("GET", "/api/calls/active", undefined, me.token);
        const o = (got.json.items ?? [])[0]?.other;
        return typeof o?.avatarUrl === "string" && o.avatarUrl.startsWith("data:");
      })(),
    );
  }

  /* ─────────── 2. peer has NO photo: nothing must be requested ─────────── */
  {
    const k = await mk();
    const me = await k.reg("c@c.com", "carol");
    const peer = await k.reg("d@d.com", "dave");
    const convId = await k.openChat({ ...me, peerId: peer.user.id });
    const list = await k.call("GET", "/api/conversations", undefined, me.token);
    const other = (list.json.items ?? []).find((c) => c.id === convId)?.other ?? {};
    check(
      "no photo: avatarUrl AND avatarRef are both JSON null (placeholder, no request)",
      other.avatarUrl === null && other.avatarRef === null,
      JSON.stringify({ url: other.avatarUrl, ref: other.avatarRef }),
    );
    const av = await k.call("GET", `/api/users/${peer.user.id}/avatar`, undefined, me.token);
    check(
      "no photo: avatar endpoint answers 200 with nulls rather than an error (a 404 would look like a broken image)",
      av.status === 200 && av.json.avatarUrl === null,
      `status ${av.status}`,
    );
  }

  /* ─────────── 3. sweep: no avatar field is ever the literal string "null" ─────────── */
  {
    const k = await mk();
    const me = await k.reg("e@e.com", "erin");
    const peer = await k.reg("f@f.com", "freda");
    const convId = await k.openChat({ ...me, peerId: peer.user.id });
    const payloads = await Promise.all([
      k.call("GET", "/api/conversations", undefined, me.token),
      k.call("GET", `/api/conversations/${convId}`, undefined, me.token),
      k.call("GET", "/api/users?limit=10", undefined, me.token),
      k.call("GET", "/api/search?q=freda", undefined, me.token),
    ]);
    const bad = [];
    const walk = (node, where) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (/^avatar(Url|Ref)?$/i.test(key) && value === "null") bad.push(`${where}.${key}`);
        walk(value, `${where}.${key}`);
      }
    };
    payloads.forEach((p, i) => walk(p?.json, `payload${i}`));
    check(
      'sweep: no API payload sends the string "null" in an avatar field (the optString trap)',
      bad.length === 0,
      bad.join(", "),
    );
    // Every list-shaped endpoint the app renders avatars from has to stay light
    // but ref-bearing, otherwise those screens have nothing to resolve.
    for (const [label, rows] of [
      ["users", payloads[2].json.users ?? []],
      ["search.users", payloads[3].json.users ?? []],
    ]) {
      const okShape = rows.every(
        (r) =>
          r.avatarUrl === null &&
          (r.avatarRef === null || (typeof r.avatarRef === "string" && r.avatarRef.includes("@v"))),
      );
      check(
        `${label}: rows stay light (avatarUrl null) and avatarRef is null or <id>@v<n>`,
        okShape,
        JSON.stringify(rows[0] ?? {}),
      );
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
