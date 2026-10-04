/**
 * Composer-side attachment state: what a picked file becomes before it is sent.
 *
 * The rules here mirror the two clients that already work. A photo is shrunk to
 * a 2048 long edge and re-encoded as JPEG (what `public/app.js` and the phone
 * both do), a clip or an audio file is probed for its box and duration so the
 * row carries `meta.w` / `meta.h` / `meta.durMs` from frame one, and anything
 * over its ceiling is refused in the composer instead of after a long upload.
 *
 * Attachment sends are NOT part of the durable outbox: a Blob cannot be
 * resurrected from IndexedDB after a reload in every browser, so an unsent
 * attachment lives in the composer and a failed upload offers a retry. The copy
 * says so rather than implying the file is queued.
 */

import { EMPTY_EDIT, type EditModel, editIsEmpty } from "../media/imageEdit";
import { measureImage, probeMedia, shrinkPhoto } from "../media/renderEdits";
import {
  classifyAttachment,
  describeLimit,
  formatBytes,
  mediaLimitFor,
  safeMediaType,
  buildAttachmentMeta,
  photoFileName,
  type AttachmentIntent,
} from "../media/uploadContract";
import type { UploadProgress } from "./filesApi";

export type AttachmentState = "ready" | "uploading" | "failed";

export type PendingAttachment = {
  readonly id: string;
  readonly intent: AttachmentIntent;
  /** What the row will call the file: `photo_<ms>.jpg` for a re-encoded photo. */
  readonly name: string;
  /** The name the user picked, kept for the document row's label. */
  readonly pickedName: string;
  /** The type the Worker will store, after its own allowlist. */
  readonly type: string;
  /** The bytes that will be uploaded — an edited/shrunk JPEG for photos. */
  readonly blob: Blob;
  readonly size: number;
  readonly previewUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly edit: EditModel;
  readonly asDocument: boolean;
  /**
   * "View once": the reader opens it a single time and then it is gone for both
   * sides. Only a photo or a clip can carry it — the Worker refuses the flag on
   * a document and on an audio file that is not a voice note.
   */
  readonly viewOnce: boolean;
  readonly state: AttachmentState;
  readonly error: string;
  readonly progress: UploadProgress | null;
};

export type AttachmentRejection = {
  readonly name: string;
  readonly reason: string;
};

export type PrepareResult = {
  readonly items: readonly PendingAttachment[];
  readonly rejected: readonly AttachmentRejection[];
};

/** The phone caps a gallery send; a browser tab can hand over thousands. */
export const MAX_ATTACHMENTS_PER_SEND = 20;

let counter = 0;

/** A local id for a composer attachment. Not a message clientId. */
export function nextAttachmentId(
  random: () => string = () => Math.random().toString(36).slice(2),
): string {
  counter += 1;
  return `att_${counter}_${random()}`;
}

export function isImageIntent(intent: AttachmentIntent): boolean {
  return intent === "photo";
}

