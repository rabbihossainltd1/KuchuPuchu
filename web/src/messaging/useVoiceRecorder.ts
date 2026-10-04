/**
 * The composer's recorder controller: the hold gesture, the clock, the live
 * strip and the typing pings, wrapped around `VoiceRecorder`.
 *
 * Ported from `ChatScreen.kt`'s `startRecording` / `finishRecording` /
 * `lockRecording` trio, whose rule (r75-1, r75-9) is: a hold RECORDS, nothing
 * fires while the finger is down, and the RELEASE decides — left past the
 * cancel distance throws the take away, up past the lock-at distance keeps the
 * panel open, anywhere else sends it. A tap (down and up with no travel) is the
 * LOCK, which is also what makes the whole thing usable with a mouse and a
 * keyboard: one click on the mic arms the locked panel, and its Pause / Delete
 * / View once / Send controls are real labelled buttons.
 *
 * While a take is running the chat pings `typing` with `kind: "voice"` — once
 * on start and then every 3 s against the Worker's 6 s lease — so the other
 * side shows a recording microphone instead of typing dots (r55 / r56 item 2).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOLD_CANCEL_PX,
  VoiceRecorder,
  holdOutcome,
  microphoneRefusalMessage,
  type VoiceTake,
} from "./voiceRecorder";
import { VOICE_SAMPLE_MS, voiceClock } from "./voice";

/** Android pings `typing` every 3 s while a take runs; the lease is 6 s. */
export const VOICE_TYPING_PING_MS = 3_000;

export type RecorderController = {
  readonly supported: boolean;
  readonly canPause: boolean;
  /** A take is in flight (recording or paused). */
  readonly recording: boolean;
  /** The locked panel is up: the take survives the release of the pointer. */
  readonly locked: boolean;
  readonly paused: boolean;
  readonly elapsedMs: number;
  readonly clock: string;
  readonly livePeaks: readonly number[];
  /** The pointer has travelled far enough left to throw the take away. */
  readonly cancelArmed: boolean;
  readonly once: boolean;
  readonly error: string;
  toggleOnce: () => void;
  /** Pointer down on the mic: the take starts here, not on release. */
  press: (point: { clientX: number; clientY: number }) => void;
  /** Pointer move while down: tracks the cancel / lock arms. */
  move: (point: { clientX: number; clientY: number }) => void;
  /** Pointer up: the release decides. */
  release: (point: { clientX: number; clientY: number }) => void;
  /** A keyboard activation (Enter / Space) arms the locked panel. */
  activate: () => void;
  pause: () => void;
  cancel: () => void;
  send: (once?: boolean) => Promise<void>;
};

export type VoiceRecorderOptions = {
  /** Hand a finished take to the send pipeline. */
  onTake: (take: VoiceTake, once: boolean) => void | Promise<void>;
  /** `typing` pings: "voice" while recording, "clear" when it ends. */
  onTyping?: (kind: "voice" | "clear") => void;
  /** Report a refusal the composer should show. */
  onError?: (message: string) => void;
  /** Chat is open and a send is allowed at all. */
  enabled?: boolean;
  recorder?: VoiceRecorder;
};

