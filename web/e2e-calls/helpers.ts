import type { Page, Route, WebSocketRoute } from "@playwright/test";
import {
  generateTestIdentity,
  plaintextBackupBlob,
  signIn,
  type TestIdentity,
} from "../e2e-messaging/helpers";

/**
 * A mocked Worker for the call surfaces (slice G).
 *
 * It serves the whole 1:1 call API the real Worker serves — create, answer,
 * decline, end, ICE both ways, live media flags, renegotiation, the history list
 * and the public ICE-config route — plus the boot routes, the conversation rows a
 * chat header reads its call gate from, and the sealed-message route the ring
 * screen's quick reply posts to.
 *
 * The state is shared by every page that installs it, which is the point: a real
 * call has TWO browsers looking at ONE row. The caller's offer has to arrive in
 * the callee's `/active` read, the callee's answer in the caller's, and each
 * side's ICE candidates in the other's `/ice` cursor read — so a two-context test
 * can run an actual WebRTC call through this mock with no server behind it.
 *
 * `incoming` is computed per reader (the Worker's `callFrom` does the same), and
 * the group routes are deliberately absent: the Web wraps none of them, and a
 * mock that served them would invite a test that expects a mesh the client
 * refuses to run.
 */

export { signIn };

export const ME = { id: "u_me", username: "me", displayName: "Amar Account" };
export const PEER = { id: "u_peer", username: "rahi", displayName: "Rahi" };

const INCOMING_OFFER_SDP = [
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:test",
  "a=ice-pwd:testpassword123456789012",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:test",
  "a=ice-pwd:testpassword123456789012",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:1",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:96 VP8/90000",
  "",
].join("\r\n");
export const BOT_ID = "kp_official_bot";

export const CHAT_ID = "c_direct";
export const GROUP_ID = "c_group";
export const MUTED_CHAT_ID = "c_muted";
export const BOT_CHAT_ID = "c_official";
export const REQUEST_CHAT_ID = "c_request";
export const BLOCKED_CHAT_ID = "c_blocked";
export const MUTED_PEER_ID = "u_muted";
export const REQUEST_PEER_ID = "u_request";
export const BLOCKED_PEER_ID = "u_blocked";

/** Call ids are UUIDs server-side, and the client's path guard says so. */
export const CALL_ID = "aaaaaaaa-1111-4111-8111-111111111111";
export const VOICE_CALL_ID = "bbbbbbbb-2222-4222-8222-222222222222";
export const MISSED_CALL_ID = "cccccccc-3333-4333-8333-333333333333";
export const CANCELLED_CALL_ID = "eeeeeeee-5555-4555-8555-555555555555";
export const GROUP_CALL_ID = "dddddddd-4444-4444-8444-444444444444";

export type CallRecord = {
  id: string;
  kind: "AUDIO" | "VIDEO";
  status: "RINGING" | "ACTIVE" | "ENDED" | "DECLINED" | "MISSED" | "CANCELLED";
  callerId: string;
  calleeId: string;
  conversationId: string;
  group?: boolean;
  title?: string;
  offerSdp: string;
  answerSdp: string;
  reofferSdp?: string;
  reanswerSdp?: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  media: Record<string, { camera?: boolean; screen?: boolean }>;
  ice: { id: string; from: string; candidate: Record<string, unknown>; createdAt: string }[];
};

export type MockCallsOptions = {
  /** Seed the history list with finished calls (connected, missed, group). */
  withHistory?: boolean;
  /** Seed a RINGING call from the peer, so the app opens onto an incoming ring. */
  withIncomingRing?: boolean;
  /** Serve a 500 on `GET /api/calls/history`. */
  historyFails?: boolean;
  /** Refuse `POST /api/calls` with 486 LINE_BUSY. */
  lineBusy?: boolean;
  /** Refuse `POST /api/calls` with 403 BLOCKED. */
  blocked?: boolean;
  /** Drop the call-muted chat, the bot chat, the request and the block. */
  minimalChats?: boolean;
};

