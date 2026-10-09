/**
 * Persistent send queue and per-conversation drafts.
 *
 * The Android client keeps an outbox so a message typed on a bad connection is
 * not lost; the browser equivalent has to survive a tab reload too, so items
 * live in IndexedDB when it is usable and in memory when it is not. The pure
 * pieces (attempt limits, backoff, failure classification, state transitions)
 * are separated from storage so a Node case can drive them without a browser.
 *
 * Two rules from the parity plan are enforced here rather than in the UI:
 *   - a send is idempotent, because the Worker dedupes on `clientId`;
 *   - a *refused* send is permanent and returns its text to the composer,
 *     instead of retrying forever against a policy that will not change.
 */

import { ApiError } from "../api";
import { SendRefusedError } from "./e2ee";
import type { ReplyTarget } from "./protocol";

export const OUTBOX_DB_NAME = "kp-web-messaging";
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";
export const DRAFT_STORE = "drafts";

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BASE_DELAY_MS = 1_000;
export const OUTBOX_MAX_DELAY_MS = 30_000;
export const DRAFT_MAX_LENGTH = 4_000;

export type OutboxState = "queued" | "sending" | "failed" | "sent" | "refused";

export type OutboxItem = {
  readonly clientId: string;
  readonly accountId: string;
  readonly conversationId: string;
  /** What the composer showed; returned to the draft on a permanent refusal. */
  readonly plaintext: string;
  /** What goes on the wire (a KP1 envelope in a personal chat). */
  readonly wireBody: string;
  readonly replyToId: string;
  readonly replyTo: ReplyTarget | null;
  readonly createdAt: string;
  readonly state: OutboxState;
  readonly attempts: number;
  readonly lastError: string;
};

export type OutboxStore = {
  list(accountId: string): Promise<readonly OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(clientId: string): Promise<void>;
  clearAccount(accountId: string): Promise<void>;
};

export type SendOutcome =
  { kind: "sent" } | { kind: "refused"; message: string } | { kind: "retryable"; message: string };

/* --------------------------------------------------------------- pure rules */

/** Exponential backoff with a ceiling; attempt 1 waits the base delay. */
export function retryDelayMs(attempts: number): number {
  const safe = Math.max(0, Math.trunc(attempts));
  return Math.min(OUTBOX_MAX_DELAY_MS, OUTBOX_BASE_DELAY_MS * 2 ** Math.min(safe, 5));
}

export function isSendRefusal(error: unknown): boolean {
  return error instanceof SendRefusedError;
}

/**
 * Classify a transport failure. Only network faults and transient HTTP results
 * are worth another attempt: a 400/403/404 will fail identically forever, and
 * hammering them burns the rate-limit bucket for the whole account.
 */
export function classifySendFailure(error: unknown): SendOutcome {
  if (isSendRefusal(error)) {
    return { kind: "refused", message: (error as Error).message };
  }

  if (error instanceof ApiError) {
    if (error.kind === "network" || error.kind === "aborted") {
      return { kind: "retryable", message: "Could not connect." };
    }
    if (error.kind === "invalid-request" || error.kind === "invalid-response") {
      return { kind: "refused", message: "The message could not be sent." };
    }
    const status = error.status ?? 0;
    const transient = status === 408 || status === 425 || status === 429 || status >= 500;
    return transient
      ? { kind: "retryable", message: "The service is busy." }
      : { kind: "refused", message: error.code || "The message was rejected." };
  }

  return { kind: "retryable", message: "The message could not be sent." };
}

export function createOutboxItem(input: {
  clientId: string;
  accountId: string;
  conversationId: string;
  plaintext: string;
  wireBody: string;
  replyToId?: string;
  replyTo?: ReplyTarget | null;
  createdAt?: string;
}): OutboxItem {
  return {
    clientId: input.clientId,
    accountId: input.accountId,
    conversationId: input.conversationId,
    plaintext: input.plaintext.slice(0, DRAFT_MAX_LENGTH),
    wireBody: input.wireBody,
    replyToId: input.replyToId ?? "",
    replyTo: input.replyTo ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    state: "queued",
    attempts: 0,
    lastError: "",
  };
}

/** Pure state transition for one delivery attempt. */
export function applySendOutcome(
  item: OutboxItem,
  outcome: SendOutcome,
): { item: OutboxItem; keep: boolean } {
  if (outcome.kind === "sent")
    return { item: { ...item, state: "sent", lastError: "" }, keep: false };

  if (outcome.kind === "refused") {
    return {
      item: { ...item, state: "refused", lastError: outcome.message },
      keep: false,
    };
  }

  const attempts = item.attempts + 1;
  if (attempts >= OUTBOX_MAX_ATTEMPTS) {
    return {
      item: { ...item, state: "failed", attempts, lastError: outcome.message },
      // A failed item stays listed so the composer can offer retry or discard;
      // it is dropped only by an explicit user action.
      keep: true,
    };
  }

  return {
    item: { ...item, state: "queued", attempts, lastError: outcome.message },
    keep: true,
  };
}

export function isActionable(item: OutboxItem): boolean {
  return item.state === "failed" || item.state === "refused";
}

export function pendingCount(items: readonly OutboxItem[]): number {
  return items.filter((item) => item.state === "queued" || item.state === "sending").length;
}

/* ------------------------------------------------------------------- stores */

