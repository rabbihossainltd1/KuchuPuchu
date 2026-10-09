/* Slice I (appearance parity): the app-wide theme switch.
 *
 * Android persists the choice in SharedPreferences (`kp` / `app_theme`,
 * values `dark_blue` | `light`; KpThemeMode.load defaults to dark_blue) and
 * recreates the activity on change. The Web mirror keeps the same key and
 * values in localStorage and flips a single `data-kp-theme` attribute on
 * <html>, which re-points every token in tokens.css. There is deliberately no
 * server round trip: the phone treats the theme as device-local, so two
 * devices of one account may legitimately differ.
 */

export const APP_THEME_STORAGE_KEY = "kp.app_theme";
export const THEME_ATTRIBUTE = "data-kp-theme";

export type AppTheme = "dark_blue" | "light";

const VALID: readonly AppTheme[] = ["dark_blue", "light"];

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

/** The factory theme — Android's `KpThemeMode.darkBlue` starts true. */
export const DEFAULT_APP_THEME: AppTheme = "dark_blue";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ThemeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function storedAppTheme(storage: ThemeStorage | null = browserStorage()): AppTheme {
  try {
    const raw = storage?.getItem(APP_THEME_STORAGE_KEY);
    return isAppTheme(raw) ? raw : DEFAULT_APP_THEME;
  } catch {
    return DEFAULT_APP_THEME;
  }
}

export function persistAppTheme(
  theme: AppTheme,
  storage: ThemeStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(APP_THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked storage API must not break the live switch; the attribute
    // below still re-skins this session.
  }
}

export function applyAppTheme(
  theme: AppTheme,
  root: Pick<HTMLElement, "dataset"> = document.documentElement,
): void {
  // Keep the attribute value exactly equal to the stored value so tests and
  // CSS selectors can rely on `data-kp-theme="light"` verbatim.
  root.dataset.kpTheme = theme;
}

/** Read → apply in one call; safe to run before React mounts. */
export function initAppTheme(
  storage: ThemeStorage | null = browserStorage(),
  root: Pick<HTMLElement, "dataset"> = document.documentElement,
): AppTheme {
  const theme = storedAppTheme(storage);
  applyAppTheme(theme, root);
  return theme;
}

/* React binding ---------------------------------------------------------------- */

import { useSyncExternalStore } from "react";

function subscribeAppTheme(callback: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readDocumentTheme(): AppTheme {
  return document.documentElement.dataset.kpTheme === "light" ? "light" : DEFAULT_APP_THEME;
}

/** The live app theme, re-rendering subscribers when it flips. */
export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribeAppTheme, readDocumentTheme, () => DEFAULT_APP_THEME);
}