export type MockCallsWorker = {
  calls: Map<string, CallRecord>;
  /** Every call request that reached the mock, in order. */
  requests: string[];
  starts: { userId: string; kind: string; offerSdp: string }[];
  answers: { callId: string; answerSdp: string }[];
  declines: string[];
  ends: string[];
  icePosts: { callId: string; candidate: Record<string, unknown> }[];
  mediaPosts: { callId: string; camera?: boolean; screen?: boolean }[];
  reoffers: { callId: string; sdp: string }[];
  messages: { from: string; conversationId: string; body: Record<string, unknown> }[];
  conversationPosts: string[];
  historyReads: number;
  /** WebSocket paths the client opened. */
  sockets: string[];
  options: MockCallsOptions;
  /** The two identities, so a test can open a sealed body itself. */
  identities: { me: TestIdentity; peer: TestIdentity };
  install(page: Page, as?: "me" | "peer"): Promise<void>;
  /** Push a frame to one user's `/ws/user` socket, the way the Worker broadcasts. */
  pushUserFrame(userId: string, frame: Record<string, unknown>): void;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function createMockCallsWorker(
  options: MockCallsOptions = {},
): Promise<MockCallsWorker> {
  const calls = new Map<string, CallRecord>();
  const userSockets = new Map<string, WebSocketRoute[]>();
  const meIdentity = await generateTestIdentity();
  const peerIdentity = await generateTestIdentity();

  const worker: MockCallsWorker = {
    calls,
    options,
    requests: [],
    starts: [],
    answers: [],
    declines: [],
    ends: [],
    icePosts: [],
    mediaPosts: [],
    reoffers: [],
    messages: [],
    conversationPosts: [],
    historyReads: 0,
    sockets: [],
    identities: { me: meIdentity, peer: peerIdentity },

    pushUserFrame(userId, frame) {
      for (const socket of userSockets.get(userId) ?? []) {
        try {
          socket.send(JSON.stringify(frame));
        } catch {
          // A socket the browser already closed cannot be written to.
        }
      }
    },

    async install(page, as = "me") {
      const uid = as === "me" ? ME.id : PEER.id;
      const me = as === "me" ? ME : PEER;
      const identity = as === "me" ? meIdentity : peerIdentity;
      const otherIdentity = as === "me" ? peerIdentity : meIdentity;
      const otherUser = as === "me" ? PEER : ME;

      /* -------------------------------------------------------- sockets ---- */

      await page.routeWebSocket(/\/ws\/user(\?.*)?$/, (socket) => {
        worker.sockets.push("/ws/user");
        const list = userSockets.get(uid) ?? [];
        list.push(socket);
        userSockets.set(uid, list);
        socket.onClose(() => {
          userSockets.set(
            uid,
            (userSockets.get(uid) ?? []).filter((entry) => entry !== socket),
          );
        });
      });
      await page.routeWebSocket(/\/ws\/call\/([^/?]+)(\?.*)?$/, (socket) => {
        worker.sockets.push(new URL(socket.url()).pathname);
        // The real signalling room is receive-only: the client sends heartbeats
        // and nothing else, and a heartbeat is never echoed back as a frame.
        socket.onMessage(() => undefined);
      });
      await page.routeWebSocket(/\/ws\/chat\/([^/?]+)(\?.*)?$/, (socket) => {
        worker.sockets.push(new URL(socket.url()).pathname);
        socket.onMessage(() => undefined);
      });

      /* ----------------------------------------------------------- boot ---- */

      await page.route("**/api/auth/refresh", (route) => json(route, { ok: true }));
      await page.route("**/api/e2ee/backup", (route) =>
        json(route, { backup: plaintextBackupBlob(identity) }),
      );
      await page.route("**/api/me", (route) => {
        if (route.request().method() === "PATCH") return json(route, { ok: true });
        return json(route, {
          user: {
            ...me,
            about: null,
            email: null,
            phone: "+8801700000000",
            googleEmail: null,
            googleLinked: false,
            e2eePublicKey: identity.u,
          },
        });
      });

      /* ---------------------------------------------------------- calls ---- */

      await page.route(/\/api\/config\/ice(\?.*)?$/, (route) => {
        worker.requests.push("GET /api/config/ice");
        // No TURN credentials in a test: the client must fall back to its own
        // built-in list rather than fail the call.
        return json(route, { ice: null });
      });

      await page.route(/\/api\/calls\/active(\?.*)?$/, (route) => {
        worker.requests.push("GET /api/calls/active");
        const now = Date.now();
        const items = [...calls.values()]
          .filter((call) => call.status === "RINGING" || call.status === "ACTIVE")
          .filter((call) => call.callerId === uid || call.calleeId === uid)
          // The Worker's anti-phantom window: a ring younger than 1.6 s is not
          // shown to the callee, so a caller who hung up inside it never rang a
          // phone that was not listening.
          .filter(
            (call) =>
              !(
                call.status === "RINGING" &&
                call.calleeId === uid &&
                now - Date.parse(call.createdAt) < 1_600
              ),
          )
          .map((call) => rowFor(call, uid, otherUser));
        return json(route, { items });
      });

      await page.route(/\/api\/calls\/history(\?.*)?$/, (route) => {
        worker.requests.push("GET /api/calls/history");
        worker.historyReads += 1;
        if (options.historyFails) {
          return json(route, { error: "Call history is unavailable." }, 500);
        }
        const items = [...calls.values()]
          .filter(
            (call) =>
              ["ENDED", "DECLINED", "MISSED", "CANCELLED"].includes(call.status) &&
              (call.callerId === uid || call.calleeId === uid || call.group === true),
          )
          // A history row is LIGHT: the Worker destructures every SDP field out
          // of it, and a client that needed SDP there would be a client that
          // re-broke the payload the server was fixed for.
          .map((call) => {
            const row = rowFor(call, uid, otherUser) as Record<string, unknown>;
            delete row.offerSdp;
            delete row.answerSdp;
            delete row.reofferSdp;
            delete row.reanswerSdp;
            delete row.media;
            return row;
          });
        return json(route, { items });
      });

      await page.route(/\/api\/calls(\?.*)?$/, (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.requests.push("POST /api/calls");
        worker.starts.push({
          userId: String(body.userId ?? ""),
          kind: String(body.kind ?? "AUDIO"),
          offerSdp: String(body.offerSdp ?? ""),
        });
        if (options.lineBusy) {
          return json(
            route,
            { error: "Line busy — on another call right now.", code: "LINE_BUSY" },
            486,
          );
        }
        if (options.blocked) {
          return json(
            route,
            { error: "They blocked you, so this call cannot go through.", code: "BLOCKED" },
            403,
          );
        }
        const kind = body.kind === "VIDEO" ? "VIDEO" : "AUDIO";
        // One id per test run: a live call is created at most once per page.
        const id = calls.has(CALL_ID) ? CANCELLED_CALL_ID : CALL_ID;
        calls.set(id, {
          id,
          kind,
          status: "RINGING",
          callerId: uid,
          calleeId: String(body.userId ?? ""),
          conversationId: CHAT_ID,
          offerSdp: String(body.offerSdp ?? ""),
          answerSdp: "",
          startedAt: null,
          endedAt: null,
          createdAt: new Date().toISOString(),
          media: {},
          ice: [],
        });
        return json(route, { call: rowFor(calls.get(id)!, uid, otherUser) }, 201);
      });

      await page.route(/\/api\/calls\/([^/]+)\/answer(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.requests.push(`POST /api/calls/${id}/answer`);
        worker.answers.push({ callId: id, answerSdp: String(body.answerSdp ?? "") });
        const call = calls.get(id);
        if (!call) return json(route, { error: "Call not found." }, 404);
        call.answerSdp = String(body.answerSdp ?? "");
        call.status = "ACTIVE";
        call.startedAt = new Date().toISOString();
        return json(route, { call: rowFor(call, uid, otherUser) });
      });

      await page.route(/\/api\/calls\/([^/]+)\/decline(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        worker.requests.push(`POST /api/calls/${id}/decline`);
        worker.declines.push(id);
        const call = calls.get(id);
        if (call) {
          call.status = "DECLINED";
          call.endedAt = new Date().toISOString();
        }
        return json(route, { ok: true });
      });

      await page.route(/\/api\/calls\/([^/]+)\/end(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        worker.requests.push(`POST /api/calls/${id}/end`);
        worker.ends.push(id);
        const call = calls.get(id);
        if (call) {
          // The Worker's own rule: a CALLER hanging up on a still-RINGING call is
          // a MISSED call for the callee, not a quiet ENDED.
          const gaveUp = call.status === "RINGING" && call.callerId === uid;
          call.status = gaveUp ? "MISSED" : "ENDED";
          call.endedAt = new Date().toISOString();
        }
        return json(route, { ok: true });
      });

      await page.route(/\/api\/calls\/([^/]+)\/ice(\?.*)?$/, (route) => {
        const url = new URL(route.request().url());
        const id = url.pathname.split("/")[3] ?? "";
        const call = calls.get(id);
        if (route.request().method() === "POST") {
          const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
          const candidate = (body.candidate ?? {}) as Record<string, unknown>;
          worker.requests.push(`POST /api/calls/${id}/ice`);
          worker.icePosts.push({ callId: id, candidate });
          if (!call) return json(route, { error: "Call not found." }, 404);
          if (typeof candidate.candidate !== "string" || !candidate.candidate) {
            return json(route, { error: "Missing candidate." }, 400);
          }
          call.ice.push({
            id: `${new Date().toISOString()}:${call.ice.length}`,
            from: uid,
            candidate,
            createdAt: new Date().toISOString(),
          });
          return json(route, { ok: true });
        }
        worker.requests.push(`GET /api/calls/${id}/ice`);
        if (!call) return json(route, { items: [], now: "" });
        const since = url.searchParams.get("since") ?? "";
        const index = since ? call.ice.findIndex((entry) => entry.id === since) : -1;
        const items = call.ice.slice(index + 1).filter((entry) => entry.from !== uid);
        return json(route, { items, now: items.at(-1)?.id ?? since });
      });

      await page.route(/\/api\/calls\/([^/]+)\/media(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.requests.push(`POST /api/calls/${id}/media`);
        worker.mediaPosts.push({
          callId: id,
          ...(typeof body.camera === "boolean" ? { camera: body.camera } : {}),
          ...(typeof body.screen === "boolean" ? { screen: body.screen } : {}),
        });
        const call = calls.get(id);
        if (!call) return json(route, { error: "Call not found." }, 404);
        call.media[uid] = {
          ...(typeof body.camera === "boolean" ? { camera: body.camera } : {}),
          ...(typeof body.screen === "boolean" ? { screen: body.screen } : {}),
        };
        // A camera switched on converts the row; a screen share never does.
        const kind = body.camera === true ? "VIDEO" : call.kind;
        call.kind = kind;
        return json(route, { ok: true, media: call.media, kind });
      });

      await page.route(/\/api\/calls\/([^/]+)\/reoffer(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.requests.push(`POST /api/calls/${id}/reoffer`);
        worker.reoffers.push({ callId: id, sdp: String(body.sdp ?? "") });
        const call = calls.get(id);
        if (call) call.reofferSdp = String(body.sdp ?? "");
        return json(route, { ok: true });
      });

      await page.route(/\/api\/calls\/([^/]+)\/reanswer(\?.*)?$/, (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        worker.requests.push(`POST /api/calls/${id}/reanswer`);
        const call = calls.get(id);
        if (call) call.reanswerSdp = String(route.request().postDataJSON()?.sdp ?? "");
        return json(route, { ok: true });
      });

      /* --------------------------------------------------- conversations --- */

      await page.route(/\/api\/conversations(\?.*)?$/, (route) => {
        if (route.request().method() === "POST") {
          const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
          worker.requests.push("POST /api/conversations");
          worker.conversationPosts.push(String(body.userId ?? ""));
          return json(route, { conversation: detailFor(CHAT_ID, otherUser, otherIdentity.u) });
        }
        worker.requests.push("GET /api/conversations");
        return json(route, {
          conversations: conversationsFor(options, otherUser, otherIdentity.u),
        });
      });

      await page.route(/\/api\/conversations\/([^/]+)\/messages(\?.*)?$/, (route) => {
        const conversationId = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        if (route.request().method() !== "POST") {
          return json(route, { messages: [], hasMore: false });
        }
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        worker.requests.push(`POST /api/conversations/${conversationId}/messages`);
        worker.messages.push({ from: uid, conversationId, body });
        return json(
          route,
          {
            message: {
              id: `srv_${worker.messages.length}`,
              senderId: uid,
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

      await page.route(/\/api\/conversations\/([^/]+)\/read(\?.*)?$/, (route) =>
        json(route, { ok: true }),
      );
      await page.route(/\/api\/conversations\/([^/]+)\/typing(\?.*)?$/, (route) =>
        json(route, { ok: true }),
      );
      await page.route(/\/api\/conversations\/([^/]+)\/media(\?.*)?$/, (route) =>
        json(route, { items: [] }),
      );
      await page.route(/\/api\/conversations\/([^/]+)(\?.*)?$/, (route) => {
        const conversationId = new URL(route.request().url()).pathname.split("/")[3] ?? "";
        worker.requests.push(`GET /api/conversations/${conversationId}`);
        return json(route, {
          conversation: detailFor(conversationId, otherUser, otherIdentity.u),
        });
      });

      await page.route(/\/api\/files(\?.*)?$/, (route) =>
        json(route, { fileKey: "f/test.bin", size: 0 }, 201),
      );
    },
  };

  /** The `callFrom` shape, with `incoming` computed for the reader. */
  function rowFor(
    call: CallRecord,
    readerId: string,
    otherUser: { id: string; displayName: string; username: string },
  ) {
    const peerUser = call.callerId === readerId ? otherUser : readerId === ME.id ? PEER : ME;
    return {
      id: call.id,
      kind: call.kind,
      status: call.status,
      incoming: call.callerId !== readerId,
      conversationId: call.conversationId,
      group: call.group === true,
      title: call.title ?? "",
      callerId: call.callerId,
      calleeId: call.calleeId,
      offerSdp: call.offerSdp,
      answerSdp: call.answerSdp,
      reofferSdp: call.reofferSdp ?? "",
      reanswerSdp: call.reanswerSdp ?? "",
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      createdAt: call.createdAt,
      media: call.media,
      other: {
        id: peerUser.id,
        displayName: peerUser.displayName,
        username: peerUser.username,
        avatarUrl: null,
        avatarRef: "",
        online: true,
        privateProfile: false,
      },
    };
  }

  function detailFor(
    conversationId: string,
    otherUser: { id: string; displayName: string; username: string },
    otherKey: string,
  ) {
    const isGroup = conversationId === GROUP_ID;
    return {
      id: conversationId,
      isGroup,
      unread: 0,
      hidden: 0,
      muted: 0,
      title: isGroup ? "Class of 2026" : otherUser.displayName,
      lastMessageAt: new Date().toISOString(),
      mutedCall: false,
      mutedMsg: false,
      requestPending: false,
      blockedByMe: false,
      blockedMe: false,
      other: {
        id: otherUser.id,
        displayName: otherUser.displayName,
        username: otherUser.username,
        e2eePublicKey: otherKey,
      },
    };
  }

  if (options.withHistory) {
    const now = Date.now();
    const iso = (agoMs: number) => new Date(now - agoMs).toISOString();
    const seed = (call: Partial<CallRecord> & { id: string }): void => {
      calls.set(call.id, {
        kind: "AUDIO",
        status: "ENDED",
        callerId: ME.id,
        calleeId: PEER.id,
        conversationId: CHAT_ID,
        offerSdp: "",
        answerSdp: "",
        startedAt: null,
        endedAt: null,
        createdAt: iso(60_000),
        media: {},
        ice: [],
        ...call,
      } as CallRecord);
    };
    // Today: a connected voice call, then a missed video call from the peer.
    seed({
      id: VOICE_CALL_ID,
      status: "ENDED",
      createdAt: iso(90 * 60_000),
      startedAt: iso(90 * 60_000),
      endedAt: iso(83 * 60_000),
    });
    seed({
      id: MISSED_CALL_ID,
      kind: "VIDEO",
      status: "MISSED",
      callerId: PEER.id,
      calleeId: ME.id,
      createdAt: iso(30 * 60_000),
    });
    // Yesterday: a call I cancelled.
    seed({ id: CANCELLED_CALL_ID, status: "CANCELLED", createdAt: iso(26 * 60 * 60_000) });
    // Last week: a group call, which the Web lists but refuses to re-dial.
    seed({
      id: GROUP_CALL_ID,
      group: true,
      title: "Class of 2026",
      status: "ENDED",
      callerId: PEER.id,
      calleeId: "",
      conversationId: GROUP_ID,
      createdAt: iso(9 * 24 * 60 * 60_000),
      startedAt: iso(9 * 24 * 60 * 60_000),
      endedAt: iso(9 * 24 * 60 * 60_000 - 600_000),
    });
  }

  if (options.withIncomingRing) {
    calls.set(CALL_ID, {
      id: CALL_ID,
      kind: "VIDEO",
      status: "RINGING",
      callerId: PEER.id,
      calleeId: ME.id,
      conversationId: CHAT_ID,
      offerSdp: INCOMING_OFFER_SDP,
      answerSdp: "",
      startedAt: null,
      endedAt: null,
      // Older than the phantom window, so the callee is allowed to see it.
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      media: {},
      ice: [],
    });
  }

  return worker;
}

/**
 * The chat list. Each row carries the flags the header's call gate reads, and
 * each exists to prove one branch of `ChatScreen.kt:3799`: a live 1:1, a group,
 * a call-muted chat, a bot, an open request and a block.
 */
function conversationsFor(
  options: MockCallsOptions,
  otherUser: { id: string; displayName: string; username: string },
  otherKey: string,
) {
  const now = new Date().toISOString();
  const base = {
    unread: 0,
    hidden: 0,
    muted: 0,
    lastMessageAt: now,
    lastMessagePreview: null,
    mutedCall: false,
    mutedMsg: false,
    requestPending: false,
    blockedByMe: false,
    blockedMe: false,
  };
  const peerOf = (id: string, displayName: string, username: string, key = "") => ({
    id,
    displayName,
    username,
    avatarUrl: null,
    avatarRef: "",
    online: true,
    e2eePublicKey: key,
  });
  const rows: Record<string, unknown>[] = [
    {
      ...base,
      id: CHAT_ID,
      isGroup: false,
      title: otherUser.displayName,
      other: peerOf(otherUser.id, otherUser.displayName, otherUser.username, otherKey),
    },
    {
      ...base,
      id: GROUP_ID,
      isGroup: true,
      title: "Class of 2026",
      members: [
        { id: ME.id, displayName: ME.displayName },
        { id: PEER.id, displayName: PEER.displayName },
      ],
    },
  ];
  if (!options.minimalChats) {
    rows.push(
      {
        ...base,
        id: MUTED_CHAT_ID,
        isGroup: false,
        title: "Muted Person",
        mutedCall: true,
        other: peerOf(MUTED_PEER_ID, "Muted Person", "muted"),
      },
      {
        ...base,
        id: BOT_CHAT_ID,
        isGroup: false,
        title: "KuchuPuchu",
        other: peerOf(BOT_ID, "KuchuPuchu", "kuchupuchu"),
      },
      {
        ...base,
        id: REQUEST_CHAT_ID,
        isGroup: false,
        title: "Request Person",
        requestPending: true,
        other: peerOf(REQUEST_PEER_ID, "Request Person", "request"),
      },
      {
        ...base,
        id: BLOCKED_CHAT_ID,
        isGroup: false,
        title: "Blocked Person",
        blockedByMe: true,
        other: peerOf(BLOCKED_PEER_ID, "Blocked Person", "blocked"),
      },
    );
  }
  return rows;
}
