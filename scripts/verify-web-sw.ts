import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const dist = resolve(process.cwd(), "web/dist");
const workerPath = join(dist, "sw.js");
const indexPath = join(dist, "index.html");
assert.ok(existsSync(workerPath), "Vite build must emit web/dist/sw.js");
assert.ok(existsSync(indexPath), "Vite build must emit web/dist/index.html");

const worker = readFileSync(workerPath, "utf8");
const html = readFileSync(indexPath, "utf8");
const buildId = worker.match(/const BUILD_ID = "([a-f0-9]{16})";/)?.[1];
assert.ok(buildId, "service worker must contain a generated 16-character build id");
assert.ok(worker.includes(`const BUILD_ID = "${buildId}";`));
assert.ok(worker.includes('const CACHE_PREFIX = "kp-web-shell-";'));
assert.ok(worker.includes("const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;"));

const precacheText = worker.match(/const PRECACHE_URLS = (\[[^;]*\]);/)?.[1];
assert.ok(precacheText, "service worker must contain its generated precache manifest");
const precache = JSON.parse(precacheText) as string[];
assert.ok(precache.includes("/index.html"), "precache must include the app shell");
assert.ok(precache.length >= 3, "precache must include HTML, JavaScript, and CSS assets");
assert.ok(precache.every((url) => url.startsWith("/") && !url.includes("..")));
assert.ok(precache.every((url) => !/\.(?:map)(?:$|\?)/i.test(url)));
assert.ok(precache.every((url) => !/^\/(?:api|ws)(?:\/|$)/.test(url)));
assert.ok(
  precache.every((url) => url === "/index.html" || /\.(?:js|css)$/i.test(url)),
  "only the app shell, JavaScript, and CSS may be cached; media stays network-only",
);

for (const url of precache) {
  assert.ok(existsSync(join(dist, url.slice(1))), `precache asset is missing: ${url}`);
}

const referencedAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
  (match) => match[1]!,
);
assert.ok(
  referencedAssets.some((url) => url.endsWith(".js")),
  "HTML must reference its JS bundle",
);
assert.ok(
  referencedAssets.some((url) => url.endsWith(".css")),
  "HTML must reference its CSS bundle",
);
assert.ok(referencedAssets.every((url) => precache.includes(url)));

