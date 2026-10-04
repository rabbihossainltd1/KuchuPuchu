/**
 * Documents open inside KuchuPuchu — the browser half of `DocViewerScreen`.
 *
 * The bytes are fetched once with the session's Bearer token (a raw URL can
 * never work: `/api/files/:key` is member-checked), then handed to whichever
 * renderer a browser honestly has:
 *
 *   • PDF          → the browser's own viewer, in an iframe on a blob URL, with
 *                    "open in a new tab" beside it for the engines that refuse
 *                    to draw one inside a frame;
 *   • text / code  → selectable monospace, first 400 000 bytes, the phone's cap
 *                    and the phone's truncation line;
 *   • HTML / SVG / Markdown → SOURCE, never rendered (see `docPreview.ts` for
 *                    why, in words the reader also sees);
 *   • JPEG / PNG / WebP / GIF / BMP → a picture;
 *   • a clip or an audio file sent as a document → the browser's own player;
 *   • TIFF, ZIP / RAR, DOC / DOCX / XLSX / PPTX and everything else → the
 *                    phone's card (extension badge, name, type, size) with the
 *                    download as the way through.
 *
 * The header carries Save (a real download), Forward and Delete, which is the
 * ⋮ sheet the phone puts these in — on a desktop they are labelled buttons,
 * because an unlabeled icon in a menu is not a keyboard-reachable control.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { fetchFileBlob, fetchMessageMediaBlob } from "./filesApi";
import type { MessageRow } from "./protocol";
import { clockTime } from "./protocol";
import {
  EMPTY_TEXT_PREVIEW,
  TEXT_PREVIEW_MAX_BYTES,
  browserRendersPdf,
  decodePreviewText,
  docBadge,
  docFacts,
  docKindFor,
  docNotice,
  docPreviewKind,
  displaySize,
  mimeFor,
  truncatedNotice,
  type DocKind,
} from "./docPreview";

export type DocViewerProps = {
  message: MessageRow;
  api: ApiClient | null;
  own: boolean;
  onClose: () => void;
  /** Withheld unless the row can actually be deleted for everyone. */
  onDelete?: (message: MessageRow) => void;
  /** Withheld for a private chat or a view-once row, exactly as the phone does. */
  onForward?: (message: MessageRow) => void;
  onAnnounce?: (notice: string) => void;
};

type Loaded = {
  url: string;
  bytes: Uint8Array;
  mime: string;
  kind: DocKind;
  text: string;
  truncated: boolean;
};

/** A row's own download route: the file key, or the message media route. */
function docSourceOf(message: MessageRow): { kind: "file" | "message"; value: string } | null {
  if (message.fileKey) return { kind: "file", value: message.fileKey };
  if (message.mediaUrl) return { kind: "message", value: message.id };
  return null;
}

