import type { Page, Route } from "@playwright/test";
import {
  ME,
  PEER_ID,
  PEER_NAME,
  generateTestIdentity,
  makePng,
  plaintextBackupBlob,
  signIn,
  type TestIdentity,
} from "../e2e-messaging/helpers";

/**
 * A mocked Worker for the status surfaces (slice F).
 *
 * It serves the six status routes the real Worker has, records every request
 * that reaches it, and answers a reply the way the messaging routes do — so the
 * browser tests can assert what was ASKED FOR (a view ping, one reaction, a
 * sealed reply with `meta.status`) and not merely what was painted.
 *
 * The session and the identity come from the messaging helpers: one source of
 * truth for `kp.token`, `kp.e2ee` and the KP1 maths, so a status reply is
 * sealed with exactly the keys the chat tests use.
 */

export { ME, PEER_ID, PEER_NAME, openFrom, signIn } from "../e2e-messaging/helpers";

/** Status ids are UUIDs server-side, and the client's path guard says so. */
export const MINE_TEXT_ID = "11111111-1111-4111-8111-111111111111";
export const MINE_PHOTO_ID = "22222222-2222-4222-8222-222222222222";
export const PEER_TEXT_ID = "33333333-3333-4333-8333-333333333333";
export const PEER_PHOTO_ID = "44444444-4444-4444-8444-444444444444";
export const PEER_VIDEO_ID = "55555555-5555-4555-8555-555555555555";
export const SEEN_TEXT_ID = "66666666-6666-4666-8666-666666666666";
export const HIDDEN_TEXT_ID = "77777777-7777-4777-8777-777777777777";

export const SEEN_ID = "u_seen";
export const SEEN_NAME = "Nila";
export const HIDDEN_AUTHOR_ID = "u_hidden";
export const HIDDEN_AUTHOR_NAME = "Hidden Person";
export const CHAT_ID = "c_direct";

export const MINE_TEXT = "আজকের প্রথম স্ট্যাটাস";
export const PEER_TEXT = "Rahi's text status";

/** A tiny PNG stands in for a photo status; a clip's bytes need not decode. */
const PHOTO_BYTES = makePng(240, 320, [240, 180, 60]);
const CLIP_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

export type MockStatusWorker = {
  install: (page: Page) => Promise<void>;
  /** POST /api/statuses bodies, in order. */
  posts: Record<string, unknown>[];
  /** Status ids whose bytes were fetched from /api/statuses/:id/media. */
  mediaFetches: string[];
  mediaAuthHeaders: string[];
  /** Status ids reported through POST /api/statuses/:id/view. */
  views: string[];
  reactions: { id: string; emoji: string }[];
  viewersCalls: string[];
  deletes: string[];
  /** POST /api/conversations {userId} — what a reply opens first. */
  conversationPosts: string[];
  conversationReads: string[];
  messages: { conversationId: string; body: Record<string, unknown> }[];
  uploads: { name: string; type: string; bytes: Uint8Array }[];
  /** The peer's identity, so a test can open a sealed reply itself. */
  peer: TestIdentity;
  /** The identity this browser adopts from its backup. */
  me: TestIdentity;
};

export type MockStatusOptions = {
  /** Drop the "already viewed" contact, to test a feed without a gray ring. */
  withoutSeen?: boolean;
  /** Drop my own statuses, to test the empty-feed invitation. */
  withoutMine?: boolean;
  /** Serve a 500 on the feed, to test the error state. */
  feedFails?: boolean;
  /** Refuse a status's media, to test the honest failure line. */
  mediaFails?: boolean;
};

