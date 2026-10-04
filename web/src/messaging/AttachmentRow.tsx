/**
 * How an attachment message renders in the transcript.
 *
 * The bytes are fetched (Bearer-gated) and shown inline — a photo thumbnail, a
 * native video or audio player, a document row with a real download — and every
 * photo or clip is a door into the full-screen viewer (`onOpen`).
 *
 * View once is handled here because getting it wrong is expensive:
 *
 *   • A spent row (`viewOnce` + `viewedAt`) advertises no bytes at all, and says
 *     so instead of showing a broken frame.
 *   • A view-once PHOTO shows the real pixels blurred past recognition, exactly
 *     like the phone: `/api/files/:key` serves them without spending the
 *     opening, and the reader's tap is what opens it.
 *   • A view-once CLIP or voice note shows a locked tile and fetches NOTHING —
 *     "a view-once clip the recipient has not opened has no bytes to show"
 *     (v163). A hardcoded thumbnail would be a fake.
 *   • An inline IMAGE row is served by `/api/messages/:id/media`, where the
 *     fetch itself spends the opening, so it is deferred behind the same tap.
 *
 * Still not here, and still saying so: voice-note recording, and the
 * PDF/document previewer.
 */

import { useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { attachmentCategory, formatBytes } from "../media/uploadContract";
import { mediaSourceKey, useMediaUrl, useMediaUrls } from "./mediaUrl";
import type { MessageRow } from "./protocol";
import { isViewOnce, openingCostsFetch, viewOnceSpent } from "./viewOnce";

export type AttachmentRowProps = {
  message: MessageRow;
  /** Null when there is no session, so nothing is fetched at all. */
  api: ApiClient | null;
  /**
   * The display body: a sticker's glyph, or an attachment's caption. Already
   * decrypted by the controller — a sealed envelope is never rendered.
   */
  body: string;
  /** True when the body is an envelope this device could not open. */
  locked?: boolean;
  /** Opens the full-screen viewer on this row (photos and clips). */
  onOpen?: (message: MessageRow) => void;
};

function MediaFigure({
  message,
  api,
  category,
  onOpen,
}: {
  message: MessageRow;
  api: ApiClient | null;
  category: string;
  onOpen?: (message: MessageRow) => void;
}) {
  const once = isViewOnce(message);
  const spent = viewOnceSpent(message);
  // Only a view-once PHOTO may load its bytes here (blurred, and free of charge
  // from /api/files). Everything else that is view-once waits for the reader.
  const deferBytes = once && (openingCostsFetch(message) || category !== "photo");
  const [asked, setAsked] = useState(false);
  const media = useMediaUrl(api, api !== null && (!deferBytes || asked), mediaSourceKey(message));
  const label = message.fileName || (category === "photo" ? "Photo" : "Attachment");

  if (spent) {
    return (
      <p className="attachment__once">
        <Icon name="lock" size={14} /> View-once {category} — already opened, the bytes are gone.
      </p>
    );
  }

  if (once && (deferBytes || category !== "photo") && !asked) {
    return (
      <span className="attachment__once-card">
        <Icon name="lock" size={18} />
        <strong>View once {category}</strong>
        <span>Opens once, then it is gone for both of you.</span>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setAsked(true);
            onOpen?.(message);
          }}
        >
          Open it now
        </button>
      </span>
    );
  }

  if (media.status === "loading") {
    return (
      <p className="attachment__pending" role="status">
        Loading {label}…
      </p>
    );
  }

  if (media.status === "error" || !media.url) {
    return (
      <p className="attachment__error" role="alert">
        {label} could not be downloaded on this device.
      </p>
    );
  }

  if (category === "photo") {
    const image = (
      <img
        className={`attachment__image${once ? " attachment__image--once" : ""}`}
        src={media.url}
        alt={`Photo ${label}${
          message.mediaWidth && message.mediaHeight
            ? `, ${message.mediaWidth} by ${message.mediaHeight} pixels`
            : ""
        }${once ? ", blurred until you open it" : ""}`}
        width={message.mediaWidth || undefined}
        height={message.mediaHeight || undefined}
        loading="lazy"
        decoding="async"
      />
    );

    if (once) {
      return (
        <span className="attachment__figure attachment__figure--once">
          {image}
          <button type="button" className="attachment__once-open" onClick={() => onOpen?.(message)}>
            <Icon name="lock" size={14} /> View once — open
          </button>
        </span>
      );
    }

    if (onOpen) {
      return (
        <button
          type="button"
          className="attachment__figure attachment__expand"
          onClick={() => onOpen(message)}
          aria-label={`Open ${label} full screen`}
        >
          {image}
        </button>
      );
    }

    return image;
  }

  if (category === "video") {
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a clip from a
            phone rarely carries a track, and muting it would hide the audio. */}
        <video className="attachment__video" src={media.url} controls preload="metadata" />
        {onOpen ? (
          <button type="button" className="text-button" onClick={() => onOpen(message)}>
            Open full screen
          </button>
        ) : null}
      </>
    );
  }

  if (category === "audio") {
    return (
      <>
        <audio className="attachment__audio" src={media.url} controls preload="metadata" />
        <p className="attachment__note">
          Audio file playback. Voice-note recording and the voice UI arrive in a later slice.
        </p>
      </>
    );
  }

  return null;
}

