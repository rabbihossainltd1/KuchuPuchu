/**
 * The recorder: a browser `MediaRecorder` behind the phone's `VoiceNote` API.
 *
 * `VoiceNote.kt` is the contract — start / pause / resume / stop / cancel /
 * discard, an elapsed clock that stops for a pause, and a peak sampled every
 * 100 ms that becomes the bubble's bars. What a browser can and cannot do is
 * stated plainly rather than papered over:
 *
 *   • There is no `maxAmplitude`. An `AnalyserNode` window is the honest
 *     equivalent: at 44.1 kHz a 4096-sample window is ~93 ms, just under the
 *     100 ms sample interval, so a peak is not skipped between reads. The
 *     values are scaled into Android's 0…32767 range, which is what
 *     `VOICE_LIVE_CEIL` in `voice.ts` was written against.
 *   • `MediaRecorder.pause()` is not in Safari. Where it is missing, Pause is
 *     not offered at all — a button that silently does nothing is worse than no
 *     button, and `canPause` says which world this browser is in.
 *   • The container is whatever the engine records: webm/opus nearly everywhere,
 *     mp4/aac in Safari. `voice.ts` picks the name from the mime so the file
 *     name never lies about the bytes.
 *
 * Every platform object is injectable, so a test can drive a whole take without
 * a microphone.
 */

import {
  VOICE_LIVE_CEIL,
  VOICE_MAX_BYTES,
  VOICE_SAMPLE_MS,
  holdDecide,
  liveWaveform,
  pickVoiceMime,
  recorderElapsedMs,
  recorderSeconds,
  squashWaveform,
  voiceFileName,
  voiceMimeBase,
  type RecorderClock,
  type VoiceHoldResult,
} from "./voice";

export type VoiceTake = {
  readonly blob: Blob;
  readonly mime: string;
  readonly name: string;
  readonly size: number;
  /** Whole seconds, measured by the clock that stopped for every pause. */
  readonly seconds: number;
  /** The take's bars, 0…100, `VOICE_BARS` wide. */
  readonly waveform: readonly number[];
};

export type RecorderDeps = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  recorderCtor?: typeof MediaRecorder;
  isTypeSupported?: (mime: string) => boolean;
  audioContextCtor?: typeof AudioContext;
  now?: () => number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
};

export type RecorderSnapshot = {
  readonly isRecording: boolean;
  readonly isPaused: boolean;
  readonly elapsedMs: number;
  readonly livePeaks: readonly number[];
  readonly mime: string;
  readonly error: string;
};

/** The analyser window: ~93 ms at 44.1 kHz, just under one sample interval. */
export const ANALYSER_FFT_SIZE = 4096;

/** 64 kbps, 44.1 kHz — `VoiceNote.start`'s encoder settings. */
export const VOICE_BITRATE = 64_000;

function defaultNow(): number {
  return Date.now();
}

export class VoiceRecorder {
  private readonly deps: RecorderDeps;
  private readonly now: () => number;
  private readonly setTimeoutFn: (handler: () => void, ms: number) => number;
  private readonly clearTimeoutFn: (handle: number) => void;

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sampleBuffer: Float32Array<ArrayBuffer> | null = null;
  private samplerHandle: number | null = null;
  private chunks: Blob[] = [];
  private amps: number[] = [];
  private peaks: number[] = [];
  private clock: RecorderClock = {
    startedAt: 0,
    pausedAt: 0,
    pausedTotal: 0,
    isPaused: false,
    isRecording: false,
  };
  private mime = "";
  private failure = "";

  constructor(deps: RecorderDeps = {}) {
    this.deps = deps;
    this.now = deps.now ?? defaultNow;
    this.setTimeoutFn = deps.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
    this.clearTimeoutFn = deps.clearTimeout ?? ((handle) => window.clearTimeout(handle));
  }

