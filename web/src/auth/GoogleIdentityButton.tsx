import { useEffect, useRef, useState } from "react";

const GOOGLE_ID_SCRIPT = "https://accounts.google.com/gsi/client";

type CredentialResponse = { credential?: string };
type GoogleIdentityApi = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          theme: "outline";
          size: "large";
          shape: "pill";
          text: "continue_with";
          width: string;
        },
      ) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

function currentGoogleApi(): GoogleIdentityApi | null {
  return window.google?.accounts?.id ? window.google : null;
}

function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const current = currentGoogleApi();
  if (current) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>("script[data-kp-google-identity]");
    if (!script) {
      script = document.createElement("script");
      script.src = GOOGLE_ID_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.kpGoogleIdentity = "true";
      document.head.append(script);
    }

    let settled = false;
    const finish = (api: GoogleIdentityApi | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);
      if (api) {
        if (script) script.dataset.loaded = "true";
        resolve(api);
      } else {
        script?.remove();
        reject(new Error("Google sign-in could not be loaded."));
      }
    };
    const onLoad = () => finish(currentGoogleApi());
    const onError = () => finish(null);
    const timeout = window.setTimeout(() => finish(currentGoogleApi()), 12_000);

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (script.dataset.loaded === "true") finish(currentGoogleApi());
  });
}

export function GoogleIdentityButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef(onCredential);
  credentialRef.current = onCredential;
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setLoading(true);
    void loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !hostRef.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            if (response.credential) credentialRef.current(response.credential);
            else setLoadError(true);
          },
        });
        hostRef.current.replaceChildren();
        google.accounts.id.renderButton(hostRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: "320",
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      hostRef.current?.replaceChildren();
    };
  }, [clientId, retryKey]);

  return (
    <div className="google-action" aria-busy={loading}>
      {loading && (
        <p className="google-action__loading" role="status">
          Loading Google sign-in…
        </p>
      )}
      <div ref={hostRef} className="google-action__button" aria-label="Continue with Google" />
      {loadError && (
        <div className="google-action__error" role="alert">
          <p>Google sign-in is unavailable right now. Check your connection and try again.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            Retry Google sign-in
          </button>
        </div>
      )}
    </div>
  );
}
