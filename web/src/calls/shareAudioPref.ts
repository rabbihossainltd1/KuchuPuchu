/**
 * The "share audio via screen share" preference (Android's SettingsScreen
 * toggle of the same name). Device-local, exactly like the app theme: the
 * phone keeps it in SharedPreferences, the Web mirror keeps the SAME idea in
 * localStorage — two devices of one account may legitimately differ, and no
 * server round trip is involved.
 *
 * The engine reads it through its injected `CallStore` at share time; the
 * settings screen reads/writes it here. One key, one format, both sides.
 */

export const SHARE_AUDIO_STORE_KEY = "kp.calls.share_audio";

type PrefStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PrefStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readShareAudioPref(storage: PrefStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(SHARE_AUDIO_STORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShareAudioPref(
  on: boolean,
  storage: PrefStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(SHARE_AUDIO_STORE_KEY, on ? "1" : "0");
  } catch {
    // A blocked store keeps the old preference; the toggle itself still moves.
  }
}
