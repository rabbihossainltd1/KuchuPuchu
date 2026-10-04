/**
 * Test-side helpers for the messaging suite.
 *
 * The KP1 implementation here is deliberately written from the spec again with
 * node:crypto rather than imported from the client, so a regression in the
 * client's crypto shows up as a failed assertion instead of a test that agrees
 * with itself.
 */

import { webcrypto } from "node:crypto";
import type { Page, Route } from "@playwright/test";

const subtle = webcrypto.subtle;
const HKDF_INFO = "kp-msg-e2ee-v1";

export type TestIdentity = { p: string; u: string };

const toBase64 = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

export async function generateTestIdentity(): Promise<TestIdentity> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const pkcs8 = await subtle.exportKey("pkcs8", pair.privateKey);
  const spki = await subtle.exportKey("spki", pair.publicKey);
  return { p: toBase64(pkcs8), u: toBase64(spki) };
}

// No CryptoKey annotation: node:crypto and the DOM lib disagree on KeyUsage,
// and inference keeps this file on the node side consistently.
async function messageKey(mine: TestIdentity, theirs: TestIdentity) {
  const privateKey = await subtle.importKey(
    "pkcs8",
    fromBase64(mine.p) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const publicKey = await subtle.importKey(
    "spki",
    fromBase64(theirs.u) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256),
  );

  const prkKey = await subtle.importKey(
    "raw",
    shared as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = new Uint8Array(await subtle.sign("HMAC", prkKey, new Uint8Array(0)));
  const infoKey = await subtle.importKey(
    "raw",
    prk as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const info = new TextEncoder().encode(HKDF_INFO);
  const block = new Uint8Array(info.length + 1);
  block.set(info);
  block[info.length] = 1;
  const t1 = new Uint8Array(await subtle.sign("HMAC", infoKey, block as BufferSource));
  return subtle.importKey("raw", t1 as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Seal exactly as the phone does: "KP1." + base64(nonce || ciphertext || tag). */
export async function sealFor(
  plaintext: string,
  mine: TestIdentity,
  theirs: TestIdentity,
): Promise<string> {
  const key = await messageKey(mine, theirs);
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope = new Uint8Array(12 + ciphertext.byteLength);
  envelope.set(nonce);
  envelope.set(new Uint8Array(ciphertext), 12);
  return `KP1.${toBase64(envelope)}`;
}

/** Open an envelope the browser client produced, from the peer's point of view. */
export async function openFrom(
  envelope: string,
  mine: TestIdentity,
  theirs: TestIdentity,
): Promise<string> {
  const key = await messageKey(mine, theirs);
  const raw = fromBase64(envelope.slice(4));
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) as BufferSource },
    key,
    raw.slice(12) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

export function plaintextBackupBlob(identity: TestIdentity): string {
  return toBase64(new TextEncoder().encode(JSON.stringify({ p: identity.p, u: identity.u })));
}

/* ------------------------------------------------------------ mock worker */

export type SentMessage = {
  conversationId: string;
  body: Record<string, unknown>;
};

export type MockWorker = {
  me: TestIdentity;
  peer: TestIdentity;
  sent: SentMessage[];
  readCalls: string[];
  typingCalls: { conversationId: string; kind: string }[];
  deletedMessageIds: string[];
  reactions: { messageId: string; emoji: string }[];
  install(page: Page): Promise<void>;
};

export const ME = {
  id: "u_me",
  username: "me",
  displayName: "Amar Account",
};
export const PEER_ID = "u_peer";
export const PEER_NAME = "Rahi";
export const CHAT_ID = "c_direct";
export const GROUP_ID = "c_group";
export const HIDDEN_ID = "c_hidden";
export const BOT_ID = "c_official";

export async function createMockWorker(): Promise<MockWorker> {
  const me = await generateTestIdentity();
  const peer = await generateTestIdentity();

  const sealedFromPeer = await sealFor("এই মেসেজটি ফোন থেকে এনক্রিপ্টেড", peer, me);

  const conversations = [
    {
      id: CHAT_ID,
      isGroup: false,
      unread: 2,
      hidden: 0,
      muted: 0,
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: {
        id: "m_2",
        kind: "TEXT",
        category: "message",
        body: sealedFromPeer,
        createdAt: new Date().toISOString(),
      },
      other: { id: PEER_ID, displayName: PEER_NAME, username: "rahi", e2eePublicKey: peer.u },
    },
    {
      id: GROUP_ID,
      isGroup: true,
      title: "Squad",
      unread: 0,
      hidden: 0,
      lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
      lastMessagePreview: { kind: "TEXT", category: "message", body: "group plaintext" },
    },
    {
      id: HIDDEN_ID,
      isGroup: false,
      hidden: 1,
      unread: 7,
      lastMessageAt: new Date().toISOString(),
      other: { id: "u_hidden", displayName: "Hidden Person" },
    },
    {
      id: BOT_ID,
      isGroup: false,
      unread: 0,
      hidden: 0,
      lastMessageAt: new Date(Date.now() - 86_400_000).toISOString(),
      lastMessagePreview: { kind: "TEXT", category: "message", body: "welcome" },
      other: { id: "kp_official_bot", displayName: "KuchuPuchu" },
    },
  ];

  const messagesFor = (conversationId: string) => {
    if (conversationId === CHAT_ID) {
      return [
        {
          id: "m_3",
          senderId: PEER_ID,
          senderName: PEER_NAME,
          kind: "TEXT",
          body: sealedFromPeer,
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          rowid: 3,
        },
        {
          id: "m_2",
          senderId: ME.id,
          kind: "TEXT",
          body: ownPlaintextBody(),
          createdAt: new Date(Date.now() - 90_000).toISOString(),
          rowid: 2,
          deliveredAt: new Date(Date.now() - 80_000).toISOString(),
        },
        {
          id: "m_1",
          senderId: PEER_ID,
          senderName: PEER_NAME,
          kind: "TEXT",
          body: "আগের প্লেইন মেসেজ",
          createdAt: new Date(Date.now() - 120_000).toISOString(),
          rowid: 1,
          meta: { reactions: { [ME.id]: "\u{1F44D}" } },
        },
      ];
    }
    if (conversationId === GROUP_ID) {
      return [
        {
          id: "g_1",
          senderId: PEER_ID,
          senderName: PEER_NAME,
          kind: "TEXT",
          body: "group plaintext",
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
          rowid: 1,
        },
      ];
    }
    return [
      {
        id: "b_1",
        senderId: "kp_official_bot",
        senderName: "KuchuPuchu",
        kind: "TEXT",
        body: "welcome",
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        rowid: 1,
      },
    ];
  };

  const worker: MockWorker = {
    me,
    peer,
    sent: [],
    readCalls: [],
    typingCalls: [],
    deletedMessageIds: [],
    reactions: [],
    async install(page: Page) {
      const json = (route: Route, payload: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(payload),
        });

      await page.route("**/api/auth/refresh", (route) => json(route, { ok: true }));
      await page.route("**/api/e2ee/backup", (route) =>
        json(route, { backup: plaintextBackupBlob(me) }),
      );
      await page.route("**/api/me", (route) => {
        if (route.request().method() === "PATCH") return json(route, { ok: true });
        return json(route, {
          user: {
            ...ME,
            about: null,
            email: null,
            phone: "+8801700000000",
            googleEmail: null,
            googleLinked: false,
            e2eePublicKey: me.u,
          },
        });
      });

      await page.route("**/api/conversations", (route) => json(route, { conversations }));

      await page.route("**/api/conversations/*/messages", async (route) => {
        const url = new URL(route.request().url());
        const conversationId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON() as Record<string, unknown>;
          worker.sent.push({ conversationId, body });
          return json(
            route,
            {
              message: {
                id: `srv_${worker.sent.length}`,
                senderId: ME.id,
                kind: "TEXT",
                body: String(body.body ?? ""),
                clientId: String(body.clientId ?? ""),
                replyTo: body.replyTo ? { id: String(body.replyTo), body: "quoted" } : null,
                createdAt: new Date().toISOString(),
                rowid: 100 + worker.sent.length,
              },
            },
            201,
          );
        }
        const items = messagesFor(conversationId);
        return json(route, {
          items: [...items].reverse(),
          readAt: new Date(Date.now() - 30_000).toISOString(),
          typingAt: "",
          typingKind: "",
          marker: "mk-test",
          oldest: { createdAt: items[0]?.createdAt ?? "", rowid: items[0]?.rowid ?? 0 },
          hasMore: false,
          priv: {},
        });
      });

      await page.route("**/api/conversations/*/read", (route) => {
        worker.readCalls.push(route.request().url());
        return json(route, { ok: true });
      });
      await page.route("**/api/conversations/*/typing", (route) => {
        const url = new URL(route.request().url());
        const body = route.request().postDataJSON() as Record<string, unknown>;
        worker.typingCalls.push({
          conversationId: decodeURIComponent(url.pathname.split("/")[3] ?? ""),
          kind: String(body.kind ?? ""),
        });
        return json(route, { ok: true });
      });
      await page.route("**/api/conversations/*", (route) => {
        const url = new URL(route.request().url());
        const conversationId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const row = conversations.find((item) => item.id === conversationId);
        return json(route, { conversation: row ?? null });
      });

      await page.route("**/api/messages/*/react", (route) => {
        const url = new URL(route.request().url());
        const body = route.request().postDataJSON() as Record<string, unknown>;
        worker.reactions.push({
          messageId: decodeURIComponent(url.pathname.split("/")[3] ?? ""),
          emoji: String(body.emoji ?? ""),
        });
        return json(route, {
          message: {
            id: decodeURIComponent(url.pathname.split("/")[3] ?? ""),
            senderId: PEER_ID,
            kind: "TEXT",
            body: "আগের প্লেইন মেসেজ",
            createdAt: new Date(Date.now() - 120_000).toISOString(),
            rowid: 1,
            meta: { reactions: { [PEER_ID]: String(body.emoji ?? "") } },
          },
        });
      });

      await page.route("**/api/messages/*", (route) => {
        const url = new URL(route.request().url());
        worker.deletedMessageIds.push(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
        return json(route, { ok: true });
      });
    },
  };

  return worker;
}

/** The body of the seeded outgoing row, kept in one place for assertions. */
export function ownPlaintextBody(): string {
  return "আমার পাঠানো প্লেইন মেসেজ";
}

/** Seed a signed-in browser session before the app boots. */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("kp.token", "test-bearer-token");
    window.localStorage.setItem("kp.device", "web-testdevice");
  });
}
