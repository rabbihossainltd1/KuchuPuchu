/**
 * KP1 / KP2 message encryption for the browser client.
 *
 * This is a port of the WebCrypto implementation that already ships in the
 * production PWA (`public/app.js`) and was cross-checked byte-for-byte against
 * a Java port of the Android scheme in `E2eeMsg.kt`:
 *
 *   P-256 ECDH -> HKDF-SHA256 -> AES-256-GCM
 *   envelope = "KP1." + base64(12-byte nonce || ciphertext)
 *
 * The Android HKDF is written out by hand there (prk = HMAC(key = shared,
 * data = empty), T1 = HMAC(key = prk, data = info || 0x01)) and is reproduced
 * exactly below, because a standard HKDF-Expand would not interoperate.
 *
 * Identity policy is the app's: one keypair per account, adopted from the
 * roaming backup. This module never silently mints a second identity when an
 * existing backup cannot be unlocked — that would strand every envelope the
 * phone already wrote.
 *
 * Scope note kept honest on purpose: this seals 1:1 message *bodies* only.
 * Group and AI conversations stay plaintext on the server, and media bytes are
 * account-controlled rather than end-to-end encrypted.
 */

export const KP1_PREFIX = "KP1.";
export const KP2_PREFIX = "KP2.";
export const HKDF_INFO = "kp-msg-e2ee-v1";
export const KP2_ITERATIONS = 200_000;

/** The two server-side bot accounts. Their transcripts are the product. */
export const OFFICIAL_BOT_ID = "kp_official_bot";
export const AI_BOT_ID = "kp_ai_bot";
export const BOT_IDS: ReadonlySet<string> = new Set([OFFICIAL_BOT_ID, AI_BOT_ID]);

/** Shown when an envelope cannot be opened with the local identity. */
export const UNOPENABLE_BODY = "\u{1F512} অ্যাপে খুলুন";

/** The app's refusal copy when a personal chat has no usable peer key. */
export const SECURE_CHAT_WAITING = "Waiting for secure chat — নিরাপদ চ্যাটের জন্য অপেক্ষা…";

export type E2eeIdentity = {
  /** PKCS#8 private key, base64. */
  readonly p: string;
  /** SPKI public key, base64. */
  readonly u: string;
};

/** Minimal conversation shape the send policy needs. */
export type ConversationIdentity = {
  readonly isGroup: boolean;
  readonly otherId: string;
};

/**
 * A refused send is a permanent outcome, not a transport failure: the outbox
 * must return the text to the composer instead of retrying it forever.
 */
export class SendRefusedError extends Error {
  readonly refused = true;

  constructor(message: string = SECURE_CHAT_WAITING) {
    super(message);
    this.name = "SendRefusedError";
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  // An explicit ArrayBuffer keeps the result assignable to WebCrypto's
  // BufferSource, which rejects views that could sit on a SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** SPKI P-256 public keys are ~124 base64 chars; the app's own guard is >60. */
export function isValidPublicKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 60;
}

function isIdentity(value: unknown): value is E2eeIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.p === "string" && candidate.p.length > 60 && isValidPublicKey(candidate.u)
  );
}

export function parseStoredIdentity(value: unknown): E2eeIdentity | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isIdentity(parsed) ? { p: parsed.p, u: parsed.u } : null;
  } catch {
    return null;
  }
}

async function importPrivateKey(privateKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

/**
 * The app's HKDF (E2eeMsg.kt), reproduced exactly: one 32-byte block.
 * prk = HMAC-SHA256(key = shared secret, data = empty)
 * T1  = HMAC-SHA256(key = prk, data = info || 0x01)
 */
export async function messageKeyFromShared(shared: Uint8Array): Promise<CryptoKey> {
  const prkKey = await crypto.subtle.importKey(
    "raw",
    shared as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, new Uint8Array(0)));

  const infoKey = await crypto.subtle.importKey(
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
  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", infoKey, block as BufferSource));

  return crypto.subtle.importKey("raw", t1 as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function deriveShared(identity: E2eeIdentity, peerPublicKeyB64: string): Promise<Uint8Array> {
  const privateKey = await importPrivateKey(identity.p);
  const publicKey = await importPublicKey(peerPublicKeyB64);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256),
  );
}

/** Seal a plaintext body for a peer. Returns null when encryption is impossible. */
export async function sealBody(
  plaintext: string,
  peerPublicKey: string,
  identity: E2eeIdentity,
): Promise<string | null> {
  if (!isValidPublicKey(peerPublicKey)) return null;
  try {
    const shared = await deriveShared(identity, peerPublicKey);
    const key = await messageKeyFromShared(shared);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    );
    const envelope = new Uint8Array(12 + ciphertext.byteLength);
    envelope.set(nonce);
    envelope.set(new Uint8Array(ciphertext), 12);
    return KP1_PREFIX + bytesToBase64(envelope);
  } catch {
    return null;
  }
}

/** Plain predicate: a type guard would narrow an already-string body to never. */
export function isEnvelope(body: unknown): boolean {
  return typeof body === "string" && body.startsWith(KP1_PREFIX);
}

