/**
 * The full-screen media viewer.
 *
 * Ported from `MediaViewer.kt` (`KpPhotoViewer`, 1 715 lines) with the desktop
 * half built out, because the plan's rule is that every gesture has a keyboard
 * or mouse equivalent and nothing is hover-only:
 *
 *   Android gesture            Browser equivalent here
 *   -------------------------  -------------------------------------------
 *   pinch zoom (1×…6×)         wheel zoom, `+` / `-` / `0`, same 1×…6× clamp
 *   double-tap zoom (1 ↔ 2.5)  double-click, same target
 *   pan while zoomed           pointer drag, arrow keys; same clamp box
 *   swipe between photos       Prev/Next buttons, `←` / `→`, Home / End
 *   swipe down to close        drag down past the threshold when at 1×, or
 *                              Escape, or the Close button
 *   ⋮ sheet: Save / Forward /  Save (a real download), Forward (disclosed as
 *     Delete                     not built yet), Delete (inline confirm)
 *
 * Zoom resets on every page flip, exactly as the phone does (owner round 34,
 * item 6), and a zoomed photo holds the drag gesture so a pan never turns into
 * an accidental page flip.
 *
 * The viewer never fetches: it is handed object URLs. That matters for
 * view-once media, where the fetch *is* the opening — so the parent decides
 * when bytes are allowed to be requested, and this component only reports that
 * a once-row is actually on screen (`onShown`), which is when Android calls
 * `ViewOnce.spend`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { clockTime } from "./protocol";
import {
  DOUBLE_TAP_ZOOM,
  DRAG_CLOSE_THRESHOLD,
  KEY_PAN_STEP,
  ZOOM_EPSILON,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clamp,
  isZoomed,
  panLimit,
} from "./viewerGeometry";

export type ViewerCategory = "photo" | "video" | "document";

export type ViewerItem = {
  readonly id: string;
  /** An object URL the parent already resolved; "" while it is still loading. */
  readonly url: string;
  readonly category: ViewerCategory;
  readonly title: string;
  readonly createdAt: string;
  readonly senderName: string;
  readonly own: boolean;
  readonly viewOnce: boolean;
  readonly spent: boolean;
  /** False while the row is still a local echo — the Worker has nothing to delete. */
  readonly canDelete: boolean;
  readonly width: number;
  readonly height: number;
};

export type MediaViewerProps = {
  items: readonly ViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDelete?: (item: ViewerItem) => void;
  /** The item is on screen. For a view-once row this is the single opening. */
  onShown?: (item: ViewerItem) => void;
  onAnnounce?: (message: string) => void;
};

