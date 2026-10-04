/**
 * Thin, typed access to the messaging routes the Android app and the
 * production PWA already use. No new endpoint is invented here: every path was
 * read out of `src/worker/index.ts`.
 *
 *   GET    /api/conversations
 *   GET    /api/conversations/:id
 *   GET    /api/conversations/:id/media     (shared media: images/videos/docs/links)
 *   GET    /api/conversations/:id/messages?before=&beforeRowid=&marker=
 *   POST   /api/conversations/:id/messages
 *   POST   /api/conversations/:id/read
 *   POST   /api/conversations/:id/typing
 *   POST   /api/messages/:id/view           (report a view-once opening)
 *   POST   /api/messages/:id/react
 *   PATCH  /api/messages/:id            (edit own TEXT within 60s)
 *   DELETE /api/messages/:id            (permanent delete)
 *   GET    /api/e2ee/backup  ·  PUT /api/e2ee/backup
 *   PATCH  /api/me
 */

import type { ApiClient } from "../auth/authApi";
import {
  parseConversationDetail,
  parseConversationList,
  parseMessageRow,
  parseMessagesPage,
  type ConversationRow,
  type MessageRow,
  type MessagesPage,
} from "./protocol";
import { parseSharedMedia, type SharedMedia } from "./sharedMedia";

export type MessagesQuery = {
  before?: string;
  beforeRowid?: number;
  marker?: string;
};

/**
 * The Worker accepts TEXT / STICKER / FILE kinds. Every attachment — photo,
 * clip, document — travels as FILE with a fileKey; STICKER carries the glyph in
 * `body` exactly like a TEXT send, which is what the phone does.
 */
export type SendMessagePayload = {
  /** The four kinds the worker accepts (`ALLOWED_MESSAGE_KINDS`). */
  kind: "TEXT" | "STICKER" | "IMAGE" | "FILE";
  /** Plaintext for groups/bots, a `KP1.` envelope in a personal chat. */
  body: string;
  clientId: string;
  /**
   * An inline `data:` image. Only used when forwarding a legacy IMAGE row that
   * never had a file key: `forwardMessageTo` re-posts the data URL rather than
   * downloading and re-uploading bytes it already holds.
   */
  imageData?: string;
  replyTo?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileKey?: string;
  meta?: Record<string, unknown>;
  viewOnce?: boolean;
};

export type SendMessageResult = {
  message: MessageRow | null;
  duplicate: boolean;
};

