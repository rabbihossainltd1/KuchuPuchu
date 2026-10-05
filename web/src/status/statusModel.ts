/**
 * Status (24 h stories) — the model, DOM-free.
 *
 * Everything the phone decides about a status lives here as a number or a
 * string that a Node contract case can compare with the Kotlin and the Worker
 * source directly: the feed order, the ring geometry, how long each kind holds
 * on screen, when the clock pauses, the stamps, the reactions, the gradients,
 * the caps the Worker enforces, and the copy both clients show.
 *
 * Witnesses (read, not guessed):
 *   native-android/.../StatusScreens.kt   feed, composer, viewer, sheets
 *   native-android/.../StatusPickScreen.kt the gallery that feeds a media status
 *   native-android/.../MediaEditScreen.kt  sendStatus(): the two POST shapes
 *   native-android/.../Ui.kt               StatusRingAvatar, statusStamp(Short)
 *   native-android/.../Theme.kt            listStamp
 *   native-android/.../ScreenStore.kt      hidden authors, viewer cache, counts
 *   src/worker/index.ts                    /api/statuses and its four sub-routes
 */

import {
  clockLabel,
  daysBetween,
  dhakaParts,
  listStamp,
  monthLabel,
  weekdayLabel,
} from "../time/dhakaTime";

/* ------------------------------------------------------------ the numbers */

/** The composer takes 500 chars and the Worker slices to 500 (`text.slice(0, 500)`). */
export const STATUS_TEXT_MAX = 500;

/**
 * An inline photo is a data URL in the POST body, and the Worker refuses one
 * longer than this: `if (imageData && imageData.length > 450_000) fail(400,
 * "Photo too large — pick a smaller image.")`. Base64 inflates bytes by 4/3, so
 * this is roughly a 337 KB JPEG.
 */
export const STATUS_IMAGE_DATA_MAX = 450_000;

/** `Math.max(0, Math.min(120, Number(body.seconds || 0)))` — VIDEO only. */
export const STATUS_VIDEO_SECONDS_MAX = 120;

/** Android: `((e - s + 500) / 1000).toInt().coerceAtLeast(1)` — never a 0 s clip. */
export const STATUS_VIDEO_SECONDS_MIN = 1;

/** A status expires 24 h after it is posted: `Date.now() + 864e5`. */
export const STATUS_TTL_MS = 86_400_000;

/** How long one status holds the screen. Non-VIDEO: `5_000L`. */
export const STATUS_PHOTO_HOLD_MS = 5_000;

/** A VIDEO with no usable `seconds`: `30_000L`. */
export const STATUS_VIDEO_FALLBACK_HOLD_MS = 30_000;

/** A VIDEO with `seconds`: `(seconds * 1000).coerceIn(5_000, 120_000)`. */
export const STATUS_VIDEO_HOLD_MIN_MS = 5_000;
export const STATUS_VIDEO_HOLD_MAX_MS = 120_000;

/**
 * The clip gets this much longer than its own hold before the bar advances
 * anyway: `val maxWait = hold + 8_000L`. A stalled player must not hold a
 * status on screen forever.
 */
export const STATUS_VIDEO_WAIT_SLACK_MS = 8_000;

/** The feed re-reads itself this often while the tab is open: `delay(12_000)`. */
export const STATUS_FEED_POLL_MS = 12_000;

/** The viewer only re-fetches when its cache is older than this: `> 15_000`. */
export const STATUS_CACHE_STALE_MS = 15_000;

/** Swipe down past this and the viewer closes: `if (off > 260f)`. */
export const STATUS_SWIPE_CLOSE_PX = 260;

/** Swipe UP past this on your own status and the viewers sheet opens: `< -130f`. */
export const STATUS_SWIPE_UP_VIEWERS_PX = -130;

/** The ring's geometry, in the phone's dp: `ringWidth = 2.5.dp`, `gapPx = 5.dp`. */
export const STATUS_RING_WIDTH_DP = 2.5;
export const STATUS_RING_GAP_DP = 5;

/** Owner round 25: unseen is dark blue on every theme; seen turns gray. */
export const STATUS_RING_UNSEEN = "#2F6FED";
export const STATUS_RING_SEEN = "#9CA3AF";

/** The seven quick reactions above the reply bar, in the phone's order. */
export const STATUS_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "🔥", "👍"] as const;

