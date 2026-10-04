/**
 * The shared-media panel: "Media, links, and docs".
 *
 * `ChatMediaScreen.kt` decides the shape and this mirrors it — three tabs
 * (Media / Docs / Links), the Media tab being photos and videos merged and
 * sorted newest-first, an `EmptyState` per tab with the phone's own wording,
 * and a panel that agrees with the chat (a row that has left the transcript is
 * dropped here too, which `visibleMedia` does for the caller).
 *
 * Thumbnails resolve through the same bearer-gated path as the transcript, so
 * nothing here can be an `<img src>` pointed straight at the API.
 */

import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import { attachmentCategory } from "../media/uploadContract";
import { clockTime, type MessageRow } from "./protocol";
import { useMediaUrl, mediaSourceKey } from "./mediaUrl";
import { formatBytes } from "../media/uploadContract";
import {
  SHARED_MEDIA_EMPTY,
  SHARED_MEDIA_TABS,
  SHARED_MEDIA_TITLE,
  docLabel,
  firstLink,
  rowsForTab,
  type SharedMedia,
  type SharedMediaTab,
} from "./sharedMedia";

export type MediaGalleryProps = {
  api: ApiClient | null;
  media: SharedMedia | null;
  loading: boolean;
  /** A refusal or a failure, already turned into reader-facing copy. */
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onOpen: (message: MessageRow, tab: SharedMediaTab) => void;
  onAnnounce?: (message: string) => void;
};

function GalleryThumb({
  api,
  message,
  onOpen,
}: {
  api: ApiClient | null;
  message: MessageRow;
  onOpen: () => void;
}) {
  const category = attachmentCategory(message.fileType, message.meta);
  const media = useMediaUrl(api, api !== null, mediaSourceKey(message));
  const label = `${category === "video" ? "Video" : "Photo"} ${docLabel(message)}, ${clockTime(
    message.createdAt,
  )}`;

  return (
    <button type="button" className="gallery-tile" onClick={onOpen} aria-label={`Open ${label}`}>
      {media.url ? (
        <img className="gallery-tile__thumb" src={media.url} alt="" aria-hidden="true" />
      ) : (
        <span className="gallery-tile__pending" aria-hidden="true">
          <Icon name={category === "video" ? "play" : "file"} size={18} />
        </span>
      )}
      {category === "video" ? (
        <span className="gallery-tile__badge" aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function GalleryDocRow({ api, message }: { api: ApiClient | null; message: MessageRow }) {
  const media = useMediaUrl(api, api !== null, mediaSourceKey(message));
  const name = docLabel(message);
  return (
    <span className="gallery-row">
      <span className="gallery-row__icon" aria-hidden="true">
        <Icon name="file" size={18} />
      </span>
      <span className="gallery-row__copy">
        <strong>{name}</strong>
        <span>
          {formatBytes(message.fileSize)}
          {message.fileType ? ` · ${message.fileType}` : ""} · {clockTime(message.createdAt)}
        </span>
      </span>
      {media.url ? (
        <a className="text-button" href={media.url} download={name}>
          <Icon name="download" size={16} /> Download
        </a>
      ) : (
        <span className="gallery-row__pending" role="status">
          Preparing download…
        </span>
      )}
    </span>
  );
}

function GalleryLinkRow({ message }: { message: MessageRow }) {
  const href = firstLink(message.body);
  return (
    <span className="gallery-row">
      <span className="gallery-row__icon" aria-hidden="true">
        <Icon name="link" size={18} />
      </span>
      <span className="gallery-row__copy">
        <strong>{href}</strong>
        <span>{clockTime(message.createdAt)}</span>
      </span>
      <a
        className="text-button"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${href} in a new tab`}
      >
        Open
      </a>
    </span>
  );
}

export function MediaGallery({
  api,
  media,
  loading,
  error,
  onRetry,
  onClose,
  onOpen,
  onAnnounce,
}: MediaGalleryProps) {
  const [tab, setTab] = useState<SharedMediaTab>("Media");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = media ? rowsForTab(media, tab) : [];
  const empty = SHARED_MEDIA_EMPTY[tab];

  const moveTab = (delta: number) => {
    const position = SHARED_MEDIA_TABS.indexOf(tab);
    const next =
      SHARED_MEDIA_TABS[(position + delta + SHARED_MEDIA_TABS.length) % SHARED_MEDIA_TABS.length];
    if (!next) return;
    setTab(next);
    tabRefs.current[SHARED_MEDIA_TABS.indexOf(next)]?.focus();
    onAnnounce?.(`${next} tab.`);
  };

  return (
    <div className="media-gallery" role="dialog" aria-modal="true" aria-label={SHARED_MEDIA_TITLE}>
      <header className="media-gallery__head">
        <h3 id="media-gallery-title">{SHARED_MEDIA_TITLE}</h3>
        <button
          type="button"
          className="secondary-button"
          onClick={onClose}
          aria-label="Close media panel"
        >
          Close
        </button>
      </header>

      <div className="media-gallery__tabs" role="tablist" aria-label="Shared media">
        {SHARED_MEDIA_TABS.map((label, position) => (
          <button
            key={label}
            ref={(node) => {
              tabRefs.current[position] = node;
            }}
            type="button"
            role="tab"
            id={`shared-media-tab-${label}`}
            aria-selected={tab === label}
            tabIndex={tab === label ? 0 : -1}
            onClick={() => setTab(label)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveTab(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveTab(-1);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="media-gallery__panel"
        role="tabpanel"
        aria-labelledby={`shared-media-tab-${tab}`}
        tabIndex={0}
      >
        {loading ? (
          <p className="media-gallery__note" role="status">
            Loading shared media…
          </p>
        ) : error ? (
          <div className="media-gallery__error">
            <p role="alert">{error}</p>
            <button type="button" className="text-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="media-gallery__empty">
            <p className="media-gallery__empty-title">{empty.title}</p>
            {empty.body ? <p className="media-gallery__empty-body">{empty.body}</p> : null}
          </div>
        ) : tab === "Media" ? (
          <div className="media-gallery__grid">
            {rows.map((message) => (
              <GalleryThumb
                key={message.id}
                api={api}
                message={message}
                onOpen={() => onOpen(message, tab)}
              />
            ))}
          </div>
        ) : (
          <ul className="media-gallery__list">
            {rows.map((message) => (
              <li key={message.id}>
                {tab === "Docs" ? (
                  <GalleryDocRow api={api} message={message} />
                ) : (
                  <GalleryLinkRow message={message} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="media-gallery__foot">
        A private group has no shared-media gallery, and a view-once message never appears in it.
      </p>
    </div>
  );
}
