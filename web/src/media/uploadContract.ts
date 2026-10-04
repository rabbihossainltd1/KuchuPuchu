/**
 * The upload half of the attachment contract, mirrored from the Worker.
 *
 * Every number and rule here is read out of `src/shared/constants.ts` and
 * `src/worker/index.ts` — the Web client is not allowed to invent its own
 * ceilings, because a browser that accepted a 6 GB document would only discover
 * the mistake as a `413 TOO_LARGE` after the user had already waited. The
 * contract case re-imports the Worker's own constants and asserts the two agree,
 * so a server-side change that is not mirrored here fails CI.
 *
 * Deliberately free of DOM and React so it can be exercised in Node.
 */

/* ------------------------------------------------------------ byte ceilings */

export const IMAGE_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const DOC_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const VOICE_MAX_BYTES = 100 * 1024 * 1024;

/** One multipart chunk. R2 wants every part but the last at 5 MB or more. */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/** Anything bigger than this must use the multipart route, not one POST. */
export const SINGLE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** A picked photo is shrunk to this long edge and re-encoded as JPEG. */
export const PHOTO_MAX_EDGE = 2048;

/* ------------------------------------------------------- served media types */

/**
 * The Worker's `SAFE_MEDIA_TYPES`. Anything outside it is stored and served as
 * `application/octet-stream`, which is how the API origin avoids handing back
 * executable markup (`text/html`, `image/svg+xml`) that an uploader stored.
 */
export const SAFE_MEDIA_TYPES: readonly string[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
  "application/octet-stream",
]);

/**
 * What the Worker will store a given type as. Note that `audio/webm` — what a
 * browser MediaRecorder produces — is NOT on the list, so browser voice notes
 * would come back as an opaque download. That is a server-side decision and is
 * tracked as slice E work, not papered over here.
 */
export function safeMediaType(raw: string | null | undefined): string {
  const type = (String(raw ?? "").split(";")[0] ?? "").trim().toLowerCase().slice(0, 100);
  return (SAFE_MEDIA_TYPES as readonly string[]).includes(type) ? type : "application/octet-stream";
}

/** The ceiling for one upload, from its declared type and file name. */
export function mediaLimitFor(type: string, name = ""): number {
  const t = (type || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/.test(n)) {
    return IMAGE_MAX_BYTES;
  }
  if (t.startsWith("video/") || /\.(mp4|mov|mkv|webm|3gp|avi|m4v)$/.test(n)) return VIDEO_MAX_BYTES;
  if (t.startsWith("audio/") || /\.(m4a|aac|mp3|ogg|opus|wav|amr)$/.test(n)) return VOICE_MAX_BYTES;
  return DOC_MAX_BYTES;
}

/** Same wording the Worker uses in its 413 message. */
export function describeLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Human size for the composer strip and document rows. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ------------------------------------------------------------- attach kinds */

export type AttachmentIntent = "photo" | "video" | "audio" | "document";

/**
 * How a picked file will be sent. Mirrors the Worker's own `mediaLimitFor`
 * branches and Android's `isClip` / `isAudio` / `asDocument` rules: a video or
 * an audio file sent AS A DOCUMENT keeps the document ceiling and the
 * `meta.document` marker instead of being treated as media.
 */
export function classifyAttachment(type: string, name: string): AttachmentIntent {
  const t = (type || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/.test(n)) return "photo";
  if (t.startsWith("video/") || /\.(mp4|mov|mkv|webm|3gp|avi|m4v)$/.test(n)) return "video";
  if (t.startsWith("audio/") || /\.(m4a|aac|mp3|ogg|opus|wav|amr)$/.test(n)) return "audio";
  return "document";
}

/** The file picker `accept` values behind each attach tile. */
export const ATTACH_ACCEPT = {
  gallery: "image/*",
  camera: "image/*",
  video: "video/*",
  document: "*/*",
} as const;

/* ----------------------------------------------------------- upload planning */

export type UploadPart = { n: number; start: number; end: number };

export type UploadPlan =
  { mode: "single" } | { mode: "multipart"; partSize: number; parts: readonly UploadPart[] };

/**
 * Which route a file of this size takes. The Worker answers a too-big single
 * POST with `413 USE_MULTIPART`, so the client decides up front instead of
 * burning the user's bandwidth on a request that is guaranteed to be refused.
 */
export function planUpload(size: number, partSize = UPLOAD_PART_BYTES): UploadPlan {
  if (!Number.isFinite(size) || size <= 0) return { mode: "single" };
  if (size <= SINGLE_UPLOAD_MAX_BYTES) return { mode: "single" };
  return { mode: "multipart", partSize, parts: splitParts(size, partSize) };
}

/**
 * Byte ranges per part, 1-based like the Worker's `?n=`. The last part is
 * whatever is left, so parts are never padded and the sum of the ranges is
 * exactly the file size.
 */
