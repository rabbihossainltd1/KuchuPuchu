/**
 * Pick the chats to forward to — `ForwardDialog` on the phone.
 *
 * A full-screen picker, not a cramped popup: a back arrow and a title, the
 * whole conversation list, a row tap TICKS it (as many chats as wanted), and a
 * Send bar at the bottom fires them all at once. The subtitle reads
 * "N chats" until something is picked and "N selected" after, exactly as the
 * phone's does.
 *
 * Rows are `role="checkbox"` buttons rather than bare divs: this is a desktop
 * surface, so every tick is reachable with Tab and Space and announces itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { ConversationRow } from "./protocol";
import { conversationInitial, conversationTitle } from "./protocol";
import { FORWARD_DIALOG_TITLE, forwardPickerSubtitle } from "./forward";

export type ForwardDialogProps = {
  conversations: readonly ConversationRow[];
  /** How many messages are about to be copied into every picked chat. */
  count: number;
  onSend: (targetIds: readonly string[]) => void;
  onClose: () => void;
};

export function ForwardDialog({ conversations, count, onSend, onClose }: ForwardDialogProps) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = useCallback((id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
    );
  }, []);

  const rows = useMemo(() => conversations, [conversations]);

  return (
    <div
      className="forward-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={FORWARD_DIALOG_TITLE}
    >
      <header className="forward-dialog__head">
        <button
          type="button"
          ref={closeRef}
          className="icon-button"
          onClick={onClose}
          aria-label="Close the forward picker"
        >
          <Icon name="arrow" size={19} className="forward-dialog__back" />
        </button>
        <div className="forward-dialog__titles">
          <h2>{FORWARD_DIALOG_TITLE}</h2>
          <p>{forwardPickerSubtitle(picked.length, rows.length)}</p>
        </div>
      </header>

      <div className="forward-dialog__list" ref={listRef}>
        {rows.length === 0 ? (
          <p className="forward-dialog__empty">No chats yet.</p>
        ) : (
          rows.map((conversation) => {
            const on = picked.includes(conversation.id);
            const name = conversationTitle(conversation);
            return (
              <button
                key={conversation.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={`forward-dialog__row${on ? " is-picked" : ""}`}
                onClick={() => toggle(conversation.id)}
              >
                <span className="forward-dialog__avatar" aria-hidden="true">
                  {conversationInitial(conversation)}
                </span>
                <span className="forward-dialog__name">
                  {name}
                  {conversation.privateGroup ? <em> · private group</em> : null}
                  {!conversation.isGroup && conversation.other?.privateProfile ? (
                    <em> · private profile</em>
                  ) : null}
                </span>
                <span className={`forward-dialog__tick${on ? " is-on" : ""}`} aria-hidden="true">
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      {picked.length > 0 ? (
        <footer className="forward-dialog__foot">
          <span className="forward-dialog__summary">
            {count} message{count === 1 ? "" : "s"} → {picked.length} chat
            {picked.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              const targets = picked.slice();
              setPicked([]);
              onSend(targets);
            }}
          >
            <Icon name="send" size={16} /> Send
          </button>
        </footer>
      ) : null}
    </div>
  );
}

export default ForwardDialog;
