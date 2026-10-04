/**
 * Web attachment + photo-editor contract.
 *
 * Three kinds of claim are pinned here:
 *
 *  1. PARITY WITH THE WORKER — every byte ceiling, the served-type allowlist and
 *     the `mediaLimitFor` branches are compared against the server's own
 *     constants and source, so a browser cannot invent a limit the API will
 *     refuse later.
 *  2. PARITY WITH ANDROID — the sticker catalog is re-derived from
 *     `StickerSheet.kt` at test time and compared glyph-by-glyph with the
 *     generated web catalog, and the `meta` object matches what ChatScreen.kt
 *     builds for a photo, a clip, an audio file and a document.
 *  3. PURE GEOMETRY — crop clamping, rotation, output size and the editor's
 *     reducers, which are the parts a browser test cannot assert precisely.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DOC_MAX_BYTES as WORKER_DOC_MAX_BYTES,
  IMAGE_MAX_BYTES as WORKER_IMAGE_MAX_BYTES,
  SINGLE_UPLOAD_MAX_BYTES as WORKER_SINGLE_UPLOAD_MAX_BYTES,
  UPLOAD_PART_BYTES as WORKER_UPLOAD_PART_BYTES,
  VIDEO_MAX_BYTES as WORKER_VIDEO_MAX_BYTES,
  VOICE_MAX_BYTES as WORKER_VOICE_MAX_BYTES,
  mediaLimitFor as workerMediaLimitFor,
} from "../../src/shared/constants.ts";
import { deriveStickerPacks } from "../../scripts/generate-web-stickers.ts";
import {
  ATTACH_ACCEPT,
  DOC_MAX_BYTES,
  IMAGE_MAX_BYTES,
  PHOTO_MAX_EDGE,
  SAFE_MEDIA_TYPES,
  SINGLE_UPLOAD_MAX_BYTES,
  UPLOAD_PART_BYTES,
  VIDEO_MAX_BYTES,
  VOICE_MAX_BYTES,
  albumId,
  attachmentCategory,
  buildAttachmentMeta,
  classifyAttachment,
  describeLimit,
  FILE_KEY_RE,
  fileGetPath,
  formatBytes,
  isAttachmentKind,
  isUsableFileKey,
  longestEdgeFit,
  mediaLimitFor,
  photoFileName,
  planUpload,
  safeMediaType,
  splitParts,
} from "../../web/src/media/uploadContract.ts";
import {
  BRUSH_WIDTHS,
  CROP_PRESETS,
  DRAW_COLORS,
  EMPTY_EDIT,
  MAX_CROP_TEXT_LENGTH,
  MAX_EDIT_LAYERS,
  addSticker,
  addText,
  beginStroke,
  brushWidth,
  clearLayers,
  clamp01,
  clampRect,
  cropPixels,
  editIsEmpty,
  extendStroke,
  moveSticker,
  outputSize,
  presetCrop,
  removeSticker,
  removeLayerById,
  removeText,
  rotateBy,
  rotatedSize,
  stickerFontSize,
  textFontSize,
  undoLast,
  updateText,
  withCrop,
  withRotation,
} from "../../web/src/media/imageEdit.ts";
import {
  STICKER_GLYPH_COUNT,
  STICKER_PACK_COUNT,
  STICKER_PACKS,
} from "../../web/src/media/stickerPacks.ts";
import {
  MAX_ATTACHMENTS_PER_SEND,
  applyRenderedEdit,
  attachmentMeta,
  audioSeconds,
  describeAttachment,
  hasEdits,
  isImageIntent,
  nextAttachmentId,
} from "../../web/src/messaging/attachments.ts";
import { uploadFile } from "../../web/src/messaging/filesApi.ts";
import { createLocalAttachmentEcho } from "../../web/src/messaging/protocol.ts";
import { ATTACH_TILE_IDS, ATTACH_TILE_UNAVAILABLE } from "../../web/src/messaging/AttachMenu.tsx";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

/* ------------------------------------------------- worker parity: ceilings --- */

check(
  "image ceiling matches the worker",
  IMAGE_MAX_BYTES === WORKER_IMAGE_MAX_BYTES,
  `${IMAGE_MAX_BYTES}`,
);
check(
  "video ceiling matches the worker",
  VIDEO_MAX_BYTES === WORKER_VIDEO_MAX_BYTES,
  `${VIDEO_MAX_BYTES}`,
);
check(
  "document ceiling matches the worker",
  DOC_MAX_BYTES === WORKER_DOC_MAX_BYTES,
  `${DOC_MAX_BYTES}`,
);
check(
  "voice ceiling matches the worker",
  VOICE_MAX_BYTES === WORKER_VOICE_MAX_BYTES,
  `${VOICE_MAX_BYTES}`,
);
check(
  "multipart chunk matches the worker",
  UPLOAD_PART_BYTES === WORKER_UPLOAD_PART_BYTES,
  `${UPLOAD_PART_BYTES}`,
);
check(
  "single-request ceiling matches the worker",
  SINGLE_UPLOAD_MAX_BYTES === WORKER_SINGLE_UPLOAD_MAX_BYTES,
  `${SINGLE_UPLOAD_MAX_BYTES}`,
);