export async function createMockStatusWorker(
  options: MockStatusOptions = {},
): Promise<MockStatusWorker> {
  const me = await generateTestIdentity();
  const peer = await generateTestIdentity();
  const seen = await generateTestIdentity();
  const hidden = await generateTestIdentity();

  const now = Date.now();
  const iso = (agoMs: number) => new Date(now - agoMs).toISOString();
  const expires = (agoMs: number) => new Date(now - agoMs + 86_400_000).toISOString();

  /** The feed's rows, mutable so a delete really removes one. */
  const rows = new Map<string, Record<string, unknown>>(
    [
      [
        MINE_TEXT_ID,
        {
          id: MINE_TEXT_ID,
          kind: "TEXT",
          text: MINE_TEXT,
          bgStyle: "ink",
          hasMedia: false,
          seconds: 0,
          createdAt: iso(3 * 60_000),
          expiresAt: expires(3 * 60_000),
        },
      ],
      [
        MINE_PHOTO_ID,
        {
          id: MINE_PHOTO_ID,
          kind: "IMAGE",
          text: "",
          bgStyle: "amber",
          hasMedia: true,
          seconds: 0,
          createdAt: iso(2 * 60_000),
          expiresAt: expires(2 * 60_000),
        },
      ],
      [
        PEER_TEXT_ID,
        {
          id: PEER_TEXT_ID,
          kind: "TEXT",
          text: PEER_TEXT,
          bgStyle: "ocean",
          hasMedia: false,
          seconds: 0,
          createdAt: iso(9 * 60_000),
          expiresAt: expires(9 * 60_000),
        },
      ],
      [
        PEER_PHOTO_ID,
        {
          id: PEER_PHOTO_ID,
          kind: "IMAGE",
          text: "",
          bgStyle: "amber",
          hasMedia: true,
          seconds: 0,
          createdAt: iso(8 * 60_000),
          expiresAt: expires(8 * 60_000),
        },
      ],
      [
        PEER_VIDEO_ID,
        {
          id: PEER_VIDEO_ID,
          kind: "VIDEO",
          text: "",
          bgStyle: "amber",
          hasMedia: true,
          seconds: 4,
          createdAt: iso(7 * 60_000),
          expiresAt: expires(7 * 60_000),
        },
      ],
      [
        SEEN_TEXT_ID,
        {
          id: SEEN_TEXT_ID,
          kind: "TEXT",
          text: "Already seen",
          bgStyle: "mint",
          hasMedia: false,
          seconds: 0,
          createdAt: iso(30 * 60_000),
          expiresAt: expires(30 * 60_000),
        },
      ],
      [
        HIDDEN_TEXT_ID,
        {
          id: HIDDEN_TEXT_ID,
          kind: "TEXT",
          text: "From somebody you hid",
          bgStyle: "berry",
          hasMedia: false,
          seconds: 0,
          createdAt: iso(20 * 60_000),
          expiresAt: expires(20 * 60_000),
        },
      ],
    ].map(([id, row]) => [id as string, row as Record<string, unknown>]),
  );

  const authorOf = new Map<string, string>([
    [MINE_TEXT_ID, ME.id],
    [MINE_PHOTO_ID, ME.id],
    [PEER_TEXT_ID, PEER_ID],
    [PEER_PHOTO_ID, PEER_ID],
    [PEER_VIDEO_ID, PEER_ID],
    [SEEN_TEXT_ID, SEEN_ID],
    [HIDDEN_TEXT_ID, HIDDEN_AUTHOR_ID],
  ]);

  const viewersByStatus = new Map<string, number>([[MINE_PHOTO_ID, 3]]);
  const viewedByMe = new Set<string>([SEEN_TEXT_ID]);
  const reactions = new Map<string, string>();

  const userShape = (
    id: string,
    displayName: string,
    username: string,
    key: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    username,
    displayName,
    about: null,
    online: false,
    lastActiveAt: null,
    verified: false,
    moderator: false,
    badge: null,
    e2eePublicKey: key,
    privateProfile: false,
    phone: null,
    avatarUrl: null,
    avatarRef: null,
    ...extra,
  });

  const feedPayload = () => {
    const groups = new Map<
      string,
      { user: Record<string, unknown>; mine: boolean; statuses: Record<string, unknown>[] }
    >();
    for (const [id, row] of rows) {
      const authorId = authorOf.get(id) ?? "";
      const mine = authorId === ME.id;
      const existing = groups.get(authorId);
      if (existing) {
        existing.statuses.push(row);
        continue;
      }
      groups.set(authorId, {
        user: mine
          ? userShape(ME.id, ME.displayName, ME.username, me.u)
          : authorId === PEER_ID
            ? userShape(PEER_ID, PEER_NAME, "rahi", peer.u)
            : authorId === SEEN_ID
              ? userShape(SEEN_ID, SEEN_NAME, "nila", seen.u)
              : userShape(HIDDEN_AUTHOR_ID, HIDDEN_AUTHOR_NAME, "hidden", hidden.u),
        mine,
        statuses: [row],
      });
    }
    const items: Record<string, unknown>[] = [];
    for (const [authorId, group] of groups) {
      if (group.mine) {
        if (options.withoutMine) continue;
        items.push({
          user: group.user,
          mine: true,
          statuses: group.statuses.map((row) => ({
            ...row,
            viewers: viewersByStatus.get(String(row.id)) ?? 0,
          })),
        });
        continue;
      }
      if (authorId === SEEN_ID && options.withoutSeen) continue;
      items.push({
        user: group.user,
        mine: false,
        allViewed: group.statuses.every((row) => viewedByMe.has(String(row.id))),
        statuses: group.statuses,
      });
    }
    return { items };
  };

  const worker: MockStatusWorker = {
    install: async () => undefined,
    posts: [],
    mediaFetches: [],
    mediaAuthHeaders: [],
    views: [],
    reactions: [],
    viewersCalls: [],
    deletes: [],
    conversationPosts: [],
    conversationReads: [],
    messages: [],
    uploads: [],
    peer,
    me,
  };

  worker.install = async (page: Page) => {
    const json = (route: Route, body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    await page.route("**/api/auth/refresh", (route) => json(route, { ok: true }));
    // Plan §7.2: socket dials mint a one-time ticket first; give the dial one.
    await page.route("**/api/ws/ticket", (route) =>
      json(route, { ticket: "e2e.ticket", expiresIn: 60 }),
    );
    await page.route("**/api/e2ee/backup", (route) =>
      json(route, { backup: plaintextBackupBlob(me) }),
    );
    await page.route("**/api/me", (route) => {
      if (route.request().method() === "PATCH") return json(route, { ok: true });
      return json(route, {
        user: {
          ...ME,
          about: null,
          email: null,
          phone: "+8801700000000",
          googleEmail: null,
          googleLinked: false,
          e2eePublicKey: me.u,
        },
      });
    });

    /* ---- the feed, and posting onto it ---- */

    await page.route(/\/api\/statuses\/([^/]+)\/media$/, (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      worker.mediaFetches.push(id);
      const header = route.request().headers()["authorization"];
      if (header) worker.mediaAuthHeaders.push(header);
      if (options.mediaFails) return json(route, { error: "Media not found." }, 404);
      const row = rows.get(id);
      if (!row || row.hasMedia !== true) return json(route, { error: "Media not found." }, 404);
      const isVideo = row.kind === "VIDEO";
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": isVideo ? "video/mp4" : "image/jpeg",
          "x-content-type-options": "nosniff",
        },
        body: Buffer.from(isVideo ? CLIP_BYTES : PHOTO_BYTES),
      });
    });

    await page.route(/\/api\/statuses\/([^/]+)\/view$/, (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      worker.views.push(id);
      viewedByMe.add(id);
      return json(route, { ok: true });
    });

    await page.route(/\/api\/statuses\/([^/]+)\/react$/, (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const emoji = String(body.emoji ?? "");
      // The Worker's own rule: emoji only, and never on your own status.
      if (!emoji) return json(route, { error: "Pick a reaction." }, 400);
      if (authorOf.get(id) === ME.id) {
        return json(route, { error: "Can't react to your own status." }, 400);
      }
      reactions.set(id, emoji);
      worker.reactions.push({ id, emoji });
      viewedByMe.add(id);
      return json(route, { ok: true });
    });

    await page.route(/\/api\/statuses\/([^/]+)\/viewers$/, (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      worker.viewersCalls.push(id);
      if (authorOf.get(id) !== ME.id) return json(route, { error: "Not your status." }, 403);
      return json(route, {
        viewers: [
          {
            user: userShape(PEER_ID, PEER_NAME, "rahi", peer.u),
            viewedAt: iso(60_000),
            reaction: reactions.get(id) ?? "",
          },
          {
            user: userShape(SEEN_ID, SEEN_NAME, "nila", seen.u),
            viewedAt: iso(30_000),
            reaction: "",
          },
        ],
      });
    });

    await page.route(/\/api\/statuses\/([^/]+)$/, (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      worker.deletes.push(id);
      rows.delete(id);
      return json(route, { ok: true });
    });

    await page.route(/\/api\/statuses$/, (route) => {
      if (route.request().method() === "POST") {
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.posts.push(body);
        // The Worker's own refusals, mirrored so a client-side gap shows up.
        const kind = String(body.kind ?? "TEXT").toUpperCase();
        if (kind === "TEXT" && !String(body.text ?? "").trim()) {
          return json(route, { error: "Write something for the status." }, 400);
        }
        if ((kind === "IMAGE" || kind === "VIDEO") && !body.imageData && !body.fileKey) {
          return json(
            route,
            { error: `Pick a ${kind === "VIDEO" ? "video" : "photo"} for the status.` },
            400,
          );
        }
        if (typeof body.imageData === "string" && body.imageData.length > 450_000) {
          return json(route, { error: "Photo too large — pick a smaller image." }, 400);
        }
        const id = `99999999-9999-4999-8999-${String(Date.now()).slice(-12).padStart(12, "0")}`;
        const created = new Date().toISOString();
        rows.set(id, {
          id,
          kind,
          text: String(body.text ?? ""),
          bgStyle: String(body.bgStyle ?? "amber"),
          hasMedia: Boolean(body.imageData ?? body.fileKey),
          seconds: kind === "VIDEO" ? Math.max(0, Math.min(120, Number(body.seconds ?? 0))) : 0,
          createdAt: created,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        authorOf.set(id, ME.id);
        return json(
          route,
          {
            status: {
              id,
              kind,
              text: body.text ?? "",
              bgStyle: body.bgStyle ?? "amber",
              hasMedia: Boolean(body.imageData ?? body.fileKey),
              seconds: 0,
              createdAt: created,
              expiresAt: rows.get(id)?.expiresAt,
            },
          },
          201,
        );
      }
      if (options.feedFails) return json(route, { error: "Something went wrong." }, 500);
      return json(route, feedPayload());
    });

    /* ---- the messaging routes a reply and "Message" need ---- */

    await page.route(/\/api\/conversations\/([^/]+)\/messages$/, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const conversationId = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      worker.messages.push({ conversationId, body });
      return json(
        route,
        {
          message: {
            id: `srv_${worker.messages.length}`,
            senderId: ME.id,
            kind: "TEXT",
            body: body.body ?? "",
            meta: body.meta ?? {},
            createdAt: new Date().toISOString(),
            rowid: 100 + worker.messages.length,
          },
        },
        201,
      );
    });

    await page.route(/\/api\/conversations\/([^/]+)$/, (route) => {
      const conversationId = new URL(route.request().url()).pathname.split("/")[3] ?? "";
      worker.conversationReads.push(conversationId);
      return json(route, {
        conversation: {
          id: conversationId,
          isGroup: false,
          unread: 0,
          hidden: 0,
          lastMessageAt: new Date().toISOString(),
          other: { id: PEER_ID, displayName: PEER_NAME, username: "rahi", e2eePublicKey: peer.u },
        },
      });
    });

    await page.route(/\/api\/conversations$/, (route) => {
      if (route.request().method() === "POST") {
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.conversationPosts.push(String(body.userId ?? ""));
        return json(route, {
          conversation: {
            id: CHAT_ID,
            isGroup: false,
            unread: 0,
            hidden: 0,
            lastMessageAt: new Date().toISOString(),
            other: { id: PEER_ID, displayName: PEER_NAME, username: "rahi", e2eePublicKey: peer.u },
          },
        });
      }
      return json(route, { items: [] });
    });

    /* ---- uploads, for a photo too big to post inline or a clip ---- */

    await page.route(/\/api\/files(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      const bytes = route.request().postDataBuffer();
      worker.uploads.push({
        name: url.searchParams.get("name") ?? "",
        type: url.searchParams.get("type") ?? "",
        bytes: new Uint8Array(bytes ?? Buffer.alloc(0)),
      });
      return json(
        route,
        {
          fileKey: `f/up${worker.uploads.length}.bin`,
          size: worker.uploads.at(-1)?.bytes.byteLength ?? 0,
        },
        201,
      );
    });
  };

  return worker;
}
