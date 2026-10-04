/**
 * The attach sheet.
 *
 * Every tile in Android's `AttachSheet.kt` grid is represented here with an
 * explicit classification, because "the button exists" is not parity:
 *
 *   Gallery    live — file input, multi-select images
 *   Camera     live — `capture="environment"`; a phone browser opens the camera,
 *              a desktop browser offers its file picker (browser substitute)
 *   Video      live — browser substitute for the phone's fullscreen gallery
 *              video tab, which the collapsed Android sheet does not expose
 *   Document   live — any file, with Android's "send as document" option
 *   Location   disabled — the phone reads its own location provider and sends a
 *              text line; a browser would need a permission prompt and a
 *              reverse-geocode the Worker does not offer. Deferred, not faked.
 *   Contact    disabled — needs the platform contacts provider (Android-only)
 *   Poll       disabled — `comingSoon()` on Android too (verified placeholder)
 *   Event      disabled — `comingSoon()` on Android too (verified placeholder)
 *   AI images  disabled — `comingSoon()` on Android too (verified placeholder)
 *
 * A disabled tile states why in its accessible description, so the gap is
 * disclosed rather than hidden behind an icon that does nothing.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

export type AttachSource = "gallery" | "camera" | "video" | "document";

export type AttachMenuProps = {
  open: boolean;
  onClose: () => void;
  onFiles: (
    files: readonly File[],
    source: AttachSource,
    asDocument: boolean,
    viewOnce: boolean,
  ) => void;
  /** A one-way account cannot send anything, so the whole sheet is inert. */
  disabled?: boolean;
  onAnnounce?: (message: string) => void;
};

type Tile = {
  id: string;
  label: string;
  source?: AttachSource;
  accept?: string;
  capture?: "environment";
  multiple?: boolean;
  /** Why the tile is inert. Absent for a live tile. */
  unavailable?: string;
};

const TILES: readonly Tile[] = Object.freeze([
  { id: "gallery", label: "Gallery", source: "gallery", accept: "image/*", multiple: true },
  { id: "camera", label: "Camera", source: "camera", accept: "image/*", capture: "environment" },
  { id: "video", label: "Video", source: "video", accept: "video/*" },
  { id: "document", label: "Document", source: "document", accept: "*/*" },
  {
    id: "location",
    label: "Location",
    unavailable:
      "Location sharing uses the phone's own location provider and is not available in a browser build.",
  },
  {
    id: "contact",
    label: "Contact",
    unavailable: "Sharing a contact needs the device's contacts app, which a browser cannot reach.",
  },
  {
    id: "poll",
    label: "Poll",
    unavailable: "Polls are coming soon on Android too — not built here.",
  },
  {
    id: "event",
    label: "Event",
    unavailable: "Events are coming soon on Android too — not built here.",
  },
  {
    id: "ai-images",
    label: "AI images",
    unavailable: "AI images are coming soon on Android too — not built here.",
  },
]);

export function AttachMenu({ open, onClose, onFiles, disabled, onAnnounce }: AttachMenuProps) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [asDocument, setAsDocument] = useState(false);
  // "View once" and "send as a document" cannot both be true: the Worker drops
  // the flag on a document, so the second checkbox turns the first off rather
  // than letting the reader choose something that silently will not happen.
  const [viewOnce, setViewOnce] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the sheet so it is not a mouse-only surface.
    panelRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const handlePick = useCallback(
    (tile: Tile) => (event: ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      const files = list ? Array.from(list) : [];
      // Reset so picking the same file twice still fires a change event.
      event.target.value = "";
      if (!files.length || !tile.source) return;
      onFiles(
        files,
        tile.source,
        tile.id === "document" ? asDocument : false,
        tile.id === "document" ? false : viewOnce,
      );
      onAnnounce?.(`${files.length} file${files.length === 1 ? "" : "s"} attached.`);
      onClose();
    },
    [asDocument, onAnnounce, onClose, onFiles, viewOnce],
  );

  if (!open) return null;

  return (
    <div className="attach-menu" ref={panelRef} role="group" aria-label="Attach something">
      <div className="attach-menu__grid">
        {TILES.map((tile) => {
          const inert = Boolean(tile.unavailable) || disabled === true;
          return (
            <div className="attach-tile" key={tile.id}>
              <button
                type="button"
                className="attach-tile__button"
                disabled={inert}
                aria-describedby={tile.unavailable ? `attach-why-${tile.id}` : undefined}
                onClick={() => {
                  if (!tile.source) return;
                  inputRefs.current[tile.id]?.click();
                }}
              >
                <span className="attach-tile__icon" aria-hidden="true">
                  {tile.id === "gallery"
                    ? "🖼️"
                    : tile.id === "camera"
                      ? "📷"
                      : tile.id === "video"
                        ? "🎬"
                        : tile.id === "document"
                          ? "📄"
                          : tile.id === "location"
                            ? "📍"
                            : tile.id === "contact"
                              ? "👤"
                              : tile.id === "poll"
                                ? "📊"
                                : tile.id === "event"
                                  ? "📅"
                                  : "✨"}
                </span>
                <span className="attach-tile__label">{tile.label}</span>
              </button>
              {tile.unavailable && (
                <span className="sr-only" id={`attach-why-${tile.id}`}>
                  {tile.unavailable}
                </span>
              )}
              {tile.source && (
                <input
                  ref={(node) => {
                    inputRefs.current[tile.id] = node;
                  }}
                  type="file"
                  className="sr-only"
                  accept={tile.accept}
                  multiple={tile.multiple}
                  capture={tile.capture}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={handlePick(tile)}
                />
              )}
            </div>
          );
        })}
      </div>

      <label className="attach-menu__option">
        <input
          type="checkbox"
          checked={asDocument}
          onChange={(event) => {
            setAsDocument(event.target.checked);
            if (event.target.checked) setViewOnce(false);
          }}
          disabled={disabled}
        />
        <span>
          Send as a document — keeps a photo or clip's own bytes and name, with no re-encoding.
        </span>
      </label>

      <label className="attach-menu__option">
        <input
          type="checkbox"
          checked={viewOnce}
          onChange={(event) => {
            setViewOnce(event.target.checked);
            if (event.target.checked) setAsDocument(false);
          }}
          disabled={disabled}
        />
        <span>
          View once — the reader opens a photo or clip exactly once, then it is gone for both of
          you. A document cannot be view-once.
        </span>
      </label>

      <div className="attach-menu__foot">
        <p className="attach-menu__note">
          Photos are shrunk to a 2048 px long edge and re-encoded as JPEG before upload, exactly
          like the phone. Limits: 100 MB image, 2 GB video, 100 MB audio, 5 GB document.
        </p>
        <button type="button" className="text-button" onClick={onClose}>
          Close attach menu
        </button>
      </div>
    </div>
  );
}

/** The reason copy for a tile, exposed for tests and the parity matrix. */
export const ATTACH_TILE_UNAVAILABLE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    TILES.filter((tile) => tile.unavailable).map((tile) => [tile.id, tile.unavailable ?? ""]),
  ),
);

export const ATTACH_TILE_IDS: readonly string[] = Object.freeze(TILES.map((tile) => tile.id));