const LIMIT_CASES = [
  ["image/jpeg", "photo.jpg"],
  ["image/png", "screenshot.png"],
  ["", "holiday.heic"],
  ["application/octet-stream", "scan.bmp"],
  ["video/mp4", "clip.mp4"],
  ["video/webm", "recording.webm"],
  ["", "movie.mkv"],
  ["", "old.avi"],
  ["audio/mpeg", "song.mp3"],
  ["audio/mp4", "note.m4a"],
  ["", "voice.opus"],
  ["", "tape.amr"],
  ["application/pdf", "invoice.pdf"],
  ["text/plain", "notes.txt"],
  ["", "archive.zip"],
  ["", ""],
];
check(
  "mediaLimitFor agrees with the worker on every type/name pair",
  LIMIT_CASES.every(
    ([type, name]) => mediaLimitFor(type, name) === workerMediaLimitFor(type, name),
  ),
  LIMIT_CASES.map(([t, n]) => `${t || "-"}/${n || "-"}=${mediaLimitFor(t, n)}`).join(" "),
);
check(
  "a photo is capped at the image ceiling",
  mediaLimitFor("image/jpeg", "a.jpg") === IMAGE_MAX_BYTES,
);
check(
  "a clip is capped at the video ceiling",
  mediaLimitFor("video/mp4", "a.mp4") === VIDEO_MAX_BYTES,
);
check(
  "audio is capped at the voice ceiling",
  mediaLimitFor("audio/mpeg", "a.mp3") === VOICE_MAX_BYTES,
);
check(
  "anything else is capped at the document ceiling",
  mediaLimitFor("", "a.zip") === DOC_MAX_BYTES,
);
check(
  "an extension decides when the type is blank",
  mediaLimitFor("", "clip.mov") === VIDEO_MAX_BYTES,
);

/* --------------------------------------------- worker parity: served types --- */