export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
  onShown,
  onAnnounce,
}: MediaViewerProps) {
  const safeIndex = clamp(index, 0, Math.max(0, items.length - 1));
  const item = items[safeIndex];

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragClose, setDragClose] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");

  const stageRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; mode: "pan" | "close" } | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  const announce = useCallback(
    (message: string) => {
      setNotice(message);
      onAnnounce?.(message);
    },
    [onAnnounce],
  );

  const step = useCallback(
    (delta: number) => {
      if (items.length < 2) return;
      const next = (safeIndex + delta + items.length) % items.length;
      // Owner round 34 (item 6): zoom resets on each flip.
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setDragClose(0);
      onIndexChange(next);
    },
    [items.length, onIndexChange, safeIndex],
  );

  const zoomTo = useCallback(
    (next: number, centre?: { x: number; y: number }) => {
      const clamped = clamp(next, ZOOM_MIN, ZOOM_MAX);
      setScale(clamped);
      if (clamped <= ZOOM_EPSILON) {
        setOffset({ x: 0, y: 0 });
        return;
      }
      const box = stageRef.current?.getBoundingClientRect();
      const limit = panLimit(box?.width ?? 0, box?.height ?? 0, clamped);
      if (centre && box) {
        // Keep the point under the cursor still: move by the same factor the
        // scale changed by, then clamp into the pan box.
        const factor = clamped / (scale || 1);
        const fromCentreX = centre.x - box.left - box.width / 2;
        const fromCentreY = centre.y - box.top - box.height / 2;
        setOffset({
          x: clamp(offset.x * factor - fromCentreX * (factor - 1), -limit.x, limit.x),
          y: clamp(offset.y * factor - fromCentreY * (factor - 1), -limit.y, limit.y),
        });
        return;
      }
      setOffset((current) => ({
        x: clamp(current.x, -limit.x, limit.x),
        y: clamp(current.y, -limit.y, limit.y),
      }));
    },
    [offset.x, offset.y, scale],
  );

  /* -------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        if (confirming) {
          setConfirming(false);
          return;
        }
        onClose();
        return;
      }
      if (key === "ArrowRight") {
        event.preventDefault();
        if (isZoomed(scale)) {
          const box = stageRef.current?.getBoundingClientRect();
          const limit = panLimit(box?.width ?? 0, box?.height ?? 0, scale);
          setOffset((current) => ({
            ...current,
            x: clamp(current.x - KEY_PAN_STEP, -limit.x, limit.x),
          }));
          return;
        }
        step(1);
        return;
      }
      if (key === "ArrowLeft") {
        event.preventDefault();
        if (isZoomed(scale)) {
          const box = stageRef.current?.getBoundingClientRect();
          const limit = panLimit(box?.width ?? 0, box?.height ?? 0, scale);
          setOffset((current) => ({
            ...current,
            x: clamp(current.x + KEY_PAN_STEP, -limit.x, limit.x),
          }));
          return;
        }
        step(-1);
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        if (!isZoomed(scale)) return;
        event.preventDefault();
        const box = stageRef.current?.getBoundingClientRect();
        const limit = panLimit(box?.width ?? 0, box?.height ?? 0, scale);
        const delta = key === "ArrowUp" ? KEY_PAN_STEP : -KEY_PAN_STEP;
        setOffset((current) => ({ ...current, y: clamp(current.y + delta, -limit.y, limit.y) }));
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        onIndexChange(0);
        return;
      }
      if (key === "End") {
        event.preventDefault();
        onIndexChange(items.length - 1);
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        zoomTo(scale * ZOOM_STEP);
        announce(`Zoom ${Math.round(clamp(scale * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) * 100)} percent.`);
        return;
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        zoomTo(scale / ZOOM_STEP);
        announce(`Zoom ${Math.round(clamp(scale / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) * 100)} percent.`);
      }
      if (key === "0") {
        event.preventDefault();
        zoomTo(1);
        announce("Zoom reset to 100 percent.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [announce, confirming, items.length, onClose, onIndexChange, scale, step, zoomTo]);

  /* ----------------------------------------------------------------- focus */

  useEffect(() => {
    closeRef.current?.focus();
    return () => {
      // Nothing to restore: the trigger keeps its place in the transcript.
    };
  }, []);

  /* ---------------------------------------------------- view-once opening */

  useEffect(() => {
    if (!item || !onShown) return;
    if (item.spent || shownRef.current.has(item.id)) return;
    // The picture has to be on screen, not merely selected: a row whose bytes
    // are still loading has not been opened yet.
    if (!item.url) return;
    shownRef.current.add(item.id);
    onShown(item);
  }, [item, onShown]);

  /* ---------------------------------------------------------------- wheel */

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomTo(scale * factor, { x: event.clientX, y: event.clientY });
    },
    [scale, zoomTo],
  );

  /* ------------------------------------------------------------ pointers */

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!item) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        // A zoomed photo holds the gesture: panning, never a page flip or a
        // drag-to-close.
        mode: isZoomed(scale) ? "pan" : "close",
      };
    },
    [item, scale],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (drag.mode === "pan") {
        const box = stageRef.current?.getBoundingClientRect();
        const limit = panLimit(box?.width ?? 0, box?.height ?? 0, scale);
        setOffset({
          x: clamp(deltaX, -limit.x, limit.x),
          y: clamp(deltaY, -limit.y, limit.y),
        });
        return;
      }
      // Swipe down to close, and only down: a sideways drag at 1× does nothing
      // here because Prev/Next are real buttons on this surface.
      setDragClose(deltaY > 0 ? deltaY : 0);
    },
    [scale],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === "close" && dragClose >= DRAG_CLOSE_THRESHOLD) {
      announce("Closed.");
      onClose();
      return;
    }
    setDragClose(0);
  }, [announce, dragClose, onClose]);

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // `val target = if (scale > 1f) 1f else 2.5f`
      zoomTo(scale > ZOOM_MIN ? ZOOM_MIN : DOUBLE_TAP_ZOOM, { x: event.clientX, y: event.clientY });
    },
    [scale, zoomTo],
  );

  const label = useMemo(() => {
    if (!item) return "Media viewer";
    return `${item.title}, ${item.senderName}, ${clockTime(item.createdAt)}`;
  }, [item]);

  if (!item) {
    return (
      <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
        <p className="media-viewer__empty">There is nothing left to show.</p>
        <button type="button" className="secondary-button" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const closeProgress = clamp(dragClose / (DRAG_CLOSE_THRESHOLD * 2), 0, 0.5);
  const stageStyle = {
    transform: `translate3d(${offset.x}px, ${offset.y + dragClose}px, 0) scale(${scale})`,
    opacity: 1 - closeProgress,
    cursor: isZoomed(scale) ? "grab" : "default",
  };

  return (
    <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <header className="media-viewer__head">
        <div className="media-viewer__titles">
          <p className="media-viewer__title">{item.title}</p>
          <p className="media-viewer__stamp">
            {item.senderName} · {clockTime(item.createdAt)}
            {items.length > 1 ? ` · ${safeIndex + 1} of ${items.length}` : ""}
            {item.viewOnce ? (item.spent ? " · View once — opened" : " · View once") : ""}
          </p>
        </div>
        <div className="media-viewer__actions">
          {item.url ? (
            <a
              className="text-button"
              href={item.url}
              download={item.title}
              onClick={() => announce("Saved to your downloads folder.")}
            >
              <Icon name="message" size={16} /> Save
            </a>
          ) : (
            <span className="text-button is-disabled">Save</span>
          )}
          <span
            className="text-button is-disabled"
            title="Forwarding arrives in a later slice; saving and deleting work now."
            aria-disabled="true"
          >
            Forward
          </span>
          {item.canDelete && onDelete ? (
            <button
              type="button"
              className="text-button is-danger"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            ref={closeRef}
            className="secondary-button"
            onClick={onClose}
            aria-label="Close viewer"
          >
            Close
          </button>
        </div>
      </header>

      {confirming && (
        <div className="media-viewer__confirm" role="group" aria-label="Confirm delete">
          <p>Delete this {item.category} for everyone? It cannot be undone.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setConfirming(false);
              onDelete?.(item);
              announce("Deleted for everyone.");
            }}
          >
            Delete for everyone
          </button>
          <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}

      <div
        className="media-viewer__stage"
        ref={stageRef}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {item.url === "" ? (
          <p className="media-viewer__loading" role="status">
            Loading {item.title}…
          </p>
        ) : item.category === "video" ? (
          // A user-posted clip carries no caption track; the Worker stores the
          // bytes it is given and cannot author one. `controls` is the point.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="media-viewer__video"
            src={item.url}
            controls
            style={stageStyle}
            aria-label={label}
          />
        ) : (
          <img
            className="media-viewer__image"
            src={item.url}
            alt={label}
            style={stageStyle}
            draggable={false}
          />
        )}
      </div>

      <footer className="media-viewer__foot">
        <div className="media-viewer__zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomTo(scale / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <span aria-live="polite">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoomTo(scale * ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomTo(1)} aria-label="Reset zoom">
            Reset
          </button>
        </div>
        <div className="media-viewer__pages" role="group" aria-label="Pages">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={items.length < 2}
            aria-label="Previous item"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={items.length < 2}
            aria-label="Next item"
          >
            Next
          </button>
        </div>
        <p className="media-viewer__hint">
          Escape closes · ← → page · + − zoom · 0 resets · double-click zooms · drag down at 100%
          closes
        </p>
      </footer>

      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
