import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { originRealmOf } from "../../web/src/messaging/realmBadge.ts";
import { parseMessageRow } from "../../web/src/messaging/protocol.ts";
import { parseStatusAuthor } from "../../web/src/status/statusModel.ts";
for (const realm of ["kp", "vx"]) {
  assert.equal(originRealmOf({ originRealm: realm }), realm);
  assert.equal(originRealmOf({ origin_realm: realm }), realm);
  const message = parseMessageRow({ id: "m", senderRealm: realm });
  assert.equal(message.senderRealm, realm);
  assert.equal(parseStatusAuthor({ id: "u", originRealm: realm }).originRealm, realm);
  const svg = readFileSync(`web/src/assets/${realm}-badge.svg`, "utf8");
  assert(svg.includes(">" + realm.toUpperCase() + "</text>"));
  const png = readFileSync(
    `native-android/app/src/main/res/drawable-nodpi/realm_badge_${realm}.png`,
  );
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  console.log(`OK ${realm}: trusted realm and original SVG/Android image are retained`);
}
assert.equal(originRealmOf({ username: "vx", id: "kp" }), null);
assert.equal(originRealmOf({ originRealm: "unknown" }), null);
assert.equal(parseStatusAuthor({ id: "u", originRealm: "unknown" }).originRealm, undefined);
const badges = readFileSync("web/src/messaging/Badges.tsx", "utf8");
assert(!badges.includes('if (badge === "none") return null'));
assert(badges.includes("<RealmBadge realm={realm} />"));
console.log("OK origin badge cannot be hidden by verification preference or guessed from a name");
