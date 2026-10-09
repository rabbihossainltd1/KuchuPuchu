/**
 * The call model: every number, every label and every parse rule for the calls
 * surfaces, free of React and of the DOM so a Node contract case can import it
 * directly and compare it with the source that owns the rule.
 *
 * Where each rule comes from:
 *
 * - `CallsTabScreen.kt` — the history row (day sections, direction arrow, the
 *   label grammar, the gold call-back button, the 20 s cache).
 * - `CallScreens.kt` — the ring line, the control grid and its labels, the
 *   clock format, the quick-reply text.
 * - `CallEngine.kt` — the poll interval, the 60 s outgoing ring ceiling, the
 *   ICE server list, the SDP constraints, the phase transitions.
 * - `E2eeCall.kt` — the DTLS fingerprint parse, the safety code and
 *   trust-on-first-use.
 * - `src/worker/index.ts` — the routes, the error codes, the phantom-ring
 *   window and the shape of a `calls` row.
 *
 * Nothing here invents an endpoint. Group calls are deliberately NOT modelled:
 * the phone rings a whole group through a mesh of per-pair connections, and the
 * rebuild roadmap's gate for that on the Web is a MEASURED participant cap
 * (`docs/web-parity-rebuild-roadmap.md`, "খোলা প্রশ্ন"). No measurement exists
 * yet, so the Web client refuses to start one and says so instead of shipping a
 * call that silently drops the fourth member.
 */

/* ---------------------------------------------------------------- constants */

/**
 * The poll cadence, copied branch for branch out of `CallEngine.start`'s loop.
 * The socket is the delivery path and the timer is the safety net; the numbers
 * are the phone's own, because they were each tuned against a reported symptom
 * (round 33 item 15: a lost ANSWER frame cost the caller 5 s).
 */
export const CALL_POLL_MEDIA_UP_MS = 5_000;
export const CALL_POLL_SIGNAL_LIVE_MS = 1_500;
export const CALL_POLL_IN_CALL_MS = 500;
export const CALL_POLL_FOREGROUND_MS = 1_500;
export const CALL_POLL_BACKGROUND_MS = 4_000;

/**
 * A ring frame is re-checked once after this delay: the server hides a RINGING
 * call from the callee for its first 1.6 s, so a tick inside that window sees
 * nothing (CallEngine: `delay(1_200); pokeTick()`).
 */
export const CALL_PHANTOM_RECHECK_MS = 1_200;

export type CallPollState = {
  /** The `/ws/call/:id` socket is open for the call this device is on. */
  readonly signalLive: boolean;
  /** ICE + DTLS are up on THIS device — the timer has started. */
  readonly mediaUp: boolean;
  /** Any call row is on screen (ringing, connecting or talking). */
  readonly active: boolean;
  /** The browser tab is visible; a hidden tab is the phone's background case. */
  readonly visible: boolean;
};

/** Which of the five delays applies right now, in the phone's order. */
export function callPollDelayMs(state: CallPollState): number {
  if (state.signalLive && state.mediaUp) return CALL_POLL_MEDIA_UP_MS;
  if (state.signalLive) return CALL_POLL_SIGNAL_LIVE_MS;
  if (state.active) return CALL_POLL_IN_CALL_MS;
  return state.visible ? CALL_POLL_FOREGROUND_MS : CALL_POLL_BACKGROUND_MS;
}

/** `withTimeoutOrNull(4_500)` around the phone's `/api/calls/active` read. */
export const CALL_ACTIVE_TIMEOUT_MS = 4_500;

/** Three failed reads in a row say "Reconnecting…" (CallEngine.netFailStreak). */
export const CALL_NET_FAIL_STREAK = 3;
export const CALL_RECONNECTING_COPY = "Reconnecting…";

/**
 * An outgoing ring nobody answers is ended locally after a minute, exactly like
 * the server's reaper (`CallEngine.tick`: `outgoingRingAt > 60_000`).
 */
export const CALL_OUTGOING_RING_LIMIT_MS = 60_000;

/**
 * `PHANTOM_RING_MS` in the Worker: a RINGING call younger than this is hidden
 * from the callee by `/api/calls/active` itself, so a call cancelled before it
 * ever rang cannot ring the other side. The client mirrors the window only to
 * explain a row that is on the server but not in the list.
 */
export const CALL_PHANTOM_RING_MS = 1_600;

/** ICE stuck in CHECKING is restarted after this (CallEngine.armIceWatchdog). */
export const CALL_ICE_WATCHDOG_MS = 12_000;

/** The phone's history cache: paint it at once, refetch past this age. */
export const CALLS_HISTORY_STALE_MS = 20_000;

/** `GET /api/calls/history` caps at 100 rows; the client shows what it gets. */
export const CALLS_HISTORY_LIMIT = 100;

/** The safety code is shown for this long before it hides itself again (E4f). */
export const CALL_CODE_VISIBLE_MS = 3_000;

