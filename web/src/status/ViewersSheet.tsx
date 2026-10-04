import { useEffect } from "react";
import { Icon } from "../icons";
import { STATUS_COPY, listStamp } from "./statusModel";
import type { ViewersState } from "./useStatuses";

/**
 * "Viewed by" — the owner's list of who saw this status, with the emoji each of
 * them reacted with.
 *
 * It paints the cached list at once and refreshes behind it (`ViewersSheet` on
 * the phone does the same through `ScreenStore.statusViewers`), so a re-open
 * never shows a spinner for a list the reader has already seen. Only a
 * first-ever load spins and only a first-ever failure says so.
 *
 * Tapping a viewer opens the chat with them, which is what the phone does — and
 * on a desktop that is a real navigation, so the row is a button with a name.
 */
export function ViewersSheet({
  state,
  onClose,
  onOpenChat,
}: {
  readonly state: ViewersState;
  readonly onClose: () => void;
  readonly onOpenChat: (viewerId: string) => void | Promise<void>;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="status-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={STATUS_COPY.viewersTitle}
    >
      <div className="status-sheet__backdrop" onClick={onClose} />
      <div className="status-sheet__body status-sheet__body--viewers">
        <header className="status-sheet__head">
          <h3>{STATUS_COPY.viewersTitle}</h3>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={STATUS_COPY.close}
            title={STATUS_COPY.close}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {state.error ? (
          <p className="status-sheet__error" role="alert">
            {STATUS_COPY.viewersError}
          </p>
        ) : state.loading && state.rows.length === 0 ? (
          <p className="status-sheet__state" role="status">
            {STATUS_COPY.loading}
          </p>
        ) : state.rows.length === 0 ? (
          <p className="status-sheet__state">{STATUS_COPY.viewersEmpty}</p>
        ) : (
          <ul className="status-sheet__list">
            {state.rows.map((row) => (
              <li key={row.author.id}>
                <button
                  type="button"
                  className="status-sheet__viewer"
                  onClick={() => void onOpenChat(row.author.id)}
                  aria-label={`Open the chat with ${row.author.displayName || row.author.username}`}
                >
                  <span className="status-sheet__avatar" aria-hidden="true">
                    {row.author.avatarUrl ? (
                      <img src={row.author.avatarUrl} alt="" />
                    ) : (
                      (row.author.displayName || row.author.username || "?")
                        .trim()
                        .charAt(0)
                        .toUpperCase()
                    )}
                  </span>
                  <span className="status-sheet__who">
                    <strong>{row.author.displayName || row.author.username || "Somebody"}</strong>
                    <span>{listStamp(row.viewedAt)}</span>
                  </span>
                  {row.reaction ? (
                    <span className="status-sheet__reaction" aria-label={`Reacted ${row.reaction}`}>
                      {row.reaction}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
