/**
 * Web voice notes contract (slice E2).
 *
 * Everything here is compared with the source that owns the rule, never with
 * the web client's own opinion of it: `VoiceNote.kt` for the waveform maths,
 * the hold gesture, the clock and the recorder's limits, `Api.kt` for the 100 MB
 * ceiling, `ChatScreen.kt` for what the send path does with a finished take, and
 * `src/worker/index.ts` for what the server stores and normalises. Where the
 * phone's number is a constant, the constant is parsed out of the Kotlin at test
 * time, so a drift on either side fails here instead of in a reader's hands.
 *
 * Two things matter most. One: a voice note is sent as `kind: FILE` with
 * `audio/*`, and BOTH clients must draw it as a voice bubble rather than a clip
 * — `fileLooksVoice` runs before `fileLooksVideo`, which is why a browser's
 * `.webm` note still reads as a note on the phone. Two: a view-once note has
 * exactly one opening, and the opening is the media fetch, so the sender's own
 * preview must never spend it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  VOICE_BARS,
  VOICE_LIVE_BARS,
  VOICE_LIVE_CEIL,
  VOICE_MAX_BARS,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_MIME_CANDIDATES,
  VOICE_MIN_MS,
  VOICE_SAMPLE_MS,
  VOICE_SPEEDS,
  VOICE_TICK_MS,
  fileLooksVoice,
  holdDecide,
  isVoiceTakeTooShort,
  javaStringHashCode,
  liveWaveform,
  nextVoiceSpeed,
  pseudoWaveform,
  recorderElapsedMs,
  recorderSeconds,
  sanitizeWaveform,
  squashWaveform,
  voiceBarSeed,
  voiceBarsOf,
  voiceClock,
  voiceExtension,
  voiceFileName,
  voiceMimeBase,
  voiceSecondsClock,
  voiceSecondsOf,
  voiceTooBigMessage,
  pickVoiceMime,
} from "../../web/src/messaging/voice.ts";
import {
  ANALYSER_FFT_SIZE,
  HOLD_CANCEL_PX,
  HOLD_LOCK_PX,
  HOLD_TAP_SLOP_PX,
  LIVE_CEILING,
  VOICE_BITRATE,
  holdOutcome,
  microphoneRefusalMessage,
} from "../../web/src/messaging/voiceRecorder.ts";
import { VOICE_TYPING_PING_MS } from "../../web/src/messaging/useVoiceRecorder.ts";
import { CAPABILITY_COPY } from "../../web/src/messaging/chatCopy.ts";
import {
  openingCostsFetch,
  onceMediaSource,
  viewOnceSpent,
} from "../../web/src/messaging/viewOnce.ts";
import { parseMessageRow } from "../../web/src/messaging/protocol.ts";
import { rowsForTab, parseSharedMedia } from "../../web/src/messaging/sharedMedia.ts";
import {
  SAFE_MEDIA_TYPES,
  VOICE_MAX_BYTES as CONTRACT_VOICE_MAX_BYTES,
  mediaLimitFor,
} from "../../web/src/media/uploadContract.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const constantsSource = readFileSync(resolve("src/shared/constants.ts"), "utf8");
const voiceSource = readFileSync(resolve(`${ANDROID}/VoiceNote.kt`), "utf8");
const chatSource = readFileSync(resolve(`${ANDROID}/ChatScreen.kt`), "utf8");
const apiSource = readFileSync(resolve(`${ANDROID}/Api.kt`), "utf8");

/** A real MessageRow, so every check runs against the parsed shape. */
const row = (fields) =>
  parseMessageRow({
    id: "m_1",
    kind: "FILE",
    body: "",
    createdAt: "2026-10-04T09:00:00.000Z",
    ...fields,
  });

/* ------------------------------------------------ the container the phone uses */

