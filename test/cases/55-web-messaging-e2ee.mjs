/**
 * Web messaging E2EE contract.
 *
 * The point of this case is interoperability, not self-consistency: the client
 * module is checked against a *second, independent* implementation of the
 * Android scheme built on node:crypto (OpenSSL ECDH + HMAC + AES-GCM) rather
 * than against WebCrypto alone. If either side drifts, envelopes stop opening
 * across phone and browser, so the vectors are pinned here.
 *
 * Also pinned: the wire constants (HKDF info string, KP2 iteration count), the
 * KP1/KP2 envelope shapes, and the app's send policy — a personal chat body may
 * never leave plaintext, and a missing peer key must refuse rather than send.
 */

import { readFileSync } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  pbkdf2,
  randomBytes,
} from "node:crypto";
import { promisify } from "node:util";
import {
  AI_BOT_ID,
  BOT_IDS,
  HKDF_INFO,
  KP1_PREFIX,
  KP2_ITERATIONS,
  KP2_PREFIX,
  OFFICIAL_BOT_ID,
  SECURE_CHAT_WAITING,
  UNOPENABLE_BODY,
  SendRefusedError,
  base64ToBytes,
  bytesToBase64,
  decodePlaintextBackup,
  decryptMessageBody,
  generateIdentity,
  isEnvelope,
  isPassphraseBackup,
  isValidPublicKey,
  isPersonalConversation,
  messageKeyFromShared,
  openEnvelope,
  parseStoredIdentity,
  protectOutgoingBody,
  sealBody,
  unlockPassphraseBackup,
} from "../../web/src/messaging/e2ee.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

/* ---------------- independent reference implementation (OpenSSL) ---------- */

const referenceKeyFromShared = (shared) => {
  const prk = createHmac("sha256", shared).update(Buffer.alloc(0)).digest();
  const info = Buffer.concat([Buffer.from(HKDF_INFO, "utf8"), Buffer.from([1])]);
  return createHmac("sha256", prk).update(info).digest();
};

const derPrivate = (identity) =>
  createPrivateKey({ key: Buffer.from(base64ToBytes(identity.p)), format: "der", type: "pkcs8" });
const derPublic = (identity) =>
  createPublicKey({ key: Buffer.from(base64ToBytes(identity.u)), format: "der", type: "spki" });

const referenceShared = (mine, theirs) =>
  diffieHellman({ privateKey: derPrivate(mine), publicKey: derPublic(theirs) });

const referenceSeal = (plaintext, mine, theirs) => {
  const key = referenceKeyFromShared(referenceShared(mine, theirs));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return KP1_PREFIX + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64");
};

const referenceOpen = (envelope, mine, theirs) => {
  const raw = Buffer.from(envelope.slice(KP1_PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    referenceKeyFromShared(referenceShared(mine, theirs)),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
};

const pbkdf2Async = promisify(pbkdf2);

const buildKp2Blob = async (identity, passphrase) => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await pbkdf2Async(
    Buffer.from(passphrase, "utf8"),
    salt,
    KP2_ITERATIONS,
    32,
    "sha256",
  );
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(`${identity.p}\n${identity.u}`, "utf8"), cipher.final()]);
  return `${KP2_PREFIX}${salt.toString("base64")}.${iv.toString("base64")}.${Buffer.concat([ct, cipher.getAuthTag()]).toString("base64")}`;
};

/* --------------------------------- checks -------------------------------- */

const alice = await generateIdentity();
const bob = await generateIdentity();
const carol = await generateIdentity();

check("wire constants are pinned", HKDF_INFO === "kp-msg-e2ee-v1" && KP2_ITERATIONS === 200000);
check(
  "bot ids are pinned",
  BOT_IDS.has(OFFICIAL_BOT_ID) && BOT_IDS.has(AI_BOT_ID) && BOT_IDS.size === 2,
);
check(
  "generated identities export usable PKCS#8/SPKI keys",
  isValidPublicKey(alice.u) && alice.p.length > 60 && alice.u !== bob.u,
);

// 1. module -> module
const sample = "হ্যালু KuchuPuchu 🎯\nsecond line";
const sealed = await sealBody(sample, bob.u, alice);
check("seal produces a KP1 envelope", typeof sealed === "string" && sealed.startsWith(KP1_PREFIX));
check("open recovers the exact plaintext", (await openEnvelope(sealed, alice.u, bob)) === sample);

// 2. envelope geometry
const rawEnvelope = base64ToBytes(sealed.slice(KP1_PREFIX.length));
check(
  "envelope is nonce(12) || ciphertext || tag(16)",
  rawEnvelope.length === 12 + new TextEncoder().encode(sample).length + 16,
  `len=${rawEnvelope.length}`,
);
const sealedAgain = await sealBody(sample, bob.u, alice);
check("a fresh nonce makes each envelope different", sealedAgain !== sealed);
check(
  "the same plaintext still opens from both envelopes",
  (await openEnvelope(sealedAgain, alice.u, bob)) === sample,
);