/** How long a refusal / busy notice stays on screen (CallEngine: `delay(2200)`). */
export const CALL_NOTICE_MS = 2_200;

export const CALL_KINDS = ["AUDIO", "VIDEO"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** The Worker's `calls.status` values, plus the client-only `BUSY` phase. */
export const CALL_STATUSES = [
  "RINGING",
  "ACTIVE",
  "ENDED",
  "DECLINED",
  "MISSED",
  "CANCELLED",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/**
 * The engine's own phases. They are a superset of the row's status because two
 * things are true only on this device: the media has not come up yet
 * (`connecting`, owner round 33 item 15 — the timer starts when THIS phone's
 * ICE+DTLS are up, never from the server's `started_at`) and a 486 refusal
 * (`busy`, which lives for one beat and never reaches the server).
 */
export const CALL_PHASES = [
  "idle",
  "dialing",
  "outgoing",
  "incoming",
  "connecting",
  "active",
  "busy",
  "ended",
] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

/**
 * The phone's `sdpConstraints()`: OfferToReceiveAudio + OfferToReceiveVideo on
 * every offer and answer. Those are legacy SDP-semantics knobs; the Web
 * equivalent under unified-plan is structural, and this client builds it that
 * way — an audio track plus a SENDRECV video m-line on the caller's offer, and
 * the offer's own video m-line flipped to sendrecv on the answer (round 33
 * item 21). The constant stays as the statement of intent the contract case
 * checks the construction against.
 */
export const CALL_SDP_CONSTRAINTS = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
} as const;

/**
 * The row stamp on a history line is `Theme.kt`'s `listStamp` — the same string
 * the status viewers sheet prints — so it is imported from the shared module and
 * re-exported here rather than reimplemented.
 */
export { listStamp } from "../time/dhakaTime";

/* --------------------------------------------------------------------- copy */

export const CALL_COPY = {
  /* history */
  historyEmptyTitle: "No calls yet",
  historyEmptyNote: "Start a voice or video call from any chat",
  historyLoading: "Loading your call history…",
  historyError: "Call history could not be loaded.",
  historyRetry: "Try again",
  /**
   * The phone moves a hidden chat's calls off this tab and onto its Hidden
   * screen (`ScreenStore.isHiddenCall`). This browser has no Hidden screen yet,
   * so nothing is filtered — and that is said out loud instead of silently
   * showing rows the phone would have moved.
   */
  historyHiddenNote:
    "On the phone, calls from a chat you hid move to its Hidden list. This browser has no Hidden list yet, so every call is listed here.",

  /* ring + in-call status lines (CallScreens.kt) */
  statusBusy: "Line busy — on another call",
  statusOnHold: "On hold",
  statusConnecting: "Connecting…",
  statusRinging: "Ringing…",
  statusCalling: "Calling…",
  incomingVideo: "Incoming video call…",
  incomingVoice: "Incoming voice call…",
  sharing: "You are sharing your screen",
  peerSharing: "They are sharing their screen",

  /* controls */
  accept: "Accept",
  decline: "Decline",
  mute: "Mute",
  unmute: "Unmute",
  video: "Video",
  cameraOn: "Camera on",
  cameraOff: "Camera off",
  shareScreen: "Share screen",
  stopShare: "Stop share",
  endCall: "End call",
  cancelCall: "Cancel",
  audioOutput: "Audio output",
  minimize: "Minimise call",
  returnToCall: "Return to call",
  verify: "Verify",
  messageInstead: "Message",

  /* quick reply (CallScreens.kt: "Message" on the ring screen) */
  quickReply: "Can't talk right now — I'll reply with a message.",

  /* E2EE (E2eeCall.kt) */
  e2eeLine: "End-to-end encrypted",
  e2eeChanged: "Security code changed — tap to verify",
  e2eeSheetTitle: "End-to-end encrypted",
  e2eeCopyCode: "Copy code",
  e2eeTrustNew: "Trust this new code",
  e2eeClose: "Close",

  /* refusals, keyed by the Worker's error code */
  codeLineBusy: "Line busy — on another call right now.",
  codeBlocked: "They blocked you, so this call cannot go through.",
  codeMessagePrivacy: "This user isn't accepting calls.",
  codeRequestPending: "Accept the message request first.",
  codeBotAccount: "This account can't be called.",
  codeForbidden: "That call isn't yours.",
  startFailed: "Couldn't start the call. Try again.",
  answerFailed: "Couldn't connect the call. Try again.",
  noAnswer: "No answer",

  /* group calls: refused, with the reason */
  groupRefused: "Group calls are not on the Web yet — start them from the phone.",

  /* browser capability boundary (plan §6: disclosed, never faked) */
  limitsTitle: "What a browser call cannot do",
  limitTakeover:
    "No full-screen takeover and no system call UI: the call lives in this tab, so a minimised or closed tab ends it.",
  limitBackground:
    "No guaranteed background survival — there is no foreground service. Keep the tab open while on a call.",
  limitRing:
    "An incoming call rings only while this tab is open. A closed or sleeping browser gets no ring (Web Push is a separate rollout).",
  limitRoutes:
    "Audio output can only be moved with the browser's own device picker — no earpiece, Bluetooth route or hardware switching.",
  limitCapture:
    "A browser cannot block a screenshot or a screen recording of a call. The phone can; a browser cannot.",
  limitAddCall: "Adding calls is coming in a future update.",
  limitRemind: "Reminders live on the phone — a browser cannot schedule one.",
} as const;

/**
 * The Worker's `fail(...)` code for every refusal a call can hit, mapped to the
 * line the user reads. `LINE_BUSY` is special: the phone shows it ON the calling
 * screen for one beat (owner round 12) instead of ringing forever, and plays its
 * own tone — the Web shows the same line for `CALL_NOTICE_MS`.
 */
export const CALL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  LINE_BUSY: CALL_COPY.codeLineBusy,
  BLOCKED: CALL_COPY.codeBlocked,
  MSG_PRIVACY: CALL_COPY.codeMessagePrivacy,
  REQUEST_PENDING: CALL_COPY.codeRequestPending,
  BOT_ACCOUNT: CALL_COPY.codeBotAccount,
  FORBIDDEN: CALL_COPY.codeForbidden,
  NO_MEMBERS: CALL_COPY.groupRefused,
});