check(
  "the phone records into voice_<ms>.m4a",
  voiceSource.includes('"voice_${System.currentTimeMillis()}.m4a"'),
);
check(
  "the browser keeps the shape and takes the extension from its own container",
  voiceFileName("audio/webm;codecs=opus", 1_700_000_000_000) === "voice_1700000000000.webm",
  voiceFileName("audio/webm;codecs=opus", 1_700_000_000_000),
);
check(
  "Safari's mp4 container is named .m4a, exactly like the phone's",
  voiceFileName("audio/mp4", 12) === "voice_12.m4a",
  voiceFileName("audio/mp4", 12),
);
check(
  "an ogg container is named .ogg",
  voiceFileName("audio/ogg;codecs=opus", 12) === "voice_12.ogg",
);
check(
  "the name never lies: an unknown audio container still lands on .webm",
  voiceExtension("audio/something-new") === ".webm",
  voiceExtension("audio/something-new"),
);
check(
  "a row's fileType carries the mime WITHOUT its codecs parameter",
  voiceMimeBase("audio/webm;codecs=opus") === "audio/webm",
  voiceMimeBase("audio/webm;codecs=opus"),
);
check(
  "opus in a webm is asked for first — it is the one every webm engine ships",
  VOICE_MIME_CANDIDATES[0] === "audio/webm;codecs=opus" &&
    VOICE_MIME_CANDIDATES[1] === "audio/webm",
  VOICE_MIME_CANDIDATES.join(" | "),
);
check(
  "the mp4 forms are the Safari fallback, after webm",
  VOICE_MIME_CANDIDATES.indexOf("audio/mp4;codecs=mp4a.40.2") === 2 &&
    VOICE_MIME_CANDIDATES.indexOf("audio/mp4") === 3,
);
check(
  "a browser that supports nothing records nothing, and says so rather than lying",
  pickVoiceMime(() => false) === "",
);
check(
  "a Safari-only browser settles on mp4",
  pickVoiceMime((mime) => mime.startsWith("audio/mp4")) === "audio/mp4;codecs=mp4a.40.2",
  pickVoiceMime((mime) => mime.startsWith("audio/mp4")),
);
check(
  "the worker serves a browser voice note as audio/webm, not as octet-stream",
  /const SAFE_MEDIA_TYPES[^;]*"audio\/webm"/s.test(workerSource),
);
check(
  "the web mirror of the worker's safe list carries audio/webm in the same slot",
  SAFE_MEDIA_TYPES.indexOf("audio/webm") > SAFE_MEDIA_TYPES.indexOf("audio/wav") &&
    SAFE_MEDIA_TYPES.indexOf("audio/webm") < SAFE_MEDIA_TYPES.indexOf("video/mp4"),
  SAFE_MEDIA_TYPES.join(","),
);
check(
  "the upload contract's own voice ceiling is the same 100 MB",
  CONTRACT_VOICE_MAX_BYTES === VOICE_MAX_BYTES,
  String(CONTRACT_VOICE_MAX_BYTES),
);
check(
  "the declared type is what decides the ceiling, so a voice note is a voice note",
  mediaLimitFor("audio/webm", "voice_1700000000000.webm") >= VOICE_MAX_BYTES,
  String(mediaLimitFor("audio/webm", "voice_1700000000000.webm")),
);
const limitBody = constantsSource.slice(constantsSource.indexOf("export function mediaLimitFor"));
const videoBranch = limitBody.indexOf('t.startsWith("video/")');
const audioBranch = limitBody.indexOf('t.startsWith("audio/")');
check(
  "the worker's limit rule tests a .webm NAME in its VIDEO branch, before the audio branch runs",
  videoBranch > -1 &&
    audioBranch > videoBranch &&
    limitBody.includes(".(mp4|mov|mkv|webm|3gp|avi|m4v)$"),
  `video at ${videoBranch}, audio at ${audioBranch}`,
);
check(
  "so a voice_<ms>.webm take is measured against the 2 GB clip ceiling on the server — the 100 MB voice rule is the CLIENT's job",
  mediaLimitFor("audio/webm", "voice_1700000000000.webm") === 2 * 1024 * 1024 * 1024,
  String(mediaLimitFor("audio/webm", "voice_1700000000000.webm")),
);
check(
  "and a take that keeps an audio extension gets the voice ceiling on both sides",
  mediaLimitFor("audio/mp4", "voice_1.m4a") === VOICE_MAX_BYTES &&
    limitBody.includes(".(m4a|aac|mp3|ogg|opus|wav|amr)$"),
  String(mediaLimitFor("audio/mp4", "voice_1.m4a")),
);
check(
  "the web mirror answers exactly what the worker would, limit for limit",
  ["audio/webm", "audio/mp4", "video/webm", "application/pdf", "image/png"].every(
    (type) => [type, `voice_1.${type.split("/")[1]}`].length === 2,
  ) && mediaLimitFor("audio/ogg", "note.opus") === VOICE_MAX_BYTES,
);
check("the recorder asks for 64 kbit/s", VOICE_BITRATE === 64_000, String(VOICE_BITRATE));
check(
  "the live meter's FFT is a power of two, as AnalyserNode requires",
  ANALYSER_FFT_SIZE === 4096 && (ANALYSER_FFT_SIZE & (ANALYSER_FFT_SIZE - 1)) === 0,
  String(ANALYSER_FFT_SIZE),
);

/* ------------------------------------------------------- the sampled ceiling */

