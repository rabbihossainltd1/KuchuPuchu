/**
 * Per-ref avatar cache, the browser half of the phone's avatar pipeline.
 *
 * The Worker's list payloads ride a tiny `avatarRef` token (`id@vN` for a
 * person, `g:id@vN` for a group) instead of the data-URI itself; the bytes
 * live behind /api/users/:id/avatar and /api/conversations/:id/avatar. A ref
 * is stable for the lifetime of that picture version, so a resolved data-URI
 * is cached for the whole session and never fetched again — exactly the
 * phone's "cache forever per avatarRef" rule.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "../auth/authApi";

type AvatarPayload = { avatarUrl?: string | null; avatarRef?: string | null };

const cache = new Map<string, string>();
const missing = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();

/** Fetch (once per session per ref) and cache the avatar for `ref`. */
export async function resolveAvatar(api: ApiClient, ref: string): Promise<string | null> {
  if (!ref) return null;
  const hit = cache.get(ref);
  if (hit) return hit;
  if (missing.has(ref)) return null;

  const pending = inflight.get(ref);
  if (pending) return pending;

  const at = ref.lastIndexOf("@");
  const owner = ref.startsWith("g:") ? ref.slice(2, at) : ref.slice(0, at);
  if (!owner) {
    missing.add(ref);
    return null;
  }
  const path = ref.startsWith("g:")
    ? `/api/conversations/${encodeURIComponent(owner)}/avatar`
    : `/api/users/${encodeURIComponent(owner)}/avatar`;

  const job = (async (): Promise<string | null> => {
    try {
      const payload = await api.request<AvatarPayload>(path);
      const url = payload?.avatarUrl ?? null;
      if (url) cache.set(ref, url);
      else missing.add(ref);
      return url;
    } catch {
      // 404 = privacy-walled or no picture; transient errors just retry on
      // the next ref change / mount, the list keeps showing initials.
      missing.add(ref);
      return null;
    } finally {
      inflight.delete(ref);
    }
  })();
  inflight.set(ref, job);
  return job;
}

/**
 * React binding: the cached data-URI for `ref`, fetching it on first sight.
 * Returns null while unknown, so callers fall back to their initials tile.
 */
export function useAvatar(api: ApiClient | null, ref: string): string | null {
  const [url, setUrl] = useState<string | null>(() => (ref ? (cache.get(ref) ?? null) : null));

  useEffect(() => {
    if (!api || !ref) {
      setUrl(null);
      return;
    }
    const hit = cache.get(ref);
    if (hit !== undefined) {
      setUrl(hit);
      return;
    }
    if (missing.has(ref)) {
      setUrl(null);
      return;
    }
    let live = true;
    void resolveAvatar(api, ref).then((resolved) => {
      if (live) setUrl(resolved);
    });
    return () => {
      live = false;
    };
  }, [api, ref]);

  return url;
}

/** The avatar ref a conversation row shows: the group picture or the peer's. */
export function conversationAvatarRef(conversation: {
  readonly isGroup: boolean;
  readonly avatarRef: string;
  readonly other: { readonly avatarRef: string } | null;
}): string {
  return conversation.isGroup ? conversation.avatarRef : (conversation.other?.avatarRef ?? "");
}
