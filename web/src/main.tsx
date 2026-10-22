import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { isWebFeatureEnabled } from "./featureFlags";
import "./styles.css";
import "./auth/authStyles.css";
import { initAppTheme } from "./theme/appTheme";

// Slice I: apply the stored appearance BEFORE the first paint so a light-theme
// user never sees a dark flash (the phone recreates the activity on switch;
// the web equivalent is one attribute set before React mounts).
initAppTheme();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing Web app root element.");
}

createRoot(root).render(
  <React.StrictMode>
    <AuthProvider enabled={isWebFeatureEnabled("accountIntegration")}>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

if (import.meta.env.PROD && isWebFeatureEnabled("serviceWorker") && "serviceWorker" in navigator) {
  const registerServiceWorker = () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        /* Owner round 120 (2026-10-21): "kichu fix korleo browser a dekhai
         * na" — a new worker used to install only on the next net-flip and
         * ACTIVATE only after the last tab closed, so an always-open tab
         * kept the previous shell. We now ask the browser to fetch a fresh
         * sw.js on every app open, every 15 minutes the tab stays open, and
         * whenever the tab returns to the foreground; activation still waits
         * for tab close by design (no mid-session reloads, existing pin),
         * but the newest sw.js and precache are never more than 15 min old
         * and the user is a closer-open cycle away from them. */
        const poke = () => registration.update().catch(() => {});
        poke();
        window.setInterval(poke, 15 * 60_000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") poke();
        });
        /* Owner round 122 (2026-10-22): poking alone never rescued him — his
         * pinned Brave tab kept serving the OLD build for days, so every
         * shipped fix echoed back as "not fixed". When a newer worker is
         * installed-but-waiting the app now shows a small refresh chip —
         * all positions/colours INLINE because a stale tab by definition
         * also serves stale CSS. A tap tells the waiting worker to skip
         * waiting; the controllerchange then reloads once. No automatic
         * reloads, the round-120 pin stands: the refresh happens only when
         * HE presses the button. */
        const showRefreshChip = (waiting: ServiceWorker | null) => {
          if (!waiting || document.getElementById("kp-update-chip")) return;
          const chip = document.createElement("div");
          chip.id = "kp-update-chip";
          chip.style.cssText =
            "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
            "z-index:2147483647;display:flex;gap:10px;align-items:center;" +
            "background:#0f6fdc;color:#fff;padding:10px 14px;border-radius:999px;" +
            "font:500 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:92vw";
          const text = document.createElement("span");
          text.textContent = "A newer KuchuPuchu Web is ready.";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "Refresh";
          btn.style.cssText =
            "background:#fff;color:#0f6fdc;border:0;border-radius:999px;" +
            "padding:6px 14px;font:600 13px system-ui,sans-serif;cursor:pointer";
          btn.addEventListener("click", () => {
            let reloaded = false;
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              if (reloaded) return;
              reloaded = true;
              window.location.reload();
            });
            waiting.postMessage({ type: "KP_SKIP_WAITING" });
            btn.textContent = "Refreshing…";
          });
          chip.append(text, btn);
          document.body.appendChild(chip);
        };
        navigator.serviceWorker.ready
          .then((reg) => {
            if (reg.waiting && navigator.serviceWorker.controller) {
              showRefreshChip(reg.waiting);
            }
          })
          .catch(() => {});
        registration.addEventListener("updatefound", () => {
          const next = registration.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              showRefreshChip(registration.waiting);
            }
          });
        });
      })
      .catch(() => {
        // The service worker is a progressive enhancement; the app still works online without it.
      });
  };

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}
