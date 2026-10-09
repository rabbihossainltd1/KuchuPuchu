/**
 * One active voice player for the whole transcript.
 *
 * `VoicePlayer.kt` is the shape being ported: a single player (starting a note
 * stops the one before it), per-message playback speed so one note at 2x leaves
 * every other note alone, a progress fraction the bubble paints its bars up to,
 * and a seek that survives the download it arrives during.
 *
 * The bytes are fetched with the session's Bearer token and kept as object URLs
 * keyed by the R2 file key — keys are unique per upload, so a replay never
 * re-downloads. That is the browser half of the phone's `cacheDir` copy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { fetchFileBlob, fetchMessageMediaBlob } from "./filesApi";
import type { MessageRow } from "./protocol";
import { isViewOnce, viewOnceSpent } from "./viewOnce";
import { VOICE_TICK_MS, nextVoiceSpeed, voiceMimeBase } from "./voice";

export type VoicePlayerState = {
  readonly playingId: string;
  readonly loadingId: string;
  readonly pausedId: string;
  /** 0…1 through the note that is playing or paused. */
  readonly progress: number;
  readonly error: string;
  /** Which row the error belongs to — one player, many bubbles. */
  readonly errorId: string;
};

const IDLE: VoicePlayerState = {
  playingId: "",
  loadingId: "",
  pausedId: "",
  progress: 0,
  error: "",
  errorId: "",
};

export type VoicePlayer = {
  readonly state: VoicePlayerState;
  /** Play, pause or resume one note; a second tap while loading cancels it. */
  toggle: (row: MessageRow, own?: boolean) => void;
  /** Jump to a fraction of the note (a click or a drag on its bars). */
  seekTo: (row: MessageRow, fraction: number, own?: boolean) => void;
  stop: () => void;
  speedOf: (id: string) => number;
  cycleSpeed: (id: string) => void;
  readonly speeds: Readonly<Record<string, number>>;
};

export type VoiceSource =
  | { kind: "file"; value: string }
  | { kind: "message"; value: string }
  | { kind: "local"; value: string };

/**
 * Where a note's bytes come from.
 *
 * The one subtlety is a VIEW-ONCE note (Android's `VoiceOnceTile`, r71-19b):
 * the recipient plays it through `/api/messages/:id/media`, where the fetch
 * itself is the single opening — the row is deleted for both sides and every
 * open chat gets the VANISHED frame. The sender's own preview reads the file
 * key directly and spends nothing, so a sender can hear what they sent.
 */
export function voiceSourceOf(row: MessageRow, own = false): VoiceSource | null {
  if (row.localPreview) return { kind: "local", value: row.localPreview };
  if (isViewOnce(row) && !viewOnceSpent(row) && !own && row.fileKey) {
    return { kind: "message", value: row.id };
  }
  if (row.fileKey) return { kind: "file", value: row.fileKey };
  if (row.mediaUrl) return { kind: "message", value: row.id };
  return null;
}