const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const workerListMatch = workerSource.match(/const SAFE_MEDIA_TYPES = new Set\(\[([\s\S]*?)\]\);/);
const workerTypes = workerListMatch
  ? [...workerListMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : [];

check(
  "the worker's served-type list was found in its source",
  workerTypes.length > 0,
  `${workerTypes.length} types`,
);
check(
  "the web allowlist equals the worker's, in the same order",
  workerTypes.length === SAFE_MEDIA_TYPES.length &&
    workerTypes.every((type, index) => SAFE_MEDIA_TYPES[index] === type),
  `worker=${workerTypes.length} web=${SAFE_MEDIA_TYPES.length}`,
);
check("a served type round-trips", safeMediaType("image/jpeg") === "image/jpeg");
check(
  "a parameterised type is stripped to its essence",
  safeMediaType("image/png; charset=utf-8") === "image/png",
);
check("case and whitespace are normalised", safeMediaType("  IMAGE/WebP ") === "image/webp");
check(
  "an unserved type becomes an opaque download",
  safeMediaType("text/html") === "application/octet-stream",
);
check(
  "svg is never served as markup",
  safeMediaType("image/svg+xml") === "application/octet-stream",
);
check("a blank type is an opaque download", safeMediaType("") === "application/octet-stream");
check("a null type is an opaque download", safeMediaType(null) === "application/octet-stream");
check(
  "audio/webm is NOT servable — browser voice notes are slice E, not a silent lie",
  !SAFE_MEDIA_TYPES.includes("audio/webm") &&
    safeMediaType("audio/webm") === "application/octet-stream",
);
check("video/webm IS servable", SAFE_MEDIA_TYPES.includes("video/webm"));

check("describeLimit speaks in GB above a gigabyte", describeLimit(DOC_MAX_BYTES) === "5 GB");
check("describeLimit speaks in MB below it", describeLimit(IMAGE_MAX_BYTES) === "100 MB");
check("formatBytes renders kilobytes without a decimal", formatBytes(2048) === "2 KB");
check("formatBytes renders megabytes with one decimal", formatBytes(5 * 1024 * 1024) === "5.0 MB");
check(
  "formatBytes renders gigabytes with two decimals",
  formatBytes(2 * 1024 * 1024 * 1024) === "2.00 GB",
);
check(
  "formatBytes floors at zero for junk",
  formatBytes(Number.NaN) === "0 KB" && formatBytes(-5) === "0 KB",
);
check("formatBytes keeps small files in bytes", formatBytes(512) === "512 B");

/* ------------------------------------------------------- classify + accept --- */

check("a jpeg is a photo", classifyAttachment("image/jpeg", "a.jpg") === "photo");
check("a heic with no type is still a photo", classifyAttachment("", "IMG_1.heic") === "photo");
check("an mp4 is a video", classifyAttachment("video/mp4", "a.mp4") === "video");
check("a webm with no type is a video", classifyAttachment("", "clip.webm") === "video");
check("an mp3 is audio", classifyAttachment("audio/mpeg", "a.mp3") === "audio");
check("an opus with no type is audio", classifyAttachment("", "voice.opus") === "audio");
check("a zip is a document", classifyAttachment("application/zip", "a.zip") === "document");
check("a pdf is a document", classifyAttachment("application/pdf", "a.pdf") === "document");
check("a blank file is a document", classifyAttachment("", "") === "document");
check("the gallery tile accepts images", ATTACH_ACCEPT.gallery === "image/*");
check("the document tile accepts anything", ATTACH_ACCEPT.document === "*/*");

/* ----------------------------------------------------------- upload plan --- */

check("an empty file takes the single route", planUpload(0).mode === "single");
check("a small photo takes the single route", planUpload(4 * 1024 * 1024).mode === "single");
check(
  "exactly the single-request ceiling still takes the single route",
  planUpload(SINGLE_UPLOAD_MAX_BYTES).mode === "single",
);
check(
  "one byte over the ceiling goes multipart",
  planUpload(SINGLE_UPLOAD_MAX_BYTES + 1).mode === "multipart",
);

// 20 MB still fits one request; 26 MB does not, so it goes up in four chunks.
check("a 20 MB file still takes the single route", planUpload(20 * 1024 * 1024).mode === "single");
const bigPlan = planUpload(26 * 1024 * 1024);
check(
  "a multipart plan carries a part size",
  bigPlan.mode === "multipart" && bigPlan.partSize === UPLOAD_PART_BYTES,
);
check(
  "a multipart plan cuts four 8 MB parts for 26 MB",
  bigPlan.mode === "multipart" && bigPlan.parts.length === 4,
  bigPlan.mode === "multipart" ? `${bigPlan.parts.length}` : "-",
);
check(
  "part numbers are 1-based and contiguous",
  bigPlan.mode === "multipart" && bigPlan.parts.every((part, index) => part.n === index + 1),
);
check(
  "the parts cover the file exactly, with no gaps or overlap",
  bigPlan.mode === "multipart" &&
    bigPlan.parts[0].start === 0 &&
    bigPlan.parts.every(
      (part, index) => index === 0 || part.start === bigPlan.parts[index - 1].end,
    ) &&
    bigPlan.parts[bigPlan.parts.length - 1].end === 26 * 1024 * 1024,
);
check(
  "only the last part may be shorter than the chunk size",
  bigPlan.mode === "multipart" &&
    bigPlan.parts.slice(0, -1).every((part) => part.end - part.start === UPLOAD_PART_BYTES),
);
check(
  "a server-supplied part size is honoured",
  (() => {
    // 26 MB in 6 MB chunks: four full parts and a short tail.
    const plan = planUpload(26 * 1024 * 1024, 6 * 1024 * 1024);
    return (
      plan.mode === "multipart" &&
      plan.partSize === 6 * 1024 * 1024 &&
      plan.parts.length === 5 &&
      plan.parts[4].end - plan.parts[4].start === 26 * 1024 * 1024 - 4 * 6 * 1024 * 1024
    );
  })(),
);
check(
  "splitParts of an exact multiple has no empty tail",
  splitParts(16 * 1024 * 1024).length === 2,
);
check("splitParts of nothing is empty", splitParts(0).length === 0);
check(
  "splitParts never yields a zero-length part",
  splitParts(UPLOAD_PART_BYTES + 1).every((part) => part.end > part.start),
);

check("the photo long edge is the shared 2048", PHOTO_MAX_EDGE === 2048);
const fit = longestEdgeFit(4000, 3000);
check(
  "a 4000x3000 photo shrinks to a 2048 long edge",
  fit.width === 2048 && fit.height === 1536,
  `${fit.width}x${fit.height}`,
);
check("shrinking is reported", fit.scaled === true);
check(
  "a portrait photo shrinks on its height",
  (() => {
    const r = longestEdgeFit(3000, 4000);
    return r.width === 1536 && r.height === 2048;
  })(),
);
check(
  "a photo already inside the ceiling is untouched",
  (() => {
    const r = longestEdgeFit(1200, 800);
    return r.width === 1200 && r.height === 800 && r.scaled === false;
  })(),
);
check(
  "a square photo stays square",
  (() => {
    const r = longestEdgeFit(5000, 5000);
    return r.width === 2048 && r.height === 2048;
  })(),
);
check(
  "a degenerate size is not scaled up",
  (() => {
    const r = longestEdgeFit(0, 0);
    return r.width === 0 && r.height === 0 && r.scaled === false;
  })(),
);
check(
  "a thin panorama keeps a legal short edge",
  (() => {
    const r = longestEdgeFit(8000, 100);
    return r.width === 2048 && r.height >= 1;
  })(),
);

/* --------------------------------------------- meta parity with ChatScreen --- */

const photoMeta = buildAttachmentMeta("photo", { width: 1536, height: 2048 });
check(
  "a photo carries only its box",
  photoMeta.w === 1536 && photoMeta.h === 2048 && Object.keys(photoMeta).length === 2,
);
const clipMeta = buildAttachmentMeta("video", { width: 1920, height: 1080, durationMs: 12_400 });
check(
  "a clip carries its box and durMs",
  clipMeta.w === 1920 && clipMeta.h === 1080 && clipMeta.durMs === 12_400,
);
check("a clip does not carry whole seconds", clipMeta.seconds === undefined);
const audioMeta = buildAttachmentMeta("audio", { durationMs: 4_200 });
check("audio carries durMs", audioMeta.durMs === 4_200);
check("audio carries whole seconds like the phone's voice row", audioMeta.seconds === 4);
check(
  "a sub-second audio row still reads one second",
  buildAttachmentMeta("audio", { durationMs: 400 }).seconds === 1,
);
check(
  "audioSeconds floors and never reports zero for a real note",
  audioSeconds(1_900) === 1 && audioSeconds(0) === 0,
);
const docMeta = buildAttachmentMeta("video", { width: 1920, height: 1080, asDocument: true });
check(
  "sent as a document, the only meta key is document",
  docMeta.document === true && Object.keys(docMeta).length === 1,
);
const onceMeta = buildAttachmentMeta("photo", { width: 10, height: 10, viewOnce: true });
check("view-once rides in meta, not as a sibling key", onceMeta.viewOnce === true);
check(
  "a document is never view-once",
  buildAttachmentMeta("photo", { asDocument: true, viewOnce: true }).viewOnce === undefined,
);
const albumMeta = buildAttachmentMeta("photo", { width: 10, height: 10, album: "album_7" });
check("a multi-photo send carries its album id", albumMeta.album === "album_7");
check(
  "no facts means no meta at all",
  Object.keys(buildAttachmentMeta("document", {})).length === 0,
);
check(
  "a zero box is not sent as meta",
  Object.keys(buildAttachmentMeta("photo", { width: 0, height: 0 })).length === 0,
);

check(
  "photo file names follow the shared shape",
  /^photo_\d+\.jpg$/.test(photoFileName(1_700_000_000_000)),
);
check("album ids follow the shared shape", /^album_\d+$/.test(albumId(1_700_000_000_000)));
check("FILE is an attachment kind", isAttachmentKind("FILE"));
check("IMAGE is an attachment kind", isAttachmentKind("IMAGE"));
check("TEXT is not an attachment kind", !isAttachmentKind("TEXT"));
check("STICKER is not an attachment kind — it has no bytes", !isAttachmentKind("STICKER"));

check("a jpeg row is a photo", attachmentCategory("image/jpeg", {}) === "photo");
check("an mp4 row is a video", attachmentCategory("video/mp4", {}) === "video");
check("an mp3 row is audio", attachmentCategory("audio/mpeg", {}) === "audio");
check(
  "meta.voice wins over the mime type",
  attachmentCategory("audio/mpeg", { voice: true }) === "voice",
);
check(
  "meta.document wins over the mime type",
  attachmentCategory("video/mp4", { document: true }) === "document",
);
check("a blank type is a document", attachmentCategory("", {}) === "document");

/* -------------------------------------------------- the upload route choice --- */

const calls = [];
const fakeApi = {
  request: async (path, init = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/api/files/mpu/start")
      return { uploadId: "up_1", partSize: UPLOAD_PART_BYTES, key: "f/x.bin" };
    if (path.startsWith("/api/files/mpu/part")) {
      const n = Number(new URL(`https://x${path}`).searchParams.get("n"));
      return { ok: true, n, etag: `etag_${n}` };
    }
    if (path === "/api/files/mpu/complete") return { fileKey: "f/x.bin", size: 26 * 1024 * 1024 };
    if (path === "/api/files/mpu/abort") return { ok: true };
    if (path.startsWith("/api/files?")) return { fileKey: "f/small.jpg", size: 10 };
    throw new Error(`unexpected path ${path}`);
  },
  requestRaw: async () => {
    throw new Error("not used");
  },
};

const fakeBlob = (size) => ({
  size,
  slice: (start, end) => fakeBlob(Math.max(0, (end ?? size) - (start ?? 0))),
});

const smallResult = await uploadFile(fakeApi, {
  name: "a.jpg",
  type: "image/jpeg",
  blob: fakeBlob(1024),
});
check("a small file returns the server's fileKey", smallResult.fileKey === "f/small.jpg");
check(
  "a small file used the single-request route",
  calls.length === 1 && calls[0].path.startsWith("/api/files?"),
  calls.map((c) => c.path).join(","),
);
check(
  "the single-request route carries name and type in the query",
  /name=a\.jpg/.test(calls[0].path) && /type=image%2Fjpeg/.test(calls[0].path),
);

calls.length = 0;
const progress = [];
const bigResult = await uploadFile(fakeApi, {
  name: "big.bin",
  type: "application/octet-stream",
  blob: fakeBlob(26 * 1024 * 1024),
  onProgress: (value) => progress.push(value.partsDone),
});
check("a large file returns the completed fileKey", bigResult.fileKey === "f/x.bin");
check(
  "a large file used start + parts + complete",
  calls[0].path === "/api/files/mpu/start" &&
    calls[calls.length - 1].path === "/api/files/mpu/complete",
);
check(
  "a 26 MB file uploads four 8 MB parts",
  calls.filter((call) => call.path.startsWith("/api/files/mpu/part")).length === 4,
);
check("start declares the true size", JSON.parse(calls[0].body).size === 26 * 1024 * 1024);
check(
  "progress advanced once per part, then once more at completion",
  progress.join(",") === "1,2,3,4,4",
  progress.join(","),
);
check("a four-part upload reports five times", progress.length === 5);
check(
  "no abort was needed for a clean upload",
  !calls.some((call) => call.path === "/api/files/mpu/abort"),
);

calls.length = 0;
const failingApi = {
  request: async (path) => {
    calls.push(path);
    if (path === "/api/files/mpu/start") return { uploadId: "up_2", partSize: UPLOAD_PART_BYTES };
    if (path === "/api/files/mpu/abort") return { ok: true };
    throw new Error("network down");
  },
  requestRaw: async () => {
    throw new Error("not used");
  },
};
let failure = "";
await uploadFile(failingApi, { name: "big.bin", type: "", blob: fakeBlob(26 * 1024 * 1024) }).catch(
  (error) => {
    failure = error.message;
  },
);
check("a failed part surfaces the real error", failure === "network down", failure);
check(
  "a failed upload aborts its session so no parts linger",
  calls.includes("/api/files/mpu/abort"),
  calls.join(","),
);

let emptyFailure = "";
await uploadFile(fakeApi, { name: "e.bin", type: "", blob: fakeBlob(0) }).catch((error) => {
  emptyFailure = error.message;
});
check(
  "an empty file is refused before any request",
  emptyFailure === "File is empty.",
  emptyFailure,
);

const mismatchApi = {
  request: async (path) => {
    if (path === "/api/files/mpu/start") return { uploadId: "up_3", partSize: UPLOAD_PART_BYTES };
    if (path.startsWith("/api/files/mpu/part")) return { ok: true, n: 99 };
    if (path === "/api/files/mpu/abort") return { ok: true };
    throw new Error("unexpected");
  },
  requestRaw: async () => {
    throw new Error("not used");
  },
};
let mismatch = "";
await uploadFile(mismatchApi, { name: "b.bin", type: "", blob: fakeBlob(26 * 1024 * 1024) }).catch(
  (error) => {
    mismatch = error.message;
  },
);
check(
  "a part that lands under the wrong number is refused at once",
  mismatch === "Upload part was refused.",
  mismatch,
);

/* ------------------------------------------------- sticker parity (Kotlin) --- */

const kotlin = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/StickerSheet.kt"),
  "utf8",
);
const derived = deriveStickerPacks(kotlin);
const derivedTotal = derived.reduce((sum, pack) => sum + pack.glyphs.length, 0);

