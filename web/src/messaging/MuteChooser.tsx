/**
 * The phone's KpMuteChooser (r69): one chooser for every place a chat can
 * be muted — "Mute all / Unmute all" on top, then the two single-aspect
 * rows, each flipping only its own half. Labels read the state they will
 * produce, so a half-muted chat can move either half without touching the
 * other.
 */

import { Icon } from "../icons";

export function MuteChooser({
  callMuted,
  msgMuted,
  onPick,
}: {
  callMuted: boolean;
  msgMuted: boolean;
  onPick: (callOff: boolean, msgOff: boolean) => void;
}) {
  const allMuted = callMuted && msgMuted;
  const rows: {
    icon: "bell" | "bellOff" | "phone" | "phoneOff";
    label: string;
    pick: () => void;
  }[] = [
    {
      icon: allMuted ? "bell" : "bellOff",
      label: allMuted ? "Unmute all" : "Mute all",
      pick: () => onPick(!allMuted, !allMuted),
    },
    {
      icon: callMuted ? "phone" : "phoneOff",
      label: callMuted ? "Unmute calls" : "Mute calls",
      pick: () => onPick(!callMuted, msgMuted),
    },
    {
      icon: msgMuted ? "bell" : "bellOff",
      label: msgMuted ? "Unmute messages" : "Mute messages",
      pick: () => onPick(callMuted, !msgMuted),
    },
  ];
  return (
    <div className="mute-chooser" role="group" aria-label="Mute">
      {rows.map((item) => (
        <button key={item.label} type="button" className="chat-menu__row" onClick={item.pick}>
          <Icon name={item.icon} size={18} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
