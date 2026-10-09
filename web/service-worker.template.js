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

/* Slice H: the browser doorbell. The payload arrives GENERIC by server
   contract (a kind, nothing else — never message text, names or photos), so
   the notification this worker shows can only knock; the signed-in app loads
   the actual content after the click. The copy below is pinned against
   web/src/push/pushModel.ts by contract case 77 and verify-web-sw. */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = JSON.parse(event.data.text()) || {};
  } catch {
    payload = {};
  }
  const kind = payload.t === "kp.call" ? "kp.call" : "kp.msg";
  const silent = payload.s === 1;
  event.waitUntil(
    self.registration.showNotification("KuchuPuchu", {
      body:
        kind === "kp.call"
          ? "Call activity on KuchuPuchu — open the app to check."
          : "New message activity on KuchuPuchu — open the app to check.",
      tag: kind === "kp.call" ? "kp-call" : "kp-msg",
      renotify: true,
      silent: silent,
      data: { t: kind },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification.data && event.notification.data.t === "kp.call" ? "/calls" : "/chats";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const current = windows.find((client) => "focus" in client);
      if (current) {
        // The app owns the final navigation decision (the calls section only
        // exists in a calls-enabled build); the worker only hands over the
        // kind and the focus.
        current.postMessage({ type: "kp-push-nav", path: target });
        await current.focus();
        return;
      }
      await self.clients.openWindow(target);
    })(),
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
