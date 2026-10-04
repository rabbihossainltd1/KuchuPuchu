/**
 * The voice bubble: play / pause, the recorded wave, the duration and the
 * per-note speed, laid out like the phone's (owner round 34 item 7 — "the
 * normal voice bubble IS the view-once voice card").
 *
 * Ported from `ChatScreen.kt`'s voice branch and `VoiceOnceTile`:
 *
 *   • The bars come from `meta.waveform` when the row carries them, and from a
 *     stable pseudo-pattern seeded by `clientId` (falling back to the row id)
 *     when it does not — so an audio file recorded before anyone sampled peaks,
 *     or by another client, still draws the same picture every time and a click
 *     still seeks on it.
 *   • The duration line reads the note's own length, and switches to the
 *     playhead while the note is playing or paused.
 *   • The speed circle cycles 1x → 2x → 3x → 4x → 1x, and it is PER MESSAGE:
 *     one note at 2x leaves every other note alone (r76-16).
 *   • A view-once note cannot be seeked — it is heard once, from the top — and
 *     carries the lock mark where a normal note carries its speed.
 *
 * The browser substitute for a gesture-only control: the wave is a real
 * `role="slider"` with arrow / Home / End keys, so a keyboard can seek a note it
 * can also click, and nothing here is hover-only.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { formatBytes } from "../media/uploadContract";
import type { MessageRow } from "./protocol";
import type { VoicePlayer } from "./useVoicePlayer";
import { voiceSourceOf } from "./useVoicePlayer";
import { isViewOnce, viewOnceSpent } from "./viewOnce";
import {
  VOICE_BARS,
  fileLooksVoice,
  voiceBarSeed,
  voiceBarsOf,
  voiceClock,
  voiceSecondsClock,
  voiceSecondsOf,
} from "./voice";

/** One arrow key moves the playhead this far. Web-only: the phone drags. */
export const SEEK_KEY_STEP = 0.05;

export type VoiceWaveProps = {
  bars: readonly number[];
  /** 0…1 through the note. */
  progress: number;
  onSeek?: (fraction: number) => void;
  disabled?: boolean;
  label: string;
  valueText: string;
};

/**
 * The bar strip. Bars are spans, not a canvas: 36 of them cost less than a
 * redraw loop and they inherit the bubble's colours, and the strip is a slider
 * for assistive tech either way.
 */
