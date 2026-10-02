// Web account/auth request contracts, phone formatting, and compatible local session storage.
import { ApiError, apiErrorMessage, createApiClient } from "../../web/src/api.ts";
import {
  authApi,
  authErrorCopy,
  isAuthUser,
  isSessionPayload,
} from "../../web/src/auth/authApi.ts";
import { buildE164 as webBuildE164, validOtp as webValidOtp } from "../../web/src/auth/phone.ts";
import {
  clearAuthSession,
  ensureWebDeviceId,
  persistAuthSession,
  storedBearerToken,
  storedWebDeviceId,
  TOKEN_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
} from "../../web/src/auth/storage.ts";
import {
  buildE164 as legacyBuildE164,
  validOtp as legacyValidOtp,
} from "../../public/login-utils.mjs";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const user = {
  id: "user-test-1",
  username: "web_user",
  displayName: "Web User",
  about: "",
  phone: "+8801712345678",
  email: null,
  googleEmail: "user@example.test",
  googleLinked: true,
};
const session = { token: "test-bearer-token", status: "SESSION", user };
const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
};

const countries = [
  { iso: "BD", name: "Bangladesh", dial: "880" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "US", name: "United States", dial: "1" },
];
const phoneCases = [
  ["local Bangladesh trunk zero", "01712345678", countries[0]],
  ["international Bangladesh", "+8801712345678", countries[0]],
  ["international 00 prefix", "008801712345678", countries[0]],
  ["duplicated selected calling code", "+8808801712345678", countries[0]],
  ["UK local number", "02079460056", countries[1]],
  ["US calling code is not double-prefixed", "+12025550123", countries[2]],
  ["malformed Bangladesh mobile", "01012345678", countries[0]],
  ["empty phone", "", countries[0]],
];
for (const [label, input, country] of phoneCases) {
  check(
    `Web phone parser matches the legacy contract: ${label}`,
    webBuildE164(input, country) === legacyBuildE164(input, country),
    String(webBuildE164(input, country)),
  );
}
for (const [label, input] of [
  ["six digits", "123456"],
  ["spaces are trimmed", " 123456 "],
  ["five digits", "12345"],
  ["letters rejected", "12a456"],
]) {
  check(
    `Web OTP parser matches the legacy contract: ${label}`,
    webValidOtp(input) === legacyValidOtp(input),
  );
}

check("valid self user matches the Worker response shape", isAuthUser(user));
check("session response accepts the Worker SESSION payload", isSessionPayload(session));
check("session response rejects an empty bearer", !isSessionPayload({ ...session, token: "" }));
check(
  "session response rejects missing user identity",
  !isSessionPayload({ token: "x", user: {} }),
);

const storage = memoryStorage();
let randomIdCalls = 0;
const deviceId = ensureWebDeviceId(storage, () => {
  randomIdCalls++;
  return "12345678-1234-4abc-8def-123456789abc";
});
check("new Web install id is namespaced for the Worker WEB platform", deviceId.startsWith("web-"));
check(
  "device id is persisted and reused for this browser install",
  storedWebDeviceId(storage) === deviceId &&
    ensureWebDeviceId(storage, () => "different") === deviceId,
);
check("device id generation happens once when storage is available", randomIdCalls === 1);
persistAuthSession(session.token, user, storage);
check(
  "session persistence uses the legacy shared kp.token key",
  storage.getItem(TOKEN_STORAGE_KEY) === session.token &&
    storedBearerToken(storage) === session.token,
);
check(
  "device identity is not the bearer token",
  storage.getItem(DEVICE_ID_STORAGE_KEY) === deviceId &&
    storage.getItem(DEVICE_ID_STORAGE_KEY) !== session.token,
);
clearAuthSession(storage);
check(
  "logout clears bearer, cached profile and E2EE material",
  !storage.getItem(TOKEN_STORAGE_KEY) && !storage.getItem("kp.me") && !storage.getItem("kp.e2ee"),
);
check("logout retains the non-secret install id", storedWebDeviceId(storage) === deviceId);

