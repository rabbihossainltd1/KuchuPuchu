/**
 * A view-once TEXT message (r71-20).
 *
 * The phone's rule, kept exactly: the row arrives veiled, one tap reveals the
 * words, a five-second countdown is painted on the stamp line so the reader
 * knows how long they have, and then the opening is reported — the Worker
 * deletes the row for BOTH sides and broadcasts VANISHED. There are no bytes to
 * fetch, so the reveal timer is the whole mechanism.
 *
 * The countdown is measured against the wall clock rather than accumulated
 * ticks: a background tab throttles intervals, and a view-once message that
 * lingers because the tab was hidden would outlive the five seconds the sender
 * agreed to.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  ONCE_TEXT_REVEAL_MS,
  ONCE_TEXT_TICK_MS,
  onceTextCountdown,
  onceTextRemaining,
} from "./viewOnce";

export type OnceTextProps = {
  /** The decrypted display body. A sealed envelope is never passed here. */
  body: string;
  /** Reports the single opening (`POST /api/messages/:id/view`). */
  onSpent: () => void;
  /** Painted next to the timestamp while the words are on screen. */
  onCountdown?: (label: string) => void;
};

export function OnceText({ body, onSpent, onCountdown }: OnceTextProps) {
  const [revealed, setRevealed] = useState(false);
  const [leftMs, setLeftMs] = useState(ONCE_TEXT_REVEAL_MS);
  const openedAt = useRef(0);
  const spent = useRef(false);

  const finish = useCallback(() => {
    if (spent.current) return;
    spent.current = true;
    onCountdown?.("");
    onSpent();
  }, [onCountdown, onSpent]);

  useEffect(() => {
    if (!revealed) return;
    openedAt.current = Date.now();
    const timer = window.setInterval(() => {
      const left = onceTextRemaining(openedAt.current, Date.now());
      setLeftMs(left);
      onCountdown?.(onceTextCountdown(left));
      if (left <= 0) {
        window.clearInterval(timer);
        finish();
      }
    }, ONCE_TEXT_TICK_MS);
    return () => window.clearInterval(timer);
  }, [finish, onCountdown, revealed]);

  if (!revealed) {
    return (
      <span className="once-text">
        <button
          type="button"
          className="once-text__veil"
          onClick={() => {
            setRevealed(true);
            onCountdown?.(onceTextCountdown(ONCE_TEXT_REVEAL_MS));
          }}
        >
          <Icon name="lock" size={14} />
          <span>
            <strong>View once message</strong>
            <span>Tap to reveal. It disappears for both of you five seconds later.</span>
          </span>
        </button>
      </span>
    );
  }

  return (
    <span className="once-text once-text--open">
      <span className="bubble__body">{body}</span>
      <span className="once-text__count" role="status" aria-live="polite">
        <Icon name="lock" size={12} /> {onceTextCountdown(leftMs)}
      </span>
    </span>
  );
}