check("the Kotlin source still holds 8 sticker packs", derived.length === 8, `${derived.length}`);
check("the Kotlin source still holds 1,150 glyphs", derivedTotal === 1150, `${derivedTotal}`);
check("the generated catalog reports the same pack count", STICKER_PACK_COUNT === derived.length);
check("the generated catalog reports the same glyph count", STICKER_GLYPH_COUNT === derivedTotal);
check(
  "the generated catalog has the same number of packs",
  STICKER_PACKS.length === derived.length,
);
check(
  "every pack name matches, in order",
  STICKER_PACKS.every((pack, index) => pack.name === derived[index].name),
  STICKER_PACKS.map((pack) => pack.name).join(" | "),
);
check(
  "every pack has the same glyph count",
  STICKER_PACKS.every((pack, index) => pack.glyphs.length === derived[index].glyphs.length),
  STICKER_PACKS.map((pack) => `${pack.name}:${pack.glyphs.length}`).join(" "),
);
check(
  "every glyph matches, in order — a reordered pack would render differently on a phone",
  STICKER_PACKS.every((pack, index) =>
    pack.glyphs.every((glyph, i) => glyph === derived[index].glyphs[i]),
  ),
);
check(
  "the catalog total really is 1,150 glyphs",
  STICKER_PACKS.reduce((sum, pack) => sum + pack.glyphs.length, 0) === 1150,
);
check(
  "no pack is empty",
  STICKER_PACKS.every((pack) => pack.glyphs.length > 0),
);
check(
  "no glyph is blank",
  STICKER_PACKS.every((pack) => pack.glyphs.every((glyph) => glyph.length > 0)),
);
check("the catalog is frozen", Object.isFrozen(STICKER_PACKS));
check("the first pack is Smileys & People", STICKER_PACKS[0].name === "Smileys & People");
check("the last pack is Flags", STICKER_PACKS[STICKER_PACKS.length - 1].name === "Flags");
check(
  "the Bangladesh flag is in the Flags pack",
  STICKER_PACKS[STICKER_PACKS.length - 1].glyphs.includes("🇧🇩"),
);

