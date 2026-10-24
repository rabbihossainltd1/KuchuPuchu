import type { OriginRealm } from "./realmBadge";
import { realmLabel } from "./realmBadge";
import vxBadge from "../assets/vx-badge.svg";

/** Original owner-supplied artwork, never a user-selectable verification badge. */
export function RealmBadge({ realm }: { readonly realm: OriginRealm | null }) {
  const label = realmLabel(realm);
  if (realm !== "vx" || !label) return null;
  return (
    <img
      className={`realm-badge realm-badge--${realm}`}
      src={vxBadge}
      alt={`${label} account origin`}
      width={16}
      height={16}
      draggable={false}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, marginLeft: 4 }}
    />
  );
}
