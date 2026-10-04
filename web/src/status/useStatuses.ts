/**
 * The status controller: the feed, posting, deleting, reacting, the viewers
 * lists, and the reply.
 *
 * The rules it copies from the phone (StatusScreens.kt + ScreenStore.kt):
 *
 * - The feed re-reads itself every 12 s **while the tab is visible**, and on a
 *   poke from elsewhere in the app. A status posted while the tab is open used
 *   to appear only after leaving and coming back (owner round 33, item 2).
 * - The viewers list is cached per status id for the life of the page: a
 *   re-open paints the last list at once and refreshes it behind, and only a
 *   first-ever load spins (owner round 33, item 25).
 * - Deleting leaves the viewer IMMEDIATELY and prunes local state, with the
 *   network call behind it — waiting for the API let a second click double-fire
 *   and index into a shrunken list.
 * - A reply is optimistic: the box clears the moment Send is pressed, the
 *   network fires behind, and only a failure speaks up.
 * - Hidden authors are this browser's own list, persisted, and applied while
 *   parsing so they never reach a count.
 *
 * What is deliberately NOT here: a socket. The Worker broadcasts no status
 * frame, so freshness is the poll — the same thing the phone does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { apiErrorMessage } from "../api";
import { messagingApi } from "../messaging/messagingApi";
import { newClientId } from "../messaging/protocol";
import { protectOutgoingBody, SECURE_CHAT_WAITING } from "../messaging/e2ee";
import type { E2eeIdentity } from "../messaging/e2ee";
import { uploadFile } from "../messaging/filesApi";
import { statusApi } from "./statusApi";
import {
  STATUS_CACHE_STALE_MS,
  STATUS_COPY,
  STATUS_FEED_POLL_MS,
  STATUS_HIDDEN_KEY,
  parseHiddenAuthors,
  serializeHiddenAuthors,
  statusDraftVerdict,
  statusPostBody,
  withHiddenAuthor,
  type StatusDraft,
  type StatusFeed,
  type StatusItem,
  type StatusViewerRow,
} from "./statusModel";

export type StatusesState = "loading" | "ready" | "error";

export type ViewersState = {
  readonly rows: readonly StatusViewerRow[];
  readonly loading: boolean;
  readonly error: boolean;
};

export type PostResult = { readonly ok: boolean; readonly reason: string };

export type StatusesController = {
  readonly feed: StatusFeed;
  readonly state: StatusesState;
  readonly error: string;
  readonly posting: boolean;
  readonly notice: string;
  readonly hiddenAuthorIds: readonly string[];
  refresh: (force?: boolean) => Promise<void>;
  post: (draft: StatusDraft) => Promise<PostResult>;
  remove: (statusId: string) => Promise<void>;
  hideAuthor: (authorId: string) => void;
  markViewed: (statusId: string) => void;
  react: (statusId: string, emoji: string) => Promise<boolean>;
  viewersFor: (statusId: string) => ViewersState;
  loadViewers: (statusId: string) => Promise<void>;
  reply: (authorId: string, statusId: string, text: string) => Promise<PostResult>;
  /** The 1:1 chat id with an author, opening it if it does not exist yet. */
  openChatWith: (authorId: string) => Promise<string>;
  announce: (notice: string) => void;
};

type UseStatusesOptions = {
  readonly api: ApiClient | null;
  readonly identity: E2eeIdentity | null;
  /** Bumped by the app when something elsewhere changed (a socket poke). */
  readonly poke?: number;
};

const EMPTY_FEED: StatusFeed = { mine: null, others: [] };
const EMPTY_VIEWERS: ViewersState = { rows: [], loading: false, error: false };

function readHidden(): readonly string[] {
  try {
    return parseHiddenAuthors(globalThis.localStorage?.getItem(STATUS_HIDDEN_KEY) ?? null);
  } catch {
    return [];
  }
}

