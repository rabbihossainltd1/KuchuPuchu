/**
 * Slice I (appearance parity): the app-wide theme card. The phone's
 * Settings → Appearance flips `KpThemeMode` (dark_blue | light) and recreates
 * the activity; here the same two choices re-skin every token through the
 * `data-kp-theme` attribute. The choice is device-local on BOTH platforms —
 * the card says so, because users expect settings to sync until they are told
 * otherwise.
 */

import { useCallback } from "react";
import { applyAppTheme, persistAppTheme, useAppTheme, type AppTheme } from "./appTheme";

const OPTIONS: ReadonlyArray<{
  value: AppTheme;
  label: string;
  bangla: string;
  note: string;
}> = [
  {
    value: "dark_blue",
    label: "Dark Blue",
    bangla: "ডার্ক ব্লু",
    note: "The default KuchuPuchu look — deep navy surfaces, blue accents.",
  },
  {
    value: "light",
    label: "Light Cream",
    bangla: "লাইট ক্রিম",
    note: "The classic warm light look — cream surfaces, gold accents.",
  },
];

export function AppearanceSection() {
  const current = useAppTheme();

  const choose = useCallback((theme: AppTheme) => {
    persistAppTheme(theme);
    applyAppTheme(theme);
  }, []);

  return (
    <section className="settings-card" aria-labelledby="appearance-heading">
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">Appearance · থিম</p>
          <h2 id="appearance-heading">App theme</h2>
        </div>
      </div>

      <fieldset className="appearance-fieldset">
        <legend className="visually-hidden">Choose the app theme</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`appearance-option${current === option.value ? " is-selected" : ""}`}
          >
            <input
              type="radio"
              name="kp-appearance"
              value={option.value}
              checked={current === option.value}
              onChange={() => choose(option.value)}
            />
            <span
              className={`appearance-swatch appearance-swatch--${option.value}`}
              aria-hidden="true"
            />
            <span className="appearance-option__text">
              <span className="appearance-option__title">
                {option.label} · {option.bangla}
              </span>
              <span className="appearance-option__note">{option.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="settings-footnote">
        The theme is saved on this device only — the phone app keeps its own choice, exactly like
        Android.
      </p>
    </section>
  );
}