export function callRefusalCopy(code: string): string {
  return CALL_REFUSALS[code] ?? CALL_COPY.startFailed;
}

/** 486 is the Worker's own "the callee is on another call" status. */
export function isBusyStatus(status: number | undefined): boolean {
  return status === 486;
}

/* -------------------------------------------------------------------- types */

export type CallPeer = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl: string;
  readonly avatarRef: string;
  readonly online: boolean;
  readonly privateProfile: boolean;
};

export type CallParticipant = {
  readonly id: string;
  readonly state: string;
  readonly joinedAt: string;
  readonly user: CallPeer | null;
};

/**
 * One `calls` row as `callFrom()` / `callHistoryFrom()` sends it. History rows
 * are LIGHT: the Worker strips every SDP field and sends `avatarUrl: null` with
 * an `avatarRef` instead, because 100 rows of SDP made the Calls tab ~19x larger
 * (its own comment). The parse keeps both shapes in one type so a live row and a
 * history row are the same object to the UI.
 */
export type CallRow = {
  readonly id: string;
  readonly kind: CallKind;
  readonly status: CallStatus;
  readonly incoming: boolean;
  readonly conversationId: string;
  readonly callerId: string;
  readonly calleeId: string;
  readonly group: boolean;
  readonly title: string;
  readonly avatarRef: string;
  readonly privateGroup: boolean;
  readonly myState: string;
  readonly participants: readonly CallParticipant[];
  readonly offerSdp: string;
  readonly answerSdp: string;
  readonly reofferSdp: string;
  readonly reofferFrom: string;
  readonly reanswerSdp: string;
  readonly media: Readonly<Record<string, { camera?: boolean; screen?: boolean }>>;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly createdAt: string;
  readonly other: CallPeer | null;
};

/* ------------------------------------------------------------------ parsing */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = 4096): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * An SDP description, clipped but NOT trimmed.
 *
 * Every other string field here is trimmed, and that is right for a name or a
 * timestamp — but an SDP is a line protocol in which each line, INCLUDING THE
 * LAST, has to end with CRLF. Trimming the trailing `\r\n` off a description
 * costs two bytes and makes the far side reject the whole thing
 * (`Failed to parse SessionDescription … Invalid SDP line`), which looks like a
 * networking failure and is not one. The Worker's own cap is 60 000, so the clip
 * stays; the trim does not.
 */
function sdpText(value: unknown, limit = 60_000): string {
  if (typeof value !== "string") return "";
  return value.length > limit ? value.slice(0, limit) : value;
}

/**
 * The Worker writes timestamps with `nowIso()` and reads them back verbatim, but
 * an absent column arrives as `null`. `optIso()` on the phone exists because
 * `optString()` turns a JSON null into the literal string `"null"`, which is not
 * blank — the same trap, closed the same way.
 */
function isoText(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return Number.isFinite(Date.parse(value)) ? value : "";
}

export function parseCallKind(value: unknown): CallKind {
  return text(value, 16).toUpperCase() === "VIDEO" ? "VIDEO" : "AUDIO";
}

export function parseCallStatus(value: unknown): CallStatus {
  const raw = text(value, 16).toUpperCase();
  return (CALL_STATUSES as readonly string[]).includes(raw) ? (raw as CallStatus) : "RINGING";
}

export function parseCallPeer(value: unknown): CallPeer | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;
  return {
    id,
    displayName: text(value.displayName, 120),
    username: text(value.username, 64),
    // A light row carries `avatarUrl: null` on purpose; the ref is what a client
    // resolves through its own cache.
    avatarUrl: text(value.avatarUrl, 4_000_000),
    avatarRef: text(value.avatarRef, 128),
    online: value.online === true,
    privateProfile: value.privateProfile === true,
  };
}