export function useVoicePlayer(api: ApiClient | null): VoicePlayer {
  const [state, setState] = useState<VoicePlayerState>(IDLE);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef(new Map<string, string>());
  const currentIdRef = useRef("");
  const loadGenRef = useRef(0);
  const pendingSeekRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const speedsRef = useRef<Record<string, number>>({});
  speedsRef.current = speeds;

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTick = useCallback(
    (audio: HTMLAudioElement) => {
      stopTick();
      tickRef.current = window.setInterval(() => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (duration > 0) {
          const raw = audio.currentTime / duration;
          // A media element can report NaN while it is still finding its
          // duration; an aria-valuenow of "NaN" is a broken control, so the
          // fraction is always a number in 0..1 by the time it leaves here.
          const fraction = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
          setState((current) => (current.playingId ? { ...current, progress: fraction } : current));
        }
      }, VOICE_TICK_MS);
    },
    [stopTick],
  );

  const releaseAudio = useCallback(() => {
    stopTick();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    audioRef.current = null;
    currentIdRef.current = "";
  }, [stopTick]);

  /** Object URL for a row's bytes, fetched once and cached by its file key. */
  const resolveUrl = useCallback(
    async (row: MessageRow, own: boolean, signal: AbortSignal): Promise<string> => {
      const source = voiceSourceOf(row, own);
      if (!source) throw new Error("There is nothing to play yet.");
      if (source.kind === "local") return source.value;
      if (!api) throw new Error("There is nothing to play yet.");
      const cacheKey = source.kind === "file" ? source.value : `msg:${source.value}`;
      const cached = cacheRef.current.get(cacheKey);
      if (cached) return cached;
      const fetched =
        source.kind === "file"
          ? await fetchFileBlob(api, source.value, signal)
          : await fetchMessageMediaBlob(api, source.value, signal);
      // The row's own type wins over the response header: a note stored before
      // `audio/webm` was servable comes back as an opaque download, and an
      // <audio> element handed octet-stream refuses to play in the strict
      // engines. The bytes are the same bytes either way.
      const type = row.fileType
        ? voiceMimeBase(row.fileType)
        : voiceMimeBase(fetched.type) || "audio/webm";
      const url = URL.createObjectURL(new Blob([await fetched.blob.arrayBuffer()], { type }));
      cacheRef.current.set(cacheKey, url);
      return url;
    },
    [api],
  );

  const stop = useCallback(() => {
    loadGenRef.current += 1;
    pendingSeekRef.current = 0;
    releaseAudio();
    setState(IDLE);
  }, [releaseAudio]);

  const play = useCallback(
    (row: MessageRow, url: string) => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.playbackRate = speedsRef.current[row.id] ?? 1;
      const startAt = pendingSeekRef.current;
      pendingSeekRef.current = 0;
      const begin = (): void => {
        if (startAt > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = startAt * audio.duration;
        }
        // A finished note is not a playing one: clear the playing id so the
        // next tap/seek takes the honest "start again" path instead of the
        // stale "pause" path (slice J hardening; also steadies the keyboard
        // seek gate).
        audio.onended = () => {
          stopTick();
          // Paused-at-end, not playing: the bubble keeps showing the finished
          // position (active rows render progress) and the next tap or key
          // takes the honest "start again" path.
          setState((current) => ({
            ...current,
            playingId: "",
            loadingId: "",
            pausedId: current.playingId === row.id ? row.id : current.pausedId,
            progress: 1,
          }));
        };
        void audio.play().catch(() => {
          setState((current) => ({
            ...current,
            playingId: "",
            loadingId: "",
            error: "This browser would not play that note.",
            errorId: row.id,
          }));
          stopTick();
        });
        setState((current) => ({
          ...current,
          loadingId: "",
          playingId: row.id,
          pausedId: "",
          error: "",
          errorId: "",
          progress: startAt,
        }));
        startTick(audio);
      };
      if (audio.readyState >= 1) begin();
      else {
        audio.onloadedmetadata = () => begin();
        // A note that never loads must not leave the bubble spinning forever.
        audio.onerror = () => {
          setState((current) => ({
            ...current,
            loadingId: "",
            playingId: "",
            error: "That voice note could not be played on this device.",
            errorId: row.id,
          }));
          stopTick();
        };
      }
    },
    [startTick, stopTick],
  );

  const toggle = useCallback(
    (row: MessageRow, own = false) => {
      const id = row.id;
      const audio = audioRef.current;
      if (audio && currentIdRef.current === id) {
        if (state.playingId === id) {
          audio.pause();
          stopTick();
          setState((current) => ({ ...current, playingId: "", pausedId: id }));
        } else {
          if (audio.ended) audio.currentTime = 0;
          audio.playbackRate = speedsRef.current[id] ?? 1;
          void audio.play().catch(() => undefined);
          setState((current) => ({
            ...current,
            playingId: id,
            pausedId: "",
            error: "",
            errorId: "",
          }));
          startTick(audio);
        }
        return;
      }
      if (state.loadingId === id && currentIdRef.current === id) {
        // A second tap while it is still downloading cancels, as on the phone.
        stop();
        return;
      }

      const want = pendingSeekRef.current;
      stop();
      pendingSeekRef.current = want;
      const generation = ++loadGenRef.current;
      currentIdRef.current = id;
      const controller = new AbortController();
      setState((current) => ({
        ...current,
        playingId: id,
        loadingId: id,
        pausedId: "",
        progress: want,
        error: "",
        errorId: "",
      }));
      void resolveUrl(row, own, controller.signal)
        .then((url) => {
          if (generation !== loadGenRef.current) return;
          play(row, url);
        })
        .catch((error: unknown) => {
          if (generation !== loadGenRef.current) return;
          if ((error as { name?: string })?.name === "AbortError") return;
          currentIdRef.current = "";
          setState((current) => ({
            ...current,
            playingId: "",
            loadingId: "",
            pausedId: "",
            progress: 0,
            error:
              (error as Error)?.message ||
              "That voice note could not be downloaded on this device.",
            errorId: id,
          }));
        });
    },
    [play, resolveUrl, state.loadingId, state.playingId, stop, startTick, stopTick],
  );

  const seekTo = useCallback(
    (row: MessageRow, fraction: number, own = false) => {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      const audio = audioRef.current;
      if (audio && currentIdRef.current === row.id) {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = clamped * audio.duration;
        }
        setState((current) => ({ ...current, progress: clamped }));
        if (currentIdRef.current === row.id && !audio.paused) return;
        if (audio.paused && state.playingId !== row.id) {
          // A paused note resumes from where it was clicked.
          audio.playbackRate = speedsRef.current[row.id] ?? 1;
          void audio.play().catch(() => undefined);
          setState((current) => ({ ...current, playingId: row.id, pausedId: "" }));
          startTick(audio);
        }
        return;
      }
      if (state.loadingId === row.id && currentIdRef.current === row.id) {
        // Still downloading: the load applies this once the metadata arrives.
        pendingSeekRef.current = clamped;
        setState((current) => ({ ...current, progress: clamped }));
        return;
      }
      pendingSeekRef.current = clamped;
      toggle(row, own);
    },
    [startTick, state.loadingId, state.playingId, toggle],
  );

  const speedOf = useCallback((id: string) => speedsRef.current[id] ?? 1, []);

  const cycleSpeed = useCallback((id: string) => {
    setSpeeds((current) => {
      const next = { ...current, [id]: nextVoiceSpeed(current[id] ?? 1) };
      const audio = audioRef.current;
      if (audio && currentIdRef.current === id) audio.playbackRate = next[id] ?? 1;
      return next;
    });
  }, []);

  // Nothing may keep playing after the chat is left or the tab is closed.
  useEffect(() => {
    return () => {
      loadGenRef.current += 1;
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
      }
      audioRef.current = null;
      cacheRef.current.forEach((url) => {
        if (!url.startsWith("blob:")) return;
        URL.revokeObjectURL(url);
      });
      cacheRef.current.clear();
    };
  }, []);

  return useMemo(
    () => ({ state, toggle, seekTo, stop, speedOf, cycleSpeed, speeds }),
    [cycleSpeed, seekTo, speedOf, state, stop, toggle, speeds],
  );
}
