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
import { fetchFileBlob } from "./filesApi";

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
      const { blob, type } = await fetchFileBlob(api, key, signal);
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

/** Test/utility hook: forget every cached URL, e.g. on sign-out. */
export function clearMediaUrlCache(): void {
  for (const entry of cache.values()) {
    if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(entry.url);
  }
  cache.clear();
  inFlight.clear();
}