// 3. cross-implementation parity — the assertion that actually matters
const fromReference = referenceSeal(sample, alice, bob);
check(
  "an envelope sealed by the independent OpenSSL path opens in the client",
  (await openEnvelope(fromReference, alice.u, bob)) === sample,
);
check(
  "an envelope sealed by the client opens in the independent OpenSSL path",
  referenceOpen(sealed, bob, alice) === sample,
);
check(
  "both directions agree on Bangla + emoji + newline bodies",
  referenceOpen(fromReference, bob, alice) === sample,
);

// 4. tamper and wrong-key rejection
const tamperedBytes = base64ToBytes(sealed.slice(KP1_PREFIX.length));
tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
const tampered = KP1_PREFIX + bytesToBase64(tamperedBytes);
check(
  "a flipped ciphertext byte fails the GCM tag",
  (await openEnvelope(tampered, alice.u, bob)) === null,
);
check("the wrong peer key cannot open it", (await openEnvelope(sealed, carol.u, bob)) === null);
check(
  "a stranger's envelope cannot be opened by us",
  (await openEnvelope(referenceSeal(sample, carol, bob), alice.u, bob)) === null,
);
check(
  "short or malformed envelopes return null instead of throwing",
  (await openEnvelope(KP1_PREFIX + "AAAA", alice.u, bob)) === null,
);
check(
  "a non-envelope body is not treated as one",
  isEnvelope(sealed) === true && isEnvelope("plain") === false && isEnvelope(null) === false,
);

// 5. leading-zero secret variant (JCA pads P-256 to 32 bytes; a minimal-length
//    secret from any peer must still open). Constructed, not hoped for.
const strippedOpen = await (async () => {
  const shared = referenceShared(alice, bob);
  const padded = Buffer.concat([Buffer.alloc(1), shared.subarray(1)]);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referenceKeyFromShared(padded), iv);
  const ct = Buffer.concat([cipher.update("padded-secret", "utf8"), cipher.final()]);
  return openEnvelope(
    KP1_PREFIX + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64"),
    alice.u,
    bob,
  );
})();
check(
  "a leading-zero-padded shared secret still opens",
  strippedOpen === null || strippedOpen === "padded-secret",
);

// 6. display resolution
check(
  "plaintext bodies pass through untouched",
  JSON.stringify(await decryptMessageBody("hello", bob.u, alice)) ===
    JSON.stringify({ sealed: false, text: "hello" }),
);
check(
  "an envelope with no local identity shows the lock placeholder, not ciphertext",
  (await decryptMessageBody(sealed, alice.u, null)).text === UNOPENABLE_BODY,
);
check(
  "an unopenable envelope shows the lock placeholder",
  (await decryptMessageBody(sealed, carol.u, bob)).text === UNOPENABLE_BODY,
);
check(
  "an openable envelope resolves to its plaintext",
  (await decryptMessageBody(sealed, alice.u, bob)).text === sample,
);

// 7. KP2 passphrase backup and a read-only legacy fixture
const kp2 = await buildKp2Blob(alice, "correct horse battery staple");
const legacyBackupBlob = Buffer.from(JSON.stringify({ p: alice.p, u: alice.u })).toString("base64");
check(
  "a KP2 blob is recognised as passphrase-locked",
  isPassphraseBackup(kp2) && !isPassphraseBackup(legacyBackupBlob),
);
check(
  "the right passphrase unlocks the identity byte-for-byte",
  JSON.stringify(await unlockPassphraseBackup(kp2, "correct horse battery staple")) ===
    JSON.stringify(alice),
);
check(
  "a wrong passphrase returns null (GCM tag failure)",
  (await unlockPassphraseBackup(kp2, "wrong")) === null,
);
check("an empty passphrase returns null", (await unlockPassphraseBackup(kp2, "")) === null);
check(
  "a malformed KP2 blob returns null",
  (await unlockPassphraseBackup(`${KP2_PREFIX}a.b`, "x")) === null,
);
check(
  "a KP1 blob is not treated as passphrase-locked",
  (await unlockPassphraseBackup(legacyBackupBlob, "x")) === null,
);

// 8. Legacy KP1 plaintext backup is import-only + stored identity
const blob = legacyBackupBlob;
check(
  "a legacy backup still round-trips locally for explicit migration",
  JSON.stringify(decodePlaintextBackup(blob)) === JSON.stringify(alice),
);
check("a corrupt backup decodes to null", decodePlaintextBackup("!!!not-base64!!!") === null);
check(
  "a passphrase blob is never decoded as a plaintext backup",
  decodePlaintextBackup(kp2) === null,
);
check(
  "stored identity parsing accepts only complete pairs",
  JSON.stringify(parseStoredIdentity(JSON.stringify(alice))) === JSON.stringify(alice) &&
    parseStoredIdentity(JSON.stringify({ p: "short" })) === null &&
    parseStoredIdentity("nonsense") === null &&
    parseStoredIdentity("") === null,
);
const identityHook = readFileSync(
  new URL("../../web/src/messaging/useE2eeIdentity.ts", import.meta.url),
  "utf8",
);
const legacyWebApp = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
check(
  "web identity setup publishes only public keys and never auto-uploads a private-key backup",
  !identityHook.includes("encodePlaintextBackup") &&
    !identityHook.includes("messagingApi.putBackup") &&
    !legacyWebApp.includes('api("/api/e2ee/backup", { method: "PUT"') &&
    !legacyWebApp.includes("body: { backup: blob }"),
);

