// Same-origin API client, typed failures, and privacy-safe error copy.
import { ApiError, apiErrorMessage, createApiClient } from "../../web/src/api.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
const expectError = async (name, promise, predicate) => {
  try {
    await promise;
    check(name, false, "request unexpectedly resolved");
  } catch (error) {
    check(name, predicate(error));
  }
};

const calls = [];
const client = createApiClient(async (input, init) => {
  calls.push({ input, init });
  return jsonResponse({ ok: true, count: 3 });
});
const result = await client.request("/api/me", {
  headers: { "x-request-id": "test-request" },
});
check("JSON response body is returned", result.ok === true && result.count === 3);
check("request path remains same-origin and relative", calls[0].input === "/api/me");
check(
  "request defaults to JSON, same-origin credentials, no-store, and no redirects",
  calls[0].init.headers.get("accept") === "application/json" &&
    calls[0].init.credentials === "same-origin" &&
    calls[0].init.cache === "no-store" &&
    calls[0].init.redirect === "error",
);
check(
  "caller-supplied headers are retained",
  calls[0].init.headers.get("x-request-id") === "test-request",
);

const noContentClient = createApiClient(async () => new Response(null, { status: 204 }));
check(
  "204 response resolves as undefined",
  (await noContentClient.request("/api/me")) === undefined,
);
const headClient = createApiClient(async () => new Response(null, { status: 200 }));
check(
  "HEAD response needs no JSON body",
  (await headClient.request("/api/me", { method: "HEAD" })) === undefined,
);

let rejectedFetchCalls = 0;
const guardedClient = createApiClient(async () => {
  rejectedFetchCalls++;
  return jsonResponse({ ok: true });
});
for (const badPath of [
  "https://attacker.example/api/me",
  "//attacker.example/api/me",
  "api/me",
  "/api/../debug",
  "/api/a%2Fb",
  "/api/me#token",
]) {
  await expectError(
    `unsafe path rejected before fetch: ${badPath}`,
    guardedClient.request(badPath),
    (error) => error instanceof ApiError && error.kind === "invalid-request",
  );
}
check("invalid paths never invoke fetch", rejectedFetchCalls === 0);

const authClient = createApiClient(async () =>
  jsonResponse({ error: { code: "AUTH_REQUIRED", message: "sensitive server detail" } }, 401),
);
await expectError(
  "401 captures status and the Worker's safe error code",
  authClient.request("/api/me"),
  (error) =>
    error instanceof ApiError &&
    error.kind === "http" &&
    error.status === 401 &&
    error.code === "AUTH_REQUIRED" &&
    apiErrorMessage(error) === "Sign in again to continue." &&
    !apiErrorMessage(error).includes("sensitive server detail"),
);

const forbiddenClient = createApiClient(async () =>
  jsonResponse({ error: { message: "private detail" } }, 403),
);
await expectError(
  "403 maps to fixed user copy",
  forbiddenClient.request("/api/me"),
  (error) =>
    error instanceof ApiError &&
    apiErrorMessage(error) === "You do not have permission to do that." &&
    !apiErrorMessage(error).includes("private detail"),
);

const throttledClient = createApiClient(async () =>
  jsonResponse({ error: { code: "RATE_LIMITED", message: "hidden" } }, 429, { "retry-after": "7" }),
);
await expectError(
  "429 retains retry metadata without retrying",
  throttledClient.request("/api/me"),
  (error) =>
    error instanceof ApiError &&
    error.status === 429 &&
    error.retryable &&
    error.retryAfter === "7" &&
    apiErrorMessage(error).includes("Wait a moment"),
);

const getFailureClient = createApiClient(async () =>
  jsonResponse({ error: { code: "TEMPORARY" } }, 503),
);
await expectError(
  "transient GET failure is marked retryable",
  getFailureClient.request("/api/me"),
  (error) => error instanceof ApiError && error.status === 503 && error.retryable,
);

let mutationCalls = 0;
const mutationClient = createApiClient(async () => {
  mutationCalls++;
  return jsonResponse({ error: { code: "TEMPORARY" } }, 503);
});
await expectError(
  "transient POST is not marked safe to retry or retried automatically",
  mutationClient.request("/api/messages", { method: "POST", body: "{}" }),
  (error) => error instanceof ApiError && !error.retryable && mutationCalls === 1,
);

const networkClient = createApiClient(async () => {
  throw new TypeError("raw transport detail");
});
await expectError(
  "GET network failure is retryable and privacy-safe",
  networkClient.request("/api/me"),
  (error) =>
    error instanceof ApiError &&
    error.kind === "network" &&
    error.retryable &&
    !error.message.includes("raw transport detail") &&
    apiErrorMessage(error).includes("Check your connection"),
);
await expectError(
  "POST network failure is not marked safe to retry",
  networkClient.request("/api/messages", { method: "POST", body: "{}" }),
  (error) => error instanceof ApiError && error.kind === "network" && !error.retryable,
);

const abortClient = createApiClient(async () => {
  throw { name: "AbortError" };
});
await expectError(
  "abort is neither offline nor retryable",
  abortClient.request("/api/me"),
  (error) =>
    error instanceof ApiError &&
    error.kind === "aborted" &&
    !error.retryable &&
    apiErrorMessage(error) === "",
);

const htmlClient = createApiClient(
  async () =>
    new Response("<html>unexpected</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
);
await expectError(
  "non-JSON success is rejected",
  htmlClient.request("/api/me"),
  (error) => error instanceof ApiError && error.kind === "invalid-response",
);
const malformedClient = createApiClient(
  async () =>
    new Response("{bad json", { status: 200, headers: { "content-type": "application/json" } }),
);
await expectError(
  "malformed JSON is rejected",
  malformedClient.request("/api/me"),
  (error) => error instanceof ApiError && error.kind === "invalid-response",
);
check(
  "unknown errors use fixed generic copy",
  apiErrorMessage(new Error("private transport information")) ===
    "Something went wrong. Please try again.",
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`case 51: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);
