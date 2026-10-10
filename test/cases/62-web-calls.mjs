/**
 * Web calls contract (slice G).
 *
 * Same discipline as cases 57–61: every rule is compared with the source that
 * owns it. The history row, its labels and its day sections come out of
 * `CallsTabScreen.kt`; the ring line, the control labels and the clock format out
 * of `CallScreens.kt`; the poll cadence, the SDP constraints, the pre-added video
 * m-line, the connected-clock rule, the relay retry and the ICE watchdog out of
 * `CallEngine.kt`; the safety code and its trust-on-first-use out of `E2eeCall.kt`;
 * the header gate out of `ChatScreen.kt`; and what the server accepts, refuses,
 * stores and strips out of `src/worker/index.ts`.
 *
 * The rules that hurt if they drift:
 *
 * - A call the callee never saw must not ring them (the Worker's 1.6 s
 *   anti-phantom window and the client's re-check after it).
 * - The caller's timer must start when THIS device's media comes up, not from the
 *   server's `started_at` — the bug that seeded a caller at 0:07 while the callee
 *   still heard ringback.
 * - A camera switched on must flip the row to VIDEO server-side, and a screen
 *   share must NOT — otherwise the two sides disagree about which UI they are in.
 * - History rows must arrive LIGHT: no SDP. A client that expected SDP there
 *   would be a client that re-broke the 19x payload the Worker fixed.
 * - A group call must be REFUSED with a reason, never half-run: the Web has no
 *   measured participant cap, so a mesh here would silently drop members.
 * - The safety code must be the same string on both ends, which means the same
 *   order-independent hash the phone computes.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AUDIO_OUTPUT_UNSUPPORTED_COPY,
  BUILT_IN_ICE_SERVERS,
  CALL_ACTIVE_TIMEOUT_MS,
  CALL_CODE_VISIBLE_MS,
  CALL_COPY,
  CALL_ICE_WATCHDOG_MS,
  CALL_NET_FAIL_STREAK,
  CALL_NOTICE_MS,
  CALL_OUTGOING_RING_LIMIT_MS,
  CALL_PHANTOM_RECHECK_MS,
  CALL_PHANTOM_RING_MS,
  CALL_POLL_BACKGROUND_MS,
  CALL_POLL_FOREGROUND_MS,
  CALL_POLL_IN_CALL_MS,
  CALL_POLL_MEDIA_UP_MS,
  CALL_PHASES,
  CALL_POLL_SIGNAL_LIVE_MS,
  CALL_RECONNECTING_COPY,
  CALL_REFUSALS,
  CALL_SDP_CONSTRAINTS,
  CALL_STATUSES,
  CALL_TRUST_KEY,
  CALLS_HISTORY_LIMIT,
  CALLS_HISTORY_STALE_MS,
  CALL_PERMISSION_FALLBACK,
  RELAY_FIRST_ICE_SERVERS,
  audioOutputChoices,
  audioOutputSupported,
  callDayLabel,
  callDurationSeconds,
  callHistoryLabel,
  callHistoryLine,
  callIsMissed,
  callIsPhantom,
  callPeerAvatar,
  callPeerId,
  callPeerName,
  callBackTarget,
  callPollDelayMs,
  callRefusalCopy,
  callSafetyCode,
  callStatusText,
  cameraPermissionCopy,
  checkCallTrust,
  clockText,
  dtlsFingerprint,
  e2eeChangedCopy,
  e2eeSheetCopy,
  groupCallsByDay,
  iceCandidateBody,
  iceServersFor,
  incomingCallLine,
  isBusyStatus,
  listStamp,
  mediaRequestFor,
  outgoingRingTimedOut,
  parseCallFrame,
  parseCallKind,
  parseCallList,
  parseCallRow,
  parseIceConfig,
  parseIncomingCallPing,
  permissionCopy,
  relayIceServersFor,
  screenShareDeniedCopy,
  trustCallPeer,
} from "../../web/src/calls/callsModel.ts";
import { callPlacement } from "../../web/src/calls/callGate.ts";
import { callPath, callsApi } from "../../web/src/calls/callsApi.ts";
import { INITIAL_CALL_STATE, createCallEngine } from "../../web/src/calls/callEngine.ts";
import { SHARE_AUDIO_STORE_KEY } from "../../web/src/calls/shareAudioPref.ts";
import { launchCall, registerCallLauncher } from "../../web/src/calls/callBus.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const engineSource = readFileSync(resolve(`${ANDROID}/CallEngine.kt`), "utf8");
const screensSource = readFileSync(resolve(`${ANDROID}/CallScreens.kt`), "utf8");
const tabSource = readFileSync(resolve(`${ANDROID}/CallsTabScreen.kt`), "utf8");
const e2eeSource = readFileSync(resolve(`${ANDROID}/E2eeCall.kt`), "utf8");
const chatSource = readFileSync(resolve(`${ANDROID}/ChatScreen.kt`), "utf8");
const signalSource = readFileSync(resolve("src/worker/durable-objects/CallSignal.ts"), "utf8");
const webModel = readFileSync(resolve("web/src/calls/callsModel.ts"), "utf8");
const webEngine = readFileSync(resolve("web/src/calls/callEngine.ts"), "utf8");
const webApi = readFileSync(resolve("web/src/calls/callsApi.ts"), "utf8");
const webStage = readFileSync(resolve("web/src/calls/CallStage.tsx"), "utf8");
const webLayer = readFileSync(resolve("web/src/calls/CallsLayer.tsx"), "utf8");
const webTab = readFileSync(resolve("web/src/calls/CallsWorkspace.tsx"), "utf8");
const webApp = readFileSync(resolve("web/src/App.tsx"), "utf8");
const webChatPane = readFileSync(resolve("web/src/messaging/ChatPane.tsx"), "utf8");
const webFlags = readFileSync(resolve("web/src/featureFlagRegistry.ts"), "utf8");
const webSockets = readFileSync(resolve("web/src/messaging/sockets.ts"), "utf8");

const ME = "u_me";
const PEER = "u_peer";

/* ------------------------------------------------------------ fixtures ---- */

/** A 1:1 call row in the Worker's `callFrom()` shape. */
const row = (fields = {}) => ({
  id: "3f2b7c1e-1111-4000-8000-000000000001",
  kind: "AUDIO",
  status: "RINGING",
  incoming: false,
  conversationId: "c_pair",
  callerId: ME,
  calleeId: PEER,
  offerSdp: "",
  answerSdp: "",
  startedAt: null,
  endedAt: null,
  createdAt: "2026-10-05T04:00:00.000Z",
  other: {
    id: PEER,
    displayName: "Rina",
    username: "rina",
    avatarUrl: null,
    avatarRef: `${PEER}@v3`,
    online: true,
    privateProfile: false,
  },
  ...fields,
});

const NOW = Date.parse("2026-10-05T06:30:00.000Z");

/* =============================================== the server's call surface == */

check(
  "the Worker's call block is the one the client wraps",
  workerSource.includes("/* ---------- calls ---------- */"),
);
for (const route of [
  'path === "/api/calls" && method === "POST"',
  'path === "/api/calls/group" && method === "POST"',
  "/api\\/calls\\/([^/]+)\\/join$",
  "/api\\/calls\\/([^/]+)\\/peer$",
  'path === "/api/calls/active" && method === "GET"',
  'path === "/api/calls/history" && method === "GET"',
  "/api\\/calls\\/([^/]+)\\/answer$",
  "/api\\/calls\\/([^/]+)\\/decline$",
  "/api\\/calls\\/([^/]+)\\/end$",
  "/api\\/calls\\/([^/]+)\\/ice$",
  "/api\\/calls\\/([^/]+)\\/reoffer$",
  "/api\\/calls\\/([^/]+)\\/reanswer$",
  "/api\\/calls\\/([^/]+)\\/media$",
]) {
  check(`the Worker serves ${route.replace(/\\/g, "")}`, workerSource.includes(route));
}

check(
  "the client wraps every 1:1 route and none of the group mesh",
  webApi.includes('"/api/calls/active"') &&
    webApi.includes('"/api/calls/history"') &&
    webApi.includes('"/api/calls"') &&
    webApi.includes('"/answer"') &&
    webApi.includes('"/decline"') &&
    webApi.includes('"/end"') &&
    webApi.includes('"/ice"') &&
    webApi.includes('"/reoffer"') &&
    webApi.includes('"/reanswer"') &&
    webApi.includes('"/media"') &&
    !webApi.includes('"/api/calls/group"') &&
    !webApi.includes('"/join"') &&
    !webApi.includes('"/peer"') &&
    webApi.includes("The group routes"),
);

check(
  "a call id is addressed only in its own UUID shape",
  callPath("3f2b7c1e-1111-4000-8000-000000000001", "/end") ===
    "/api/calls/3f2b7c1e-1111-4000-8000-000000000001/end",
);
let refused = 0;
try {
  callPath("../../etc/passwd");
} catch {
  refused += 1;
}
try {
  callPath("a%2Fb");
} catch {
  refused += 1;
}
check("an id that is not an id never reaches a URL", refused === 2);

check(
  "the Worker's phantom-ring window is 1.6 s and the client copies it",
  workerSource.includes("const PHANTOM_RING_MS = 1_600;") && CALL_PHANTOM_RING_MS === 1_600,
);
check(
  "a ring younger than the window is invisible to the callee",
  workerSource.includes('row.status === "RINGING" &&\n        row.callee_id === uid &&') &&
    workerSource.includes("Date.now() - Date.parse(row.created_at) < PHANTOM_RING_MS"),
);
check(
  "the client re-checks one phantom window later, like the phone's second poke",
  engineSource.includes("delay(1_200); pokeTick()") && CALL_PHANTOM_RECHECK_MS === 1_200,
);

check(
  "486 is the Worker's line-busy status and the client reads it as busy",
  workerSource.includes('fail(486, "Line busy — on another call right now.", "LINE_BUSY")') &&
    isBusyStatus(486) &&
    !isBusyStatus(403) &&
    CALL_REFUSALS.LINE_BUSY === "Line busy — on another call right now.",
);
check(
  "busy excludes the same pair, so a redial is never blocked by its own corpse",
  workerSource.includes("AND NOT (caller_id IN (?, ?) AND callee_id IN (?, ?))"),
);
check(
  "every refusal the Worker can return has a line the user reads",
  workerSource.includes('"MSG_PRIVACY"') &&
    workerSource.includes('"REQUEST_PENDING"') &&
    workerSource.includes('"BOT_ACCOUNT"') &&
    workerSource.includes('"BLOCKED"') &&
    callRefusalCopy("MSG_PRIVACY") === "This user isn't accepting calls." &&
    callRefusalCopy("REQUEST_PENDING") === "Accept the message request first." &&
    callRefusalCopy("BOT_ACCOUNT") === "This account can't be called." &&
    callRefusalCopy("BLOCKED") === "They blocked you, so this call cannot go through." &&
    callRefusalCopy("SOMETHING_NEW") === CALL_COPY.startFailed,
);

