import { RealmBadge } from "./RealmBadge";
import { originRealmOf } from "./realmBadge";

/**
 * Account badges, phone parity (`Ui.kt` UserBadges): the blue verified seal
 * (12-scallop starburst + white check, drawn from the same polar geometry as
 * the Android Canvas) and the owner's crossed-tools moderator mark (the two
 * paths of `res/drawable/ic_moderator_badge.xml`, one shared gradient).
 *
 * The server's `badge` field is the account's CHOICE of what to show —
 * "none" hides everything; a choice for a badge the account lost falls back
 * server-side to "show what you have", so the browser only applies the rule.
 */

const SEAL_STEPS = 24; // 12 scallops, like the classic verified seal

/** Unit-radius seal polygon, precomputed once (deterministic, matches Ui.kt). */
const SEAL_POINTS = (() => {
  const pts: string[] = [];
  for (let i = 0; i < SEAL_STEPS; i++) {
    const ang = (i * 2 * Math.PI) / SEAL_STEPS;
    const rad = i % 2 === 0 ? 50 : 42;
    pts.push(`${(50 + rad * Math.cos(ang)).toFixed(2)},${(50 + rad * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(" ");
})();

export function VerifiedSeal({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="badge-seal"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Verified"
    >
      <polygon points={SEAL_POINTS} fill="#1D9BF0" />
      <path
        d="M 30 54 L 44 67 L 72 36"
        fill="none"
        stroke="#fff"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Crossed tools, ported from `ic_moderator_badge.xml` (1312x1199 viewport). */
export function ModeratorBadge({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="badge-moderator"
      width={size}
      height={Math.round(size * (1199 / 1312))}
      viewBox="0 0 1312 1199"
      role="img"
      aria-label="Moderator"
    >
      <defs>
        <linearGradient id="kp-mod-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B9BDFF" />
          <stop offset="0.25" stopColor="#7F85F2" />
          <stop offset="0.6" stopColor="#4E5DE0" />
          <stop offset="1" stopColor="#2736C7" />
        </linearGradient>
      </defs>
      <g
        fill="url(#kp-mod-grad)"
        stroke="#1626A8"
        strokeWidth="8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M 221.0,150.0 L165.0,190.0 L102.0,262.0 L80.0,306.0 L80.0,327.0 L86.0,344.0 L97.0,359.0 L116.0,370.0 L163.0,365.0 L178.0,371.0 L444.0,638.0 L458.0,644.0 L478.0,640.0 L570.0,549.0 L575.0,537.0 L571.0,511.0 L304.0,243.0 L303.0,169.0 L297.0,157.0 L279.0,144.0 L262.0,140.0 L244.0,141.0 Z" />
        <path d="M 1119.0,209.0 L1068.0,185.0 L1003.0,200.0 L819.0,76.0 L719.0,38.0 L639.0,28.0 L639.0,60.0 L836.0,356.0 L838.0,385.0 L653.0,574.0 L178.0,1010.0 L157.0,1072.0 L183.0,1129.0 L243.0,1160.0 L306.0,1145.0 L641.0,821.0 L726.0,908.0 L736.0,966.0 L937.0,1173.0 L985.0,1174.0 L1077.0,1087.0 L1099.0,1051.0 L1087.0,1015.0 L884.0,810.0 L862.0,799.0 L828.0,806.0 L743.0,720.0 L965.0,506.0 L1001.0,510.0 L1044.0,553.0 L1050.0,580.0 L1104.0,625.0 L1178.0,593.0 L1242.0,526.0 L1257.0,464.0 L1148.0,360.0 L1166.0,293.0 Z" />
      </g>
    </svg>
  );
}

/**
 * The account's badges exactly as the phone draws them (`Ui.kt` UserBadges):
 * `badge` = "verified" / "moderator" shows that one, "none" hides both, and
 * null shows every badge the account holds.
 */
export function UserBadges({
  verified,
  moderator,
  badge,
  size = 15,
  user,
}: {
  verified: boolean;
  moderator?: boolean;
  badge?: string | null;
  size?: number;
  user?: unknown;
}) {
  const realm = originRealmOf(user);
  const showVerified = badge !== "none" && verified && (badge == null || badge === "verified");
  const showModerator =
    badge !== "none" && Boolean(moderator) && (badge == null || badge === "moderator");
  if (!realm && !showVerified && !showModerator) return null;
  return (
    <span className="user-badges">
      <RealmBadge realm={realm} />
      {showVerified ? <VerifiedSeal size={size} /> : null}
      {showModerator ? <ModeratorBadge size={size} /> : null}
    </span>
  );
}
