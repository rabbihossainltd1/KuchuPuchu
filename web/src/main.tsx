import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { isWebFeatureEnabled } from "./featureFlags";
import "./styles.css";
import "./auth/authStyles.css";

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
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The service worker is a progressive enhancement; the app still works online without it.
    });
  };

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}