check(
  "the Worker strips every SDP field from a history row",
  workerSource.includes(
    "const { offerSdp, answerSdp, reofferSdp, reofferFrom, reanswerSdp, media, ...history } = callFrom(",
  ),
);
check(
  "history is capped at 100 rows on the server",
  workerSource.includes(
    "status IN ('ENDED', 'DECLINED', 'MISSED') ORDER BY created_at DESC LIMIT 100",
  ),
);
check(
  "a caller hanging up on a ring is a MISSED call, not a quiet ENDED",
  workerSource.includes(
    'const gaveUp =\n        row.status === "RINGING" &&\n        row.caller_id === uid &&',
  ) && workerSource.includes('const nextStatus = gaveUp ? "MISSED" : "ENDED";'),
);
check(
  "only a participant may end a call",
  workerSource.includes(
    'if (!(await callParticipant(db, row, uid))) fail(403, "Not your call.", "FORBIDDEN")',
  ),
);
check(
  "a camera switched on flips the row's kind; a screen share never does",
  workerSource.includes('const kind = mine.camera === true ? "VIDEO" : row.kind;'),
);
check(
  "an ICE candidate is stored as the whole object, never stringified flat",
  workerSource.includes(
    'if (!candidate || candidate === "[object Object]") fail(400, "Missing candidate.")',
  ),
);
check(
  "the signalling room admits only the two participants",
  workerSource.includes("const wsCallMatch = path.match(/^\\/ws\\/call\\/([^/]+)$/)") &&
    signalSource.includes("The worker route has ALREADY authenticated the"),
);
check(
  "the signalling socket is receive-only, so nobody can spoof into it",
  signalSource.includes("sockets are receive-only"),
);
check(
  "the room counts a socket alive only inside its 45 s heartbeat window",
  readFileSync(resolve("src/worker/durable-objects/liveness.ts"), "utf8").includes(
    "export const STALE_MS = 45_000;",
  ),
);
check(
  "the call socket reuses the messaging heartbeat rather than inventing one",
  webSockets.includes("readonly parseFrame?: (raw: unknown) => TFrame | null;") &&
    readFileSync(resolve("web/src/calls/callSockets.ts"), "utf8").includes("createManagedSocket"),
);

/* ==================================================== the phone's numbers == */

check(
  "the poll cadence is the phone's five branches, in its order",
  engineSource.includes("wsId != null && KpSocket.callLive(wsId) && mediaUp -> 5_000L") &&
    engineSource.includes("wsId != null && KpSocket.callLive(wsId) -> 1_500L") &&
    engineSource.includes("active != null -> 500L") &&
    engineSource.includes("Store.foreground -> 1500L") &&
    engineSource.includes("else -> 4000L") &&
    CALL_POLL_MEDIA_UP_MS === 5_000 &&
    CALL_POLL_SIGNAL_LIVE_MS === 1_500 &&
    CALL_POLL_IN_CALL_MS === 500 &&
    CALL_POLL_FOREGROUND_MS === 1_500 &&
    CALL_POLL_BACKGROUND_MS === 4_000,
);
check(
  "a live socket with media up is the slowest branch",
  callPollDelayMs({ signalLive: true, mediaUp: true, active: true, visible: true }) === 5_000,
);
check(
  "a live socket before media keeps the tight cadence",
  callPollDelayMs({ signalLive: true, mediaUp: false, active: true, visible: true }) === 1_500,
);
check(
  "a call with no socket polls hardest",
  callPollDelayMs({ signalLive: false, mediaUp: false, active: true, visible: true }) === 500,
);
check(
  "no call at all falls back to the foreground and background cadences",
  callPollDelayMs({ signalLive: false, mediaUp: false, active: false, visible: true }) === 1_500 &&
    callPollDelayMs({ signalLive: false, mediaUp: false, active: false, visible: false }) === 4_000,
);
check(
  "a hidden tab is the phone's background case, not a stopped poll",
  engineSource.includes("else -> 4000L") &&
    webEngine.includes("visible: visible()") &&
    webLayer.includes("visibilityOf") &&
    CALL_POLL_BACKGROUND_MS === 4_000,
);

check(
  "the phone times its /active read out at 4.5 s",
  engineSource.includes("withTimeoutOrNull(4_500)") && CALL_ACTIVE_TIMEOUT_MS === 4_500,
);
check(
  "three failed reads pause an established call clock and the reconnect label replaces the timer",
  engineSource.includes("netFailStreak >= 3") &&
    engineSource.includes("beginReconnecting()") &&
    !engineSource.includes('notify("Reconnecting…")') &&
    readFileSync(
      resolve("native-android/app/src/main/java/app/kuchupuchu/android/CallScreens.kt"),
      "utf8",
    ).includes('call.reconnecting -> "Reconnecting…"'),
);
check(
  "an outgoing ring is given up after a minute",
  engineSource.includes("System.currentTimeMillis() - outgoingRingAt > 60_000") &&
    engineSource.includes('notify("No answer")') &&
    CALL_OUTGOING_RING_LIMIT_MS === 60_000 &&
    outgoingRingTimedOut(NOW - 60_001, NOW) === true &&
    outgoingRingTimedOut(NOW - 59_000, NOW) === false &&
    outgoingRingTimedOut(0, NOW) === false,
);
check(
  "ICE stuck in checking is restarted after 12 s",
  engineSource.includes("armIceWatchdog(delayMs: Long = 12_000L)") &&
    CALL_ICE_WATCHDOG_MS === 12_000,
);
check(
  "a busy notice stays on screen for the phone's own beat",
  engineSource.includes("delay(2200)") && CALL_NOTICE_MS === 2_200,
);
check(
  "the tab's own numbers are the phone's: a 100-row page cached for 20 s",
  workerSource.includes("ORDER BY created_at DESC LIMIT 100") &&
    CALLS_HISTORY_LIMIT === 100 &&
    CALLS_HISTORY_STALE_MS === 20_000,
);
check(
  "a history line carries the row's stamp, printed by the SAME listStamp",
  callHistoryLine(
    parseCallRow(
      row({
        status: "ENDED",
        createdAt: "2026-10-05T04:00:00.000Z",
        startedAt: "2026-10-05T04:00:00.000Z",
        endedAt: "2026-10-05T04:02:00.000Z",
      }),
    ),
    listStamp("2026-10-05T04:00:00.000Z"),
  ).startsWith("Voice call · 2:00 · ") &&
    readFileSync(resolve("web/src/status/statusModel.ts"), "utf8").includes(
      'export { listStamp } from "../time/dhakaTime";',
    ),
);
check(
  "the history cache is 20 s and the tab refetches on a version bump",
  tabSource.includes("System.currentTimeMillis() - lastCallsFetch < 20_000") &&
    tabSource.includes(
      "ScreenStore.callsVersion > 0 && ScreenStore.callsVersion != lastCallsVersion",
    ),
);

check(
  "three failed reads begin recovery without an extra Reconnecting toast",
  engineSource.includes("netFailStreak >= 3") &&
    engineSource.includes("beginReconnecting()") &&
    !engineSource.includes('notify("Reconnecting…")') &&
    CALL_NET_FAIL_STREAK === 3 &&
    CALL_RECONNECTING_COPY === "Reconnecting…",
);
check(
  "the web client states the same intent the phone's sdpConstraints states",
  CALL_SDP_CONSTRAINTS.offerToReceiveAudio === true &&
    CALL_SDP_CONSTRAINTS.offerToReceiveVideo === true &&
    webEngine.includes("the receive-audio/receive-video intent"),
);
check(
  "an ICE candidate body is the nested object the Worker reads",
  JSON.stringify(
    iceCandidateBody({ candidate: "candidate:1", sdpMid: null, sdpMLineIndex: null }),
  ) === '{"candidate":{"candidate":"candidate:1","sdpMid":null,"sdpMLineIndex":0}}',
);
check(
  "the offer asks to receive audio AND video",
  engineSource.includes('MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true")') &&
    engineSource.includes('MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true")'),
);
check(
  "the CALLER pre-adds a sendrecv video m-line on a voice call",
  engineSource.includes("if (videoTrack == null && preaddVideo)") &&
    engineSource.includes("RtpTransceiver.RtpTransceiverDirection.SEND_RECV"),
);
check(
  "the callee must NOT pre-add one — it flips the offer's own m-line instead",
  engineSource.includes("newPc(preaddVideo = false)") &&
    engineSource.includes("?.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_RECV)") &&
    webEngine.includes('?.setDirection("sendrecv")'),
);
check(
  "the web caller pre-adds the same m-line for the same reason",
  webEngine.includes('connection.addTransceiver("video", {') &&
    webEngine.includes('direction: "sendrecv",') &&
    webEngine.includes("streams: localStream ? [localStream] : [],") &&
    webEngine.includes("if (!cameraTrack && preAddVideo)") &&
    readFileSync(resolve("web/src/calls/peerRuntime.ts"), "utf8").includes(
      "...(streams.length > 0 ? { streams } : {}),",
    ),
);
check(
  "the clock starts when THIS device's media comes up, not from started_at",
  engineSource.includes(
    "override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?)",
  ) &&
    engineSource.includes("fun markConnected()") &&
    engineSource.includes("active = connectedCallState(cur)") &&
    engineSource.includes("private fun connectedCallState(cur: CallUi): CallUi") &&
    webEngine.includes("const markConnected = () => {") &&
    webEngine.includes("connectedAt: clock.now()"),
);
check(
  "ICE failure gets exactly one relay-first rescue",
  engineSource.includes("if (!relayRetryUsed && pc != null)") &&
    engineSource.includes("relayRetryUsed = true") &&
    engineSource.includes("beginReconnecting()") &&
    !engineSource.includes('notify("Network is limited — connecting through a relay…")') &&
    webEngine.includes("if (!relayRetryUsed) {"),
);
check(
  "candidates born before the id exists are buffered and flushed",
  engineSource.includes("pendingIce.add(body)") &&
    engineSource.includes("fun flushIce()") &&
    webEngine.includes("pendingIce.push(candidate)") &&
    webEngine.includes("const flushIce = () => {"),
);
check(
  "a candidate with no remote description waits for the poll",
  engineSource.includes("if (peer.remoteDescription == null) return false") &&
    webEngine.includes("if (!connection.remoteDescription) return false;"),
);
check(
  "the ICE cursor never moves past a candidate that was not applied",
  webEngine.includes("if (!ok) break;") &&
    webEngine.includes("if (applied > 0) iceCursor = result.items[applied - 1]!.id;") &&
    webEngine.includes("else if (result.items.length === 0 && result.now) iceCursor = result.now;"),
);
check(
  "the same candidate is never applied twice",
  engineSource.includes("if (cand in seenIce) return true") && webEngine.includes("seenIce.has("),
);