/** The object URL, if this attachment has one worth showing. */
function previewFor(intent: AttachmentIntent, blob: Blob): string | null {
  if (intent !== "photo" && intent !== "video") return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function revokeAttachment(item: PendingAttachment): void {
  if (item.previewUrl && typeof URL?.revokeObjectURL === "function") {
    URL.revokeObjectURL(item.previewUrl);
  }
}

export function revokeAttachments(items: readonly PendingAttachment[]): void {
  items.forEach(revokeAttachment);
}

export type PrepareOptions = {
  /** "Send as document" from the picker: keeps the file's own bytes and name. */
  asDocument?: boolean;
  /** "View once" from the picker. Mutually exclusive with `asDocument`. */
  viewOnce?: boolean;
  /** How many attachments the composer already holds. */
  alreadyQueued?: number;
  random?: () => string;
};

/**
 * Turn picked files into composer attachments, refusing what cannot be sent.
 *
 * Every refusal carries a reason the UI shows verbatim: an over-limit file, an
 * undecodable image, an empty file, or simply too many at once.
 */
export async function prepareAttachments(
  files: readonly File[],
  options: PrepareOptions = {},
): Promise<PrepareResult> {
  const items: PendingAttachment[] = [];
  const rejected: AttachmentRejection[] = [];
  const room = Math.max(0, MAX_ATTACHMENTS_PER_SEND - (options.alreadyQueued ?? 0));

  for (const file of files) {
    if (items.length >= room) {
      rejected.push({
        name: file.name || "file",
        reason: `Up to ${MAX_ATTACHMENTS_PER_SEND} files can be attached at once.`,
      });
      continue;
    }
    if (!file || file.size <= 0) {
      rejected.push({ name: file?.name || "file", reason: "That file is empty." });
      continue;
    }

    const asDocument = options.asDocument === true;
    const intent: AttachmentIntent = asDocument
      ? "document"
      : classifyAttachment(file.type || "", file.name || "");
    // The Worker's own gate (`viewOnceFlag`): a document never is, and neither
    // is an audio file that is not a voice note. Offering the flag where the
    // server would drop it would be a toggle that lies.
    const viewOnce =
      options.viewOnce === true && !asDocument && (intent === "photo" || intent === "video");
    const type = safeMediaType(file.type || "");
    const limit = mediaLimitFor(type, file.name || "");
    if (file.size > limit) {
      rejected.push({
        name: file.name || "file",
        reason: `${describeLimit(limit)} is the most this kind of file can be; that one is ${formatBytes(file.size)}.`,
      });
      continue;
    }

    const base = {
      id: nextAttachmentId(options.random),
      intent,
      pickedName: file.name || "file",
      type,
      asDocument,
      viewOnce,
      edit: EMPTY_EDIT,
      state: "ready" as AttachmentState,
      error: "",
      progress: null,
    };

    if (intent === "photo") {
      // Shrink first, exactly like the other clients: it keeps a 108 MP camera
      // JPEG inside the single-request upload path, and the editor then works
      // on the bytes that will actually be sent.
      let rendered;
      try {
        rendered = await shrinkPhoto(file);
      } catch {
        rejected.push({
          name: file.name || "file",
          reason: "That image could not be read. Try a JPEG, PNG, WebP or GIF.",
        });
        continue;
      }
      if (!rendered.width || !rendered.height) {
        rejected.push({ name: file.name || "file", reason: "That image has no pixels." });
        continue;
      }
      const blob = rendered.blob;
      items.push({
        ...base,
        name: rendered.scaled ? photoFileName() : file.name || photoFileName(),
        type: rendered.scaled ? "image/jpeg" : type,
        blob,
        size: blob.size,
        width: rendered.width,
        height: rendered.height,
        durationMs: 0,
        previewUrl: previewFor("photo", blob),
      });
      continue;
    }

    let width = 0;
    let height = 0;
    let durationMs = 0;
    if (intent === "video" || intent === "audio") {
      // A probe failure is not a refusal: the file still sends, it just carries
      // no measured box, and the receiver's client measures it on arrival.
      const facts = await probeMedia(file).catch(() => null);
      if (facts) {
        width = facts.width;
        height = facts.height;
        durationMs = facts.durationMs;
      }
    }

    items.push({
      ...base,
      name: file.name || "file",
      blob: file,
      size: file.size,
      width,
      height,
      durationMs,
      previewUrl: previewFor(intent, file),
    });
  }

  return { items, rejected };
}

/**
 * Replace an attachment's bytes with an edited render. The composer keeps the
 * object URL alive for the old blob's preview, so it is revoked here.
 */
export function applyRenderedEdit(
  item: PendingAttachment,
  rendered: { blob: Blob; width: number; height: number },
  edit: EditModel,
): PendingAttachment {
  if (item.previewUrl && typeof URL?.revokeObjectURL === "function") {
    URL.revokeObjectURL(item.previewUrl);
  }
  return {
    ...item,
    blob: rendered.blob,
    size: rendered.blob.size,
    width: rendered.width,
    height: rendered.height,
    edit,
    type: "image/jpeg",
    name: photoFileName(),
    previewUrl: previewFor("photo", rendered.blob),
  };
}

/** Discard an edit and go back to the bytes as picked. */
export function clearEdit(
  item: PendingAttachment,
  original: Blob,
  width: number,
  height: number,
): PendingAttachment {
  if (item.previewUrl && typeof URL?.revokeObjectURL === "function") {
    URL.revokeObjectURL(item.previewUrl);
  }
  return {
    ...item,
    blob: original,
    size: original.size,
    width,
    height,
    edit: EMPTY_EDIT,
    previewUrl: previewFor(item.intent, original),
  };
}

export function withState(
  item: PendingAttachment,
  patch: Partial<Pick<PendingAttachment, "state" | "error" | "progress">>,
): PendingAttachment {
  return { ...item, ...patch };
}

/** The `meta` object this attachment's message row will carry. */
export function attachmentMeta(item: PendingAttachment, album?: string): Record<string, unknown> {
  return buildAttachmentMeta(item.intent, {
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    asDocument: item.asDocument,
    viewOnce: item.viewOnce,
    ...(album ? { album } : {}),
  });
}

export function hasEdits(item: PendingAttachment): boolean {
  return !editIsEmpty(item.edit);
}

/** Accessible label for a composer chip or a transcript row. */
export function describeAttachment(item: PendingAttachment): string {
  // "view once" is part of the description, not a decoration: the reader has to
  // be able to hear what they are about to send before they send it.
  const once = item.viewOnce ? ", view once" : "";
  if (item.intent === "photo") {
    return `Photo ${item.pickedName}, ${item.width} by ${item.height} pixels, ${formatBytes(item.size)}${once}`;
  }
  if (item.intent === "video") {
    const seconds = Math.round(item.durationMs / 1000);
    return `Video ${item.pickedName}, ${formatBytes(item.size)}${seconds ? `, ${seconds} seconds` : ""}${once}`;
  }
  if (item.intent === "audio") {
    const seconds = Math.round(item.durationMs / 1000);
    return `Audio ${item.pickedName}, ${formatBytes(item.size)}${seconds ? `, ${seconds} seconds` : ""}`;
  }
  return `Document ${item.pickedName}, ${formatBytes(item.size)}`;
}

/** Whole seconds for an audio row's duration line, minimum 1 like the phone. */
export function audioSeconds(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.max(1, Math.floor(durationMs / 1000));
}
