/**
 * How an attachment message renders in the transcript.
 *
 * Scope for this slice: the bytes are fetched (Bearer-gated) and shown inline —
 * a photo thumbnail, a native video or audio player, a document row with a real
 * download. What is deliberately NOT here yet, and says so instead of guessing:
 * the full-screen viewer with pinch/zoom and swipe-between-photos, the shared
 * media tab, view-once reveal flow, voice-note recording and playback, and the
 * PDF/document previewer. Those are slice E.
 */

import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { attachmentCategory, formatBytes } from "../media/uploadContract";
import { useMediaUrl } from "./mediaUrl";
import type { MessageRow } from "./protocol";

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
};

function MediaFigure({
  message,
  api,
  category,
}: {
  message: MessageRow;
  api: ApiClient | null;
  category: string;
}) {
  const media = useMediaUrl(api, api !== null, message.localPreview || message.fileKey);
  const label = message.fileName || (category === "photo" ? "Photo" : "Attachment");

  if (message.viewOnce && message.viewedAt) {
    return (
      <p className="attachment__once">
        <Icon name="lock" size={14} /> View-once {category} — already opened, the bytes are gone.
      </p>
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
    return (
      <img
        className="attachment__image"
        src={media.url}
        alt={`Photo ${label}${
          message.mediaWidth && message.mediaHeight
            ? `, ${message.mediaWidth} by ${message.mediaHeight} pixels`
            : ""
        }`}
        width={message.mediaWidth || undefined}
        height={message.mediaHeight || undefined}
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (category === "video") {
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a clip from a
            phone rarely carries a track, and muting it would hide the audio. */}
        <video className="attachment__video" src={media.url} controls preload="metadata" />
        <p className="attachment__note">
          Inline player only — the full-screen viewer with zoom and swipe arrives in a later slice.
        </p>
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

export function AttachmentRow({ message, api, body, locked }: AttachmentRowProps) {
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
      <MediaFigure message={message} api={api} category={category} />
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
