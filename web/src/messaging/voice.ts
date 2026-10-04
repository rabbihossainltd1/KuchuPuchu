/**
 * Voice notes: the rules, ported from the phone.
 *
 * Everything here is read out of `native-android/.../VoiceNote.kt` and the
 * worker's own meta normalisation — the bar count, the sample interval, the
 * sqrt curve, the pseudo-waveform generator, the hold gesture's three outcomes,
 * the speed cycle and the minimum length. The contract case
 * (`test/cases/59-web-voice-notes.mjs`) re-reads the Kotlin and the worker and
 * fails if the two disagree, so this file cannot drift into being "web's own
 * idea of a voice note".
 *
 * Deliberately free of DOM, React and MediaRecorder so it can be exercised in
 * Node: the recorder itself lives in `voiceRecorder.ts` and only ever calls
 * into this module for its maths.
 */

import type { MessageRow } from "./protocol";

/* ------------------------------------------------------- ported constants */

/** The bubble's bars. `VoiceWaveform.BARS`. */
export const VOICE_BARS = 36;

/** How many bars the worker will store in `meta.waveform`. `VOICE_WAVEFORM_MAX`. */
export const VOICE_MAX_BARS = 64;

/** The composer's live strip width. `VoiceWaveform.LIVE_BARS`. */
export const VOICE_LIVE_BARS = 64;

/**
 * The speaking-voice ceiling the live strip is scaled against — the take's own
 * peak is unknown while it is still being spoken. `VoiceWaveform.LIVE_CEIL`,
 * and the scale of Android's `MediaRecorder.maxAmplitude` (0…32767), which is
 * what the recorder feeds in.
 */
export const VOICE_LIVE_CEIL = 20000;

/** One amplitude read per 100 ms while the finger is down. `VoiceNote.SAMPLE_MS`. */
export const VOICE_SAMPLE_MS = 100;

/** The playback progress tick. `VoicePlayer.TICK_MS`. */
export const VOICE_TICK_MS = 80;

/** A take shorter than this is thrown away, not sent. `VoiceNote.stop()`'s `secs >= 1`. */
export const VOICE_MIN_MS = 1000;

/**
 * The voice ceiling the SEND path enforces, exactly like `sendVoice`'s
 * `file.length() > Api.VOICE_MAX` check. It is not `mediaLimitFor`: that
 * function's video branch matches a `.webm` NAME before its audio branch ever
 * runs, so a browser voice note would get the 2 GB clip ceiling from it. Both
 * clients have that ordering, and both clients enforce 100 MB here instead.
 */
export const VOICE_MAX_BYTES = 100 * 1024 * 1024;

/** The worker clamps `meta.seconds` into 0…600 when it stores a FILE row. */
export const VOICE_MAX_SECONDS = 600;

/** The playback speeds the bubble cycles through: `VoicePlayer.cycleSpeed`. */
export const VOICE_SPEEDS: readonly number[] = Object.freeze([1, 2, 3, 4]);

/* --------------------------------------------------------- waveform maths */

/**
 * Java/Kotlin's `String.hashCode`, which `VoiceWaveform.pseudo` seeds from.
 * `Math.imul` keeps the 32-bit overflow the JVM has; without it a long message
 * id would produce a different seed and a different (still valid) picture.
 */
export function javaStringHashCode(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  }
  return hash;
}

/** Kotlin's Float arithmetic, so a bar lands on the same integer as the phone's. */
function float(value: number): number {
  return Math.fround(value);
}

/** Kotlin's `roundToInt` (half up), not JS's banker-ish `Math.round` on negatives. */
function roundToInt(value: number): number {
  return Math.floor(float(value) + 0.5);
}

function coerceIn(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * `VoiceWaveform.squash`: bucket the recorder's 100 ms peaks into `bars` means,
 * scale them against the take's own loudest moment (a quiet note still shows
 * its shape) and put them on a sqrt curve so speech does not collapse into
 * spikes. A silent take is all zeros, not all-quiet-but-nonzero.
 */
export function squashWaveform(samples: readonly number[], bars: number = VOICE_BARS): number[] {
  if (samples.length === 0 || bars <= 0) return [];
  const means: number[] = new Array<number>(bars).fill(0);
  for (let index = 0; index < bars; index += 1) {
    const from = Math.floor((index * samples.length) / bars);
    const to = Math.min(
      Math.max(from + 1, Math.floor(((index + 1) * samples.length) / bars)),
      samples.length,
    );
    let acc = 0;
    for (let at = from; at < to; at += 1) acc += Math.max(0, samples[at] ?? 0);
    means[index] = float(acc / (to - from));
  }
  const peak = Math.max(...means);
  if (peak <= 0) return new Array<number>(bars).fill(0);
  return means.map((mean) =>
    coerceIn(roundToInt(float(Math.sqrt(float(mean / peak)) * 100)), 0, 100),
  );
}

/**
 * One step of the LCG `VoiceWaveform.pseudo` walks. Kotlin does this in Longs
 * and masks with `0x7fffffff`; `Math.imul` gives the low 32 bits of the product
 * and masking to 31 bits afterwards is the same modulus, so the sequence is
 * bit-identical without BigInt.
 */