export function DocViewer({
  message,
  api,
  own,
  onClose,
  onDelete,
  onForward,
  onAnnounce,
}: DocViewerProps) {
  const name = message.fileName || "Document";
  const declared = message.fileType || "";
  const mime = useMemo(() => mimeFor(name, declared), [name, declared]);
  const size = message.fileSize;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const source = docSourceOf(message);
    if (!api || !source) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const fetched =
        source.kind === "file"
          ? await fetchFileBlob(api, source.value)
          : await fetchMessageMediaBlob(api, source.value);
      const buffer = await fetched.blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // The row's declared type wins over the response header: a file stored
      // before its type was servable comes back as an opaque download, and the
      // extension is still the truth about what the bytes are.
      const effective = mimeFor(name, declared || fetched.type);
      const kind = docKindFor(name, effective, bytes);
      const preview = docPreviewKind(name, effective);
      const wantsText = kind === "text" || kind === "svg" || preview !== null || kind === "archive";
      const decoded = wantsText ? decodePreviewText(bytes) : { text: "", truncated: false };
      const url = URL.createObjectURL(new Blob([buffer], { type: effective }));
      setLoaded({
        url,
        bytes,
        mime: effective,
        kind,
        text: decoded.text + (decoded.truncated ? truncatedNotice(bytes.byteLength) : ""),
        truncated: decoded.truncated,
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [api, declared, message, name]);

  /* Escape is the desktop reader's back button: it closes the confirm panel
     first, then the reader, exactly as the media viewer does. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirming) {
        setConfirming(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  useEffect(() => {
    void load();
    return () => {
      setLoaded((current) => {
        if (current?.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
        return current;
      });
    };
  }, [load]);

  const preview = useMemo(
    () => (loaded ? docPreviewKind(name, loaded.mime) : docPreviewKind(name, mime)),
    [loaded, mime, name],
  );
  const notice = loaded ? docNotice(loaded.kind, preview) : "";
  const canPdf = browserRendersPdf();

  return (
    <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={`Document ${name}`}>
      <header className="doc-viewer__head">
        <div className="doc-viewer__titles">
          <p className="doc-viewer__title">{name}</p>
          <p className="doc-viewer__stamp">
            {size > 0 ? `${displaySize(size)} · ` : ""}
            {message.senderName ? `${message.senderName} · ` : ""}
            {clockTime(message.createdAt)}
          </p>
        </div>
        <div className="doc-viewer__actions">
          {loaded ? (
            <>
              <a
                className="text-button"
                href={loaded.url}
                download={name}
                onClick={() => onAnnounce?.("Saved to your downloads folder.")}
              >
                <Icon name="download" size={16} /> Save
              </a>
              <a className="text-button" href={loaded.url} target="_blank" rel="noreferrer">
                Open in a new tab
              </a>
            </>
          ) : (
            <span className="text-button is-disabled">Save</span>
          )}
          {onForward ? (
            <button type="button" className="text-button" onClick={() => onForward(message)}>
              <Icon name="send" size={16} /> Forward
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="text-button is-danger"
              onClick={() => setConfirming(true)}
            >
              <Icon name="trash" size={16} /> Delete
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            aria-label="Close document"
          >
            Close
          </button>
        </div>
      </header>

      {confirming && (
        <div className="doc-viewer__confirm" role="group" aria-label="Confirm delete">
          <p>Delete this document for everyone? It cannot be undone.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setConfirming(false);
              onDelete?.(message);
            }}
          >
            Delete for everyone
          </button>
          <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}

      <div className="doc-viewer__body">
        {status === "loading" ? (
          <p className="doc-viewer__pending" role="status">
            Loading {name}…
          </p>
        ) : null}

        {status === "error" ? (
          <div className="doc-viewer__empty">
            <p>
              <strong>Could not load</strong>
            </p>
            <p>This file is not available right now.</p>
            <button type="button" className="secondary-button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}

        {status === "ready" && loaded ? (
          <>
            {notice ? <p className="doc-viewer__notice">{notice}</p> : null}

            {loaded.kind === "pdf" ? (
              canPdf ? (
                <iframe
                  className="doc-viewer__frame"
                  src={loaded.url}
                  title={`PDF ${name}`}
                  // A PDF from another person is rendered by the browser's own
                  // viewer, which is sandboxed by the engine; the frame is still
                  // denied every privilege a browser will take away.
                  sandbox="allow-same-origin allow-popups"
                />
              ) : (
                <div className="doc-viewer__empty">
                  <p>This browser has no PDF viewer to draw inside the app.</p>
                  <a className="primary-button" href={loaded.url} target="_blank" rel="noreferrer">
                    Open the PDF in a new tab
                  </a>
                </div>
              )
            ) : null}

            {loaded.kind === "image" ? (
              <img className="doc-viewer__image" src={loaded.url} alt={`Document ${name}`} />
            ) : null}

            {loaded.kind === "video" ? (
              /* eslint-disable-next-line jsx-a11y/media-has-caption -- a clip
                 from a phone rarely carries a track, and muting it would hide
                 the audio. */
              <video className="doc-viewer__video" src={loaded.url} controls preload="metadata" />
            ) : null}

            {loaded.kind === "audio" ? (
              <audio className="doc-viewer__audio" src={loaded.url} controls preload="metadata" />
            ) : null}

            {loaded.kind === "text" || loaded.kind === "svg" || preview !== null ? (
              <pre className="doc-viewer__text">
                <code>{loaded.text || EMPTY_TEXT_PREVIEW}</code>
              </pre>
            ) : null}

            {loaded.kind === "archive" || loaded.kind === "tiff" || loaded.kind === "other" ? (
              <div className="doc-viewer__card">
                <span className="doc-viewer__badge" aria-hidden="true">
                  {docBadge(name) || <Icon name="file" size={34} />}
                </span>
                <p className="doc-viewer__name">{name}</p>
                <p className="doc-viewer__facts">
                  {docFacts(loaded.mime, size || loaded.bytes.byteLength)}
                </p>
                {loaded.kind === "archive" ? (
                  <p className="doc-viewer__note">
                    {loaded.bytes.byteLength > 0
                      ? `${displaySize(loaded.bytes.byteLength)} of archive bytes.`
                      : ""}
                  </p>
                ) : null}
                <a className="primary-button" href={loaded.url} download={name}>
                  <Icon name="download" size={16} /> Download
                </a>
              </div>
            ) : null}

            {loaded.truncated ? (
              <p className="doc-viewer__notice">
                Only the first {Math.round(TEXT_PREVIEW_MAX_BYTES / 1000)} KB were read; the file is{" "}
                {displaySize(size || loaded.bytes.byteLength)} in total.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="doc-viewer__foot">
        <span>
          {own
            ? "You sent this document. Media bytes are account-controlled, not end-to-end encrypted."
            : "Documents are stored on the account's media bucket; only the message text in a personal chat is sealed."}
        </span>
      </footer>
    </div>
  );
}

export default DocViewer;
