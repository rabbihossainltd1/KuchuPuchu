/**
 * Shared media — "Media, links, and docs".
 *
 * Read out of two sources, nothing invented:
 *
 *   GET /api/conversations/:id/media → { images, videos, docs, links }
 *
 * The Worker builds those four lists itself (newest-first, `LIMIT 400`, the
 * delete-for-me watermark already applied, view-once rows excluded, `403
 * PRIVATE_GROUP` for a private group and `403 REQUEST_PENDING` until a message
 * request is accepted), so the client's job is to parse and present — not to
 * re-classify. There is **no cursor**: one payload, one shot.
 *
 * `ChatMediaScreen.kt` decides the shape of the surface: three tabs
 * (Media / Docs / Links), the Media tab being `images + videos` merged and
 * sorted newest-first (owner round 33, item 20), and a panel that must agree
 * with the chat — anything whose owning message is gone from the transcript is
 * dropped here too (r55, owner item 8).
 */

import { parseMessageRow, type MessageRow } from "./protocol";
import { isViewOnce } from "./viewOnce";

export type SharedMedia = {
  readonly images: readonly MessageRow[];
  readonly videos: readonly MessageRow[];
  readonly docs: readonly MessageRow[];
  readonly links: readonly MessageRow[];
};

export const EMPTY_SHARED_MEDIA: SharedMedia = Object.freeze({
  images: [],
  videos: [],
  docs: [],
  links: [],
});

export const SHARED_MEDIA_TITLE = "Media, links, and docs";

/** The phone's three tabs, in order. */
export const SHARED_MEDIA_TABS = Object.freeze(["Media", "Docs", "Links"] as const);

export type SharedMediaTab = (typeof SHARED_MEDIA_TABS)[number];

/** Android's empty states, word for word. */
export const SHARED_MEDIA_EMPTY: Readonly<Record<SharedMediaTab, { title: string; body: string }>> =
  Object.freeze({
    Media: Object.freeze({
      title: "No media",
      body: "Photos and videos sent in this chat show up here",
    }),
    Docs: Object.freeze({ title: "No documents yet.", body: "" }),
    Links: Object.freeze({ title: "No links yet.", body: "" }),
  });

/** What the two 403s mean to a reader, in the Worker's own terms. */
export const SHARED_MEDIA_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  PRIVATE_GROUP: "This group is private, so it has no shared-media gallery.",
  REQUEST_PENDING: "Accept the message request first.",
  FORBIDDEN: "This gallery is not available to you.",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseList(value: unknown): readonly MessageRow[] {
  if (!Array.isArray(value)) return [];
  const out: MessageRow[] = [];
  for (const item of value) {
    const row = parseMessageRow(item);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Parse the payload. A view-once row is dropped even if the server ever sent
 * one: the Worker excludes them, and a gallery that could reach a spent opening
 * would be a hole, not a feature.
 */
export function parseSharedMedia(payload: unknown): SharedMedia {
  if (!isRecord(payload)) return EMPTY_SHARED_MEDIA;
  const keep = (rows: readonly MessageRow[]) => rows.filter((row) => !isViewOnce(row));
  return {
    images: keep(parseList(payload.images)),
    videos: keep(parseList(payload.videos)),
    docs: keep(parseList(payload.docs)),
    links: keep(parseList(payload.links)),
  };
}

/** Newest-first by `createdAt`, with `rowid` as the tiebreak — the transcript's own order. */
function byNewest(rows: readonly MessageRow[]): MessageRow[] {
  return [...rows].sort((left, right) => {
    const at = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (at !== 0) return at;
    return right.rowid - left.rowid;
  });
}

/**
 * The Media tab: photos and videos together, newest first (owner round 33,
 * item 20 — the server already lists each newest-first, but two lists merged
 * have to be sorted again).
 */
export function mediaGrid(media: SharedMedia): readonly MessageRow[] {
  return byNewest([...media.images, ...media.videos]);
}

export function docsList(media: SharedMedia): readonly MessageRow[] {
  return byNewest(media.docs);
}

export function linksList(media: SharedMedia): readonly MessageRow[] {
  return byNewest(media.links);
}

export function rowsForTab(media: SharedMedia, tab: SharedMediaTab): readonly MessageRow[] {
  if (tab === "Media") return mediaGrid(media);
  if (tab === "Docs") return docsList(media);
  return linksList(media);
}

export function sharedMediaCount(media: SharedMedia): number {
  return media.images.length + media.videos.length + media.docs.length + media.links.length;
}

/**
 * Drop anything whose owning message has left the transcript — deleted for
 * everyone, or a spent view-once that vanished. The panel must agree with the
 * chat; a thumbnail for a row the reader can no longer see is a leak of the
 * wrong kind (r55, owner item 8).
 */
export function visibleMedia(media: SharedMedia, goneIds: ReadonlySet<string>): SharedMedia {
  if (goneIds.size === 0) return media;
  const keep = (rows: readonly MessageRow[]) => rows.filter((row) => !goneIds.has(row.id));
  return {
    images: keep(media.images),
    videos: keep(media.videos),
    docs: keep(media.docs),
    links: keep(media.links),
  };
}

/** The Worker's own link pattern: `/https?:\/\/[^\s]+/gi`. */
const URL_PATTERN = /https?:\/\/[^\s]+/gi;

/** The first link in a body, or "" — what the Links tab shows as its row text. */
export function firstLink(body: string): string {
  URL_PATTERN.lastIndex = 0;
  const found = URL_PATTERN.exec(body);
  URL_PATTERN.lastIndex = 0;
  return found ? found[0] : "";
}

/** A document row reads as its file name, falling back to "File" like the phone. */
export function docLabel(message: MessageRow): string {
  return message.fileName || "File";
}

/** The refusal copy for an `ApiError`, falling back to a plain statement. */
export function sharedMediaRefusal(code: string, fallback: string): string {
  return SHARED_MEDIA_REFUSALS[code] ?? fallback;
}
