/**
 * Thin, typed access to the messaging routes the Android app and the
 * production PWA already use. No new endpoint is invented here: every path was
 * read out of `src/worker/index.ts`.
 *
 *   GET    /api/conversations
 *   GET    /api/conversations/:id
 *   GET    /api/conversations/:id/messages?before=&beforeRowid=&marker=
 *   POST   /api/conversations/:id/messages
 *   POST   /api/conversations/:id/read
 *   POST   /api/conversations/:id/typing
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

export type MessagesQuery = {
  before?: string;
  beforeRowid?: number;
  marker?: string;
};

export type SendMessagePayload = {
  kind: "TEXT";
  body: string;
  clientId: string;
  replyTo?: string;
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
    if (payload.replyTo) body.replyTo = payload.replyTo;

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

  async publishPublicKey(api: ApiClient, e2eePublicKey: string): Promise<void> {
    await api.request<unknown>("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ e2eePublicKey }),
    });
  },
};
