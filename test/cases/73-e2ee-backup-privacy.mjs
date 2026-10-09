// E2EE key backups must reach the worker only as passphrase-locked KP2 blobs.
// Legacy KP1 plaintext backups remain readable for an explicit client-side
// migration, but the write route must never accept another unencrypted key.

import { readFileSync } from "node:fs";
import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";
import { makeReg, installGoogleStub } from "../helpers/phoneauth.mjs";

installGoogleStub();
const worker = (await import("../../src/worker/index.ts")).default;
const db = makeD1();
const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
const ctx = makeCtx();
const checks = [];
const check = (name, ok, detail = "") =>
  checks.push(`  ${ok ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const native = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/E2eeMsg.kt",
    import.meta.url,
  ),
  "utf8",
);
const identityHook = readFileSync(
  new URL("../../web/src/messaging/useE2eeIdentity.ts", import.meta.url),
  "utf8",
);
const legacyWebApp = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
check(
  "native and web startup never upload a plaintext private-key backup",
  !native.includes("backupLocal(") &&
    !native.includes("encodeBackup(") &&
    native.includes("packBackup(pair.first, pair.second, pass)") &&
    !identityHook.includes("encodePlaintextBackup") &&
    !identityHook.includes("messagingApi.putBackup") &&
    !legacyWebApp.includes('api("/api/e2ee/backup", { method: "PUT"'),
);
check(
  "legacy restore is import-only and migration refuses a different local identity",
  native.includes("decodeLegacyBackup(remote)") &&
    native.includes("if (legacy != pair) return@runCatching false"),
);
let ipSeq = 0;
const call = async (method, path, body, token) => {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/auth/"))
    headers["cf-connecting-ip"] = `203.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const response = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
  const text = await response.text();
  await ctx.drain();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
};

const reg = makeReg(call);
const account = await reg("e2ee-backup@x.com", "backup");
const legacy = Buffer.from(
  JSON.stringify({ p: "legacy-private-key", u: "legacy-public-key" }),
).toString("base64");
db._db.prepare("UPDATE users SET e2ee_backup = ? WHERE id = ?").run(legacy, account.user.id);
const legacyRead = await call("GET", "/api/e2ee/backup", undefined, account.token);
check(
  "an existing legacy backup remains readable for explicit client-side migration",
  legacyRead.status === 200 && legacyRead.json.backup === legacy,
);
const legacyWrite = await call("PUT", "/api/e2ee/backup", { backup: legacy }, account.token);
const afterLegacyWrite = await call("GET", "/api/e2ee/backup", undefined, account.token);
check(
  "the server rejects new legacy writes without changing the existing legacy backup",
  legacyWrite.status === 400 &&
    legacyWrite.json.error?.code === "BAD_E2EE_BACKUP" &&
    afterLegacyWrite.json.backup === legacy,
  JSON.stringify(legacyWrite.json),
);

const kp2 = `KP2.${Buffer.alloc(16).toString("base64")}.${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(64).toString("base64")}`;
const accepted = await call("PUT", "/api/e2ee/backup", { backup: kp2 }, account.token);
check("a correctly shaped passphrase-locked KP2 blob is accepted", accepted.status === 200);
const fetched = await call("GET", "/api/e2ee/backup", undefined, account.token);
check(
  "the server returns only the opaque KP2 blob, not its key material",
  fetched.status === 200 &&
    fetched.json.backup === kp2 &&
    !fetched.json.backup.includes("legacy-private-key"),
);

const malformed = await call(
  "PUT",
  "/api/e2ee/backup",
  { backup: "KP2.short.parts" },
  account.token,
);
const afterMalformed = await call("GET", "/api/e2ee/backup", undefined, account.token);
check(
  "malformed KP2 writes are rejected without replacing the existing locked backup",
  malformed.status === 400 &&
    malformed.json.error?.code === "BAD_E2EE_BACKUP" &&
    afterMalformed.json.backup === kp2,
  JSON.stringify(malformed.json),
);
const deleted = await call("PUT", "/api/e2ee/backup", { backup: "" }, account.token);
const afterDelete = await call("GET", "/api/e2ee/backup", undefined, account.token);
check(
  "an explicit empty write still deletes the backup",
  deleted.status === 200 && afterDelete.status === 200 && afterDelete.json.backup === null,
);

for (const line of checks) console.log(line);
const broken = checks.filter((line) => line.includes("BROKEN")).length;
console.log(`e2ee-backup-privacy: ${checks.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);
