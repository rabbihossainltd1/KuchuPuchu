/**
 * The call REST surface.
 *
 * Every path here was read out of the "calls" block of `src/worker/index.ts`;
 * nothing is invented and nothing is added:
 *
 *   GET    /api/calls/active        RINGING + ACTIVE rows (1:1 and group), reaps stale rings
 *   GET    /api/calls/history       ENDED / DECLINED / MISSED, newest first, capped at 100
 *   POST   /api/calls               {userId, kind, offerSdp} → 201 {call}
 *   POST   /api/calls/:id/answer    {answerSdp} → {call}
 *   POST   /api/calls/:id/decline   → {ok}
 *   POST   /api/calls/:id/end       → {ok}
 *   POST   /api/calls/:id/ice       {candidate:{candidate,sdpMid,sdpMLineIndex}} → 201
 *   GET    /api/calls/:id/ice?since=→ {items, now}
 *   POST   /api/calls/:id/reoffer   {sdp}   mid-call renegotiation (screen share, camera on)
 *   POST   /api/calls/:id/reanswer  {sdp}
 *   POST   /api/calls/:id/media     {camera?, screen?}  live flags + the kind flip
 *   GET    /api/config/ice          {ice:{urls,username,credential}} or {ice:null}
 *
 * The group routes (`/api/calls/group`, `/:id/join`, `/:id/peer`) exist on the
 * Worker and are used by the phone's mesh. They are deliberately NOT wrapped
 * here: `callsModel.ts` explains why (no measured participant cap yet), and a
 * route the client never calls is a route that cannot be half-implemented.
 */

import type { ApiClient } from "../auth/authApi";
import { ApiError } from "../api";
import {
  parseCallList,
  parseCallRow,
  parseIceConfig,
  type CallKind,
  type CallRow,
  type IceServer,
} from "./callsModel";

/**
 * The Worker mints call ids with `crypto.randomUUID()`, so a hyphen is part of
 * the shape. Anything else is refused here rather than handed to a URL — the
 * client's own path guard rejects encoded slashes, and an id that needed
 * encoding was never an id. (Same rule as `statusPath`.)
 */
const CALL_ID_RE = /^[0-9a-fA-F-]{1,64}$/;

export function callPath(callId: string, suffix = ""): string {
  if (!CALL_ID_RE.test(callId)) throw new Error("That call cannot be addressed.");
  return `/api/calls/${callId}${suffix}`;
}