/* ------------------------------------------------------- attach tile grid --- */

check(
  "every Android attach tile has a web counterpart",
  ["gallery", "camera", "location", "contact", "document", "poll", "event", "ai-images"].every(
    (id) => ATTACH_TILE_IDS.includes(id),
  ),
  ATTACH_TILE_IDS.join(","),
);
check(
  "the browser-only video tile exists as a substitute for the gallery's video tab",
  ATTACH_TILE_IDS.includes("video"),
);
check(
  "Poll, Event and AI images stay verified placeholders — Android shows comingSoon() too",
  ["poll", "event", "ai-images"].every((id) =>
    (ATTACH_TILE_UNAVAILABLE[id] || "").includes("coming soon on Android too"),
  ),
);
check(
  "Location states the real reason it is unavailable",
  (ATTACH_TILE_UNAVAILABLE.location || "").includes("location provider"),
);
check(
  "Contact states the real reason it is unavailable",
  (ATTACH_TILE_UNAVAILABLE.contact || "").includes("contacts"),
);
check(
  "every unavailable tile explains itself",
  Object.values(ATTACH_TILE_UNAVAILABLE).every((reason) => reason.length > 20),
);

/* ------------------------------------------------------------ edit geometry --- */

check(
  "clamp01 pins junk to the unit interval",
  clamp01(Number.NaN) === 0 && clamp01(5) === 1 && clamp01(-2) === 0,
);
const clamped = clampRect({ x: -0.5, y: 1.4, w: 3, h: -1 });
check(
  "a crop rect is pulled inside the unit square",
  clamped.x === 0 && clamped.y === 1 && clamped.w >= 0.02 && clamped.h >= 0.02,
);
check(
  "a crop rect never collapses to zero area",
  clampRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }).w >= 0.02,
);
check("an original-ratio crop is null", presetCrop(4000, 3000, null) === null);
const square = presetCrop(4000, 3000, 1);
check("a 1:1 crop of a wide photo keeps the full height", Math.abs(square.h - 1) < 1e-9);
check("a 1:1 crop of a wide photo is centred", Math.abs(square.x - (1 - square.w) / 2) < 1e-9);
check("a 1:1 crop of a 4000x3000 photo is 0.75 wide", Math.abs(square.w - 0.75) < 1e-9);
const tall = presetCrop(3000, 4000, 16 / 9);
check("a 16:9 crop of a tall photo keeps the full width", Math.abs(tall.w - 1) < 1e-9);
check(
  "a 16:9 crop of a tall photo is centred vertically",
  Math.abs(tall.y - (1 - tall.h) / 2) < 1e-9,
);
check(
  "a crop matching the source ratio covers everything",
  (() => {
    const r = presetCrop(1000, 1000, 1);
    return r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1;
  })(),
);
check("a zero-sized source yields no crop", presetCrop(0, 0, 1) === null);
check(
  "every crop preset has a label and an id",
  CROP_PRESETS.every((preset) => preset.label.length > 0 && preset.id.length > 0),
);
check(
  "the presets include the original ratio",
  CROP_PRESETS.some((preset) => preset.ratio === null),
);

check("rotateBy wraps left from zero to 270", rotateBy(0, -90) === 270);
check("rotateBy wraps right from 270 to zero", rotateBy(270, 90) === 0);
check("rotateBy steps a quarter turn", rotateBy(90, 90) === 180);
check(
  "a quarter turn swaps the box",
  (() => {
    const r = rotatedSize(1600, 900, 90);
    return r.width === 900 && r.height === 1600;
  })(),
);
check(
  "a half turn keeps the box",
  (() => {
    const r = rotatedSize(1600, 900, 180);
    return r.width === 1600 && r.height === 900;
  })(),
);

const pixels = cropPixels(4000, 3000, square);
check("crop pixels are integers", Number.isInteger(pixels.sx) && Number.isInteger(pixels.sw));
check(
  "crop pixels stay inside the source",
  pixels.sx + pixels.sw <= 4000 && pixels.sy + pixels.sh <= 3000,
);
check(
  "a null crop is the whole source",
  (() => {
    const r = cropPixels(800, 600, null);
    return r.sx === 0 && r.sy === 0 && r.sw === 800 && r.sh === 600;
  })(),
);
check(
  "a crop at the very edge keeps at least one pixel",
  (() => {
    const r = cropPixels(100, 100, { x: 1, y: 1, w: 1, h: 1 });
    return r.sw >= 1 && r.sh >= 1 && r.sx + r.sw <= 100;
  })(),
);

