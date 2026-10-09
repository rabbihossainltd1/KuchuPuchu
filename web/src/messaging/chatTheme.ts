/* Slice I (chat-theme parity): the five per-chat themes, ported value-for-value
 * from ChatScreen.kt (owner rounds 14/19/20) so the two clients can never
 * drift: `chatWallpaper()`, `chatAccent()`, `chatMineFill()`, `chatOtherFill()`
 * plus the night theme's dark other-bubble inks (lines ~8410).
 *
 * A chat WITHOUT a theme is `darkblue`; `default` is the explicit classic-cream
 * option — exactly Android's `cTheme()`. Every mint/rose/night surface has a
 * dark AND a light variant keyed on the app-wide appearance, because Android
 * keys them on KpThemeMode.darkBlue.
 */

import type { AppTheme } from "../theme/appTheme";

export const CHAT_THEMES = ["darkblue", "default", "mint", "rose", "night"] as const;
export type ChatTheme = (typeof CHAT_THEMES)[number];

export const DEFAULT_CHAT_THEME: ChatTheme = "darkblue";

export function isChatTheme(value: unknown): value is ChatTheme {
  return typeof value === "string" && (CHAT_THEMES as readonly string[]).includes(value);
}

/** Normalise a server/theme-picker value the way Android's cTheme() does. */
export function chatThemeOr(value: string | null | undefined): ChatTheme {
  return isChatTheme(value) ? value : DEFAULT_CHAT_THEME;
}

export type ChatThemeStyle = Readonly<{
  /** Chat wallpaper behind the transcript. */
  wallpaper: string;
  /** Composer / action accent for this chat. */
  accent: string;
  /** Own bubble gradient endpoints. */
  mineFrom: string;
  mineTo: string;
  /** Own-bubble text. */
  mineInk: string;
  /** The other side's bubble fill. */
  other: string;
  /** Text on the other side's bubble. */
  otherInk: string;
  /** Muted stamps on the other side's bubble. */
  otherMuted: string;
}>;

function wallpaper(theme: ChatTheme, darkBlue: boolean): string {
  switch (theme) {
    case "mint":
      return darkBlue ? "#0c1a15" : "#ecfdf5";
    case "night":
      return "#0b1220";
    case "rose":
      return darkBlue ? "#23141a" : "#fff1f2";
    case "default":
      return darkBlue ? "#0d1524" : "#f7f6f4"; // the app's Cream
    default:
      return "#0d1524";
  }
}

function accent(theme: ChatTheme): string {
  switch (theme) {
    case "mint":
      return "#10b981";
    case "rose":
      return "#f43f5e";
    case "night":
      return "#818cf8";
    case "default":
      return "#f59e0b"; // Gold
    default:
      return "#2f6fed";
  }
}

function mineFill(theme: ChatTheme): [string, string] {
  switch (theme) {
    case "mint":
      return ["#34d399", "#059669"];
    case "rose":
      return ["#fb7185", "#e11d48"];
    case "night":
      return ["#818cf8", "#4f46e5"];
    case "default":
      return ["#f59e0b", "#f5a623"]; // goldFill(): Gold → GoldDeep
    default:
      return ["#2f6fed", "#1e40af"];
  }
}

function otherFill(theme: ChatTheme, darkBlue: boolean): string {
  switch (theme) {
    case "mint":
      return darkBlue ? "#14261f" : "#e7f8f0";
    case "rose":
      return darkBlue ? "#2a1a21" : "#ffe9ec";
    case "night":
      return "#1e293b";
    case "default":
      return darkBlue ? "#16213a" : "#ffffff"; // Card
    default:
      return "#16213a";
  }
}

/**
 * Owner round 15: the night theme's OTHER bubble is dark in BOTH app modes, so
 * its ink is fixed light (#E6EAF2 primary, #A9B4CC muted) instead of floating
 * with the appearance theme. Every other fill follows the appearance.
 */
function otherInks(theme: ChatTheme, darkBlue: boolean): { ink: string; muted: string } {
  if (theme === "night") return { ink: "#e6eaf2", muted: "#a9b4cc" };
  if (theme === "mint")
    return darkBlue ? { ink: "#e9edf6", muted: "#8a97b2" } : { ink: "#14332a", muted: "#3f6f5e" };
  if (theme === "rose")
    return darkBlue ? { ink: "#e9edf6", muted: "#8a97b2" } : { ink: "#4c1220", muted: "#94505f" };
  if (theme === "default")
    return darkBlue ? { ink: "#e9edf6", muted: "#8a97b2" } : { ink: "#1c1917", muted: "#7a6f63" };
  return { ink: "#e9edf6", muted: "#8a97b2" };
}

export function chatThemeStyle(theme: ChatTheme, appTheme: AppTheme): ChatThemeStyle {
  const darkBlue = appTheme === "dark_blue";
  const [mineFrom, mineTo] = mineFill(theme);
  const inks = otherInks(theme, darkBlue);
  // Gold bubbles (the `default` theme) carry the near-white AmberInk, exactly
  // like Android; every other own-bubble gradient carries white.
  const mineInk = theme === "default" ? "#fffbeb" : "#ffffff";
  return {
    wallpaper: wallpaper(theme, darkBlue),
    accent: accent(theme),
    mineFrom,
    mineTo,
    mineInk,
    other: otherFill(theme, darkBlue),
    otherInk: inks.ink,
    otherMuted: inks.muted,
  };
}

/** Inline CSS custom properties for the chat root element. */
export function chatThemeCssVars(style: ChatThemeStyle): Record<string, string> {
  return {
    "--chat-wallpaper": style.wallpaper,
    "--chat-accent": style.accent,
    "--chat-mine-from": style.mineFrom,
    "--chat-mine-to": style.mineTo,
    "--chat-mine-ink": style.mineInk,
    "--chat-other": style.other,
    "--chat-other-ink": style.otherInk,
    "--chat-other-muted": style.otherMuted,
  };
}

export const CHAT_THEME_LABELS: ReadonlyArray<{ value: ChatTheme; label: string; bangla: string }> =
  [
    { value: "darkblue", label: "Dark Blue", bangla: "ডার্ক ব্লু" },
    { value: "default", label: "Classic Cream", bangla: "ক্লাসিক ক্রিম" },
    { value: "mint", label: "Mint", bangla: "মিন্ট" },
    { value: "rose", label: "Rose", bangla: "রোজ" },
    { value: "night", label: "Night", bangla: "নাইট" },
  ];
