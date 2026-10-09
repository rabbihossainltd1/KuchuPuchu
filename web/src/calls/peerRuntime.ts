/**
 * The browser half of a call: the pieces that touch `RTCPeerConnection`,
 * `getUserMedia`, `getDisplayMedia` and the audio-output picker.
 *
 * They live behind one interface so `callEngine.ts` stays free of the DOM — a
 * Node contract case can drive the whole signalling sequence (offer → POST →
 * answer → ICE → connected → renegotiate → end) against a scripted fake, and the
 * browser gets the real thing from `browserPeerRuntime()`.
 *
 * Every shape here mirrors the WebRTC standard objects closely enough that the
 * browser implementation is a thin pass-through, and loosely enough that a fake
 * does not have to grow a media stack.
 */

import type { CallMediaRequest, IceServer } from "./callsModel";

export type Sdp = { readonly type: "offer" | "answer" | "rollback"; readonly sdp: string };

export type IceCandidateInit = {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number;
};

export type MediaTrackLike = {
  readonly id: string;
  readonly kind: "audio" | "video";
  readonly readyState: string;
  /**
   * The platform's own track object, opaque for the same reason
   * `MediaStreamLike.raw` is: only `createStream` may look at it, so a fake
   * track in a contract case needs no media stack behind it.
   */
  readonly raw?: unknown;
  enabled: boolean;
  stop(): void;
  /** Present on a screen-share video track only; fires when the user stops it. */
  onended?: (() => void) | null;
};

export type MediaStreamLike = {
  readonly id: string;
  /**
   * The platform's own stream object, opaque on purpose: only a renderer may
   * look at it (to set `srcObject`), never the engine, so a fake stream in a
   * contract case needs no media stack behind it.
   */
  readonly raw?: unknown;
  getTracks(): readonly MediaTrackLike[];
  getAudioTracks(): readonly MediaTrackLike[];
  getVideoTracks(): readonly MediaTrackLike[];
  addTrack(track: MediaTrackLike): void;
  removeTrack(track: MediaTrackLike): void;
};

export type RtcSenderLike = {
  readonly track: MediaTrackLike | null;
  replaceTrack(track: MediaTrackLike | null): Promise<void>;
};

export type RtcTransceiverLike = {
  readonly kind: "audio" | "video";
  readonly direction: string;
  readonly sender: RtcSenderLike;
  setDirection(direction: string): void;
};