/** The Worker's `ALLOWED_STATUS_KINDS`; anything else is stored as TEXT. */
export const STATUS_KINDS = ["TEXT", "IMAGE", "VIDEO"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * The text-status backgrounds. The composer offers all six; the phone's VIEWER
 * map is missing `ink` and falls back to amber for it (StatusScreens.kt:911),
 * so an ink status draws amber there. This client draws the six it offers —
 * recorded as a divergence in `docs/web-messaging.md`, not silently copied.
 */
export const STATUS_BG_STYLES = [
  { id: "amber", from: "#FDE68A", to: "#F59E0B" },
  { id: "sunset", from: "#FDA4AF", to: "#E11D48" },
  { id: "mint", from: "#A7F3D0", to: "#059669" },
  { id: "ocean", from: "#BAE6FD", to: "#0284C7" },
  { id: "berry", from: "#DDD6FE", to: "#7C3AED" },
  { id: "ink", from: "#44403C", to: "#1C1917" },
] as const;

/** The composer's default and the viewer's fallback: `?: gradients["amber"]!!`. */
export const STATUS_DEFAULT_BG = "amber";

/** `PRIVACY_DEFAULTS.status` is "public"; the levels are the account's three. */
export const STATUS_PRIVACY_LEVELS = ["public", "contacts", "nobody"] as const;
export const STATUS_PRIVACY_DEFAULT = "public";

/** A status id is the Worker's own `id()`; never trust its shape, only its length. */
const ID_MAX = 64;

/* ------------------------------------------------------------- the shapes */

export type StatusAuthor = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  /** A data URI when the author's privacy allows it, else "". */
  readonly avatarUrl: string;
  readonly verified: boolean;
  readonly moderator: boolean;
  readonly privateProfile: boolean;
  /**
   * The author's public message key. A reply to a status is an ordinary 1:1
   * message, and a personal chat's body may never leave plaintext — so the
   * reply is sealed to this key exactly as the composer seals to it.
   */
  readonly e2eePublicKey: string;
};

export type StatusItem = {
  readonly id: string;
  readonly kind: StatusKind;
  readonly text: string;
  readonly bgStyle: string;
  readonly hasMedia: boolean;
  /** VIDEO only: the clip's length in seconds, 0…120. */
  readonly seconds: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The author's own rows carry a viewer count; everybody else's do not. */
  readonly viewers: number;
};

export type StatusGroup = {
  readonly author: StatusAuthor;
  readonly mine: boolean;
  /** True when every status of a contact has been viewed by me. */
  readonly allViewed: boolean;
  readonly statuses: readonly StatusItem[];
};

export type StatusFeed = {
  readonly mine: StatusGroup | null;
  readonly others: readonly StatusGroup[];
};

/* ------------------------------------------------------------- the parsing */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** An ISO stamp, or "" — a status with no clock still draws, it just says nothing. */
function iso(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : "";
}

/** Only an inline image the browser cannot execute is drawn as an avatar. */
const SAFE_AVATAR = /^data:image\/(?:jpeg|png|webp|gif);base64,/i;

export function parseStatusAuthor(value: unknown): StatusAuthor | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, ID_MAX);
  if (!id) return null;
  const avatar = text(value.avatarUrl, 2_000_000);
  return {
    id,
    displayName: text(value.displayName, 120),
    username: text(value.username, 64),
    avatarUrl: SAFE_AVATAR.test(avatar) ? avatar : "",
    verified: value.verified === true,
    moderator: value.moderator === true,
    privateProfile: value.privateProfile === true,
    e2eePublicKey: text(value.e2eePublicKey, 4096),
  };
}

export function parseStatusKind(value: unknown): StatusKind {
  const kind = typeof value === "string" ? value.toUpperCase() : "";
  return kind === "IMAGE" || kind === "VIDEO" ? kind : "TEXT";
}

export function parseStatusItem(value: unknown): StatusItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, ID_MAX);
  if (!id) return null;
  const seconds = Math.max(0, Math.min(STATUS_VIDEO_SECONDS_MAX, numberOr(value.seconds, 0)));
  return {
    id,
    kind: parseStatusKind(value.kind),
    text: text(value.text, STATUS_TEXT_MAX),
    // An unknown style falls back to amber exactly as the viewer does.
    bgStyle: statusBgStyle(text(value.bgStyle, 20)).id,
    hasMedia: value.hasMedia === true,
    seconds,
    createdAt: iso(value.createdAt),
    expiresAt: iso(value.expiresAt),
    viewers: Math.max(0, Math.round(numberOr(value.viewers, 0))),
  };
}