const requests = [];
const client = createApiClient(async (input, init) => {
  const path = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requests.push({ path, method: init?.method ?? "GET", headers: new Headers(init?.headers), body });
  let responseBody = { ok: true };
  if (path.startsWith("/api/auth/verify-phone"))
    responseBody = { status: "ACCOUNT_CREATED", phone: "+8801712345678" };
  else if (path.startsWith("/api/auth/login/poll")) responseBody = { status: "PENDING" };
  else if (path.startsWith("/api/auth/login/otp"))
    responseBody = { status: "INVALID_CODE", attemptsRemaining: 4 };
  else if (path.startsWith("/api/auth/recovery/lookup")) responseBody = { exists: true };
  else if (path.startsWith("/api/auth/recovery/start"))
    responseBody = { requestId: "recovery-request-1", expiresAt: "2030-01-01T00:00:00.000Z" };
  else if (path.startsWith("/api/auth/recovery/complete")) responseBody = session;
  else if (path.startsWith("/api/auth/google/bind")) responseBody = session;
  else if (path.startsWith("/api/me") && init?.method === "PATCH") responseBody = { user };
  else if (path.startsWith("/api/users/username-available"))
    responseBody = { available: true, reason: "free" };
  else if (path.startsWith("/api/auth/devices")) responseBody = { items: [] };
  else if (path.startsWith("/api/config/firebase"))
    responseBody = { googleWebClientId: "public-client-id" };
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});

await authApi.verifyPhone(client, {
  phone: "+8801712345678",
  sim: "UNAVAILABLE",
  deviceId,
  deviceName: "Web browser",
  platform: "WEB",
});
await authApi.bindGoogle(client, {
  phone: "+8801712345678",
  idToken: "google-id-token",
  deviceId,
  platform: "WEB",
});
await authApi.pollLogin(client, { requestId: "login-request-1", deviceId });
await authApi.submitOtp(client, { requestId: "login-request-1", deviceId, otp: "123456" });
await authApi.cancelLogin(client, { requestId: "login-request-1", deviceId });
await authApi.lookupRecovery(client, { phone: "+8801712345678" });
await authApi.startRecovery(client, {
  phone: "+8801712345678",
  idToken: "google-id-token",
  deviceId,
  platform: "WEB",
});
await authApi.completeRecovery(client, { requestId: "recovery-request-1", deviceId });
await authApi.getGoogleConfig(client);
await authApi.getMe(client);
await authApi.updateMe(client, { displayName: "Updated Name" });
await authApi.checkUsername(client, "web_user");
await authApi.getDevices(client);
await authApi.logout(client);
await authApi.refresh(client);

check(
  "all Worker authentication paths stay same-origin and never carry tokens in URLs",
  requests.every(
    (request) => request.path.startsWith("/api/") && !/[?&](?:token|idToken)=/i.test(request.path),
  ),
);
check(
  "phone verification explicitly reports Web platform and unavailable SIM",
  requests[0].body.platform === "WEB" &&
    requests[0].body.sim === "UNAVAILABLE" &&
    requests[0].body.deviceId.startsWith("web-"),
);
check(
  "all JSON mutations set application/json and send a JSON body",
  requests
    .filter((request) => request.method === "POST" || request.method === "PATCH")
    .every(
      (request) =>
        request.headers.get("content-type") === "application/json" &&
        typeof request.body === "object",
    ),
);
check(
  "username availability is a safe GET query parameter",
  requests.some(
    (request) =>
      request.path === "/api/users/username-available?u=web_user" && request.method === "GET",
  ),
);
check(
  "session, approval, OTP and recovery wrappers map the existing Worker routes",
  [
    "/api/auth/verify-phone",
    "/api/auth/google/bind",
    "/api/auth/login/poll",
    "/api/auth/login/otp",
    "/api/auth/login/cancel",
    "/api/auth/recovery/lookup",
    "/api/auth/recovery/start",
    "/api/auth/recovery/complete",
  ].every((path) => requests.some((request) => request.path === path)),
);

const fake401 = new ApiError({ kind: "http", status: 401, code: "AUTH_REQUIRED" });
check(
  "auth error copy never displays raw Worker details",
  authErrorCopy(fake401) === "Sign in again to continue." &&
    !apiErrorMessage(fake401).includes("private"),
);
check(
  "phone mismatch has safe actionable copy",
  authErrorCopy(new ApiError({ kind: "http", status: 403, code: "PHONE_MISMATCH" })).includes(
    "This browser cannot read a SIM",
  ),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`case 53: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);