check(
  "the relay-first retry drops the STUN-only entries",
  engineSource.includes("private fun relayFirstIceServers()") &&
    RELAY_FIRST_ICE_SERVERS.every((server) => server.urls.every((url) => !url.startsWith("stun:"))),
);
check(
  "the built-in list leads with public STUN and Nextcloud's 443 relay",
  engineSource.includes('"stun:stun.l.google.com:19302"') &&
    engineSource.includes('"stun:stun1.l.google.com:19302"') &&
    engineSource.includes('"stun:stun.cloudflare.com:3478"') &&
    engineSource.includes('"turn:turn.nextcloud.com:443?transport=tcp"') &&
    BUILT_IN_ICE_SERVERS[0].urls[0] === "stun:stun.l.google.com:19302" &&
    BUILT_IN_ICE_SERVERS[3].urls[0] === "turn:turn.nextcloud.com:443?transport=tcp",
);
check(
  "a minted relay goes FIRST, and no mint still leaves the built-ins",
  iceServersFor({ urls: ["turn:relay.example:443"], username: "u", credential: "c" })[0].urls[0] ===
    "turn:relay.example:443" &&
    iceServersFor(null) === BUILT_IN_ICE_SERVERS &&
    relayIceServersFor(null) === RELAY_FIRST_ICE_SERVERS,
);
check(
  "the Worker mints TURN credentials and answers null when it has none",
  workerSource.includes('if (path === "/api/config/ice" && method === "GET")') &&
    workerSource.includes("if (!urls.length) return json({ ice: null });"),
);
check(
  "a missing or partial ice config degrades to the built-ins, never to nothing",
  parseIceConfig({ ice: null }) === null &&
    parseIceConfig({ ice: { urls: [] } }) === null &&
    parseIceConfig({ ice: { urls: ["turn:a:443"] } })?.urls[0] === "turn:a:443" &&
    parseIceConfig({ ice: { urls: ["turn:a:443"], username: "u", credential: "c" } })?.username ===
      "u" &&
    parseIceConfig(null) === null &&
    parseIceConfig({ ice: "nonsense" }) === null,
);

/* ================================================= the history row's shape == */

check(
  "the label grammar is the phone's, branch for branch",
  tabSource.includes('"Missed ${if (video) "video" else "voice"} call"') &&
    tabSource.includes('"Cancelled ${if (video) "video" else "voice"} call"') &&
    tabSource.includes('"${if (video) "Video" else "Voice"} call · %d:%02d"'),
);
check(
  "a missed voice call reads Missed voice call",
  callHistoryLabel(parseCallRow(row({ status: "MISSED" }))) === "Missed voice call",
);
check(
  "a declined call is red too — the phone folds it in with missed",
  callHistoryLabel(parseCallRow(row({ status: "DECLINED" }))) === "Missed voice call" &&
    callIsMissed(parseCallRow(row({ status: "DECLINED" }))) === true &&
    tabSource.includes('val missed = status == "MISSED" || status == "DECLINED"'),
);
check(
  "a connected call carries its duration in %d:%02d",
  callHistoryLabel(
    parseCallRow(
      row({
        status: "ENDED",
        startedAt: "2026-10-05T04:00:00.000Z",
        endedAt: "2026-10-05T04:07:05.000Z",
      }),
    ),
  ) === "Voice call · 7:05",
);
check(
  "a video call says Video, capitalised, like the phone's string",
  callHistoryLabel(
    parseCallRow(
      row({
        kind: "VIDEO",
        status: "ENDED",
        startedAt: "2026-10-05T04:00:00.000Z",
        endedAt: "2026-10-05T04:00:09.000Z",
      }),
    ),
  ) === "Video call · 0:09",
);
check(
  "a call that never connected has no duration and no clock",
  callHistoryLabel(parseCallRow(row({ status: "ENDED" }))) === "Voice call" &&
    callDurationSeconds(parseCallRow(row({ status: "ENDED" }))) === 0,
);
check(
  "a cancelled call says Cancelled",
  callHistoryLabel(parseCallRow(row({ status: "CANCELLED" }))) === "Cancelled voice call",
);
check(
  "a group row names the group and keeps its own three branches",
  callHistoryLabel(parseCallRow(row({ group: true, status: "MISSED", title: "Class of 2026" }))) ===
    "Missed group voice call" &&
    callHistoryLabel(
      parseCallRow(
        row({
          group: true,
          status: "ENDED",
          title: "Class of 2026",
          startedAt: "2026-10-05T04:00:00.000Z",
          endedAt: "2026-10-05T04:31:00.000Z",
        }),
      ),
    ) === "Group voice call · 31:00" &&
    tabSource.includes('"Group ${if (video) "video" else "voice"} call · %d:%02d"'),
);
check(
  "the clock never prints a negative or a fractional second",
  clockText(0) === "0:00" &&
    clockText(-5) === "0:00" &&
    clockText(59.9) === "0:59" &&
    clockText(600) === "10:00",
);
check(
  "the clock format is the phone's own function",
  screensSource.includes(
    'private fun clockText(secs: Int): String = "%d:%02d".format(secs / 60, secs % 60)',
  ),
);

check(
  "the peer of a row is the other side of it",
  callPeerId(parseCallRow(row()), ME) === PEER &&
    callPeerId(parseCallRow(row({ incoming: true, callerId: PEER, calleeId: ME })), ME) === PEER &&
    callPeerId(parseCallRow(row({ callerId: "x", calleeId: "y" })), ME) === "",
);
check(
  "a group row's call-back target is the conversation, not a person",
  callBackTarget(parseCallRow(row({ group: true, conversationId: "c_g" })), ME) === "c_g" &&
    callBackTarget(parseCallRow(row()), ME) === PEER &&
    tabSource.includes('if (group) call.optText("conversationId") else callPeerId(call)'),
);
check(
  "a light history row names itself from its avatarRef, not a missing avatarUrl",
  callPeerAvatar(parseCallRow(row())) === `${PEER}@v3` &&
    callPeerName(parseCallRow(row())) === "Rina" &&
    tabSource.includes(
      'val avatarRef = if (group) call.optIso("avatarRef") else other?.optIso("avatarRef")',
    ),
);
check(
  "a row with no name at all is Unknown, never blank",
  callPeerName(parseCallRow(row({ other: null }))) === "Unknown" &&
    tabSource.includes('?: "Unknown"'),
);

check(
  "day sections are Today, Yesterday, weekday, then day-and-month",
  tabSource.includes('day == today -> "Today"') &&
    tabSource.includes('day == today.minusDays(1) -> "Yesterday"') &&
    tabSource.includes("today.toEpochDay() - day.toEpochDay() < 7"),
);
check(
  "the sections are cut in Dhaka, not in the browser's own zone",
  tabSource.includes(".atZone(DHAKA).toLocalDate()") &&
    webModel.includes('CALLS_TIME_ZONE = "Asia/Dhaka"'),
);
check(
  "today, yesterday and a weekday read the way the phone reads them",
  callDayLabel("2026-10-05T04:00:00.000Z", NOW) === "Today" &&
    callDayLabel("2026-10-04T04:00:00.000Z", NOW) === "Yesterday" &&
    callDayLabel("2026-10-02T04:00:00.000Z", NOW) === "Fri" &&
    callDayLabel("2026-09-05T04:00:00.000Z", NOW) === "5 Sep",
);
check(
  "a late-evening UTC stamp is already the next day in Dhaka",
  callDayLabel("2026-10-04T19:00:00.000Z", NOW) === "Today",
);
check(
  "an unparseable stamp joins today rather than inventing a section",
  callDayLabel("not-a-date", NOW) === "Today" &&
    callDayLabel("", NOW) === "Today" &&
    tabSource.includes("?: today"),
);
check(
  "sections keep the order the rows arrived in",
  groupCallsByDay(
    [
      parseCallRow(row({ id: "a", createdAt: "2026-10-05T04:00:00.000Z" })),
      parseCallRow(row({ id: "b", createdAt: "2026-10-04T04:00:00.000Z" })),
      parseCallRow(row({ id: "c", createdAt: "2026-10-05T03:00:00.000Z" })),
    ].filter((entry) => entry !== null),
    NOW,
  )
    .map((section) => section.label)
    .join(",") === "Today,Yesterday",
);

/* ==================================================== parsing, hostile input */

check(
  "a row with no id is dropped rather than rendered blank",
  parseCallRow({ kind: "AUDIO" }) === null &&
    parseCallRow(null) === null &&
    parseCallRow("x") === null,
);
check(
  "an unknown kind falls back to AUDIO and an unknown status to RINGING",
  parseCallKind("TELEPATHY") === "AUDIO" &&
    parseCallKind("video") === "VIDEO" &&
    parseCallRow(row({ kind: "HOLO", status: "WEIRD" })).kind === "AUDIO" &&
    parseCallRow(row({ status: "WEIRD" })).status === "RINGING",
);
check(
  "a JSON null timestamp never becomes the string null",
  parseCallRow(row({ startedAt: null, endedAt: null })).startedAt === "" &&
    parseCallRow(row({ startedAt: null })).endedAt === "" &&
    engineSource.includes("optIso(), not optString()"),
);
check(
  "an absurd SDP is clipped to the Worker's own 60 000",
  parseCallRow(row({ offerSdp: "v=0".padEnd(70_000, "x") })).offerSdp.length === 60_000 &&
    workerSource.includes("sdp.slice(0, 60_000)"),
);
check(
  "an SDP keeps its trailing CRLF — a trimmed description is unparseable",
  parseCallRow(row({ offerSdp: "v=0\r\na=group:BUNDLE 0 1\r\n" })).offerSdp ===
    "v=0\r\na=group:BUNDLE 0 1\r\n" &&
    parseCallRow(row({ answerSdp: "v=0\r\n" })).answerSdp === "v=0\r\n" &&
    parseCallRow(row({ reofferSdp: "v=0\r\n" })).reofferSdp === "v=0\r\n" &&
    parseCallRow(row({ reanswerSdp: "v=0\r\n" })).reanswerSdp === "v=0\r\n" &&
    webModel.includes("function sdpText(") &&
    // A name is still trimmed; only the line protocol is left alone.
    parseCallRow(row({ other: { id: PEER, displayName: "  Rina  " } })).other.displayName ===
      "Rina",
);
check(
  "a media map keeps only booleans, keyed by user",
  parseCallRow(
    row({ media: { u_a: { camera: true, screen: "yes" }, u_b: null, "": { camera: true } } }),
  ).media.u_a.camera === true &&
    parseCallRow(row({ media: { u_a: { camera: true, screen: "yes" } } })).media.u_a.screen ===
      undefined &&
    Object.keys(parseCallRow(row({ media: { "": { camera: true } } })).media).length === 0,
);
check(
  "a list payload that is not a list yields no rows",
  parseCallList(null).length === 0 && parseCallList({ items: "no" }).length === 0,
);
check(
  "participants survive a group row and keep their state",
  parseCallRow(
    row({
      group: true,
      participants: [{ id: "u_a", state: "joined", joinedAt: "2026-10-05T04:00:00.000Z" }, null],
    }),
  ).participants.length === 1 &&
    parseCallRow(row({ group: true, participants: [{ id: "u_a", state: "joined" }] }))
      .participants[0].state === "JOINED",
);

/* ================================================== the ring + status lines */