function conversationPath(conversationId: string, suffix = ""): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}${suffix}`;
}

function messagePath(messageId: string, suffix = ""): string {
  return `/api/messages/${encodeURIComponent(messageId)}${suffix}`;
}

function messagesQuery(query: MessagesQuery): string {
  const params = new URLSearchParams();
  if (query.before) params.set("before", query.before);
  if (query.beforeRowid) params.set("beforeRowid", String(query.beforeRowid));
  if (query.marker) params.set("marker", query.marker);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

async function postJson(api: ApiClient, path: string, body: Record<string, unknown>) {
  return api.request<unknown>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const messagingApi = {
  async listConversations(
    api: ApiClient,
    signal?: AbortSignal,
  ): Promise<readonly ConversationRow[]> {
    const payload = await api.request<unknown>("/api/conversations", { signal });
    return parseConversationList(payload);
  },

  async getConversation(
    api: ApiClient,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationRow | null> {
    const payload = await api.request<unknown>(conversationPath(conversationId), { signal });
    return parseConversationDetail(payload);
  },

  async getMessages(
    api: ApiClient,
    conversationId: string,
    query: MessagesQuery = {},
    signal?: AbortSignal,
  ): Promise<MessagesPage> {
    const payload = await api.request<unknown>(
      `${conversationPath(conversationId, "/messages")}${messagesQuery(query)}`,
      { signal },
    );
    return parseMessagesPage(payload);
  },

  /** Fire-and-forget: a failed read receipt must never surface as an error. */
  markRead(api: ApiClient, conversationId: string): Promise<void> {
    return postJson(api, conversationPath(conversationId, "/read"), {}).then(
      () => undefined,
      () => undefined,
    );
  },

  /** `kind` is "text" | "voice" | "clear"; the Worker swallows blocked pings. */
  setTyping(api: ApiClient, conversationId: string, kind: string): Promise<void> {
    return postJson(api, conversationPath(conversationId, "/typing"), { kind }).then(
      () => undefined,
      () => undefined,
    );
  },

  async sendMessage(
    api: ApiClient,
    conversationId: string,
    payload: SendMessagePayload,
  ): Promise<SendMessageResult> {
    const body: Record<string, unknown> = {
      kind: payload.kind,
      body: payload.body,
      clientId: payload.clientId,
    };
    if (payload.imageData !== undefined) body.imageData = payload.imageData;
    if (payload.replyTo) body.replyTo = payload.replyTo;
    if (payload.fileName !== undefined) body.fileName = payload.fileName;
    if (payload.fileType !== undefined) body.fileType = payload.fileType;
    if (payload.fileSize !== undefined) body.fileSize = payload.fileSize;
    if (payload.fileKey !== undefined) body.fileKey = payload.fileKey;
    if (payload.meta && Object.keys(payload.meta).length > 0) body.meta = payload.meta;
    if (payload.viewOnce) body.viewOnce = true;

    const response = await postJson(api, conversationPath(conversationId, "/messages"), body);
    const record = (response ?? {}) as Record<string, unknown>;
    return {
      message: parseMessageRow(record.message),
      duplicate: record.duplicate === true,
    };
  },

  async react(api: ApiClient, messageId: string, emoji: string): Promise<MessageRow | null> {
    // An empty emoji removes the caller's reaction (same as tapping it again).
    const response = await postJson(api, messagePath(messageId, "/react"), { emoji });
    return parseMessageRow((response as Record<string, unknown> | null)?.message);
  },

  async editMessage(api: ApiClient, messageId: string, body: string): Promise<MessageRow | null> {
    const response = await api.request<unknown>(messagePath(messageId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    return parseMessageRow((response as Record<string, unknown> | null)?.message);
  },

  async deleteMessage(api: ApiClient, messageId: string): Promise<boolean> {
    const response = await api.request<unknown>(messagePath(messageId), { method: "DELETE" });
    return (response as Record<string, unknown> | null)?.ok === true;
  },

  async getBackup(api: ApiClient, signal?: AbortSignal): Promise<string> {
    const payload = await api.request<unknown>("/api/e2ee/backup", { signal });
    const backup = (payload as Record<string, unknown> | null)?.backup;
    return typeof backup === "string" ? backup : "";
  },

  async putBackup(api: ApiClient, backup: string): Promise<void> {
    await api.request<unknown>("/api/e2ee/backup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backup }),
    });
  },

  /**
   * The shared-media gallery: one payload of four newest-first lists. There is
   * no cursor — the Worker caps it at 400 rows and has already applied the
   * delete-for-me watermark, dropped view-once rows, and refused a private
   * group (`403 PRIVATE_GROUP`) or an unaccepted request (`403 REQUEST_PENDING`).
   */
  async fetchSharedMedia(
    api: ApiClient,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<SharedMedia> {
    const payload = await api.request<unknown>(
      `/api/conversations/${encodeURIComponent(conversationId)}/media`,
      { signal },
    );
    return parseSharedMedia(payload);
  },

  /**
   * Report the single opening of a view-once message, exactly as the phone does
   * (`Api.post("/api/messages/$id/view", JSONObject())`). A 404 or 410 means the
   * row is already gone for everyone — terminal, not a blip.
   */
  async reportViewOnce(api: ApiClient, messageId: string): Promise<void> {
    await api.request<unknown>(`/api/messages/${encodeURIComponent(messageId)}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  },

  async publishPublicKey(api: ApiClient, e2eePublicKey: string): Promise<void> {
    await api.request<unknown>("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ e2eePublicKey }),
    });
  },
};
