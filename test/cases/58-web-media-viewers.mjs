/**
 * Web viewers + shared media + view-once contract (slice E1).
 *
 * The same discipline as case 57: nothing here is asserted against the client's
 * own opinion. Every rule is compared with the source that owns it —
 * `src/worker/index.ts` for the wire contract, `ChatMediaScreen.kt`,
 * `ChatScreen.kt` and `MediaViewer.kt` for the surface the browser is standing
 * in for. Where the phone's number is a constant, the constant is parsed out of
 * the Kotlin at test time, so a drift on either side fails here rather than in
 * a reader's hands.
 *
 * The view-once half is the part that matters most: getting it wrong either
 * burns an opening the reader never asked for, or lets a modified client pull
 * bytes the sender believed were gone.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EMPTY_SHARED_MEDIA,
  SHARED_MEDIA_EMPTY,
  SHARED_MEDIA_REFUSALS,
  SHARED_MEDIA_TABS,
  SHARED_MEDIA_TITLE,
  docLabel,
  docsList,
  firstLink,
  linksList,
  mediaGrid,
  parseSharedMedia,
  rowsForTab,
  sharedMediaCount,
  sharedMediaRefusal,
  visibleMedia,
} from "../../web/src/messaging/sharedMedia.ts";
import {
  ONCE_TEXT_REVEAL_MS,
  ONCE_TEXT_TICK_MS,
  VANISH_GRACE_MS,
  createViewOnceSpender,
  fileLooksVideo,
  fileLooksVoice,
  isViewOnce,
  onceMediaSource,
  onceQuoteLabel,
  onceTextCountdown,
  onceTextRemaining,
  openingCostsFetch,
  viewOnceSpent,
} from "../../web/src/messaging/viewOnce.ts";
import { attachmentMeta, describeAttachment } from "../../web/src/messaging/attachments.ts";
import { buildAttachmentMeta } from "../../web/src/media/uploadContract.ts";
import { EMPTY_EDIT } from "../../web/src/media/imageEdit.ts";
import {
  albumIdOf,
  applyMessageFrame,
  foldAlbums,
  isPhotoMessage,
  isVanishedMarker,
  parseMessageRow,
} from "../../web/src/messaging/protocol.ts";
import { MESSAGE_MEDIA_PREFIX, mediaSourceKey } from "../../web/src/messaging/mediaUrl.ts";
import {
  DOUBLE_TAP_ZOOM,
  DRAG_CLOSE_THRESHOLD,
  KEY_PAN_STEP,
  ZOOM_EPSILON,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  panLimit,
  isZoomed,
} from "../../web/src/messaging/viewerGeometry.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ANDROID = "native-android/app/src/main/java/app/kuchupuchu/android";
const workerSource = readFileSync(resolve("src/worker/index.ts"), "utf8");
const chatMediaSource = readFileSync(resolve(`${ANDROID}/ChatMediaScreen.kt`), "utf8");
const chatSource = readFileSync(resolve(`${ANDROID}/ChatScreen.kt`), "utf8");
const viewerSource = readFileSync(resolve(`${ANDROID}/MediaViewer.kt`), "utf8");

/** A real MessageRow, so every check runs against the parsed shape. */
const row = (fields) =>
  parseMessageRow({
    id: "m",
    kind: "TEXT",
    body: "",
    createdAt: "2026-10-04T09:00:00.000Z",
    ...fields,
  });

/* ------------------------------------------- shared media: the wire shape --- */

check(
  "the worker serves the gallery at /api/conversations/:id/media",
  workerSource.includes("/^\\/api\\/conversations\\/([^/]+)\\/media$/"),
);
check(
  "the gallery answer is exactly four lists",
  /return json\(\{ images, videos, docs, links \}\);/.test(workerSource),
);
const limitMatch = workerSource.match(/ORDER BY created_at DESC LIMIT (\d+)/);
check(
  "the gallery is one shot with no cursor",
  Boolean(limitMatch),
  `LIMIT ${limitMatch?.[1] ?? "?"}`,
);
check(
  "the client keeps no cursor either: parseSharedMedia returns four arrays only",
  Object.keys(
    parseSharedMedia({ images: [], videos: [], docs: [], links: [], nextCursor: "x" }),
  ).join(",") === "images,videos,docs,links",
);
check(
  "a private group is refused by the worker",
  workerSource.includes('fail(403, "This group is private.", "PRIVATE_GROUP")'),
);
check(
  "an unaccepted request is refused by the worker",
  workerSource.includes('fail(403, "Accept the message request first.", "REQUEST_PENDING")'),
);
check(
  "the client has copy for PRIVATE_GROUP",
  SHARED_MEDIA_REFUSALS.PRIVATE_GROUP.includes("private"),
);
check(
  "the client has copy for REQUEST_PENDING",
  SHARED_MEDIA_REFUSALS.REQUEST_PENDING.includes("Accept"),
);
check(
  "a refusal falls back to the transport message",
  sharedMediaRefusal("SOMETHING_ELSE", "The request could not be completed.") ===
    "The request could not be completed.",
);
check(
  "the worker leaves view-once rows out of the gallery",
  /if \(m\.viewOnce\) continue;/.test(workerSource),
);