function parseParticipant(value: unknown): CallParticipant | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;
  return {
    id,
    state: text(value.state, 16).toUpperCase() || "RINGING",
    joinedAt: isoText(value.joinedAt),
    user: parseCallPeer(value.user),
  };
}

function parseMediaMap(value: unknown): Record<string, { camera?: boolean; screen?: boolean }> {
  if (!isRecord(value)) return {};
  const out: Record<string, { camera?: boolean; screen?: boolean }> = {};
  for (const [userId, flags] of Object.entries(value)) {
    if (!userId || !isRecord(flags)) continue;
    const entry: { camera?: boolean; screen?: boolean } = {};
    if (typeof flags.camera === "boolean") entry.camera = flags.camera;
    if (typeof flags.screen === "boolean") entry.screen = flags.screen;
    out[userId] = entry;
  }
  return out;
}

/**
 * A call row that cannot name itself is dropped rather than rendered blank: the
 * Worker's own `callFrom()` always sends `id`, `callerId` and `createdAt`.
 */
export function parseCallRow(value: unknown): CallRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  if (!id) return null;
  const group = value.group === true;
  return {
    id,
    kind: parseCallKind(value.kind),
    status: parseCallStatus(value.status),
    incoming: value.incoming === true,
    conversationId: text(value.conversationId, 64),
    callerId: text(value.callerId, 64),
    calleeId: text(value.calleeId, 64),
    group,
    title: text(value.title, 120),
    avatarRef: text(value.avatarRef, 128),
    privateGroup: value.privateGroup === true,
    myState: text(value.myState, 16).toUpperCase(),
    participants: Array.isArray(value.participants)
      ? value.participants
          .map(parseParticipant)
          .filter((row): row is CallParticipant => row !== null)
      : [],
    offerSdp: sdpText(value.offerSdp),
    answerSdp: sdpText(value.answerSdp),
    reofferSdp: sdpText(value.reofferSdp),
    reofferFrom: text(value.reofferFrom, 64),
    reanswerSdp: sdpText(value.reanswerSdp),
    media: parseMediaMap(value.media),
    startedAt: isoText(value.startedAt),
    endedAt: isoText(value.endedAt),
    createdAt: isoText(value.createdAt),
    other: parseCallPeer(value.other),
  };
}

export function parseCallList(payload: unknown): readonly CallRow[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items.map(parseCallRow).filter((row): row is CallRow => row !== null);
}

/* ------------------------------------------------------- identity + naming */

/**
 * Who the other side of this row is. `callPeerId()` on the phone: the caller
 * reads the callee and the callee reads the caller; a group row has no peer at
 * all (its `other` is the STARTER, its identity the conversation).
 */
export function callPeerId(row: CallRow, meId: string): string {
  if (row.group) return "";
  if (row.callerId === meId) return row.calleeId;
  if (row.calleeId === meId) return row.callerId;
  return "";
}

/** The name a row shows: the group's title, else the peer's display name. */
export function callPeerName(row: CallRow): string {
  if (row.group) return row.title || "Group";
  return row.other?.displayName || row.other?.username || "Unknown";
}

/** The picture a row shows: a group's ref, else the peer's (light rows: ref). */
export function callPeerAvatar(row: CallRow): string {
  if (row.group) return row.avatarRef;
  return row.other?.avatarUrl || row.other?.avatarRef || "";
}

/**
 * The call-back target. On the phone this is the peer id for a 1:1 row and the
 * CONVERSATION id for a group row (`CallRow` in CallsTabScreen.kt) — the same
 * value is fed to `startCall` or `startGroupCall`. The Web only starts 1:1
 * calls, so a group row returns its conversation id and the caller decides.
 */
export function callBackTarget(row: CallRow, meId: string): string {
  return row.group ? row.conversationId : callPeerId(row, meId);
}

/* ------------------------------------------------------------------ history */

/**
 * The row's duration in whole seconds, from `startedAt` to `endedAt`. A call
 * that never connected has no `startedAt`, so it is 0 — which is what makes the
 * label fall through to the bare "Voice call" / "Missed voice call" wording.
 */
