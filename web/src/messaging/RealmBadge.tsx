import type { OriginRealm } from "./realmBadge";
import { realmLabel } from "./realmBadge";

export function RealmBadge({ realm }: { readonly realm: OriginRealm | null }) {
  const label = realmLabel(realm);
  if (!label) return null;
  return (
    <span className={`realm-badge realm-badge--${realm}`} aria-label={`${label} account origin`}>
      {label}
    </span>
  );
}