async function postJson(api: ApiClient, path: string, body?: Record<string, unknown>) {
  return api.request<unknown>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** The one `call` object out of a `{call: …}` envelope, or null. */
function readCall(payload: unknown): CallRow | null {
  if (!payload || typeof payload !== "object") return null;
  const call = (payload as Record<string, unknown>).call;
  return parseCallRow(call);
}

export type StartCallResult = {
  readonly call: CallRow | null;
  /** The Worker's refusal code, when it refused (LINE_BUSY, BLOCKED, …). */
  readonly code: string;
  readonly status: number;
};

export const callsApi = {
  /** RINGING + ACTIVE rows. The Worker reaps stale rings inside this read. */
  async active(api: ApiClient, signal?: AbortSignal): Promise<readonly CallRow[]> {
    const payload = await api.request<unknown>("/api/calls/active", {
      ...(signal ? { signal } : {}),
    });
    return parseCallList(payload);
  },

  /** The finished-call list for the Calls tab, newest first. */
  async history(api: ApiClient, signal?: AbortSignal): Promise<readonly CallRow[]> {
    const payload = await api.request<unknown>("/api/calls/history", {
      ...(signal ? { signal } : {}),
    });
    return parseCallList(payload);
  },

  /**
   * Start a 1:1 call. The offer travels WITH the create request — that is the
   * phone's order too (`startCall`: createOffer → setLocalDescription → POST), so
   * the callee's ring already carries the SDP and Accept spends no round trip
   * fetching it (owner round 33, item 15).
   *
   * A refusal is returned, not thrown: 486 LINE_BUSY has to paint "Line busy" on
   * the calling screen for one beat instead of vanishing into a generic error.
   */
  async start(
    api: ApiClient,
    input: { userId: string; kind: CallKind; offerSdp: string },
  ): Promise<StartCallResult> {
    try {
      const payload = await postJson(api, "/api/calls", {
        userId: input.userId,
        kind: input.kind,
        offerSdp: input.offerSdp,
      });
      return { call: readCall(payload), code: "", status: 201 };
    } catch (error) {
      if (error instanceof ApiError && error.kind === "http") {
        return { call: null, code: error.code ?? "", status: error.status ?? 0 };
      }
      throw error;
    }
  },

  /**
   * Pick up a ringing call. The answer is posted with the SDP; the Worker flips
   * the row to ACTIVE and pushes `call_answer` at the caller the same moment.
   */
  async answer(api: ApiClient, callId: string, answerSdp: string): Promise<CallRow | null> {
    const payload = await postJson(api, callPath(callId, "/answer"), { answerSdp });
    return readCall(payload);
  },

  /** Refuse a ring. Personal on a group call, call-ending on a 1:1. */
  async decline(api: ApiClient, callId: string): Promise<void> {
    await postJson(api, callPath(callId, "/decline"));
  },

  /**
   * Hang up. On a still-RINGING call the CALLER's hang-up is a MISSED call for
   * the callee (owner round 31, item 24) — the Worker decides that from the row,
   * so the client sends no duration: `body.seconds` is not read there at all.
   */
  async end(api: ApiClient, callId: string): Promise<void> {
    await postJson(api, callPath(callId, "/end"));
  },

  /** One ICE candidate. The Worker stores the whole object and relays it live. */
  async sendIce(
    api: ApiClient,
    callId: string,
    candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number },
  ): Promise<void> {
    await postJson(api, callPath(callId, "/ice"), {
      candidate: {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      },
    });
  },

  /**
   * Candidates the other side posted since `since` (an opaque cursor: the row's
   * `createdAt:rowid` id the GET returns). The poll is the fallback for a dropped
   * signalling socket.
   */
  async pullIce(
    api: ApiClient,
    callId: string,
    since = "",
    signal?: AbortSignal,
  ): Promise<{
    items: readonly { id: string; from: string; candidate: Record<string, unknown> }[];
    now: string;
  }> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const payload = (await api.request<unknown>(callPath(callId, `/ice${query}`), {
      ...(signal ? { signal } : {}),
    })) as Record<string, unknown> | null;
    const items = Array.isArray(payload?.items) ? (payload!.items as unknown[]) : [];
    return {
      items: items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          return {
            id: typeof row.id === "string" ? row.id : "",
            from: typeof row.from === "string" ? row.from : "",
            candidate:
              row.candidate && typeof row.candidate === "object"
                ? (row.candidate as Record<string, unknown>)
                : {},
          };
        })
        .filter((row): row is { id: string; from: string; candidate: Record<string, unknown> } =>
          Boolean(row && row.id),
        ),
      now: typeof payload?.now === "string" ? payload.now : "",
    };
  },

  /** Mid-call renegotiation: a fresh offer (screen share, camera on a voice call). */
  async reoffer(api: ApiClient, callId: string, sdp: string): Promise<void> {
    await postJson(api, callPath(callId, "/reoffer"), { sdp });
  },

  async reanswer(api: ApiClient, callId: string, sdp: string): Promise<void> {
    await postJson(api, callPath(callId, "/reanswer"), { sdp });
  },

  /**
   * Live media flags. A camera switched ON also converts the row's `kind` to
   * VIDEO server-side (owner round 31, item 19) — that is what both sides' polls
   * and the call log read, so the client never keeps the conversion to itself.
   * A screen share never changes the kind.
   */
  async postMedia(
    api: ApiClient,
    callId: string,
    flags: { camera?: boolean; screen?: boolean },
  ): Promise<{ kind: string }> {
    const payload = (await postJson(api, callPath(callId, "/media"), flags)) as Record<
      string,
      unknown
    > | null;
    return { kind: typeof payload?.kind === "string" ? payload.kind : "" };
  },

  /**
   * TURN credentials, when the deploy has them (`TURN_KEY_ID` + `TURN_API_TOKEN`
   * mint short-lived Cloudflare Realtime credentials; `TURN_URLS` is the static
   * fallback). `null` means "use the built-in list" — never "no relay at all".
   */
  async iceConfig(api: ApiClient, signal?: AbortSignal): Promise<IceServer | null> {
    try {
      const payload = await api.request<unknown>("/api/config/ice", {
        ...(signal ? { signal } : {}),
      });
      return parseIceConfig(payload);
    } catch {
      // A missing or refused config is not a call failure: the built-ins carry on.
      return null;
    }
  },
};