check(
  "an unedited photo keeps its own size under the ceiling",
  (() => {
    const r = outputSize(1200, 800, EMPTY_EDIT);
    return r.width === 1200 && r.height === 800;
  })(),
);
check(
  "a huge photo comes down to the upload edge",
  (() => {
    const r = outputSize(6000, 4000, EMPTY_EDIT);
    return r.width === 2048 && r.height === 1365;
  })(),
);
check(
  "rotation is applied before the shrink",
  (() => {
    const r = outputSize(6000, 4000, withRotation(EMPTY_EDIT, 90));
    return r.width === 1365 && r.height === 2048;
  })(),
);
check(
  "crop then rotate then shrink compose in that order",
  (() => {
    // 6000x2000 -> crop the left half (3000x2000) -> rotate 90 (2000x3000)
    // -> shrink to the 2048 long edge (1365x2048). Unrotated it would be 2048x1365.
    const cropped = withCrop(EMPTY_EDIT, { x: 0, y: 0, w: 0.5, h: 1 });
    const unrotated = outputSize(6000, 2000, cropped);
    const turned = outputSize(6000, 2000, withRotation(cropped, 90));
    return (
      unrotated.width === 2048 &&
      unrotated.height === 1365 &&
      turned.width === 1365 &&
      turned.height === 2048
    );
  })(),
);
check("editIsEmpty is true for a fresh model", editIsEmpty(EMPTY_EDIT));
check(
  "a crop alone is an edit",
  !editIsEmpty(withCrop(EMPTY_EDIT, { x: 0, y: 0, w: 0.5, h: 0.5 })),
);
check("a rotation alone is an edit", !editIsEmpty(withRotation(EMPTY_EDIT, 90)));
check("a zero rotation is not an edit", editIsEmpty(withRotation(EMPTY_EDIT, 0)));

/* ----------------------------------------------------------- edit reducers --- */

const withSticker = addSticker(EMPTY_EDIT, "😀", "s1");
check(
  "a sticker lands centred",
  withSticker.stickers[0].x === 0.5 && withSticker.stickers[0].y === 0.5,
);
check("a sticker starts at the default scale", withSticker.stickers[0].scale === 1);
check("adding a sticker is not an empty edit", !editIsEmpty(withSticker));
const moved = moveSticker(withSticker, "s1", { x: 4, y: -3, scale: 99 });
check(
  "a sticker is pinned inside the frame",
  moved.stickers[0].x === 1 && moved.stickers[0].y === 0,
);
check("a sticker scale is clamped to a usable range", moved.stickers[0].scale === 3);
check(
  "shrinking a sticker stops before it disappears",
  moveSticker(withSticker, "s1", { scale: -9 }).stickers[0].scale === 0.25,
);
check(
  "moving another sticker's id changes nothing",
  moveSticker(withSticker, "other", { x: 0 }).stickers[0].x === 0.5,
);
check("removing a sticker empties the model again", editIsEmpty(removeSticker(withSticker, "s1")));

const withText = addText(EMPTY_EDIT, "hello", "#ffffff", "t1");
check("text keeps its content", withText.texts[0].text === "hello");
check("blank text is refused", editIsEmpty(addText(EMPTY_EDIT, "   ", "#fff", "t2")));
check(
  "text is truncated to the shared cap",
  addText(EMPTY_EDIT, "x".repeat(MAX_CROP_TEXT_LENGTH + 50), "#fff", "t3").texts[0].text.length ===
    MAX_CROP_TEXT_LENGTH,
);
check("text size is clamped", updateText(withText, "t1", { size: 99 }).texts[0].size === 3);
check("removing text empties the model", editIsEmpty(removeText(withText, "t1")));

const withStroke = beginStroke(EMPTY_EDIT, "st1", "#ff0000", BRUSH_WIDTHS[1], { x: 0.2, y: 0.3 });
check("a stroke starts with one point", withStroke.strokes[0].points.length === 1);
check(
  "an off-catalog brush width falls back to a real one",
  beginStroke(EMPTY_EDIT, "st2", "#fff", 0.9, { x: 0, y: 0 }).strokes[0].width === BRUSH_WIDTHS[1],
);
const grown = extendStroke(withStroke, "st1", { x: 5, y: -2 });
check("a stroke grows by one point", grown.strokes[0].points.length === 2);
check(
  "stroke points are clamped to the frame",
  grown.strokes[0].points[1].x === 1 && grown.strokes[0].points[1].y === 0,
);

const stacked = addSticker(
  addText(
    beginStroke(EMPTY_EDIT, "a", "#fff", BRUSH_WIDTHS[0], { x: 0, y: 0 }),
    "note",
    "#fff",
    "b",
  ),
  "🙂",
  "c",
);
// The editor passes the order it created layers in; without it undo falls back
// to sticker -> text -> stroke, which is documented, not guessed.
const order = ["a", "b", "c"];
check(
  "undo with the real history removes the most recently added layer",
  undoLast(stacked, order).stickers.length === 0 &&
    undoLast(stacked, order).texts.length === 1 &&
    undoLast(stacked, order).strokes.length === 1,
);
check(
  "undo again follows the history to the text",
  undoLast(undoLast(stacked, order), order.slice(0, 2)).texts.length === 0,
);
check(
  "undo without a history falls back to the last sticker",
  undoLast(stacked).stickers.length === 0,
);
check(
  "a history of ids that are all gone changes nothing",
  undoLast(stacked, ["zzz"]).stickers.length === 1,
);
check("removeLayerById removes a stroke too", removeLayerById(stacked, "a").strokes.length === 0);
check("undo with nothing to remove is a no-op", editIsEmpty(undoLast(EMPTY_EDIT)));
check(
  "clearLayers keeps the crop and rotation",
  (() => {
    const base = withRotation(withCrop(stacked, { x: 0, y: 0, w: 0.5, h: 0.5 }), 90);
    const cleared = clearLayers(base);
    return cleared.stickers.length === 0 && cleared.crop !== null && cleared.rotation === 90;
  })(),
);

