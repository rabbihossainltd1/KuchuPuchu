import { ringArcs, STATUS_RING_UNSEEN, STATUS_RING_SEEN } from "./statusModel";

/**
 * The segmented ring around a status author's picture.
 *
 * One arc per status, separated by the phone's 5 dp gap, starting at twelve
 * o'clock (`ringArcs` reproduces `StatusRingAvatar`'s Canvas maths), and the
 * colour is the owner's round-25 rule: dark blue while anything is unseen,
 * gray once every status of that author has been viewed. The ring is
 * decoration — the row beside it carries the name, the count and the stamp as
 * text, so nothing here is the only place a fact appears.
 */
export function StatusRing({
  name,
  avatarUrl,
  size = 48,
  segments,
  seen,
}: {
  readonly name: string;
  readonly avatarUrl: string;
  readonly size?: number;
  readonly segments: number;
  readonly seen: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const stroke = 2.5;
  return (
    <span
      className={`status-ring${seen ? " status-ring--seen" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg
        className="status-ring__svg"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        {ringArcs(segments, size, stroke).map((path, index) => (
          <path
            // The arcs are positional decoration; one key per index is right.
            key={index}
            d={path}
            fill="none"
            stroke={seen ? STATUS_RING_SEEN : STATUS_RING_UNSEEN}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <span
        className="status-ring__avatar"
        style={{ width: size - stroke * 2, height: size - stroke * 2 }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" width={size - stroke * 2} height={size - stroke * 2} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </span>
      <span className="sr-only">
        {segments} status{segments === 1 ? "" : "es"}
        {seen ? ", all viewed" : ", not viewed yet"}
      </span>
    </span>
  );
}
