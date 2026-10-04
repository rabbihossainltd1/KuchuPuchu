/**
 * Document preview: what a file is, and what a browser may honestly do with it.
 *
 * The classification is ported from `DocViewerScreen.kt` — `mimeFor`,
 * `displaySize`, `docKind` and `docPreviewKind`, extension lists and magic-byte
 * sniffs included — because a document that opens as a wall of mojibake on one
 * client and as text on the other is two different products.
 *
 * What is NOT ported is the renderers themselves, and every one of those
 * decisions is stated in the UI rather than hidden:
 *
 *   • PDF → the browser's own viewer (an `<iframe>` on a blob URL). The phone
 *     rasterises pages with `PdfRenderer`; a browser already has a better one.
 *   • text / code → selectable monospace, first 400 000 bytes, exactly the
 *     phone's cap and its truncation line.
 *   • HTML, XHTML and SVG → SOURCE ONLY, never rendered. The Worker's
 *     `SAFE_MEDIA_TYPES` exists so this API origin cannot hand back executable
 *     markup; rendering a stranger's HTML inside the app's own origin would
 *     undo that from the client side. The phone renders it in an offline
 *     WebView with scripts, network and file access switched off — a sandbox a
 *     browser tab does not have.
 *   • Markdown → source only, for the same reason (the phone renders it through
 *     `MarkdownLite`). Listed as a gap, not passed off as parity.
 *   • TIFF → no browser codec exists. The phone ships its own `TiffDecoder`.
 *   • ZIP / RAR → the phone lists the archive's contents; a browser has no
 *     built-in reader, so this is download-only.
 *   • anything else (DOC/DOCX/XLSX/PPTX …) → the phone's card: extension badge,
 *     name, type and size, with the way through being a download.
 *
 * Deliberately free of DOM and React so a contract case can pin every list
 * against the Kotlin source.
 */

/** The phone reads the first 400 000 bytes of a text document. `TextDoc`. */
export const TEXT_PREVIEW_MAX_BYTES = 400_000;

export type DocKind =
  "pdf" | "svg" | "tiff" | "image" | "archive" | "text" | "video" | "audio" | "other";

export type PreviewKind = "html" | "markdown" | null;

/** The lower-case extension, "" when the name has none. */
export function docExtension(name: string): string {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

/**
 * `FilesUtil.mimeFor`: a picker often hands back `application/octet-stream` (or
 * nothing), and with that most viewers refuse the file. The declared type wins
 * unless it is one of the two generic ones; otherwise the extension decides.
 */
export function mimeFor(name: string, declared: string): string {
  const given = String(declared || "").trim();
  const lowerGiven = given.toLowerCase();
  if (given && lowerGiven !== "application/octet-stream" && lowerGiven !== "application/binary") {
    return given;
  }
  switch (docExtension(name)) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt":
    case "log":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "zip":
      return "application/zip";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "aac":
      return "audio/mp4";
    case "wav":
      return "audio/x-wav";
    case "ogg":
      return "audio/ogg";
    case "mp4":
    case "mov":
      return "video/mp4";
    case "mkv":
      return "video/x-matroska";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return given || "*/*";
  }
}

/**
 * `FilesUtil.displaySize`. Note it never says GB: a 2 GB clip reads "2048.0 MB"
 * on the phone. The web composer's own `formatBytes` does say GB, and the two
 * agree everywhere below a gigabyte — the contract case pins that reading of
 * both instead of quietly rounding the difference away.
 */
