/**
 * The status REST surface.
 *
 * Six routes, all of them already in the Worker (`src/worker/index.ts`, the
 * "statuses (24h stories)" block) — nothing here invents an endpoint:
 *
 *   GET    /api/statuses                the feed: my group, then contacts'
 *   POST   /api/statuses                {kind, text|imageData|fileKey, bgStyle, seconds}
 *   GET    /api/statuses/:id/media      the bytes, member-checked like a file
 *   POST   /api/statuses/:id/view       one view row, silently ignored when not allowed
 *   POST   /api/statuses/:id/react      one emoji onto the viewer's own view row
 *   GET    /api/statuses/:id/viewers    owner only
 *   DELETE /api/statuses/:id            owner only
 *
 * A reply to a status is an ordinary 1:1 message with `meta.status`, so it goes
 * through the messaging API (`createConversation` + `sendMessage`) and not
 * through anything here.
 */

import type { ApiClient } from "../auth/authApi";
import {
  parseStatusFeed,
  parseStatusViewers,
  type StatusFeed,
  type StatusViewerRow,
} from "./statusModel";

import { fetchStatusMediaBlob, statusPath } from "./statusMedia";

async function postJson(api: ApiClient, path: string, body: Record<string, unknown>) {
  return api.request<unknown>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type CreatedStatus = {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export const statusApi = {
  /**
   * The feed. `hiddenAuthorIds` is applied while parsing, so a hidden author
   * never reaches a component (and never reaches a count).
   */
  async list(
    api: ApiClient,
    hiddenAuthorIds: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<StatusFeed> {
    const payload = await api.request<unknown>("/api/statuses", { ...(signal ? { signal } : {}) });
    return parseStatusFeed(payload, hiddenAuthorIds);
  },

  async create(api: ApiClient, body: Record<string, unknown>): Promise<CreatedStatus | null> {
    const payload = (await postJson(api, "/api/statuses", body)) as Record<string, unknown> | null;
    const status = (payload?.status ?? null) as Record<string, unknown> | null;
    if (!status || typeof status.id !== "string") return null;
    return {
      id: status.id,
      kind: typeof status.kind === "string" ? status.kind : "TEXT",
      createdAt: typeof status.createdAt === "string" ? status.createdAt : "",
      expiresAt: typeof status.expiresAt === "string" ? status.expiresAt : "",
    };
  },

  /**
   * One view. The Worker answers `{ok:true}` even when it ignored the ping (a
   * blocked or non-contact caller), and the phone fires it inside
   * `runCatching` — so a failure here is never surfaced to the reader.
   */
  reportView(api: ApiClient, id: string): Promise<void> {
    return postJson(api, statusPath(id, "/view"), {}).then(
      () => undefined,
      () => undefined,
    );
  },

  /** A reaction lands on the viewer's own view row, never in anybody's inbox. */
  async react(api: ApiClient, id: string, emoji: string): Promise<boolean> {
    try {
      await postJson(api, statusPath(id, "/react"), { emoji });
      return true;
    } catch {
      return false;
    }
  },

  async viewers(
    api: ApiClient,
    id: string,
    signal?: AbortSignal,
  ): Promise<readonly StatusViewerRow[] | null> {
    try {
      const payload = await api.request<unknown>(statusPath(id, "/viewers"), {
        ...(signal ? { signal } : {}),
      });
      return parseStatusViewers(payload);
    } catch {
      // 403 (not your status) and 404 (already gone) both mean "no list".
      return null;
    }
  },

  async remove(api: ApiClient, id: string): Promise<boolean> {
    try {
      await api.request<unknown>(statusPath(id), { method: "DELETE" });
      return true;
    } catch {
      return false;
    }
  },
};

export { fetchStatusMediaBlob };
