import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { useMediaUrl } from "../messaging/mediaUrl";
import { ViewersSheet } from "./ViewersSheet";
import {
  STATUS_COPY,
  STATUS_REACTIONS,
  STATUS_SWIPE_CLOSE_PX,
  STATUS_VIDEO_WAIT_SLACK_MS,
  isStatusReaction,
  segmentFill,
  statusBgStyle,
  statusGradientCss,
  statusHoldMs,
  statusPaused,
  statusStamp,
  statusViewCount,
  stepStatus,
  viewerAuthorName,
  viewsLabel,
  type StatusGroup,
  type StatusItem,
} from "./statusModel";
import type { StatusesController } from "./useStatuses";

/**
 * The status viewer: one author's statuses, full screen, with the phone's clock.
 *
 * Everything timed here is `StatusViewerScreen`'s rule, not a guess: a photo or
 * a text card holds five seconds, a clip holds its own length (inside 5…120 s)
 * and thirty seconds when its length never arrived, and the clock PAUSES while
 * the viewers sheet is up, the menu is up, the reply field has focus, the tab is
 * hidden or a finger is holding the picture. A hidden tab is the browser's half
 * of the phone's "not foreground" check — without it a viewer left in a
 * background tab ran through the whole list and closed itself.
 *
 * The halves of the picture step back and forward like the phone's tap zones,
 * and both are also real buttons with arrow-key equivalents, so a keyboard
 * reader is not left watching a slideshow they cannot drive.
 */
