/**
 * The call engine: one 1:1 WebRTC call, driven the way the phone drives it.
 *
 * `CallEngine.kt` is the source of truth for the sequence, and the parts that
 * matter are copied deliberately rather than reinvented:
 *
 * - The CALLER pre-adds a sendrecv VIDEO m-line even on a voice call, so a
 *   camera or a screen share can be dropped into the existing sender with
 *   `replaceTrack` and NO renegotiation (round 33 item 21: the callee must not
 *   pre-add, or the two sides end up with two video transceivers and the frames
 *   land on an m-line nobody renders). The answering side instead flips the
 *   offer's own video transceiver to sendrecv.
 * - The clock starts when THIS device's ICE+DTLS come up (`markConnected`),
 *   never from the server's `started_at` — that seeded the caller's timer at
 *   0:07 while the callee still heard ringback (round 33 item 15).
 * - Candidates generated before the call id exists are buffered and flushed,
 *   because `POST /api/calls` is what mints the id (`pendingIce` / `flushIce`).
 * - One automatic relay-first rescue when ICE fails: direct and peer-reflexive
 *   pairing is what dies behind a VPN or carrier-grade NAT, and a relay works
 *   there. Bounded to one retry so a dead call does not loop forever.
 * - An outgoing ring nobody answers is ended locally after a minute, the same
 *   outcome as the server's reaper, instead of ringing forever.
 *
 * What is NOT here, and why (plan §6 — native-only gaps are disclosed, not
 * faked):
 *
 * - Group calls. The phone runs a mesh of per-pair connections through
 *   `/api/calls/group`, `/join` and `/peer`. The roadmap's gate for that on the
 *   Web is a MEASURED participant cap, and no measurement exists yet, so
 *   `start()` refuses a group target with `CALL_COPY.groupRefused` rather than
 *   shipping a call that silently drops the fourth member.
 * - Telecom / ConnectionService / the ongoing notification / Hold. A browser has
 *   no system call surface: the call lives in this tab and dies with it. The UI
 *   says so.
 * - Hardware audio routes (earpiece, Bluetooth SCO). The browser's own output
 *   picker is the substitute, gated on `setSinkId` actually existing.
 * - A ring while the tab is closed. There is no push yet (slice H); the poll and
 *   the `/ws/user` frame only work in an open tab.
 *
 * The engine is free of React and of the DOM: the peer connection, the capture
 * calls, the clock and the sockets are injected, so a Node contract case can
 * drive a whole call against scripted fakes.
 */

import type { ApiClient } from "../auth/authApi";
import type { SocketStatus } from "../messaging/sockets";
import { callsApi, type StartCallResult } from "./callsApi";
import {
  CALL_ACTIVE_TIMEOUT_MS,
  CALL_CODE_VISIBLE_MS,
  CALL_COPY,
  CALL_ICE_WATCHDOG_MS,
  CALL_NOTICE_MS,
  CALL_OUTGOING_RING_LIMIT_MS,
  CALL_PHANTOM_RECHECK_MS,
  CALL_RECONNECTING_COPY,
  CALL_TRUST_KEY,
  audioOutputChoices,
  audioOutputSupported,
  callPollDelayMs,
  callRefusalCopy,
  callSafetyCode,
  cameraPermissionCopy,
  checkCallTrust,
  dtlsFingerprint,
  iceServersFor,
  isBusyStatus,
  mediaRequestFor,
  outgoingRingTimedOut,
  parseCallFrame,
  parseIncomingCallPing,
  permissionCopy,
  relayIceServersFor,
  screenShareDeniedCopy,
  trustCallPeer,
  type AudioOutputChoice,
  type CallFrame,
  type CallKind,
  type CallPhase,
  type CallRow,
  type IceServer,
} from "./callsModel";
import type { MediaStreamLike, MediaTrackLike, PeerLike, PeerRuntime, Sdp } from "./peerRuntime";

/* ------------------------------------------------------------------- inputs */

export type TimerHandle = { cancel(): void };

export type CallClock = {
  now(): number;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  interval(callback: () => void, delayMs: number): TimerHandle;
  /** Aborts an in-flight read; mirrors `withTimeoutOrNull(4_500)`. */
  timeout(ms: number): { signal: AbortSignal; cancel(): void };
};

export type CallStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
};

export type SocketHandle = {
  status(): SocketStatus;
  close(): void;
};

/**
 * The socket factory. The browser implementation wraps messaging's
 * `createManagedSocket` — the same 20 s heartbeat and capped backoff, which the
 * CallSignal Durable Object's liveness window (45 s) depends on.
 */
export type SocketFactory = (options: {
  path: string;
  token: string;
  parseFrame: (raw: unknown) => unknown;
  onFrame: (frame: unknown) => void;
  onStatus: (status: SocketStatus) => void;
}) => SocketHandle;

export type CallTransport = typeof callsApi;

export type CallPeerTarget = {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly online: boolean;
};

export type EngineOptions = {
  readonly api: ApiClient;
  readonly token: string;
  readonly meId: string;
  readonly runtime: PeerRuntime;
  readonly clock: CallClock;
  readonly store: CallStore;
  readonly sockets: SocketFactory;
  readonly transport?: CallTransport;
  readonly visible?: () => boolean;
  /** Decline + send the ring screen's quick reply (needs the messaging identity). */
  readonly onQuickReply?: (peerId: string, text: string) => Promise<void>;
  readonly onNavigateToChat?: (peerId: string) => void;
};

/* -------------------------------------------------------------------- state */