export function VoiceWave({
  bars,
  progress,
  onSeek,
  disabled = false,
  label,
  valueText,
}: VoiceWaveProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const wanted = scrub ?? progress;
  // Never let a NaN reach aria-valuenow: a slider with no number is a control a
  // screen reader cannot read, whatever the media element is doing.
  const shown = Number.isFinite(wanted) ? Math.min(1, Math.max(0, wanted)) : 0;

  const fractionAt = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    if (box.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  }, []);

  const interactive = !disabled && typeof onSeek === "function";

  return (
    <div
      ref={trackRef}
      className="voice-wave"
      role="slider"
      tabIndex={interactive ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, Math.max(0, shown)) * 100)}
      aria-valuetext={valueText}
      aria-disabled={interactive ? undefined : true}
      aria-orientation="horizontal"
      onPointerDown={
        interactive
          ? (event) => {
              draggingRef.current = true;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              const fraction = fractionAt(event.clientX);
              setScrub(fraction);
            }
          : undefined
      }
      onPointerMove={
        interactive
          ? (event) => {
              if (!draggingRef.current) return;
              setScrub(fractionAt(event.clientX));
            }
          : undefined
      }
      onPointerUp={
        interactive
          ? (event) => {
              if (!draggingRef.current) return;
              draggingRef.current = false;
              const fraction = fractionAt(event.clientX);
              setScrub(null);
              onSeek?.(fraction);
            }
          : undefined
      }
      onPointerCancel={
        interactive
          ? () => {
              draggingRef.current = false;
              setScrub(null);
            }
          : undefined
      }
      onClick={
        interactive
          ? (event) => {
              // A plain click (no drag) seeks too — the pointer handlers only
              // fire the seek on release of a captured drag.
              if (scrub !== null) return;
              onSeek?.(fractionAt(event.clientX));
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (event) => {
              const current = Math.min(1, Math.max(0, shown));
              let next: number | null = null;
              if (event.key === "ArrowRight" || event.key === "ArrowUp")
                next = current + SEEK_KEY_STEP;
              else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
                next = current - SEEK_KEY_STEP;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = 1;
              if (next === null) return;
              event.preventDefault();
              onSeek?.(Math.min(1, Math.max(0, next)));
            }
          : undefined
      }
    >
      {bars.map((bar, index) => {
        const centre = bars.length > 1 ? index / (bars.length - 1) : 0;
        return (
          <span
            key={index}
            className={`voice-wave__bar${centre <= shown ? " voice-wave__bar--played" : ""}`}
            style={{ height: `${Math.max(8, Math.min(100, bar))}%` }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

export type VoiceBubbleProps = {
  message: MessageRow;
  api: ApiClient | null;
  player: VoicePlayer;
  own: boolean;
  /**
   * The reader opened a view-once note. For a voice note the FETCH is the
   * opening (the row is deleted server-side and every open chat gets VANISHED),
   * so this is the local bookkeeping half — the same spender the photo path
   * uses, which treats a 404/410 as "already gone".
   */
  onOpened?: (message: MessageRow) => void;
};

export function VoiceBubble({ message, api, player, own, onOpened }: VoiceBubbleProps) {
  const id = message.id;
  const once = isViewOnce(message);
  const spent = viewOnceSpent(message);
  const pending = message.localState === "pending";
  const failed = message.localState === "failed";

  const seed = voiceBarSeed(message);
  const bars = useMemo(() => voiceBarsOf(message), [message, seed]);
  const seconds = voiceSecondsOf(message);
  const source = voiceSourceOf(message, own);
  const playable = !pending && !spent && source !== null && api !== null;

  const playing = player.state.playingId === id;
  const paused = player.state.pausedId === id;
  const loading = player.state.loadingId === id;
  const active = playing || paused;
  const progress = active ? player.state.progress : 0;
  const speed = player.speedOf(id);

  const durationText =
    active && seconds > 0
      ? voiceSecondsClock(Math.floor(progress * seconds))
      : seconds > 0
        ? voiceSecondsClock(seconds)
        : pending
          ? "0:00"
          : formatBytes(message.fileSize);

  const press = useCallback(() => {
    if (!playable) return;
    if (once && !own) onOpened?.(message);
    player.toggle(message, own);
  }, [message, once, own, onOpened, playable, player]);

  const seek = useCallback(
    (fraction: number) => {
      if (!playable) return;
      if (once && !own) onOpened?.(message);
      player.seekTo(message, fraction, own);
    },
    [message, once, own, onOpened, playable, player],
  );

  if (spent) {
    return (
      <span className="voice-note voice-note--spent">
        <Icon name="lock" size={16} />
        <span>View-once voice message — already played, the bytes are gone.</span>
      </span>
    );
  }

  return (
    <span className={`voice-note${once ? " voice-note--once" : ""}`}>
      <button
        type="button"
        className="voice-note__play"
        onClick={press}
        disabled={!playable}
        aria-label={
          loading
            ? "Loading voice message"
            : playing
              ? "Pause voice message"
              : once
                ? "Play once — this is its single opening"
                : "Play voice message"
        }
        title={
          playable
            ? undefined
            : pending
              ? "Still uploading"
              : failed
                ? "This note did not send"
                : "There is nothing to play on this device"
        }
      >
        {loading || pending ? (
          <span className="voice-note__spinner" aria-hidden="true" />
        ) : (
          <Icon name={playing ? "pause" : "play"} size={18} />
        )}
      </button>

      <VoiceWave
        bars={bars}
        progress={progress}
        onSeek={playable && !once ? seek : undefined}
        disabled={!playable || once}
        label={once ? "View-once voice message (cannot be seeked)" : "Seek in this voice message"}
        valueText={`${durationText} of ${seconds > 0 ? voiceSecondsClock(seconds) : durationText}`}
      />

      <span className="voice-note__time">{durationText}</span>

      {once ? (
        <span
          className="voice-note__once"
          title="View once — one play, then it is gone for both of you"
        >
          <Icon name="lock" size={14} />
          <span className="sr-only">View once</span>
        </span>
      ) : (
        <button
          type="button"
          className="voice-note__speed"
          onClick={() => player.cycleSpeed(id)}
          aria-label={`Playback speed ${speed} times normal. Activate for the next speed.`}
        >
          {speed}x
        </button>
      )}

      {failed ? (
        <span className="voice-note__error" role="alert">
          {message.localError || "Voice note not sent."}
        </span>
      ) : null}
      {player.state.errorId === id && player.state.error ? (
        <span className="voice-note__error" role="alert">
          {player.state.error}
        </span>
      ) : null}
      {message.localState === "pending" && message.localProgress > 0 ? (
        <span className="voice-note__progress">Uploading… {message.localProgress}%</span>
      ) : null}
      {!fileLooksVoice(message) ? (
        <span className="voice-note__note">Audio file, played as a voice note.</span>
      ) : null}
    </span>
  );
}

/** How many bars a note that carries no waveform draws. Pinned by a contract case. */
export const FALLBACK_BARS = VOICE_BARS;

/** The clock a locked (still recording) panel shows, e.g. "0:07". */
export function recordingClock(elapsedMs: number): string {
  return voiceClock(elapsedMs);
}
