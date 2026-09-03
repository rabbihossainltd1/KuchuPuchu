// Bug: "on another user's profile the picture reloads on every app start when online,
// but stays loaded when offline."
//
// The app already has a persistent, immutable per-version avatar cache — `AvatarRefs`
// (SharedPreferences, keyed `<userId>@v<avatarVersion>`, warmed at process start) — and
// every light payload carries that `avatarRef` precisely so a screen never has to wait
// for bytes. The profile screen was the one place that ignored it: it read
// `u.optText("avatarUrl")` straight off the payload and passed no `avatarRef`, so
//   * offline  — the cached payload still had the old data-URI -> instant, and
//   * online   — the light snapshot has `avatarUrl: null`, so nothing could paint
//                until `GET /api/users/:id` answered, then a fresh ~80KB base64
//                decode: the visible "loads again every restart".
// The fix is to render the *resolved* value (cache first, payload second) and to hand
// the ref to `KpAvatar`, which is also what files the bytes under that ref for
// everybody else.
//
// Case 28 keeps the fix from rotting: it checks the call site, the resolver's
// invariants, and — the part that generalises — the exact set of `KpAvatar` call sites
// that still ignore `avatarRef`. Fixing one means deleting it from the list; adding a
// new one fails here.

import { readFileSync, readdirSync } from "node:fs";

