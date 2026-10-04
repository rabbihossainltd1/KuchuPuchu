/**
 * A status's bytes, on their own.
 *
 * `/api/statuses/:id/media` is authorized per viewer exactly like
 * `/api/files/:key`, so an `<img src>` can never carry the session header: the
 * bytes are fetched with the session client and handed back as a blob. This
 * file is the only piece of the status feature the messaging chunk imports
 * (`mediaUrl.ts` caches it under a `status:` key), so it carries no model and
 * no copy — just the path guard and the fetch.
 */

import type { ApiClient } from "../auth/authApi";

/**
 * The Worker mints status ids with `crypto.randomUUID()`, so a hyphen is part
 * of the shape. Anything else is refused here rather than handed to a URL: the
 * client's own path guard rejects encoded slashes, and an id that needed
 * encoding was never an id.
 */
const STATUS_ID_RE = /^[0-9a-fA-F-]{1,64}$/;

export function statusPath(id: string, suffix = ""): string {
  if (!STATUS_ID_RE.test(id)) throw new Error("That status cannot be addressed.");
  return `/api/statuses/${id}${suffix}`;
}

export async function fetchStatusMediaBlob(
  api: ApiClient,
  id: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; type: string }> {
  const response = await api.requestRaw(statusPath(id, "/media"), {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  const blob = await response.blob();
  return { blob, type: response.headers.get("content-type") || "application/octet-stream" };
}