export function createMemoryOutboxStore(): OutboxStore & {
  snapshot(): readonly OutboxItem[];
} {
  const rows = new Map<string, OutboxItem>();
  return {
    async list(accountId) {
      return [...rows.values()]
        .filter((item) => item.accountId === accountId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async put(item) {
      rows.set(item.clientId, item);
    },
    async remove(clientId) {
      rows.delete(clientId);
    },
    async clearAccount(accountId) {
      for (const [key, item] of rows) if (item.accountId === accountId) rows.delete(key);
    },
    snapshot() {
      return [...rows.values()];
    },
  };
}

type DraftStore = {
  read(conversationId: string): Promise<string>;
  write(conversationId: string, text: string): Promise<void>;
  clear(conversationId: string): Promise<void>;
  list(): Promise<Readonly<Record<string, string>>>;
};

export function createMemoryDraftStore(): DraftStore {
  const rows = new Map<string, string>();
  return {
    async read(conversationId) {
      return rows.get(conversationId) ?? "";
    },
    async write(conversationId, text) {
      const trimmed = text.slice(0, DRAFT_MAX_LENGTH);
      if (trimmed) rows.set(conversationId, trimmed);
      else rows.delete(conversationId);
    },
    async clear(conversationId) {
      rows.delete(conversationId);
    },
    async list() {
      return Object.fromEntries(rows);
    },
  };
}

/** IndexedDB availability is probed, never assumed (private mode can throw). */
export function isIndexedDbUsable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Slice I (account-isolation hardening): drop the whole messaging database —
 * outbox AND drafts. Called on sign-out / account switch so one account's
 * unsent bytes can never be re-sent, read or surfaced under a different
 * login on the same browser. The phone enforces the same wall; the Web used
 * to keep the database forever. Best-effort: a blocked delete (another open
 * handle) must not stop the sign-out itself.
 */
export function deleteMessagingDatabase(): Promise<void> {
  if (!isIndexedDbUsable()) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(OUTBOX_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function runTransaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([OUTBOX_STORE, DRAFT_STORE], mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    work(tx);
  });
}

/**
 * Durable stores backed by IndexedDB. Every method degrades to a no-op or the
 * in-memory fallback instead of throwing: losing a draft must not break send.
 */
export function createPersistentStores(fallbackMemory = true): {
  outbox: OutboxStore;
  drafts: DraftStore;
  durable: boolean;
} {
  const memoryOutbox = createMemoryOutboxStore();
  const memoryDrafts = createMemoryDraftStore();

  if (!isIndexedDbUsable()) {
    return { outbox: memoryOutbox, drafts: memoryDrafts, durable: false };
  }

  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (!databasePromise) {
      databasePromise = openDatabase().catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };

  const outbox: OutboxStore = {
    async list(accountId) {
      try {
        const db = await database();
        const rows = await runRequest(
          db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll(),
        );
        return (rows as OutboxItem[])
          .filter((item) => item && item.accountId === accountId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      } catch {
        return fallbackMemory ? memoryOutbox.list(accountId) : [];
      }
    },
    async put(item) {
      try {
        const db = await database();
        await runTransaction(db, "readwrite", (tx) => {
          tx.objectStore(OUTBOX_STORE).put(item);
        });
      } catch {
        if (fallbackMemory) await memoryOutbox.put(item);
      }
    },
    async remove(clientId) {
      try {
        const db = await database();
        await runTransaction(db, "readwrite", (tx) => {
          tx.objectStore(OUTBOX_STORE).delete(clientId);
        });
      } catch {
        if (fallbackMemory) await memoryOutbox.remove(clientId);
      }
    },
    async clearAccount(accountId) {
      try {
        const db = await database();
        const rows = (await runRequest(
          db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAll(),
        )) as OutboxItem[];
        await runTransaction(db, "readwrite", (tx) => {
          const store = tx.objectStore(OUTBOX_STORE);
          for (const row of rows) if (row?.accountId === accountId) store.delete(row.clientId);
        });
      } catch {
        if (fallbackMemory) await memoryOutbox.clearAccount(accountId);
      }
    },
  };

  // Drafts are account-scoped so switching accounts cannot leak text.
  const draftKey = (conversationId: string) => `draft:${conversationId}`;

  const drafts: DraftStore = {
    async read(conversationId) {
      try {
        const db = await database();
        const value = await runRequest(
          db
            .transaction(DRAFT_STORE, "readonly")
            .objectStore(DRAFT_STORE)
            .get(draftKey(conversationId)),
        );
        return typeof value === "string" ? value : "";
      } catch {
        return fallbackMemory ? memoryDrafts.read(conversationId) : "";
      }
    },
    async write(conversationId, text) {
      const trimmed = text.slice(0, DRAFT_MAX_LENGTH);
      try {
        const db = await database();
        await runTransaction(db, "readwrite", (tx) => {
          const store = tx.objectStore(DRAFT_STORE);
          if (trimmed) store.put(trimmed, draftKey(conversationId));
          else store.delete(draftKey(conversationId));
        });
      } catch {
        if (fallbackMemory) await memoryDrafts.write(conversationId, trimmed);
      }
    },
    async clear(conversationId) {
      try {
        const db = await database();
        await runTransaction(db, "readwrite", (tx) => {
          tx.objectStore(DRAFT_STORE).delete(draftKey(conversationId));
        });
      } catch {
        if (fallbackMemory) await memoryDrafts.clear(conversationId);
      }
    },
    async list() {
      return {};
    },
  };

  return { outbox, drafts, durable: true };
}
