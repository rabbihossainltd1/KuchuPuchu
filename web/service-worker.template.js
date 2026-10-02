/* Build-time generated app-shell worker. Placeholders are filled by Vite. */
"use strict";

const CACHE_PREFIX = "kp-web-shell-";
const BUILD_ID = "__BUILD_ID__";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const PRECACHE_URLS = __PRECACHE_URLS__;
const APP_SHELL = "/index.html";
const API_OR_WS_PATH = /^\/(?:api|ws)(?:\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(
        PRECACHE_URLS.map(
          (url) =>
            new Request(new URL(url, self.location.origin), {
              credentials: "omit",
              cache: "reload",
            }),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    API_OR_WS_PATH.test(url.pathname) ||
    request.headers.has("authorization") ||
    request.cache === "no-store"
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(APP_SHELL)) ?? Response.error();
      }),
    );
    return;
  }

  if (url.search || !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cacheableRequest = new Request(request, {
        credentials: "omit",
        cache: "reload",
      });
      const cached = await cache.match(cacheableRequest);
      if (cached) return cached;

      const response = await fetch(cacheableRequest);
      if (response.ok && response.type === "basic") {
        await cache.put(cacheableRequest, response.clone());
      }
      return response;
    })(),
  );
});