const bundles = readdirSync(join(dist, "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(join(dist, "assets", name), "utf8"));
assert.ok(
  bundles.some((bundle) => bundle.includes("serviceWorker") && bundle.includes("/sw.js")),
  "production Web entry must register the generated service worker",
);

assert.ok(worker.includes("url.origin !== self.location.origin"));
assert.ok(worker.includes("API_OR_WS_PATH.test(url.pathname)"));
assert.ok(worker.includes('request.headers.has("authorization")'));

// Slice H doorbell: the push handler must stay GENERIC (no message content is
// even available to it) and the click must route through the app's own
// sections. The copy is pinned against web/src/push/pushModel.ts — contract
// case 77 pins the same strings from the model side.
assert.ok(worker.includes('self.addEventListener("push"'), "service worker must handle push");
assert.ok(
  worker.includes('self.addEventListener("notificationclick"'),
  "service worker must route notification clicks",
);
assert.ok(
  worker.includes("Call activity on KuchuPuchu — open the app to check."),
  "the call doorbell copy must stay generic and exact",
);
assert.ok(
  worker.includes("New message activity on KuchuPuchu — open the app to check."),
  "the message doorbell copy must stay generic and exact",
);
assert.ok(worker.includes('tag: kind === "kp.call" ? "kp-call" : "kp-msg"'));
assert.ok(worker.includes('{ type: "kp-push-nav", path: target }'));
assert.ok(
  worker.includes('self.registration.showNotification("KuchuPuchu"'),
  "the knock is shown under the app name only",
);
assert.ok(
  (worker.match(/showNotification/g) ?? []).length === 1,
  "exactly one notification call: the doorbell, nowhere else",
);
assert.ok(worker.includes('credentials: "omit"'));
assert.ok(worker.includes("key.startsWith(CACHE_PREFIX)"));
assert.ok(!worker.includes("skipWaiting"), "updates must wait for existing clients to close");

// Execute the generated worker with small CacheStorage/Fetch fakes so privacy,
// activation, cache-miss, and offline-navigation paths are tested, not just grepped.
type TestResponse = {
  ok: boolean;
  type: string;
  clone: () => TestResponse;
  text: () => Promise<string>;
};

function response(body: string): TestResponse {
  return {
    ok: true,
    type: "basic",
    clone: () => response(body),
    text: async () => body,
  };
}

const origin = "https://web.example.test";
class MemoryCache {
  readonly entries = new Map<string, TestResponse>();
  addAllRequests: Request[] = [];
  putRequests: Request[] = [];

  private key(input: string | Request): string {
    return typeof input === "string" ? new URL(input, origin).href : input.url;
  }

  async addAll(requests: Request[]): Promise<void> {
    this.addAllRequests = requests;
    for (const request of requests) {
      this.entries.set(this.key(request), response(`cached:${new URL(request.url).pathname}`));
    }
  }

  async match(input: string | Request): Promise<TestResponse | undefined> {
    return this.entries.get(this.key(input))?.clone();
  }

  async put(input: Request, value: TestResponse): Promise<void> {
    this.putRequests.push(input);
    this.entries.set(this.key(input), value.clone());
  }
}

const cacheStores = new Map<string, MemoryCache>();
const cacheStorage = {
  async open(name: string): Promise<MemoryCache> {
    let cache = cacheStores.get(name);
    if (!cache) {
      cache = new MemoryCache();
      cacheStores.set(name, cache);
    }
    return cache;
  },
  async keys(): Promise<string[]> {
    return [...cacheStores.keys()];
  },
  async delete(name: string): Promise<boolean> {
    return cacheStores.delete(name);
  },
};

const handlers = new Map<string, (event: any) => void>();
let clientsClaimed = false;
const workerSelf = {
  location: { origin },
  clients: {
    async claim(): Promise<void> {
      clientsClaimed = true;
    },
  },
  addEventListener(type: string, handler: (event: any) => void): void {
    handlers.set(type, handler);
  },
};
const networkRequests: unknown[] = [];
let networkOffline = false;
const fetchMock = async (input: unknown): Promise<TestResponse> => {
  networkRequests.push(input);
  if (networkOffline) throw new TypeError("network unavailable");
  const url =
    input instanceof Request
      ? input.url
      : typeof input === "string"
        ? input
        : (input as { url: string }).url;
  return response(`network:${new URL(url).pathname}`);
};

runInNewContext(worker, {
  self: workerSelf,
  caches: cacheStorage,
  Request,
  URL,
  Headers,
  Response,
  fetch: fetchMock,
});

const currentCacheName = `kp-web-shell-${buildId}`;
await cacheStorage.open("kp-shell-v1");
await cacheStorage.open("kp-web-shell-obsolete");
await cacheStorage.open("another-app-cache");

let installPromise: Promise<unknown> | undefined;
handlers.get("install")!({
  waitUntil(promise: Promise<unknown>): void {
    installPromise = promise;
  },
});
assert.ok(installPromise, "install must wait for precache completion");
await installPromise;

const currentCache = cacheStores.get(currentCacheName);
assert.ok(currentCache, "install must create a build-scoped cache");
assert.equal(currentCache.addAllRequests.length, precache.length);
assert.ok(
  currentCache.addAllRequests.every(
    (request) => request.credentials === "omit" && request.cache === "reload",
  ),
  "precache fetches must omit cookie credentials and bypass the HTTP cache",
);

let activationPromise: Promise<unknown> | undefined;
handlers.get("activate")!({
  waitUntil(promise: Promise<unknown>): void {
    activationPromise = promise;
  },
});
assert.ok(activationPromise, "activate must wait for cache cleanup and client claim");
await activationPromise;
assert.ok(!cacheStores.has("kp-web-shell-obsolete"), "activation must remove stale Web caches");
assert.ok(cacheStores.has("kp-shell-v1"), "activation must preserve the existing public PWA cache");
assert.ok(cacheStores.has("another-app-cache"), "activation must preserve unrelated caches");
assert.ok(clientsClaimed, "activation must claim eligible clients");

async function dispatchFetch(request: unknown): Promise<{
  handled: boolean;
  result?: TestResponse;
}> {
  let resultPromise: Promise<TestResponse> | undefined;
  handlers.get("fetch")!({
    request,
    respondWith(value: Promise<TestResponse> | TestResponse): void {
      resultPromise = Promise.resolve(value);
    },
  });
  return resultPromise ? { handled: true, result: await resultPromise } : { handled: false };
}

const jsUrl = precache.find((url) => url.endsWith(".js"))!;
const cssUrl = precache.find((url) => url.endsWith(".css"))!;
const staticRequest = await dispatchFetch(new Request(new URL(jsUrl, origin)));
assert.ok(staticRequest.handled);
assert.equal(await staticRequest.result?.text(), `cached:${jsUrl}`);
assert.equal(networkRequests.length, 0, "pre-cached JS must be served without network access");

const bypassRequests = [
  new Request(`${origin}/api/profile`),
  new Request(`${origin}/ws/socket`),
  new Request(`${origin}/live/events`),
  new Request(`${origin}/media/private-video.mp4`),
  new Request(`https://cdn.example.test/assets/video.mp4`),
  new Request(new URL(jsUrl, origin), { headers: { authorization: "x" } }),
  new Request(new URL(jsUrl, origin), { cache: "no-store" }),
  new Request(new URL(`${jsUrl}?user=1`, origin)),
  new Request(`${origin}/api/messages`, { method: "POST" }),
];
for (const request of bypassRequests) {
  const result = await dispatchFetch(request);
  assert.ok(!result.handled, `${request.method} ${request.url} must bypass the worker cache`);
}
assert.equal(networkRequests.length, 0, "bypassed requests must remain untouched by the worker");

const writesBeforeNavigation = currentCache.putRequests.length;
const navigation = (path: string) => ({
  url: `${origin}${path}`,
  method: "GET",
  mode: "navigate",
  headers: new Headers(),
  cache: "default",
});
const onlineNavigation = await dispatchFetch(navigation("/chats/deep-link"));
assert.equal(await onlineNavigation.result?.text(), "network:/chats/deep-link");
assert.equal(currentCache.putRequests.length, writesBeforeNavigation);

networkOffline = true;
const offlineNavigation = await dispatchFetch(navigation("/calls"));
assert.equal(await offlineNavigation.result?.text(), "cached:/index.html");
assert.equal(currentCache.putRequests.length, writesBeforeNavigation);
networkOffline = false;

currentCache.entries.delete(new URL(cssUrl, origin).href);
const cacheMiss = await dispatchFetch(new Request(new URL(cssUrl, origin)));
assert.equal(await cacheMiss.result?.text(), `network:${cssUrl}`);
const cacheMissFetch = networkRequests.at(-1);
assert.ok(cacheMissFetch instanceof Request);
assert.equal(cacheMissFetch.credentials, "omit");
assert.equal(cacheMissFetch.cache, "reload");
assert.equal(currentCache.putRequests.length, writesBeforeNavigation + 1);

console.log(
  `Web service worker verified (build ${buildId}, ${precache.length} precached files; runtime privacy/offline checks passed).`,
);
