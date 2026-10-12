import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "../icons";
import { QUICK_REACTIONS } from "./chatCopy";
import type { MessageRow } from "./protocol";

type Props = {
  message: MessageRow;
  meId: string;
  open: boolean;
  selected: boolean;
  canCopy: boolean;
  canForward: boolean;
  forwardReason: string;
  canEdit: boolean;
  canDelete: boolean;
  canRetry: boolean;
  onToggle: () => void;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onInfo: () => void;
  onForward: () => void;
  onEdit: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onMoreReactions: () => void;
  onRetry: () => void;
  onDiscard: () => void;
};

export function MessageActionMenu({
  message,
  meId,
  open,
  selected,
  canCopy,
  canForward,
  forwardReason,
  canEdit,
  canDelete,
  canRetry,
  onToggle,
  onClose,
  onReply,
  onCopy,
  onInfo,
  onForward,
  onEdit,
  onToggleSelect,
  onDelete,
  onReact,
  onMoreReactions,
  onRetry,
  onDiscard,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const positionPanel = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const anchor = trigger.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const margin = 12;
      const left = Math.max(
        margin,
        Math.min(anchor.right - box.width, window.innerWidth - box.width - margin),
      );
      const spaceAbove = anchor.top - margin;
      const spaceBelow = window.innerHeight - anchor.bottom - margin;
      const placeAbove = spaceAbove >= box.height + 8 || spaceAbove >= spaceBelow;
      const desiredTop = placeAbove ? anchor.top - box.height - 8 : anchor.bottom + 8;
      const top = Math.max(margin, Math.min(desiredTop, window.innerHeight - box.height - margin));
      panel.style.position = "fixed";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };
    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const transcript = root?.closest(".transcript");
    const firstItem = root?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)");
    firstItem?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
      }
    };
    const onScrollGesture = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    transcript?.addEventListener("wheel", onScrollGesture, { passive: true });
    transcript?.addEventListener("touchmove", onScrollGesture, { passive: true });
    window.addEventListener("wheel", onScrollGesture, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      transcript?.removeEventListener("wheel", onScrollGesture);
      transcript?.removeEventListener("touchmove", onScrollGesture);
      window.removeEventListener("wheel", onScrollGesture);
    };
  }, [onClose, open]);

  const activate = (action: () => void) => {
    action();
    onClose();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ??
        [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="message-actions-menu" ref={rootRef} data-open={open ? "true" : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="message-actions-menu__trigger"
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Message options"
        onClick={onToggle}
      >
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div
          id={menuId}
          ref={panelRef}
          className="message-actions-menu__panel"
          role="menu"
          aria-label="Message actions"
          onKeyDown={onMenuKeyDown}
        >
          {canRetry && (
            <>
              <button
                type="button"
                role="menuitem"
                className="message-actions-menu__item"
                onClick={() => activate(onRetry)}
              >
                Retry send
              </button>
              <button
                type="button"
                role="menuitem"
                className="message-actions-menu__item message-actions-menu__item--danger"
                onClick={() => activate(onDiscard)}
              >
                Discard draft
              </button>
              <div className="message-actions-menu__separator" role="separator" />
            </>
          )}

          <div
            className="message-actions-menu__reactions"
            role="group"
            aria-label="Quick reactions"
          >
            {QUICK_REACTIONS.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                role="menuitem"
                className={`message-actions-menu__reaction${
                  message.reactions[meId] === reaction.emoji ? " is-on" : ""
                }`}
                aria-label={`React ${reaction.label}`}
                title={reaction.label}
                onClick={() => activate(() => onReact(reaction.emoji))}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="message-actions-menu__reaction message-actions-menu__reaction--more"
              aria-label="More emojis"
              title="More emojis"
              onClick={() => activate(onMoreReactions)}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          <div className="message-actions-menu__separator" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="message-actions-menu__item"
            onClick={() => activate(onReply)}
          >
            Reply
          </button>
          <button
            type="button"
            role="menuitem"
            className="message-actions-menu__item"
            disabled={!canCopy}
            onClick={() => activate(onCopy)}
          >
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            className="message-actions-menu__item"
            onClick={() => activate(onInfo)}
          >
            Info
          </button>
          <button
            type="button"
            role="menuitem"
            className="message-actions-menu__item"
            title={!canForward ? forwardReason : undefined}
            disabled={!canForward}
            onClick={() => activate(onForward)}
          >
            Forward
          </button>
          {canEdit && (
            <button
              type="button"
              role="menuitem"
              className="message-actions-menu__item"
              onClick={() => activate(onEdit)}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="message-actions-menu__item"
            aria-label={selected ? "Unselect this message" : "Select this message"}
            onClick={() => activate(onToggleSelect)}
          >
            {selected ? "Unselect" : "Select"}
          </button>
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className="message-actions-menu__item message-actions-menu__item--danger"
              onClick={() => activate(onDelete)}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