  /** Whether this browser can record at all: a mic API and a MediaRecorder. */
  static isSupported(deps: RecorderDeps = {}): boolean {
    const getUserMedia =
      deps.getUserMedia ??
      (typeof navigator !== "undefined"
        ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
        : undefined);
    const ctor =
      deps.recorderCtor ?? (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    return typeof getUserMedia === "function" && typeof ctor === "function";
  }

  /** Whether a Pause button may be offered: `MediaRecorder.pause` is not in Safari. */
  static canPause(ctor?: typeof MediaRecorder): boolean {
    const resolved = ctor ?? (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    return typeof resolved?.prototype?.pause === "function";
  }

  /** The container this browser will record in, or "" when it cannot record. */
  static pickMime(deps: RecorderDeps = {}): string {
    const ctor =
      deps.recorderCtor ?? (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    const isSupported =
      deps.isTypeSupported ?? ((mime: string) => Boolean(ctor?.isTypeSupported?.(mime)));
    return pickVoiceMime(isSupported);
  }

  get isRecording(): boolean {
    return this.clock.isRecording;
  }

  get isPaused(): boolean {
    return this.clock.isPaused;
  }

  get mimeType(): string {
    return this.mime;
  }

  get error(): string {
    return this.failure;
  }

  /** The composer's live strip: the newest peaks, silence-padded on the left. */
  get livePeaks(): readonly number[] {
    return this.peaks;
  }

  elapsedMs(): number {
    return recorderElapsedMs(this.clock, this.now());
  }

  snapshot(): RecorderSnapshot {
    return {
      isRecording: this.clock.isRecording,
      isPaused: this.clock.isPaused,
      elapsedMs: this.elapsedMs(),
      livePeaks: this.peaks,
      mime: this.mime,
      error: this.failure,
    };
  }

  private async acquireStream(): Promise<MediaStream> {
    const getUserMedia =
      this.deps.getUserMedia ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (typeof getUserMedia !== "function") throw new Error("This browser has no microphone API.");
    return getUserMedia({ audio: true });
  }

  private attachMeter(stream: MediaStream): void {
    const Ctor =
      this.deps.audioContextCtor ??
      ((globalThis as { AudioContext?: typeof AudioContext }).AudioContext ||
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (typeof Ctor !== "function") return;
    try {
      const context = new Ctor();
      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      context.createMediaStreamSource(stream).connect(analyser);
      this.context = context;
      this.analyser = analyser;
      // An explicit ArrayBuffer: `getFloatTimeDomainData` wants
      // `Float32Array<ArrayBuffer>`, and `new Float32Array(n)` is typed as
      // `Float32Array<ArrayBufferLike>`.
      this.sampleBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    } catch {
      // No meter: the take still records, the strip just stays flat. A missing
      // visual is not a reason to refuse the recording.
      this.context = null;
      this.analyser = null;
      this.sampleBuffer = null;
    }
  }

  /**
   * The peak since the previous read, on Android's 0…32767 scale. A paused take
   * appends NOTHING — the frozen strip is what pause looks like.
   */
  private sample(): void {
    if (!this.clock.isRecording) return;
    if (this.clock.isPaused) {
      this.scheduleSample();
      return;
    }
    let amplitude = 0;
    const analyser = this.analyser;
    const buffer = this.sampleBuffer;
    if (analyser && buffer) {
      try {
        analyser.getFloatTimeDomainData(buffer);
        for (let index = 0; index < buffer.length; index += 1) {
          const value = Math.abs(buffer[index] ?? 0);
          if (value > amplitude) amplitude = value;
        }
        amplitude = Math.min(32767, Math.round(amplitude * 32767));
      } catch {
        amplitude = 0;
      }
    }
    this.amps.push(amplitude);
    this.peaks = liveWaveform(this.amps);
    this.scheduleSample();
  }

  private scheduleSample(): void {
    this.samplerHandle = this.setTimeoutFn(() => this.sample(), VOICE_SAMPLE_MS);
  }

  private stopSampler(): void {
    if (this.samplerHandle !== null) {
      this.clearTimeoutFn(this.samplerHandle);
      this.samplerHandle = null;
    }
  }

  /**
   * Begin a take. Resolves false (and sets `error`) when the mic is refused or
   * the browser cannot record — the caller shows that instead of a dead button.
   */
  async start(): Promise<boolean> {
    if (this.clock.isRecording) return true;
    this.failure = "";
    this.chunks = [];
    this.amps = [];
    this.peaks = [];

    let stream: MediaStream;
    try {
      stream = await this.acquireStream();
    } catch (error) {
      this.failure = microphoneRefusalMessage(error);
      return false;
    }

    const Ctor =
      this.deps.recorderCtor ??
      (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    if (typeof Ctor !== "function") {
      stream.getTracks().forEach((track) => track.stop());
      this.failure = "This browser cannot record audio.";
      return false;
    }

    const isSupported =
      this.deps.isTypeSupported ?? ((mime: string) => Boolean(Ctor.isTypeSupported?.(mime)));
    const mime = pickVoiceMime(isSupported);

    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new Ctor(stream, { mimeType: mime, audioBitsPerSecond: VOICE_BITRATE })
        : new Ctor(stream);
    } catch {
      try {
        recorder = new Ctor(stream);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        this.failure = "This browser cannot record audio.";
        return false;
      }
    }

    this.recorder = recorder;
    this.stream = stream;
    this.mime = mime || voiceMimeBase(recorder.mimeType || "") || "audio/webm";
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      this.failure = "The recording stopped unexpectedly.";
    };

    try {
      // A timeslice keeps the chunks small, so a long take is not one blob the
      // browser has to hold in memory until stop().
      recorder.start(VOICE_SAMPLE_MS);
    } catch {
      this.teardown();
      this.failure = "The recorder would not start.";
      return false;
    }

    this.clock = {
      startedAt: this.now(),
      pausedAt: 0,
      pausedTotal: 0,
      isPaused: false,
      isRecording: true,
    };
    this.attachMeter(stream);
    this.scheduleSample();
    return true;
  }

  /** `VoiceNote.pause` — false when there was nothing to pause. */
  pause(): boolean {
    if (!this.clock.isRecording || this.clock.isPaused) return false;
    const recorder = this.recorder;
    if (!recorder || typeof recorder.pause !== "function") return false;
    try {
      recorder.pause();
    } catch {
      return false;
    }
    this.clock = { ...this.clock, pausedAt: this.now(), isPaused: true };
    return true;
  }

  /** `VoiceNote.resume` — the clock and the wave pick up where they stopped. */
  resume(): boolean {
    if (!this.clock.isRecording || !this.clock.isPaused) return false;
    const recorder = this.recorder;
    if (!recorder || typeof recorder.resume !== "function") return false;
    try {
      recorder.resume();
    } catch {
      return false;
    }
    this.clock = {
      ...this.clock,
      pausedTotal: this.clock.pausedTotal + (this.now() - this.clock.pausedAt),
      isPaused: false,
    };
    this.stopSampler();
    this.scheduleSample();
    return true;
  }

  /**
   * Stop and hand back the take, or null when it is not a message: nothing was
   * recording, the encoder produced no bytes, or it is under a second long
   * (`VoiceNote.stop()`'s `secs >= 1`).
   */
  async stop(): Promise<VoiceTake | null> {
    if (!this.clock.isRecording) return null;
    // The length is read while the paused clock still knows where it stopped.
    const seconds = recorderSeconds(this.clock, this.now());
    const elapsed = this.elapsedMs();
    const waveform = squashWaveform(this.amps);
    this.stopSampler();
    this.clock = { ...this.clock, isRecording: false, isPaused: false };

    const recorder = this.recorder;
    const stopped = recorder
      ? new Promise<void>((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            resolve();
          };
          recorder.onstop = () => finish();
          try {
            // A paused recorder must be resumed before stop(): the platform
            // documents stop() only for a recording that is running, and the
            // browser engines throw on a paused one.
            if (recorder.state === "paused" && typeof recorder.resume === "function")
              recorder.resume();
            if (recorder.state !== "inactive") recorder.stop();
            else finish();
          } catch {
            finish();
          }
          // Never hang the composer on an engine that swallows onstop.
          this.setTimeoutFn(finish, 1500);
        })
      : Promise.resolve();
    await stopped;

    const chunks = this.chunks;
    this.teardown();
    const blob = new Blob(chunks, { type: voiceMimeBase(this.mime) || "audio/webm" });
    this.chunks = [];
    this.amps = [];
    this.peaks = [];

    if (blob.size <= 0) {
      this.failure = this.failure || "Nothing was recorded.";
      return null;
    }
    if (seconds < 1 || elapsed < 1000) {
      this.failure = "That voice note is too short.";
      return null;
    }
    if (blob.size > VOICE_MAX_BYTES) {
      this.failure = `That voice note is over ${Math.round(VOICE_MAX_BYTES / (1024 * 1024))} MB.`;
      return null;
    }
    return {
      blob,
      mime: voiceMimeBase(this.mime) || blob.type || "audio/webm",
      name: voiceFileName(this.mime),
      size: blob.size,
      seconds,
      waveform,
    };
  }

  /** Throw the take away: nothing is sent, nothing is kept. */
  cancel(): void {
    this.stopSampler();
    this.clock = { startedAt: 0, pausedAt: 0, pausedTotal: 0, isPaused: false, isRecording: false };
    this.chunks = [];
    this.amps = [];
    this.peaks = [];
    this.teardown();
  }

  /**
   * `VoiceNote.discard`: a take whose start was still spinning up when the hold
   * ended. Stops the recorder silently and forgets the bytes.
   */
  async discard(): Promise<void> {
    const recorder = this.recorder;
    this.cancel();
    if (recorder) {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* already gone */
      }
    }
  }

  private teardown(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      try {
        recorder.ondataavailable = null;
      } catch {
        /* ignore */
      }
    }
    this.stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
    this.stream = null;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.analyser = null;
    this.sampleBuffer = null;
  }
}