function pseudoStep(state: number): number {
  const product = Math.imul(state, 1103515245) >>> 0;
  return ((product + 12345) >>> 0) & 0x7fffffff;
}

/**
 * `VoiceWaveform.pseudo`: bars for a note recorded before anyone sampled them
 * (old messages, other clients). A fixed pattern from the message's own seed,
 * so the same note always looks the same on every device and a tap still seeks
 * on it. The phone seeds from `clientId.ifBlank { id }`; `voiceBarSeed` matches.
 */
export function pseudoWaveform(seed: string, bars: number = VOICE_BARS): number[] {
  // The phone's literals are Floats, so they are rounded to Floats here before
  // they are used: `0.62f` is not the double `0.62`, and one bar in 36 would
  // otherwise land a point off on some seeds.
  const f64 = float(6.4);
  const f03 = float(0.3);
  const f55 = float(0.55);
  const f45 = float(0.45);
  const f18 = float(18);
  const f62 = float(0.62);
  let state = ((javaStringHashCode(seed) >>> 0) | 1) >>> 0;
  const out: number[] = [];
  for (let index = 0; index < bars; index += 1) {
    state = pseudoStep(state);
    const raw = (state >>> 8) % 100;
    const angle = float(float(float(index * f64) / bars) + f03);
    const env = float(f55 + float(f45 * float(Math.sin(angle))));
    out.push(coerceIn(roundToInt(float(f18 + float(float(raw * f62) * env))), 8, 100));
  }
  return out;
}

/**
 * `VoiceWaveform.live`: the newest `bars` peaks, oldest first, padded with
 * silence on the LEFT so the picture is always `bars` wide and grows in from
 * the right — the mic's side.
 */
export function liveWaveform(samples: readonly number[], bars: number = VOICE_LIVE_BARS): number[] {
  if (bars <= 0) return [];
  const tail = samples.length > bars ? samples.slice(samples.length - bars) : samples.slice();
  const out: number[] = [];
  for (let index = 0; index < bars - tail.length; index += 1) out.push(0);
  for (const amplitude of tail) {
    const scaled = float(Math.sqrt(float(Math.max(0, amplitude) / VOICE_LIVE_CEIL)) * 100);
    out.push(coerceIn(roundToInt(scaled), 0, 100));
  }
  return out;
}

/**
 * `VoiceWaveform.sanitize`: clamp whatever the server or an old client sent
 * into drawable bars. The worker already does this on the way in
 * (`voiceWaveform`: at most 64 entries, rounded, clamped 0…100) — a row is
 * never trusted just because a server shaped it.
 */
export function sanitizeWaveform(raw: readonly unknown[]): number[] {
  return raw.slice(0, VOICE_MAX_BARS).map((value) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? coerceIn(number, 0, 100) : 0;
  });
}

/* --------------------------------------------------------- the hold gesture */

export type VoiceHoldResult = "lock" | "cancel" | "send";

/**
 * `VoiceHoldGesture.decide`, branch for branch. A hold records, NOTHING fires
 * while the finger is down, and the RELEASE decides: released above the
 * lock-at-half = LOCK, released left past the cancel distance = CANCEL,
 * released where it started = SEND. A single tap (down and up, no drag) is the
 * LOCK — that is r76-19, and it is also what makes the gesture usable with a
 * mouse: one click on the mic arms the locked panel, whose Send / Pause /
 * Delete / View-once buttons are all real, labelled buttons.
 */
export function holdDecide(input: {
  /** Leftward travel, 0 … -n. */
  dx: number;
  /** Upward travel, 0 … -n. */
  dy: number;
  cancelDist: number;
  lockDist: number;
  tap?: boolean;
}): VoiceHoldResult {
  if (input.tap === true) return "lock";
  if (input.dx <= -Math.abs(input.cancelDist)) return "cancel";
  if (input.dy <= -Math.abs(input.lockDist)) return "lock";
  return "send";
}

/* -------------------------------------------------------------- the player */

/** `VoicePlayer.cycleSpeed`: 1x → 2x → 3x → 4x → 1x, per message. */
export function nextVoiceSpeed(current: number): number {
  const index = VOICE_SPEEDS.indexOf(current);
  if (index < 0) return VOICE_SPEEDS[0] ?? 1;
  return VOICE_SPEEDS[(index + 1) % VOICE_SPEEDS.length] ?? 1;
}

/* ----------------------------------------------------------- clock and names */

/**
 * The phone's `"%d:%02d".format(ms / 1000 / 60, ms / 1000 % 60)` — whole
 * seconds, integer minutes, no hours. A 70-minute take reads "70:00" on both
 * clients, which is ugly but identical.
 */
export function voiceClock(ms: number): string {
  const whole = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Whole seconds, as the bubble's duration line reads them. */
export function voiceSecondsClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The containers a browser can actually record in, best first. Safari answers
 * `audio/mp4`, everything else `audio/webm`; `MediaRecorder.isTypeSupported`
 * decides, and the parameterised forms are asked for first because "opus in a
 * webm" is the one every engine that ships webm ships.
 */
export const VOICE_MIME_CANDIDATES: readonly string[] = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
]);