check(
  "the status line order is the phone's own when-chain",
  screensSource.includes('call.status == "BUSY" -> "Line busy — on another call"') &&
    screensSource.includes('engine.onHold -> "On hold"') &&
    screensSource.includes(
      'call.status == "ACTIVE" && (call.connecting || call.startedAt <= 0L) -> "Connecting…"',
    ) &&
    screensSource.includes('call.incoming -> "Ringing…"') &&
    screensSource.includes('call.otherOnline -> "Ringing…"') &&
    screensSource.includes('else -> "Calling…"'),
);
check(
  "busy beats everything",
  callStatusText({
    phase: "busy",
    incoming: false,
    otherOnline: true,
    connected: true,
    connecting: false,
    onHold: true,
    sharing: true,
    seconds: 12,
  }) === "Line busy — on another call",
);
check(
  "hold beats connecting, and a share beats the clock",
  callStatusText({
    phase: "active",
    incoming: false,
    otherOnline: true,
    connected: false,
    connecting: true,
    onHold: true,
    sharing: false,
    seconds: 0,
  }) === "On hold" &&
    callStatusText({
      phase: "active",
      incoming: false,
      otherOnline: true,
      connected: true,
      connecting: false,
      onHold: false,
      sharing: true,
      seconds: 40,
    }) === "You are sharing your screen",
);
check(
  "connecting comes before the clock, and the clock replaces it",
  callStatusText({
    phase: "connecting",
    incoming: false,
    otherOnline: true,
    connected: true,
    connecting: true,
    onHold: false,
    sharing: false,
    seconds: 9,
  }) === "Connecting…" &&
    callStatusText({
      phase: "active",
      incoming: false,
      otherOnline: true,
      connected: true,
      connecting: false,
      onHold: false,
      sharing: false,
      seconds: 9,
    }) === "0:09",
);
check(
  "a connected call at zero seconds still says Connecting…",
  callStatusText({
    phase: "active",
    incoming: false,
    otherOnline: true,
    connected: true,
    connecting: false,
    onHold: false,
    sharing: false,
    seconds: 0,
  }) === "Connecting…",
);
check(
  "an incoming ring says Ringing… whatever the peer's presence",
  callStatusText({
    phase: "incoming",
    incoming: true,
    otherOnline: false,
    connected: false,
    connecting: false,
    onHold: false,
    sharing: false,
    seconds: 0,
  }) === "Ringing…",
);
check(
  "an outgoing call says Ringing… when they are online and Calling… when not",
  callStatusText({
    phase: "outgoing",
    incoming: false,
    otherOnline: true,
    connected: false,
    connecting: false,
    onHold: false,
    sharing: false,
    seconds: 0,
  }) === "Ringing…" &&
    callStatusText({
      phase: "outgoing",
      incoming: false,
      otherOnline: false,
      connected: false,
      connecting: false,
      onHold: false,
      sharing: false,
      seconds: 0,
    }) === "Calling…",
);
check(
  "the ring line names the kind, in the phone's words",
  incomingCallLine("VIDEO") === "Incoming video call…" &&
    incomingCallLine("AUDIO") === "Incoming voice call…" &&
    screensSource.includes('"Incoming video call…"') &&
    screensSource.includes('"Incoming voice call…"'),
);
check(
  "every control label is the phone's own string",
  screensSource.includes('"Mute"') &&
    screensSource.includes('"Unmute"') &&
    screensSource.includes('"Camera on"') &&
    screensSource.includes('"Camera off"') &&
    screensSource.includes('"Share screen"') &&
    screensSource.includes('"Stop share"') &&
    screensSource.includes('"End call"') &&
    screensSource.includes('"Cancel"') &&
    screensSource.includes('"Accept"') &&
    screensSource.includes('"Decline"') &&
    screensSource.includes('"Minimise call"') &&
    screensSource.includes('"Return to call"') &&
    CALL_COPY.mute === "Mute" &&
    CALL_COPY.unmute === "Unmute" &&
    CALL_COPY.cameraOn === "Camera on" &&
    CALL_COPY.cameraOff === "Camera off" &&
    CALL_COPY.shareScreen === "Share screen" &&
    CALL_COPY.stopShare === "Stop share" &&
    CALL_COPY.endCall === "End call" &&
    CALL_COPY.cancelCall === "Cancel" &&
    CALL_COPY.accept === "Accept" &&
    CALL_COPY.decline === "Decline" &&
    CALL_COPY.minimize === "Minimise call" &&
    CALL_COPY.returnToCall === "Return to call",
);
check(
  "the ring screen's quick reply is the phone's sentence",
  screensSource.includes("\"Can't talk right now — I'll reply with a message.\"") &&
    CALL_COPY.quickReply === "Can't talk right now — I'll reply with a message.",
);
check(
  "Add call stays the placeholder it is on the phone",
  screensSource.includes('"Add call"') &&
    screensSource.includes('"Adding calls is coming in a future update."') &&
    CALL_COPY.limitAddCall === "Adding calls is coming in a future update." &&
    webStage.includes("disabled title={CALL_COPY.limitAddCall}"),
);
check(
  "Remind me is disclosed as a phone-only surface, not drawn dead",
  screensSource.includes('"Remind me"') &&
    screensSource.includes("Reminders.schedule(") &&
    CALL_COPY.limitRemind === "Reminders live on the phone — a browser cannot schedule one." &&
    webStage.includes("CALL_COPY.limitRemind") &&
    !webStage.includes(">Remind me<"),
);
check(
  "the empty tab is the phone's own two lines",
  tabSource.includes('"No calls yet"') &&
    tabSource.includes('"Start a voice or video call from any chat"') &&
    CALL_COPY.historyEmptyTitle === "No calls yet" &&
    CALL_COPY.historyEmptyNote === "Start a voice or video call from any chat",
);
check(
  "the tab shows skeletons rather than a lone spinner",
  tabSource.includes("repeat(7) { KpShimmerListItem(alpha = sh) }") &&
    webTab.includes("calls-tab__skeleton"),
);

/* ================================================================ E2EE code */

const FP_A = "AA".repeat(32);
const FP_B = "BB".repeat(32);
const kotlinCode = (a, b) => {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const hex = createHash("sha256")
    .update(lo + hi, "utf8")
    .digest("hex");
  return hex
    .slice(0, 12)
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
};

check(
  "the safety code is the phone's algorithm, byte for byte",
  e2eeSource.includes('sha256Hex(lo + hi).take(12).uppercase().chunked(4).joinToString(" ")') &&
    (await callSafetyCode(FP_A, FP_B)) === kotlinCode(FP_A, FP_B),
);
check(
  "the code is order-independent, so both ends read the same string",
  (await callSafetyCode(FP_A, FP_B)) === (await callSafetyCode(FP_B, FP_A)),
);
check(
  "the code is twelve hex digits in three groups of four",
  /^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/.test(await callSafetyCode(FP_A, FP_B)),
);
check(
  "the fingerprint is the SDP's sha-256 line, uppercased and colonless",
  e2eeSource.includes('.replace(":", "").orEmpty().uppercase()') &&
    dtlsFingerprint(`v=0\r\na=fingerprint:sha-256 ${"ab".repeat(32)}\r\nm=audio 9`) ===
      "AB".repeat(32) &&
    dtlsFingerprint(`a=fingerprint:sha-256 ${"cd".repeat(32)}`) === "CD".repeat(32),
);
check(
  "a short or non-hex fingerprint is refused, not padded",
  e2eeSource.includes(
    "if (hex.length < 40 || !hex.all { it in '0'..'9' || it in 'A'..'F' }) return null",
  ) &&
    dtlsFingerprint("a=fingerprint:sha-256 AA:BB") === null &&
    dtlsFingerprint("a=fingerprint:sha-256 " + "ZZ".repeat(32)) === null &&
    dtlsFingerprint("") === null &&
    dtlsFingerprint(null) === null,
);
check(
  "a real-length fingerprint is accepted",
  dtlsFingerprint(`a=fingerprint:sha-256 ${"ab".repeat(32)}`) === "AB".repeat(32),
);
check(
  "trust-on-first-use stores silently, repeats quietly and warns on a change",
  e2eeSource.includes("fun checkPeer(ctx: Context, peerId: String, fp: String): Boolean") &&
    (() => {
      const first = checkCallTrust(null, PEER, FP_A);
      const same = checkCallTrust(first.next, PEER, FP_A);
      const changed = checkCallTrust(first.next, PEER, FP_B);
      return (
        first.verdict === "first" &&
        same.verdict === "same" &&
        changed.verdict === "changed" &&
        changed.next === first.next
      );
    })(),
);
check(
  "a changed code is stored only when the user trusts it",
  e2eeSource.includes("the new print is stored only via [trustPeer], never silently") &&
    trustCallPeer(JSON.stringify({ [PEER]: FP_A }), PEER, FP_B) ===
      JSON.stringify({ [PEER]: FP_B }),
);
check(
  "a corrupt trust store starts over instead of throwing",
  checkCallTrust("{not json", PEER, FP_A).verdict === "first" &&
    checkCallTrust("[1,2]", PEER, FP_A).verdict === "first",
);
check("the trust list is this browser's own, under one key", CALL_TRUST_KEY === "kp.calls.trust");
check(
  "the sheet's copy is the phone's sentence, with the peer's name in it",
  e2eeSource.includes("Nobody — not even KuchuPuchu — can listen to this call.") &&
    e2eeSheetCopy("Rina").includes("Read this code aloud with Rina") &&
    e2eeChangedCopy("Rina").includes("Rina may have reinstalled"),
);
check(
  "the code hides itself after three seconds",
  e2eeSource.includes("delay(3_000)") && CALL_CODE_VISIBLE_MS === 3_000,
);
check(
  "groups and pre-ACTIVE calls show no code, and never claim one",
  e2eeSource.includes("if (call.group || call.e2eeCode.isBlank()) return") &&
    webEngine.includes("if (state.row?.group) return;"),
);

/* ================================================== permissions and devices */

check(
  "the phone asks for the mic always and the camera only for video",
  readFileSync(resolve(`${ANDROID}/MainActivity.kt`), "utf8").includes(
    "listOf(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA)",
  ) &&
    mediaRequestFor("AUDIO").audio === true &&
    mediaRequestFor("AUDIO").video === false &&
    mediaRequestFor("VIDEO").video === true,
);
check(
  "a remembered block is told apart from no microphone at all",
  permissionCopy({ name: "NotAllowedError" }).includes("blocked") &&
    permissionCopy({ name: "NotFoundError" }).includes("No microphone") &&
    permissionCopy({ name: "NotReadableError" }).includes("Another program") &&
    permissionCopy({ name: "OverconstrainedError" }).includes("cannot provide") &&
    permissionCopy({ name: "SomethingNew" }) === CALL_PERMISSION_FALLBACK &&
    permissionCopy(null) === CALL_PERMISSION_FALLBACK &&
    CALL_PERMISSION_FALLBACK ===
      "The microphone or camera could not be started. Check the browser's site permissions and try again.",
);
check(
  "a camera-only refusal reads as a camera problem and keeps the call alive",
  cameraPermissionCopy({ name: "NotFoundError" }).includes("voice call") &&
    cameraPermissionCopy({ name: "NotAllowedError" }).includes("Camera access is blocked"),
);
check(
  "a cancelled screen picker is not reported as a crash",
  screenShareDeniedCopy({ name: "NotAllowedError" }).includes("cancelled") &&
    screenShareDeniedCopy({ name: "Weird" }).includes("could not be shared"),
);
check(
  "outputs are listed only when the browser can actually move audio",
  audioOutputSupported(null) === false &&
    audioOutputSupported({}) === false &&
    audioOutputSupported({ setSinkId: () => {} }) === true,
);
check(
  "an unlabeled output is still selectable, named by position",
  audioOutputChoices([
    { deviceId: "d1", kind: "audiooutput", label: "" },
    { deviceId: "d2", kind: "audiooutput", label: "Headphones" },
    { deviceId: "d3", kind: "audioinput", label: "Mic" },
  ])
    .map((choice) => choice.label)
    .join("|") === "Output 1|Headphones",
);
check(
  "the honest line is shown when there is no picker at all",
  webStage.includes("AUDIO_OUTPUT_UNSUPPORTED_COPY") &&
    AUDIO_OUTPUT_UNSUPPORTED_COPY.includes("no device picker for call audio"),
);