export function StatusViewer({
  api,
  group,
  myName,
  controller,
  onClose,
  onOpenChat,
}: {
  readonly api: ApiClient | null;
  readonly group: StatusGroup;
  readonly myName: string;
  readonly controller: StatusesController;
  readonly onClose: () => void;
  readonly onOpenChat: (conversationId: string) => void;
}) {
  const statuses = group.statuses;
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState("");
  const [replyFocused, setReplyFocused] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [holding, setHolding] = useState(false);
  // The labelled equivalent of the phone's hold-to-pause gesture: a keyboard
  // reader has no finger to keep on the glass, so this is a real toggle.
  const [manualPause, setManualPause] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reacted, setReacted] = useState("");
  const [dragPx, setDragPx] = useState(0);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  // A media element that the browser cannot decode is not a status: it is a
  // broken frame. The element's own error flips this and the honest line takes
  // the picture's place, instead of a black rectangle saying nothing.
  const [mediaBroken, setMediaBroken] = useState(false);

  const current: StatusItem | undefined = statuses[Math.min(index, statuses.length - 1)];
  const isVideo = current?.kind === "VIDEO";
  const mediaKey = current && current.hasMedia ? `status:${current.id}` : "";
  const media = useMediaUrl(api, api !== null && Boolean(mediaKey), mediaKey);
  const elapsedRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const replyRef = useRef<HTMLInputElement | null>(null);
  const dragOrigin = useRef<number | null>(null);

  /* Releasing anywhere ends a hold: the finger may leave the zone before it
     lifts, and a clock left paused by an abandoned press is its own bug. */
  useEffect(() => {
    if (!holding) return;
    const release = () => setHolding(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [holding]);

  /* The tab's own visibility is the phone's `Store.foreground`. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setHidden(document.visibilityState !== "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const paused = useMemo(
    () => manualPause || statusPaused({ viewersOpen, menuOpen, replyFocused, hidden, holding }),
    [holding, hidden, manualPause, menuOpen, replyFocused, viewersOpen],
  );

  const step = useCallback(
    (direction: "back" | "next") => {
      const next = stepStatus(index, statuses.length, direction);
      setProgress(0);
      setVideoProgress(0);
      setVideoReady(false);
      setMediaBroken(false);
      elapsedRef.current = 0;
      if (next.close) {
        onClose();
        return;
      }
      setIndex(next.index);
    },
    [index, onClose, statuses.length],
  );

  /* One view report per status, and only for somebody else's. */
  useEffect(() => {
    if (!current || group.mine) return;
    controller.markViewed(current.id);
  }, [controller, current, group.mine]);

  /* The clock. 50 ms ticks, exactly like the phone's `delay(50)` loop, and a
     tick that finds the viewer paused simply does not count. */
  useEffect(() => {
    if (!current) return;
    if (isVideo) return; // a clip drives its own bar from the element
    const hold = statusHoldMs(current);
    // The elapsed clock lives in a ref so a pause that restarts this effect
    // does not rewind the bar: the phone's loop only skips ticks while paused.
    const timer = window.setInterval(() => {
      if (paused) return;
      const elapsed = Math.min(hold, elapsedRef.current + 50);
      elapsedRef.current = elapsed;
      setProgress(elapsed / hold);
      if (elapsed >= hold) {
        window.clearInterval(timer);
        step("next");
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [current, isVideo, paused, step]);

  /* A clip's slack timer: if `ended` never fires (a codec the browser will not
     play, a stalled network) the viewer still moves on, hold + 8 s later. */
  useEffect(() => {
    if (!current || !isVideo || !videoReady) return;
    const hold = statusHoldMs(current);
    let waited = 0;
    const timer = window.setInterval(() => {
      if (paused) return;
      waited += 100;
      if (waited >= hold + STATUS_VIDEO_WAIT_SLACK_MS) {
        window.clearInterval(timer);
        step("next");
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [current, isVideo, paused, step, videoReady]);

  /* Escape closes; the arrows step; a space holds. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirmDelete || viewersOpen || menuOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setConfirmDelete(false);
          setViewersOpen(false);
          setMenuOpen(false);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (replyFocused) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step("back");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step("next");
      } else if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setHolding(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Spacebar") setHolding(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [confirmDelete, menuOpen, onClose, replyFocused, step, viewersOpen]);

  /* The clip pauses exactly when the clock does. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    void video.play().catch(() => undefined);
  }, [paused, current?.id, media.url]);

  const sendReply = useCallback(async () => {
    const text = reply.trim();
    if (!text || !current || group.mine) return;
    // Optimistic, like the phone: the box clears the moment Send is pressed and
    // only a failure speaks up. Releasing the field is what un-pauses the clock.
    setReply("");
    setReplyError("");
    setReplyFocused(false);
    replyRef.current?.blur();
    const result = await controller.reply(group.author.id, current.id, text);
    if (!result.ok) setReplyError(result.reason || STATUS_COPY.replyFailed);
  }, [controller, current, group.author.id, group.mine, reply]);

  const react = useCallback(
    async (emoji: string) => {
      if (!current || group.mine || !isStatusReaction(emoji)) return;
      setReacted(emoji);
      const ok = await controller.react(current.id, emoji);
      if (!ok) controller.announce(STATUS_COPY.replyFailed);
      window.setTimeout(() => setReacted(""), 900);
    },
    [controller, current, group.mine],
  );

  const openViewers = useCallback(() => {
    if (!current) return;
    setViewersOpen(true);
    void controller.loadViewers(current.id);
  }, [controller, current]);

  const message = useCallback(async () => {
    setMenuOpen(false);
    const conversationId = await controller.openChatWith(group.author.id);
    if (conversationId) onOpenChat(conversationId);
    else controller.announce(STATUS_COPY.replyFailed);
  }, [controller, group.author.id, onOpenChat]);

  const hide = useCallback(() => {
    setMenuOpen(false);
    controller.hideAuthor(group.author.id);
    controller.announce(STATUS_COPY.hiddenToast);
    onClose();
  }, [controller, group.author.id, onClose]);

  const report = useCallback(() => {
    setMenuOpen(false);
    // The phone's Report is a local acknowledgement too: there is no report
    // route in the Worker, and inventing one would be a lie in the other
    // direction. The wording is the phone's.
    controller.announce(STATUS_COPY.reportedToast);
  }, [controller]);

  const remove = useCallback(async () => {
    setConfirmDelete(false);
    setMenuOpen(false);
    if (!current) return;
    const id = current.id;
    // Leave at once, delete behind: a second click must find nothing to remove.
    onClose();
    await controller.remove(id);
  }, [controller, current, onClose]);

  if (!current) {
    return (
      <div className="status-viewer" role="dialog" aria-modal="true" aria-label="Status viewer">
        <p className="status-viewer__empty">
          <Icon name="eye" size={30} />
          {STATUS_COPY.noStatus}
        </p>
      </div>
    );
  }

  const style = statusBgStyle(current.bgStyle);
  const shown = isVideo ? videoProgress : progress;
  // Either the bytes never arrived, or they arrived and this browser cannot
  // make a picture or a clip out of them: both are said out loud.
  const mediaFailed = media.status === "error" || mediaBroken;
  const viewers = viewersOpen ? controller.viewersFor(current.id) : null;

  return (
    <div
      className="status-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Status from ${viewerAuthorName(group, myName)}`}
      ref={rootRef}
    >
      {/* The stage carries the swipe-down-to-close gesture, and only the stage:
          the chrome's buttons sit outside it, so capturing the pointer here can
          never swallow a click on them. */}
      <div
        className="status-viewer__stage"
        style={
          dragPx
            ? { transform: `translateY(${dragPx}px)`, opacity: 1 - Math.min(0.45, dragPx / 1400) }
            : undefined
        }
        onPointerDown={(event) => {
          // A press on a tap zone is a press on a BUTTON: capturing the pointer
          // here would retarget the release (and the click that follows it) to
          // the stage, and the zones would stop stepping. The swipe-to-close
          // drag only starts on the picture itself.
          if ((event.target as Element).closest(".status-viewer__zone")) return;
          dragOrigin.current = event.clientY;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragOrigin.current === null) return;
          const delta = event.clientY - dragOrigin.current;
          if (delta > 0) setDragPx(delta);
        }}
        onPointerUp={() => {
          const off = dragPx;
          dragOrigin.current = null;
          setDragPx(0);
          if (off > STATUS_SWIPE_CLOSE_PX) onClose();
        }}
        onPointerCancel={() => {
          dragOrigin.current = null;
          setDragPx(0);
        }}
      >
        {/* The picture: a clip, a photo, or the gradient card a text status is. */}
        {current.kind === "VIDEO" ? (
          media.url && !mediaBroken ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- a status clip
            // is somebody's own upload; there is no caption track to offer and
            // none is claimed.
            <video
              ref={videoRef}
              className="status-viewer__video"
              src={media.url}
              playsInline
              preload="auto"
              aria-label={`Video status from ${viewerAuthorName(group, myName)}`}
              onLoadedMetadata={(event) => {
                setVideoReady(true);
                const video = event.currentTarget;
                if (Number.isFinite(video.duration) && video.duration > 0) {
                  setVideoProgress(0);
                }
              }}
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                const fraction = Math.min(1, Math.max(0, video.currentTime / video.duration));
                setVideoProgress(fraction);
              }}
              onEnded={() => step("next")}
              onError={() => {
                setMediaBroken(true);
                setVideoReady(true);
              }}
            />
          ) : (
            <p className="status-viewer__waiting" role="status">
              {mediaFailed ? "That clip could not be loaded." : STATUS_COPY.loading}
            </p>
          )
        ) : current.kind === "IMAGE" ? (
          media.url && !mediaBroken ? (
            <img
              className="status-viewer__image"
              src={media.url}
              alt={`Photo status from ${viewerAuthorName(group, myName)}`}
              onError={() => setMediaBroken(true)}
            />
          ) : (
            <p className="status-viewer__waiting" role="status">
              {mediaFailed ? "That photo could not be loaded." : STATUS_COPY.loading}
            </p>
          )
        ) : (
          <div className="status-viewer__card" style={{ background: statusGradientCss(style) }}>
            <p className="status-viewer__text">{current.text}</p>
          </div>
        )}

        {/* The tap zones. Two real buttons under a transparent layer, so the
            pointer half-tap the phone has is also a labelled control. */}
        <div className="status-viewer__zones">
          <button
            type="button"
            className="status-viewer__zone"
            aria-label={STATUS_COPY.previous}
            title={STATUS_COPY.previous}
            disabled={index === 0}
            onClick={() => step("back")}
            onPointerDown={() => setHolding(true)}
          >
            <span className="sr-only">{STATUS_COPY.previous}</span>
          </button>
          <button
            type="button"
            className="status-viewer__zone"
            aria-label={STATUS_COPY.next}
            title={STATUS_COPY.next}
            onClick={() => step("next")}
            onPointerDown={() => setHolding(true)}
          >
            <span className="sr-only">{STATUS_COPY.next}</span>
          </button>
        </div>
      </div>

      <div className="status-viewer__shade status-viewer__shade--top" aria-hidden="true" />
      <div className="status-viewer__shade status-viewer__shade--bottom" aria-hidden="true" />

      <div className="status-viewer__chrome">
        <div className="status-viewer__segments" role="group" aria-label="Status progress">
          {statuses.map((item, position) => (
            <span className="status-viewer__segment" key={item.id}>
              <span
                className="status-viewer__fill"
                style={{ width: `${segmentFill(position, index, shown) * 100}%` }}
              />
              <span className="sr-only">
                {`Status ${position + 1} of ${statuses.length}`}
                {position === index ? `, ${Math.round(shown * 100)}% through` : ""}
              </span>
            </span>
          ))}
        </div>

        <header className="status-viewer__head">
          <span className="status-viewer__avatar" aria-hidden="true">
            {group.author.avatarUrl ? (
              <img src={group.author.avatarUrl} alt="" />
            ) : (
              viewerAuthorName(group, myName).trim().charAt(0).toUpperCase()
            )}
          </span>
          <span className="status-viewer__who">
            <strong>{viewerAuthorName(group, myName)}</strong>
            <span>{statusStamp(current.createdAt)}</span>
          </span>
          <button
            type="button"
            className="icon-button status-viewer__menu"
            onClick={() => setMenuOpen(true)}
            aria-label={STATUS_COPY.menu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            title={STATUS_COPY.menu}
          >
            <Icon name="more" size={18} />
          </button>
        </header>
      </div>

      <div className="status-viewer__chrome">
        <div className="status-viewer__foot">
          {group.mine ? (
            <button type="button" className="status-viewer__views" onClick={openViewers}>
              <Icon name="eye" size={17} />
              {viewsLabel(statusViewCount(current, viewers?.rows.length ?? 0))}
            </button>
          ) : (
            <>
              <div className="status-viewer__reactions" role="group" aria-label="Quick reactions">
                {STATUS_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`status-viewer__reaction${reacted === emoji ? " is-pulsing" : ""}`}
                    aria-label={`React ${emoji}`}
                    onClick={() => void react(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="status-viewer__reply">
                <label className="sr-only" htmlFor="status-reply">
                  {`${STATUS_COPY.replyPlaceholder} ${viewerAuthorName(group, myName)}`}
                </label>
                <input
                  id="status-reply"
                  ref={replyRef}
                  value={reply}
                  placeholder={`${STATUS_COPY.replyPlaceholder} ${viewerAuthorName(group, myName)}…`}
                  onFocus={() => setReplyFocused(true)}
                  onBlur={() => setReplyFocused(false)}
                  onChange={(event) => {
                    setReply(event.target.value);
                    setReplyError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={STATUS_COPY.sendReply}
                  title={STATUS_COPY.sendReply}
                  disabled={!reply.trim()}
                  onClick={() => void sendReply()}
                >
                  <Icon name="send" size={17} />
                </button>
              </div>
              {replyError ? (
                <p className="status-viewer__error" role="alert">
                  {replyError}
                </p>
              ) : null}
            </>
          )}

          <div className="status-viewer__controls">
            <button
              type="button"
              className="icon-button"
              aria-label={manualPause ? STATUS_COPY.resume : STATUS_COPY.pause}
              title={
                manualPause
                  ? STATUS_COPY.resume
                  : `${STATUS_COPY.pause} — holding the picture pauses it too`
              }
              aria-pressed={manualPause}
              onClick={() => setManualPause((current) => !current)}
            >
              <Icon name={manualPause ? "play" : "pause"} size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={STATUS_COPY.close}
              title={STATUS_COPY.close}
              onClick={onClose}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
      </div>

      {viewersOpen ? (
        <ViewersSheet
          state={controller.viewersFor(current.id)}
          onClose={() => setViewersOpen(false)}
          onOpenChat={async (viewerId) => {
            setViewersOpen(false);
            const conversationId = await controller.openChatWith(viewerId);
            if (conversationId) onOpenChat(conversationId);
          }}
        />
      ) : null}

      {menuOpen ? (
        <div className="status-sheet" role="dialog" aria-modal="true" aria-label="Status menu">
          <div className="status-sheet__backdrop" onClick={() => setMenuOpen(false)} />
          <div className="status-sheet__body">
            {group.mine ? (
              <button
                type="button"
                className="status-sheet__row status-sheet__row--danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Icon name="trash" size={19} /> {STATUS_COPY.menuDelete}
              </button>
            ) : (
              <>
                <button type="button" className="status-sheet__row" onClick={() => void message()}>
                  <Icon name="message" size={19} /> {STATUS_COPY.menuMessage}
                </button>
                <button type="button" className="status-sheet__row" onClick={hide}>
                  <Icon name="hide" size={19} /> {STATUS_COPY.menuHide}
                </button>
                <button type="button" className="status-sheet__row" onClick={report}>
                  <Icon name="flag" size={19} /> {STATUS_COPY.menuReport}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="status-sheet" role="group" aria-label="Confirm delete" aria-modal="true">
          <div className="status-sheet__backdrop" onClick={() => setConfirmDelete(false)} />
          <div className="status-sheet__body">
            <strong>{STATUS_COPY.deleteTitle}</strong>
            <p>{STATUS_COPY.deleteText}</p>
            <div className="status-sheet__row status-sheet__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
              <button type="button" className="danger-button" onClick={() => void remove()}>
                {STATUS_COPY.deleteConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