/** The mime without its `;codecs=` parameter — what a row's `fileType` carries. */
export function voiceMimeBase(mime: string): string {
  return (String(mime || "").split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Which container the recorder settled on, or "" when this browser cannot
 * record at all. The answer decides the file name, so the name never lies
 * about the bytes inside it.
 */
export function pickVoiceMime(
  isSupported: (mime: string) => boolean,
  candidates: readonly string[] = VOICE_MIME_CANDIDATES,
): string {
  for (const candidate of candidates) {
    if (isSupported(candidate)) return candidate;
  }
  return "";
}

/** The extension that matches a recorded mime. */
export function voiceExtension(mime: string): string {
  const base = voiceMimeBase(mime);
  if (base === "audio/mp4") return ".m4a";
  if (base === "audio/ogg") return ".ogg";
  return ".webm";
}

/**
 * `voice_${System.currentTimeMillis()}.m4a` on the phone; the same shape here
 * with the extension the browser's own container asks for. The worker stores
 * the declared type verbatim (it is on `SAFE_MEDIA_TYPES`), and the phone's
 * `fileLooksVoice` reads `fileType.startsWith("audio")` first — so a `.webm`
 * voice note still draws as a voice note there, not as a clip.
 */
export function voiceFileName(mime: string, now: number = Date.now()): string {
  return `voice_${Math.floor(now)}${voiceExtension(mime)}`;
}

/* ------------------------------------------------------------------- rows */

/**
 * `fileLooksVoice`: an audio type, a phone's audio extension, or the recorder's
 * own `meta.voice` marker. Android's FILE bubble tests this before it tests
 * `fileLooksVideo`, so an `audio/webm` note never reaches the clip branch even
 * though `.webm` is one of the clip extensions.
 */
export function fileLooksVoice(row: Pick<MessageRow, "fileType" | "fileName" | "meta">): boolean {
  const type = String(row.fileType || "").toLowerCase();
  const name = String(row.fileName || "").toLowerCase();
  return (
    type.startsWith("audio") ||
    name.endsWith(".m4a") ||
    name.endsWith(".mp3") ||
    row.meta?.voice === true
  );
}

/**
 * The seed the pseudo-waveform is generated from: the clientId the optimistic
 * echo and the confirmed row share, so the bars do not redraw when the server's
 * id replaces the local one (Android's `barSeed`, E3).
 */
export function voiceBarSeed(row: Pick<MessageRow, "id" | "clientId">): string {
  return row.clientId && row.clientId.length > 0 ? row.clientId : row.id;
}

/**
 * The seconds a voice row claims. `meta.seconds` is what the recorder measured
 * and what the worker clamps to 0…600; an audio file that was not recorded here
 * falls back to the duration the composer probed (`meta.durMs`).
 */
export function voiceSecondsOf(row: Pick<MessageRow, "meta">): number {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const seconds = Number(meta.seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(VOICE_MAX_SECONDS, Math.floor(seconds));
  }
  const durMs = Number(meta.durMs);
  if (Number.isFinite(durMs) && durMs > 0) return Math.max(1, Math.floor(durMs / 1000));
  return 0;
}

/**
 * The bars to draw: the recorded waveform when the row carries one, and a
 * stable pseudo-pattern from the row's own seed when it does not.
 */
export function voiceBarsOf(row: Pick<MessageRow, "id" | "clientId" | "meta">): number[] {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const raw = meta.waveform;
  if (Array.isArray(raw) && raw.length > 0) return sanitizeWaveform(raw);
  return pseudoWaveform(voiceBarSeed(row));
}

/** The refusal the phone shows for an over-long take. */
export function voiceTooBigMessage(bytes: number): string {
  return `That voice note is over ${Math.round(VOICE_MAX_BYTES / (1024 * 1024))} MB (${Math.round(
    bytes / 1024,
  )} KB recorded).`;
}

/** Under a second is not a message; the phone throws the take away. */
export function isVoiceTakeTooShort(elapsedMs: number): boolean {
  return !(elapsedMs >= VOICE_MIN_MS);
}

/* ------------------------------------------------------------- the recorder */

export type RecorderClock = {
  readonly startedAt: number;
  readonly pausedAt: number;
  readonly pausedTotal: number;
  readonly isPaused: boolean;
  readonly isRecording: boolean;
};

/**
 * `VoiceNote.elapsedMs`: what was SPOKEN, not what was on the clock. A pause
 * stops the take's length and its wave, so the number the bubble shows and the
 * number the row stores are the words that were actually said.
 */
export function recorderElapsedMs(clock: RecorderClock, now: number): number {
  if (!clock.isRecording) return 0;
  const end = clock.isPaused ? clock.pausedAt : now;
  return Math.max(0, end - clock.startedAt - clock.pausedTotal);
}

/**
 * The whole-second length a finished take reports: read while the paused clock
 * still knows where it stopped, exactly as `stop()` does.
 */
export function recorderSeconds(clock: RecorderClock, now: number): number {
  return Math.floor(recorderElapsedMs(clock, now) / 1000);
}