/* ============================================================== chat gate == */

check(
  "the header gate is ChatScreen's own condition",
  chatSource.includes(
    "if (!isGroup && c != null && !botChat && !requestOpen && !blockWall && !callMuted)",
  ),
);
check(
  "a call-muted chat shows no call buttons at all",
  chatSource.includes("a call-muted chat has no call buttons at all") &&
    callPlacement({
      isGroup: false,
      botChat: false,
      requestOpen: false,
      blockWall: false,
      callMuted: true,
      peerId: PEER,
      callsEnabled: true,
    }).show === false,
);
check(
  "bots, open requests and a block wall each remove the buttons",
  ["botChat", "requestOpen", "blockWall"].every(
    (key) =>
      callPlacement({
        isGroup: false,
        botChat: false,
        requestOpen: false,
        blockWall: false,
        callMuted: false,
        peerId: PEER,
        callsEnabled: true,
        [key]: true,
      }).show === false,
  ),
);
check(
  "a live 1:1 chat with the flag on gets both buttons",
  callPlacement({
    isGroup: false,
    botChat: false,
    requestOpen: false,
    blockWall: false,
    callMuted: false,
    peerId: PEER,
    callsEnabled: true,
  }).show === true,
);
check(
  "the flag off removes them everywhere",
  callPlacement({
    isGroup: false,
    botChat: false,
    requestOpen: false,
    blockWall: false,
    callMuted: false,
    peerId: PEER,
    callsEnabled: false,
  }).show === false && webFlags.includes("calls: false"),
);
check(
  "a group gets the pair drawn but disabled, with the reason",
  callPlacement({
    isGroup: true,
    botChat: false,
    requestOpen: false,
    blockWall: false,
    callMuted: false,
    peerId: "",
    callsEnabled: true,
  }).show === true &&
    callPlacement({
      isGroup: true,
      botChat: false,
      requestOpen: false,
      blockWall: false,
      callMuted: false,
      peerId: "",
      callsEnabled: true,
    }).group === true &&
    webChatPane.includes("disabled={callGate.group}"),
);
check(
  "a call-muted group is silent too",
  callPlacement({
    isGroup: true,
    botChat: false,
    requestOpen: false,
    blockWall: false,
    callMuted: true,
    peerId: "",
    callsEnabled: true,
  }).show === false,
);
check(
  "the messaging chunk imports only the gate and the launcher bridge",
  webChatPane.includes('from "../calls/callGate"') &&
    webChatPane.includes('from "../calls/callBus"') &&
    !webChatPane.includes("callEngine") &&
    !webChatPane.includes("callsModel") &&
    !webChatPane.includes("peerRuntime"),
);
check(
  "the launcher bridge reports honestly when no engine is mounted",
  (() => {
    registerCallLauncher(null);
    const before = launchCall({ id: PEER, name: "Rina" }, "AUDIO");
    let seen = "";
    registerCallLauncher((target, kind) => {
      seen = `${target.id}:${kind}`;
    });
    const after = launchCall({ id: PEER, name: "Rina" }, "VIDEO");
    const blank = launchCall({ id: "", name: "Rina" }, "AUDIO");
    registerCallLauncher(null);
    return before === false && after === true && seen === `${PEER}:VIDEO` && blank === false;
  })(),
);

/* ============================================================ group refusal */

check(
  "a group call is refused with the reason, never half-run",
  CALL_COPY.groupRefused === "Group calls are not on the Web yet — start them from the phone." &&
    webEngine.includes("if (next.group) {") &&
    webLayer.includes("controller.announce(CALL_COPY.groupRefused)"),
);
check(
  "the roadmap's gate for a group mesh is a measured cap",
  readFileSync(resolve("docs/web-parity-rebuild-roadmap.md"), "utf8").includes(
    "group call তখনই যখন measured participant cap আছে",
  ),
);

/* ================================================================ frames === */