function parseStatusGroup(value: unknown): StatusGroup | null {
  if (!isRecord(value)) return null;
  const author = parseStatusAuthor(value.user);
  if (!author) return null;
  const raw = Array.isArray(value.statuses) ? value.statuses : [];
  const statuses = raw
    .map((item) => parseStatusItem(item))
    .filter((item): item is StatusItem => item !== null);
  // A group with no rows has nothing to show; the phone's viewer draws its
  // "No status" empty state instead of an empty ring.
  if (statuses.length === 0) return null;
  return {
    author,
    mine: value.mine === true,
    allViewed: value.allViewed === true,
    statuses,
  };
}

/**
 * The feed, in the order the phone draws it.
 *
 * The server groups per author in author order, so "newest update first" is a
 * CLIENT sort (StatusScreens.kt:124): mine stays on top, everybody else is
 * ordered by their newest `createdAt`, descending. Authors the reader hid are
 * dropped here, not in the component, so the count in the header is honest.
 */
export function parseStatusFeed(
  payload: unknown,
  hiddenAuthorIds: readonly string[] = [],
): StatusFeed {
  const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
  const hidden = new Set(hiddenAuthorIds.filter((id) => id.length > 0));
  let mine: StatusGroup | null = null;
  const others: StatusGroup[] = [];
  for (const raw of items) {
    const group = parseStatusGroup(raw);
    if (!group) continue;
    if (group.mine) {
      // The server sends one `mine` group; a second one is a hostile payload.
      if (!mine) mine = group;
      continue;
    }
    if (hidden.has(group.author.id)) continue;
    others.push(group);
  }
  others.sort((a, b) => newestCreatedAt(b).localeCompare(newestCreatedAt(a)));
  return { mine, others };
}