export type PeerLike = {
  readonly localDescription: Sdp | null;
  readonly remoteDescription: Sdp | null;
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly signalingState: string;
  createOffer(options?: { iceRestart?: boolean }): Promise<Sdp>;
  createAnswer(): Promise<Sdp>;
  setLocalDescription(description?: Sdp): Promise<void>;
  setRemoteDescription(description: Sdp): Promise<void>;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  /**
   * Add a track, associated with the stream it came from. The association is
   * not cosmetic: without it the browser writes `a=ssrc:… msid:- <track>` into
   * the SDP, and the OTHER side's parser rejects that line outright
   * ("Invalid SDP line") — a call that looks fine locally and never connects.
   * The phone passes its own stream id ("kp") for the same reason.
   */
  addTrack(track: MediaTrackLike, streams?: readonly MediaStreamLike[]): RtcSenderLike;
  /**
   * Reserve an m-line. `streams` matters as much as `direction`: a transceiver
   * with no stream association makes the browser write `a=ssrc:… msid:- <track>`
   * for it, and the far side rejects the whole description ("Invalid SDP line").
   * A voice call reserves its video m-line this way, so the association has to
   * be there from the start — the camera arrives later with `replaceTrack`.
   */
  addTransceiver(
    kind: "audio" | "video",
    init?: { direction?: string; streams?: readonly MediaStreamLike[] },
  ): RtcTransceiverLike;
  getSenders(): readonly RtcSenderLike[];
  getTransceivers(): readonly RtcTransceiverLike[];
  setConfiguration(config: { iceServers: readonly IceServer[] }): void;
  restartIce(): void;
  close(): void;
  onicecandidate: ((event: { candidate: IceCandidateInit | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  ontrack: ((event: { track: MediaTrackLike | null }) => void) | null;
};

export type AudioOutputDevice = {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string;
};

export type CallMediaFailure = {
  /** The `DOMException.name`, which is what the copy is keyed on. */
  readonly name: string;
  readonly message: string;
};

export function isCallMediaFailure(error: unknown): error is CallMediaFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
  );
}

/**
 * Everything the engine needs from the platform. A fake supplies scripted
 * objects; the browser supplies the real APIs.
 */
export type PeerRuntime = {
  createPeer(config: { iceServers: readonly IceServer[] }): PeerLike;
  /**
   * Ask for the microphone (and camera on a video call). Refusal throws with a
   * `name` the copy table understands — the engine never guesses at it.
   */
  capture(request: CallMediaRequest): Promise<MediaStreamLike>;
  /** The browser's own screen/tab/window picker. Cancelling throws. */
  captureDisplay(): Promise<MediaStreamLike>;
  listAudioOutputs(): Promise<readonly AudioOutputDevice[]>;
  /**
   * Wrap received tracks in a stream object a renderer can put on ONE media
   * element. Remote audio is inaudible until it is on an element, so the engine
   * accumulates the tracks `ontrack` delivers and asks for the stream here —
   * the engine itself never constructs media objects.
   */
  createStream(tracks: readonly MediaTrackLike[]): MediaStreamLike;
  /**
   * Move the call's audio to a chosen output. Resolves false when this browser
   * has no such control at all, so the UI can say that instead of showing a
   * button that does nothing.
   */
  setAudioOutput(deviceId: string): Promise<boolean>;
};

/**
 * The browser implementation. Kept in its own file so the engine, the model and
 * the contract case never pull a `navigator` reference into a Node process.
 *
 * Two rules make this wrapper honest rather than decorative:
 *
 * 1. Every event handler the engine assigns to a `PeerLike` is FORWARDED to the
 *    real `RTCPeerConnection`. A wrapper that merely stored them would leave a
 *    call with no ICE candidates, no connected state and no remote media — and
 *    it would still look like a call for the first few seconds.
 * 2. Every track crossing the boundary is unwrapped to the platform's own
 *    object. `addTrack` and `replaceTrack` reject anything that is not a real
 *    `MediaStreamTrack`, and the engine only ever holds wrappers.
 */
export function browserPeerRuntime(sinkElement: () => HTMLMediaElement | null): PeerRuntime {
  return {
    createPeer(config) {
      const iceServers = config.iceServers.map((server) => ({
        urls: [...server.urls],
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      }));
      // Unified Plan is the only semantics a modern browser offers; the phone
      // pins it explicitly, and `bundlePolicy: "max-bundle"` plus
      // `rtcpMuxPolicy: "require"` are the Web defaults it also relies on.
      const peer = new RTCPeerConnection({
        iceServers,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceCandidatePoolSize: 2,
      });

      /* The engine's handlers, held here so the real peer can forward to them
         and so the engine can read back what it assigned (it nulls them on
         teardown, which must really stop the forwarding). */
      let iceHandler: PeerLike["onicecandidate"] = null;
      let connectionHandler: PeerLike["onconnectionstatechange"] = null;
      let iceConnectionHandler: PeerLike["oniceconnectionstatechange"] = null;
      let trackHandler: PeerLike["ontrack"] = null;

      peer.onicecandidate = (event) => {
        if (!iceHandler) return;
        const candidate = event.candidate;
        iceHandler({
          candidate: candidate
            ? {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
              }
            : null,
        });
      };
      peer.onconnectionstatechange = () => {
        connectionHandler?.();
      };
      peer.oniceconnectionstatechange = () => {
        iceConnectionHandler?.();
      };
      peer.ontrack = (event) => {
        // A remote track arrives as the platform's own object; the engine only
        // ever handles wrappers, and `createStream` needs `raw` to put it back
        // on an element.
        trackHandler?.({ track: event.track ? wrapTrack(event.track) : null });
      };

      return {
        get localDescription() {
          return peer.localDescription as Sdp | null;
        },
        get remoteDescription() {
          return peer.remoteDescription as Sdp | null;
        },
        get connectionState() {
          return peer.connectionState;
        },
        get iceConnectionState() {
          return peer.iceConnectionState;
        },
        get signalingState() {
          return peer.signalingState;
        },
        createOffer: (options) =>
          peer.createOffer(
            options ? { iceRestart: options.iceRestart === true } : undefined,
          ) as Promise<Sdp>,
        createAnswer: () => peer.createAnswer() as Promise<Sdp>,
        setLocalDescription: (description) =>
          description
            ? peer.setLocalDescription(description as RTCSessionDescriptionInit)
            : peer.setLocalDescription(),
        setRemoteDescription: (description) =>
          peer.setRemoteDescription(description as RTCSessionDescriptionInit),
        addIceCandidate: (candidate) =>
          peer.addIceCandidate(candidate as RTCIceCandidateInit).then(() => undefined),
        addTrack: (track, streams) => {
          const raw = rawTrack(track);
          // There is no such thing as adding "no track": the engine only calls
          // this with one, and a clear throw beats a silent no-op here.
          if (!raw) throw new TypeError("addTrack needs a track.");
          const rawStreams = (streams ?? [])
            .map((stream) => stream.raw)
            .filter((stream): stream is MediaStream => stream instanceof MediaStream);
          return wrapSender(peer.addTrack(raw, ...rawStreams));
        },
        addTransceiver: (kind, init) => {
          const streams = (init?.streams ?? [])
            .map((stream) => stream.raw)
            .filter((stream): stream is MediaStream => stream instanceof MediaStream);
          return wrapTransceiver(
            peer.addTransceiver(kind, {
              ...(init?.direction
                ? { direction: init.direction as RTCRtpTransceiverDirection }
                : {}),
              ...(streams.length > 0 ? { streams } : {}),
            }),
          );
        },
        getSenders: () => peer.getSenders().map(wrapSender),
        getTransceivers: () => peer.getTransceivers().map(wrapTransceiver),
        setConfiguration: (next) => {
          peer.setConfiguration({
            iceServers: next.iceServers.map((server) => ({
              urls: [...server.urls],
              ...(server.username ? { username: server.username } : {}),
              ...(server.credential ? { credential: server.credential } : {}),
            })),
          });
        },
        restartIce: () => peer.restartIce(),
        close: () => peer.close(),
        get onicecandidate() {
          return iceHandler;
        },
        set onicecandidate(handler) {
          iceHandler = handler;
        },
        get onconnectionstatechange() {
          return connectionHandler;
        },
        set onconnectionstatechange(handler) {
          connectionHandler = handler;
        },
        get oniceconnectionstatechange() {
          return iceConnectionHandler;
        },
        set oniceconnectionstatechange(handler) {
          iceConnectionHandler = handler;
        },
        get ontrack() {
          return trackHandler;
        },
        set ontrack(handler) {
          trackHandler = handler;
        },
      };
    },

    async capture(request) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: request.audio
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
        video: request.video
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
          : false,
      });
      return wrapStream(stream);
    },

    async captureDisplay() {
      const display = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
      };
      if (typeof display.getDisplayMedia !== "function") {
        throw { name: "NotFoundError", message: "This browser cannot share a screen." };
      }
      const stream = await display.getDisplayMedia({ video: true, audio: false });
      return wrapStream(stream);
    },

    createStream(tracks) {
      return wrapStream(new MediaStream(tracks.map(rawTrack).filter(notNull)));
    },

    async listAudioOutputs() {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((device) => ({
        deviceId: device.deviceId,
        kind: device.kind,
        label: device.label,
      }));
    },

    async setAudioOutput(deviceId) {
      // `setSinkId` is not in the HTMLMediaElement type: it is a Chromium-only
      // extension, which is exactly why the UI gates the control on it.
      const element = sinkElement() as
        | (HTMLMediaElement & {
            setSinkId?: (id: string) => Promise<void>;
          })
        | null;
      if (!element || typeof element.setSinkId !== "function") return false;
      try {
        await element.setSinkId(deviceId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* ------------------------------------------------------------ track wrappers */

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * The platform track behind a wrapper. A wrapper that is not one of ours (a fake
 * in a contract case) is passed through untouched, which is what lets the same
 * engine run against both.
 */
function rawTrack(track: MediaTrackLike | null): MediaStreamTrack | null {
  if (!track) return null;
  const raw = (track as { raw?: unknown }).raw;
  if (raw instanceof MediaStreamTrack) return raw;
  return track as unknown as MediaStreamTrack;
}

/** `onended` lives in a side table: the platform track owns the real property. */
const endedHandlers = new WeakMap<MediaStreamTrack, (() => void) | null>();

function wrapTrack(track: MediaStreamTrack): MediaTrackLike {
  return {
    id: track.id,
    kind: track.kind === "video" ? "video" : "audio",
    raw: track,
    get readyState() {
      return track.readyState;
    },
    get enabled() {
      return track.enabled;
    },
    set enabled(value: boolean) {
      track.enabled = value;
    },
    stop() {
      track.stop();
    },
    get onended() {
      return endedHandlers.get(track) ?? null;
    },
    set onended(next: (() => void) | null) {
      endedHandlers.set(track, next);
      track.onended = next ? () => next() : null;
    },
  };
}

function wrapSender(sender: RTCRtpSender): RtcSenderLike {
  return {
    get track() {
      return sender.track ? wrapTrack(sender.track) : null;
    },
    // The engine replaces a track with a WRAPPER; the platform needs the real
    // object, and this is the call a mid-call camera or screen share lives on.
    replaceTrack: (track) => sender.replaceTrack(rawTrack(track)),
  };
}

function wrapTransceiver(transceiver: RTCRtpTransceiver): RtcTransceiverLike {
  return {
    get kind() {
      return transceiver.receiver.track?.kind === "video" ? "video" : "audio";
    },
    get direction() {
      return transceiver.direction;
    },
    get sender() {
      return wrapSender(transceiver.sender);
    },
    // The answering side flips the offer's own video m-line to sendrecv instead
    // of pre-adding one (round 33 item 21) — that is this setter.
    setDirection(direction: string) {
      transceiver.direction = direction as RTCRtpTransceiverDirection;
    },
  };
}

function wrapStream(stream: MediaStream): MediaStreamLike {
  return {
    id: stream.id,
    raw: stream,
    getTracks: () => stream.getTracks().map(wrapTrack),
    getAudioTracks: () => stream.getAudioTracks().map(wrapTrack),
    getVideoTracks: () => stream.getVideoTracks().map(wrapTrack),
    addTrack: (track) => {
      const raw = rawTrack(track);
      if (raw) stream.addTrack(raw);
    },
    removeTrack: (track) => {
      const raw = rawTrack(track);
      if (raw) stream.removeTrack(raw);
    },
  };
}