export function splitParts(size: number, partSize = UPLOAD_PART_BYTES): UploadPart[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const chunk = Math.max(1, Math.floor(partSize));
  const parts: UploadPart[] = [];
  for (let start = 0, n = 1; start < size; start += chunk, n += 1) {
    parts.push({ n, start, end: Math.min(size, start + chunk) });
  }
  return parts;
}

/**
 * The long-edge shrink the phone and the production PWA both apply before a
 * photo upload: it keeps a 108 MP camera JPEG inside the single-request path.
 */
export function longestEdgeFit(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE,
): {
  width: number;
  height: number;
  scaled: boolean;
} {
  const w = Math.max(0, Math.round(width) || 0);
  const h = Math.max(0, Math.round(height) || 0);
  if (!w || !h) return { width: w, height: h, scaled: false };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h, scaled: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scaled: true,
  };
}

/* -------------------------------------------------------------- message meta */

export type AttachmentFacts = {
  width?: number;
  height?: number;
  durationMs?: number;
  /** Whole seconds, only for audio sent as media (the voice branch). */
  seconds?: number;
  viewOnce?: boolean;
  album?: string;
  /** A video or audio file the user explicitly sent as a document. */
  asDocument?: boolean;
};

/**
 * The `meta` object for an attachment message. Key-for-key what Android builds
 * in ChatScreen (`clipMeta` merged over `docMeta`): photos carry w/h, clips
 * carry w/h plus durMs, audio-as-media carries durMs plus whole seconds, and a
 * file sent as a document carries `document: true`. An empty meta is omitted
 * rather than sent as `{}`.
 */
export function buildAttachmentMeta(
  intent: AttachmentIntent,
  facts: AttachmentFacts,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (facts.asDocument) {
    meta.document = true;
  } else if (intent === "photo" || intent === "video") {
    if (facts.width && facts.width > 0 && facts.height && facts.height > 0) {
      meta.w = facts.width;
      meta.h = facts.height;
    }
    if (intent === "video" && facts.durationMs && facts.durationMs > 0) {
      meta.durMs = facts.durationMs;
    }
  } else if (intent === "audio") {
    if (facts.durationMs && facts.durationMs > 0) {
      meta.durMs = facts.durationMs;
      meta.seconds = Math.max(1, Math.floor(facts.durationMs / 1000));
    }
  }

  if (!facts.asDocument && facts.viewOnce) meta.viewOnce = true;
  if (!facts.asDocument && facts.album) meta.album = facts.album;

  return meta;
}

/** `photo_<ms>.jpg`, the name both other clients use for a re-encoded photo. */
/**
 * The key shape the Worker accepts (`FILE_KEY_RE` in `src/worker/index.ts`).
 * Contract-tested against that source in `test/cases/57-web-media-attachments.mjs`.
 */
export const FILE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;

/** A key that can never be a path-escape, whatever the server sent us. */
export function isUsableFileKey(fileKey: string): boolean {
  const key = fileKey.trim();
  if (!FILE_KEY_RE.test(key)) return false;
  return !key.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * The download path for a file key.
 *
 * Android builds this with `Api.encodePath`: encode every segment, keep the
 * slashes. The Worker `decodeURIComponent`s whatever follows `/api/files/`, so
 * both `f/x.jpg` and `f%2Fx.jpg` resolve — but the API client's path guard
 * refuses encoded slashes, because `%2f` is exactly how a path escape is
 * smuggled past a validator. Encoding the whole key therefore made every
 * received photo, clip and document fail with `invalid-request` before a
 * request was even sent. Segment-wise encoding keeps the guard strict and the
 * download working.
 */
export function fileGetPath(fileKey: string): string {
  const key = fileKey.trim();
  if (!isUsableFileKey(key)) {
    throw new Error("That file key cannot be requested.");
  }
  const segments = key.split("/").map((segment) => encodeURIComponent(segment));
  return `/api/files/${segments.join("/")}`;
}

export function photoFileName(now = Date.now()): string {
  return `photo_${now}.jpg`;
}

/** One album id shared by every photo in a single multi-pick send. */
export function albumId(now = Date.now()): string {
  return `album_${now}`;
}

/**
 * Whether a message row is an attachment at all. The Worker only accepts
 * TEXT / STICKER / IMAGE / FILE kinds, and every attachment the phone sends is
 * a FILE row with a fileKey — IMAGE rows are the older `mediaUrl` shape.
 */
export function isAttachmentKind(kind: string): boolean {
  return kind === "FILE" || kind === "IMAGE";
}

/** The category a row belongs to, matching the Worker's preview buckets. */
export function attachmentCategory(fileType: string, meta: Record<string, unknown>): string {
  const type = (fileType || "").toLowerCase();
  if (meta.voice === true) return "voice";
  if (meta.document === true) return "document";
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}