export function callDurationSeconds(row: CallRow): number {
  if (!row.startedAt || !row.endedAt) return 0;
  const seconds = Math.floor((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** `"%d:%02d".format(secs / 60, secs % 60)` — CallScreens.clockText. */
export function clockText(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** A row the user never connected to: missed or declined (CallsTabScreen). */
export function callIsMissed(row: CallRow): boolean {
  return row.status === "MISSED" || row.status === "DECLINED";
}

/**
 * The history row's label, word for word in the phone's order — group first,
 * then missed, then cancelled, then a duration, then the bare kind. The phone
 * builds these with `"%d:%02d".format`, so the clock is `clockText`.
 */
export function callHistoryLabel(row: CallRow): string {
  const seconds = callDurationSeconds(row);
  const word = row.kind === "VIDEO" ? "video" : "voice";
  const duration = clockText(seconds);
  if (row.group) {
    if (callIsMissed(row)) return `Missed group ${word} call`;
    if (seconds > 0) return `Group ${word} call · ${duration}`;
    return `Group ${word} call`;
  }
  if (callIsMissed(row)) return `Missed ${word} call`;
  if (row.status === "CANCELLED") return `Cancelled ${word} call`;
  if (seconds > 0) return `${row.kind === "VIDEO" ? "Video" : "Voice"} call · ${duration}`;
  return `${row.kind === "VIDEO" ? "Video" : "Voice"} call`;
}

/** The line under the name: label, then the Dhaka-time stamp (CallsTabScreen). */
export function callHistoryLine(row: CallRow, stamp: string): string {
  return `${callHistoryLabel(row)} · ${stamp}`;
}

/**
 * `groupByDay()` in CallsTabScreen.kt: Today, Yesterday, then a capitalized
 * three-letter weekday inside the last seven days, then "5 Oct". Days are cut in
 * Asia/Dhaka (`DHAKA`), never in the browser's own zone — the same list has to
 * read the same on a phone in Dhaka and a laptop anywhere.
 */
export const CALLS_TIME_ZONE = "Asia/Dhaka";

export type CallDaySection = { readonly label: string; readonly rows: readonly CallRow[] };

function dhakaParts(iso: string, nowMs: number): { y: number; m: number; d: number } | null {
  const at = Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : nowMs;
  try {
    const format = new Intl.DateTimeFormat("en-CA", {
      timeZone: CALLS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [y, m, d] = format.format(new Date(at)).split("-").map(Number);
    if (!y || !m || !d) return null;
    return { y: y!, m: m!, d: d! };
  } catch {
    return null;
  }
}

function daysBetween(
  from: { y: number; m: number; d: number },
  to: { y: number; m: number; d: number },
): number {
  const utc = (p: { y: number; m: number; d: number }) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;
  return utc(from) - utc(to);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * One row's day label. Unparseable timestamps fall back to today, which is what
 * the phone does (`?: today`) so a bad row never invents its own section.
 */
export function callDayLabel(iso: string, nowMs: number = Date.now()): string {
  const today = dhakaParts(new Date(nowMs).toISOString(), nowMs);
  const day = dhakaParts(iso, nowMs);
  if (!today || !day) return "Today";
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 0 && diff < 7) {
    const weekday = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
    return WEEKDAYS[weekday] ?? "Today";
  }
  return `${day.d} ${MONTHS[(day.m ?? 1) - 1] ?? "Jan"}`;
}

/**
 * Sections in the order the rows arrived (the Worker sends newest first), which
 * is what the phone's `LinkedHashMap` preserves.
 */
export function groupCallsByDay(
  rows: readonly CallRow[],
  nowMs: number = Date.now(),
): readonly CallDaySection[] {
  const order: string[] = [];
  const buckets = new Map<string, CallRow[]>();
  for (const row of rows) {
    const label = callDayLabel(row.createdAt, nowMs);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    buckets.set(label, [row]);
    order.push(label);
  }
  return order.map((label) => ({ label, rows: buckets.get(label)! }));
}

/* ------------------------------------------------------------------ ringing */

/**
 * The status line, in the phone's order (CallScreens.kt:526). `busy` and
 * `onHold` are client phases; `connected` is "this phone's media is up"; the
 * timer replaces the word once a second has passed.
 */
export type CallStatusLine = {
  readonly phase: CallPhase;
  readonly incoming: boolean;
  readonly otherOnline: boolean;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly onHold: boolean;
  readonly sharing: boolean;
  readonly seconds: number;
};

export function callStatusText(line: CallStatusLine): string {
  if (line.phase === "busy") return CALL_COPY.statusBusy;
  if (line.onHold) return CALL_COPY.statusOnHold;
  if (line.sharing) return CALL_COPY.sharing;
  if (line.phase === "connecting" || (line.connected && line.connecting)) {
    return CALL_COPY.statusConnecting;
  }
  if (line.connected)
    return line.seconds > 0 ? clockText(line.seconds) : CALL_COPY.statusConnecting;
  if (line.phase === "incoming") return CALL_COPY.statusRinging;
  return line.otherOnline ? CALL_COPY.statusRinging : CALL_COPY.statusCalling;
}

/** The ring screen's own line: "Incoming voice call…" / "Incoming video call…". */
export function incomingCallLine(kind: CallKind): string {
  return kind === "VIDEO" ? CALL_COPY.incomingVideo : CALL_COPY.incomingVoice;
}

/** A row still ringing that the callee must not see yet (the phantom window). */
export function callIsPhantom(row: CallRow, meId: string, nowMs: number = Date.now()): boolean {
  if (row.status !== "RINGING" || !row.incoming || row.callerId === meId) return false;
  if (!row.createdAt) return false;
  return nowMs - Date.parse(row.createdAt) < CALL_PHANTOM_RING_MS;
}

/**
 * The client's own ceiling on an outgoing ring: past a minute with no answer the
 * screen closes and says "No answer", instead of ringing until the server's
 * reaper notices.
 */
export function outgoingRingTimedOut(ringStartedAt: number, nowMs: number = Date.now()): boolean {
  if (!ringStartedAt) return false;
  return nowMs - ringStartedAt > CALL_OUTGOING_RING_LIMIT_MS;
}

/* ------------------------------------------------------- E2EE (E2eeCall.kt) */

/**
 * The SHA-256 DTLS fingerprint hex out of an SDP document: uppercased, colons
 * removed, and null when the SDP carries none or the hex is not hex. Call media
 * is DTLS-SRTP (inherently encrypted) — what this verifies is WHOSE key the
 * connection used, because the SDP itself is relayed by the server.
 */
export function dtlsFingerprint(sdp: string | null | undefined): string | null {
  if (!sdp) return null;
  const line = sdp
    .split(/\r?\n/)
    .find((candidate) => candidate.toLowerCase().includes("fingerprint:"));
  if (!line) return null;
  const hex = (line.trim().split(/\s+/).pop() ?? "").replace(/:/g, "").toUpperCase();
  if (hex.length < 40 || !/^[0-9A-F]+$/.test(hex)) return null;
  return hex;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("no subtle crypto");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * The order-independent safety code: both ends feed the same two fingerprints
 * and read the same "XXXX XXXX XXXX" aloud. Sorting the pair first is what makes
 * it order-independent — the caller and the callee compute it from opposite
 * local/remote sides and must land on the same string.
 */
export async function callSafetyCode(fpA: string, fpB: string): Promise<string> {
  const [lo, hi] = fpA <= fpB ? [fpA, fpB] : [fpB, fpA];
  const hex = await sha256Hex(lo + hi);
  return hex
    .slice(0, 12)
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** The sheet's own instruction, with the peer's name in it. */
export function e2eeSheetCopy(peerName: string): string {
  return `Nobody — not even KuchuPuchu — can listen to this call. Read this code aloud with ${peerName}: if it matches on both phones, no one is in the middle.`;
}

export function e2eeChangedCopy(peerName: string): string {
  return `This code differs from your last call — ${peerName} may have reinstalled, or someone may be intercepting. Only trust it after comparing aloud.`;
}

export const CALL_TRUST_KEY = "kp.calls.trust";

type TrustMap = Record<string, string>;

function readTrust(raw: string | null): TrustMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: TrustMap = {};
    for (const [peerId, fingerprint] of Object.entries(parsed)) {
      if (peerId && typeof fingerprint === "string") out[peerId] = fingerprint;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Trust-on-first-use. Returns the verdict for this peer's fingerprint:
 * `first` stores it silently and says nothing, `same` is a clean repeat, and
 * `changed` is the warning — the new print is stored ONLY by `trustCallPeer`,
 * never silently (E2eeCall.checkPeer).
 */
export function checkCallTrust(
  raw: string | null,
  peerId: string,
  fingerprint: string,
): { verdict: "first" | "same" | "changed"; next: string } {
  if (!peerId || !fingerprint) return { verdict: "same", next: raw ?? "" };
  const map = readTrust(raw);
  const previous = map[peerId] ?? "";
  if (!previous) {
    map[peerId] = fingerprint;
    return { verdict: "first", next: JSON.stringify(map) };
  }
  if (previous === fingerprint) return { verdict: "same", next: raw ?? "" };
  return { verdict: "changed", next: raw ?? "" };
}

/** The user compared codes aloud and accepts the peer's new fingerprint. */
export function trustCallPeer(raw: string | null, peerId: string, fingerprint: string): string {
  if (!peerId || !fingerprint) return raw ?? "";
  const map = readTrust(raw);
  map[peerId] = fingerprint;
  return JSON.stringify(map);
}

/* --------------------------------------------------------------- ICE / TURN */

export type IceServer = {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
};

/**
 * The phone's built-in list (CallEngine.builtInIceServers): three public STUN
 * servers, then Nextcloud's relay on 443 leading the TURN entries, then the
 * openrelay fallbacks. Order matters — a worker-minted relay goes FIRST when
 * `/api/config/ice` answers one, and these carry on when it does not.
 */
export const BUILT_IN_ICE_SERVERS: readonly IceServer[] = Object.freeze([
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:turn.nextcloud.com:443?transport=tcp", "turn:turn.nextcloud.com:443"],
    username: "nextcloud",
    credential: "nextcloud",
  },
  {
    urls: [
      "turn:standard.relay.metered.ca:80",
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
]);

/**
 * The relay-first retry list: after ICE FAILED the phone drops the STUN-only
 * entries and keeps TCP/TLS relays, because direct and peer-reflexive pairing is
 * what dies behind a VPN or carrier-grade NAT (CallEngine.relayFirstIceServers).
 */
export const RELAY_FIRST_ICE_SERVERS: readonly IceServer[] = Object.freeze([
  {
    urls: [
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443?transport=tcp",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
]);

/**
 * `GET /api/config/ice` answers `{ ice: { urls, username, credential } }` or
 * `{ ice: null }` when the deploy has no TURN configured. A partial or hostile
 * answer must degrade to the built-ins, never to a call with no relay at all.
 */
export function parseIceConfig(payload: unknown): IceServer | null {
  if (!isRecord(payload)) return null;
  const ice = payload.ice;
  if (!isRecord(ice)) return null;
  const urls = Array.isArray(ice.urls)
    ? ice.urls.map((url) => text(url, 300)).filter((url) => url !== "")
    : [];
  if (!urls.length) return null;
  const username = text(ice.username, 300);
  const credential = text(ice.credential, 300);
  return username && credential ? { urls, username, credential } : { urls };
}

/** The list a new peer connection is built with: the minted relay first. */
export function iceServersFor(minted: IceServer | null): readonly IceServer[] {
  return minted ? [minted, ...BUILT_IN_ICE_SERVERS] : BUILT_IN_ICE_SERVERS;
}

/** The list the single automatic retry after ICE FAILED uses. */
export function relayIceServersFor(minted: IceServer | null): readonly IceServer[] {
  return minted ? [minted, ...RELAY_FIRST_ICE_SERVERS] : RELAY_FIRST_ICE_SERVERS;
}

/* ------------------------------------------------------- media + permission */

export type CallMediaRequest = {
  readonly audio: boolean;
  readonly video: boolean;
};

/** What the phone asks for: mic always, camera on a video call (gateMicCamera). */
export function mediaRequestFor(kind: CallKind): CallMediaRequest {
  return { audio: true, video: kind === "VIDEO" };
}

/**
 * `getUserMedia` refusal, in the browser's own words. The phone maps a denied
 * permission to a sheet; a browser maps it to a `DOMException.name`, and each
 * name needs its own line — "NotAllowedError" after a remembered block is not
 * the same situation as no microphone existing at all.
 */
export const CALL_PERMISSION_COPY: Readonly<Record<string, string>> = Object.freeze({
  NotAllowedError:
    "Microphone and camera access is blocked for this site. Allow them in the browser's address bar, then try the call again.",
  PermissionDeniedError:
    "Microphone and camera access is blocked for this site. Allow them in the browser's address bar, then try the call again.",
  NotFoundError:
    "No microphone was found. A call needs one — plug in a microphone or pick a different device, then try again.",
  DevicesNotFoundError:
    "No microphone was found. A call needs one — plug in a microphone or pick a different device, then try again.",
  NotReadableError:
    "Another program is using the microphone or camera. Close it, then try the call again.",
  TrackStartError:
    "Another program is using the microphone or camera. Close it, then try the call again.",
  OverconstrainedError:
    "This device cannot provide the audio or video the call asked for. Try a different microphone or camera.",
  ConstraintNotSatisfiedError:
    "This device cannot provide the audio or video the call asked for. Try a different microphone or camera.",
  AbortError: "The call was cancelled before the microphone could start.",
  SecurityError: "This browser only allows calls on a secure (https) page. Nothing was recorded.",
});

export const CALL_PERMISSION_FALLBACK =
  "The microphone or camera could not be started. Check the browser's site permissions and try again.";

export function permissionCopy(error: unknown): string {
  const name =
    error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  return CALL_PERMISSION_COPY[name] ?? CALL_PERMISSION_FALLBACK;
}

/** A camera-only refusal reads differently from a microphone one. */
export function cameraPermissionCopy(error: unknown): string {
  const name =
    error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found. The call can go on as a voice call.";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "Camera access is blocked for this site. Allow it in the browser's address bar to switch video on.";
  return permissionCopy(error);
}

export function screenShareDeniedCopy(error: unknown): string {
  const name =
    error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Screen sharing was cancelled or is not allowed here.";
  return "The screen could not be shared. Try again.";
}

export type AudioOutputChoice = {
  readonly deviceId: string;
  readonly label: string;
};

/**
 * The audio-output list. `enumerateDevices()` hides labels until permission has
 * been granted, which on a call it always has by then; an unlabeled device is
 * still selectable, so it is named by its position instead of dropped. The
 * empty string is "the browser's own default".
 */
export function audioOutputChoices(
  devices: readonly { deviceId?: string; kind?: string; label?: string }[],
): readonly AudioOutputChoice[] {
  const outputs = devices.filter((device) => device.kind === "audiooutput" && device.deviceId);
  return outputs.map((device, index) => ({
    deviceId: device.deviceId ?? "",
    label: device.label?.trim() || `Output ${index + 1}`,
  }));
}

/**
 * Whether moving the call's audio is even possible here. `setSinkId` is
 * Chromium-only and needs a secure context; everywhere else the honest answer is
 * the browser's own picker, and the UI says so instead of showing a dead control.
 */
export function audioOutputSupported(element: { setSinkId?: unknown } | null | undefined): boolean {
  return typeof element?.setSinkId === "function";
}

export const AUDIO_OUTPUT_UNSUPPORTED_COPY =
  "This browser has no device picker for call audio — sound follows the system default output.";

/* ------------------------------------------------------- signalling frames */

/**
 * The `/ws/call/:id` frames the Worker relays (broadcastCallEvent). They are
 * TRIGGERS, not state: D1 is the source of truth and a dropped socket degrades
 * to the poll, exactly as the DO's own header comment says. So the parse keeps
 * only what a client needs to decide "fetch now", plus the ICE candidate — which
 * is delivered inline because waiting for a poll would add a second of audio gap.
 */
export type CallFrame =
  | { type: "hello"; user: string; participants: number }
  | {
      type: "call";
      callId: string;
      status: string;
      kind: CallKind;
      callerId: string;
      calleeId: string;
      joined: string;
      left: string;
    }
  | {
      type: "ice";
      callId: string;
      from: string;
      to: string;
      candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number };
      createdAt: string;
    }
  | { type: "peer"; callId: string; from: string; to: string; answer: boolean }
  | { type: "reoffer"; callId: string }
  | { type: "reanswer"; callId: string }
  | {
      type: "media";
      callId: string;
      userId: string;
      camera: boolean;
      screen: boolean;
      kind: CallKind;
    };

export function parseCallFrame(raw: unknown): CallFrame | null {
  if (typeof raw !== "string" || !raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  const type = text(payload.type, 32);
  switch (type) {
    case "hello":
      return {
        type,
        user: text(payload.user, 64),
        participants: Number.isFinite(Number(payload.participants))
          ? Number(payload.participants)
          : 0,
      };
    case "call":
      return {
        type,
        callId: text(payload.callId, 64),
        status: text(payload.status, 16).toUpperCase(),
        kind: parseCallKind(payload.kind),
        callerId: text(payload.callerId, 64),
        calleeId: text(payload.calleeId, 64),
        joined: text(payload.joined, 64),
        left: text(payload.left, 64),
      };
    case "ice": {
      const candidate = isRecord(payload.candidate) ? payload.candidate : {};
      const rawCandidate = text(candidate.candidate, 3_000);
      if (!rawCandidate) return null;
      const index = Number(candidate.sdpMLineIndex);
      return {
        type,
        callId: text(payload.callId, 64),
        from: text(payload.from, 64),
        to: typeof payload.to === "string" ? text(payload.to, 64) : "",
        candidate: {
          candidate: rawCandidate,
          sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
          sdpMLineIndex: Number.isFinite(index) ? index : 0,
        },
        createdAt: isoText(payload.createdAt),
      };
    }
    case "peer":
      return {
        type,
        callId: text(payload.callId, 64),
        from: text(payload.from, 64),
        to: text(payload.to, 64),
        answer: payload.answer === true,
      };
    case "reoffer":
    case "reanswer":
      return { type, callId: text(payload.callId, 64) };
    case "media":
      return {
        type,
        callId: text(payload.callId, 64),
        userId: text(payload.userId, 64),
        camera: payload.camera === true,
        screen: payload.screen === true,
        kind: parseCallKind(payload.kind),
      };
    default:
      return null;
  }
}

/**
 * The `/ws/user` frame that rings a browser: the Worker broadcasts
 * `{type:"call", callId, kind, fromId, fromName}` on the callee's user room 700
 * ms after the row is written, and only while it is STILL ringing (the
 * anti-phantom gate). A mute-for-calls member never gets it at all.
 */
export type IncomingCallPing = {
  readonly callId: string;
  readonly kind: CallKind;
  readonly fromId: string;
  readonly fromName: string;
};

export function parseIncomingCallPing(raw: unknown): IncomingCallPing | null {
  if (typeof raw !== "string" || !raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload) || text(payload.type, 32) !== "call") return null;
  const callId = text(payload.callId, 64);
  if (!callId) return null;
  return {
    callId,
    kind: parseCallKind(payload.kind),
    fromId: text(payload.fromId, 64),
    fromName: text(payload.fromName, 120),
  };
}

/** The candidate body `POST /api/calls/:id/ice` accepts (1:1 shape). */
export function iceCandidateBody(candidate: {
  candidate?: string | null;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}): Record<string, unknown> {
  return {
    candidate: {
      candidate: String(candidate.candidate ?? ""),
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
    },
  };
}

/* ------------------------------------------------------------ chat placement */

/**
 * The chat header's gate lives in `callGate.ts` — the one tiny module the
 * messaging chunk imports — and is re-exported here so the calls chunk and the
 * contract case have a single import path for it.
 */
export {
  CALL_GATE_REASONS,
  callPlacement,
  type CallPlacement,
  type CallPlacementVerdict,
} from "./callGate";
