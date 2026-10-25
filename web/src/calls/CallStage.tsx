import { RealmBadge } from "../messaging/RealmBadge";
/**
 * The call surface: the ring, the outgoing wait, the in-call screens and the
 * E2EE verify sheet — one overlay, the way the phone stacks call screens over
 * whatever else is open.
 *
 * `CallScreens.kt` is the design being matched, and every divergence from it is
 * a browser fact that is stated on screen rather than papered over:
 *
 * - The phone's Accept and Decline circles fire on an UPWARD SWIPE (round 25, so
 *   a plain tap in a pocket cannot answer a call). A browser has no equivalent
 *   gesture to protect against, and the parity plan requires a keyboard/mouse
 *   equivalent for every gesture, so both are ordinary labelled buttons: click,
 *   Enter or Space. A swipe-up would be an extra affordance here, not a
 *   substitute for one.
 * - "Remind me" on the ring screen is AlarmManager + a system notification. There
 *   is no browser substitute, so it is not drawn as a dead button; the limits
 *   panel says what is missing.
 * - The audio-route button cycles hardware outputs (earpiece / Bluetooth /
 *   speaker). A browser can only move audio with `setSinkId`, which is
 *   Chromium-only: when it exists this renders a labelled device picker, and when
 *   it does not the row says so instead of pretending.
 * - "Add call" is a placeholder on the phone too ("Adding calls is coming in a
 *   future update."), so it stays a placeholder here — disabled, same copy.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { CallEngine, CallEngineState } from "./callEngine";
import {
  AUDIO_OUTPUT_UNSUPPORTED_COPY,
  CALL_COPY,
  callStatusText,
  clockText,
  e2eeChangedCopy,
  e2eeSheetCopy,
  incomingCallLine,
} from "./callsModel";
import { useAuth } from "../auth/AuthContext";
import { useResolvedAvatar } from "../messaging/avatars";
import type { MediaStreamLike } from "./peerRuntime";

type Props = {
  readonly engine: CallEngine;
  readonly state: CallEngineState;
};

export function CallStage({ engine, state }: Props) {
  // Light call payloads (the incoming ring) carry only the `id@vN` cache
  // token in peer.avatar; resolved call-backs carry a data-URI. Render either
  // through the shared per-ref avatar cache, never the raw token.
  const { api } = useAuth();
  const peerAvatar = useResolvedAvatar(api, state.peer.avatar);
  // The engine owns the sheet, not this component: a fingerprint that CHANGED
  // has to raise it by itself mid-call, with no click anywhere on this screen.
  const verifyOpen = state.verifyOpen;
  const phase = state.phase;
  // Above every early return below (hook count must stay constant): the share
  // card's aspect listener. Inert while nobody shares (peerScreen false).
  const shareAspect = useStreamAspect(state.peerScreen ? state.remoteStream : null);

  // Escape is the keyboard's way out of a sheet, not out of a call: hanging up
  // by accident is worse than one more keypress.
  useEffect(() => {
    if (!verifyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        engine.closeVerify();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verifyOpen, engine]);

  // The fullscreen share view: Escape collapses it, the way the phone's Back
  // gesture does (ShareFullscreen's BackHandler).
  useEffect(() => {
    if (!state.shareFull) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        engine.exitShareFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.shareFull, engine]);

  if (phase === "idle" || phase === "ended") {
    if (!state.error) return null;
    return (
      <div
        className="call-stage call-stage--alert"
        role="dialog"
        aria-modal="true"
        aria-label={CALL_COPY.startFailed}
      >
        <div className="call-stage__body">
          <Icon name="close" size={26} />
          <p className="call-stage__error" role="alert">
            {state.error}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={engine.dismissError}
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (state.minimized) {
    return (
      <button
        type="button"
        className="call-pill"
        onClick={engine.restore}
        aria-label={`${CALL_COPY.returnToCall} — ${state.peer.name}`}
      >
        <Icon name={state.kind === "VIDEO" ? "videoCall" : "phone"} size={15} />
        <span>
          {state.peer.name}
          <RealmBadge realm={state.peer.realm} /> · {statusLine(state)}
        </span>
      </button>
    );
  }

  const ringing = phase === "incoming";
  const outgoing = phase === "dialing" || phase === "outgoing" || phase === "busy";
  const video = state.kind === "VIDEO";
  const connected = state.connectedAt > 0;

  return (
    <div
      className={`call-stage${video && connected ? " call-stage--video" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={
        ringing
          ? incomingCallLine(state.kind)
          : `${video ? "Video" : "Voice"} call with ${state.peer.name}`
      }
    >
      <div className="call-stage__backdrop" aria-hidden="true">
        {peerAvatar ? <img src={peerAvatar} alt="" /> : null}
      </div>

      {/* Visual only: the call's AUDIO is played by the single element the layer
          owns, so a video call never doubles the sound and an audio call still
          has somewhere to be heard. */}
      {video && connected ? (
        <VideoSurface
          stream={state.remoteStream}
          className={
            state.peerScreen
              ? "call-stage__remote call-stage__remote--screen"
              : "call-stage__remote"
          }
          label={`${state.peer.name}'s video`}
        />
      ) : null}

      <div className="call-stage__body">
        <header className="call-stage__head">
          <span className="call-stage__avatar" aria-hidden="true">
            {peerAvatar ? (
              <img src={peerAvatar} alt="" />
            ) : (
              state.peer.name.trim().charAt(0).toUpperCase() || "?"
            )}
          </span>
          <h2>
            {state.peer.name}
            <RealmBadge realm={state.peer.realm} />
          </h2>
          <p className="call-stage__status" role="status" aria-live="polite">
            {ringing ? incomingCallLine(state.kind) : statusLine(state)}
          </p>
          {!ringing && !outgoing && state.peerScreen ? (
            <p className="call-stage__peer-share">{CALL_COPY.peerSharing}</p>
          ) : null}

          {/* E4: the safety-code line. It stays plain "End-to-end encrypted"
              until tapped, exactly like the phone (E4f) — and a CHANGED code
              opens the sheet at once, because that is the one moment the
              ceremony is not optional. */}
          {connected && state.e2eeCode ? (
            <button
              type="button"
              className={`call-stage__e2ee${state.e2eeChanged ? " is-warn" : ""}`}
              onClick={() => {
                if (state.e2eeChanged || state.codeVisible) engine.openVerify();
                else engine.showCode();
              }}
            >
              <Icon name="lock" size={12} />
              <span>
                {state.e2eeChanged
                  ? CALL_COPY.e2eeChanged
                  : state.codeVisible
                    ? state.e2eeCode
                    : CALL_COPY.e2eeLine}
              </span>
            </button>
          ) : null}
        </header>

        {video && connected && state.localStream && !state.cameraOff ? (
          <VideoSurface
            stream={state.localStream}
            className="call-stage__self"
            label="Your video"
          />
        ) : null}

        {/* Their screen share on a VOICE call: the phone shows a 16:9 preview
            card above the buttons and the call stays a voice call (round 31
            item 19). Tap it for the phone's fullscreen view of the share.
            Owner 2026-10-19: the card followed the FIXED 16:9 of the phrase,
            so a shared phone screen (portrait, ~9:19) shrank to a thin letter
            and a tall desktop window showed pillar bars. The card now adopts
            the shared screen's own ratio, clamped so an extreme share can
            never crowd the controls off the stage. */}
        {!video && connected && state.peerScreen ? (
          <div
            className="call-stage__share-card"
            style={
              shareAspect.tall
                ? { width: "auto", height: "min(46vh, 430px)", maxWidth: "76%" }
                : undefined
            }
          >
            <div className="call-stage__share-preview" style={{ aspectRatio: shareAspect.ratio }}>
              <VideoSurface
                stream={state.remoteStream}
                className="call-stage__share-preview__video"
                label={`${state.peer.name}'s shared screen`}
              />
            </div>
            <button
              type="button"
              className="call-stage__share-expand"
              aria-label={CALL_COPY.shareExpand}
              onClick={engine.openShareFullscreen}
            >
              <Icon name="fullscreen" size={16} />
            </button>
          </div>
        ) : null}

        {state.error ? (
          <p className="call-stage__error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="call-stage__notice" role="status">
            {state.notice}
          </p>
        ) : null}

        {ringing ? (
          <div className="call-stage__ring">
            {/* The phone's ring circles carry no caption — the colour and the
                glyph are the meaning (owner 2026-10-19: "accept decline icon
                bubble er niche theke jacche, thik nai aligment nai thik moto").
                Screen readers get the action from aria-label instead. */}
            <button
              type="button"
              className="call-circle call-circle--decline"
              aria-label={CALL_COPY.decline}
              onClick={() => void engine.decline()}
            >
              <Icon name="phoneOff" size={26} />
            </button>
            <button
              type="button"
              className="call-circle call-circle--accept"
              aria-label={CALL_COPY.accept}
              onClick={() => void engine.answer()}
            >
              <Icon name={video ? "videoCall" : "phone"} size={26} />
            </button>
          </div>
        ) : null}

        {ringing ? (
          <div className="call-stage__quick">
            <button type="button" className="text-button" onClick={() => void engine.quickReply()}>
              {CALL_COPY.messageInstead}
            </button>
            {/* "Remind me" is AlarmManager on the phone. There is no browser
                substitute, so it is disclosed instead of drawn dead. */}
            <span className="call-stage__quick-note">{CALL_COPY.limitRemind}</span>
          </div>
        ) : null}

        {!ringing ? (
          <div className={`call-controls${video && connected ? " call-controls--strip" : ""}`}>
            <AudioOutput engine={engine} state={state} disabled={!connected} />

            <button
              type="button"
              className={`call-action${state.muted ? " is-active" : ""}`}
              onClick={engine.toggleMute}
              disabled={!connected}
            >
              <Icon name={state.muted ? "micOff" : "mic"} size={19} />
              <span>{state.muted ? CALL_COPY.unmute : CALL_COPY.mute}</span>
            </button>

            <button
              type="button"
              className={`call-action${video && !state.cameraOff ? " is-active" : ""}`}
              onClick={() => void engine.toggleCamera()}
              disabled={!connected || state.sharing}
            >
              <Icon name={state.cameraOff ? "videoOff" : "videoCall"} size={19} />
              <span>
                {video ? (state.cameraOff ? CALL_COPY.cameraOn : CALL_COPY.video) : CALL_COPY.video}
              </span>
            </button>

            {/* The phone's own placeholder, kept a placeholder. */}
            <button type="button" className="call-action" disabled title={CALL_COPY.limitAddCall}>
              <Icon name="plus" size={19} />
              <span>Add call</span>
            </button>

            <button
              type="button"
              className={`call-action${state.sharing ? " is-active" : ""}`}
              onClick={() => void engine.toggleShare()}
              disabled={!connected}
            >
              <Icon name="screenShare" size={19} />
              <span>{state.sharing ? CALL_COPY.stopShare : CALL_COPY.shareScreen}</span>
            </button>

            <button
              type="button"
              className="call-action call-action--danger"
              onClick={() => void engine.hangup()}
            >
              <Icon name="phoneOff" size={19} />
              <span>{connected ? CALL_COPY.endCall : CALL_COPY.cancelCall}</span>
            </button>
          </div>
        ) : null}

        <div className="call-stage__foot">
          <button
            type="button"
            className="text-button"
            onClick={engine.minimize}
            disabled={ringing}
          >
            <Icon name="arrow" size={14} />
            <span>{CALL_COPY.minimize}</span>
          </button>
          <details className="chat-notes call-stage__limits">
            <summary>{CALL_COPY.limitsTitle}</summary>
            <ul>
              <li>{CALL_COPY.limitTakeover}</li>
              <li>{CALL_COPY.limitBackground}</li>
              <li>{CALL_COPY.limitRing}</li>
              <li>{CALL_COPY.limitRoutes}</li>
              <li>{CALL_COPY.limitCapture}</li>
              <li>{CALL_COPY.limitAddCall}</li>
            </ul>
          </details>
        </div>
      </div>

      {verifyOpen ? (
        <VerifySheet
          state={state}
          onClose={engine.closeVerify}
          onTrust={() => {
            engine.trustPeer();
            engine.closeVerify();
          }}
        />
      ) : null}

      {/* The peer's shared screen, edge-to-edge — Android's ShareFullscreen:
          black stage, contained picture, name + clock on top, one exit control,
          Back/Escape to collapse. */}
      {connected && state.peerScreen && state.shareFull ? (
        <div
          className="call-share-full"
          role="dialog"
          aria-modal="true"
          aria-label={`${state.peer.name}'s shared screen`}
        >
          <VideoSurface
            stream={state.remoteStream}
            className="call-share-full__video"
            label={`${state.peer.name}'s shared screen`}
          />
          <div className="call-share-full__bar">
            <span className="call-share-full__name">
              {state.peer.name}
              <RealmBadge realm={state.peer.realm} />
            </span>
            <span className="call-share-full__clock">{clockText(state.seconds)}</span>
          </div>
          <button
            type="button"
            className="call-share-full__exit"
            aria-label={CALL_COPY.shareCollapse}
            onClick={engine.exitShareFullscreen}
          >
            <Icon name="fullscreenExit" size={20} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function statusLine(state: CallEngineState): string {
  return callStatusText({
    phase: state.phase,
    incoming: state.incoming,
    otherOnline: state.peer.online,
    connected: state.connectedAt > 0,
    connecting: state.connecting,
    onHold: false,
    sharing: state.sharing,
    seconds: state.seconds,
  });
}

/* A shared screen keeps its own ratio: a phone shares portrait (~9:19), a
   desktop shares its monitor (16:9, ultrawide, 4:3). The preview CARD therefore
   measures the shared track's real dimensions instead of pinning 16:9
   (owner 2026-10-19: "desktop a screen share dile full screen korle 16:9 hoye
   jacche but screen size onujai hocche na"). Clamped between a portrait
   phone and an ultrawide monitor so the card can never crowd the controls
   off the stage; a browser without getSettings (the e2e mock's fake track)
   keeps the phrase's 16:9. */
const SHARE_RATIO_MIN = 0.45;
const SHARE_RATIO_MAX = 2.6;
const SHARE_RATIO_DEFAULT = 16 / 9;

function useStreamAspect(stream: MediaStreamLike | null): {
  readonly ratio: string;
  readonly tall: boolean;
} {
  const [ratio, setRatio] = useState<number>(SHARE_RATIO_DEFAULT);
  useEffect(() => {
    const track = stream?.getVideoTracks()[0] as
      { getSettings?: () => { width?: number; height?: number } } | undefined;
    if (!track || typeof track.getSettings !== "function") {
      setRatio(SHARE_RATIO_DEFAULT);
      return;
    }
    const read = () => {
      const settings = track.getSettings!();
      const w = settings.width ?? 0;
      const h = settings.height ?? 0;
      if (w > 0 && h > 0) {
        setRatio(Math.min(SHARE_RATIO_MAX, Math.max(SHARE_RATIO_MIN, w / h)));
      }
    };
    read();
    (
      track as MediaStreamTrack & { addEventListener?: (t: string, c: () => void) => void }
    ).addEventListener?.("resize", read);
    return undefined;
  }, [stream]);
  const bounded = Math.min(SHARE_RATIO_MAX, Math.max(SHARE_RATIO_MIN, ratio));
  return { ratio: String(Math.round(bounded * 1000) / 1000), tall: bounded < 1 };
}

/**
 * The audio-output picker. `setSinkId` is a Chromium extension, so the control is
 * only drawn as a picker when it actually works; everywhere else the row states
 * the limit. Either way it is labelled — no icon-only guessing.
 */
function AudioOutput({
  engine,
  state,
  disabled,
}: {
  readonly engine: CallEngine;
  readonly state: CallEngineState;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const supported = state.outputSupported && state.outputs.length > 0;

  useEffect(() => {
    if (open) void engine.refreshOutputs();
  }, [open, engine]);

  if (!supported) {
    return (
      <p className="call-action call-action--static" title={AUDIO_OUTPUT_UNSUPPORTED_COPY}>
        <Icon name="speaker" size={19} />
        <span>{CALL_COPY.audioOutput}</span>
        <span className="call-action__note">{AUDIO_OUTPUT_UNSUPPORTED_COPY}</span>
      </p>
    );
  }

  return (
    <div className="call-action call-action--picker">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
      >
        <Icon name="speaker" size={19} />
        <span>{CALL_COPY.audioOutput}</span>
      </button>
      {open ? (
        <ul role="listbox" aria-label={CALL_COPY.audioOutput}>
          {state.outputs.map((output) => (
            <li key={output.deviceId}>
              <button
                type="button"
                role="option"
                aria-selected={state.outputId === output.deviceId}
                onClick={() => {
                  void engine.setOutput(output.deviceId);
                  setOpen(false);
                }}
              >
                {output.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VerifySheet({
  state,
  onClose,
  onTrust,
}: {
  readonly state: CallEngineState;
  readonly onClose: () => void;
  readonly onTrust: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.e2eeCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="call-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={CALL_COPY.e2eeSheetTitle}
    >
      <div className="call-sheet__card">
        <h3>
          <Icon name="lock" size={15} />
          {CALL_COPY.e2eeSheetTitle}
        </h3>
        <p>{e2eeSheetCopy(state.peer.name)}</p>
        <p className="call-sheet__code">{state.e2eeCode}</p>
        {state.e2eeChanged ? (
          <p className="call-sheet__warn" role="alert">
            {e2eeChangedCopy(state.peer.name)}
          </p>
        ) : null}
        <div className="call-sheet__actions">
          {state.e2eeChanged ? (
            <button type="button" className="primary-button" onClick={onTrust}>
              {CALL_COPY.e2eeTrustNew}
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            {copied ? "Copied" : CALL_COPY.e2eeCopyCode}
          </button>
          <button type="button" className="text-button" onClick={onClose}>
            {CALL_COPY.e2eeClose}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A muted `<video>` bound to a wrapped stream: pictures only. Every call surface
 * here is muted on purpose — sound has exactly one home, the `<audio>` element
 * the layer owns, which is also the element `setSinkId` moves. Two elements
 * playing one stream is how a call ends up with an echo nobody can explain.
 */
function VideoSurface({
  stream,
  className,
  label,
}: {
  readonly stream: MediaStreamLike | null;
  readonly className: string;
  readonly label: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = (stream?.raw as MediaStream | null) ?? null;
    if (!stream) return;
    element.play().catch(() => undefined);
  }, [stream]);

  const syncSourceAspect = () => {
    const element = ref.current;
    if (!element || !element.videoWidth || !element.videoHeight) return;
    const preview = element.closest<HTMLElement>(".call-stage__share-preview");
    if (preview) preview.style.aspectRatio = String(element.videoWidth / element.videoHeight);
    element.dataset.sourceAspect = String(element.videoWidth / element.videoHeight);
  };

  return (
    <div className={className}>
      {/* A live call video has no caption track and cannot carry one; the
          suppression is labelled rather than silent. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        aria-label={label}
        onResize={syncSourceAspect}
        onLoadedMetadata={syncSourceAspect}
      />
    </div>
  );
}
