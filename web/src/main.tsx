import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing Web app root element.");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
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
