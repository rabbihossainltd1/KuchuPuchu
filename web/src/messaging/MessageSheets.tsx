/**
 * Slice Z — the two message-level sheets the phone's long-press offers:
 *
 *  • `ReactionPickerSheet` — the phone's `EmojiSheetDialog`: title "React",
 *    the same forty emojis in five-per-row seats.
 *  • `MessageInfoSheet` — the phone's r103-4 info sheet: "Message info" with
 *    Sent / Delivered / Seen (own rows) or Received (theirs), values in the
 *    phone's "23 Sep, 10:45 AM" stamp.
 */

import { useEffect } from "react";
import type { MessageRow } from "./protocol";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** The phone's EmojiSheetDialog list, verbatim (the doubled 😴 included). */
export const REACTION_EMOJIS = [
  "\u{1F44D}",
  "\u{1F44E}",
  "\u{2764}\u{FE0F}",
  "\u{1FA77}",
  "\u{1F602}",
  "\u{1F970}",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F621}",
  "\u{1F64F}",
  "\u{1F525}",
  "\u{1F389}",
  "\u{1F60D}",
  "\u{1F62D}",
  "\u{1F605}",
  "\u{1F914}",
  "\u{1F4AF}",
  "\u{1F44F}",
  "\u{1F91D}",
  "\u{1F60E}",
  "\u{1F973}",
  "\u{1F634}",
  "\u{1F92F}",
  "\u{1F631}",
  "\u{1F917}",
  "\u{1F607}",
  "\u{1F609}",
  "\u{1F92B}",
  "\u{270C}\u{FE0F}",
  "\u{1F4AA}",
  "\u{1F31F}",
  "\u{2B50}",
  "\u{2764}\u{FE0F}\u{200D}\u{1F525}",
  "\u{1F60A}",
  "\u{1F643}",
  "\u{1F60C}",
  "\u{1F62C}",
  "\u{1FAE1}",
  "\u{1F929}",
  "\u{1F634}",
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** The phone's `infoStamp`: "23 Sep, 10:45 AM" on the reader's clock. */
export function infoStamp(iso: string): string {
  if (!iso) return "-";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "-";
  const at = new Date(time);
  const hour = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12;
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${hour}:${String(at.getMinutes()).padStart(
    2,
    "0",
  )} ${at.getHours() < 12 ? "AM" : "PM"}`;
}

export function ReactionPickerSheet({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const rows: string[][] = [];
  for (let i = 0; i < REACTION_EMOJIS.length; i += 5) rows.push(REACTION_EMOJIS.slice(i, i + 5));
  return (
    <div className="chat-menu-overlay" role="presentation" onClick={onClose}>
      <div
        className="chat-menu react-picker"
        role="dialog"
        aria-label="React"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="chat-menu__title">React</p>
        {rows.map((row, rowIndex) => (
          <div className="react-picker__row" key={rowIndex}>
            {row.map((emoji, emojiIndex) => (
              <button
                key={`${rowIndex}-${emojiIndex}`}
                type="button"
                aria-label={`React ${emoji}`}
                onClick={() => {
                  onPick(emoji);
                  onClose();
                }}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MessageInfoSheet({
  message,
  meId,
  otherReadAt,
  onClose,
}: {
  message: MessageRow;
  meId: string;
  otherReadAt: string;
  onClose: () => void;
}) {
  useEscape(onClose);
  const mine = message.senderId === meId;
  const seen =
    Boolean(otherReadAt) &&
    !Number.isNaN(Date.parse(otherReadAt)) &&
    Date.parse(message.createdAt) <= Date.parse(otherReadAt);
  return (
    <div className="chat-menu-overlay" role="presentation" onClick={onClose}>
      <div
        className="chat-menu info-sheet"
        role="dialog"
        aria-label="Message info"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="chat-menu__title">Message info</p>
        <div className="info-sheet__row">
          <span>Sent</span>
          <span>{infoStamp(message.createdAt)}</span>
        </div>
        {mine ? (
          <>
            <div className="info-sheet__row">
              <span>Delivered</span>
              <span>{message.deliveredAt ? infoStamp(message.deliveredAt) : "Not yet"}</span>
            </div>
            <div className="info-sheet__row">
              <span>Seen</span>
              <span>{seen ? infoStamp(otherReadAt) : "Not yet"}</span>
            </div>
          </>
        ) : (
          <div className="info-sheet__row">
            <span>Received</span>
            <span>{infoStamp(message.createdAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