/** What a refused microphone actually means, in words the composer can show. */
export function microphoneRefusalMessage(error: unknown): string {
  const name = String((error as { name?: string } | null)?.name ?? "");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked for this site. Allow it in the browser's site settings and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found on this device.";
  }
  if (name === "NotReadableError") {
    return "The microphone is being used by another application.";
  }
  return "The microphone could not be started.";
}

/* ---------------------------------------------------------- the hold gesture */

export type HoldGeometry = {
  /** Leftward travel from the press, 0 … -n (px). */
  dx: number;
  /** Upward travel from the press, 0 … -n (px). */
  dy: number;
  /** How far left counts as a deliberate cancel. */
  cancelDist: number;
  /** How far up counts as locking the take. */
  lockDist: number;
  /** Down and up with no drag at all. */
  tap: boolean;
};

/**
 * The distances the phone derives from density: the cancel arm is a deliberate
 * leftward drag, the lock arm is half the composer column's climb. On a desktop
 * pointer the same geometry works in pixels — a click never travels, so a click
 * is the tap that arms the locked panel.
 */
export const HOLD_CANCEL_PX = 72;
export const HOLD_LOCK_PX = 56;
/** Under this much travel in both axes, a release is a tap, not a drag. */
export const HOLD_TAP_SLOP_PX = 8;

export function holdOutcome(input: {
  dx: number;
  dy: number;
  cancelDist?: number;
  lockDist?: number;
  tapSlop?: number;
}): VoiceHoldResult {
  const slop = input.tapSlop ?? HOLD_TAP_SLOP_PX;
  const tap = Math.abs(input.dx) <= slop && Math.abs(input.dy) <= slop;
  return holdDecide({
    dx: input.dx,
    dy: input.dy,
    cancelDist: input.cancelDist ?? HOLD_CANCEL_PX,
    lockDist: input.lockDist ?? HOLD_LOCK_PX,
    tap,
  });
}

/** Exported so the recorder's live ceiling is visible to the meter's scaling. */
export const LIVE_CEILING = VOICE_LIVE_CEIL;
