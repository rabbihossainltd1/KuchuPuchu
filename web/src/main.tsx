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
