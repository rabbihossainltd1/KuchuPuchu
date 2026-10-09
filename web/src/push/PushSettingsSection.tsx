/**
 * The Notifications settings card (slice H). One card, fully labelled, and
 * every state says the truth: which piece is missing when push cannot work,
 * what a notification here IS (a doorbell, never a preview), and that
 * delivery is best-effort. No icon-only buttons, no dead controls.
 */

import type { ApiClient } from "../auth/authApi";
import { PUSH_COPY } from "./pushModel";
import { usePushSettings } from "./usePushSettings";

export function PushSettingsSection({ api }: { readonly api: ApiClient }) {
  const { state, optIn, optOut } = usePushSettings(api);
  const { phase, busy, error, subscriptions, activeEndpoint } = state;

  return (
    <section className="settings-card settings-card--wide" aria-labelledby="push-heading">
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">{PUSH_COPY.eyebrow}</p>
          <h2 id="push-heading">{PUSH_COPY.heading}</h2>
        </div>
      </div>

      {phase === "loading" ? (
        <p className="settings-empty" role="status">
          Checking notification support…
        </p>
      ) : (
        <>
          {phase === "unsupported-browser" ? (
            <p className="settings-footnote">{PUSH_COPY.unsupportedBrowser}</p>
          ) : null}
          {phase === "unsupported-server" ? (
            <p className="settings-footnote">{PUSH_COPY.unsupportedServer}</p>
          ) : null}
          {phase === "permission-denied" ? (
            <p className="settings-footnote" role="alert">
              {PUSH_COPY.permissionDenied}
            </p>
          ) : null}

          {(phase === "ready" || phase === "active" || phase === "permission-denied") && (
            <div className="push-settings__row">
              {phase === "active" ? (
                <>
                  <p className="push-settings__status" role="status">
                    {PUSH_COPY.on}
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void optOut()}
                    disabled={busy !== null}
                  >
                    {busy === "off" ? PUSH_COPY.optOutBusy : PUSH_COPY.optOut}
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void optIn()}
                  disabled={busy !== null || phase === "permission-denied"}
                >
                  {busy === "on" ? PUSH_COPY.optInBusy : PUSH_COPY.optIn}
                </button>
              )}
            </div>
          )}

          {phase === "active" && subscriptions.length > 0 ? (
            <ul className="device-list" aria-label="Registered browsers">
              {subscriptions.map((subscription) => (
                <li className="device-row" key={subscription.endpoint}>
                  <div className="device-row__main">
                    <div className="device-row__title">
                      <strong>{PUSH_COPY.thisBrowser}</strong>
                      {subscription.endpoint === activeEndpoint && (
                        <span className="current-device-badge">{PUSH_COPY.thisBrowser}</span>
                      )}
                    </div>
                    <p>
                      {PUSH_COPY.addedAt}{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(subscription.createdAt))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}

          <p className="settings-footnote">{PUSH_COPY.privacy}</p>
          <p className="settings-footnote">{PUSH_COPY.delivery}</p>
          <p className="settings-footnote">{PUSH_COPY.muted}</p>
        </>
      )}
    </section>
  );
}