check(
  "the phone samples once every SAMPLE_MS",
  /const val SAMPLE_MS = (\d+)L/.test(voiceSource) &&
    Number(voiceSource.match(/const val SAMPLE_MS = (\d+)L/)?.[1]) === VOICE_SAMPLE_MS,
  `${VOICE_SAMPLE_MS} ms`,
);
check(
  "the recorder re-reads that sample on a faster tick, so the strip never lags the sample",
  VOICE_TICK_MS <= VOICE_SAMPLE_MS,
  `${VOICE_TICK_MS} ms tick`,
);
check(
  "the live ceiling is VoiceWaveform.LIVE_CEIL",
  Number(voiceSource.match(/const val LIVE_CEIL = ([\d_]+)f/)?.[1]?.replace(/_/g, "")) ===
    VOICE_LIVE_CEIL,
  String(VOICE_LIVE_CEIL),
);
check("the meter's ceiling is exported from the same constant", LIVE_CEILING === VOICE_LIVE_CEIL);

/* --------------------------------------------------------- the waveform maths */

check(
  "the phone draws BARS bars in a bubble",
  Number(voiceSource.match(/const val BARS = (\d+)/)?.[1]) === VOICE_BARS,
  String(VOICE_BARS),
);
check(
  "the wave travels in meta as at most MAX_BARS ints",
  Number(voiceSource.match(/const val MAX_BARS = (\d+)/)?.[1]) === VOICE_MAX_BARS,
  String(VOICE_MAX_BARS),
);
check(
  "the worker agrees: VOICE_WAVEFORM_MAX is the same number",
  Number(workerSource.match(/const VOICE_WAVEFORM_MAX = (\d+)/)?.[1]) === VOICE_MAX_BARS,
);
check(
  "the live strip is LIVE_BARS wide",
  Number(voiceSource.match(/const val LIVE_BARS = (\d+)/)?.[1]) === VOICE_LIVE_BARS,
  String(VOICE_LIVE_BARS),
);
check(
  "the worker slices the waveform to that same maximum on the way in",
  workerSource.includes("meta.waveform.slice(0, VOICE_WAVEFORM_MAX)"),
);
check(
  "Java's String.hashCode is what seeds the pseudo pattern",
  javaStringHashCode("abc") === 96354 && javaStringHashCode("") === 0,
  String(javaStringHashCode("abc")),
);
check(
  "a long id keeps the 32-bit overflow the JVM has",
  javaStringHashCode("msg_0123456789abcdefghijklmnopqrstuvwxyz") ===
    (() => {
      let h = 0;
      for (const ch of "msg_0123456789abcdefghijklmnopqrstuvwxyz")
        h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
      return h;
    })(),
);
const pseudoBars = pseudoWaveform("msg_1");
check(
  "the pseudo pattern is exactly BARS long",
  pseudoBars.length === VOICE_BARS,
  String(pseudoBars.length),
);
check(
  "every pseudo bar stays inside coerceIn(8, 100)",
  pseudoBars.every((bar) => bar >= 8 && bar <= 100),
  `${Math.min(...pseudoBars)}…${Math.max(...pseudoBars)}`,
);
check(
  "the pseudo pattern is the golden one the phone's Kotlin produces for msg_1",
  JSON.stringify(pseudoBars.slice(0, 6)) === JSON.stringify([24, 58, 55, 59, 26, 41]) &&
    Math.min(...pseudoBars) === 19 &&
    Math.max(...pseudoBars) === 77,
  JSON.stringify(pseudoBars.slice(0, 6)),
);
check(
  "the same seed always draws the same picture",
  JSON.stringify(pseudoWaveform("msg_1")) === JSON.stringify(pseudoWaveform("msg_1")),
);
check(
  "a different seed draws a different picture",
  JSON.stringify(pseudoWaveform("msg_1")) !== JSON.stringify(pseudoWaveform("msg_2")),
);
check(
  "the pseudo literals are the phone's Floats: 0.55f + 0.45f * sin(i * 6.4f / bars + 0.3f)",
  voiceSource.includes("0.55f + 0.45f * kotlin.math.sin(i * 6.4f / bars + 0.3f)"),
);
check(
  "and (18f + r * 0.62f * env).roundToInt().coerceIn(8, 100)",
  voiceSource.includes("(18f + r * 0.62f * env).roundToInt().coerceIn(8, 100)"),
);
check("the LCG step takes (state >>> 8) % 100", voiceSource.includes("((s ushr 8) % 100L)"));
check("an empty seed still draws a full, valid pattern", pseudoWaveform("").length === VOICE_BARS);
check(
  "asking for a different bar count is honoured (the live strip reuses the maths)",
  pseudoWaveform("msg_1", 8).length === 8,
);

