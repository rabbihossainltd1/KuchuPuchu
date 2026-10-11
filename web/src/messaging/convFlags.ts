/**
 * Slice AP — device-local conversation flags. The phone keeps pinned and
 * archived ids in `ScreenStore` (a file on the device, never sent to the
 * worker); the web keeps the same two sets in localStorage so a reload
 * restores them, exactly like reopening the app.
 */

import { useSyncExternalStore } from "react";

const KEY = "kp_web_conv_flags_v1";

export type ConvFlags = {
  readonly pinned: readonly string[];
  readonly archived: readonly string[];
};

function load(): ConvFlags {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { pinned?: unknown; archived?: unknown };
      return {
        pinned: Array.isArray(parsed.pinned)
          ? parsed.pinned.filter((item): item is string => typeof item === "string")
          : [],
        archived: Array.isArray(parsed.archived)
          ? parsed.archived.filter((item): item is string => typeof item === "string")
          : [],
      };
    }
  } catch {
    // Private mode etc. — flags live in memory for the session.
  }
  return { pinned: [], archived: [] };
}

let state: ConvFlags = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Memory-only is fine.
  }
}

function toggle(list: readonly string[], id: string, on: boolean): string[] {
  const has = list.includes(id);
  if (on && !has) return [...list, id];
  if (!on && has) return list.filter((item) => item !== id);
  return [...list];
}

/** The phone's `ScreenStore.setPinned`. */
export function setPinnedFlag(id: string, on: boolean): void {
  state = { ...state, pinned: toggle(state.pinned, id, on) };
  persist();
  listeners.forEach((listener) => listener());
}

/** The phone's archive / unarchive (swipe right in the main list). */
export function setArchivedFlag(id: string, on: boolean): void {
  state = { ...state, archived: toggle(state.archived, id, on) };
  persist();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConvFlags(): ConvFlags {
  return useSyncExternalStore(subscribe, () => state);
}