/** The newest `createdAt` in a group, or "" — the sort key the phone uses. */
export function newestCreatedAt(group: StatusGroup): string {
  return group.statuses.reduce(
    (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
    "",
  );
}

/* ------------------------------------------------------- the viewer's rules */

/**
 * How long one status holds the screen (StatusScreens.kt:648).
 *
 * A photo or a text card: five seconds. A clip with a known length: that
 * length, inside 5…120 s. A clip whose length never arrived: thirty seconds.
 */
export function statusHoldMs(status: StatusItem): number {
  if (status.kind !== "VIDEO") return STATUS_PHOTO_HOLD_MS;
  if (status.seconds > 0) {
    return Math.max(
      STATUS_VIDEO_HOLD_MIN_MS,
      Math.min(STATUS_VIDEO_HOLD_MAX_MS, status.seconds * 1000),
    );
  }
  return STATUS_VIDEO_FALLBACK_HOLD_MS;
}

/**
 * How much of segment `i` is filled while `current` is on screen — the phone's
 * `progressTo`: everything before it is full, everything after is empty.
 */
export function segmentFill(index: number, current: number, progress: number): number {
  if (index < current) return 1;
  if (index > current) return 0;
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

/**
 * Every reason the clock stops (StatusScreens.kt:664 and :684). A hidden tab is
 * the browser's `Store.foreground === false`: the phone pauses on the home
 * button, a browser pauses when the tab is not visible, and a viewer must never
 * come back to a status that ran on without them.
 */
export type StatusPause = {
  readonly viewersOpen: boolean;
  readonly menuOpen: boolean;
  readonly replyFocused: boolean;
  readonly hidden: boolean;
  readonly holding: boolean;
};

export function statusPaused(pause: StatusPause): boolean {
  return pause.viewersOpen || pause.menuOpen || pause.replyFocused || pause.hidden || pause.holding;
}

/**
 * Stepping. Left half = previous (and stays put on the first), right half =
 * next, and stepping off the end CLOSES the viewer (`nav.popBackStack()`),
 * which is the WhatsApp behaviour the phone copied.
 */
export type StatusStep = { readonly index: number; readonly close: boolean };

export function stepStatus(index: number, count: number, direction: "back" | "next"): StatusStep {
  if (count <= 0) return { index: 0, close: true };
  if (direction === "back") return { index: Math.max(0, index - 1), close: false };
  if (index + 1 < count) return { index: index + 1, close: false };
  return { index, close: true };
}

/**
 * The count beside the eye: `maxOf(feed viewers, fetched list size)` — the
 * feed's number can lag a poll behind the sheet (ScreenStore.statusViewCount).
 */
export function statusViewCount(status: StatusItem, fetchedViewers: number): number {
  return Math.max(status.viewers, Math.max(0, fetchedViewers));
}

/** One ring segment per status, at least one: `segments.coerceAtLeast(1)`. */
export function ringSegments(count: number): number {
  return Math.max(1, Math.round(count));
}

/**
 * The ring's arcs, in the phone's geometry: `n` equal segments around the
 * circle, each separated by a 5 dp gap (no gap at all when there is one),
 * starting at twelve o'clock and centred on the gap.
 *
 * Returned as SVG arc paths so the browser draws the same picture the Canvas
 * does, from the same numbers.
 */
export function ringArcs(
  segments: number,
  sizePx: number,
  ringWidthPx: number = STATUS_RING_WIDTH_DP,
  gapPx: number = STATUS_RING_GAP_DP,
): readonly string[] {
  const n = ringSegments(segments);
  const stroke = Math.max(0.5, ringWidthPx);
  const radius = Math.max(1, (sizePx - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const gap = n === 1 ? 0 : Math.min(gapPx, circumference / (n * 2));
  const segmentAngle = (circumference - gap * n) / n / radius; // radians
  const gapAngle = n === 1 ? 0 : gap / radius;
  const centre = sizePx / 2;
  const paths: string[] = [];
  // -90° is twelve o'clock; the first arc starts half a gap in.
  let start = -Math.PI / 2 + gapAngle / 2;
  for (let index = 0; index < n; index += 1) {
    paths.push(describeArc(centre, centre, radius, start, start + segmentAngle));
    start += segmentAngle + gapAngle;
  }
  return paths;
}

function describeArc(cx: number, cy: number, r: number, from: number, to: number): string {
  const x1 = cx + r * Math.cos(from);
  const y1 = cy + r * Math.sin(from);
  const x2 = cx + r * Math.cos(to);
  const y2 = cy + r * Math.sin(to);
  // Compose's drawArc sweeps the short way for these angles; the large-arc flag
  // only matters past π, which a single segment reaches only when n === 1.
  const largeArc = to - from > Math.PI ? 1 : 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  return `M ${round(x1)} ${round(y1)} A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(x2)} ${round(y2)}`;
}

/* -------------------------------------------------------------- the stamps */

/**
 * The Dhaka-zone primitives live in `time/dhakaTime.ts`: the Calls tab needs the
 * very same `listStamp` the viewers sheet uses, and one `Theme.kt` function on
 * the phone must not become two copies here. `listStamp` is re-exported below so
 * every existing importer keeps its path.
 */

/**
 * The viewer header's stamp — `statusStamp`: "Today at 4:39 PM", "Yes at 4:39
 * PM", a weekday inside a week, then "12 Aug". (The phone really does print
 * "Yes", not "Yesterday"; the string is copied, not corrected.)
 */
export function statusStamp(isoText: string, nowMs: number = Date.now()): string {
  if (!isoText) return "";
  const then = dhakaParts(isoText);
  const now = dhakaParts(new Date(nowMs).toISOString());
  if (!then || !now) return "";
  const days = daysBetween(then, now);
  const clock = clockLabel(then.hour, then.minute);
  if (days === 0) return `Today at ${clock}`;
  if (days === 1) return `Yes at ${clock}`;
  // The phone's third branch is a bare `< 7`, so a stamp from a device whose
  // clock is ahead still reads as a weekday rather than as a date.
  if (days < 7) return weekdayLabel(then.weekday);
  return `${then.day} ${monthLabel(then.month)}`;
}

/**
 * The one-line row stamp — `statusStampShort`: the same buckets without the
 * "Today at" prefix, so "3 updates · 4:39 PM" never wraps.
 */
export function statusStampShort(isoText: string, nowMs: number = Date.now()): string {
  return listStamp(isoText, nowMs);
}

/**
 * The viewers sheet's stamp — `listStamp` in Theme.kt: same buckets, no prefix.
 * Shared with the Calls tab, which prints the identical string on a history row.
 */
export { listStamp } from "../time/dhakaTime";

/**
 * When a status expires, for the "expires in" line the phone does not have but a
 * browser tab that stays open for days does: the row is gone at `expiresAt`.
 */
export function statusExpiresInMs(status: StatusItem, nowMs: number = Date.now()): number {
  const expires = Date.parse(status.expiresAt);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, expires - nowMs);
}

/* ------------------------------------------------------- the composer rules */

export type StatusBgStyle = { readonly id: string; readonly from: string; readonly to: string };

/** An unknown or hostile style falls back to the default, never to `undefined`. */
export function statusBgStyle(id: string): StatusBgStyle {
  return (
    STATUS_BG_STYLES.find((style) => style.id === id) ?? (STATUS_BG_STYLES[0] as StatusBgStyle)
  );
}

/** The CSS the browser needs for one gradient card. */
export function statusGradientCss(style: StatusBgStyle): string {
  return `linear-gradient(160deg, ${style.from} 0%, ${style.to} 100%)`;
}

/**
 * What the composer may post, checked BEFORE the request so the reader gets a
 * reason instead of a transport error. The Worker's own refusals are mirrored
 * here with the phone's wording:
 *   TEXT  without text  → "Write something for the status."
 *   IMAGE without bytes → "Pick a photo for the status."
 *   VIDEO without bytes → "Pick a video for the status."
 *   a long data URL     → "Photo too large — pick a smaller image."
 */
export type StatusDraft =
  | { readonly kind: "TEXT"; readonly text: string; readonly bgStyle: string }
  | { readonly kind: "IMAGE"; readonly imageData: string; readonly fileKey: string }
  | { readonly kind: "VIDEO"; readonly fileKey: string; readonly seconds: number };

export type StatusDraftVerdict =
  | { readonly allowed: true; readonly reason: "" }
  | { readonly allowed: false; readonly reason: string };

export function statusDraftVerdict(draft: StatusDraft): StatusDraftVerdict {
  if (draft.kind === "TEXT") {
    if (!draft.text.trim()) return refuse(STATUS_COPY.emptyText);
    if (draft.text.length > STATUS_TEXT_MAX) return refuse(STATUS_COPY.textTooLong);
    return allow();
  }
  if (draft.kind === "IMAGE") {
    if (!draft.imageData && !draft.fileKey) return refuse(STATUS_COPY.emptyPhoto);
    if (draft.imageData.length > STATUS_IMAGE_DATA_MAX) return refuse(STATUS_COPY.photoTooLarge);
    return allow();
  }
  if (!draft.fileKey) return refuse(STATUS_COPY.emptyVideo);
  return allow();
}

const allow = (): StatusDraftVerdict => ({ allowed: true, reason: "" });
const refuse = (reason: string): StatusDraftVerdict => ({ allowed: false, reason });

/**
 * The POST body for one draft. Field names are the Worker's; `bgStyle` only
 * travels with a text status because that is the only kind that draws one.
 */
export function statusPostBody(draft: StatusDraft): Record<string, unknown> {
  if (draft.kind === "TEXT") {
    return {
      kind: "TEXT",
      text: draft.text.trim().slice(0, STATUS_TEXT_MAX),
      bgStyle: statusBgStyle(draft.bgStyle).id,
    };
  }
  if (draft.kind === "IMAGE") {
    // The phone posts the baked JPEG inline; a photo too big for the data-URL
    // cap is uploaded instead and posted by key, which the Worker accepts for
    // the same field (`imageData ?? fileKey`).
    return draft.imageData
      ? { kind: "IMAGE", imageData: draft.imageData, text: "" }
      : { kind: "IMAGE", fileKey: draft.fileKey, text: "" };
  }
  return {
    kind: "VIDEO",
    fileKey: draft.fileKey,
    seconds: statusSecondsOf(draft.seconds),
    text: "",
  };
}

/**
 * The clip's length as the phone reports it: milliseconds rounded to the
 * nearest second with `+500`, at least one, and the Worker clamps to 120.
 */
export function statusSecondsOf(seconds: number): number {
  const ms = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  // `((e - s + 500L) / 1000L).toInt()` is an integer division of a positive
  // number, i.e. a floor; `.coerceAtLeast(1)` is the minimum below, and the
  // Worker clamps the same field to 0…120 on the way in.
  return Math.max(
    STATUS_VIDEO_SECONDS_MIN,
    Math.min(STATUS_VIDEO_SECONDS_MAX, Math.floor((ms + 500) / 1000)),
  );
}

/**
 * Whether a baked photo still fits the Worker's inline cap, and how far to go
 * down the quality ladder when it does not. The phone bakes once and lets the
 * server refuse; a browser can simply try the next step, so the reader never
 * sees "Photo too large" for a picture the phone would have shrunk anyway.
 */
export const STATUS_PHOTO_STEPS = [
  { longEdge: 1280, quality: 0.82 },
  { longEdge: 1080, quality: 0.72 },
  { longEdge: 900, quality: 0.62 },
  { longEdge: 720, quality: 0.52 },
] as const;

export function photoFitsInline(dataUrl: string): boolean {
  return dataUrl.length > 0 && dataUrl.length <= STATUS_IMAGE_DATA_MAX;
}

/* ------------------------------------------------------------- the replies */

/**
 * A reply to a status is an ordinary 1:1 message that carries WHICH status it
 * answers: `meta.status = { id }`. The Worker expands it to `{id, kind, text}`
 * (`statusQuote`) and both clients draw a small quote in the bubble.
 */
export function statusReplyMeta(statusId: string): Record<string, unknown> | undefined {
  const id = text(statusId, ID_MAX);
  return id ? { status: { id } } : undefined;
}

/* The quote helpers live in ./statusQuote so the messaging chunk can parse
   `meta.status` without pulling this file (and its copy catalog) along. */
export {
  parseStatusQuote,
  statusQuoteCaption,
  statusQuoteHasThumb,
  type StatusQuote,
} from "./statusQuote";

/* --------------------------------------------------------------- the copy */

/**
 * Every string this surface draws, in one place so a contract case can compare
 * them with the Kotlin instead of trusting a component to have typed them right.
 */
export const STATUS_COPY = {
  myStatus: "My status",
  addPlaceholder: "Tap to add a status update",
  myUpdates: "My updates",
  recentUpdates: "Recent updates",
  addStatus: "Add status",
  mediaStatus: "Media status",
  textStatus: "Text status",
  composerTitle: "Text status",
  composerHint: "Tap kore likha shuru korun…",
  composerField: "Apnar status…",
  post: "Post status",
  close: "Close",
  noStatus: "No status",
  noStatusYet: "No status updates yet.",
  noStatusYetBody:
    "Updates from the people you chat with appear here for 24 hours. Yours stay visible to the audience your privacy setting allows.",
  feedEmpty: "Nothing to show yet",
  loading: "Loading…",
  noMedia: "No media",
  allowGallery: "Allow gallery",
  views: "Views",
  view: "view",
  menu: "Menu",
  menuDelete: "Delete status",
  menuMessage: "Message",
  menuHide: "Hide status",
  menuReport: "Report",
  hiddenToast: "Status hidden",
  reportedToast: "Reported. Thank you.",
  deleteTitle: "Delete status?",
  deleteText: "Removed for everyone.",
  deleteConfirm: "Delete",
  viewersTitle: "Viewed by",
  viewersEmpty: "No views yet.",
  viewersError: "Couldn't load viewers. Try again.",
  replyPlaceholder: "Reply to",
  sendReply: "Send reply",
  previous: "Previous status",
  next: "Next status",
  pause: "Pause",
  resume: "Resume",
  openViewer: "Open the status viewer",
  emptyText: "Write something for the status.",
  textTooLong: "That is longer than 500 characters.",
  emptyPhoto: "Pick a photo for the status.",
  emptyVideo: "Pick a video for the status.",
  photoTooLarge: "Photo too large — pick a smaller image.",
  photoPreparing: "Preparing that photo…",
  videoPreparing: "Uploading that clip…",
  postFailed: "Status didn't post. Try again.",
  replyFailed: "Could not send the reply. Please try again.",
  sharing: "Sharing status…",
  statusKindPhoto: "Photo",
  statusKindVideo: "Video",
  statusKindText: "Status",
  quoteLabel: "Status",
  privacyPublic: "Everyone who chats with you",
  privacyContacts: "Your 1:1 contacts only",
  privacyNobody: "Only you",
  /**
   * What a browser cannot do here, said out loud instead of hidden behind a
   * control that looks like it works.
   */
  browserNotice:
    "A browser cannot trim or re-encode a clip, so a video status is posted whole and timed to its real length (the server caps it at 120 seconds). Photos are shrunk in the browser to fit the inline limit, or uploaded when they are too large for it.",
  hiddenNotice: "Hidden authors are kept in this browser only; the phone keeps its own list.",
  expiredNotice: "A status lives for 24 hours and then it is gone for everyone.",
} as const;

/** "3 updates · 4:39 PM" — the phone's row subtitle, pluralised the same way. */
export function statusRowSubtitle(count: number, stamp: string): string {
  return `${count} update${count === 1 ? "" : "s"}${stamp ? ` · ${stamp}` : ""}`;
}

/** "My updates · 4:39 PM · 3 views" — the phone's own-status subtitle. */
export function myStatusSubtitle(stamp: string, views: number): string {
  const base = `${STATUS_COPY.myUpdates}${stamp ? ` · ${stamp}` : ""}`;
  return views > 0 ? `${base} · ${views} ${views === 1 ? STATUS_COPY.view : "views"}` : base;
}

/** "3 views" beside the eye, pluralised as the phone does. */
export function viewsLabel(views: number): string {
  return `${views} ${views === 1 ? STATUS_COPY.view : "views"}`;
}

/* --------------------------------------------------------- hidden authors */

/**
 * "Hide status" is local to the device (ScreenStore.hiddenStatusUserIds,
 * persisted to a file there). A browser tab keeps the same list in
 * localStorage, and the notice says it is this browser's own list.
 */
export const STATUS_HIDDEN_KEY = "kp.status.hidden";

export function parseHiddenAuthors(raw: string | null): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const ids = isRecord(parsed) && Array.isArray(parsed.ids) ? parsed.ids : [];
    return ids
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 500)
      .map((id) => id.slice(0, ID_MAX));
  } catch {
    return [];
  }
}