check(
  "a call frame carries the state and the ids the Worker broadcasts",
  workerSource.includes('type: "call",\n        callId,\n        status: "RINGING",') &&
    parseCallFrame(JSON.stringify({ type: "call", callId: "c1", status: "active", kind: "video" }))
      ?.status === "ACTIVE",
);
check(
  "an ice frame delivers the candidate inline",
  workerSource.includes('type: "ice",') &&
    parseCallFrame(
      JSON.stringify({
        type: "ice",
        callId: "c1",
        from: PEER,
        to: null,
        candidate: {
          candidate: "candidate:1 1 udp 2 1.2.3.4 5 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    )?.candidate.candidate.startsWith("candidate:1"),
);
check(
  "an ice frame with no candidate is dropped",
  parseCallFrame(JSON.stringify({ type: "ice", callId: "c1", candidate: {} })) === null,
);
check(
  "a media frame carries both flags and the row's kind",
  workerSource.includes('type: "media",') &&
    (() => {
      const frame = parseCallFrame(
        JSON.stringify({
          type: "media",
          callId: "c1",
          userId: PEER,
          camera: true,
          screen: false,
          kind: "VIDEO",
        }),
      );
      return frame.camera === true && frame.screen === false && frame.kind === "VIDEO";
    })(),
);
check(
  "reoffer and reanswer frames are the renegotiation nudges",
  workerSource.includes('{ type: "reoffer", callId }') &&
    workerSource.includes('{ type: "reanswer", callId }') &&
    parseCallFrame(JSON.stringify({ type: "reoffer", callId: "c1" }))?.type === "reoffer",
);
check(
  "the DO's hello is parsed and carries no call id",
  signalSource.includes('JSON.stringify({ type: "hello", user, participants:') &&
    parseCallFrame(JSON.stringify({ type: "hello", user: ME, participants: 2 }))?.participants ===
      2,
);
check(
  "junk on the socket is ignored rather than thrown",
  parseCallFrame("not json") === null &&
    parseCallFrame("") === null &&
    parseCallFrame(JSON.stringify([1, 2])) === null &&
    parseCallFrame(JSON.stringify({ type: "something-else" })) === null &&
    parseCallFrame(undefined) === null,
);
check(
  "the ring ping on the user room is its own shape, and is read on the web",
  workerSource.includes("broadcastCallEvent(") &&
    (() => {
      const ping = parseIncomingCallPing(
        JSON.stringify({
          type: "call",
          callId: "c1",
          kind: "VIDEO",
          fromId: PEER,
          fromName: "Rina",
        }),
      );
      return ping?.kind === "VIDEO" && ping?.fromId === PEER && ping?.fromName === "Rina";
    })() &&
    parseIncomingCallPing(JSON.stringify({ type: "call" })) === null &&
    parseIncomingCallPing("junk") === null,
);
check(
  "the engine's phases are a superset of the Worker's statuses",
  CALL_STATUSES.join(",") === "RINGING,ACTIVE,ENDED,DECLINED,MISSED,CANCELLED" &&
    CALL_PHASES.join(",") === "idle,dialing,outgoing,incoming,connecting,active,busy,ended" &&
    workerSource.includes(
      "kind TEXT NOT NULL, status TEXT NOT NULL, offer_sdp TEXT, answer_sdp TEXT,",
    ),
);
check(
  "the client-only busy phase never reaches the server",
  webEngine.includes('phase: busy ? "busy" : "idle"') &&
    !webApi.includes('"BUSY"') &&
    !webEngine.includes('status: "BUSY"'),
);

/* ============================================================ the engine === */

/** A scripted peer connection: records every call the engine makes on it. */
function makePeer(log) {
  const senders = [];
  const transceivers = [];
  const peer = {
    localDescription: null,
    remoteDescription: null,
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    onicecandidate: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    ontrack: null,
    async createOffer(options) {
      log.push(`createOffer${options?.iceRestart ? ":iceRestart" : ""}`);
      const sdp = {
        type: "offer",
        sdp: `v=0 offer ${options?.iceRestart ? "restart" : "1"}\na=fingerprint:sha-256 ${"aa".repeat(32)}`,
      };
      peer.localDescription = sdp;
      return sdp;
    },
    async createAnswer() {
      log.push("createAnswer");
      const sdp = { type: "answer", sdp: "v=0 answer\na=fingerprint:sha-256 " + "bb".repeat(32) };
      peer.localDescription = sdp;
      return sdp;
    },
    async setLocalDescription(description) {
      log.push(`setLocalDescription:${description?.type ?? "implicit"}`);
      if (description) peer.localDescription = description;
      // A real browser starts gathering the moment the local description is set,
      // which is BEFORE the create response gives the call its id — the exact
      // window the engine's `pendingIce` buffer exists for.
      if (peer.onicecandidate) {
        peer.onicecandidate({
          candidate: {
            candidate: "candidate:1 1 udp 2113937151 192.0.2.7 51000 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        });
      }
    },
    async setRemoteDescription(description) {
      log.push(`setRemoteDescription:${description.type}`);
      peer.remoteDescription = description;
      // Setting an OFFER creates one transceiver per m-line, which is what the
      // answering side then flips to sendrecv instead of pre-adding its own.
      if (description.type === "offer" && transceivers.length === 0) {
        for (const kind of ["audio", "video"]) {
          const sender = {
            track: null,
            replaceTrack: async (next) => {
              sender.track = next;
              log.push(`replaceTrack:${next?.kind ?? "null"}`);
            },
          };
          senders.push(sender);
          transceivers.push({
            kind,
            direction: "recvonly",
            sender,
            setDirection: (next) => {
              log.push(`setDirection:${kind}:${next}`);
            },
          });
        }
      }
    },
    async addIceCandidate(candidate) {
      log.push(`addIceCandidate:${candidate.candidate}`);
    },
    addTrack(track, streams) {
      // The stream association is recorded because it is load-bearing: a bare
      // track makes the browser write `msid:-` and the far side refuses the SDP.
      log.push(`addTrack:${track.kind}:${streams?.length ?? 0}`);
      const sender = {
        track,
        replaceTrack: async (next) => {
          sender.track = next;
          log.push(`replaceTrack:${next?.kind ?? "null"}`);
        },
      };
      senders.push(sender);
      return sender;
    },
    addTransceiver(kind, init) {
      log.push(`addTransceiver:${kind}:${init?.direction ?? "default"}`);
      const sender = {
        track: null,
        replaceTrack: async (next) => {
          sender.track = next;
          log.push(`replaceTrack:${next?.kind ?? "null"}`);
        },
      };
      const transceiver = {
        kind,
        direction: init?.direction ?? "sendrecv",
        sender,
        setDirection: (d) => {
          transceiver.direction = d;
          log.push(`setDirection:${kind}:${d}`);
        },
      };
      transceivers.push(transceiver);
      senders.push(sender);
      return transceiver;
    },
    getSenders: () => senders,
    getTransceivers: () => transceivers,
    setConfiguration(config) {
      log.push(`setConfiguration:${config.iceServers.length}`);
    },
    restartIce() {
      log.push("restartIce");
    },
    close() {
      log.push("close");
    },
  };
  return peer;
}

function makeTrack(kind) {
  return {
    id: `${kind}-1`,
    kind,
    readyState: "live",
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
    onended: null,
  };
}

function makeStream(tracks) {
  return {
    id: "stream-1",
    raw: { fake: "media-stream" },
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    addTrack: (track) => tracks.push(track),
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
  };
}

/** Controllable clock + timers, so a watchdog or a notice can be fired by hand. */
function makeClock(startMs = NOW) {
  let nowValue = startMs;
  const timers = [];
  return {
    now: () => nowValue,
    advance(ms) {
      nowValue += ms;
    },
    schedule(callback, delayMs) {
      const entry = { callback, delayMs, cancelled: false };
      timers.push(entry);
      return { cancel: () => (entry.cancelled = true) };
    },
    interval(callback, delayMs) {
      const entry = { callback, delayMs, cancelled: false, interval: true };
      timers.push(entry);
      return { cancel: () => (entry.cancelled = true) };
    },
    timeout() {
      const controller = new AbortController();
      return { signal: controller.signal, cancel: () => undefined };
    },
    timers,
    runScheduled(maxDelay = Infinity) {
      for (const entry of [...timers]) {
        if (entry.cancelled || entry.interval || entry.delayMs > maxDelay) continue;
        entry.cancelled = true;
        entry.callback();
      }
    },
    runIntervals() {
      for (const entry of [...timers]) {
        if (entry.cancelled || !entry.interval) continue;
        entry.callback();
      }
    },
  };
}

/**
 * The transport: every route the engine may call, recorded and scripted. It
 * writes into the SAME log the runtime writes into, so a check can assert an
 * order across the two ("the offer was created before the row existed").
 */
function makeTransport(script = {}, log = []) {
  const calls = [];
  const record = (entry) => {
    calls.push(entry);
    log.push(entry);
  };
  return {
    calls,
    async active() {
      record("active");
      return script.active ?? [];
    },
    async history() {
      record("history");
      return script.history ?? [];
    },
    async start(_api, input) {
      record(`start:${input.userId}:${input.kind}:${input.offerSdp ? "offer" : "no-offer"}`);
      return (
        script.start ?? {
          call: parseCallRow(row({ offerSdp: input.offerSdp })),
          code: "",
          status: 201,
        }
      );
    },
    async answer(_api, callId, answerSdp) {
      record(`answer:${callId}:${answerSdp ? "sdp" : "no-sdp"}`);
      return script.answer ?? parseCallRow(row({ status: "ACTIVE", answerSdp }));
    },
    async decline(_api, callId) {
      record(`decline:${callId}`);
    },
    async end(_api, callId) {
      record(`end:${callId}`);
    },
    async sendIce(_api, callId, candidate) {
      record(`ice:${callId}:${candidate.candidate}`);
    },
    async pullIce() {
      record("pullIce");
      return script.ice ?? { items: [], now: "" };
    },
    async reoffer(_api, callId, sdp) {
      record(`reoffer:${callId}:${sdp.includes("restart") ? "restart" : "plain"}`);
    },
    async reanswer(_api, callId) {
      record(`reanswer:${callId}`);
    },
    async postMedia(_api, callId, flags) {
      record(
        `media:${callId}:${flags.camera === undefined ? "-" : flags.camera}:${flags.screen === undefined ? "-" : flags.screen}`,
      );
      return { kind: flags.camera === true ? "VIDEO" : "AUDIO" };
    },
    async iceConfig() {
      record("iceConfig");
      return script.iceConfig ?? null;
    },
  };
}

function makeRuntime(log, options = {}) {
  const peers = [];
  return {
    peers,
    createPeer(config) {
      log.push(`createPeer:${config.iceServers.length}`);
      const peer = makePeer(log);
      peers.push(peer);
      return peer;
    },
    async capture(request) {
      log.push(`capture:${request.audio ? "audio" : "-"}:${request.video ? "video" : "-"}`);
      if (options.captureError) throw options.captureError;
      const tracks = [makeTrack("audio")];
      if (request.video) tracks.push(makeTrack("video"));
      return makeStream(tracks);
    },
    async captureDisplay(withAudio) {
      log.push(`captureDisplay:${withAudio ? "audio" : "-"}`);
      if (options.displayError) throw options.displayError;
      const tracks = [makeTrack("video")];
      // A capture only yields sound when it was ASKED for and this fake is
      // scripted to grant it — the browser may deny system sound silently.
      if (withAudio && options.shareAudio) tracks.push(makeTrack("audio"));
      return makeStream(tracks);
    },
    mixAudio(primary, secondary) {
      log.push("mixAudio");
      return { track: makeTrack("audio"), dispose: () => log.push("mixAudioDispose") };
    },
    createStream(tracks) {
      log.push(`createStream:${tracks.length}`);
      return makeStream([...tracks]);
    },
    async listAudioOutputs() {
      log.push("listAudioOutputs");
      return options.outputs ?? [];
    },
    async setAudioOutput(deviceId) {
      log.push(`setAudioOutput:${deviceId || "default"}`);
      return options.sinkSupported === true;
    },
  };
}

function makeHarness(overrides = {}) {
  const log = [];
  const clock = makeClock();
  // Mutable on purpose: a call moves through server states, and the harness has
  // to be able to hand the engine a different row on the next poll.
  const script = { ...(overrides.script ?? {}) };
  const transport = makeTransport(script, log);
  const runtime = makeRuntime(log, overrides.runtime);
  const store = new Map(Object.entries(overrides.store ?? {}));
  const sockets = [];
  const engine = createCallEngine({
    api: {},
    token: "tok",
    meId: ME,
    runtime,
    clock,
    store: {
      read: (key) => store.get(key) ?? null,
      write: (key, value) => store.set(key, value),
    },
    sockets: (options) => {
      const frames = [];
      const socket = {
        path: options.path,
        frames,
        status: () => "open",
        close: () => log.push(`closeSocket:${options.path}`),
        onFrame: options.onFrame,
        parseFrame: options.parseFrame,
      };
      sockets.push(socket);
      return socket;
    },
    transport,
    visible: overrides.visible ?? (() => true),
    onQuickReply: async (peerId, text) => log.push(`quickReply:${peerId}:${text}`),
  });
  return { engine, log, clock, transport, runtime, store, sockets, script };
}

const flush = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

{
  /* ---------------------------------------------------- an outgoing call */
  const harness = makeHarness();
  const { engine, log, transport, runtime } = harness;
  engine.begin();
  await engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();

  check("starting a call asks for the microphone only", log.includes("capture:audio:-"));
  check(
    "a voice call still pre-adds a sendrecv video m-line",
    log.includes("addTransceiver:video:sendrecv"),
  );
  check(
    "the offer is created before the row exists, and the row before any ICE",
    log.indexOf("createOffer") < log.findIndex((entry) => entry.startsWith("start:")) &&
      log.findIndex((entry) => entry.startsWith("start:")) <
        log.findIndex((entry) => entry.startsWith("ice:")),
  );
  check(
    "the offer travels with the create request",
    transport.calls.some((entry) => entry === `start:${PEER}:AUDIO:offer`) &&
      workerSource.includes('String(body.offerSdp ?? "") || null,'),
  );
  check(
    "the audio track is added to the connection WITH its stream",
    log.includes("addTrack:audio:1"),
  );
  check(
    "a bare track is never added — `msid:-` is an SDP the far side cannot parse",
    !log.some((entry) => entry.startsWith("addTrack:") && entry.endsWith(":0")) &&
      webEngine.includes("const streams = localStream ? [localStream] : [];") &&
      readFileSync(resolve("web/src/calls/peerRuntime.ts"), "utf8").includes(
        "return wrapSender(peer.addTrack(raw, ...rawStreams));",
      ),
  );
  check(
    "candidates gathered before the id are flushed after it",
    log.filter((entry) => entry.startsWith("ice:")).length >= 0 &&
      transport.calls.some((entry) => entry.startsWith("ice:")),
  );
  check("the phase is outgoing and the row is kept", engine.state().phase === "outgoing");
  check("the call id came from the create response", engine.state().callId.length > 10);
  check(
    "a signalling socket is opened for the call and one for rings",
    harness.sockets.some((socket) => socket.path.startsWith("/ws/call/")) &&
      harness.sockets.some((socket) => socket.path === "/ws/user"),
  );
  check("the clock has not started before media is up", engine.state().connectedAt === 0);
  check("the status line says Ringing… while they are online", engine.state().connecting === true);

  /* The callee answers: the row the next poll returns flips to ACTIVE and
     carries the answer SDP, which is what the caller applies. */
  const callId = engine.state().callId;
  const answered = row({
    id: callId,
    status: "ACTIVE",
    answerSdp: "v=0 answer\na=fingerprint:sha-256 " + "bb".repeat(32),
    startedAt: "2026-10-05T06:30:05.000Z",
  });
  transport.calls.length = 0;
  harness.script.active = [parseCallRow(answered)];
  await engine.tick();
  await flush();
  check(
    "the answer that arrives on the poll is set as the remote description",
    log.includes("setRemoteDescription:answer"),
  );
  check(
    "the caller stays connecting until its own media is up",
    engine.state().connecting === true,
  );
  check(
    "the server's started_at never seeds this device's clock",
    engine.state().connectedAt === 0 && engine.state().seconds === 0,
  );

  /* ------------------------------------------------ ICE failure → relay */
  const peer = runtime.peers[0];
  void runtime;
  transport.calls.length = 0;
  peer.iceConnectionState = "failed";
  peer.oniceconnectionstatechange();
  await flush();
  check(
    "ICE failure reconfigures to the relay-first list exactly once",
    log.includes(`setConfiguration:${RELAY_FIRST_ICE_SERVERS.length}`) &&
      log.filter((entry) => entry.startsWith("setConfiguration")).length === 1,
  );
  check(
    "the rescue restarts ICE and re-offers",
    log.includes("restartIce") && log.includes("createOffer:iceRestart"),
  );
  check(
    "the re-offer reaches the server",
    transport.calls.some((entry) => entry.startsWith("reoffer:")),
  );

  peer.iceConnectionState = "failed";
  peer.oniceconnectionstatechange();
  await flush();
  check(
    "a second failure does not loop the rescue — it says Reconnecting…",
    log.filter((entry) => entry.startsWith("setConfiguration")).length === 1 &&
      engine.state().notice === "Reconnecting…",
  );

  /* ------------------------------------------------------- media comes up */
  peer.remoteDescription = { type: "answer", sdp: answered.answerSdp };
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  await flush();
  check("media up ends the connecting state", engine.state().connecting === false);
  check(
    "the clock starts at THIS device's media-up moment",
    engine.state().connectedAt === harness.clock.now(),
  );
  check("the phase is active", engine.state().phase === "active");
  check(
    "the safety code is measured from both fingerprints",
    engine.state().e2eeCode === (await callSafetyCode("AA".repeat(32), "BB".repeat(32))),
  );
  check(
    "the first sighting of a peer's fingerprint is stored silently",
    harness.store.get(CALL_TRUST_KEY) === JSON.stringify({ [PEER]: "BB".repeat(32) }),
  );
  check("a first-sighted peer is not called a changed code", engine.state().e2eeChanged === false);

  harness.clock.advance(1000);
  harness.clock.runIntervals();
  check("the timer counts whole seconds from media-up", engine.state().seconds === 1);

  /* -------------------------------------------- the remote side's media */
  const remoteAudio = makeTrack("audio");
  remoteAudio.id = "remote-audio";
  peer.ontrack({ track: remoteAudio });
  check(
    "a delivered remote track becomes the one stream the layer renders",
    engine.state().remoteStream !== null,
  );
  check("remote audio alone is not remote video", engine.state().hasRemoteVideo === false);
  peer.ontrack({ track: remoteAudio });
  check(
    "the same track delivered twice is on the stream once",
    engine.state().remoteStream.getTracks().length === 1,
  );
  const remoteVideo = makeTrack("video");
  remoteVideo.id = "remote-video";
  peer.ontrack({ track: remoteVideo });
  check("a remote video track switches the stage to video", engine.state().hasRemoteVideo === true);
  check(
    "both tracks ride the same single stream",
    engine.state().remoteStream.getTracks().length === 2,
  );
  remoteVideo.readyState = "ended";
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  await flush();
  check(
    "a track the peer ended is dropped when media is re-measured",
    engine.state().hasRemoteVideo === false,
  );
  check(
    "the layer binds exactly one element to that stream",
    webLayer.includes("engineState.remoteStream?.raw") &&
      (webLayer.match(/<audio\n/g) || []).length === 1 &&
      (webLayer.match(/call-remote-audio/g) || []).length >= 1 &&
      webLayer.includes("element.srcObject = (remoteStream as MediaStream | null) ?? null;"),
  );

  /* ------------------------------------------------------------- muting */
  const audioTrack = engine.state().localStream.getAudioTracks()[0];
  engine.toggleMute();
  check(
    "mute disables the audio track rather than removing it",
    engine.state().muted && audioTrack.enabled === false,
  );
  engine.toggleMute();
  check("unmute re-enables it", !engine.state().muted && audioTrack.enabled === true);

  /* -------------------------------------------------- camera on mid-call */
  transport.calls.length = 0;
  await engine.toggleCamera();
  await flush();
  check(
    "a camera switched on captures video",
    log.filter((entry) => entry === "capture:-:video").length === 1,
  );
  check(
    "it goes into the existing sender with replaceTrack — no renegotiation",
    log.includes("replaceTrack:video") &&
      !log.slice(log.indexOf("replaceTrack:video")).includes("createOffer"),
  );
  check(
    "the row is re-labelled VIDEO server-side",
    transport.calls.some((entry) => entry.includes("media:") && entry.endsWith(":true:-")) &&
      engine.state().kind === "VIDEO",
  );

  await engine.toggleCamera();
  check("a camera switched off disables the track and says so", engine.state().cameraOff === true);

  /* --------------------------------------------------------- screen share */
  transport.calls.length = 0;
  await engine.toggleShare();
  await flush();
  check(
    "a screen share captures through the browser's own picker",
    log.includes("captureDisplay:-"),
  );
  check(
    "without the sound preference the picker is not asked for audio and nothing mixes",
    !log.includes("captureDisplay:audio") && !log.includes("mixAudio"),
  );
  check(
    "a screen share never changes the call's kind",
    transport.calls.some((entry) => entry.includes("media:") && entry.endsWith(":-:true")) &&
      engine.state().sharing === true &&
      workerSource.includes("A screen share never changes the kind"),
  );
  await engine.toggleShare();
  await flush();
  check("stopping the share puts the camera track back", engine.state().sharing === false);

  /* ----------------------------------------------------------- hangup */
  transport.calls.length = 0;
  await engine.hangup();
  await flush();
  check(
    "hanging up posts /end and tears the call down",
    transport.calls.some((entry) => entry.startsWith("end:")),
  );
  check("the phase returns to idle", engine.state().phase === "idle");
  check("the peer connection is closed", log.includes("close"));
  check("the microphone is released", engine.state().localStream === null);
  check(
    "the call socket is closed",
    log.some((entry) => entry.startsWith("closeSocket:/ws/call/")),
  );
  engine.dispose();
}

{
  /* ------------------- share sound + peer-share fullscreen (slice R) ----- */
  const harness = makeHarness({ runtime: { shareAudio: true } });
  const { engine, log, transport, store } = harness;
  engine.begin();
  await engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  const callId = engine.state().callId;
  harness.script.active = [
    parseCallRow(
      row({
        id: callId,
        status: "ACTIVE",
        answerSdp: "v=0 answer\na=fingerprint:sha-256 " + "bb".repeat(32),
        startedAt: "2026-10-05T06:30:05.000Z",
      }),
    ),
  ];
  await engine.tick();
  await flush();

  /* The preference is OFF: a share asks for picture only. */
  await engine.toggleShare();
  await flush();
  check(
    "an unanswered preference keeps the share silent",
    log.includes("captureDisplay:-") && !log.includes("mixAudio"),
  );
  await engine.toggleShare();
  await flush();

  /* The preference is ON and the capture grants sound: the mix goes on the
     audio sender, so the peer hears voice AND screen at once. */
  store.set(SHARE_AUDIO_STORE_KEY, "1");
  await engine.toggleShare();
  await flush();
  check("the preference asks the picker for sound", log.includes("captureDisplay:audio"));
  check(
    "the share's sound is folded into the call audio with replaceTrack",
    log.includes("mixAudio") && log.filter((entry) => entry === "replaceTrack:audio").length === 1,
  );
  check("the share itself is still announced", engine.state().sharing === true);

  /* Stopping restores the mic alone and tears the mix down. */
  await engine.toggleShare();
  await flush();
  check(
    "stopping the sound share puts the mic back and disposes the mix",
    engine.state().sharing === false &&
      log.includes("mixAudioDispose") &&
      log.filter((entry) => entry === "replaceTrack:audio").length === 2,
  );

  /* The peer's shared screen, edge-to-edge — Android's `shareFull`. */
  check(
    "fullscreen refuses while nobody is sharing",
    (engine.openShareFullscreen(), engine.state().shareFull === false),
  );
  harness.script.active = [
    parseCallRow(
      row({
        id: callId,
        status: "ACTIVE",
        answerSdp: "v=0 answer\na=fingerprint:sha-256 " + "bb".repeat(32),
        startedAt: "2026-10-05T06:30:05.000Z",
        media: { [PEER]: { camera: false, screen: true } },
      }),
    ),
  ];
  await engine.tick();
  await flush();
  check("the poll's media flag raises peerScreen", engine.state().peerScreen === true);
  engine.openShareFullscreen();
  check("the peer's share expands fullscreen on request", engine.state().shareFull === true);
  engine.exitShareFullscreen();
  check("the exit control collapses it", engine.state().shareFull === false);
  engine.openShareFullscreen();
  harness.script.active = [
    parseCallRow(
      row({
        id: callId,
        status: "ACTIVE",
        answerSdp: "v=0 answer\na=fingerprint:sha-256 " + "bb".repeat(32),
        startedAt: "2026-10-05T06:30:05.000Z",
        media: { [PEER]: { camera: false, screen: false } },
      }),
    ),
  ];
  await engine.tick();
  await flush();
  check(
    "a share that ends drops the fullscreen view with it",
    engine.state().peerScreen === false && engine.state().shareFull === false,
  );

  await engine.hangup();
  await flush();
  check("the sound-share call tears down clean", engine.state().phase === "idle");
  engine.dispose();
}

{
  /* ---------------------------------------------------- an incoming call */
  const harness = makeHarness({
    script: {
      active: [
        parseCallRow(
          row({
            id: "3f2b7c1e-2222-4000-8000-000000000002",
            incoming: true,
            callerId: PEER,
            calleeId: ME,
            status: "RINGING",
            offerSdp: "v=0 offer\na=fingerprint:sha-256 " + "cc".repeat(32),
          }),
        ),
      ],
    },
  });
  const { engine, log, transport, runtime } = harness;
  engine.begin();
  await engine.tick();
  await flush();

  check(
    "a ringing row this device did not start becomes an incoming call",
    engine.state().phase === "incoming",
  );
  check(
    "the peer is the caller",
    engine.state().peer.id === PEER && engine.state().peer.name === "Rina",
  );
  check(
    "the offer that arrived with the ring is kept",
    engine.state().row.offerSdp.includes("v=0 offer"),
  );
  check("no media is captured before Accept", !log.some((entry) => entry.startsWith("capture:")));

  transport.calls.length = 0;
  await engine.answer();
  await flush();

  check("answering captures the microphone", log.includes("capture:audio:-"));
  check(
    "the answer is built on the offer the ring already carried — no extra round trip",
    !transport.calls.includes("active") ||
      log.indexOf("setRemoteDescription:offer") < log.indexOf("answer:"),
  );
  check("the offer is set as the remote description", log.includes("setRemoteDescription:offer"));
  check(
    "the answering side flips the offer's video m-line instead of pre-adding one",
    log.includes("setDirection:video:sendrecv") && !log.includes("addTransceiver:video:sendrecv"),
  );
  check(
    "the answer is posted with its SDP",
    transport.calls.some((entry) => entry.startsWith("answer:") && entry.endsWith(":sdp")),
  );
  check("the phase is connecting until media is up", engine.state().phase === "connecting");

  /* ------------------------------------------------------- decline path */
  transport.calls.length = 0;
  await engine.decline();
  await flush();
  check(
    "declining posts /decline and tears down",
    transport.calls.some((entry) => entry.startsWith("decline:")),
  );
  check("a declined call does not come back on the next poll", engine.state().phase === "idle");
  await engine.tick();
  check("the ignored row stays ignored", engine.state().phase === "idle");
  engine.dispose();
}

{
  /* ------------------------------------------------------- refusal paths */
  const busy = makeHarness({ script: { start: { call: null, code: "LINE_BUSY", status: 486 } } });
  await busy.engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  check(
    "a 486 reads as line busy on the calling surface",
    busy.engine.state().error === CALL_COPY.codeLineBusy,
  );
  check("a busy call releases the microphone", busy.engine.state().localStream === null);
  busy.engine.dispose();

  const blocked = makeHarness({ script: { start: { call: null, code: "BLOCKED", status: 403 } } });
  await blocked.engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  check("a block is named as a block", blocked.engine.state().error === CALL_COPY.codeBlocked);
  blocked.engine.dispose();

  const denied = makeHarness({
    runtime: { captureError: { name: "NotAllowedError", message: "denied" } },
  });
  await denied.engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "VIDEO");
  await flush();
  check(
    "a refused microphone never reaches the server",
    denied.engine.state().error.includes("blocked for this site") &&
      !denied.transport.calls.some((entry) => entry.startsWith("start:")),
  );
  check("a refused call leaves no peer connection behind", denied.runtime.peers.length === 0);
  denied.engine.dispose();

  const noMic = makeHarness({
    runtime: { captureError: { name: "NotFoundError", message: "none" } },
  });
  await noMic.engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  check(
    "no microphone is told apart from a blocked one",
    noMic.engine.state().error.includes("No microphone"),
  );
  noMic.engine.dispose();
}

{
  /* --------------------------------------------------- the ring ceiling */
  const harness = makeHarness();
  const { engine, clock, transport } = harness;
  engine.begin();
  await engine.start({ id: PEER, name: "Rina", avatar: "", online: false }, "AUDIO");
  await flush();
  const ringingId = engine.state().callId;
  // The server still has the row RINGING: the callee simply never picked up, so
  // it is the CLIENT's own one-minute rule that has to end the call.
  harness.script.active = [parseCallRow(row({ id: ringingId, status: "RINGING" }))];

  await engine.tick();
  await flush();
  check(
    "an unanswered outgoing call is still ringing at 59 s",
    engine.state().phase === "outgoing",
  );

  clock.advance(CALL_OUTGOING_RING_LIMIT_MS + 1000);
  transport.calls.length = 0;
  await engine.tick();
  await flush();
  check(
    "past a minute the client gives up, ends the row and says No answer",
    engine.state().phase === "idle" &&
      engine.state().notice === CALL_COPY.noAnswer &&
      transport.calls.some((entry) => entry === `end:${ringingId}`),
  );

  await engine.tick();
  await flush();
  check("a row the client gave up on is never picked up again", engine.state().phase === "idle");
  engine.dispose();
}

{
  /* ----------------------------------------------------- quick reply */
  const harness = makeHarness({
    script: {
      active: [
        parseCallRow(
          row({
            id: "3f2b7c1e-3333-4000-8000-000000000003",
            incoming: true,
            callerId: PEER,
            calleeId: ME,
            status: "RINGING",
            offerSdp: "v=0 offer",
          }),
        ),
      ],
    },
  });
  harness.engine.begin();
  await harness.engine.tick();
  await harness.engine.quickReply();
  await flush();
  check(
    "Message declines the call and sends the phone's canned reply",
    harness.transport.calls.some((entry) => entry.startsWith("decline:")) &&
      harness.log.some((entry) => entry === `quickReply:${PEER}:${CALL_COPY.quickReply}`),
  );
  harness.engine.dispose();
}

{
  /* ------------------------------------------------- a changed safety code */
  const harness = makeHarness({
    store: { [CALL_TRUST_KEY]: JSON.stringify({ [PEER]: "DD".repeat(32) }) },
  });
  const { engine, runtime } = harness;
  engine.begin();
  await engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  const peer = runtime.peers[0];
  peer.remoteDescription = { type: "answer", sdp: "a=fingerprint:sha-256 " + "bb".repeat(32) };
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  await flush();
  check(
    "a fingerprint that differs from the stored one warns",
    engine.state().e2eeChanged === true,
  );
  check(
    "the warning is not stored as trusted until the user says so",
    harness.store.get(CALL_TRUST_KEY) === JSON.stringify({ [PEER]: "DD".repeat(32) }),
  );
  engine.trustPeer();
  check(
    "trusting writes the new fingerprint and clears the warning",
    harness.store.get(CALL_TRUST_KEY) === JSON.stringify({ [PEER]: "BB".repeat(32) }) &&
      engine.state().e2eeChanged === false,
  );
  engine.dispose();
}

{
  /* ------------------------------------------------------- audio outputs */
  const harness = makeHarness({
    runtime: {
      outputs: [
        { deviceId: "d1", kind: "audiooutput", label: "Speakers" },
        { deviceId: "d2", kind: "audiooutput", label: "" },
      ],
      sinkSupported: true,
    },
  });
  harness.engine.begin();
  await flush();
  check(
    "outputs are enumerated once the layer starts",
    harness.engine.state().outputs.length === 2,
  );
  check(
    "an unlabeled output is named by position",
    harness.engine.state().outputs[1].label === "Output 2",
  );
  await harness.engine.setOutput("d1");
  check("choosing an output moves the call's audio", harness.engine.state().outputId === "d1");

  const noSink = makeHarness({
    runtime: {
      outputs: [{ deviceId: "d1", kind: "audiooutput", label: "Speakers" }],
      sinkSupported: false,
    },
  });
  noSink.engine.begin();
  await flush();
  await noSink.engine.setOutput("d1");
  check(
    "a browser without setSinkId does not pretend the move happened",
    noSink.engine.state().outputId === "" && noSink.engine.state().notice === CALL_COPY.limitRoutes,
  );
  harness.engine.dispose();
  noSink.engine.dispose();
}

{
  /* ------------------------------------------------------- minimize/restore */
  const harness = makeHarness();
  harness.engine.begin();
  await harness.engine.start({ id: PEER, name: "Rina", avatar: "", online: true }, "AUDIO");
  await flush();
  harness.engine.minimize();
  check(
    "minimising keeps the call and hides the stage",
    harness.engine.state().minimized === true && harness.engine.state().phase === "outgoing",
  );
  harness.engine.restore();
  check("restoring brings it back", harness.engine.state().minimized === false);
  harness.engine.showCode();
  check("the code shows itself for three seconds", harness.engine.state().codeVisible === true);
  check("a peek does not raise the whole sheet", harness.engine.state().verifyOpen === false);
  harness.engine.openVerify();
  check(
    "the verify sheet is the engine's to open, so a changed code can raise it",
    harness.engine.state().verifyOpen === true && harness.engine.state().codeVisible === true,
  );
  harness.engine.closeVerify();
  check("and its to close", harness.engine.state().verifyOpen === false);
  check(
    "the stage renders the sheet from the engine, not from its own state",
    webStage.includes("const verifyOpen = state.verifyOpen;") &&
      webStage.includes("onClose={engine.closeVerify}"),
  );
  harness.clock.advance(CALL_CODE_VISIBLE_MS);
  harness.clock.runScheduled(CALL_CODE_VISIBLE_MS);
  check("and hides itself again", harness.engine.state().codeVisible === false);
  harness.engine.dispose();
}

{
  /* ---------------------------------------------------- the initial state */
  check(
    "a fresh engine is idle with no media and no clock",
    INITIAL_CALL_STATE.phase === "idle" &&
      INITIAL_CALL_STATE.connectedAt === 0 &&
      INITIAL_CALL_STATE.localStream === null,
  );
  check(
    "a fresh engine claims no encryption",
    INITIAL_CALL_STATE.e2eeCode === "" && INITIAL_CALL_STATE.e2eeChanged === false,
  );
}

/* ============================================================= the wiring == */

check(
  "the calls flag is default-off",
  webFlags.includes('calls: "VITE_KP_WEB_CALLS",') && webFlags.includes("calls: false"),
);
check(
  "/calls needs a verified session before any call request",
  webApp.includes("(callsEnabled && isCallsArea)") && webApp.includes("needsSession"),
);
check(
  "the layer is mounted above the routes so a ring survives navigation",
  webApp.includes("{callsLive ? (") &&
    webApp.includes("<CallsLayer route={route} navigate={navigate} />") &&
    webApp.includes("const callsLive = callsEnabled && accountEnabled;"),
);
check(
  "the calls surfaces are a lazy chunk of their own",
  webApp.includes('import("./calls/CallsLayer")'),
);
check(
  "with the flag off no call request is made at all",
  webApp.includes("Calls are enabled for this opt-in build") &&
    webApp.includes("Calls remain disabled."),
);
check(
  "exactly one element owns the call's sound",
  webLayer.includes("<audio") &&
    webLayer.includes('className="call-remote-audio"') &&
    (webStage.match(/<video/g) || []).length >= 1 &&
    webStage.includes("autoPlay playsInline muted"),
);
check(
  "a paused autoplay is disclosed rather than left silent",
  webLayer.includes("This browser paused the call audio"),
);
check(
  "a call that ends drops the history cache at once",
  webLayer.includes('if (was !== "idle" && phase === "idle") invalidate();'),
);
check(
  "the browser-only limits are listed on the call surface itself",
  webStage.includes("CALL_COPY.limitTakeover") &&
    webStage.includes("CALL_COPY.limitBackground") &&
    webStage.includes("CALL_COPY.limitRing") &&
    webStage.includes("CALL_COPY.limitRoutes") &&
    webStage.includes("CALL_COPY.limitCapture"),
);
check(
  "the limits say a closed tab gets no ring",
  CALL_COPY.limitRing.includes("only while this tab is open"),
);
check(
  "the limits say nothing can block a screenshot",
  CALL_COPY.limitCapture.includes("cannot block a screenshot"),
);
check(
  "no fake hardware audio route is offered",
  !webStage.includes(">Earpiece") &&
    !webStage.includes(">Bluetooth") &&
    !webStage.includes(">Speakerphone") &&
    CALL_COPY.limitRoutes.includes("no earpiece") &&
    CALL_COPY.limitRoutes.includes("hardware switching"),
);
check(
  "Accept and Decline are ordinary labelled buttons, not a swipe",
  webStage.includes('className="call-circle call-circle--decline"') &&
    webStage.includes('className="call-circle call-circle--accept"') &&
    webStage.includes("CALL_COPY.accept") &&
    screensSource.includes("SwipeCallCircle("),
);
check(
  "the ring's Escape closes the verify sheet, never the call",
  webStage.includes('if (event.key === "Escape")') &&
    webStage.includes("engine.closeVerify();") &&
    !webStage.includes("setVerifyOpen"),
);
check(
  "the history tab states that hidden chats are not filtered here",
  webTab.includes("CALL_COPY.historyHiddenNote") &&
    CALL_COPY.historyHiddenNote.includes("no Hidden list yet"),
);
check(
  "every control on the call surface is labelled",
  webStage.includes("aria-label=") &&
    webTab.includes("aria-label={`Open the chat with ${view.name}`}") &&
    webTab.includes("aria-label={"),
);
check(
  "the calls tab is a real section of the router, not a new route kind",
  readFileSync(resolve("web/src/router.ts"), "utf8").includes('"calls"'),
);
check(
  "the production PWA is untouched by this slice",
  !readFileSync(resolve("public/app.js"), "utf8").includes("callEngine"),
);

console.log(lines.join("\n"));
