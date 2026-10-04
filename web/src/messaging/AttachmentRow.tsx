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
 * A voice note (`meta.voice`) gets its own bubble — play / pause, the recorded
 * waveform, the duration and a per-note speed — and a document row is a door
 * into the full-screen reader (`onOpenDoc`).
 *
 * The sender's "Media Save permission" (r71-18) is honoured here too: when they
 * turned it off, their file can be read in this chat but the download link is
 * withheld with the reason, rather than shown and refused.
 */

import { useCallback, useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { attachmentCategory, formatBytes } from "../media/uploadContract";
import { fetchFileBlob } from "./filesApi";
import { mediaSourceKey, useMediaUrl, useMediaUrls } from "./mediaUrl";
import type { MessageRow } from "./protocol";
import { VoiceBubble } from "./VoiceBubble";
import type { VoicePlayer } from "./useVoicePlayer";
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
  /** Opens the full-screen document reader (documents). */
  onOpenDoc?: (message: MessageRow) => void;
  /** The transcript's single voice player; without it a note falls back to <audio>. */
  player?: VoicePlayer;
  /** Whether this row is the signed-in account's own. */
  own?: boolean;
  /** The reader opened a view-once note: its single opening. */
  onOpenedOnce?: (message: MessageRow) => void;
  /** False when the sender turned off saving their media in this chat. */
  canSave?: boolean;
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
          An audio file, played by your browser. Voice notes recorded in KuchuPuchu get their own
          bubble with a waveform and a speed control.
        </p>
      </>
    );
  }

  return null;
}

export function AttachmentRow({
  message,
  api,
  body,
  locked,
  onOpen,
  onOpenDoc,
  player,
  own = false,
  onOpenedOnce,
  canSave = true,
}: AttachmentRowProps) {
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

  if (category === "voice") {
    // The phone's voice branch: one card, whether or not it was recorded here.
    return (
      <span className="attachment attachment--voice">
        {player ? (
          <VoiceBubble
            message={message}
            api={api}
            player={player}
            own={own}
            onOpened={onOpenedOnce}
          />
        ) : (
          <MediaFigure message={message} api={api} category="audio" onOpen={onOpen} />
        )}
        {caption ? <span className="attachment__caption">{caption}</span> : null}
      </span>
    );
  }

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
        {onOpenDoc ? (
          <button
            type="button"
            className="attachment__preview"
            onClick={() => onOpenDoc(message)}
            aria-label={`Open ${message.fileName || "the document"} in the document reader`}
          >
            <Icon name="file" size={16} /> Preview
          </button>
        ) : null}
        {canSave ? (
          <DownloadLink message={message} api={api} />
        ) : (
          <span
            className="attachment__download is-refused"
            title="The sender turned off saving their media in this chat."
          >
            Saving is off in this chat
          </span>
        )}
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

/**
 * The document row's download.
 *
 * It fetches on the CLICK, not on render. `/api/files/:key` is member-checked,
 * so an `<a href>` can never carry the session's Bearer header and the bytes
 * have to be held here to hand the browser a blob URL — and a document row can
 * be gigabytes. Downloading every document in a chat because it scrolled into
 * view is not something the phone does, so this waits to be asked.
 */
function DownloadLink({ message, api }: { message: MessageRow; api: ApiClient | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const source = message.localPreview || message.fileKey;

  const download = useCallback(async () => {
    if (!api || !source || pending) return;
    setPending(true);
    setError("");
    try {
      const blob = source.startsWith("blob:")
        ? await (await fetch(source)).blob()
        : (await fetchFileBlob(api, source)).blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = message.fileName || "file";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Long enough for the browser to have taken the bytes, short enough that
      // a document-sized blob does not live for the rest of the page.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError("That file could not be downloaded right now.");
    } finally {
      setPending(false);
    }
  }, [api, message.fileName, pending, source]);

  return (
    <>
      <button
        type="button"
        className={`attachment__download${pending ? " is-pending" : ""}`}
        onClick={() => void download()}
        disabled={pending || !api || !source}
        aria-busy={pending || undefined}
      >
        {pending ? "Preparing download…" : "Download"}
      </button>
      {error ? (
        <span className="attachment__note" role="alert">
          {error}
        </span>
      ) : null}
    </>
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