export function useVoiceRecorder(options: VoiceRecorderOptions): RecorderController {
  const { onTake, onTyping, onError, enabled = true } = options;
  const recorderRef = useRef<VoiceRecorder | null>(options.recorder ?? null);
  if (recorderRef.current === null) recorderRef.current = new VoiceRecorder();

  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [livePeaks, setLivePeaks] = useState<readonly number[]>([]);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [once, setOnce] = useState(false);
  const [error, setError] = useState("");

  const originRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef(false);
  const clockTimer = useRef<number | null>(null);
  const pingTimer = useRef<number | null>(null);
  const onceRef = useRef(false);
  onceRef.current = once;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const supported = VoiceRecorder.isSupported();
  const canPause = VoiceRecorder.canPause();

  const stopTimers = useCallback(() => {
    if (clockTimer.current !== null) {
      window.clearInterval(clockTimer.current);
      clockTimer.current = null;
    }
    if (pingTimer.current !== null) {
      window.clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    stopTimers();
    const recorder = recorderRef.current;
    const paint = (): void => {
      if (!recorder) return;
      setElapsedMs(recorder.elapsedMs());
      setLivePeaks(recorder.livePeaks);
      setPaused(recorder.isPaused);
    };
    paint();
    clockTimer.current = window.setInterval(paint, VOICE_SAMPLE_MS);
    pingTimer.current = window.setInterval(() => onTyping?.("voice"), VOICE_TYPING_PING_MS);
  }, [onTyping, stopTimers]);

  const finish = useCallback(() => {
    stopTimers();
    originRef.current = null;
    pointerRef.current = false;
    setRecording(false);
    setLocked(false);
    setPaused(false);
    setCancelArmed(false);
    setElapsedMs(0);
    setLivePeaks([]);
    setOnce(false);
    onTyping?.("clear");
  }, [onTyping, stopTimers]);

  const begin = useCallback(async (): Promise<boolean> => {
    const recorder = recorderRef.current;
    if (!recorder || !enabledRef.current) return false;
    if (recorder.isRecording) return true;
    setError("");
    const started = await recorder.start();
    if (!started) {
      const message = recorder.error || microphoneRefusalMessage(null);
      setError(message);
      onError?.(message);
      return false;
    }
    setRecording(true);
    setElapsedMs(0);
    setPaused(false);
    startTimers();
    onTyping?.("voice");
    return true;
  }, [onError, onTyping, startTimers]);

  const cancel = useCallback(() => {
    void recorderRef.current?.cancel();
    finish();
  }, [finish]);

  const send = useCallback(
    async (onceOverride?: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder || !recorder.isRecording) {
        finish();
        return;
      }
      const sendOnce = onceOverride ?? onceRef.current;
      const take = await recorder.stop();
      if (!take) {
        const message = recorder.error || "That voice note is too short.";
        setError(message);
        onError?.(message);
        finish();
        return;
      }
      finish();
      await onTake(take, sendOnce);
    },
    [finish, onError, onTake],
  );

  const press = useCallback(
    (point: { clientX: number; clientY: number }) => {
      pointerRef.current = true;
      originRef.current = { x: point.clientX, y: point.clientY };
      setCancelArmed(false);
      void begin();
    },
    [begin],
  );

  const move = useCallback((point: { clientX: number; clientY: number }) => {
    const origin = originRef.current;
    if (!origin || !pointerRef.current) return;
    const dx = point.clientX - origin.x;
    setCancelArmed(dx <= -HOLD_CANCEL_PX);
  }, []);

  const release = useCallback(
    (point: { clientX: number; clientY: number }) => {
      const origin = originRef.current;
      if (!pointerRef.current || !origin) return;
      pointerRef.current = false;
      const outcome = holdOutcome({ dx: point.clientX - origin.x, dy: point.clientY - origin.y });
      originRef.current = null;
      setCancelArmed(false);
      if (outcome === "cancel") {
        cancel();
        return;
      }
      if (outcome === "lock") {
        setLocked(true);
        return;
      }
      void send();
    },
    [cancel, send],
  );

  const activate = useCallback(() => {
    // A keyboard activation is the tap that arms the locked panel (r76-19).
    void begin().then((started) => {
      if (started) setLocked(true);
    });
  }, [begin]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.isPaused) {
      recorder.resume();
      setPaused(false);
    } else {
      recorder.pause();
      setPaused(true);
    }
    setElapsedMs(recorder.elapsedMs());
  }, []);

  const toggleOnce = useCallback(() => setOnce((value) => !value), []);

  // A take must not outlive the chat it was recorded in.
  useEffect(() => {
    return () => {
      stopTimers();
      void recorderRef.current?.cancel();
    };
  }, [stopTimers]);

  return {
    supported,
    canPause,
    recording,
    locked,
    paused,
    elapsedMs,
    clock: voiceClock(elapsedMs),
    livePeaks,
    cancelArmed,
    once,
    error,
    toggleOnce,
    press,
    move,
    release,
    activate,
    pause,
    cancel,
    send,
  };
}
