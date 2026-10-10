/**
 * The Calls settings card (slice R). One device-local preference, exactly the
 * phone's "Share Audio Via Screen Share": the phone keeps it in
 * SharedPreferences, this mirror keeps it in localStorage under the SAME key
 * the call engine reads at the moment a share starts (`shareAudioPref.ts`).
 * The value never travels to the server — two devices of one account may
 * legitimately differ, the way the app theme does.
 */

import { useState } from "react";
import { Icon } from "../icons";
import { readShareAudioPref, writeShareAudioPref } from "./shareAudioPref";

export const CALL_SETTINGS_COPY = {
  eyebrow: "CALLS",
  heading: "Calls",
  shareAudio: "Share audio via screen share",
  shareAudioNote:
    "When you share your screen, the shared tab or window's sound is sent along with your voice. Whether the browser can capture that sound depends on the browser and the operating system.",
};

export function CallSettingsSection() {
  const [shareAudio, setShareAudio] = useState(() => readShareAudioPref());

  return (
    <section className="settings-card" aria-labelledby="calls-heading">
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">{CALL_SETTINGS_COPY.eyebrow}</p>
          <h2 id="calls-heading">{CALL_SETTINGS_COPY.heading}</h2>
        </div>
        <span className="settings-card__icon">
          <Icon name="phone" size={18} />
        </span>
      </div>
      <div className="privacy-list">
        <label className="privacy-row privacy-row--toggle">
          <span>{CALL_SETTINGS_COPY.shareAudio}</span>
          <input
            type="checkbox"
            checked={shareAudio}
            onChange={(event) => {
              setShareAudio(event.target.checked);
              writeShareAudioPref(event.target.checked);
            }}
          />
        </label>
      </div>
      <p className="field-help">{CALL_SETTINGS_COPY.shareAudioNote}</p>
    </section>
  );
}