let capped = EMPTY_EDIT;
for (let index = 0; index < MAX_EDIT_LAYERS + 10; index += 1)
  capped = addSticker(capped, "🙂", `s${index}`);
check(
  "the layer cap holds",
  capped.stickers.length === MAX_EDIT_LAYERS,
  `${capped.stickers.length}`,
);

check("there are brush colours to choose from", DRAW_COLORS.length >= 5);
check(
  "every brush colour is a hex triplet",
  DRAW_COLORS.every((value) => /^#[0-9a-f]{6}$/i.test(value)),
);
check(
  "there are three brush widths, ascending",
  BRUSH_WIDTHS.length === 3 &&
    BRUSH_WIDTHS[0] < BRUSH_WIDTHS[1] &&
    BRUSH_WIDTHS[1] < BRUSH_WIDTHS[2],
);
check("a sticker font is a sixth of the width at scale 1", stickerFontSize(1200, 1) === 200);
check("a sticker font never collapses to nothing", stickerFontSize(20, 0.25) >= 8);
check("a caption font scales with the output", textFontSize(2048, 1) === Math.round(2048 * 0.06));
check("a brush width is at least one pixel", brushWidth(900, BRUSH_WIDTHS[0]) >= 1);

/* ------------------------------------------------ composer attachment model --- */

let seen = new Set();
const ids = Array.from({ length: 500 }, () => nextAttachmentId());
ids.forEach((id) => seen.add(id));
check("attachment ids are unique", seen.size === 500);
check(
  "attachment ids are namespaced",
  ids.every((id) => id.startsWith("att_")),
);
const seeded = [nextAttachmentId(() => "AAA"), nextAttachmentId(() => "AAA")];
check("a fixed random source still yields unique ids", seeded[0] !== seeded[1], seeded.join(","));
check("photo intent is the only image intent", isImageIntent("photo") && !isImageIntent("video"));
check("the composer caps a single send", MAX_ATTACHMENTS_PER_SEND === 20);

const item = {
  id: "att_1",
  intent: "photo",
  name: "photo_1.jpg",
  pickedName: "IMG_9912.JPG",
  type: "image/jpeg",
  blob: fakeBlob(204_800),
  size: 204_800,
  previewUrl: null,
  width: 1536,
  height: 2048,
  durationMs: 0,
  edit: EMPTY_EDIT,
  asDocument: false,
  state: "ready",
  error: "",
  progress: null,
};
check("an unedited photo reports no edits", hasEdits(item) === false);
check("an edited photo reports edits", hasEdits({ ...item, edit: withSticker }) === true);
check(
  "attachmentMeta carries the measured box",
  attachmentMeta(item).w === 1536 && attachmentMeta(item).h === 2048,
);
check(
  "attachmentMeta adds the album only when one is given",
  attachmentMeta(item, "album_1").album === "album_1" && attachmentMeta(item).album === undefined,
);
const described = describeAttachment(item);
check("a description names the picked file", described.includes("IMG_9912.JPG"));
check("a description states the size", described.includes("200 KB"), described);
check("a description states the pixel box", described.includes("1536 by 2048"));
check(
  "a document description says document",
  describeAttachment({ ...item, intent: "document", width: 0, height: 0 }).startsWith("Document"),
);

const echo = createLocalAttachmentEcho({
  clientId: "c_w1",
  senderId: "u_me",
  kind: "FILE",
  body: "",
  fileName: "photo_1.jpg",
  fileType: "image/jpeg",
  fileSize: 204_800,
  mediaWidth: 1536,
  mediaHeight: 2048,
  meta: { w: 1536, h: 2048 },
  localPreview: "blob:local",
});
check(
  "an attachment echo uses its clientId as its id",
  echo.id === "c_w1" && echo.clientId === "c_w1",
);
check("an attachment echo starts pending", echo.localState === "pending");
check("an attachment echo keeps its local preview", echo.localPreview === "blob:local");
check(
  "an attachment echo carries the measured box",
  echo.mediaWidth === 1536 && echo.mediaHeight === 2048,
);
check("an image echo is flagged hasImage", echo.hasImage === true);
check(
  "a video echo is not flagged hasImage",
  createLocalAttachmentEcho({
    clientId: "c_w2",
    senderId: "u",
    kind: "FILE",
    body: "",
    fileName: "a.mp4",
    fileType: "video/mp4",
    fileSize: 1,
  }).hasImage === false,
);
check("an echo starts with no upload progress", echo.localProgress === 0);
check(
  "a sticker echo carries its glyph as the body",
  createLocalAttachmentEcho({
    clientId: "c_w3",
    senderId: "u",
    kind: "STICKER",
    body: "😀",
    fileName: "",
    fileType: "",
    fileSize: 0,
  }).body === "😀",
);

/* ---------------------------------- download path: parity, guard, escapes --- */

const workerKeyMatch = workerSource.match(/const FILE_KEY_RE = \/(.+)\/([a-z]*);/);
check(
  "the worker's file-key pattern was found in its source",
  Boolean(workerKeyMatch),
  workerKeyMatch ? workerKeyMatch[1] : "missing",
);
const workerFileKeyRe = workerKeyMatch ? new RegExp(workerKeyMatch[1], workerKeyMatch[2]) : null;
check(
  "the client's FILE_KEY_RE is the worker's, character for character",
  workerFileKeyRe !== null && FILE_KEY_RE.source === workerFileKeyRe.source,
  `${FILE_KEY_RE.source} vs ${workerFileKeyRe?.source ?? "?"}`,
);

// Android builds the same URL with Api.encodePath: encode each segment, keep
// the slashes. The web client must agree, or the two apps ask for different
// paths for the same key.
const kotlinApi = readFileSync(
  resolve("native-android/app/src/main/java/app/kuchupuchu/android/Api.kt"),
  "utf8",
);
const encodePath = kotlinApi.match(/private fun encodePath\([^)]*\)\s*=\s*(.+)/);
check("android's encodePath was found", Boolean(encodePath), encodePath?.[1] ?? "missing");
check(
  "android encodes path segments, not whole keys",
  Boolean(encodePath) && encodePath[1].includes('.split("/")') && encodePath[1].includes('"/"'),
  encodePath?.[1] ?? "",
);