export function displaySize(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, Math.trunc(bytes)) : 0;
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.trunc(size / 1024)} KB`;
  return `${size} B`;
}

/** `docPreviewKind`: files that have a rendered preview besides their source. */
export function docPreviewKind(name: string, mime: string): PreviewKind {
  const ext = docExtension(name);
  const type = String(mime || "").toLowerCase();
  if (
    ext === "html" ||
    ext === "htm" ||
    ext === "xhtml" ||
    type === "text/html" ||
    type === "application/xhtml+xml"
  ) {
    return "html";
  }
  if (ext === "md" || ext === "markdown" || ext === "mdown" || type === "text/markdown") {
    return "markdown";
  }
  return null;
}

/** `docKind`'s text/code extension set. */
export const TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "kt",
  "js",
  "ts",
  "py",
  "html",
  "css",
  "xml",
  "yml",
  "yaml",
  "ini",
  "sh",
  "java",
  "c",
  "cpp",
  "h",
  "sql",
  "srt",
  "vtt",
]);

/** `docKind`'s image extension set. */
export const IMAGE_EXTENSIONS: readonly string[] = Object.freeze([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "heic",
  "heif",
]);

/**
 * The ZIP-looking extensions that are NOT archives to the phone: they are
 * containers for something else, and listing their entries as "the contents of
 * your document" would be nonsense.
 */
export const ZIP_SHAPED_NOT_ARCHIVES: readonly string[] = Object.freeze([
  "docx",
  "xlsx",
  "pptx",
  "apk",
  "jar",
  "odt",
  "ods",
  "odp",
  "epub",
]);

export const ARCHIVE_EXTENSIONS: readonly string[] = Object.freeze(["zip", "rar"]);

/** `ArchiveList.looksZip`: the three local-file/central-directory signatures. */
export function looksZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

/** `ArchiveList.looksRar`: RAR 4 and RAR 5 both start `Rar!\x1a\x07`. */
export function looksRar(bytes: Uint8Array): boolean {
  if (bytes.length < 7) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21 &&
    bytes[4] === 0x1a &&
    bytes[5] === 0x07 &&
    (bytes[6] === 0x00 || bytes[6] === 0x01)
  );
}

/** `TiffDecoder.looksTiff`: both byte orders, both magic numbers. */
export function looksTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  return little || big;
}

/**
 * `docKind`, branch for branch and in the same order — the order matters,
 * because `.html` is both a preview kind and a text kind, and an `.svg` is both
 * an image and markup that must not be drawn.
 *
 * Two kinds the phone folds into OTHER are named here: a clip or an audio file
 * that was sent AS A DOCUMENT has no in-app player on the phone (its card's
 * "Open with" hands it to the system), while a browser can play it directly.
 */
export function docKindFor(name: string, mime: string, bytes?: Uint8Array | null): DocKind {
  const ext = docExtension(name);
  const type = String(mime || "").toLowerCase();
  const head = bytes ?? new Uint8Array(0);

  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "svg" || type === "image/svg+xml") return "svg";
  if (ext === "tif" || ext === "tiff" || type === "image/tiff" || looksTiff(head)) return "tiff";
  if (type.startsWith("image/") || (IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return "image";
  }
  if (looksZip(head) && !(ZIP_SHAPED_NOT_ARCHIVES as readonly string[]).includes(ext)) {
    return "archive";
  }
  if ((ARCHIVE_EXTENSIONS as readonly string[]).includes(ext) || looksRar(head)) return "archive";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    (TEXT_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return "text";
  }
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * What the reader is told, per kind. Every line states what THIS browser does
 * and, where it differs, what the phone does — a gap that is described is a
 * gap a person can plan around; a gap that is hidden is a bug they will report.
 */
export function docNotice(kind: DocKind, preview: PreviewKind): string {
  if (preview === "html") {
    return "HTML is shown as source and is never rendered here. This app's origin will not execute markup another person uploaded — the phone renders it in an offline WebView with scripts, network and file access switched off, a sandbox a browser tab does not have.";
  }
  if (preview === "markdown") {
    return "Markdown is shown as source. The phone renders a preview of it; a browser tab has no offline sandbox to render stranger-supplied markup in, so this client does not guess at one.";
  }
  switch (kind) {
    case "pdf":
      return "Rendered by your browser's own PDF viewer.";
    case "svg":
      return "SVG is shown as source and is never drawn: an SVG can carry scripts, and the phone's offline WebView is the only sandbox this project trusts with it.";
    case "tiff":
      return "No browser can decode a TIFF. The phone ships its own decoder; here, download it or open it on your phone.";
    case "archive":
      return "The phone lists an archive's contents. A browser has no built-in archive reader, so this one is download-only.";
    case "text":
      return `Plain text, selectable, first ${Math.round(TEXT_PREVIEW_MAX_BYTES / 1000)} KB of it.`;
    case "video":
    case "audio":
      return "Sent as a document, played here by your browser. The phone hands a file like this to its system player.";
    case "image":
      return "";
    default:
      return "No renderer for this type lives in a browser. Download it, or open it with an app on your device — the phone shows the same card and calls it 'Open with'.";
  }
}

/** The phone's truncation line, appended to a preview that was cut short. */
export function truncatedNotice(totalBytes: number): string {
  return `\n\n… (${displaySize(totalBytes)} in total)`;
}

/** What an empty text file reads as on the phone. */
export const EMPTY_TEXT_PREVIEW = "(empty file)";

/**
 * Decode the first `TEXT_PREVIEW_MAX_BYTES` bytes as UTF-8. The cap is applied
 * to BYTES before decoding, as `TextDoc` applies it, so a document of nothing
 * but four-byte emoji cannot sneak in four times the budget.
 */
export function decodePreviewText(bytes: Uint8Array): { text: string; truncated: boolean } {
  const total = bytes.byteLength;
  const head = total > TEXT_PREVIEW_MAX_BYTES ? bytes.slice(0, TEXT_PREVIEW_MAX_BYTES) : bytes;
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  } catch {
    text = "";
  }
  return {
    text: text.length > 0 ? text : EMPTY_TEXT_PREVIEW,
    truncated: total > head.byteLength,
  };
}

/** The card's badge: the extension in capitals when it is short enough. */
export function docBadge(name: string): string {
  const ext = docExtension(name).toUpperCase();
  return ext && ext.length <= 5 ? ext : "";
}

/** The card's second line: type · size, dropping a generic type as the phone does. */
export function docFacts(mime: string, size: number): string {
  const type = mime && mime !== "application/octet-stream" ? mime : "";
  const shown = size > 0 ? displaySize(size) : "";
  return [type, shown].filter((part) => part.length > 0).join(" · ");
}

/** Whether the browser is likely to have its own PDF viewer for the iframe. */
export function browserRendersPdf(): boolean {
  if (typeof navigator === "undefined") return false;
  // Chrome, Edge, Firefox and Safari all ship one; the plugin list is empty in
  // a locked-down frame, and there the notice says the download is the way.
  const plugins = navigator.pdfViewerEnabled;
  return plugins === true;
}
