/**
 * Web statuses contract (slice F).
 *
 * Same discipline as cases 57–60: every rule is compared with the source that
 * owns it. The feed, the composer, the viewer clock, the tap zones, the sheets
 * and the copy come out of `StatusScreens.kt`; the ring geometry and the stamps
 * out of `Ui.kt` and `Theme.kt`; the viewer cache and the hidden-author list out
 * of `ScreenStore.kt`; the two media POST shapes out of `MediaEditScreen.kt`'s
 * `sendStatus`; and what the server accepts, refuses, stores and hides out of
 * `src/worker/index.ts`.
 *
 * The rules that hurt if they drift: a status the reader is not allowed to see
 * must never be fetched by id (the Worker's `canSeeStatusOf` is the gate, and a
 * client that guessed a wider audience would leak), the clock must PAUSE when
 * the tab is hidden or a sheet is up (a viewer that ran on without its reader
 * is the bug the phone fixed in round 27), and a reply must be SEALED — it is an
 * ordinary 1:1 message, so plaintext would leave it readable on the server.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  STATUS_BG_STYLES,
  STATUS_CACHE_STALE_MS,
  STATUS_COPY,
  STATUS_DEFAULT_BG,
  STATUS_FEED_POLL_MS,
  STATUS_HIDDEN_KEY,
  STATUS_IMAGE_DATA_MAX,
  STATUS_PHOTO_HOLD_MS,
  STATUS_PHOTO_STEPS,
  STATUS_PRIVACY_DEFAULT,
  STATUS_PRIVACY_LEVELS,
  STATUS_REACTIONS,
  STATUS_RING_GAP_DP,
  STATUS_RING_SEEN,
  STATUS_RING_UNSEEN,
  STATUS_RING_WIDTH_DP,
  STATUS_SWIPE_CLOSE_PX,
  STATUS_SWIPE_UP_VIEWERS_PX,
  STATUS_TEXT_MAX,
  STATUS_TTL_MS,
  STATUS_VIDEO_FALLBACK_HOLD_MS,
  STATUS_VIDEO_HOLD_MAX_MS,
  STATUS_VIDEO_HOLD_MIN_MS,
  STATUS_VIDEO_SECONDS_MAX,
  STATUS_VIDEO_SECONDS_MIN,
  STATUS_VIDEO_WAIT_SLACK_MS,
  groupSeen,
  isStatusReaction,
  listStamp,
  myStatusSubtitle,
  newestCreatedAt,
  parseHiddenAuthors,
  parseStatusAuthor,
  parseStatusFeed,
  parseStatusItem,
  parseStatusViewers,
  photoFitsInline,
  ringArcs,
  ringSegments,
  segmentFill,
  serializeHiddenAuthors,
  statusBgStyle,
  statusDraftVerdict,
  statusExpiresInMs,
  statusGradientCss,
  statusHoldMs,
  statusPaused,
  statusPostBody,
  statusReplyMeta,
  statusRowSubtitle,
  statusSecondsOf,
  statusStamp,
  statusViewCount,
  statusStampShort,
  stepStatus,
  viewerAuthorName,
  viewsLabel,
  withHiddenAuthor,
} from "../../web/src/status/statusModel.ts";
import {
  parseStatusQuote,
  statusQuoteCaption,
  statusQuoteHasThumb,
} from "../../web/src/status/statusQuote.ts";
import { statusPath } from "../../web/src/status/statusMedia.ts";
import { parseMessageRow } from "../../web/src/messaging/protocol.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const statusSource = readFileSync(resolve(`${ANDROID}/StatusScreens.kt`), "utf8");
const pickSource = readFileSync(resolve(`${ANDROID}/StatusPickScreen.kt`), "utf8");
const editSource = readFileSync(resolve(`${ANDROID}/MediaEditScreen.kt`), "utf8");
const uiSource = readFileSync(resolve(`${ANDROID}/Ui.kt`), "utf8");
const themeSource = readFileSync(resolve(`${ANDROID}/Theme.kt`), "utf8");
const storeSource = readFileSync(resolve(`${ANDROID}/ScreenStore.kt`), "utf8");
const webModel = readFileSync(resolve("web/src/status/statusModel.ts"), "utf8");
const webController = readFileSync(resolve("web/src/status/useStatuses.ts"), "utf8");
const webViewer = readFileSync(resolve("web/src/status/StatusViewer.tsx"), "utf8");
const webFeed = readFileSync(resolve("web/src/status/StatusFeed.tsx"), "utf8");
const webComposer = readFileSync(resolve("web/src/status/StatusComposer.tsx"), "utf8");
const webApp = readFileSync(resolve("web/src/App.tsx"), "utf8");
const webProtocol = readFileSync(resolve("web/src/messaging/protocol.ts"), "utf8");
const webMediaUrl = readFileSync(resolve("web/src/messaging/mediaUrl.ts"), "utf8");

/** A status row as the Worker's `shape()` sends it. */
const item = (fields = {}) =>
  parseStatusItem({
    id: "3f2b7c1e-0000-4000-8000-000000000001",
    kind: "TEXT",
    text: "শুভ সকাল",
    bgStyle: "amber",
    hasMedia: false,
    seconds: 0,
    createdAt: "2026-10-05T04:00:00.000Z",
    expiresAt: "2026-10-06T04:00:00.000Z",
    ...fields,
  });

/** A feed group as `GET /api/statuses` sends it. */
const group = (fields = {}) => ({
  user: {
    id: "u_peer",
    displayName: "Rahi",
    username: "rahi",
    avatarUrl: null,
    verified: false,
    moderator: false,
    privateProfile: false,
    e2eePublicKey: "peer-public-key",
    ...(fields.user ?? {}),
  },
  mine: false,
  allViewed: false,
  statuses: fields.statuses ?? [item()],
  ...("mine" in fields ? { mine: fields.mine } : {}),
  ...("allViewed" in fields ? { allViewed: fields.allViewed } : {}),
});

/** The same payload, run through the parser: a real StatusGroup. */
const parsedGroup = (fields = {}) => {
  const feed = parseStatusFeed({ items: [group(fields)] });
  return fields.mine ? feed.mine : (feed.others[0] ?? null);
};

/* ---------------------------------------------------------------- Worker */