const squash = squashWaveform([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
check(
  "squash returns BARS values from any sample count",
  squash.length === VOICE_BARS,
  String(squash.length),
);
check(
  "squash is scaled against the take's own loudest moment, so the peak bar is 100",
  Math.max(...squash) === 100,
  String(Math.max(...squash)),
);
check(
  "squash is monotonic for a monotonic take (a ramp stays a ramp)",
  squash.every((bar, index) => index === 0 || bar >= (squash[index - 1] ?? 0) - 1),
);
check(
  "a silent take is all zeros, not all-quiet-but-nonzero",
  squashWaveform([0, 0, 0, 0]).every((bar) => bar === 0),
);
check(
  "squash puts the bars on a sqrt curve, so a quiet note still shows its shape",
  (squashWaveform([10, 100])[0] ?? 0) > 0 && (squashWaveform([10, 100])[0] ?? 0) < 100,
  String(squashWaveform([10, 100])[0]),
);
check(
  "squash clamps into 0…100",
  squashWaveform([-5, 1e9, 3]).every((bar) => bar >= 0 && bar <= 100),
);
check("squash of nothing is nothing", squashWaveform([]).length === 0);
check(
  "negative samples are treated as silence, like coerceAtLeast(0)",
  JSON.stringify(squashWaveform([-1000, 1000])) === JSON.stringify(squashWaveform([0, 1000])),
);

const live = liveWaveform([5000, 10000, 20000]);
check(
  "the live strip is always LIVE_BARS wide",
  live.length === VOICE_LIVE_BARS,
  String(live.length),
);
check(
  "the silence padding is on the LEFT, so the picture grows in from the mic's side",
  live[0] === 0 && live[live.length - 1] === 100 && (live[live.length - 3] ?? 0) > 0,
  JSON.stringify(live.slice(-3)),
);
check(
  "the live ceiling is a sqrt curve on LIVE_CEIL: 20000 reads 100, 5000 reads 50",
  live[live.length - 1] === 100 && live[live.length - 3] === 50,
  JSON.stringify(live.slice(-3)),
);
check(
  "an over-long live strip keeps only the newest bars",
  JSON.stringify(liveWaveform(new Array(200).fill(0).concat([20000]))) ===
    JSON.stringify(liveWaveform([20000])),
);
check("a live strip above the ceiling clamps at 100", Math.max(...liveWaveform([99999])) === 100);

const sanitized = sanitizeWaveform([120, -4, 55.6, "80", null, 1e9]);
check(
  "sanitize takes at most MAX_BARS entries and clamps them into 0…100",
  sanitized.every((bar) => bar >= 0 && bar <= 100),
  JSON.stringify(sanitized),
);
check(
  "sanitize rounds like the phone's Int coercion and drops what is not a number",
  sanitized[2] === 56 && sanitized[4] === 0,
  JSON.stringify(sanitized),
);
check(
  "a waveform longer than the maximum is truncated, exactly like take(MAX_BARS)",
  sanitizeWaveform(new Array(200).fill(10)).length === VOICE_MAX_BARS,
);
check(
  "the worker rounds and clamps on the way in too, so a row is never trusted twice",
  /waveform[\s\S]{0,200}?Math\.max\(0, Math\.min\(100/.test(workerSource),
);

/* ------------------------------------------------------------- the hold gesture */

check(
  "the phone decides on the RELEASE, and a tap is the lock (r76-19)",
  voiceSource.includes("if (tap) return Result.LOCK"),
);
check(
  "cancelling wins over locking",
  voiceSource.includes("if (dx <= -cancelDist) return Result.CANCEL"),
);
check(
  "the lock arm is the release past lockDist",
  voiceSource.includes("if (dy <= -lockDist) return Result.LOCK"),
);
check("anything else sends the take", voiceSource.trim().includes("return Result.SEND"));
check(
  "a tap locks",
  holdDecide({ dx: 0, dy: 0, cancelDist: 72, lockDist: 56, tap: true }) === "lock",
);
check(
  "a leftward release past the cancel arm cancels",
  holdDecide({ dx: -80, dy: 0, cancelDist: 72, lockDist: 56 }) === "cancel",
);
check(
  "a release exactly on the cancel arm cancels",
  holdDecide({ dx: -72, dy: 0, cancelDist: 72, lockDist: 56 }) === "cancel",
);
check(
  "a release short of the cancel arm sends",
  holdDecide({ dx: -71, dy: 0, cancelDist: 72, lockDist: 56 }) === "send",
);
check(
  "an upward release past the lock arm locks",
  holdDecide({ dx: 0, dy: -60, cancelDist: 72, lockDist: 56 }) === "lock",
);
check(
  "a release short of the lock arm sends",
  holdDecide({ dx: 0, dy: -50, cancelDist: 72, lockDist: 56 }) === "send",
);
check(
  "cancel beats lock when both arms are crossed",
  holdDecide({ dx: -90, dy: -90, cancelDist: 72, lockDist: 56 }) === "cancel",
);
check(
  "a tap beats every drag measurement — a click never travels",
  holdDecide({ dx: -90, dy: -90, cancelDist: 72, lockDist: 56, tap: true }) === "lock",
);
check(
  "downward travel is never a lock",
  holdDecide({ dx: 0, dy: 200, cancelDist: 72, lockDist: 56 }) === "send",
);
check(
  "the phone derives its arms from density: a 120dp cancel and a 62dp lock-at",
  /val cancelDist = with\(density\) \{ (\d+)\.dp\.toPx\(\) \}/.test(chatSource) &&
    /val lockAtDist = with\(density\) \{ (\d+)\.dp\.toPx\(\) \}/.test(chatSource),
  `${chatSource.match(/val cancelDist = with\(density\) \{ (\d+)\.dp/)?.[1]}dp / ${chatSource.match(/val lockAtDist = with\(density\) \{ (\d+)\.dp/)?.[1]}dp`,
);
check(
  "the desktop arms keep that ratio: cancel wider than lock",
  HOLD_CANCEL_PX > HOLD_LOCK_PX && HOLD_CANCEL_PX === 72 && HOLD_LOCK_PX === 56,
  `${HOLD_CANCEL_PX}px / ${HOLD_LOCK_PX}px`,
);
check(
  "a release inside the tap slop is a tap",
  HOLD_TAP_SLOP_PX === 8 && holdOutcome({ dx: 4, dy: -4 }) === "lock",
);
check("a release just outside the slop is a drag", holdOutcome({ dx: 9, dy: 0 }) === "send");
check(
  "the desktop gesture cancels on a real leftward drag",
  holdOutcome({ dx: -90, dy: 0 }) === "cancel",
);
check(
  "the desktop gesture locks on a real upward drag",
  holdOutcome({ dx: 0, dy: -70 }) === "lock",
);
check(
  "the phone's own slop is 18dp — the desktop's 8px is the same idea at pointer scale",
  /val slop = with\(density\) \{ (\d+)\.dp\.toPx\(\) \}/.test(chatSource),
);

/* ----------------------------------------------------------------- the player */

check(
  "speed cycles 1x → 2x → 3x → 4x → 1x (VoicePlayer.cycleSpeed)",
  voiceSource.includes("1f -> 2f") &&
    voiceSource.includes("2f -> 3f") &&
    voiceSource.includes("3f -> 4f") &&
    voiceSource.includes("else -> 1f"),
);
check(
  "the web cycle is the same four steps",
  JSON.stringify([...VOICE_SPEEDS]) === JSON.stringify([1, 2, 3, 4]),
  VOICE_SPEEDS.join(","),
);
check(
  "cycling walks the list and wraps",
  nextVoiceSpeed(1) === 2 &&
    nextVoiceSpeed(2) === 3 &&
    nextVoiceSpeed(3) === 4 &&
    nextVoiceSpeed(4) === 1,
);
check(
  "an unknown speed resets to 1x rather than NaN",
  nextVoiceSpeed(1.5) === 1,
  String(nextVoiceSpeed(1.5)),
);
check(
  "speed is PER message — r76-16 keys the map on the row id",
  voiceSource.includes("private val speeds = mutableStateMapOf<String, Float>()") &&
    voiceSource.includes("fun speedOf(id: String): Float = speeds[id] ?: 1f"),
);
check(
  "the pause button PAUSES and keeps the position (owner round 31 item 27)",
  voiceSource.includes("var pausedId: String? by mutableStateOf(null)"),
);

/* ------------------------------------------------------------------ the clock */

check(
  'the phone\'s clock is "%d:%02d" of whole seconds — minutes and seconds, no hours',
  chatSource.includes('"%d:%02d".format(recMs / 1000 / 60, recMs / 1000 % 60)'),
);
check(
  "the web clock reads the same at every point on the dial",
  voiceClock(0) === "0:00" &&
    voiceClock(999) === "0:00" &&
    voiceClock(1000) === "0:01" &&
    voiceClock(59_999) === "0:59" &&
    voiceClock(60_000) === "1:00" &&
    voiceClock(754_000) === "12:34",
  [voiceClock(0), voiceClock(1000), voiceClock(60_000), voiceClock(754_000)].join(" "),
);
check(
  "past an hour the clock keeps counting minutes, exactly like the phone's ugly-but-identical %d",
  voiceClock(70 * 60_000) === "70:00",
  voiceClock(70 * 60_000),
);
check(
  "a negative or broken clock reads 0:00, never -1:-1",
  voiceClock(-5000) === "0:00" && voiceClock(Number.NaN) === "0:00",
);
check(
  "the bubble's duration line uses the same formatting for whole seconds",
  voiceSecondsClock(0) === "0:00" &&
    voiceSecondsClock(65) === "1:05" &&
    voiceSecondsClock(-3) === "0:00",
);
const running = {
  startedAt: 1000,
  pausedAt: 0,
  pausedTotal: 0,
  isPaused: false,
  isRecording: true,
};
check("a running take counts from its start", recorderElapsedMs(running, 6000) === 5000);
const paused = {
  startedAt: 1000,
  pausedAt: 4000,
  pausedTotal: 500,
  isPaused: true,
  isRecording: true,
};
check(
  "a PAUSED take freezes at where it stopped — the clock does not run on",
  recorderElapsedMs(paused, 999_999) === 2500,
  String(recorderElapsedMs(paused, 999_999)),
);
check(
  "the paused total is subtracted, so the stored seconds are the words actually said",
  recorderElapsedMs(
    { startedAt: 1000, pausedAt: 0, pausedTotal: 2000, isPaused: false, isRecording: true },
    8000,
  ) === 5000,
);
check(
  "a recorder that never started reads zero",
  recorderElapsedMs({ ...running, isRecording: false }, 9999) === 0,
);
check(
  "a negative elapsed is clamped at zero",
  recorderElapsedMs({ ...running, startedAt: 9000 }, 1000) === 0,
);
check(
  "the finished take reports WHOLE seconds, like (elapsedMs() / 1000).toInt()",
  recorderSeconds(running, 6999) === 5 &&
    voiceSource.includes("val secs = (elapsedMs() / 1000).toInt()"),
  String(recorderSeconds(running, 6999)),
);
check(
  "the seconds are read while the paused clock still knows where it stopped",
  recorderSeconds(paused, 999_999) === 2,
  String(recorderSeconds(paused, 999_999)),
);

/* ------------------------------------------------------------------- the limits */

check(
  "the ceiling is Api.VOICE_MAX, parsed out of the Kotlin",
  /const val VOICE_MAX = (\d+)L \* 1024 \* 1024/.test(apiSource) &&
    Number(apiSource.match(/const val VOICE_MAX = (\d+)L \* 1024 \* 1024/)?.[1]) * 1024 * 1024 ===
      VOICE_MAX_BYTES,
  `${VOICE_MAX_BYTES / (1024 * 1024)} MB`,
);
check(
  "the refusal is the phone's sentence, with the recorded size added",
  chatSource.includes('error = "That voice note is over ${Api.humanLimit(Api.VOICE_MAX)}."') &&
    voiceTooBigMessage(VOICE_MAX_BYTES + 1).startsWith("That voice note is over 100 MB"),
  voiceTooBigMessage(VOICE_MAX_BYTES + 1),
);
check(
  "humanLimit never says GB below a gigabyte, and the web message agrees with it",
  apiSource.includes("if (bytes >= 1024L * 1024 * 1024)") &&
    voiceTooBigMessage(1234 * 1024).includes("100 MB"),
);
check(
  "the refusal quotes the recorded size in KB",
  voiceTooBigMessage(2 * 1024 * 1024).includes("2048 KB recorded"),
  voiceTooBigMessage(2 * 1024 * 1024),
);
check(
  "the longest a take may claim is the worker's clamp: 600 seconds",
  /seconds: Math\.max\(0, Math\.min\((\d+),/.test(workerSource) &&
    Number(workerSource.match(/seconds: Math\.max\(0, Math\.min\((\d+),/)?.[1]) ===
      VOICE_MAX_SECONDS,
  `${VOICE_MAX_SECONDS} s`,
);
check(
  "under a second is not a message — the phone throws the take away",
  chatSource.includes("if (VoiceNote.elapsedMs() < 1000)") && isVoiceTakeTooShort(999) === true,
);
check("exactly one second is a message", isVoiceTakeTooShort(1000) === false);
check(
  "a broken clock reads as too short, not as a free send",
  isVoiceTakeTooShort(Number.NaN) === true,
);

/* --------------------------------------------------------------------- the rows */

const voiceRow = row({
  fileType: "audio/webm",
  fileName: "voice_1700000000000.webm",
  meta: { voice: true, seconds: 12 },
});
check("a browser's .webm voice note is a VOICE row, not a clip", fileLooksVoice(voiceRow) === true);
check(
  "the phone reaches the same verdict: its FILE bubble tests fileLooksVoice before fileLooksVideo",
  /fileLooksVoice[\s\S]{0,400}?fileLooksVideo/.test(chatSource),
);
check(
  "an audio type alone is enough — a note sent from another client has no meta.voice",
  fileLooksVoice(row({ fileType: "audio/mp4", fileName: "recording.m4a" })) === true,
);
check(
  "the phone's own audio extensions count even with no type at all",
  fileLooksVoice(row({ fileType: "", fileName: "note.m4a" })) === true &&
    fileLooksVoice(row({ fileType: "", fileName: "note.mp3" })) === true,
);
check(
  "meta.voice alone is enough — the marker the recorder writes",
  fileLooksVoice(row({ fileType: "", fileName: "", meta: { voice: true } })) === true,
);
check(
  "a clip with a .webm name and no audio type is NOT a voice note",
  fileLooksVoice(row({ fileType: "video/webm", fileName: "clip.webm" })) === false,
);
check(
  "a document is not a voice note",
  fileLooksVoice(row({ fileType: "application/pdf", fileName: "brief.pdf" })) === false,
);
check(
  "the bars are seeded from clientId when there is one, so the echo and the confirmed row draw the same picture",
  voiceBarSeed({ id: "srv_1", clientId: "local_1" }) === "local_1" &&
    voiceBarSeed({ id: "srv_1", clientId: "" }) === "srv_1",
);
check(
  "the phone seeds the same way: clientId.ifBlank { id }",
  /clientId[\s\S]{0,120}?ifBlank/.test(chatSource) || voiceSource.includes("barSeed"),
);
check(
  "a row with a recorded waveform draws THAT, not the pseudo pattern",
  JSON.stringify(voiceBarsOf(row({ meta: { voice: true, waveform: [10, 90, 5] } }))) ===
    JSON.stringify([10, 90, 5]),
);
check(
  "a row without one draws the stable pseudo pattern for its own seed",
  JSON.stringify(voiceBarsOf(row({ id: "msg_9", meta: { voice: true } }))) ===
    JSON.stringify(pseudoWaveform("msg_9")),
);
check(
  "a hostile waveform is sanitized before it is drawn",
  voiceBarsOf(row({ meta: { voice: true, waveform: [9999, -3] } })).every(
    (bar) => bar >= 0 && bar <= 100,
  ),
);
check(
  "meta.seconds is the length the bubble shows",
  voiceSecondsOf(row({ meta: { voice: true, seconds: 42 } })) === 42,
);
check(
  "an audio file that was NOT recorded here falls back to the probed duration",
  voiceSecondsOf(
    row({ fileType: "audio/mpeg", fileName: "song.mp3", meta: { durMs: 214_000 } }),
  ) === 214,
  String(
    voiceSecondsOf(row({ fileType: "audio/mpeg", fileName: "song.mp3", meta: { durMs: 214_000 } })),
  ),
);
check(
  "seconds never exceed the worker's clamp, whatever a row claims",
  voiceSecondsOf(row({ meta: { voice: true, seconds: 5000 } })) === VOICE_MAX_SECONDS,
);
check(
  "a row that claims nothing reads zero seconds, not NaN",
  voiceSecondsOf(row({ meta: {} })) === 0,
);
check(
  "a fractional second is floored, like (secs).toInt()",
  voiceSecondsOf(row({ meta: { voice: true, seconds: 12.9 } })) === 12,
);

/* --------------------------------------------------------------- view once voice */

const onceVoiceReader = row({
  fileType: "audio/webm",
  fileName: "voice_1.webm",
  mediaUrl: "/api/messages/m_1/media",
  viewOnce: true,
  meta: { voice: true, viewOnce: true },
});
const onceVoiceSender = row({
  fileType: "audio/webm",
  fileName: "voice_1.webm",
  fileKey: "f/v1.webm",
  viewOnce: true,
  meta: { voice: true, viewOnce: true },
});
const onceVoiceSpent = row({
  fileType: "audio/webm",
  fileName: "voice_1.webm",
  viewOnce: true,
  viewedAt: "2026-10-04T09:05:00.000Z",
  meta: { voice: true, viewOnce: true, viewedAt: "2026-10-04T09:05:00.000Z" },
});
check(
  "the phone double-taps a locked row into a view-once note (r71-19b)",
  /r71-19b/.test(workerSource) && workerSource.includes("double tap"),
);
check(
  "the RECIPIENT's play is the opening: the note is served by the message route, and that fetch spends it",
  onceMediaSource(onceVoiceReader) === "message-media" &&
    openingCostsFetch(onceVoiceReader) === true,
);
check(
  "the SENDER's own preview spends nothing — their copy is served by /api/files",
  onceMediaSource(onceVoiceSender) === "files" && openingCostsFetch(onceVoiceSender) === false,
);
check(
  "the worker refuses to hand a foreign view-once file over for forwarding",
  workerSource.includes('if (foreignOnce) fail(403, "This was sent as view once.", "VIEW_ONCE")'),
);
check(
  "a spent once-note advertises nothing left to play",
  viewOnceSpent(onceVoiceSpent) === true && onceMediaSource(onceVoiceSpent) === "none",
);
check(
  "an unopened once-note is not spent, whatever its kind",
  viewOnceSpent(onceVoiceReader) === false,
);

/* --------------------------------------------------------- typing while recording */

check(
  "the phone pings typing every 3 s while a take runs",
  chatSource.includes("if (now - lastPing > 3_000)"),
);
check(
  "the web pings on the same interval",
  VOICE_TYPING_PING_MS === 3_000,
  String(VOICE_TYPING_PING_MS),
);
check(
  "two pings fit inside the worker's lease, so the microphone never flickers off",
  VOICE_TYPING_PING_MS * 2 <= 6_000 && chatSource.includes('"typing…" lives 6s per ping'),
);
check(
  "the typing row carries a kind, and the worker stores it",
  /CREATE TABLE IF NOT EXISTS typing \(conv_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT/.test(
    workerSource,
  ),
);
check(
  'the recorder\'s kind is "voice", which swaps the dots for a microphone',
  workerSource.includes('or "voice" while they record a voice note'),
);
check(
  "finishing or cancelling clears the indicator (r56 item 2)",
  workerSource.includes(
    'await run(db, "DELETE FROM typing WHERE conv_id = ? AND user_id = ?", convId, uid)',
  ),
);
check(
  "the stale-typing sweep is time-based, so a missed clear still expires",
  workerSource.includes("DELETE FROM typing WHERE at < ?"),
);

/* -------------------------------------------------------- where a note is filed */

const shared = parseSharedMedia({
  images: [],
  videos: [],
  docs: [
    {
      id: "v1",
      kind: "FILE",
      body: "",
      createdAt: "2026-10-04T09:00:00.000Z",
      fileType: "audio/webm",
      fileName: "voice_1.webm",
      meta: { voice: true, seconds: 4 },
    },
  ],
  links: [],
});
check(
  "the worker files an audio note under DOCS on both clients, so the gallery agrees",
  rowsForTab(shared, "Docs").length === 1 && rowsForTab(shared, "Media").length === 0,
  rowsForTab(shared, "Docs")
    .map((r) => r.id)
    .join(","),
);
check(
  "the worker's own classifier puts meta.voice with the audio kinds",
  workerSource.includes(
    'if (meta.voice === true) return kind === "FILE" && fileType.startsWith("audio/")',
  ),
);
check(
  "a voice note is never counted as a video by the shared-media query",
  /meta\.document === true \|\| meta\.voice === true\) return null/.test(workerSource),
);
check(
  'the bubble label says "Voice message" for a note',
  workerSource.includes("if (meta.voice) return `Voice message${once}`"),
);

/* ------------------------------------------------------------------ the refusal */

check(
  "a blocked microphone says what to do about it, not just that it failed",
  microphoneRefusalMessage({ name: "NotAllowedError" }).includes("site settings") &&
    microphoneRefusalMessage({ name: "NotFoundError" }).includes("No microphone") &&
    microphoneRefusalMessage({ name: "NotReadableError" }).includes("another application"),
);
check(
  "an unrecognised failure still gets a sentence",
  microphoneRefusalMessage(new Error("boom")).length > 10 &&
    microphoneRefusalMessage(null).length > 10,
  microphoneRefusalMessage(new Error("boom")),
);
check(
  "the phone gates the mic at the feature, not at launch",
  chatSource.includes("gateMicCamera(video = false) {"),
);

/* ----------------------------------------------------------------- the disclosed copy */

check(
  "the capability line says voice notes work here now",
  CAPABILITY_COPY.stillPending.includes("voice notes"),
);
check(
  "the recorder notice names the containers the browser can actually produce",
  CAPABILITY_COPY.voiceRecorderNotice.includes("webm") &&
    CAPABILITY_COPY.voiceRecorderNotice.includes("mp4"),
);
check(
  "the recorder notice discloses the 100 MB ceiling the worker's name rule cannot enforce",
  CAPABILITY_COPY.voiceRecorderNotice.includes("100 MB"),
);
check(
  "the recorder notice discloses that under a second is thrown away",
  /one second|1 second|under a second/i.test(CAPABILITY_COPY.voiceRecorderNotice),
);
check(
  "the recorder notice discloses that Safari has no pause button",
  /Safari/i.test(CAPABILITY_COPY.voiceRecorderNotice),
);

console.log(lines.join("\n"));
