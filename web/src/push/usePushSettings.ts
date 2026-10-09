/**
 * The settings-side state machine for the browser doorbell (slice H).
 *
 * Opt-in is three steps that can each fail in their own way, and the screen
 * has to say WHICH one did: the browser permission, the PushManager
 * subscription, or the server registration. Opt-out runs the same chain in
 * reverse and tolerates a subscription the server already forgot.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { PUSH_COPY, pushRuntimeCapability, type PushRuntimeCapability } from "./pushModel";
import { pushApi, urlBase64ToBytes, type PushConfig } from "./pushApi";

export type PushSettingsPhase =
  | "loading"
  | "unsupported-browser"
  | "unsupported-server"
  | "permission-denied"
  | "ready"
  | "active";

export type PushSettingsState = {
  readonly phase: PushSettingsPhase;
  readonly capability: PushRuntimeCapability;
  readonly busy: "on" | "off" | null;
  readonly error: string;
  readonly subscriptions: readonly { endpoint: string; createdAt: string }[];
  readonly activeEndpoint: string;
};

export type PushSettings = {
  readonly state: PushSettingsState;
  readonly optIn: () => Promise<void>;
  readonly optOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

function permissionDeniedHere(): boolean {
  return typeof Notification === "function" && Notification.permission === "denied";
}

export function usePushSettings(api: ApiClient): PushSettings {
  const capability = pushRuntimeCapability({
    serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
    PushManager: typeof window !== "undefined" ? window.PushManager : undefined,
    Notification: typeof window !== "undefined" ? window.Notification : undefined,
  });

  const [state, setState] = useState<PushSettingsState>({
    phase: "loading",
    capability,
    busy: null,
    error: "",
    subscriptions: [],
    activeEndpoint: "",
  });
  const live = useRef(true);

  const refresh = useCallback(async () => {
    if (!capability.supported) {
      setState((previous) => ({ ...previous, phase: "unsupported-browser" }));
      return;
    }
    try {
      const config: PushConfig = await pushApi.config(api);
      if (!live.current) return;
      if (!config.supported || !config.publicKey) {
        setState((previous) => ({ ...previous, phase: "unsupported-server", error: "" }));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const local = await registration.pushManager.getSubscription();
      if (permissionDeniedHere() && !local) {
        setState((previous) => ({ ...previous, phase: "permission-denied", error: "" }));
        return;
      }
      setState((previous) => ({
        ...previous,
        phase: local ? "active" : "ready",
        activeEndpoint: local?.endpoint ?? "",
        subscriptions: [...config.subscriptions],
        error: "",
      }));
    } catch {
      if (!live.current) return;
      setState((previous) => ({ ...previous, phase: "ready", error: PUSH_COPY.errorGeneric }));
    }
  }, [api, capability.supported]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);

  const optIn = useCallback(async () => {
    setState((previous) => ({ ...previous, busy: "on", error: "" }));
    try {
      const config = await pushApi.config(api);
      if (!config.supported || !config.publicKey) {
        setState((previous) => ({ ...previous, busy: null, phase: "unsupported-server" }));
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((previous) => ({ ...previous, busy: null, phase: "permission-denied" }));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(config.publicKey),
      });
      const json = subscription.toJSON();
      await pushApi.subscribe(api, {
        endpoint: json.endpoint ?? "",
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      if (!live.current) return;
      await refresh();
      setState((previous) => ({ ...previous, busy: null }));
    } catch (error) {
      if (!live.current) return;
      const name = (error as { name?: string } | null)?.name;
      setState((previous) => ({
        ...previous,
        busy: null,
        phase: name === "NotAllowedError" ? "permission-denied" : previous.phase,
        error: name === "NotAllowedError" ? "" : PUSH_COPY.errorGeneric,
      }));
    }
  }, [api, refresh]);

  const optOut = useCallback(async () => {
    setState((previous) => ({ ...previous, busy: "off", error: "" }));
    const endpoint = state.activeEndpoint;
    try {
      const registration = await navigator.serviceWorker.ready;
      const local = await registration.pushManager.getSubscription();
      if (local) await local.unsubscribe().catch(() => undefined);
      const target = endpoint || local?.endpoint || "";
      if (target) {
        // A 404 here just means the server already forgot — the local
        // unsubscribe above is the half that matters for this browser.
        await pushApi.unsubscribe(api, target).catch(() => undefined);
      }
      if (!live.current) return;
      await refresh();
      setState((previous) => ({ ...previous, busy: null }));
    } catch {
      if (!live.current) return;
      setState((previous) => ({ ...previous, busy: null, error: PUSH_COPY.errorGeneric }));
    }
  }, [api, refresh, state.activeEndpoint]);

  return { state, optIn, optOut, refresh };
}