export function useStatuses(options: UseStatusesOptions): StatusesController {
  const { api, identity, poke = 0 } = options;
  const [feed, setFeed] = useState<StatusFeed>(EMPTY_FEED);
  const [state, setState] = useState<StatusesState>("loading");
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const [hiddenAuthorIds, setHiddenAuthorIds] = useState<readonly string[]>(readHidden);
  const [viewers, setViewers] = useState<ReadonlyMap<string, ViewersState>>(new Map());

  // One view report per status id for the life of the page: the phone fires the
  // ping from an effect keyed on the index, which re-fires when a sheet opens
  // unless the id is remembered. So is the refresh clock's generation counter.
  const reportedRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);
  const fetchedAtRef = useRef(0);
  const hiddenRef = useRef(hiddenAuthorIds);
  hiddenRef.current = hiddenAuthorIds;
  const convIdRef = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(
    async (force = false) => {
      if (!api) return;
      if (
        !force &&
        fetchedAtRef.current &&
        Date.now() - fetchedAtRef.current < STATUS_CACHE_STALE_MS
      ) {
        return;
      }
      const generation = ++generationRef.current;
      try {
        const next = await statusApi.list(api, hiddenRef.current);
        if (generation !== generationRef.current) return;
        setFeed(next);
        fetchedAtRef.current = Date.now();
        setState("ready");
        setError("");
      } catch (cause) {
        if (generation !== generationRef.current) return;
        setState("error");
        setError(apiErrorMessage(cause));
      }
    },
    [api],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh, poke]);

  /* The 12 s tick, only while the tab is the one being looked at. */
  useEffect(() => {
    if (!api) return;
    const tick = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refresh(true);
    }, STATUS_FEED_POLL_MS);
    return () => window.clearInterval(tick);
  }, [api, refresh]);

  const announce = useCallback((text: string) => setNotice(text), []);

  const hideAuthor = useCallback((authorId: string) => {
    if (!authorId) return;
    setHiddenAuthorIds((current) => {
      const next = withHiddenAuthor(current, authorId);
      try {
        globalThis.localStorage?.setItem(STATUS_HIDDEN_KEY, serializeHiddenAuthors(next));
      } catch {
        // A browser with no writable storage still hides for this session.
      }
      return next;
    });
    setFeed((current) => ({
      ...current,
      others: current.others.filter((group) => group.author.id !== authorId),
    }));
  }, []);

  const markViewed = useCallback(
    (statusId: string) => {
      if (!api || !statusId || reportedRef.current.has(statusId)) return;
      reportedRef.current.add(statusId);
      // The feed's own group never reports: `if (!isMine)` on the phone.
      void statusApi.reportView(api, statusId);
    },
    [api],
  );

  const react = useCallback(
    async (statusId: string, emoji: string) => {
      if (!api || !statusId) return false;
      const ok = await statusApi.react(api, statusId, emoji);
      if (ok) reportedRef.current.add(statusId);
      return ok;
    },
    [api],
  );

  const viewersFor = useCallback(
    (statusId: string) => viewers.get(statusId) ?? EMPTY_VIEWERS,
    [viewers],
  );

  const loadViewers = useCallback(
    async (statusId: string) => {
      if (!api || !statusId) return;
      const cached = viewers.get(statusId);
      setViewers((current) => {
        const next = new Map(current);
        next.set(statusId, {
          rows: cached?.rows ?? [],
          loading: !cached,
          error: cached?.error ?? false,
        });
        return next;
      });
      const rows = await statusApi.viewers(api, statusId);
      setViewers((current) => {
        const next = new Map(current);
        next.set(statusId, {
          rows: rows ?? cached?.rows ?? [],
          loading: false,
          // Only a first-ever failure shows the error line.
          error: rows === null && !cached,
        });
        return next;
      });
    },
    [api, viewers],
  );

  const post = useCallback(
    async (draft: StatusDraft): Promise<PostResult> => {
      if (!api) return { ok: false, reason: STATUS_COPY.postFailed };
      const verdict = statusDraftVerdict(draft);
      if (!verdict.allowed) return { ok: false, reason: verdict.reason };
      setPosting(true);
      try {
        const created = await statusApi.create(api, statusPostBody(draft));
        if (!created) return { ok: false, reason: STATUS_COPY.postFailed };
        await refresh(true);
        return { ok: true, reason: "" };
      } catch (cause) {
        return { ok: false, reason: apiErrorMessage(cause) || STATUS_COPY.postFailed };
      } finally {
        setPosting(false);
      }
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (statusId: string) => {
      if (!api || !statusId) return;
      // Prune first, ask the server behind: the row must not linger while the
      // request runs, and a second click must find nothing to delete.
      setFeed((current) => pruneStatus(current, statusId));
      const ok = await statusApi.remove(api, statusId);
      if (!ok) setNotice(STATUS_COPY.postFailed);
      await refresh(true);
    },
    [api, refresh],
  );

  const openChatWith = useCallback(
    async (authorId: string): Promise<string> => {
      if (!api || !authorId) return "";
      const cached = convIdRef.current.get(authorId);
      if (cached) return cached;
      try {
        const conversation = await messagingApi.createConversation(api, authorId);
        const id = conversation?.id ?? "";
        if (id) convIdRef.current.set(authorId, id);
        return id;
      } catch {
        return "";
      }
    },
    [api],
  );

  const reply = useCallback(
    async (authorId: string, statusId: string, text: string): Promise<PostResult> => {
      const body = text.trim();
      if (!api || !body) return { ok: false, reason: "" };
      const conversationId = await openChatWith(authorId);
      if (!conversationId) return { ok: false, reason: STATUS_COPY.replyFailed };
      try {
        const conversation = await messagingApi.getConversation(api, conversationId);
        const peerKey = conversation?.other?.e2eePublicKey ?? "";
        // A reply is a personal message: it is sealed to the author's key, or
        // refused. Posting it plaintext would leave it readable on the server.
        const sealed = await protectOutgoingBody(
          body,
          { isGroup: conversation?.isGroup ?? false, otherId: authorId },
          peerKey,
          identity,
        );
        await messagingApi.sendMessage(api, conversationId, {
          kind: "TEXT",
          body: sealed,
          clientId: newClientId(),
          meta: statusId ? { status: { id: statusId } } : undefined,
        });
        return { ok: true, reason: "" };
      } catch (cause) {
        return {
          ok: false,
          reason: (cause as Error)?.message || apiErrorMessage(cause) || STATUS_COPY.replyFailed,
        };
      }
    },
    [api, identity, openChatWith],
  );

  return useMemo(
    () => ({
      feed,
      state,
      error,
      posting,
      notice,
      hiddenAuthorIds,
      refresh,
      post,
      remove,
      hideAuthor,
      markViewed,
      react,
      viewersFor,
      loadViewers,
      reply,
      openChatWith,
      announce,
    }),
    [
      feed,
      state,
      error,
      posting,
      notice,
      hiddenAuthorIds,
      refresh,
      post,
      remove,
      hideAuthor,
      markViewed,
      react,
      viewersFor,
      loadViewers,
      reply,
      openChatWith,
      announce,
    ],
  );
}

