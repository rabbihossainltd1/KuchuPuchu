export type OriginRealm = "kp" | "vx";

type RealmValue = {
  readonly originRealm?: unknown;
  readonly origin_realm?: unknown;
  readonly realm?: unknown;
};

/** Immutable origin realm from a server response; unknown values stay unbadged. */
export function originRealmOf(value: unknown): OriginRealm | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RealmValue;
  const realm = row.originRealm ?? row.origin_realm ?? row.realm;
  return realm === "kp" || realm === "vx" ? realm : null;
}

export function realmLabel(realm: OriginRealm | null): string {
  return realm === "kp" ? "KP" : realm === "vx" ? "VX" : "";
}