/**
 * Open a KP1 envelope. JCA providers pad the P-256 secret to 32 bytes (SunEC
 * and Conscrypt were both measured), but a minimal-length secret from any peer
 * must still open, so a leading-zero-stripped variant is tried as well.
 */
export async function openEnvelope(
  envelope: string,
  peerPublicKey: string,
  identity: E2eeIdentity,
): Promise<string | null> {
  if (!isEnvelope(envelope) || !isValidPublicKey(peerPublicKey)) return null;
  try {
    const raw = base64ToBytes(envelope.slice(KP1_PREFIX.length));
    // 12-byte nonce + 16-byte GCM tag means anything shorter is not a message.
    if (raw.length < 29) return null;

    const shared = await deriveShared(identity, peerPublicKey);
    const iv = raw.slice(0, 12);
    const ciphertext = raw.slice(12);

    const variants: Uint8Array[] = [shared];
    let leadingZeros = 0;
    while (leadingZeros < shared.length - 1 && shared[leadingZeros] === 0) leadingZeros += 1;
    if (leadingZeros > 0) variants.push(shared.slice(leadingZeros));

    for (const variant of variants) {
      try {
        const key = await messageKeyFromShared(variant);
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          key,
          ciphertext as BufferSource,
        );
        return new TextDecoder().decode(plaintext);
      } catch {
        // Try the next secret-length variant before giving up.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Resolve what a message row should display, without mutating the row. */
export async function decryptMessageBody(
  body: string,
  peerPublicKey: string,
  identity: E2eeIdentity | null,
): Promise<{ sealed: boolean; text: string }> {
  if (!isEnvelope(body)) return { sealed: false, text: body };
  if (!identity) return { sealed: true, text: UNOPENABLE_BODY };
  const opened = await openEnvelope(body, peerPublicKey, identity);
  return { sealed: true, text: opened ?? UNOPENABLE_BODY };
}

/** KP2: base64(salt).base64(iv).base64(ct) over "priv\npub", PBKDF2-SHA256 200k. */
export async function unlockPassphraseBackup(
  blob: string,
  passphrase: string,
): Promise<E2eeIdentity | null> {
  if (!blob.startsWith(KP2_PREFIX) || !passphrase) return null;
  try {
    const parts = blob.slice(KP2_PREFIX.length).split(".");
    if (parts.length !== 3) return null;
    const [saltB64, ivB64, ciphertextB64] = parts as [string, string, string];

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const keyBytes = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64ToBytes(saltB64) as BufferSource,
        iterations: KP2_ITERATIONS,
      },
      passwordKey,
      256,
    );
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivB64) as BufferSource },
      key,
      base64ToBytes(ciphertextB64) as BufferSource,
    );

    const decoded = new TextDecoder().decode(plaintext);
    const cut = decoded.indexOf("\n");
    if (cut <= 0) return null;
    const p = decoded.slice(0, cut);
    const u = decoded.slice(cut + 1);
    return p.length > 60 && isValidPublicKey(u) ? { p, u } : null;
  } catch {
    // A wrong passphrase fails the GCM tag; that is indistinguishable from a
    // corrupt blob and must never mint a replacement identity.
    return null;
  }
}

/** KP1 plaintext backup blob: base64 of JSON {p,u} — what a reinstall restores. */
export function encodePlaintextBackup(identity: E2eeIdentity): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify({ p: identity.p, u: identity.u })));
}

export function decodePlaintextBackup(blob: string): E2eeIdentity | null {
  if (!blob || blob.startsWith(KP2_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64ToBytes(blob)));
    return isIdentity(parsed) ? { p: parsed.p, u: parsed.u } : null;
  } catch {
    return null;
  }
}

export function isPassphraseBackup(blob: string): boolean {
  return typeof blob === "string" && blob.startsWith(KP2_PREFIX);
}

/** First-device behaviour: mint a keypair when the account has no backup at all. */
export async function generateIdentity(): Promise<E2eeIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return { p: bytesToBase64(new Uint8Array(pkcs8)), u: bytesToBase64(new Uint8Array(spki)) };
}

/**
 * The app's send policy (E2eeSendPolicy + prepareOutgoing): a personal chat is
 * a SOLO conversation whose peer is not a bot, and a personal body may never
 * leave plaintext. With no usable peer key the send is refused outright.
 */
export function isPersonalConversation(conversation: ConversationIdentity): boolean {
  return !conversation.isGroup && !BOT_IDS.has(conversation.otherId.trim());
}

export async function protectOutgoingBody(
  plaintext: string,
  conversation: ConversationIdentity,
  peerPublicKey: string,
  identity: E2eeIdentity | null,
): Promise<string> {
  if (!plaintext) return plaintext;
  if (!isPersonalConversation(conversation)) return plaintext;
  if (!identity || !isValidPublicKey(peerPublicKey)) throw new SendRefusedError();

  const sealed = await sealBody(plaintext, peerPublicKey, identity);
  if (!sealed) throw new SendRefusedError();
  return sealed;
}

/** Local echoes show plaintext; only the wire carries the envelope. */
export function localEchoBody(plaintext: string): string {
  return plaintext;
}