export type CallEngineState = {
  readonly phase: CallPhase;
  readonly callId: string;
  readonly kind: CallKind;
  readonly incoming: boolean;
  readonly peer: CallPeerTarget;
  readonly row: CallRow | null;
  /** Epoch ms of THIS device's media-up moment; 0 until then. */
  readonly connectedAt: number;
  readonly seconds: number;
  readonly connecting: boolean;
  readonly muted: boolean;
  readonly cameraOff: boolean;
  readonly sharing: boolean;
  readonly peerCameraOff: boolean;
  readonly peerScreen: boolean;
  readonly minimized: boolean;
  /**
   * The verify sheet is open. The engine owns it rather than the stage: a
   * fingerprint that CHANGED has to raise the sheet by itself, mid-call, with no
   * click anywhere (E2eeCall.checkPeer's mismatch path).
   */
  readonly verifyOpen: boolean;
  readonly localStream: MediaStreamLike | null;
  readonly remoteStream: MediaStreamLike | null;
  readonly hasRemoteVideo: boolean;
  readonly e2eeCode: string;
  readonly e2eeChanged: boolean;
  readonly codeVisible: boolean;
  readonly notice: string;
  /** A refusal or a permission failure the user has to read. */
  readonly error: string;
  readonly signal: SocketStatus;
  readonly outputs: readonly AudioOutputChoice[];
  readonly outputId: string;
  readonly outputSupported: boolean;
  /** The call the last poll saw, so a ring survives a slow refresh. */
  readonly polling: boolean;
};

const EMPTY_PEER: CallPeerTarget = { id: "", name: "", avatar: "", online: false };

export const INITIAL_CALL_STATE: CallEngineState = Object.freeze({
  phase: "idle",
  callId: "",
  kind: "AUDIO",
  incoming: false,
  peer: EMPTY_PEER,
  row: null,
  connectedAt: 0,
  seconds: 0,
  connecting: false,
  muted: false,
  cameraOff: true,
  sharing: false,
  peerCameraOff: false,
  peerScreen: false,
  minimized: false,
  verifyOpen: false,
  localStream: null,
  remoteStream: null,
  hasRemoteVideo: false,
  e2eeCode: "",
  e2eeChanged: false,
  codeVisible: false,
  notice: "",
  error: "",
  signal: "idle",
  outputs: [],
  outputId: "",
  outputSupported: false,
  polling: false,
});

/* ------------------------------------------------------------------- engine */

export type CallEngine = {
  state(): CallEngineState;
  subscribe(listener: () => void): () => void;
  /** Start polling + listen for rings. Idempotent. */
  begin(): void;
  /** Stop everything: sockets, polls, and any live call is left alone. */
  dispose(): void;
  start(peer: CallPeerTarget, kind: CallKind): Promise<void>;
  answer(): Promise<void>;
  decline(): Promise<void>;
  hangup(): Promise<void>;
  toggleMute(): void;
  toggleCamera(): Promise<void>;
  toggleShare(): Promise<void>;
  minimize(): void;
  restore(): void;
  showCode(): void;
  openVerify(): void;
  closeVerify(): void;
  trustPeer(): void;
  refreshOutputs(): Promise<void>;
  setOutput(deviceId: string): Promise<void>;
  quickReply(): Promise<void>;
  dismissError(): void;
  /** One poll tick; exposed so a test can drive it deterministically. */
  tick(): Promise<void>;
};

