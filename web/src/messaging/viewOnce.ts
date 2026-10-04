/**
 * View once — the one-opening rule, read out of the Worker and the phone.
 *
 * Three facts drive everything here, and they are easy to get wrong:
 *
 *  1. `meta.viewOnce` marks the row. Once the opening has happened the Worker
 *     sets `meta.viewedAt`/`viewedBy` **and stops advertising the media
 *     entirely** — no `mediaUrl`, no `fileKey`, `hasImage` false — so no client
 *     path can reach for bytes that are gone (`msgFrom` in
 *     `src/worker/index.ts`).
 *  2. Which fetch spends the opening depends on the row:
 *       • `kind === "IMAGE"` carries `mediaUrl = /api/messages/:id/media`, and
 *         that route deletes the row, collects the object and broadcasts
 *         VANISHED **on the fetch itself** (audit H3: fetch-free + spend-on-view
 *         let a modified client pull the bytes forever).
 *       • an uploaded photo/clip is `kind === "FILE"` with a `fileKey`, served by
 *         `/api/files/:key`, which does **not** spend. The phone therefore shows
 *         the real pixels blurred behind a lock, and reports the opening with
 *         `POST /api/messages/:id/view` when the picture is actually on screen.
 *     Rendering a transcript must never spend an opening by itself, so the
 *     `IMAGE` path stays deferred until the reader asks for it.
 *  3. `POST /view` answers 404/410 when the row is already gone. Android treats
 *     those as terminal and any other failure as retriable on the next viewing
 *     (`object ViewOnce`), de-duplicated per message id for the process.
 *
 * A TEXT row can be view-once too (r71-20): it arrives veiled, one tap reveals
 * it for five seconds, then it is gone for both sides. There is nothing to
 * fetch, so the reveal timer is the whole mechanism.
 */

import type { MessageRow } from "./protocol";

/** Android: `internal const val ONCE_TEXT_REVEAL_MS = 5_000L`. */
export const ONCE_TEXT_REVEAL_MS = 5_000;

/** How long the countdown repaints while a once-text is revealed. */
export const ONCE_TEXT_TICK_MS = 200;

/**
 * The row leaves after the VANISHED frame. Android plays a dust animation for
 * `DeleteAnim.GRACE_MS`; the web equivalent is a short fade that
 * `prefers-reduced-motion` skips entirely.
 */
export const VANISH_GRACE_MS = 600;

type OnceFields = Pick<
  MessageRow,
  "kind" | "fileType" | "mediaUrl" | "fileKey" | "meta" | "viewOnce" | "viewedAt"
>;

export function isViewOnce(message: OnceFields): boolean {
  return message.viewOnce || message.meta.viewOnce === true;
}

/** The single opening already happened: the bytes are gone server-side. */
export function viewOnceSpent(message: OnceFields): boolean {
  return isViewOnce(message) && message.viewedAt !== "";
}

/** A clip the viewer plays inline (a video sent *as a document* is not one). */
export function fileLooksVideo(message: OnceFields): boolean {
  return (
    message.meta.document !== true &&
    (message.kind === "VIDEO" || message.fileType.startsWith("video/"))
  );
}

/** A voice note: `meta.voice` plus an audio MIME type, exactly as the Worker gates it. */
export function fileLooksVoice(message: OnceFields): boolean {
  return message.meta.voice === true && message.fileType.startsWith("audio/");
}

/**
 * What a *quoted* view-once message reads as — the kind, never a byte of the
 * content (r71-20: a once-text used to fall through to "Photo · View once").
 */
export function onceQuoteLabel(message: OnceFields): string {
  if (isViewOnce(message) && message.kind === "TEXT") return "Message · View once";
  if (fileLooksVideo(message)) return "Video · View once";
  if (fileLooksVoice(message)) return "Voice message · View once";
  return "Photo · View once";
}

export type OnceMediaSource =
  /** `kind === "FILE"`: `/api/files/:key` serves it; the opening is reported separately. */
  | "files"
  /** `kind === "IMAGE"`: fetching `/api/messages/:id/media` *is* the opening. */
  | "message-media"
  | "none";

export function onceMediaSource(message: OnceFields): OnceMediaSource {
  if (viewOnceSpent(message)) return "none";
  if (message.mediaUrl.startsWith("/api/messages/") && message.mediaUrl.endsWith("/media")) {
    return "message-media";
  }
  if (message.fileKey) return "files";
  if (message.mediaUrl) return "message-media";
  return "none";
}

/**
 * True when merely rendering this row would burn the opening. Such a row shows a
 * locked tile and waits for the reader; nothing else in the transcript may fetch
 * its bytes.
 */
export function openingCostsFetch(message: OnceFields): boolean {
  return isViewOnce(message) && onceMediaSource(message) === "message-media";
}

export type ViewOnceSpender = {
  /** Report an opening. De-duplicated per id for the lifetime of the page. */
  spend(messageId: string): void;
  /** Already reported (or reported and settled as gone). */
  isSpent(messageId: string): boolean;
  /** Forget an id — used when a chat is closed and reopened. */
  forget(messageId: string): void;
};

/**
 * The web twin of Android's `object ViewOnce`.
 *
 * `report` is injected so this stays DOM-free and testable: the real caller POSTs
 * `/api/messages/:id/view`. A 404 or 410 means "already gone" and is terminal —
 * the id stays spent, because retrying a deleted row is noise. Any other failure
 * (a real network blip) releases the id so the next viewing reports again.
 */
export function createViewOnceSpender(
  report: (messageId: string) => Promise<unknown>,
  options: { onSettled?: () => void } = {},
): ViewOnceSpender {
  const spent = new Set<string>();

  return {
    spend(messageId: string): void {
      const id = messageId.trim();
      if (!id || spent.has(id)) return;
      spent.add(id);
      void report(id).then(
        () => options.onSettled?.(),
        (error: unknown) => {
          const status =
            typeof error === "object" && error !== null && "status" in error
              ? Number((error as { status?: unknown }).status)
              : 0;
          // 404 / 410: the row is gone for everyone. Terminal, not a blip.
          if (status !== 404 && status !== 410) spent.delete(id);
          options.onSettled?.();
        },
      );
    },
    isSpent(messageId: string): boolean {
      return spent.has(messageId.trim());
    },
    forget(messageId: string): void {
      spent.delete(messageId.trim());
    },
  };
}

/** Milliseconds left on a revealed once-text, clamped to 0..ONCE_TEXT_REVEAL_MS. */
export function onceTextRemaining(openedAt: number, now: number): number {
  const left = ONCE_TEXT_REVEAL_MS - (now - openedAt);
  if (!Number.isFinite(left)) return 0;
  return left < 0 ? 0 : left > ONCE_TEXT_REVEAL_MS ? ONCE_TEXT_REVEAL_MS : Math.round(left);
}

/** The countdown the reader sees, e.g. "View once · 4s left". */
export function onceTextCountdown(leftMs: number): string {
  const seconds = Math.ceil(leftMs / 1000);
  return seconds > 0 ? `${seconds}s left` : "gone";
}