/** The phone's file shape is `{"ids":[…]}`; the same shape keeps the two alike. */
export function serializeHiddenAuthors(ids: readonly string[]): string {
  const unique = [...new Set(ids.filter((id) => id.length > 0))].slice(0, 500);
  return JSON.stringify({ ids: unique });
}

export function withHiddenAuthor(ids: readonly string[], authorId: string): readonly string[] {
  if (!authorId) return ids;
  return ids.includes(authorId) ? ids : [...ids, authorId];
}

/** Which author's statuses the viewer opens on ("mine" is the reader's own). */
export type StatusesTarget =
  { readonly kind: "mine" } | { readonly kind: "author"; readonly authorId: string };

/* ------------------------------------------------------------ viewer lists */

export type StatusViewerRow = {
  readonly author: StatusAuthor;
  readonly viewedAt: string;
  readonly reaction: string;
};

export function parseStatusViewers(payload: unknown): readonly StatusViewerRow[] {
  const rows = isRecord(payload) && Array.isArray(payload.viewers) ? payload.viewers : [];
  const out: StatusViewerRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const author = parseStatusAuthor(row.user);
    if (!author) continue;
    out.push({
      author,
      viewedAt: iso(row.viewedAt),
      // One emoji, already validated server-side; capped again here because a
      // viewer list is drawn straight into the owner's screen.
      reaction: text(row.reaction, 16),
    });
  }
  return out;
}

/**
 * The emoji a status reaction may be. The Worker refuses anything else
 * (`BAD_REACTION`) after an owner found `<script>alert(1)` landing in a viewer
 * list, so the client checks the same shape before it spends a request.
 */
const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
const EMOJI_REAL = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function isStatusReaction(value: string): boolean {
  const emoji = value.trim().slice(0, 16);
  return emoji.length > 0 && EMOJI_ONLY.test(emoji) && EMOJI_REAL.test(emoji);
}

/** Which statuses of a group are already seen: the ring grays out only when all are. */
export function groupSeen(group: StatusGroup): boolean {
  return group.mine ? false : group.allViewed;
}

/** The author's name as the viewer header draws it: theirs, or "My status". */
export function viewerAuthorName(group: StatusGroup, myName: string): string {
  return group.mine ? myName || STATUS_COPY.myStatus : group.author.displayName || "Status";
}