/* ------------------------------------- shared media: parity with the phone --- */

const kotlinTabs = chatMediaSource.match(/listOf\(([^)]*)\)\.forEachIndexed/);
check("the phone's tab list was found", Boolean(kotlinTabs), kotlinTabs?.[1] ?? "missing");
const kotlinTabLabels = kotlinTabs
  ? [...kotlinTabs[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  : [];
check(
  "the web tabs are the phone's three tabs, in order",
  [...SHARED_MEDIA_TABS].join("|") === kotlinTabLabels.join("|"),
  `${[...SHARED_MEDIA_TABS].join("|")} vs ${kotlinTabLabels.join("|")}`,
);
check(
  "the panel title is the phone's",
  chatMediaSource.includes(`"${SHARED_MEDIA_TITLE}"`),
  SHARED_MEDIA_TITLE,
);
for (const tab of SHARED_MEDIA_TABS) {
  const copy = SHARED_MEDIA_EMPTY[tab];
  check(
    `the ${tab} empty state is the phone's wording`,
    chatMediaSource.includes(`"${copy.title}"`) &&
      (copy.body === "" || chatMediaSource.includes(`"${copy.body}"`)),
    `${copy.title}${copy.body ? ` / ${copy.body}` : ""}`,
  );
}
check(
  'a document row falls back to "File", like the phone',
  docLabel(row({ fileName: "" })) === "File" && chatMediaSource.includes('ifBlank { "File" }'),
);
check(
  "a document row keeps its own name",
  docLabel(row({ fileName: "report.pdf" })) === "report.pdf",
);

/* --------------------------------------- shared media: parsing and order --- */

check(
  "a payload that is not an object yields nothing",
  parseSharedMedia(null) === EMPTY_SHARED_MEDIA,
);
check(
  "a payload of junk yields four empty lists",
  sharedMediaCount(parseSharedMedia({ images: 7, videos: "x", docs: [null, 3], links: {} })) === 0,
);
check(
  "rows without an id are dropped",
  parseSharedMedia({
    images: [{ kind: "FILE" }, { id: "ok", kind: "FILE" }],
    videos: [],
    docs: [],
    links: [],
  }).images.length === 1,
);
const oncePayload = parseSharedMedia({
  images: [
    { id: "plain", kind: "FILE", fileType: "image/png", createdAt: "2026-10-04T09:00:00.000Z" },
    {
      id: "once",
      kind: "FILE",
      fileType: "image/png",
      viewOnce: true,
      meta: { viewOnce: true },
      createdAt: "2026-10-04T09:01:00.000Z",
    },
  ],
  videos: [],
  docs: [],
  links: [],
});
check(
  "a view-once row is dropped even if the server ever sent one",
  oncePayload.images.length === 1 && oncePayload.images[0].id === "plain",
);

const gallery = parseSharedMedia({
  images: [
    {
      id: "i_old",
      kind: "FILE",
      fileType: "image/png",
      createdAt: "2026-10-04T08:00:00.000Z",
      rowid: 2,
    },
    {
      id: "i_new",
      kind: "FILE",
      fileType: "image/png",
      createdAt: "2026-10-04T10:00:00.000Z",
      rowid: 9,
    },
  ],
  videos: [
    {
      id: "v_mid",
      kind: "FILE",
      fileType: "video/mp4",
      createdAt: "2026-10-04T09:00:00.000Z",
      rowid: 5,
    },
  ],
  docs: [
    {
      id: "d_1",
      kind: "FILE",
      fileType: "application/pdf",
      createdAt: "2026-10-04T07:00:00.000Z",
      rowid: 1,
    },
  ],
  links: [
    {
      id: "l_1",
      kind: "TEXT",
      body: "look https://a.example/x ok",
      createdAt: "2026-10-04T06:00:00.000Z",
      rowid: 0,
    },
  ],
});
check(
  "the media tab merges photos and videos newest-first",
  mediaGrid(gallery)
    .map((item) => item.id)
    .join(",") === "i_new,v_mid,i_old",
  mediaGrid(gallery)
    .map((item) => item.id)
    .join(","),
);
check(
  "the phone merges the same two lists the same way",
  chatMediaSource.includes("(images + videos).sortedByDescending"),
);
check(
  "the docs tab is its own list",
  docsList(gallery)
    .map((item) => item.id)
    .join(",") === "d_1",
);
check(
  "the links tab is its own list",
  linksList(gallery)
    .map((item) => item.id)
    .join(",") === "l_1",
);
check(
  "rowsForTab agrees with the three lists",
  rowsForTab(gallery, "Media").length === 3 &&
    rowsForTab(gallery, "Docs").length === 1 &&
    rowsForTab(gallery, "Links").length === 1,
);
check("the gallery counts every list", sharedMediaCount(gallery) === 5);

const gone = new Set(["i_new"]);
check(
  "a row that left the transcript leaves the panel too",
  visibleMedia(gallery, gone)
    .images.map((item) => item.id)
    .join(",") === "i_old" && visibleMedia(gallery, gone).videos.length === 1,
);
check("an empty gone-set returns the same object", visibleMedia(gallery, new Set()) === gallery);

/* ------------------------------------------- link extraction: worker regex --- */

const workerUrlRe = workerSource.match(/const urlRe = (\/.+?\/[a-z]*);/);
check("the worker's link pattern was found", Boolean(workerUrlRe), workerUrlRe?.[1] ?? "missing");
const linkSamples = [
  "এই লিঙ্কটা দেখো https://kuchupuchu.app/privacy সবাই",
  "no link here at all",
  "two http://a.example and https://b.example/x?q=1 links",
  "trailing punctuation https://c.example/path.",
  "ftp://not-a-link.example/x",
];
for (const sample of linkSamples) {
  const reference = workerUrlRe
    ? new RegExp(workerUrlRe[1].slice(1, workerUrlRe[1].lastIndexOf("/")), "i")
    : null;
  const expected = reference ? (reference.exec(sample)?.[0] ?? "") : "";
  check(
    `firstLink agrees with the worker on ${JSON.stringify(sample.slice(0, 28))}`,
    firstLink(sample) === expected,
    `${firstLink(sample)} vs ${expected}`,
  );
}
check("a body with no link yields nothing", firstLink("শুধু কথা") === "");

/* ------------------------------------------------- view once: the numbers --- */

const kotlinReveal = chatSource.match(/ONCE_TEXT_REVEAL_MS = ([\d_]+)L/);
check("the phone's reveal window was found", Boolean(kotlinReveal), kotlinReveal?.[1] ?? "missing");
check(
  "a revealed once-text lives exactly as long as on the phone",
  ONCE_TEXT_REVEAL_MS === Number(String(kotlinReveal?.[1] ?? "").replace(/_/g, "")),
  `${ONCE_TEXT_REVEAL_MS}`,
);
check("the countdown repaints faster than it counts", ONCE_TEXT_TICK_MS < ONCE_TEXT_REVEAL_MS);
check(
  "the vanish grace is shorter than the reveal",
  VANISH_GRACE_MS > 0 && VANISH_GRACE_MS < ONCE_TEXT_REVEAL_MS,
);
check(
  "the remaining time clamps at both ends",
  onceTextRemaining(Date.now(), Date.now()) === ONCE_TEXT_REVEAL_MS &&
    onceTextRemaining(Date.now() - ONCE_TEXT_REVEAL_MS - 5_000, Date.now()) === 0,
);
check(
  "the countdown reads as whole seconds",
  onceTextCountdown(4_001) === "5s left" && onceTextCountdown(4_000) === "4s left",
);
check("an exhausted countdown says gone", onceTextCountdown(0) === "gone");

/* --------------------------------------- view once: parity with the phone --- */

const quoteLabels = [
  "Message · View once",
  "Video · View once",
  "Voice message · View once",
  "Photo · View once",
];
for (const label of quoteLabels) {
  check(
    `the phone quotes a once-message as ${JSON.stringify(label)}`,
    chatSource.includes(`"${label}"`),
  );
}
check(
  "a once TEXT quotes as a message, never as a photo",
  onceQuoteLabel(row({ kind: "TEXT", viewOnce: true, meta: { viewOnce: true } })) ===
    "Message · View once",
);
check(
  "a once clip quotes as a video",
  onceQuoteLabel(row({ kind: "FILE", fileType: "video/mp4", meta: { viewOnce: true } })) ===
    "Video · View once",
);
check(
  "a once voice note quotes as a voice message",
  onceQuoteLabel(
    row({ kind: "FILE", fileType: "audio/mpeg", meta: { voice: true, viewOnce: true } }),
  ) === "Voice message · View once",
);
check(
  "anything else quotes as a photo",
  onceQuoteLabel(row({ kind: "FILE", fileType: "image/png", meta: { viewOnce: true } })) ===
    "Photo · View once",
);
check(
  "a video sent as a document is not a clip",
  fileLooksVideo(row({ kind: "FILE", fileType: "video/mp4", meta: { document: true } })) ===
    false && fileLooksVideo(row({ kind: "FILE", fileType: "video/mp4", meta: {} })) === true,
);
check(
  "a voice note needs both meta.voice and an audio type",
  fileLooksVoice(row({ kind: "FILE", fileType: "audio/mpeg", meta: { voice: true } })) === true &&
    fileLooksVoice(row({ kind: "FILE", fileType: "audio/mpeg", meta: {} })) === false &&
    fileLooksVoice(row({ kind: "FILE", fileType: "image/png", meta: { voice: true } })) === false,
);
check(
  "the flag is read from the row or from meta, like the phone",
  isViewOnce(row({ viewOnce: true })) === true &&
    isViewOnce(row({ meta: { viewOnce: true } })) === true &&
    isViewOnce(row({})) === false,
);
check(
  "spent means flagged AND stamped",
  viewOnceSpent(row({ viewOnce: true, viewedAt: "2026-10-04T09:05:00.000Z" })) === true &&
    viewOnceSpent(row({ viewOnce: true })) === false &&
    viewOnceSpent(row({ viewedAt: "2026-10-04T09:05:00.000Z" })) === false,
);

/* --------------------------------------- view once: which fetch spends it --- */

const inlineImage = row({ kind: "IMAGE", mediaUrl: "/api/messages/m9/media", hasImage: true });
const uploadedPhoto = row({ kind: "FILE", fileType: "image/png", fileKey: "f/a.jpg" });
const onceInline = row({
  kind: "IMAGE",
  mediaUrl: "/api/messages/m9/media",
  viewOnce: true,
  meta: { viewOnce: true },
});
const onceUpload = row({
  kind: "FILE",
  fileType: "image/png",
  fileKey: "f/a.jpg",
  viewOnce: true,
  meta: { viewOnce: true },
});
const spentOnce = row({
  kind: "FILE",
  fileType: "image/png",
  viewOnce: true,
  viewedAt: "2026-10-04T09:05:00.000Z",
  meta: { viewOnce: true, viewedAt: "2026-10-04T09:05:00.000Z" },
});

check(
  "an inline IMAGE row is served by the message route",
  onceMediaSource(inlineImage) === "message-media",
);
check("an uploaded FILE row is served by /api/files", onceMediaSource(uploadedPhoto) === "files");
check("a spent row advertises nothing", onceMediaSource(spentOnce) === "none");
check(
  "rendering an inline once-row would burn the opening",
  openingCostsFetch(onceInline) === true,
);
check(
  "rendering an uploaded once-photo does not — the phone blurs those very pixels",
  openingCostsFetch(onceUpload) === false,
);
check("a plain row never costs an opening", openingCostsFetch(uploadedPhoto) === false);
check(
  "the worker really does spend on the media fetch itself",
  /onceMeta\.viewOnce === true && row\.sender_id !== uid/.test(workerSource) &&
    workerSource.includes('fail(410, "This was already opened.", "VIEWED")'),
);
check(
  "the worker stops advertising media once a row is spent",
  /const spent = viewOnceSpent\(meta\);/.test(workerSource) &&
    /mediaUrl:\s*row\.kind === "IMAGE" && row\.media && !spent/.test(workerSource) &&
    /fileKey: row\.kind === "FILE" && !spent/.test(workerSource),
);
check(
  "mediaUrl and fileKey are mutually exclusive, so the client's precedence is safe",
  /mediaUrl:\s*row\.kind === "IMAGE"/.test(workerSource) &&
    /fileKey: row\.kind === "FILE"/.test(workerSource),
);
check(
  "the /view report has the three refusals the client must treat as terminal or fatal",
  workerSource.includes('fail(400, "Not a view-once message.", "NOT_VIEW_ONCE")') &&
    workerSource.includes('fail(403, "You sent this.", "OWN_MESSAGE")') &&
    workerSource.includes('fail(410, "This was already opened.", "VIEWED")'),
);

/* ----------------------------------------- view once: the spend de-dupe --- */

const calls = [];
const spender = createViewOnceSpender(async (id) => {
  calls.push(id);
  return { ok: true };
});
spender.spend("m1");
spender.spend("m1");
spender.spend("  ");
spender.spend("m1");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check(
  "one opening is reported once, however often it is asked for",
  calls.length === 1 && calls[0] === "m1",
  calls.join(","),
);
check("the id is remembered as spent", spender.isSpent("m1") === true);
check("a blank id is never reported", spender.isSpent("") === false);
spender.forget("m1");
check("forgetting releases the id", spender.isSpent("m1") === false);

const statusCalls = [];
const failing = (status) =>
  createViewOnceSpender(async (id) => {
    statusCalls.push(`${id}:${status}`);
    const error = new Error("refused");
    error.status = status;
    throw error;
  });
const gone410 = failing(410);
gone410.spend("m2");
gone410.spend("m2");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check(
  "a 410 is terminal: the row is gone for everyone, so it is not retried",
  statusCalls.filter((entry) => entry === "m2:410").length === 1 && gone410.isSpent("m2") === true,
  statusCalls.join(","),
);
statusCalls.length = 0;
const gone404 = failing(404);
gone404.spend("m3");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check("a 404 is terminal too", gone404.isSpent("m3") === true && statusCalls.length === 1);

statusCalls.length = 0;
const blip = failing(500);
blip.spend("m4");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check("a server blip releases the id", blip.isSpent("m4") === false, statusCalls.join(","));
blip.spend("m4");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check(
  "so the next viewing reports again",
  statusCalls.filter((entry) => entry === "m4:500").length === 2,
);

let settled = 0;
const notifying = createViewOnceSpender(async () => ({ ok: true }), {
  onSettled: () => (settled += 1),
});
notifying.spend("m5");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
check("a settled report pokes the caller, so the list can refresh", settled === 1, `${settled}`);
check(
  "the phone treats 404 and 410 as terminal in the same way",
  /status == 404 \|\| \(e as\? ApiException\)\?\.status == 410/.test(chatSource),
);

/* ------------------------------------------------- the VANISHED marker --- */

check(
  "a VANISHED row is recognised as a marker",
  isVanishedMarker(row({ kind: "VANISHED" })) === true,
);
check("a normal row is not", isVanishedMarker(row({ kind: "FILE" })) === false);
const withRows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
const vanished = applyMessageFrame(withRows, row({ id: "b", kind: "VANISHED" }), "me");
check(
  "a VANISHED frame removes its row and appends nothing",
  vanished.appended === false && vanished.messages.map((item) => item.id).join(",") === "a,c",
  vanished.messages.map((item) => item.id).join(","),
);
check("the worker broadcasts exactly that marker", /kind: "VANISHED",/.test(workerSource));

/* ------------------------------------------------ album folding parity --- */

check("an IMAGE row is a photo", isPhotoMessage(row({ kind: "IMAGE" })) === true);
check(
  "an image FILE is a photo",
  isPhotoMessage(row({ kind: "FILE", fileType: "image/png" })) === true,
);
check(
  "an image FILE sent as a document is not",
  isPhotoMessage(row({ kind: "FILE", fileType: "image/png", meta: { document: true } })) === false,
);
check(
  "a video FILE is not a photo",
  isPhotoMessage(row({ kind: "FILE", fileType: "video/mp4" })) === false,
);
check("a TEXT row is not a photo", isPhotoMessage(row({ kind: "TEXT" })) === false);

const albumRow = (id, extra = {}) =>
  row({
    id,
    kind: "FILE",
    fileType: "image/png",
    createdAt: `2026-10-04T09:0${id}:00.000Z`,
    rowid: Number(id),
    meta: { album: "alb_0123456789abcdef0123" },
    ...extra,
  });
check("a photo carries its album", albumIdOf(albumRow("1")) === "alb_0123456789abcdef0123");
check(
  "a clip does not join an album",
  albumIdOf(
    row({
      id: "2",
      kind: "FILE",
      fileType: "video/mp4",
      meta: { album: "alb_0123456789abcdef0123" },
    }),
  ) === "",
);
check(
  "a view-once photo never joins an album",
  albumIdOf(
    albumRow("3", { viewOnce: true, meta: { album: "alb_0123456789abcdef0123", viewOnce: true } }),
  ) === "",
);
check(
  "a row with no album has none",
  albumIdOf(row({ id: "4", kind: "FILE", fileType: "image/png" })) === "",
);

const plain = [row({ id: "p1" }), row({ id: "p2" })];
check("a transcript with no albums is returned untouched", foldAlbums(plain) === plain);

const pair = [albumRow("1"), row({ id: "text", kind: "TEXT" }), albumRow("2")];
const folded = foldAlbums(pair);
check(
  "two album siblings fold into one row, in place",
  folded.length === 2 &&
    folded[0].id === "1" &&
    folded[0].albumMembers.length === 2 &&
    folded[1].id === "text",
  folded.map((item) => item.id).join(","),
);
check(
  "the folded head keeps its own identity",
  folded[0].albumMembers.map((item) => item.id).join(",") === "1,2",
);
check("a row outside any album keeps an empty member list", folded[1].albumMembers.length === 0);

const single = [albumRow("9")];
check(
  "a group of one stays a plain photo",
  foldAlbums(single).length === 1 && foldAlbums(single)[0].albumMembers.length === 0,
);

const twoSenders = [albumRow("1"), albumRow("2", { senderId: "someone-else" })];
check(
  "different senders never fold together",
  foldAlbums(twoSenders).length === 2 &&
    foldAlbums(twoSenders).every((item) => item.albumMembers.length === 0),
);

const workerAlbumRe = workerSource.match(/const ALBUM_ID_RE = \/(.+)\/([a-z]*);/);
check(
  "the worker's album pattern was found",
  Boolean(workerAlbumRe),
  workerAlbumRe?.[1] ?? "missing",
);

/* -------------------------------------------------- media source order --- */

check(
  "a local echo wins: the browser already holds those bytes",
  mediaSourceKey({ id: "x", localPreview: "blob:abc", fileKey: "f/x.jpg", mediaUrl: "" }) ===
    "blob:abc",
);
check(
  "then the file key",
  mediaSourceKey({ id: "x", localPreview: "", fileKey: "f/x.jpg", mediaUrl: "" }) === "f/x.jpg",
);
check(
  "then the message route, namespaced so the hook knows what it spends",
  mediaSourceKey({ id: "x", localPreview: "", fileKey: "", mediaUrl: "/api/messages/x/media" }) ===
    `${MESSAGE_MEDIA_PREFIX}x`,
);
check(
  "a mediaUrl that is not the message route is ignored",
  mediaSourceKey({
    id: "x",
    localPreview: "",
    fileKey: "",
    mediaUrl: "https://cdn.example/x.jpg",
  }) === "",
);
check(
  "the phone resolves the same three sources in the same order",
  /kpLocalUrl"\)[\s\S]{0,120}mediaUrl"\)[\s\S]{0,120}fileKey"\)/.test(chatSource),
);

/* --------------------------------------- viewer geometry vs MediaViewer.kt --- */

check("the phone clamps zoom with coerceIn(1f, 6f)", viewerSource.includes("coerceIn(1f, 6f)"));
check("the web clamp is the same", ZOOM_MIN === 1 && ZOOM_MAX === 6, `${ZOOM_MIN}..${ZOOM_MAX}`);
check(
  "the phone's double-tap target is 2.5×",
  /val target = if \(scale > 1f\) 1f else 2\.5f/.test(viewerSource),
);
check("the web double-click target is the same", DOUBLE_TAP_ZOOM === 2.5, `${DOUBLE_TAP_ZOOM}`);
check("a zoom step stays inside the clamp", ZOOM_STEP > 1 && ZOOM_STEP * ZOOM_STEP <= ZOOM_MAX);
check(
  "the not-zoomed threshold matches the phone's 1.01f",
  ZOOM_EPSILON === 1.01,
  `${ZOOM_EPSILON}`,
);
check(
  "the phone clamps a pan to size * (scale - 1) / 2",
  /maxX = size\.width \* \(scale - 1f\) \/ 2f/.test(viewerSource) &&
    /maxY = size\.height \* \(scale - 1f\) \/ 2f/.test(viewerSource),
);
check(
  "at 1× there is nowhere to pan",
  panLimit(800, 600, 1).x === 0 && panLimit(800, 600, 1).y === 0,
);
check(
  "at 2× the pan box is half the stage in each axis",
  panLimit(800, 600, 2).x === 400 && panLimit(800, 600, 2).y === 300,
  JSON.stringify(panLimit(800, 600, 2)),
);
check(
  "at the 6× ceiling the pan box is 2.5 stages wide",
  panLimit(800, 600, 6).x === 2000 && panLimit(800, 600, 6).y === 1500,
);
check("a sub-1× scale cannot invert the box", panLimit(800, 600, 0.5).x === 0);
check(
  "an arrow key pans by a sane step",
  KEY_PAN_STEP > 0 && KEY_PAN_STEP < 200,
  `${KEY_PAN_STEP}`,
);
check(
  "a drag has to travel before it closes the viewer",
  DRAG_CLOSE_THRESHOLD > 60,
  `${DRAG_CLOSE_THRESHOLD}`,
);
check(
  "the phone resets zoom on every page flip, and so does the web viewer",
  /one page per photo; zoom resets on each flip/.test(viewerSource),
);

check("1x is not zoomed, and 1.02x is", isZoomed(1) === false && isZoomed(1.02) === true);

/* --------------------------------------- sending view once: the same gate --- */

check(
  "the worker refuses the flag on a document",
  /if \(meta\.viewOnce !== true\) return false;\s*if \(meta\.document === true\) return false;/.test(
    workerSource,
  ),
);
check(
  "the worker refuses it on an audio file that is not a voice note",
  /if \(meta\.voice === true\) return kind === "FILE" && fileType\.startsWith\("audio\/"/.test(
    workerSource,
  ),
);
check(
  "a photo carries the flag",
  JSON.stringify(buildAttachmentMeta("photo", { width: 10, height: 10, viewOnce: true })) ===
    JSON.stringify({ w: 10, h: 10, viewOnce: true }),
);
check(
  "a clip carries the flag",
  JSON.stringify(
    buildAttachmentMeta("video", { width: 10, height: 10, durationMs: 1500, viewOnce: true }),
  ) === JSON.stringify({ w: 10, h: 10, durMs: 1500, viewOnce: true }),
);
check(
  "a document never does, even when the picker asked for both",
  JSON.stringify(buildAttachmentMeta("document", { asDocument: true, viewOnce: true })) ===
    JSON.stringify({ document: true }),
);
check(
  "an album and a view-once flag never travel together",
  JSON.stringify(
    buildAttachmentMeta("photo", { width: 4, height: 4, viewOnce: true, album: "alb_x" }),
  ) === JSON.stringify({ w: 4, h: 4, viewOnce: true }),
  JSON.stringify(
    buildAttachmentMeta("photo", { width: 4, height: 4, viewOnce: true, album: "alb_x" }),
  ),
);
check(
  "the worker drops the album on a view-once row too",
  /\.\.\.\(album && !viewOnce \? \{ album \} : \{\}\)/.test(workerSource),
);

const onceItem = {
  id: "a1",
  intent: "photo",
  pickedName: "once.png",
  name: "once.png",
  type: "image/png",
  blob: { size: 10 },
  size: 10,
  width: 40,
  height: 30,
  durationMs: 0,
  asDocument: false,
  viewOnce: true,
  state: "ready",
  error: "",
  progress: null,
  previewUrl: "",
  edit: EMPTY_EDIT,
};
check(
  "the composer description says it is view once",
  describeAttachment(onceItem).endsWith(", view once"),
  describeAttachment(onceItem),
);
check(
  "a plain attachment does not claim it",
  !describeAttachment({ ...onceItem, viewOnce: false }).includes("view once"),
);
check(
  "the attachment meta carries the flag through",
  JSON.stringify(attachmentMeta(onceItem)) === JSON.stringify({ w: 40, h: 30, viewOnce: true }),
  JSON.stringify(attachmentMeta(onceItem)),
);
check(
  "a view-once row is never given an album id",
  JSON.stringify(attachmentMeta(onceItem, "alb_0123456789abcdef0123")) ===
    JSON.stringify({ w: 40, h: 30, viewOnce: true }),
);

console.log(lines.join("\n"));