const DIR = "native-android/app/src/main/java/app/kuchupuchu/android";
const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}${name}${!cond && detail ? `  -> ${detail}` : ""}`);

const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");
/** Kotlin source is prettier-wrapped; match against collapsed whitespace. */
const flat = (t) => t.replace(/\s+/g, " ");
const profile = read("ProfileScreen.kt");
const ui = read("Ui.kt");
const cache = read("Cache.kt");

/** Every `KpAvatar(` call, with its full argument text (balanced-paren scan). */
function avatarSites() {
  const sites = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".kt"))) {
    const src = readFileSync(`${DIR}/${f}`, "utf8");
    for (const m of src.matchAll(/KpAvatar\(/g)) {
      // `fun KpAvatar(` is the definition, not a call site.
      if (/fun\s*$/.test(src.slice(Math.max(0, m.index - 8), m.index))) continue;
      let i = m.index + "KpAvatar(".length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      sites.push({
        file: f,
        text: src.slice(m.index, i).replace(/\s+/g, " ").trim(),
      });
    }
  }
  return sites;
}

const sites = avatarSites();

// ---------------------------------------------------------- 1. the profile call site
{
  const site = sites.filter((s) => s.file === "ProfileScreen.kt");
  check("the profile screen renders exactly one avatar", site.length === 1, `sites=${site.length}`);
  const call = flat(site[0]?.text ?? "");
  check("and it passes the cache token to KpAvatar", /avatarRef = avatarRef/.test(call), call);
  check(
    "the rendered value is the resolved one, not the payload field",
    /, shownAvatar,/.test(call) && !/KpAvatar\(.*optText\("avatarUrl"\)/.test(call),
    call,
  );
  check(
    'the token is read with optIso, so a JSON null is absent (not the text "null")',
    /val avatarRef = u\.optIso\("avatarRef"\)/.test(profile),
  );
  check(
    "the resolution happens once and the circle + full-screen viewer share it",
    /val shownAvatar = rememberAvatarUrl\(u\.optText\("avatarUrl"\)\.ifBlank \{ null \}, avatarRef\)/.test(
      profile,
    ) &&
      /clickable \{ shownAvatar\?\.takeIf \{ it\.isNotBlank\(\) \}\?\.let \{ viewerUrl = it \} \}/.test(
        profile,
      ),
    profile.match(/viewerUrl = it[^)]*/)?.[0],
  );
  check(
    "the tap-to-zoom path no longer reads the raw payload field",
    !/optText\("avatarUrl"\)\.takeIf/.test(profile),
  );
  check(
    "the screen still paints its first frame from the cached conversation row (that row carries avatarRef)",
    /profileSnapshot\(userId\)/.test(profile) && /ScreenStore\.convs\.forEach/.test(profile),
  );
}

// ------------------------------------------------------------- 2. resolver invariants
{
  check(
    "rememberAvatarUrl is callable from a screen (not private to Ui.kt)",
    /^\s*fun rememberAvatarUrl\(/m.test(ui) && !/private fun rememberAvatarUrl/.test(ui),
  );
  const uiFlat = flat(ui);
  const body = flat(ui.slice(ui.indexOf("fun rememberAvatarUrl(")));
  check("cache beats payload", /AvatarRefs\.get\(ctx, ref\) \?: inline/.test(body));
  check(
    "a data-URI that is being rendered is filed under the ref (so every light row reuses it)",
    /have\.startsWith\("data:"\) && AvatarRefs\.get\(ctx, ref\) == null/.test(body) &&
      /AvatarRefs\.put\(ctx, ref, have\)/.test(body),
  );
  check(
    "an http URL is never pinned into the persistent cache",
    /Only the immutable data-URI belongs in the persistent cache/.test(ui) &&
      /avatarUrl"\)\.takeIf \{ it\.startsWith\("data:"\)/.test(body),
  );
  check(
    "a miss costs one forced fetch, not a stale answer",
    /Api\.get\("\/api\/users\/\$userId\/avatar", force = true\)/.test(body),
  );
  check(
    'the org.json "null" string is treated as absent at the choke point',
    /raw\?\.trim\(\)\?\.takeUnless \{ it\.isEmpty\(\) \|\| it == "null" \}/.test(uiFlat),
  );
  check(
    "the prefs file name is a top-level const (a `const val` inside the object will not compile) and is the cache's identity",
    /private const val AVATAR_PREFS = "kp_avatars"/.test(uiFlat) &&
      /getSharedPreferences\(AVATAR_PREFS, 0\)/.test(uiFlat),
  );
  check(
    "the map is warmed at process start, so a composition never waits on disk",
    /runCatching \{ AvatarRefs\.warm\(app\) \}/.test(cache),
  );
}

// ------------------------------------------------- 3. the status screen sees changes
{
  const status = read("StatusScreens.kt");
  const store = read("Store.kt");
  const api = read("Api.kt");
  const ring = ui.slice(ui.indexOf("fun StatusRingAvatar("));
  check(
    "StatusRingAvatar takes a cache token and forwards it to KpAvatar",
    /avatarRef: String\? = null/.test(ring.slice(0, 400)) &&
      /KpAvatar\(.*avatarRef = avatarRef/.test(flat(ring).slice(0, 1600)),
  );
  const ringSites = [...status.matchAll(/StatusRingAvatar\(/g)].map((m) => {
    let i = m.index + "StatusRingAvatar(".length;
    let depth = 1;
    while (i < status.length && depth > 0) {
      if (status[i] === "(") depth++;
      else if (status[i] === ")") depth--;
      i++;
    }
    return flat(status.slice(m.index, i));
  });
  check(
    "every status rail row passes the token (mine and each contact's)",
    ringSites.length >= 2 && ringSites.every((t) => /avatarRef =/.test(t)),
    JSON.stringify(ringSites.map((t) => t.slice(0, 60))),
  );
  check(
    "the viewer header and the seen-by list resolve through the cache too",
    /avatarRef = user\?\.optIso\("avatarRef"\) \?: Store\.me\?\.optIso\("avatarRef"\)/.test(
      status,
    ) && /avatarRef = u\?\.optIso\("avatarRef"\)/.test(status),
  );
  check(
    "Store.me is Compose state (a write must invalidate the readers)",
    /var me: JSONObject\? by mutableStateOf<JSONObject\?>\(null\)/.test(flat(store)) &&
      !/@Volatile\s+var me/.test(store),
  );
  check(
    "it is read through that property everywhere (no private backing field to drift)",
    /private set/.test(store) &&
      /fun saveMe\(user: JSONObject\?\)/.test(store) &&
      /me = user/.test(store),
  );
  check(
    "a profile write busts the payload that embeds my avatar, not just /api/me",
    /path\.contains\("\/api\/me"\)[\s\S]{0,500}?Cache\.bustAll\("\/api\/statuses"\)/.test(
      flat(api),
    ),
    api.slice(api.indexOf("fun bustFor"), api.indexOf("fun bustFor") + 420),
  );
  check(
    "and a JVM test asserts the delegate type, so the state-ness is proven, not eyeballed",
    readFileSync(
      "native-android/app/src/test/java/app/kuchupuchu/android/StoreStateTest.kt",
      "utf8",
    ).includes('getDeclaredField("me\\$delegate")') &&
      readFileSync(
        "native-android/app/src/test/java/app/kuchupuchu/android/StoreStateTest.kt",
        "utf8",
      ).includes("MutableState<*>"),
  );
}

// --------------------------------------- 4. the shrinking allow-list (the real guard)
{
  const refless = sites
    .filter((s) => !/avatarRef\s*=/.test(s.text))
    .map((s) => `${s.file} ${s.text.slice(0, 78)}`)
    .sort();
  const known = [
    // Call UI: `CallUi.otherAvatar` is a string copied out of the signalling payload,
    // and no avatar token crosses that boundary yet (its own bug, its own step).
    "CallScreens.kt KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 108.dp, ring = fal",
    "CallScreens.kt KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 116.dp, ring = fal",
    "CallScreens.kt KpAvatar(call.otherName, call.otherAvatar.ifBlank { null }, 84.dp, ring = fals",
    // Own profile editor: this screen owns the value it just wrote (it PATCHes and
    // installs the response), so the cache would add a hop, not fix a staleness.
    'SettingsScreen.kt KpAvatar( me.value.optText("displayName"), me.value.optIso("avatarUrl"), 76.dp',
    // Owner profile card (AI chat): a static name-initial avatar for a person
    // who is not a server user row — there is no avatarRef to carry.
    'ChatScreen.kt KpAvatar("Rabbi Hossain", null, 46.dp, ring = false)',
  ].sort();
  check(
    "no new avatar renders outside the cache, and none of the known ones silently got worse",
    JSON.stringify(refless) === JSON.stringify(known),
    `found ${refless.length}, expected ${known.length}: ${JSON.stringify(refless.filter((r) => !known.includes(r)))}`,
  );
  check(
    "ProfileScreen.kt is no longer in that list (the profile-reloads-every-start bug)",
    !refless.some((r) => r.startsWith("ProfileScreen.kt")),
  );
  check(
    "neither is StatusScreens.kt, nor the StatusRingAvatar pass-through (the status-staleness bug)",
    !refless.some((r) => r.startsWith("StatusScreens.kt") || r.startsWith("Ui.kt")),
    JSON.stringify(refless),
  );
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(lines.some((l) => l.startsWith("  BROKEN")) ? 1 : 0);