export function AttachmentRow({ message, api, body, locked, onOpen }: AttachmentRowProps) {
  const meta = (message.meta ?? {}) as Record<string, unknown>;
  const category = attachmentCategory(message.fileType, meta);
  const caption = locked ? "" : body;

  if (message.kind === "STICKER") {
    // Android draws a sticker with no bubble at all; the glyph is the message.
    if (locked) {
      return (
        <span className="sticker-message sticker-message--locked">
          <Icon name="lock" size={14} /> Encrypted sticker — this device cannot open it.
        </span>
      );
    }
    return (
      <span className="sticker-message" role="img" aria-label={`Sticker ${body}`}>
        {body}
      </span>
    );
  }

  const seconds =
    typeof meta.seconds === "number"
      ? meta.seconds
      : message.fileType.startsWith("audio/") && Number(meta.durMs) > 0
        ? Math.max(1, Math.floor(Number(meta.durMs) / 1000))
        : 0;
  const durationLabel =
    Number(meta.durMs) > 0
      ? `${Math.floor(Number(meta.durMs) / 60000)}:${String(
          Math.floor((Number(meta.durMs) % 60000) / 1000),
        ).padStart(2, "0")}`
      : "";

  if (category === "document") {
    return (
      <span className="attachment attachment--document">
        <span className="attachment__doc-icon" aria-hidden="true">
          <Icon name="message" size={18} />
        </span>
        <span className="attachment__doc-copy">
          <strong className="attachment__name">{message.fileName || "Document"}</strong>
          <span className="attachment__facts">
            {formatBytes(message.fileSize)}
            {message.fileType ? ` · ${message.fileType}` : ""}
            {seconds ? ` · ${seconds}s` : ""}
          </span>
        </span>
        <DownloadLink message={message} api={api} />
        <span className="attachment__note">
          Document preview arrives in a later slice; downloading works now.
        </span>
      </span>
    );
  }

  return (
    <span className={`attachment attachment--${category}`}>
      <MediaFigure message={message} api={api} category={category} onOpen={onOpen} />
      {category === "photo" && durationLabel ? (
        <span className="attachment__badge">{durationLabel}</span>
      ) : null}
      {category === "photo" && message.viewOnce && !message.viewedAt ? (
        <span className="attachment__badge">
          <Icon name="lock" size={12} /> View once
        </span>
      ) : null}
      {caption ? <span className="attachment__caption">{caption}</span> : null}
    </span>
  );
}

function DownloadLink({ message, api }: { message: MessageRow; api: ApiClient | null }) {
  const media = useMediaUrl(api, api !== null, message.localPreview || message.fileKey);
  if (!media.url) {
    return (
      <span className="attachment__download is-pending" role="status">
        Preparing download…
      </span>
    );
  }
  return (
    <a className="attachment__download" href={media.url} download={message.fileName || "file"}>
      Download
    </a>
  );
}

/**
 * A folded album: every photo that shares `meta.album` and a sender, drawn as
 * one bubble (Android's `foldAlbums` + `kpAlbum`). Opening any thumb opens the
 * viewer on the whole group, so the reader can swipe between them — which is
 * what the album id was sent for in the first place.
 */
export function AlbumGrid({
  rows,
  api,
  onOpen,
}: {
  rows: readonly MessageRow[];
  api: ApiClient | null;
  /** The clicked photo, and the album it belongs to, so the viewer can page. */
  onOpen: (message: MessageRow, album: readonly MessageRow[]) => void;
}) {
  const urls = useMediaUrls(api, rows);
  return (
    <span className="album-grid" role="group" aria-label={`${rows.length} photos sent together`}>
      {rows.map((row) => {
        const media = urls[row.id];
        const label = row.fileName || "Photo";
        return (
          <button
            key={row.id}
            type="button"
            className="album-grid__cell"
            onClick={() => onOpen(row, rows)}
            aria-label={`Open ${label} full screen`}
          >
            {media?.url ? (
              <img className="album-grid__thumb" src={media.url} alt="" aria-hidden="true" />
            ) : (
              <span className="album-grid__pending" aria-hidden="true">
                <Icon name="message" size={16} />
              </span>
            )}
          </button>
        );
      })}
    </span>
  );
}
