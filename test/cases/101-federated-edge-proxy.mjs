// Two-account cutover contract: the KP-account Worker remains the stable edge
// project while the Vintox-account Worker becomes the single communication
// authority. Unset config preserves the ordinary local Worker path.
import worker from "../../src/worker/index.ts";

const lines = [];
function check(label, ok) {
  lines.push(`  ${ok ? "OK      " : "BROKEN  "} ${label}`);
}

const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (request) => {
  calls.push({
    url: request.url,
    method: request.method,
    auth: request.headers.get("authorization"),
    edge: request.headers.get("x-kp-edge-proxy"),
    edgeOrigin: request.headers.get("x-kp-edge-origin"),
    body: request.method === "POST" ? await request.text() : "",
  });
  return new Response("proxied", { status: 202, headers: { "x-authority": "vx" } });
};

try {
  const env = {
    FEDERATED_CORE_ORIGIN: "https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev",
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("https://kuchupuchu-api.kuchupuchu.workers.dev/api/conversations?marker=m1", {
      method: "POST",
      headers: { authorization: "Bearer session", "content-type": "application/json" },
      body: '{"request":true}',
    }),
    env,
    ctx,
  );
  check(
    "configured KP edge forwards method, path, query, bearer and body to the VX authority",
    response.status === 202 &&
      response.headers.get("x-authority") === "vx" &&
      calls.length === 1 &&
      calls[0].url ===
        "https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev/api/conversations?marker=m1" &&
      calls[0].method === "POST" &&
      calls[0].auth === "Bearer session" &&
      calls[0].body === '{"request":true}',
  );
  check(
    "forward carries bounded edge provenance without exposing a secret",
    calls[0].edge === "v1" &&
      calls[0].edgeOrigin === "https://kuchupuchu-api.kuchupuchu.workers.dev",
  );

  const bad = await worker.fetch(
    new Request("https://kuchupuchu-api.kuchupuchu.workers.dev/api/health"),
    { FEDERATED_CORE_ORIGIN: "http://not-secure.example" },
    ctx,
  );
  check(
    "an insecure or malformed authority fails closed before fetch",
    bad.status === 503 && calls.length === 1,
  );

  const loop = await worker.fetch(
    new Request("https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev/api/health"),
    env,
    ctx,
  );
  check(
    "a self-targeting authority is rejected as a loop",
    loop.status === 508 && calls.length === 1,
  );

  let dbTouched = false;
  await worker.scheduled(
    {},
    {
      ...env,
      DB: new Proxy(
        {},
        {
          get() {
            dbTouched = true;
            throw new Error("legacy DB touched");
          },
        },
      ),
    },
    ctx,
  );
  check("the KP proxy cron never mutates its frozen legacy D1", dbTouched === false);
} finally {
  globalThis.fetch = realFetch;
}

console.log("\n[101] Federated two-account edge proxy");
for (const line of lines) console.log(line);
process.exit(lines.some((line) => line.includes("BROKEN")) ? 1 : 0);