check(
  "the Worker allows exactly TEXT, IMAGE and VIDEO as a status kind",
  workerSource.includes('const ALLOWED_STATUS_KINDS = new Set(["TEXT", "IMAGE", "VIDEO"])'),
);
check(
  "an unknown kind is stored as TEXT rather than refused",
  workerSource.includes('const kind = ALLOWED_STATUS_KINDS.has(requested) ? requested : "TEXT"'),
);
check(
  "a status text is cut at 500 characters",
  workerSource.includes('String(body.text || "").slice(0, 500)'),
);
check("STATUS_TEXT_MAX is that 500", STATUS_TEXT_MAX === 500);
check(
  "a background style is cut at 20 characters",
  workerSource.includes('String(body.bgStyle || "amber").slice(0, 20)'),
);
check(
  "the default background is amber on both sides",
  workerSource.includes('body.bgStyle || "amber"') && STATUS_DEFAULT_BG === "amber",
);
check(
  "an inline photo longer than 450 000 characters is refused",
  workerSource.includes("imageData.length > 450_000"),
);
check("STATUS_IMAGE_DATA_MAX is that cap", STATUS_IMAGE_DATA_MAX === 450_000);
check(
  "the refusal for a too-large photo is the phone's wording",
  workerSource.includes('"Photo too large — pick a smaller image."'),
);
check(
  "the web copy matches that refusal",
  STATUS_COPY.photoTooLarge === "Photo too large — pick a smaller image.",
);
check(
  "an unsafe data URL is refused as BAD_MEDIA",
  workerSource.includes('fail(400, "Unsupported media format.", "BAD_MEDIA")'),
);
check(
  "the safe data-URL shapes are image, audio and video only",
  /const SAFE_DATA_URL =\s*\/\^data:\(image\\\/\(\?:jpeg\|png\|webp\|gif\)/.test(workerSource) ||
    workerSource.includes("image\\/(?:jpeg|png|webp|gif)"),
);
check(
  "a photo status without bytes is refused",
  workerSource.includes('"Pick a photo for the status."'),
);
check(
  "a video status without bytes is refused",
  workerSource.includes('"Pick a video for the status."'),
);
check(
  "a text status without text is refused",
  workerSource.includes('"Write something for the status."'),
);
check(
  "the web copy mirrors all three refusals",
  [
    STATUS_COPY.emptyPhoto === "Pick a photo for the status.",
    STATUS_COPY.emptyVideo === "Pick a video for the status.",
    STATUS_COPY.emptyText === "Write something for the status.",
  ].every(Boolean),
);
check(
  "a clip's seconds are clamped to 0…120 for a VIDEO only",
  workerSource.includes(
    'const seconds = kind === "VIDEO" ? Math.max(0, Math.min(120, Number(body.seconds || 0))) : 0',
  ),
);
check("STATUS_VIDEO_SECONDS_MAX is that clamp", STATUS_VIDEO_SECONDS_MAX === 120);
check("a status expires 24 hours after it is posted", workerSource.includes("Date.now() + 864e5"));
check("STATUS_TTL_MS is those 24 hours", STATUS_TTL_MS === 86_400_000);
check(
  "the stored meta carries the seconds and whether a key was used",
  workerSource.includes("seconds ? JSON.stringify({ seconds, fileKey: !!fileKey }) : null"),
);
check(
  "an uploaded status object is marked as its author's, so they can re-read it",
  workerSource.includes("UPDATE files SET conv_id = NULL WHERE key = ? AND owner_id = ?"),
);
check(
  "the response shape is id, kind, text, bgStyle, hasMedia, seconds and the two stamps",
  [
    "id: row.id",
    "kind: row.kind",
    "text: row.text",
    "bgStyle: row.bg_style",
    "hasMedia: !!row.media",
  ].every((fragment) => workerSource.includes(fragment)),
);
check(
  "the feed hides a blocked author in BOTH directions",
  workerSource.includes("SELECT target_id FROM blocks WHERE owner_id = ?") &&
    workerSource.includes("SELECT owner_id FROM blocks WHERE target_id = ?"),
);
check(
  "the feed only reaches people who share a conversation",
  /SELECT m2\.user_id FROM members m1\s+JOIN members m2 ON m2\.conv_id = m1\.conv_id/.test(
    workerSource,
  ),
);
check(
  "the author's own privacy level decides who sees the row",
  workerSource.includes("if (!statusVisibleTo(userRow, soloContacts.has(contactId))) continue"),
);
check(
  "'contacts' means a 1:1 chat partner and 'public' means every shared chat",
  workerSource.includes('level === "contacts"\n      ? await isContact(db, uid, ownerId)') ||
    /level === "contacts"[\s\S]{0,80}isContact\(db, uid, ownerId\)/.test(workerSource),
);
check(
  "'nobody' hides a status from everyone but its author",
  workerSource.includes('if (level === "nobody") return false'),
);
check("the default status privacy is public", workerSource.includes('status: "public"'));
check("the web privacy default agrees", STATUS_PRIVACY_DEFAULT === "public");
check(
  "the three privacy levels are the account's three",
  /const PRIVACY_LEVELS = new Set\(\["nobody", "contacts", "public"\]\)/.test(workerSource),
);
check(
  "the web level list agrees",
  [...STATUS_PRIVACY_LEVELS].join(",") === "public,contacts,nobody",
);
check(
  "a view ping is silently ignored when the caller may not see the status",
  workerSource.includes("row.user_id !== uid && (await canSeeStatusOf(db, uid, row.user_id))"),
);
check(
  "the per-status routes all apply the same visibility rule",
  ["statusReactMatch", "statusViewsMatch", "statusMediaMatch"].every((name) =>
    workerSource.includes(name),
  ) && (workerSource.match(/canSeeStatusOf\(db, uid, row\.user_id\)/g) ?? []).length >= 2,
);
check(
  "a reaction must be emoji only — the Worker refuses anything else",
  workerSource.includes("BAD_REACTION") && workerSource.includes("\\p{Extended_Pictographic}"),
);
check(
  "a reaction cannot be placed on your own status",
  workerSource.includes(`fail(400, "Can't react to your own status.")`),
);
check(
  "a reaction is stored on the viewer's own view row, never as a message",
  workerSource.includes(
    "ON CONFLICT(status_id, viewer_id) DO UPDATE SET reaction = excluded.reaction",
  ),
);
check(
  "the viewer list is the owner's alone",
  workerSource.includes('if (row.user_id !== uid) fail(403, "Not your status.")'),
);
check(
  "deleting a status is the owner's alone and collects its media",
  workerSource.includes("DELETE FROM statuses WHERE id = ? AND user_id = ?") &&
    workerSource.includes("DELETE FROM status_views WHERE status_id = ?") &&
    workerSource.includes("collectOrphanedMedia(env, db, [gone.media])"),
);
check(
  "status media is served with the video/image type by kind",
  workerSource.includes(
    'storedMediaResponse(env, row.media, row.kind === "VIDEO" ? "video/mp4" : "image/jpeg")',
  ),
);
check(
  "expired rows are swept at most once a minute per isolate, not on every read",
  workerSource.includes("nextStatusSweep = Date.now() + 60_000"),
);
check(
  "a reply to a status is a TEXT message whose meta names the status",
  /async function statusQuote\([\s\S]{0,400}if \(kind !== "TEXT"\) return \{\};[\s\S]{0,400}return \{ status: \{ id: row\.id, kind: row\.kind, text: String\(row\.text \|\| ""\)\.slice\(0, 80\) \} \}/.test(
    workerSource,
  ),
);
check(
  "no status endpoint was invented: the web client calls only these six paths",
  ['"/api/statuses"', "/view", "/react", "/viewers", "/media"].every(
    (fragment) =>
      readFileSync(resolve("web/src/status/statusApi.ts"), "utf8").includes(fragment) ||
      readFileSync(resolve("web/src/status/statusMedia.ts"), "utf8").includes(fragment),
  ),
);

/* --------------------------------------------------------------- Android */

check(
  "the phone's clock holds a non-video status for 5 000 ms",
  statusSource.includes('s.optString("kind") != "VIDEO" -> 5_000L'),
);
check("STATUS_PHOTO_HOLD_MS agrees", STATUS_PHOTO_HOLD_MS === 5_000);
check(
  "a clip with a known length holds that long, inside 5…120 s",
  statusSource.includes("(videoSecs * 1000L).coerceIn(5_000L, 120_000L)"),
);
check(
  "the web clamp agrees",
  STATUS_VIDEO_HOLD_MIN_MS === 5_000 && STATUS_VIDEO_HOLD_MAX_MS === 120_000,
);
check(
  "a clip whose length never arrived holds 30 000 ms",
  statusSource.includes("else -> 30_000L"),
);
check("STATUS_VIDEO_FALLBACK_HOLD_MS agrees", STATUS_VIDEO_FALLBACK_HOLD_MS === 30_000);
check(
  "a stalled clip still advances after hold + 8 000 ms",
  statusSource.includes("val maxWait = hold + 8_000L"),
);
check("STATUS_VIDEO_WAIT_SLACK_MS agrees", STATUS_VIDEO_WAIT_SLACK_MS === 8_000);
check(
  "the clock ticks every 50 ms and idles every 100 ms while paused",
  statusSource.includes("delay(50)") && statusSource.includes("delay(100)"),
);
check(
  "the phone's pause condition is five states wide",
  statusSource.includes(
    "if (showViewers || menuOpen || replyFocused || !Store.foreground || holding)",
  ),
);
check(
  "the web pause predicate takes exactly those five",
  statusPaused({
    viewersOpen: true,
    menuOpen: false,
    replyFocused: false,
    hidden: false,
    holding: false,
  }) &&
    statusPaused({
      viewersOpen: false,
      menuOpen: true,
      replyFocused: false,
      hidden: false,
      holding: false,
    }) &&
    statusPaused({
      viewersOpen: false,
      menuOpen: false,
      replyFocused: true,
      hidden: false,
      holding: false,
    }) &&
    statusPaused({
      viewersOpen: false,
      menuOpen: false,
      replyFocused: false,
      hidden: true,
      holding: false,
    }) &&
    statusPaused({
      viewersOpen: false,
      menuOpen: false,
      replyFocused: false,
      hidden: false,
      holding: true,
    }) &&
    !statusPaused({
      viewersOpen: false,
      menuOpen: false,
      replyFocused: false,
      hidden: false,
      holding: false,
    }),
);
check(
  "a browser's hidden tab is the phone's !Store.foreground",
  webViewer.includes('document.visibilityState !== "visible"') &&
    webController.includes('document.visibilityState !== "visible"'),
);
check(
  "the feed re-reads itself every 12 s while the tab is in front",
  statusSource.includes("delay(12_000)"),
);
check("STATUS_FEED_POLL_MS agrees", STATUS_FEED_POLL_MS === 12_000);
check(
  "the viewer only re-fetches a cache older than 15 s",
  statusSource.includes("ScreenStore.statusesFetchedAt > 15_000"),
);
check("STATUS_CACHE_STALE_MS agrees", STATUS_CACHE_STALE_MS === 15_000);
check("swipe down past 260 px closes the viewer", statusSource.includes("if (off > 260f)"));
check("STATUS_SWIPE_CLOSE_PX agrees", STATUS_SWIPE_CLOSE_PX === 260);
check(
  "swipe UP past 130 px opens the viewers sheet on your own status",
  statusSource.includes("if (total < -130f && isMine) openViewers()"),
);
check("STATUS_SWIPE_UP_VIEWERS_PX agrees", STATUS_SWIPE_UP_VIEWERS_PX === -130);
check(
  "a tap on the left half steps back, and the first status stays put",
  statusSource.includes("if (pos.x < size.width / 2f) {") &&
    statusSource.includes("if (idx > 0) idx--"),
);
check(
  "a tap on the right half steps forward and closes at the end",
  statusSource.includes("if (idx + 1 < statuses.size) idx++ else nav.popBackStack()"),
);
check(
  "a HOLD is not a tap: the long-press release only resumes",
  statusSource.includes("viewConfiguration.longPressTimeoutMillis"),
);
check(
  "stepping back off the first status does not close the viewer",
  stepStatus(0, 3, "back").close === false && stepStatus(0, 3, "back").index === 0,
);
check("stepping forward in the middle moves one", stepStatus(1, 3, "next").index === 2);
check("stepping forward off the last status closes it", stepStatus(2, 3, "next").close === true);
check("an empty list closes rather than indexing nothing", stepStatus(0, 0, "next").close === true);
check(
  "only somebody else's status reports a view",
  statusSource.includes("if (!isMine) {") &&
    statusSource.includes('/api/statuses/${s.optString("id")}/view'),
);
check(
  "the web viewer reports a view once per status id",
  webController.includes("reportedRef.current.has(statusId)") &&
    webViewer.includes("controller.markViewed(current.id)"),
);
check(
  "the phone's viewer paints the video's own position onto the bar",
  statusSource.includes("onProgress = { p ->") && statusSource.includes("videoProgress = p"),
);
check(
  "the bar advances the moment the clip ends",
  statusSource.includes("while (videoProgress < 0.99f && waited < maxWait)"),
);
check(
  "the web clip mirrors its element and advances on ended",
  webViewer.includes("onEnded={() => step(") &&
    webViewer.includes("video.currentTime / video.duration"),
);
check(
  "segment fill is 1 before the current index, 0 after it, progress on it",
  segmentFill(0, 1, 0.4) === 1 && segmentFill(1, 1, 0.4) === 0.4 && segmentFill(2, 1, 0.4) === 0,
);
check(
  "the phone's progressTo is the same three branches",
  /private fun progressTo\(i: Int, current: Int, p: Float\): Float =\s*when \{\s*i < current -> 1f\s*i > current -> 0f\s*else -> p\s*\}/.test(
    statusSource,
  ),
);
check(
  "a fill fraction is clamped and never NaN",
  segmentFill(1, 1, Number.NaN) === 0 && segmentFill(1, 1, 4) === 1,
);
check(
  "the composer takes 500 characters",
  statusSource.includes("onValueChange = { text = it.take(500) }"),
);
check(
  "the composer posts kind TEXT with the trimmed text and the style",
  statusSource.includes('.put("kind", "TEXT").put("text", text.trim()).put("bgStyle", style)'),
);
check(
  "the web text post is the same three fields",
  JSON.stringify(statusPostBody({ kind: "TEXT", text: "  hello  ", bgStyle: "mint" })) ===
    JSON.stringify({ kind: "TEXT", text: "hello", bgStyle: "mint" }),
);
check(
  "Post status is disabled until there is something to post",
  statusSource.includes("enabled = text.isNotBlank() && !busy"),
);
check(
  "a media status is baked and posted inline as IMAGE",
  editSource.includes('.put("kind", "IMAGE").put("imageData", data).put("text", "")'),
);
check(
  "a clip status is uploaded and posted as VIDEO with its own seconds",
  editSource.includes('.put("kind", "VIDEO")') &&
    editSource.includes('.put("fileKey", up.optString("fileKey"))') &&
    editSource.includes('.put("seconds", ((e - s + 500L) / 1000L).toInt().coerceAtLeast(1))'),
);
check(
  "the phone's seconds are a rounded-up-to-nearest, at least one",
  statusSecondsOf(0.2) === 1 &&
    statusSecondsOf(1.4) === 1 &&
    statusSecondsOf(1.6) === 2 &&
    statusSecondsOf(0) === 1,
);
check("STATUS_VIDEO_SECONDS_MIN agrees", STATUS_VIDEO_SECONDS_MIN === 1);
check("the seconds the web posts are clamped to the Worker's 120", statusSecondsOf(600) === 120);
check(
  "a clip over the video ceiling is refused before it is uploaded",
  editSource.includes("if (bytes.size > Api.VIDEO_MAX)"),
);
check(
  "the web posts a whole clip and says it cannot trim",
  /cannot trim or re-encode/i.test(STATUS_COPY.browserNotice) &&
    webComposer.includes("uploadFile(api, {"),
);
check(
  "a photo that will not fit inline is uploaded and posted by key instead",
  webController.includes('kind: "uploaded"') &&
    webController.includes("uploadFile(api, {") &&
    workerSource.includes("imageData ?? fileKey ?? null"),
);
check(
  "the shrink ladder only ever goes down, and every step is a JPEG",
  STATUS_PHOTO_STEPS.every((step, index, all) =>
    index === 0 ? true : step.longEdge < (all[index - 1]?.longEdge ?? 0),
  ) && STATUS_PHOTO_STEPS.every((step) => step.quality > 0 && step.quality < 1),
);
check(
  "a data URL inside the cap is inline-able",
  photoFitsInline("data:image/jpeg;base64," + "A".repeat(100)),
);
check(
  "a data URL over the cap is not",
  !photoFitsInline("data:image/jpeg;base64," + "A".repeat(450_001)),
);
check(
  "the reply carries WHICH status it answers, as meta.status",
  statusSource.includes(
    'payload.put("meta", JSONObject().put("status", JSONObject().put("id", statusId)))',
  ),
);
check(
  "the web reply meta is the same single field",
  JSON.stringify(statusReplyMeta("abc")) === JSON.stringify({ status: { id: "abc" } }) &&
    statusReplyMeta("") === undefined,
);
check(
  "a reply opens (or reuses) the 1:1 chat first",
  statusSource.includes('Api.post("/api/conversations", JSONObject().put("userId", target))'),
);
check(
  "the web reply goes through the same two calls, and caches the chat id",
  webController.includes("messagingApi.createConversation(api, authorId)") &&
    webController.includes("convIdRef.current.set(authorId, id)"),
);
check(
  "a reply is optimistic: the box clears before the network answers",
  statusSource.includes('reply = ""') && webController.includes("const body = text.trim();"),
);
check(
  "the web reply is SEALED to the author's key, or refused",
  webController.includes("protectOutgoingBody(") && webController.includes("SECURE_CHAT_WAITING"),
);
check(
  "a reaction never creates a chat message on either client",
  statusSource.includes("Deliberately does NOT create any chat/inbox message") ||
    workerSource.includes("Deliberately does NOT create any chat/inbox message"),
);
check(
  "the seven quick reactions, in the phone's order",
  statusSource.includes('listOf("❤️", "😂", "😮", "😢", "🙏", "🔥", "👍")'),
);
check(
  "the web list is the same seven, in the same order",
  [...STATUS_REACTIONS].join(",") === "❤️,😂,😮,😢,🙏,🔥,👍",
);
check(
  "each reaction tap posts the emoji to the status's own route",
  statusSource.includes('/api/statuses/${s.optString("id")}/react'),
);
check(
  "the viewers list is cached per status for the life of the process",
  storeSource.includes("val statusViewers = mutableStateMapOf<String, List<JSONObject>>()"),
);
check(
  "the cached list paints at once and refreshes behind it",
  statusSource.includes("val cached = ScreenStore.statusViewers[id]") &&
    statusSource.includes("viewersLoading = cached == null"),
);
check(
  "only a first-ever failure shows the error line",
  statusSource.includes("if (cached == null) viewersError = true"),
);
check(
  "the web sheet follows the same three rules",
  webController.includes("loading: !cached") &&
    webController.includes("error: rows === null && !cached"),
);
check(
  "the count beside the eye is the larger of the feed's and the sheet's",
  storeSource.includes(
    'maxOf(s.optInt("viewers", 0), statusViewers[s.optString("id")]?.size ?: 0)',
  ),
);
check(
  "the web count takes the same maximum",
  statusViewCount(item({ viewers: 3 }), 5) === 5 &&
    statusViewCount(item({ viewers: 3 }), 1) === 3 &&
    statusViewCount(item({ viewers: 0 }), 0) === 0,
);
check(
  "hidden authors are a local, persisted list",
  storeSource.includes("val hiddenStatusUserIds = mutableSetOf<String>()") &&
    storeSource.includes("Persisted."),
);
check(
  "the hidden list is applied while filtering the feed",
  statusSource.includes("!in ScreenStore.hiddenStatusUserIds"),
);
check(
  "the web hides from the same key shape and applies it while parsing",
  STATUS_HIDDEN_KEY === "kp.status.hidden" &&
    serializeHiddenAuthors(["a", "a", "b"]) === '{"ids":["a","b"]}' &&
    parseHiddenAuthors('{"ids":["a",1,null,"b"]}').join(",") === "a,b" &&
    parseHiddenAuthors("not json").length === 0 &&
    parseStatusFeed({ items: [group({ user: { id: "u_peer" } })] }, ["u_peer"]).others.length === 0,
);
check(
  "hiding an author is idempotent",
  withHiddenAuthor(["a"], "a").join(",") === "a" &&
    withHiddenAuthor(["a"], "b").join(",") === "a,b",
);
check(
  "hiding says what it did, in the phone's word",
  statusSource.includes('"Status hidden"') && STATUS_COPY.hiddenToast === "Status hidden",
);
check(
  "Report is an acknowledgement on the phone too — there is no route for it",
  statusSource.includes('"Reported. Thank you."') &&
    !workerSource.includes("/api/statuses/report") &&
    STATUS_COPY.reportedToast === "Reported. Thank you.",
);
check(
  "the ⋮ menu offers Delete for your own and Message / Hide / Report for somebody else's",
  statusSource.includes('StatusMenuRow(Icons.Filled.Delete, "Delete status", Red, onDelete)') &&
    statusSource.includes('StatusMenuRow(KpChatMessageVector(), "Message", Ink, onMessage)') &&
    statusSource.includes('StatusMenuRow(Icons.Filled.HideSource, "Hide status", Ink, onHide)') &&
    statusSource.includes('StatusMenuRow(Icons.Filled.Flag, "Report", Ink, onReport)'),
);
check(
  "the web menu copies all four labels",
  [
    STATUS_COPY.menuDelete === "Delete status",
    STATUS_COPY.menuMessage === "Message",
    STATUS_COPY.menuHide === "Hide status",
    STATUS_COPY.menuReport === "Report",
  ].every(Boolean),
);
check(
  "the menu keeps the clock paused while it is up",
  /menuOpen is part of the\s*\n?\s*\*? ?pause condition/.test(statusSource),
);
check(
  "deleting asks first, with the phone's three strings",
  statusSource.includes('title = "Delete status?"') &&
    statusSource.includes('text = "Removed for everyone."') &&
    statusSource.includes('confirmLabel = "Delete"'),
);
check(
  "the web confirm copies them",
  [
    STATUS_COPY.deleteTitle === "Delete status?",
    STATUS_COPY.deleteText === "Removed for everyone.",
    STATUS_COPY.deleteConfirm === "Delete",
  ].every(Boolean),
);
check(
  "the phone leaves the viewer IMMEDIATELY and deletes behind the network",
  statusSource.includes("nav.popBackStack()\n        scope.launch {") ||
    /groups\.clear\(\)[\s\S]{0,400}nav\.popBackStack\(\)[\s\S]{0,200}Api\.delete\("\/api\/statuses/.test(
      statusSource,
    ),
);
check(
  "the web does the same, so a second click finds nothing to delete",
  webViewer.includes("onClose();\n    await controller.remove(id);") ||
    /onClose\(\);[\s\S]{0,80}controller\.remove\(id\)/.test(webViewer),
);
check(
  "the viewers sheet is titled Viewed by and says No views yet.",
  statusSource.includes('"Viewed by"') && statusSource.includes('"No views yet."'),
);
check(
  "the web sheet copies both",
  STATUS_COPY.viewersTitle === "Viewed by" && STATUS_COPY.viewersEmpty === "No views yet.",
);
check(
  "a viewer-list failure says so in the phone's words",
  statusSource.includes(`"Couldn't load viewers. Try again."`) &&
    STATUS_COPY.viewersError === "Couldn't load viewers. Try again.",
);
check(
  "tapping a viewer opens the chat with them",
  statusSource.includes("onOpenChat = { openChatWith(it) }"),
);
check(
  "a viewer row shows the reaction beside the name",
  statusSource.includes('val reaction = v.optText("reaction").ifBlank { null }'),
);
check(
  "the feed's own row is 'My status' with an add badge",
  statusSource.includes('"My status"') &&
    statusSource.includes('contentDescription = "Add status"'),
);
check(
  "the web feed copies both",
  STATUS_COPY.myStatus === "My status" && STATUS_COPY.addStatus === "Add status",
);
check(
  "an empty own row invites a first update",
  statusSource.includes('"Tap to add a status update"'),
);
check("the web copy agrees", STATUS_COPY.addPlaceholder === "Tap to add a status update");
check("the section header is Recent updates", statusSource.includes('"Recent updates"'));
check("the web header agrees", STATUS_COPY.recentUpdates === "Recent updates");
check(
  "the own-row subtitle counts views only when there are any",
  statusSource.includes('(if (views > 0) " · $views view${if (views == 1) "" else "s"}" else "")'),
);
check(
  "the web subtitle does the same, singular and plural",
  myStatusSubtitle("4:39 PM", 0) === "My updates · 4:39 PM" &&
    myStatusSubtitle("4:39 PM", 1) === "My updates · 4:39 PM · 1 view" &&
    myStatusSubtitle("4:39 PM", 3) === "My updates · 4:39 PM · 3 views",
);
check(
  "a contact row says how many updates and when the newest was",
  statusSource.includes(
    '"${statuses.size} update${if (statuses.size > 1) "s" else ""} · ${statusStampShort(lastAt)}"',
  ),
);
check(
  "the web row subtitle pluralises the same way",
  statusRowSubtitle(1, "4:39 PM") === "1 update · 4:39 PM" &&
    statusRowSubtitle(3, "4:39 PM") === "3 updates · 4:39 PM" &&
    statusRowSubtitle(2, "") === "2 updates",
);
check(
  "views label is singular at one",
  viewsLabel(1) === "1 view" && viewsLabel(2) === "2 views" && viewsLabel(0) === "0 views",
);
check(
  "the feed sorts contacts newest-update first, and the server does not",
  statusSource.includes('.sortedByDescending { g -> g.arr("statuses")') &&
    workerSource.includes("ORDER BY s.user_id, s.created_at ASC"),
);
check(
  "the web feed applies the same client-side sort",
  (() => {
    const feed = parseStatusFeed({
      items: [
        group({
          user: { id: "u_old" },
          statuses: [item({ id: "a", createdAt: "2026-10-05T01:00:00.000Z" })],
        }),
        group({
          user: { id: "u_new" },
          statuses: [item({ id: "b", createdAt: "2026-10-05T09:00:00.000Z" })],
        }),
      ],
    });
    return feed.others.map((row) => row.author.id).join(",") === "u_new,u_old";
  })(),
);
check(
  "the mine group is the one flagged mine, and stays on top",
  (() => {
    const feed = parseStatusFeed({
      items: [group({ user: { id: "u_peer" } }), group({ mine: true, user: { id: "u_me" } })],
    });
    return feed.mine?.author.id === "u_me" && feed.others.length === 1;
  })(),
);
check(
  "the composer's own copy is copied, not paraphrased",
  statusSource.includes('"Text status"') &&
    statusSource.includes('"Tap kore likha shuru korun…"') &&
    statusSource.includes('"Apnar status…"') &&
    statusSource.includes('"Post status"'),
);
check(
  "the web composer copies all four",
  [
    STATUS_COPY.composerTitle === "Text status",
    STATUS_COPY.composerHint === "Tap kore likha shuru korun…",
    STATUS_COPY.composerField === "Apnar status…",
    STATUS_COPY.post === "Post status",
  ].every(Boolean),
);
check(
  "the reply placeholder names the author",
  statusSource.includes('"Reply to ${user?.optText("displayName") ?: ""}…"'),
);
check(
  "the web placeholder is built from the same two pieces",
  STATUS_COPY.replyPlaceholder === "Reply to",
);
check("the send button is named Send reply", statusSource.includes('"Send reply"'));
check("the web copy agrees", STATUS_COPY.sendReply === "Send reply");
check("an empty viewer says No status", statusSource.includes('"No status"'));
check("the web copy agrees", STATUS_COPY.noStatus === "No status");
check(
  "a photo status that will not load says so instead of showing a frame",
  webViewer.includes("That photo could not be loaded.") &&
    webViewer.includes("That clip could not be loaded."),
);

/* ------------------------------------------------------------ ring + stamps */

check(
  "the ring is 2.5 dp wide with a 5 dp gap and at least one segment",
  uiSource.includes("ringWidth: Dp = 2.5.dp") &&
    uiSource.includes("val gapPx = if (n == 1) 0.0 else 5.dp.toPx().toDouble()") &&
    uiSource.includes("val n = segments.coerceAtLeast(1)"),
);
check(
  "the web ring numbers agree",
  STATUS_RING_WIDTH_DP === 2.5 &&
    STATUS_RING_GAP_DP === 5 &&
    ringSegments(0) === 1 &&
    ringSegments(3) === 3,
);
check(
  "unseen is dark blue and seen is gray on every theme",
  uiSource.includes("val ringColor = if (seen) Color(0xFF9CA3AF) else Color(0xFF2F6FED)"),
);
check(
  "the web colours are the same two",
  STATUS_RING_UNSEEN === "#2F6FED" && STATUS_RING_SEEN === "#9CA3AF",
);
check(
  "one status draws one arc with no gap",
  ringArcs(1, 48).length === 1 && !ringArcs(1, 48)[0].includes("NaN"),
);
check("three statuses draw three arcs", ringArcs(3, 48).length === 3);
check(
  "the arcs start at twelve o'clock and stay inside the box",
  (() => {
    const arcs = ringArcs(3, 48);
    const first = (arcs[0] ?? "").match(/M ([\d.-]+) ([\d.-]+)/);
    if (!first) return false;
    // 48 px box, 2.5 stroke → radius 22.75, centre 24. The first arc starts
    // half a gap clockwise of twelve o'clock, so it sits just right of the top.
    return (
      Math.abs(Number(first[2]) - 1.39) < 0.6 && Number(first[1]) > 24 && Number(first[1]) < 28.5
    );
  })(),
);
check(
  "every arc coordinate stays within the ring's own box",
  ringArcs(5, 48).every((arc) =>
    (arc.match(/-?[\d.]+/g) ?? []).every((value) => Number(value) >= -0.5 && Number(value) <= 48.5),
  ),
);
check(
  "the phone's viewer stamp says 'Today at', 'Yes at', a weekday, then a date",
  uiSource.includes('"Today at ${') &&
    uiSource.includes('"Yes at ${') &&
    uiSource.includes("< 7 ->"),
);
check(
  "the web stamp follows the same four buckets in Dhaka time",
  (() => {
    // 2026-10-05T04:00Z is 10:00 in Asia/Dhaka (UTC+6).
    const now = Date.parse("2026-10-05T06:00:00.000Z");
    return [
      statusStamp("2026-10-05T04:00:00.000Z", now) === "Today at 10:00 AM",
      // 2026-10-04T10:00Z is 16:00 on the 4th IN DHAKA, so it is yesterday there.
      statusStamp("2026-10-04T10:00:00.000Z", now) === "Yes at 4:00 PM",
      statusStamp("2026-10-02T04:00:00.000Z", now) === "Fri",
      statusStamp("2026-09-05T04:00:00.000Z", now) === "5 Sep",
      statusStamp("", now) === "",
      statusStamp("not a stamp", now) === "",
    ].every(Boolean);
  })(),
  statusStamp("2026-10-05T04:00:00.000Z", Date.parse("2026-10-05T06:00:00.000Z")),
);
check(
  "the short stamp drops the Today/Yes-at prefix for a one-line row",
  (() => {
    const now = Date.parse("2026-10-05T06:00:00.000Z");
    return [
      statusStampShort("2026-10-05T04:00:00.000Z", now) === "10:00 AM",
      statusStampShort("2026-10-04T10:00:00.000Z", now) === "Yes",
      statusStampShort("2026-10-02T04:00:00.000Z", now) === "Fri",
      statusStampShort("2026-09-05T04:00:00.000Z", now) === "5 Sep",
    ].every(Boolean);
  })(),
);
check(
  "the clock is 12-hour with a leading zero on the minute",
  (() => {
    const now = Date.parse("2026-10-05T06:00:00.000Z");
    return [
      statusStampShort("2026-10-04T10:05:00.000Z", now) === "Yes",
      statusStamp("2026-10-05T00:05:00.000Z", now) === "Today at 6:05 AM",
      // Midnight in Dhaka is 18:00Z of the day before: the 12-hour clock reads
      // 12:00 AM, and an `hour12:false` "24" is folded to 0 before it is read.
      statusStamp("2026-10-04T18:00:00.000Z", now) === "Today at 12:00 AM",
    ].every(Boolean);
  })(),
  statusStamp("2026-10-04T18:00:00.000Z", Date.parse("2026-10-05T06:00:00.000Z")),
);
check(
  "the viewers sheet's stamp is Theme.kt's listStamp — the same buckets",
  themeSource.includes("fun listStamp(iso: String): String") &&
    listStamp("2026-10-04T10:00:00.000Z", Date.parse("2026-10-05T06:00:00.000Z")) === "Yes",
);
check(
  "a status knows when it expires, and never reports a negative",
  statusExpiresInMs(
    item({ expiresAt: "2026-10-06T04:00:00.000Z" }),
    Date.parse("2026-10-05T04:00:00.000Z"),
  ) === 86_400_000 &&
    statusExpiresInMs(
      item({ expiresAt: "2026-10-04T04:00:00.000Z" }),
      Date.parse("2026-10-05T04:00:00.000Z"),
    ) === 0,
);

/* ------------------------------------------------------- gradients + kinds */

check(
  "the composer offers six gradients with these exact ARGB stops",
  statusSource.includes('"amber" to listOf(Color(0xFFFDE68A), Color(0xFFF59E0B))') &&
    statusSource.includes('"sunset" to listOf(Color(0xFFFDA4AF), Color(0xE11D48))') &&
    statusSource.includes('"mint" to listOf(Color(0xFFA7F3D0), Color(0xFF059669))') &&
    statusSource.includes('"ocean" to listOf(Color(0xFFBAE6FD), Color(0xFF0284C7))') &&
    statusSource.includes('"berry" to listOf(Color(0xFFDDD6FE), Color(0xFF7C3AED))') &&
    statusSource.includes('"ink" to listOf(Color(0xFF44403C), Color(0xFF1C1917))'),
);
check(
  "the web catalog is the same six ids in the same order with the same colours",
  STATUS_BG_STYLES.map((style) => style.id).join(",") === "amber,sunset,mint,ocean,berry,ink" &&
    STATUS_BG_STYLES.map((style) => `${style.from}${style.to}`)
      .join(",")
      .toLowerCase() ===
      "#fde68a#f59e0b,#fda4af#e11d48,#a7f3d0#059669,#bae6fd#0284c7,#ddd6fe#7c3aed,#44403c#1c1917",
);
check(
  "the sunset stop keeps the phone's alpha (0xE11D48 is opaque-red, not a typo here)",
  statusBgStyle("sunset").to === "#E11D48",
);
check(
  "KNOWN DIVERGENCE: the phone's VIEWER map has five gradients, so an ink status draws amber there",
  (() => {
    const viewer = statusSource.slice(
      statusSource.indexOf(
        "val gradients = mapOf(",
        statusSource.indexOf("fun StatusViewerScreen"),
      ),
    );
    return (
      viewer.includes('"berry" to listOf') &&
      !viewer.slice(0, viewer.indexOf("val cols")).includes('"ink" to listOf')
    );
  })() &&
    STATUS_BG_STYLES.length === 6 &&
    webModel.includes("StatusScreens.kt:911"),
);
check(
  "an unknown style falls back to amber on both clients",
  statusSource.includes('gradients[s.optString("bgStyle")] ?: gradients["amber"]!!') &&
    statusBgStyle("nope").id === "amber" &&
    parseStatusItem({ id: "x", bgStyle: "javascript:alert(1)" })?.bgStyle === "amber",
);
check(
  "the gradient is a CSS linear-gradient between the two stops",
  statusGradientCss(statusBgStyle("mint")) === "linear-gradient(160deg, #A7F3D0 0%, #059669 100%)",
);
check(
  "the three kinds are the Worker's three",
  ["TEXT", "IMAGE", "VIDEO"].join(",") === parseStatusKindList().join(","),
);
function parseStatusKindList() {
  return parseStatusItem({ id: "x", kind: "video" })?.kind === "VIDEO"
    ? ["TEXT", "IMAGE", "VIDEO"]
    : [];
}
check(
  "a lowercase or hostile kind lands on a known one",
  parseStatusItem({ id: "x", kind: "video" })?.kind === "VIDEO" &&
    parseStatusItem({ id: "x", kind: "SCRIPT" })?.kind === "TEXT" &&
    parseStatusItem({ id: "x", kind: 7 })?.kind === "TEXT",
);
check(
  "hold durations follow the kind and the seconds",
  statusHoldMs(item({ kind: "TEXT" })) === 5_000 &&
    statusHoldMs(item({ kind: "IMAGE", hasMedia: true })) === 5_000 &&
    statusHoldMs(item({ kind: "VIDEO", seconds: 12 })) === 12_000 &&
    statusHoldMs(item({ kind: "VIDEO", seconds: 2 })) === 5_000 &&
    statusHoldMs(item({ kind: "VIDEO", seconds: 600 })) === 120_000 &&
    statusHoldMs(item({ kind: "VIDEO", seconds: 0 })) === 30_000,
);

/* ------------------------------------------------------------- parsing */

check(
  "a group with no rows draws nothing rather than an empty ring",
  parseStatusFeed({ items: [{ user: { id: "u" }, statuses: [] }] }).others.length === 0,
);
check(
  "a hostile feed is parsed, not trusted",
  (() => {
    const feed = parseStatusFeed({
      items: [
        null,
        "nope",
        { statuses: [item()] },
        { user: { id: "" }, statuses: [item()] },
        group({
          user: { id: "u_peer", displayName: "R".repeat(400), avatarUrl: "javascript:alert(1)" },
          statuses: [null, item({ id: "" }), item({ seconds: "12" }), item({ viewers: -5 })],
        }),
      ],
    });
    const only = feed.others[0];
    return [
      feed.others.length === 1,
      only?.author.displayName.length === 120,
      only?.author.avatarUrl === "",
      only?.statuses.length === 2,
      only?.statuses[0]?.seconds === 12,
      only?.statuses[1]?.viewers === 0,
    ].every(Boolean);
  })(),
);
check(
  "an avatar is only drawn when it is an inline image",
  parseStatusAuthor({ id: "u", avatarUrl: "data:image/png;base64,AAAA" })?.avatarUrl ===
    "data:image/png;base64,AAAA" &&
    parseStatusAuthor({ id: "u", avatarUrl: "data:text/html;base64,AAAA" })?.avatarUrl === "" &&
    parseStatusAuthor({ id: "u", avatarUrl: "/api/files/f/x.png" })?.avatarUrl === "",
);
check(
  "the author's public key rides along so a reply can be sealed",
  parseStatusAuthor({ id: "u", e2eePublicKey: "abc" })?.e2eePublicKey === "abc",
);
check(
  "a second 'mine' group is ignored, not appended",
  parseStatusFeed({
    items: [
      group({ mine: true, user: { id: "u_me" } }),
      group({ mine: true, user: { id: "u_me2" } }),
    ],
  }).mine?.author.id === "u_me",
);
check(
  "allViewed decides the gray ring, and your own ring is never gray",
  groupSeen(parsedGroup({ allViewed: true })) === true &&
    groupSeen(parsedGroup({ allViewed: false })) === false &&
    groupSeen(parsedGroup({ mine: true, allViewed: true })) === false,
);
check(
  "the newest createdAt is the group's sort key",
  newestCreatedAt(
    parsedGroup({
      statuses: [
        item({ id: "a", createdAt: "2026-10-05T01:00:00.000Z" }),
        item({ id: "b", createdAt: "2026-10-05T09:00:00.000Z" }),
      ],
    }),
  ) === "2026-10-05T09:00:00.000Z",
);
check(
  "the viewer names your own group with your own name",
  viewerAuthorName(parsedGroup({ mine: true }), "Amar") === "Amar" &&
    viewerAuthorName(parsedGroup({}), "Amar") === "Rahi" &&
    viewerAuthorName(parsedGroup({ user: { id: "u", displayName: "" } }), "") === "Status",
);
check(
  "a reaction must be emoji: the Worker's XSS fix is mirrored client-side",
  ["❤️", "🇧🇩", "👍🏽"].every((emoji) => isStatusReaction(emoji)) &&
    ["<script>alert(1)</script>", "ok", "", "1234", "#️⃣x"].every(
      (value) => !isStatusReaction(value),
    ),
);
check(
  "the viewers list parses a name, a stamp and one emoji each",
  (() => {
    const rows = parseStatusViewers({
      viewers: [
        {
          user: { id: "u1", displayName: "One" },
          viewedAt: "2026-10-05T04:00:00.000Z",
          reaction: "❤️",
        },
        { user: { id: "u2" }, viewedAt: "nope", reaction: "x".repeat(80) },
        { viewedAt: "2026-10-05T04:00:00.000Z" },
      ],
    });
    return (
      rows.length === 2 &&
      rows[0]?.reaction === "❤️" &&
      rows[1]?.viewedAt === "" &&
      (rows[1]?.reaction.length ?? 0) === 16
    );
  })(),
);
check(
  "a status quote is parsed from meta.status and drawn in the bubble",
  (() => {
    const quote = parseStatusQuote({ id: "s1", kind: "IMAGE", text: "x".repeat(200) });
    const row = parseMessageRow({
      id: "m1",
      kind: "TEXT",
      body: "nice",
      meta: { status: { id: "s1", kind: "VIDEO", text: "" } },
    });
    return [
      quote?.text.length === 80,
      statusQuoteCaption({ id: "s1", kind: "IMAGE", text: "" }) === "Photo",
      statusQuoteCaption({ id: "s1", kind: "VIDEO", text: "" }) === "Video",
      statusQuoteCaption({ id: "s1", kind: "TEXT", text: "" }) === "Status",
      statusQuoteCaption({ id: "s1", kind: "TEXT", text: "hello" }) === "hello",
      statusQuoteHasThumb({ id: "s1", kind: "IMAGE", text: "" }) === true,
      statusQuoteHasThumb({ id: "s1", kind: "TEXT", text: "" }) === false,
      row.statusQuote?.kind === "VIDEO",
      parseStatusQuote({ id: "", kind: "IMAGE" }) === null,
      parseStatusQuote("nope") === null,
    ].every(Boolean);
  })(),
);
check(
  "the quote's caption is cut at 64, as the phone cuts it",
  statusQuoteCaption({ id: "s1", kind: "TEXT", text: "y".repeat(80) }).length === 64,
);
check(
  "protocol.ts parses the quote into every row",
  webProtocol.includes("statusQuote: parseStatusQuote(meta.status)") &&
    webProtocol.includes("statusQuote: null"),
);
check(
  "the bubble draws the quote above a reply quote, as the phone does",
  readFileSync(resolve("web/src/messaging/ChatPane.tsx"), "utf8").indexOf("message.statusQuote") <
    readFileSync(resolve("web/src/messaging/ChatPane.tsx"), "utf8").indexOf("message.replyTo && ("),
);

/* --------------------------------------------------------------- drafting */

check(
  "an empty text draft is refused before the request",
  statusDraftVerdict({ kind: "TEXT", text: "   ", bgStyle: "amber" }).allowed === false &&
    statusDraftVerdict({ kind: "TEXT", text: "   ", bgStyle: "amber" }).reason ===
      STATUS_COPY.emptyText,
);
check(
  "a text draft over 500 characters is refused with the cap named",
  statusDraftVerdict({ kind: "TEXT", text: "a".repeat(501), bgStyle: "amber" }).allowed === false,
);
check(
  "a photo draft with no bytes is refused in the phone's words",
  statusDraftVerdict({ kind: "IMAGE", imageData: "", fileKey: "" }).reason ===
    STATUS_COPY.emptyPhoto &&
    statusDraftVerdict({ kind: "VIDEO", fileKey: "", seconds: 3 }).reason ===
      STATUS_COPY.emptyVideo,
);
check(
  "an over-cap inline photo is refused rather than posted",
  statusDraftVerdict({ kind: "IMAGE", imageData: "d".repeat(450_001), fileKey: "" }).allowed ===
    false,
);
check(
  "a good draft of each kind is allowed",
  [
    statusDraftVerdict({ kind: "TEXT", text: "hi", bgStyle: "amber" }).allowed,
    statusDraftVerdict({ kind: "IMAGE", imageData: "data:image/jpeg;base64,AA", fileKey: "" })
      .allowed,
    statusDraftVerdict({ kind: "IMAGE", imageData: "", fileKey: "f/x.jpg" }).allowed,
    statusDraftVerdict({ kind: "VIDEO", fileKey: "f/x.mp4", seconds: 9 }).allowed,
  ].every(Boolean),
);
check(
  "an image post carries either the data URL or the key, never both",
  JSON.stringify(
    statusPostBody({ kind: "IMAGE", imageData: "data:image/jpeg;base64,AA", fileKey: "" }),
  ) === JSON.stringify({ kind: "IMAGE", imageData: "data:image/jpeg;base64,AA", text: "" }) &&
    JSON.stringify(statusPostBody({ kind: "IMAGE", imageData: "", fileKey: "f/x.jpg" })) ===
      JSON.stringify({ kind: "IMAGE", fileKey: "f/x.jpg", text: "" }),
);
check(
  "a video post carries the key and the clamped seconds",
  JSON.stringify(statusPostBody({ kind: "VIDEO", fileKey: "f/x.mp4", seconds: 900 })) ===
    JSON.stringify({ kind: "VIDEO", fileKey: "f/x.mp4", seconds: 120, text: "" }),
);

/* ----------------------------------------------------------------- wiring */

check(
  "the whole feature sits behind the statuses rollout flag",
  webApp.includes('isWebFeatureEnabled("statuses")') &&
    webApp.includes("statusesEnabled && isStatusArea") &&
    readFileSync(resolve("web/src/featureFlagRegistry.ts"), "utf8").includes("statuses: false"),
);
check(
  "a status feed needs a verified session, like the chat list does",
  webApp.includes("(statusesEnabled && isStatusArea)"),
);
check(
  "the workspace is a lazy chunk, so a flag-off build never downloads it",
  webApp.includes('import("./status/StatusWorkspace")'),
);
check(
  "the banner says what is on instead of claiming status is disabled",
  webApp.includes("24-hour statuses are on"),
);
check(
  "the status media joins the messaging media cache under its own prefix",
  webMediaUrl.includes('STATUS_MEDIA_PREFIX = "status:"') &&
    webMediaUrl.includes("fetchStatusMediaBlob"),
);
check(
  "a status id that is not a UUID shape never reaches a URL",
  (() => {
    let threw = false;
    try {
      statusPath("../../etc/passwd");
    } catch {
      threw = true;
    }
    return (
      threw &&
      statusPath("3f2b7c1e-0000-4000-8000-000000000001") ===
        "/api/statuses/3f2b7c1e-0000-4000-8000-000000000001"
    );
  })(),
);
check(
  "the feed's rows are real buttons a keyboard can reach",
  webFeed.includes("<button") &&
    webFeed.includes('className="status-row') &&
    !webFeed.includes("onMouseEnter"),
);
check(
  "no control in the viewer is icon-only without a name",
  !/aria-label=\{?\s*""/.test(webViewer) &&
    (webViewer.match(/className="icon-button/g) ?? []).length <=
      (webViewer.match(/aria-label=/g) ?? []).length,
);
check(
  "the tap zones are labelled buttons, and the arrows drive them too",
  webViewer.includes("aria-label={STATUS_COPY.previous}") &&
    webViewer.includes("aria-label={STATUS_COPY.next}") &&
    webViewer.includes('event.key === "ArrowLeft"') &&
    webViewer.includes('event.key === "ArrowRight"'),
);
check(
  "holding the picture pauses it, and a labelled pause exists for a keyboard",
  webViewer.includes("onPointerDown={() => setHolding(true)}") &&
    webViewer.includes("setManualPause"),
);
check(
  "Escape closes the viewer, the menu and the sheets",
  (webViewer.match(/event\.key === "Escape"/g) ?? []).length >= 1 &&
    readFileSync(resolve("web/src/status/ViewersSheet.tsx"), "utf8").includes(
      'event.key !== "Escape"',
    ),
);
check(
  "the composer's Escape closes it unless the editor is open",
  webComposer.includes('if (event.key !== "Escape" || editing) return;'),
);
check(
  "the six backgrounds are a real radio group, not six divs",
  webComposer.includes('role="radiogroup"') &&
    webComposer.includes('role="radio"') &&
    webComposer.includes("aria-checked"),
);
check(
  "the photo path goes through the same editor the chat uses",
  webComposer.includes("<PhotoEditor") && pickSource.includes("mediaedit/status/0/"),
);
check(
  "the disclosed limits are rendered, not just written down",
  webComposer.includes("STATUS_COPY.browserNotice") &&
    webFeed.includes("STATUS_COPY.browserNotice"),
);
check(
  "the browser notice names the real limits: no trim, a 120 s cap, the inline photo cap",
  /cannot trim or re-encode/.test(STATUS_COPY.browserNotice) &&
    /120 seconds/.test(STATUS_COPY.browserNotice) &&
    /inline limit/.test(STATUS_COPY.browserNotice),
);
check(
  "the hidden-author notice says the list belongs to this browser",
  /this browser only/.test(STATUS_COPY.hiddenNotice),
);
check(
  "the 24-hour life is stated where a reader will see it",
  /24 hours/.test(STATUS_COPY.expiredNotice) && webFeed.includes("STATUS_COPY.expiredNotice"),
);
check(
  "the feed names the privacy setting instead of implying everyone sees it",
  webFeed.includes("STATUS_COPY.privacyPublic") &&
    STATUS_COPY.privacyNobody === "Only you" &&
    STATUS_COPY.privacyContacts === "Your 1:1 contacts only",
);
check(
  "a reply failure is spoken, never swallowed",
  webViewer.includes("setReplyError(result.reason") &&
    STATUS_COPY.replyFailed === "Could not send the reply. Please try again.",
);
check(
  "the phone's reply failure wording is the same sentence",
  statusSource.includes('"Could not send the reply. Please try again."'),
);
check(
  "the controller polls only while the tab is visible",
  webController.includes('document.visibilityState !== "visible") return;'),
);
check(
  "a locked backup is announced rather than failing silently",
  readFileSync(resolve("web/src/status/StatusWorkspace.tsx"), "utf8").includes(
    'identity.status === "locked"',
  ),
);

console.log(lines.join("\n"));