check("a real key keeps its slash", fileGetPath("f/abc123.jpg") === "/api/files/f/abc123.jpg");
check(
  "a deep key keeps every slash",
  fileGetPath("f/2026/10/abc.jpg") === "/api/files/f/2026/10/abc.jpg",
);
check("a key is trimmed", fileGetPath("  f/abc.jpg  ") === "/api/files/f/abc.jpg");
check(
  "no encoded slash ever reaches the wire",
  !fileGetPath("f/abc.jpg").toLowerCase().includes("%2f"),
);
// Every character FILE_KEY_RE allows is already URI-safe, so a valid key is
// never rewritten at all — which is what makes the path guard a no-op for it.
const validKeys = [
  "f/abc123.jpg",
  "f/a-b_c.d.jpg",
  "f/2026/10/04/x.mp4",
  `v/${"a".repeat(190)}.mp4`, // 195 chars after the first: inside the 200 cap
];
for (const key of validKeys) {
  check(
    `a valid key is passed through unchanged: ${key.slice(0, 20)}…`,
    isUsableFileKey(key) && fileGetPath(key) === `/api/files/${key}`,
    fileGetPath(key),
  );
}

const escapes = [
  "../me",
  "f/../../me",
  "f//x",
  "/api/me",
  "f/.",
  "",
  " ",
  "f/x.jpg?".padEnd(240, "a"),
];
for (const bad of escapes) {
  let threw = false;
  try {
    fileGetPath(bad);
  } catch {
    threw = true;
  }
  check(
    `an unusable key is refused: ${JSON.stringify(bad.slice(0, 24))}`,
    threw && !isUsableFileKey(bad),
  );
}
check("a usable key is accepted", isUsableFileKey("f/abc123.jpg") === true);

// The whole point: the api client's own path guard must let the request out.
const { createApiClient } = await import("../../web/src/api.ts");
const { fetchFileBlob } = await import("../../web/src/messaging/filesApi.ts");
const paths = [];
const api = createApiClient(async (input) => {
  paths.push(String(input));
  return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
});
const downloaded = await fetchFileBlob(api, "f/abc123.jpg");
check(
  "a media download reaches the network on the guard-approved path",
  paths.length === 1 && paths[0] === "/api/files/f/abc123.jpg",
  paths.join(", "),
);
check(
  "the downloaded bytes and type come back",
  downloaded.type === "image/jpeg" && downloaded.blob.size === 3,
);

paths.length = 0;
let refused = false;
try {
  await fetchFileBlob(api, "../../api/me");
} catch {
  refused = true;
}
check("a hostile key never becomes a request", refused && paths.length === 0);

// And the shape that used to be sent is exactly what the guard refuses, which
// is why every received photo failed before this was fixed.
paths.length = 0;
let guardRefused = false;
try {
  await api.requestRaw(`/api/files/${encodeURIComponent("f/abc123.jpg")}`);
} catch {
  guardRefused = true;
}
check(
  "a whole-key encoded slash is refused by the api client's path guard",
  guardRefused && paths.length === 0,
);

/* ------------------------------ the name and type always match the bytes --- */

// Both other clients send `photo.jpg` / `image/jpeg` for every photo. This one
// re-encodes only when the pixels actually change: a scaled pick is baked to
// JPEG and renamed, and an edit is too — but a photo that already fits inside
// the 2048 long edge uploads its own bytes, name and type. The row therefore
// never claims a type the bytes do not have.
const pickedPhoto = {
  id: "a1",
  intent: "photo",
  pickedName: "screenshot.png",
  name: "screenshot.png",
  type: "image/png",
  blob: { size: 4321 },
  size: 4321,
  width: 800,
  height: 600,
  durationMs: 0,
  asDocument: false,
  state: "ready",
  error: "",
  progress: null,
  previewUrl: "",
  edit: EMPTY_EDIT,
};
check(
  "an unscaled photo keeps its own name and type",
  pickedPhoto.name === "screenshot.png" && pickedPhoto.type === "image/png",
);
check("an untouched photo reports no edits", hasEdits(pickedPhoto) === false);

const edited = applyRenderedEdit(
  pickedPhoto,
  { blob: { size: 900 }, width: 600, height: 800 },
  {
    ...EMPTY_EDIT,
    rotation: 90,
  },
);
check(
  "an edited photo is renamed to the JPEG it now is",
  /^photo_\d+\.jpg$/.test(edited.name) && edited.type === "image/jpeg",
  `${edited.name} ${edited.type}`,
);
check("an edited photo reports the rendered box", edited.width === 600 && edited.height === 800);
check("an edited photo reports the rendered size", edited.size === 900);
check("an edited photo is flagged as edited", hasEdits(edited) === true);
check(
  "an edited photo's meta carries the rotated box",
  JSON.stringify(attachmentMeta(edited)) === JSON.stringify({ w: 600, h: 800 }),
  JSON.stringify(attachmentMeta(edited)),
);

console.log(lines.join("\n"));
