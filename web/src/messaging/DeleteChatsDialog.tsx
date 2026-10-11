/**
 * The phone's ChatDeleteDialog copy, verbatim: one popup for single and
 * multi delete. Groups are never deleted for everyone — the server makes
 * the member leave, so the popup says that and hides the checkbox.
 */

import { useState } from "react";
import { conversationTitle, type ConversationRow } from "./protocol";

export function deleteDialogCopy(rows: readonly ConversationRow[]) {
  const multi = rows.length > 1;
  const one = rows[0];
  const group = !multi && one?.isGroup === true;
  const name = multi
    ? "everyone"
    : group
      ? conversationTitle(one)
      : one
        ? conversationTitle(one)
        : "this chat";
  return {
    multi,
    group,
    name,
    title: multi ? "Delete Chats" : group ? "Leave group?" : "Delete Chat",
    question: multi
      ? `Permanently delete these ${rows.length} chats?`
      : group
        ? "You will no longer receive messages from this group."
        : `Permanently delete the chat with ${name}?`,
    alsoLabel: multi ? "Also delete for everyone" : group ? null : `Also delete for ${name}`,
    confirmLabel: multi ? "Delete Chats" : group ? "Leave group" : "Delete Chat",
  };
}

export function DeleteChatsDialog({
  rows,
  busy,
  onConfirm,
  onClose,
}: {
  rows: readonly ConversationRow[];
  busy: boolean;
  onConfirm: (alsoForThem: boolean) => void;
  onClose: () => void;
}) {
  const copy = deleteDialogCopy(rows);
  const [also, setAlso] = useState(false);
  return (
    <div className="ai-history-overlay" role="presentation" onClick={onClose}>
      <section
        className="ai-history delete-dialog"
        role="dialog"
        aria-label={copy.title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="chat-menu__title">{copy.title}</p>
        <p className="chat-menu__notes">{copy.question}</p>
        {copy.alsoLabel && (
          <label className="chat-menu__toggle">
            <span>{copy.alsoLabel}</span>
            <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} />
          </label>
        )}
        <button
          type="button"
          className="primary-button chat-menu__danger"
          disabled={busy}
          onClick={() => onConfirm(also)}
        >
          {copy.confirmLabel}
        </button>
      </section>
    </div>
  );
}
