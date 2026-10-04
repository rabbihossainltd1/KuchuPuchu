/**
 * The composer's recording panel, in the phone's two shapes.
 *
 * `RecorderHoldBar` (r76-1): one dark row — the clock, the live wave and the
 * cancel hint. Dragging left arms the cancel: the clock sinks out and the bin
 * rises into its place.
 *
 * `RecorderLockedPanel` (r76-1): the take survives the release. Clock (grey
 * while paused), the wide live wave, the view-once mark, and a bottom row of
 * Delete / Pause-Resume / Send.
 *
 * Two honest browser substitutions, both labelled rather than gestured:
 *
 *   • Android's Send circle sends as view-once on a DOUBLE TAP. A double click
 *     works here too, but the panel also carries a real "Send as view once"
 *     toggle, because a mouse-only double click is an invisible control.
 *   • `MediaRecorder.pause()` does not exist in Safari. Where it is missing the
 *     Pause button is not drawn at all (`canPause`), instead of drawing a
 *     button that silently does nothing.
 */

import { Icon } from "../icons";
import { VoiceWave } from "./VoiceBubble";
import type { RecorderController } from "./useVoiceRecorder";
import { VOICE_LIVE_BARS } from "./voice";

/** The live strip's width: `VoiceWaveform.LIVE_BARS`. */
export const LIVE_STRIP_BARS = VOICE_LIVE_BARS;

export function LiveWave({ peaks, muted = false }: { peaks: readonly number[]; muted?: boolean }) {
  // Padded to the strip width so the picture grows in from the right (the mic's
  // side) exactly as `VoiceWaveform.live` does on the phone.
  const bars = peaks.length >= LIVE_STRIP_BARS ? peaks.slice(-LIVE_STRIP_BARS) : peaks;
  return (
    <div className={`recorder__wave${muted ? " recorder__wave--muted" : ""}`} aria-hidden="true">
      {Array.from({ length: LIVE_STRIP_BARS }, (_, index) => {
        const value = bars[index] ?? 0;
        return (
          <span
            key={index}
            className="recorder__wave-bar"
            style={{ height: `${Math.max(6, Math.min(100, value))}%` }}
          />
        );
      })}
    </div>
  );
}

export type VoiceRecorderBarProps = {
  controller: RecorderController;
  onAnnounce?: (message: string) => void;
};

export function VoiceRecorderBar({ controller, onAnnounce }: VoiceRecorderBarProps) {
  const { locked, paused, clock, livePeaks, cancelArmed, once } = controller;

  if (!locked) {
    return (
      <div
        className={`recorder recorder--hold${cancelArmed ? " recorder--cancel" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className={`recorder__clock${cancelArmed ? " recorder__clock--sunk" : ""}`}>
          {clock}
        </span>
        <LiveWave peaks={livePeaks} />
        {cancelArmed ? (
          <span className="recorder__bin" aria-hidden="true">
            <Icon name="trash" size={18} />
          </span>
        ) : (
          <span className="recorder__hint">Drag left to cancel · release to send</span>
        )}
      </div>
    );
  }

  return (
    <div className="recorder recorder--locked" role="group" aria-label="Voice recording">
      <div className="recorder__row">
        <span className={`recorder__clock${paused ? " recorder__clock--paused" : ""}`}>
          {clock}
        </span>
        <LiveWave peaks={livePeaks} muted />
        <button
          type="button"
          className={`recorder__once${once ? " recorder__once--on" : ""}`}
          onClick={() => {
            controller.toggleOnce();
            onAnnounce?.(
              once
                ? "View once is off — the note stays in the chat."
                : "View once is on — it plays once, then it is gone for both of you.",
            );
          }}
          aria-pressed={once}
          aria-label="Send as view once — one play, then it is gone for both of you"
          title="Send as view once"
        >
          <Icon name="lock" size={18} />
        </button>
      </div>

      <div className="recorder__row">
        <button
          type="button"
          className="recorder__delete"
          onClick={() => {
            controller.cancel();
            onAnnounce?.("Recording discarded.");
          }}
          aria-label="Delete the recording"
        >
          <Icon name="trash" size={18} />
        </button>

        {controller.canPause ? (
          <button
            type="button"
            className="recorder__pause"
            onClick={controller.pause}
            aria-label={paused ? "Resume recording" : "Pause recording"}
          >
            <Icon name={paused ? "play" : "pause"} size={16} />
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>
        ) : (
          <span className="recorder__pause recorder__pause--unsupported">
            This browser cannot pause a recording.
          </span>
        )}

        <button
          type="button"
          className="recorder__send"
          onClick={() => void controller.send()}
          onDoubleClick={() => void controller.send(true)}
          aria-label={once ? "Send the voice note as view once" : "Send the voice note"}
          title="Double-click to send it as view once"
        >
          <Icon name="send" size={18} />
          <span>Send</span>
        </button>
      </div>

      <p className="recorder__note">
        {once
          ? "View once: it plays once for them, then it is gone for both of you."
          : "A note under one second is thrown away, not sent."}
      </p>
    </div>
  );
}

/** The wave a locked or held take paints, exposed for the contract case. */
export function stripBars(peaks: readonly number[]): readonly number[] {
  return peaks.length >= LIVE_STRIP_BARS ? peaks.slice(-LIVE_STRIP_BARS) : peaks;
}

/** Re-exported so the composer can gate a seek on the same keys as the bubble. */
export { VoiceWave };