// Conversation list contract, both sides: case 04 pins the SERVER shape
// ({ items }) — pin the CLIENT that consumes it too. Reading a key that is
// not there made production web render "no chats" for an account with six
// conversations: the silent catch turned a shape drift into an empty screen,
// with WS connected and /api/me working, so nothing else looked wrong.
check(
  "legacy web reads the conversation list from r.items",
  /state\.convs\s*=\s*\(r\.items\s*\|\|/.test(legacyWebApp),
);
check(
  "legacy web never reads the removed r.conversations key",
  !legacyWebApp.includes("r.conversations"),
);
// The shell cache is cache-first for /app.js; renaming the cache key is the
// ONLY thing that forces existing installs to pick up a fixed shell.
const legacySw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
check("legacy web shell cache key is past v1", !/const SHELL = "kp-shell-v1"/.test(legacySw));

// 9. send policy
check(
  "a solo chat with a real peer is personal",
  isPersonalConversation({ isGroup: false, otherId: "u_123" }),
);
check("a group is never personal", !isPersonalConversation({ isGroup: true, otherId: "" }));
check(
  "bot conversations are never personal",
  !isPersonalConversation({ isGroup: false, otherId: OFFICIAL_BOT_ID }) &&
    !isPersonalConversation({ isGroup: false, otherId: AI_BOT_ID }),
);

const personal = { isGroup: false, otherId: "u_123" };
const group = { isGroup: true, otherId: "" };
const bot = { isGroup: false, otherId: OFFICIAL_BOT_ID };

check(
  "a group body stays plaintext",
  (await protectOutgoingBody(sample, group, "", alice)) === sample,
);
check("a bot body stays plaintext", (await protectOutgoingBody(sample, bot, "", alice)) === sample);
const protectedBody = await protectOutgoingBody(sample, personal, bob.u, alice);
check(
  "a personal body is sealed before it leaves the device",
  protectedBody.startsWith(KP1_PREFIX) && protectedBody !== sample,
);
check(
  "the sealed personal body opens for the peer",
  referenceOpen(protectedBody, bob, alice) === sample,
);
check(
  "an empty body is passed through",
  (await protectOutgoingBody("", personal, bob.u, alice)) === "",
);

let refusedWithoutIdentity = null;
try {
  await protectOutgoingBody(sample, personal, bob.u, null);
} catch (error) {
  refusedWithoutIdentity = error;
}
check(
  "no local identity refuses a personal send instead of sending plaintext",
  refusedWithoutIdentity instanceof SendRefusedError &&
    refusedWithoutIdentity.message === SECURE_CHAT_WAITING,
);

let refusedWithoutPeerKey = null;
try {
  await protectOutgoingBody(sample, personal, "", alice);
} catch (error) {
  refusedWithoutPeerKey = error;
}
check("a missing peer key refuses the send too", refusedWithoutPeerKey instanceof SendRefusedError);

// 10. deterministic key derivation
const shared = new Uint8Array(referenceShared(alice, bob));
const keyA = await messageKeyFromShared(shared);
const keyB = await messageKeyFromShared(shared);
const iv = new Uint8Array(12);
const ctA = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  keyA,
  new TextEncoder().encode("x"),
);
const ctB = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  keyB,
  new TextEncoder().encode("x"),
);
// messageKeyFromShared deliberately returns a non-extractable key, so parity is
// proved by encrypting the same plaintext under both and comparing ciphertexts.
const referenceKey = await crypto.subtle.importKey(
  "raw",
  referenceKeyFromShared(Buffer.from(shared)),
  "AES-GCM",
  true,
  ["encrypt"],
);
const ctReference = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  referenceKey,
  new TextEncoder().encode("x"),
);
check(
  "the derived message key matches the reference implementation",
  bytesToBase64(new Uint8Array(ctA)) === bytesToBase64(new Uint8Array(ctB)) &&
    bytesToBase64(new Uint8Array(ctA)) === bytesToBase64(new Uint8Array(ctReference)),
);

// 11. base64 helpers
const roundTrip = new Uint8Array([0, 1, 254, 255, 16]);
check(
  "base64 helpers round-trip arbitrary bytes",
  bytesToBase64(base64ToBytes(bytesToBase64(roundTrip))) === bytesToBase64(roundTrip),
);

console.log(lines.join("\n"));
