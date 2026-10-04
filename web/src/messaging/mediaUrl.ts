/**
 * Bearer-gated media URLs for the transcript.
 *
 * An attachment's bytes live in R2 behind `GET /api/files/:key`, which the
 * Worker authorizes per conversation member — so a media row cannot be an
 * `<img src>` pointing at the API: the browser would not send the Authorization
 * header. The bytes are fetched with the session client, held as an object URL,
 * and shared between rows that reference the same key (a forwarded photo reuses
 * one key). The cache is bounded and revokes what it evicts.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { fetchStatusMediaBlob } from "../status/statusMedia";
import { fetchFileBlob, fetchMessageMediaBlob } from "./filesApi";

/**
 * A media source that is a message route rather than a file key. Kept as a
 * prefix on the same string the hook already takes, so the cache stays one map.
 */
export const MESSAGE_MEDIA_PREFIX = "msg:";

/**
 * A status's bytes come from `/api/statuses/:id/media`, which is authorized per
 * viewer exactly like a message's — so it joins the same cache under its own
 * prefix instead of growing a second one.
 */
export const STATUS_MEDIA_PREFIX = "status:";

export type MediaSourceRow = {
  readonly id: string;
  readonly localPreview: string;
  readonly fileKey: string;
  readonly mediaUrl: string;
};

/**
 * Which bytes a row shows, in the order the phone resolves them
 * (`photoUrlOf`: local echo → `mediaUrl` → `fileKey` as an `/api/files` path).
 *
 * An uploaded photo or clip is a FILE row and carries only a `fileKey`; the
 * legacy inline IMAGE rows carry `mediaUrl = /api/messages/:id/media` instead.
 * Both are answered here, and `msg:` tells the hook which route to spend a
 * request on.
 */
export function mediaSourceKey(message: MediaSourceRow): string {
  if (message.localPreview) return message.localPreview;
  if (message.fileKey) return message.fileKey;
  if (message.mediaUrl.startsWith("/api/messages/") && message.mediaUrl.endsWith("/media")) {
    return message.id ? `${MESSAGE_MEDIA_PREFIX}${message.id}` : "";
  }
  return "";
}

const MAX_CACHED_URLS = 60;

type CacheEntry = { url: string; type: string; refs: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();

function remember(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
  // Insertion-ordered eviction: the oldest entry goes first.
  while (cache.size > MAX_CACHED_URLS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (evicted && typeof URL?.revokeObjectURL === "function") {
      URL.revokeObjectURL(evicted.url);
    }
  }
}

export type MediaUrlState = {
  url: string | null;
  type: string;
  status: "idle" | "loading" | "ready" | "error";
};

async function load(api: ApiClient, key: string, signal: AbortSignal): Promise<CacheEntry | null> {
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = (async () => {
    try {
      const { blob, type } = key.startsWith(MESSAGE_MEDIA_PREFIX)
        ? await fetchMessageMediaBlob(api, key.slice(MESSAGE_MEDIA_PREFIX.length), signal)
        : key.startsWith(STATUS_MEDIA_PREFIX)
          ? await fetchStatusMediaBlob(api, key.slice(STATUS_MEDIA_PREFIX.length), signal)
          : await fetchFileBlob(api, key, signal);
      if (typeof URL?.createObjectURL !== "function") return null;
      const entry: CacheEntry = { url: URL.createObjectURL(blob), type, refs: 0 };
      remember(key, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, started);
  return started;
}

/**
 * Resolve a file key to a displayable object URL. Returns `idle` when there is
 * nothing to fetch, so a text row never starts a request.
 */
export function useMediaUrl(
  api: ApiClient | null,
  enabled: boolean,
  fileKey: string,
): MediaUrlState {
  const [state, setState] = useState<MediaUrlState>({
    url: null,
    type: "",
    status: fileKey ? "loading" : "idle",
  });

  useEffect(() => {
    if (!enabled || !api || !fileKey) {
      setState({ url: null, type: "", status: "idle" });
      return;
    }

    // A local object URL (an upload this browser is still sending) is already
    // displayable: fetching it back through the API would be a pointless round
    // trip, and the key is not a file key at all.
    if (fileKey.startsWith("blob:")) {
      setState({ url: fileKey, type: "", status: "ready" });
      return;
    }

    const controller = new AbortController();
    let live = true;
    setState({ url: null, type: "", status: "loading" });

    void load(api, fileKey, controller.signal).then((entry) => {
      if (!live) return;
      if (entry) setState({ url: entry.url, type: entry.type, status: "ready" });
      else setState({ url: null, type: "", status: "error" });
    });

    return () => {
      live = false;
      controller.abort();
    };
  }, [api, enabled, fileKey]);

  return state;
}

export type MediaUrlMap = Readonly<Record<string, MediaUrlState>>;

const IDLE_URL: MediaUrlState = { url: null, type: "", status: "idle" };

/**
 * Resolve a whole list of rows at once — what the viewer and the shared-media
 * grid need, since a component cannot call a hook per array item.
 *
 * Callers must only pass rows the reader has actually asked to see: a
 * `msg:`-source row is fetched from `/api/messages/:id/media`, and for a
 * view-once row that fetch **is** the opening. Album groups are safe because a
 * view-once photo never joins an album; a single once-row is the reader's own
 * explicit tap.
 *
 * Resolution is sequential on purpose: one request at a time through the shared
 * cache, so opening a twenty-photo album does not fire twenty parallel
 * downloads at the Worker.
 */
export function useMediaUrls(api: ApiClient | null, rows: readonly MediaSourceRow[]): MediaUrlMap {
  const [state, setState] = useState<MediaUrlMap>({});
  // Keyed on the resolved source keys, not the row identities: a list refresh
  // hands back new objects for the same media, and depending on them would
  // restart every fetch (and re-spend an opening) on each poll.
  const signature = rows.map((row) => `${row.id}:${mediaSourceKey(row)}`).join("|");

  useEffect(() => {
    if (!api || rows.length === 0) {
      setState({});
      return;
    }
    const controller = new AbortController();
    let live = true;

    const initial: Record<string, MediaUrlState> = {};
    for (const row of rows) {
      const key = mediaSourceKey(row);
      if (!key) initial[row.id] = IDLE_URL;
      else if (key.startsWith("blob:") || key.startsWith("data:")) {
        initial[row.id] = { url: key, type: "", status: "ready" };
      } else initial[row.id] = { url: null, type: "", status: "loading" };
    }
    setState(initial);

    void (async () => {
      for (const row of rows) {
        const key = mediaSourceKey(row);
        if (!key || key.startsWith("blob:") || key.startsWith("data:")) continue;
        const entry = await load(api, key, controller.signal);
        if (!live) return;
        setState((current) => ({
          ...current,
          [row.id]: entry
            ? { url: entry.url, type: entry.type, status: "ready" }
            : { url: null, type: "", status: "error" },
        }));
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
    // `signature` stands in for `rows`: same ids and same sources, no restart.
  }, [api, signature]);

  return state;
}

/** Test/utility hook: forget every cached URL, e.g. on sign-out. */
export function clearMediaUrlCache(): void {
  for (const entry of cache.values()) {
    if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(entry.url);
  }
  cache.clear();
  inFlight.clear();
}