/** Drop one status everywhere it appears, and any group it empties. */
export function pruneStatus(feed: StatusFeed, statusId: string): StatusFeed {
  const cut = (statuses: readonly StatusItem[]) => statuses.filter((row) => row.id !== statusId);
  const mine = feed.mine
    ? cut(feed.mine.statuses).length > 0
      ? { ...feed.mine, statuses: cut(feed.mine.statuses) }
      : null
    : null;
  const others = feed.others
    .map((group) => ({ ...group, statuses: cut(group.statuses) }))
    .filter((group) => group.statuses.length > 0);
  return { mine, others };
}

/* ------------------------------------------------------- media preparation */

/**
 * A photo status, prepared the way the Worker accepts it.
 *
 * The phone bakes its edit and posts the JPEG inline. A browser can do the
 * same, but only while the data URL stays inside the Worker's 450 000-character
 * cap — so the picture is shrunk down a fixed ladder, and a photo that still
 * does not fit is uploaded and posted by `fileKey`, which the same handler
 * accepts (`imageData ?? fileKey`). Nothing here is a second upload path: it is
 * the messaging one.
 */
export type PreparedPhoto =
  | { readonly kind: "inline"; readonly imageData: string }
  | { readonly kind: "uploaded"; readonly fileKey: string }
  | { readonly kind: "refused"; readonly reason: string };

export async function prepareStatusPhoto(
  api: ApiClient,
  blob: Blob,
  steps: readonly { longEdge: number; quality: number }[],
): Promise<PreparedPhoto> {
  for (const step of steps) {
    const encoded = await encodePhoto(blob, step.longEdge, step.quality);
    if (!encoded) continue;
    if (encoded.length <= 450_000) return { kind: "inline", imageData: encoded };
  }
  // Too big for an inline post even at the last step: upload it instead.
  try {
    const shrunk = await encodeBlob(
      blob,
      steps.at(-1)?.longEdge ?? 1280,
      steps.at(-1)?.quality ?? 0.6,
    );
    const uploaded = await uploadFile(api, {
      name: `status_${Date.now()}.jpg`,
      type: "image/jpeg",
      blob: shrunk ?? blob,
    });
    return { kind: "uploaded", fileKey: uploaded.fileKey };
  } catch (cause) {
    return { kind: "refused", reason: apiErrorMessage(cause) || STATUS_COPY.photoTooLarge };
  }
}

async function encodePhoto(blob: Blob, longEdge: number, quality: number): Promise<string> {
  const encoded = await encodeBlob(blob, longEdge, quality);
  if (!encoded) return "";
  const reader = new FileReader();
  return new Promise<string>((resolve) => {
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(encoded);
  });
}

/** Decode → fit inside `longEdge` → JPEG. Returns null when the bytes are not a picture. */
async function encodeBlob(blob: Blob, longEdge: number, quality: number): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((out) => resolve(out), "image/jpeg", quality);
  });
}

/**
 * A video status's length, read the way a browser can: from the element's own
 * metadata. No trim, no re-encode — the notice says so, and the Worker clamps
 * the seconds it stores to 120.
 */
export async function readVideoSeconds(blob: Blob): Promise<number> {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return 0;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const video = document.createElement("video");
      const finish = (seconds: number) => {
        video.removeAttribute("src");
        video.load();
        resolve(Number.isFinite(seconds) ? seconds : 0);
      };
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => finish(video.duration);
      video.onerror = () => finish(0);
      video.src = url;
      // A clip whose metadata never arrives must not hang the composer.
      window.setTimeout(() => finish(video.duration), 8_000);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** What the composer says while it is working, per kind. */
export function preparingLabel(kind: "IMAGE" | "VIDEO"): string {
  return kind === "IMAGE" ? STATUS_COPY.photoPreparing : STATUS_COPY.videoPreparing;
}

export { SECURE_CHAT_WAITING };