export function createCallEngine(options: EngineOptions): CallEngine {
  const transport = options.transport ?? callsApi;
  const clock = options.clock;
  const runtime = options.runtime;
  const visible = options.visible ?? (() => true);

  let state: CallEngineState = { ...INITIAL_CALL_STATE };
  const listeners = new Set<() => void>();

  let peer: PeerLike | null = null;
  let localStream: MediaStreamLike | null = null;
  let shareStream: MediaStreamLike | null = null;
  let cameraTrack: MediaTrackLike | null = null;
  let audioTrack: MediaTrackLike | null = null;
  let iceMinted: IceServer | null = null;
  let iceLoaded = false;

  /** Candidates gathered before `POST /api/calls` minted the id. */
  const pendingIce: { candidate: string; sdpMid: string | null; sdpMLineIndex: number }[] = [];
  const seenIce = new Set<string>();
  let iceCursor = "";

  let callSocket: SocketHandle | null = null;
  let userSocket: SocketHandle | null = null;
  let pollTimer: TimerHandle | null = null;
  let clockTimer: TimerHandle | null = null;
  let watchdog: TimerHandle | null = null;
  let noticeTimer: TimerHandle | null = null;
  let codeTimer: TimerHandle | null = null;
  let ended = false;
  let relayRetryUsed = false;
  let awaitingReanswer = false;
  let outgoingRingAt = 0;
  let netFailStreak = 0;
  let ticking = false;
  let pokeRequested = false;
  let disposed = false;
  /** A call this device already hung up on; its row must not resurrect the UI. */
  const ignored = new Set<string>();

  const publish = (next: Partial<CallEngineState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const say = (notice: string) => {
    noticeTimer?.cancel();
    publish({ notice });
    noticeTimer = clock.schedule(() => publish({ notice: "" }), CALL_NOTICE_MS);
  };

  const fail = (error: string) => publish({ error });

  /* ------------------------------------------------------------- media plumbing */

  const stopTrack = (track: MediaTrackLike | null) => {
    if (!track) return;
    try {
      track.stop();
    } catch {
      // A track that already ended throws in some browsers; nothing to clean up.
    }
  };

  const releaseMedia = () => {
    stopTrack(audioTrack);
    stopTrack(cameraTrack);
    audioTrack = null;
    cameraTrack = null;
    if (shareStream) {
      for (const track of shareStream.getTracks()) stopTrack(track);
      shareStream = null;
    }
    if (localStream) {
      for (const track of localStream.getTracks()) stopTrack(track);
      localStream = null;
    }
  };

  const videoSender = () => {
    if (!peer) return null;
    const sender = peer.getSenders().find((entry) => entry.track?.kind === "video");
    if (sender) return sender;
    return peer.getTransceivers().find((entry) => entry.kind === "video")?.sender ?? null;
  };

  /**
   * Tracks the peer delivers, in arrival order. `ontrack` fires once per
   * transceiver — audio first on a voice call, video again when the other side
   * switches its camera on — and a track that is re-delivered after an ICE
   * restart is the SAME track, so it is added once and never duplicated.
   *
   * The list is what makes the call audible: remote audio is silent until it is
   * on a media element, and the layer renders exactly one element bound to
   * `state.remoteStream`. Two elements bound to one stream would double the
   * sound, which is why every video surface in the stage is muted and this is
   * the only stream the engine publishes.
   */
  const remoteTracks: MediaTrackLike[] = [];

  const bindRemote = (track: MediaTrackLike | null) => {
    if (!track) return;
    if (!remoteTracks.some((existing) => existing.id === track.id)) remoteTracks.push(track);
    publishRemote();
  };

  /** Drop tracks the peer ended, then republish the one remote stream. */
  const publishRemote = () => {
    for (let index = remoteTracks.length - 1; index >= 0; index -= 1) {
      const track = remoteTracks[index];
      if (!track || track.readyState === "ended") remoteTracks.splice(index, 1);
    }
    const hasVideo = remoteTracks.some((track) => track.kind === "video");
    publish({
      hasRemoteVideo: hasVideo,
      remoteStream: remoteTracks.length > 0 ? runtime.createStream(remoteTracks) : null,
    });
  };

  /* ---------------------------------------------------------------- signalling */

  const sendIce = (candidate: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number;
  }) => {
    const callId = state.callId;
    if (!callId) {
      pendingIce.push(candidate);
      return;
    }
    void transport
      .sendIce(options.api, callId, candidate)
      .catch(() => undefined)
      .then(() => undefined);
  };

  const flushIce = () => {
    while (pendingIce.length) {
      const candidate = pendingIce.shift();
      if (candidate) sendIce(candidate);
    }
  };

  const applyCandidate = (candidate: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number;
  }): boolean => {
    const connection = peer;
    if (!connection) return false;
    // The phone's `applyIceFrame`: no remote description yet means the candidate
    // has nowhere to go — the poll will bring it back after the SDP lands.
    if (!connection.remoteDescription) return false;
    if (!candidate.candidate) return false;
    if (seenIce.has(candidate.candidate)) return true;
    try {
      void connection
        .addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        })
        .then(
          () => {
            seenIce.add(candidate.candidate);
          },
          () => undefined,
        );
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Pull the other side's candidates and apply them.
   *
   * The cursor only moves past candidates that were ACTUALLY APPLIED. A caller
   * polls from the moment it dials, so the callee's candidates are usually on
   * the server before this side has a remote description to put them on — and a
   * cursor that skipped them would leave the call with no remote candidates at
   * all: ICE sits in "new" forever, the clock never starts, and nothing looks
   * broken. Stopping at the first unapplied candidate makes the next poll, which
   * runs after the answer lands, read them again.
   */
  const pullIce = async (callId: string) => {
    try {
      const result = await transport.pullIce(options.api, callId, iceCursor);
      let applied = 0;
      for (const item of result.items) {
        const raw = item.candidate as {
          candidate?: unknown;
          sdpMid?: unknown;
          sdpMLineIndex?: unknown;
        };
        const candidate = typeof raw.candidate === "string" ? raw.candidate : "";
        if (!candidate) {
          applied += 1;
          continue;
        }
        const index = Number(raw.sdpMLineIndex);
        const ok = applyCandidate({
          candidate,
          sdpMid: typeof raw.sdpMid === "string" ? raw.sdpMid : null,
          sdpMLineIndex: Number.isFinite(index) ? index : 0,
        });
        if (!ok) break;
        applied += 1;
      }
      if (applied > 0) iceCursor = result.items[applied - 1]!.id;
      else if (result.items.length === 0 && result.now) iceCursor = result.now;
    } catch {
      // A missed ICE poll is bounded: the next tick pulls again.
    }
  };

  const markConnected = () => {
    if (state.connectedAt > 0) return;
    stopWatchdog();
    publish({
      connectedAt: clock.now(),
      connecting: false,
      seconds: 0,
      phase: "active",
    });
    startClock();
    void measureE2ee();
    void refreshOutputs();
  };

  const startClock = () => {
    clockTimer?.cancel();
    clockTimer = clock.interval(() => {
      if (state.connectedAt <= 0) return;
      const seconds = Math.max(0, Math.floor((clock.now() - state.connectedAt) / 1000));
      if (seconds !== state.seconds) publish({ seconds });
    }, 1_000);
  };

  const armWatchdog = (delayMs: number = CALL_ICE_WATCHDOG_MS) => {
    stopWatchdog();
    watchdog = clock.schedule(() => {
      if (!peer || state.connectedAt > 0) return;
      // ICE stuck in CHECKING with no callback coming: restart it instead of
      // sitting on "Connecting…" forever (CallEngine.armIceWatchdog).
      void restartIce("Reconnecting…");
    }, delayMs);
  };

  const stopWatchdog = () => {
    watchdog?.cancel();
    watchdog = null;
  };

  const restartIce = async (notice: string) => {
    const connection = peer;
    const callId = state.callId;
    if (!connection || !callId) return;
    say(notice);
    try {
      connection.restartIce();
      const offer = await connection.createOffer({ iceRestart: true });
      await connection.setLocalDescription(offer);
      await transport.reoffer(options.api, callId, offer.sdp);
      awaitingReanswer = true;
    } catch {
      // A failed restart leaves the call where it was; the poll keeps trying.
    }
  };

  const handleConnectionState = () => {
    const connection = peer;
    if (!connection) return;
    const connectionState = connection.connectionState;
    const iceState = connection.iceConnectionState;
    if (connectionState === "connected" || iceState === "connected" || iceState === "completed") {
      markConnected();
      // A track can end while the path is down (the phone re-binds its remote
      // video at the same moment); re-measure the list instead of trusting the
      // last `ontrack`.
      publishRemote();
      return;
    }
    if (connectionState === "failed" || iceState === "failed") {
      // One automatic relay-first rescue, then honest failure.
      if (!relayRetryUsed) {
        relayRetryUsed = true;
        try {
          connection.setConfiguration({ iceServers: relayIceServersFor(iceMinted) });
        } catch {
          // setConfiguration can refuse mid-call; the restart below still runs.
        }
        void restartIce("Network is limited — connecting through a relay…");
        return;
      }
      say(CALL_RECONNECTING_COPY);
      return;
    }
    if (connectionState === "disconnected" || iceState === "disconnected") {
      // Mid-call blip: the clock keeps running and the path is repaired.
      if (state.connectedAt > 0) {
        say(CALL_RECONNECTING_COPY);
        armWatchdog(4_000);
      }
      return;
    }
    if (iceState === "checking") armWatchdog();
  };

  /* ------------------------------------------------------------------- sockets */

  const closeCallSocket = () => {
    callSocket?.close();
    callSocket = null;
    publish({ signal: "idle" });
  };

  const openCallSocket = (callId: string) => {
    if (!callId) return;
    closeCallSocket();
    callSocket = options.sockets({
      path: `/ws/call/${callId}`,
      token: options.token,
      parseFrame: (raw) => parseCallFrame(raw),
      onStatus: (status) => publish({ signal: status }),
      onFrame: (frame) => onCallFrame(frame as CallFrame | null, callId),
    });
  };

  const onCallFrame = (frame: CallFrame | null, callId: string) => {
    // A `hello` frame carries no call id: it is the DO's own acknowledgement.
    if (!frame || frame.type === "hello") return;
    if (frame.callId !== callId || frame.callId !== state.callId) {
      // Not ours: a stale frame from a call this device already left. A state
      // frame still costs one tick, because the row it names may be the one this
      // device is about to adopt.
      if (frame.type === "call") pokeTick();
      return;
    }
    switch (frame.type) {
      case "ice":
        if (!applyCandidate(frame.candidate)) pokeTick();
        return;
      case "call":
        if (frame.status === "ACTIVE" && !state.incoming && state.connectedAt === 0) {
          publish({ phase: "connecting", connecting: true });
        }
        pokeTick();
        return;
      case "media":
        if (frame.userId !== options.meId) {
          publish({
            peerCameraOff: !frame.camera,
            peerScreen: frame.screen,
            kind: frame.kind === "VIDEO" ? "VIDEO" : state.kind,
          });
        }
        pokeTick();
        return;
      case "reoffer":
        void handleReoffer();
        return;
      case "reanswer":
        void handleReanswer();
        return;
      default:
        pokeTick();
    }
  };

  const handleReoffer = async () => {
    const connection = peer;
    const callId = state.callId;
    if (!connection || !callId || awaitingReanswer) return;
    try {
      const row = await readRow(callId);
      const sdp = row?.reofferSdp ?? "";
      if (!sdp || row?.reofferFrom === options.meId) return;
      await connection.setRemoteDescription({ type: "offer", sdp });
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await transport.reanswer(options.api, callId, answer.sdp);
      flushIce();
    } catch {
      // A renegotiation that fails leaves the media path as it was.
    }
  };

  const handleReanswer = async () => {
    const connection = peer;
    const callId = state.callId;
    if (!connection || !callId) return;
    try {
      const row = await readRow(callId);
      const sdp = row?.reanswerSdp ?? "";
      if (!sdp) return;
      await connection.setRemoteDescription({ type: "answer", sdp });
      awaitingReanswer = false;
    } catch {
      awaitingReanswer = false;
    }
  };

  const readRow = async (callId: string): Promise<CallRow | null> => {
    try {
      const rows = await transport.active(options.api);
      return rows.find((row) => row.id === callId) ?? null;
    } catch {
      return null;
    }
  };

  /**
   * Frames arriving while a tick is in flight set a flag and cost exactly one
   * more tick afterwards — coalesced WITHOUT dropping, because a dropped ANSWER
   * frame would park the caller on "Ringing…" until the safety net.
   */
  const pokeTick = () => {
    pokeRequested = true;
    if (ticking) return;
    void drainTicks();
  };

  const drainTicks = async () => {
    if (ticking) return;
    ticking = true;
    try {
      do {
        pokeRequested = false;
        await tick();
      } while (pokeRequested && !disposed);
    } finally {
      ticking = false;
    }
    schedulePoll();
  };

  /* ------------------------------------------------------------------ e2ee code */

  const measureE2ee = async () => {
    const connection = peer;
    if (!connection || state.incoming === undefined) return;
    if (state.row?.group) return;
    const local = dtlsFingerprint(connection.localDescription?.sdp ?? null);
    const remote = dtlsFingerprint(connection.remoteDescription?.sdp ?? null);
    if (!local || !remote) return;
    const peerId = state.peer.id;
    if (!peerId) return;
    try {
      const code = await callSafetyCode(local, remote);
      const verdict = checkCallTrust(options.store.read(CALL_TRUST_KEY), peerId, remote);
      if (verdict.next !== (options.store.read(CALL_TRUST_KEY) ?? "")) {
        options.store.write(CALL_TRUST_KEY, verdict.next);
      }
      publish({ e2eeCode: code, e2eeChanged: verdict.verdict === "changed" });
      if (verdict.verdict === "changed") openVerify();
    } catch {
      // No subtle crypto (an insecure context): no code is better than a wrong one.
    }
  };

  /* ------------------------------------------------------------------ the poll */

  const schedulePoll = () => {
    if (disposed) return;
    pollTimer?.cancel();
    const delay = callPollDelayMs({
      signalLive: state.signal === "open",
      mediaUp: state.connectedAt > 0,
      active: state.phase !== "idle" && state.phase !== "ended",
      visible: visible(),
    });
    pollTimer = clock.schedule(() => void drainTicks(), delay);
  };

  const tick = async (): Promise<void> => {
    if (disposed) return;
    const guard = clock.timeout(CALL_ACTIVE_TIMEOUT_MS);
    let rows: readonly CallRow[];
    try {
      rows = await transport.active(options.api, guard.signal);
      netFailStreak = 0;
      publish({ polling: true });
    } catch {
      guard.cancel();
      netFailStreak += 1;
      if (netFailStreak === 3 && state.phase !== "idle") say(CALL_RECONNECTING_COPY);
      return;
    }
    guard.cancel();

    const candidates = rows.filter((row) => !ignored.has(row.id));
    const currentId = state.callId;
    const next =
      (currentId ? candidates.find((row) => row.id === currentId) : undefined) ??
      candidates[0] ??
      null;

    if (!next) {
      // The row is gone: the other side ended it, or the reaper took a stale ring.
      if (
        currentId &&
        (state.phase === "outgoing" ||
          state.phase === "incoming" ||
          state.phase === "connecting" ||
          state.phase === "active")
      ) {
        await teardown("");
      }
      return;
    }

    if (
      next.status === "ENDED" ||
      next.status === "DECLINED" ||
      next.status === "MISSED" ||
      next.status === "CANCELLED"
    ) {
      ignored.add(next.id);
      await teardown(next.status === "MISSED" ? CALL_COPY.noAnswer : "");
      return;
    }

    const incoming = next.incoming;
    const peerId = incoming ? next.callerId : next.calleeId;
    const peerTarget: CallPeerTarget = {
      id: peerId,
      name: next.other?.displayName || next.other?.username || state.peer.name || "KuchuPuchu",
      avatar: next.other?.avatarUrl || next.other?.avatarRef || state.peer.avatar,
      online: next.other?.online === true,
    };

    // A group row is listed by /active too. This client does not run the mesh, so
    // it never adopts one — but it must not spin on it either.
    if (next.group) {
      if (state.callId !== next.id) publish({ phase: "idle" });
      return;
    }

    const alreadyOurs = state.callId === next.id;
    const connectedBefore = state.connectedAt > 0;

    if (!alreadyOurs) {
      if (state.phase !== "idle" && state.phase !== "ended") {
        // Another call is live on this device; the server's LINE_BUSY gate is
        // what stops the second one, so ignore the newcomer rather than
        // hijacking the media that is already up.
        return;
      }
      outgoingRingAt = 0;
      seenIce.clear();
      iceCursor = "";
      publish({
        phase: incoming ? "incoming" : "outgoing",
        callId: next.id,
        kind: next.kind,
        incoming,
        peer: peerTarget,
        row: next,
        connectedAt: 0,
        seconds: 0,
        connecting: !incoming,
        minimized: false,
        error: "",
      });
      openCallSocket(next.id);
    } else {
      publish({ row: next, peer: peerTarget, kind: next.kind === "VIDEO" ? "VIDEO" : state.kind });
    }

    if (!incoming && next.status === "RINGING") {
      if (!outgoingRingAt) outgoingRingAt = clock.now();
      else if (outgoingRingTimedOut(outgoingRingAt, clock.now())) {
        // One minute of unanswered ringing is the caller's own give-up point
        // (CallEngine.tick). The row is still RINGING server-side, so it has to
        // be ENDED here — otherwise the callee's phone keeps ringing for a call
        // nobody is on until the Worker's own stale reaper gets to it.
        ignored.add(next.id);
        await transport.end(options.api, next.id).catch(() => undefined);
        await teardown(CALL_COPY.noAnswer);
        return;
      }
      // The callee answered while this read was in flight.
      if (next.answerSdp) publish({ phase: "connecting", connecting: true });
    } else {
      outgoingRingAt = 0;
    }

    if (next.status === "ACTIVE" || next.status === "RINGING") {
      await pullIce(next.id);
    }

    if (next.status === "ACTIVE") {
      if (!state.incoming && next.answerSdp && peer && !peer.remoteDescription) {
        try {
          await peer.setRemoteDescription({ type: "answer", sdp: next.answerSdp });
          flushIce();
        } catch {
          // A malformed answer is a dead call; the poll will see the row end.
        }
      }
      if (peer && !state.connecting && state.connectedAt === 0) {
        publish({ phase: "connecting", connecting: true });
      }
      // The peer's live media flags ride the row — the safety net for a `media`
      // frame that arrived while this tab was asleep.
      const flags = next.media[peerId];
      if (flags) {
        publish({
          peerCameraOff: flags.camera !== true,
          peerScreen: flags.screen === true,
        });
      }
      void measureE2ee();
    }

    if (connectedBefore && state.connectedAt === 0) publish({ connectedAt: clock.now() });
  };

  /* ------------------------------------------------------------------- teardown */

  const teardown = async (notice: string): Promise<void> => {
    ended = true;
    stopWatchdog();
    clockTimer?.cancel();
    clockTimer = null;
    closeCallSocket();
    if (peer) {
      try {
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
        peer.ontrack = null;
        peer.close();
      } catch {
        // A peer that already closed throws in some browsers.
      }
      peer = null;
    }
    releaseMedia();
    remoteTracks.length = 0;
    awaitingReanswer = false;
    relayRetryUsed = false;
    outgoingRingAt = 0;
    pendingIce.length = 0;
    seenIce.clear();
    iceCursor = "";
    const previousPhase = state.phase;
    publish({
      ...INITIAL_CALL_STATE,
      signal: "idle",
      outputs: state.outputs,
      outputSupported: state.outputSupported,
      polling: state.polling,
      notice: notice || state.notice,
    });
    ended = false;
    if (previousPhase !== "idle") schedulePoll();
  };

  /* ---------------------------------------------------------------------- start */

  const ensureIceConfig = async () => {
    if (iceLoaded) return;
    iceLoaded = true;
    iceMinted = await transport.iceConfig(options.api);
  };

  const buildPeer = (preAddVideo: boolean): PeerLike | null => {
    try {
      const connection = runtime.createPeer({ iceServers: iceServersFor(iceMinted) });
      connection.onicecandidate = (event) => {
        const candidate = event.candidate;
        if (!candidate || !candidate.candidate) return;
        sendIce({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
        });
      };
      connection.onconnectionstatechange = handleConnectionState;
      connection.oniceconnectionstatechange = handleConnectionState;
      connection.ontrack = (event) => bindRemote(event.track);
      // Every track is added WITH the stream it came from: a browser that adds
      // a bare track writes `msid:-` into the SDP and the far side refuses to
      // parse the offer at all. The phone passes its "kp" stream id for the same
      // reason; here the association is the real MediaStream object.
      const streams = localStream ? [localStream] : [];
      if (audioTrack) connection.addTrack(audioTrack, streams);
      if (cameraTrack) connection.addTrack(cameraTrack, streams);
      if (!cameraTrack && preAddVideo) {
        // Voice calls still get a sendrecv VIDEO m-line: without it there is
        // nowhere to put a screen-share or a late camera track, and a mid-call
        // addTrack would need a renegotiation this client does not do.
        try {
          connection.addTransceiver("video", {
            direction: "sendrecv",
            // Associated with the local stream, or the reserved m-line goes out
            // as `msid:-` and the callee cannot parse the offer at all.
            streams: localStream ? [localStream] : [],
          });
        } catch {
          // A browser that refuses a recvonly-free transceiver still runs the
          // call; only the later camera/share loses its slot.
        }
      }
      peer = connection;
      return connection;
    } catch {
      return null;
    }
  };

  const start = async (target: CallPeerTarget, kind: CallKind): Promise<void> => {
    if (disposed) return;
    if (!target.id) return;
    if (state.phase !== "idle" && state.phase !== "ended") {
      // A zombie call — no media for two minutes — must not block a new one
      // (owner round 24). Everything else is simply "already on a call".
      const stuck =
        state.connectedAt === 0 && clock.now() - (outgoingRingAt || clock.now()) > 120_000;
      if (!stuck) {
        say(CALL_COPY.statusBusy);
        return;
      }
      await teardown("");
    }
    publish({
      phase: "dialing",
      kind,
      incoming: false,
      peer: target,
      callId: "",
      error: "",
      minimized: false,
      connecting: true,
      cameraOff: kind !== "VIDEO",
    });
    ended = false;
    try {
      await ensureIceConfig();
      localStream = await runtime.capture(mediaRequestFor(kind));
      audioTrack = localStream.getAudioTracks()[0] ?? null;
      cameraTrack = kind === "VIDEO" ? (localStream.getVideoTracks()[0] ?? null) : null;
      publish({ localStream, cameraOff: cameraTrack === null });
      if (ended) return;

      const connection = buildPeer(true);
      if (!connection) {
        fail(CALL_COPY.startFailed);
        await teardown("");
        return;
      }
      // No legacy offer options: the receive-audio/receive-video intent the
      // phone expresses with `sdpConstraints()` is structural here (an audio
      // track + the pre-added sendrecv video m-line, see buildPeer).
      const offer: Sdp = await connection.createOffer();
      await connection.setLocalDescription(offer);

      const result: StartCallResult = await transport.start(options.api, {
        userId: target.id,
        kind,
        offerSdp: offer.sdp,
      });
      if (ended) {
        // The user hung up while the offer was in flight: never leave a row
        // ringing on the other phone.
        if (result.call) await transport.end(options.api, result.call.id).catch(() => undefined);
        return;
      }
      if (!result.call) {
        const busy = isBusyStatus(result.status);
        const copy = busy ? CALL_COPY.codeLineBusy : callRefusalCopy(result.code);
        // Tear the half-built call down FIRST, then publish the refusal once.
        // `teardown` resets the state to idle, so publishing before it would
        // leave the copy on screen for a beat and then wipe it — and a refusal
        // the user cannot read is the same as no refusal at all.
        await teardown("");
        publish({ error: copy, phase: busy ? "busy" : "idle" });
        if (busy) {
          // LINE_BUSY lives for one beat on the calling screen, like the phone's
          // own notice, instead of ringing forever or vanishing instantly.
          clock.schedule(() => publish({ phase: "idle", error: "" }), CALL_NOTICE_MS);
        }
        return;
      }

      ignored.delete(result.call.id);
      publish({
        phase: "outgoing",
        callId: result.call.id,
        row: result.call,
        kind: result.call.kind === "VIDEO" ? "VIDEO" : kind,
        connecting: true,
        seconds: 0,
        connectedAt: 0,
      });
      openCallSocket(result.call.id);
      flushIce();
      outgoingRingAt = clock.now();
      schedulePoll();
    } catch (error) {
      fail(permissionCopy(error));
      await teardown("");
      publish({ error: permissionCopy(error), phase: "idle" });
    }
  };

  /* --------------------------------------------------------------------- answer */

  const answer = async (): Promise<void> => {
    const row = state.row;
    if (!row || !state.incoming || state.callId !== row.id) return;
    if (peer && state.connectedAt > 0) return;
    const kind = row.kind;
    publish({ phase: "connecting", connecting: true, error: "" });
    try {
      await ensureIceConfig();
      // Capture and the offer hunt run together: opening a camera costs
      // 300–900 ms and used to sit between the Accept tap and the answer, so the
      // caller kept hearing ringback the whole time.
      const capturing = runtime.capture(mediaRequestFor(kind));
      let offer = row.offerSdp;
      for (let attempt = 0; attempt < 100 && !offer; attempt += 1) {
        const fresh = await readRow(row.id);
        offer = fresh?.offerSdp ?? "";
        if (offer || ended) break;
        await new Promise<void>((resolve) => {
          clock.schedule(() => resolve(), 120);
        });
      }
      if (ended) {
        await capturing.catch(() => null);
        return;
      }
      if (!offer) {
        await capturing.catch(() => null);
        fail(CALL_COPY.answerFailed);
        await teardown("");
        publish({ error: CALL_COPY.answerFailed, phase: "idle" });
        return;
      }
      localStream = await capturing;
      audioTrack = localStream.getAudioTracks()[0] ?? null;
      cameraTrack = kind === "VIDEO" ? (localStream.getVideoTracks()[0] ?? null) : null;
      publish({ localStream, cameraOff: cameraTrack === null });

      // The answering side must NOT pre-add a video transceiver: it flips the
      // offer's own m-line to sendrecv instead (round 33 item 21).
      const connection = buildPeer(false);
      if (!connection) {
        fail(CALL_COPY.answerFailed);
        await teardown("");
        return;
      }
      await connection.setRemoteDescription({ type: "offer", sdp: offer });
      try {
        connection
          .getTransceivers()
          .find((entry) => entry.kind === "video")
          ?.setDirection("sendrecv");
      } catch {
        // A browser without setDirection still answers; only a later camera on
        // THIS side loses its slot.
      }
      const answerSdp: Sdp = await connection.createAnswer();
      await connection.setLocalDescription(answerSdp);
      flushIce();
      // Pull the caller's candidates while the answer travels — they have been
      // on the server since the ring began.
      const pulling = pullIce(row.id);
      await transport.answer(options.api, row.id, answerSdp.sdp);
      await pulling;
      ignored.delete(row.id);
      openCallSocket(row.id);
      publish({ phase: "connecting", connecting: true, connectedAt: 0, seconds: 0 });
      schedulePoll();
    } catch (error) {
      fail(permissionCopy(error));
      await teardown("");
      publish({ error: permissionCopy(error), phase: "idle" });
    }
  };

  /* ------------------------------------------------------------------- controls */

  const decline = async (): Promise<void> => {
    const callId = state.callId;
    if (callId) {
      ignored.add(callId);
      await transport.decline(options.api, callId).catch(() => undefined);
    }
    await teardown("");
  };

  const hangup = async (): Promise<void> => {
    const callId = state.callId;
    if (callId) {
      ignored.add(callId);
      await transport.end(options.api, callId).catch(() => undefined);
    }
    await teardown("");
  };

  const toggleMute = () => {
    const muted = !state.muted;
    if (audioTrack) audioTrack.enabled = !muted;
    publish({ muted });
  };

  const postMedia = (flags: { camera?: boolean; screen?: boolean }) => {
    const callId = state.callId;
    if (!callId) return;
    void transport
      .postMedia(options.api, callId, flags)
      .then((result) => {
        if (result.kind === "VIDEO" && state.kind !== "VIDEO") publish({ kind: "VIDEO" });
      })
      .catch(() => undefined);
  };

  const toggleCamera = async () => {
    if (state.sharing) return;
    const callId = state.callId;
    if (!callId || !peer) return;
    if (!cameraTrack) {
      // Turning video on mid-call: capture, then drop the track into the
      // sendrecv m-line the offer already negotiated — no renegotiation.
      try {
        const stream = await runtime.capture({ audio: false, video: true });
        const track = stream.getVideoTracks()[0];
        if (!track) throw { name: "NotFoundError", message: "no camera" };
        cameraTrack = track;
        const sender = videoSender();
        if (sender) await sender.replaceTrack(track as MediaTrackLike);
        else peer.addTrack(track, [stream]);
        publish({ cameraOff: false, kind: "VIDEO" });
        // Owner round 31 item 19: the row becomes VIDEO server-side, so the
        // other side converts too — not just this one's memory.
        postMedia({ camera: true });
      } catch (error) {
        publish({ cameraOff: true });
        say(cameraPermissionCopy(error));
      }
      return;
    }
    const cameraOff = !state.cameraOff;
    cameraTrack.enabled = !cameraOff;
    publish({ cameraOff });
    if (!cameraOff && state.kind === "AUDIO") publish({ kind: "VIDEO" });
    postMedia({ camera: !cameraOff });
  };

  const toggleShare = async () => {
    const callId = state.callId;
    if (!callId || !peer) return;
    if (state.sharing) {
      const sender = videoSender();
      try {
        await sender?.replaceTrack(cameraTrack);
      } catch {
        // Without a sender there is nothing to swap back; the track stays put.
      }
      if (shareStream) {
        for (const track of shareStream.getTracks()) stopTrack(track);
        shareStream = null;
      }
      publish({ sharing: false });
      postMedia({ screen: false });
      return;
    }
    try {
      const stream = await runtime.captureDisplay();
      const track = stream.getVideoTracks()[0];
      if (!track) throw { name: "NotFoundError", message: "no screen track" };
      shareStream = stream;
      const sender = videoSender();
      if (sender) await sender.replaceTrack(track);
      else peer.addTrack(track, [stream]);
      // The browser's own "Stop sharing" pill ends the track behind our back.
      track.onended = () => {
        if (!state.sharing) return;
        void toggleShare();
      };
      publish({ sharing: true });
      // A screen share never changes the call's kind: an audio call stays audio
      // (owner round 31 item 19) and the other side shows the preview card.
      postMedia({ screen: true });
    } catch (error) {
      say(screenShareDeniedCopy(error));
    }
  };

  const refreshOutputs = async () => {
    try {
      const devices = await runtime.listAudioOutputs();
      const choices = audioOutputChoices(devices);
      const supported = await runtime.setAudioOutput(state.outputId).catch(() => false);
      publish({
        outputs: choices,
        outputSupported: supported || state.outputSupported,
      });
    } catch {
      publish({ outputs: [], outputSupported: false });
    }
  };

  const setOutput = async (deviceId: string) => {
    const moved = await runtime.setAudioOutput(deviceId).catch(() => false);
    publish({ outputId: moved ? deviceId : state.outputId, outputSupported: moved });
    if (!moved) say(CALL_COPY.limitRoutes);
  };

  const quickReply = async () => {
    const peerId = state.peer.id;
    const handler = options.onQuickReply;
    await decline();
    if (peerId && handler) await handler(peerId, CALL_COPY.quickReply).catch(() => undefined);
  };

  /* ------------------------------------------------------------------ lifecycle */

  const begin = () => {
    if (disposed) return;
    if (!userSocket) {
      userSocket = options.sockets({
        path: "/ws/user",
        token: options.token,
        parseFrame: (raw) => parseIncomingCallPing(raw),
        onStatus: () => undefined,
        onFrame: (frame) => {
          const ping = frame as ReturnType<typeof parseIncomingCallPing>;
          if (!ping) return;
          pokeTick();
          // The server hides a RINGING call from the callee for its first 1.6 s,
          // so a tick inside that window sees nothing — one more tick after it.
          clock.schedule(() => pokeTick(), CALL_PHANTOM_RECHECK_MS);
        },
      });
    }
    void refreshOutputs();
    schedulePoll();
  };

  const dispose = () => {
    disposed = true;
    pollTimer?.cancel();
    pollTimer = null;
    clockTimer?.cancel();
    clockTimer = null;
    stopWatchdog();
    noticeTimer?.cancel();
    codeTimer?.cancel();
    closeCallSocket();
    userSocket?.close();
    userSocket = null;
    if (peer) {
      try {
        peer.close();
      } catch {
        // Already closed.
      }
      peer = null;
    }
    releaseMedia();
    listeners.clear();
  };

  const showCode = () => {
    codeTimer?.cancel();
    publish({ codeVisible: true });
    // E4f: the code hides itself after 3 s; a tap while it shows opens the sheet.
    codeTimer = clock.schedule(() => publish({ codeVisible: false }), CALL_CODE_VISIBLE_MS);
  };

  /**
   * Open the sheet with the code already revealed. The phone shows the code for
   * three seconds on a tap (`E2eeCall.revealCode`); a CHANGED fingerprint raises
   * the same sheet on its own and keeps it there until the user closes it, so it
   * is not hidden again by the peek timer.
   */
  const openVerify = () => {
    codeTimer?.cancel();
    codeTimer = null;
    publish({ verifyOpen: true, codeVisible: true });
  };

  const closeVerify = () => {
    codeTimer?.cancel();
    codeTimer = null;
    publish({ verifyOpen: false, codeVisible: false });
  };

  const trustPeer = () => {
    const remote = peer ? dtlsFingerprint(peer.remoteDescription?.sdp ?? null) : null;
    if (!remote || !state.peer.id) return;
    options.store.write(
      CALL_TRUST_KEY,
      trustCallPeer(options.store.read(CALL_TRUST_KEY), state.peer.id, remote),
    );
    publish({ e2eeChanged: false });
  };

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin,
    dispose,
    start,
    answer,
    decline,
    hangup,
    toggleMute,
    toggleCamera,
    toggleShare,
    minimize: () => publish({ minimized: true }),
    restore: () => publish({ minimized: false }),
    showCode,
    openVerify,
    closeVerify,
    trustPeer,
    refreshOutputs,
    setOutput,
    quickReply,
    dismissError: () => publish({ error: "" }),
    tick,
  };
}

/**
 * The browser clock: `performance`-free on purpose, because every duration here
 * is compared with server timestamps and with `Date.parse` of the row's own
 * fields.
 */
export function browserClock(): CallClock {
  return {
    now: () => Date.now(),
    schedule: (callback, delayMs) => {
      const id = window.setTimeout(callback, delayMs);
      return { cancel: () => window.clearTimeout(id) };
    },
    interval: (callback, delayMs) => {
      const id = window.setInterval(callback, delayMs);
      return { cancel: () => window.clearInterval(id) };
    },
    timeout: (ms) => {
      const controller = new AbortController();
      const id = window.setTimeout(() => controller.abort(), ms);
      return {
        signal: controller.signal,
        cancel: () => window.clearTimeout(id),
      };
    },
  };
}

/** `localStorage` behind the engine's tiny interface, with a private-mode guard. */
export function browserStore(): CallStore {
  return {
    read(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A full or blocked store costs the TOFU memory, never the call.
      }
    },
  };
}

export function visibilityOf(): boolean {
  try {
    return typeof document === "undefined" ? true : document.visibilityState === "visible";
  } catch {
    return true;
  }
}

export type { CallPhase };
