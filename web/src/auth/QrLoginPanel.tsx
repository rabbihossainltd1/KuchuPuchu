import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ApiError } from "../api";
import { useAuth } from "./AuthContext";
import { authApi, isSessionPayload, isTransientPollError } from "./authApi";

type Notice = { kind: "error" | "info"; text: string } | null;

const QR_POLL_MS = 2_000;
const QR_POLL_MAX_MS = 10_000;
// The Worker mints each token with a 2-minute TTL (QR_LOGIN_TTL_MS). Refresh
// a little early so a phone can never scan a code that dies mid-handshake.
const QR_REFRESH_MS = 100_000;

/**
 * Phase R9: the default Web login surface. WhatsApp-Web style — a phone
 * scans this and the browser is signed in the moment it polls again, no
 * approval tap required (that is the product decision: pointing the Android
 * scanner at this one code already is the consent). "Log in with phone
 * number" underneath is the fallback into the existing phone/OTP/Google flow.
 */
export function QrLoginPanel({ onUsePhone }: { onUsePhone: () => void }) {
  const { api, signIn } = useAuth();
  const [svg, setSvg] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Bumping this remounts the effect below with a brand-new token — either a
  // deliberate TTL-ahead refresh, or because the previous token died/was
  // rejected and a fresh one is the only way forward.
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;
    let refreshTimer = 0;
    let delay = QR_POLL_MS;
    const controller = new AbortController();

    const renderQr = async (token: string) => {
      try {
        const markup = await QRCode.toString(`kuchupuchu://weblogin/${token}`, {
          type: "svg",
          margin: 1,
          width: 240,
          color: { dark: "#0b1324", light: "#ffffff" },
        });
        if (!cancelled) setSvg(markup);
      } catch {
        if (!cancelled) {
          setNotice({ kind: "error", text: "The QR code could not be drawn. Try again." });
        }
      }
    };

    const poll = (token: string) => {
      if (cancelled) return;
      void (async () => {
        try {
          const result = await authApi.pollQrLogin(api, token, controller.signal);
          if (cancelled) return;
          if (result.status === "SESSION" && isSessionPayload(result)) {
            signIn({ token: result.token, user: result.user, status: "SESSION" });
            return;
          }
          if (result.status === "EXPIRED" || result.status === "UNKNOWN") {
            setSvg(null);
            setCycle((n) => n + 1);
            return;
          }
          delay = QR_POLL_MS;
          pollTimer = window.setTimeout(() => poll(token), delay);
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          if (!isTransientPollError(error)) {
            setSvg(null);
            setCycle((n) => n + 1);
            return;
          }
          delay = Math.min(delay * 2, QR_POLL_MAX_MS);
          pollTimer = window.setTimeout(() => poll(token), delay);
        }
      })();
    };

    const start = async () => {
      setNotice(null);
      try {
        const started = await authApi.startQrLogin(api, controller.signal);
        if (cancelled) return;
        await renderQr(started.token);
        if (cancelled) return;
        pollTimer = window.setTimeout(() => poll(started.token), delay);
        refreshTimer = window.setTimeout(() => setCycle((n) => n + 1), QR_REFRESH_MS);
      } catch (error) {
        if (cancelled || (error instanceof ApiError && error.kind === "aborted")) return;
        setNotice({
          kind: "error",
          text: "The QR code could not be loaded. Check your connection and try again.",
        });
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(refreshTimer);
      controller.abort();
    };
  }, [api, signIn, cycle]);

  return (
    <div className="auth-form qr-login" aria-live="polite">
      {/*
        Owner round 34 (web): the "open the app and point it at this code" paragraph
        was removed — the heading ("Scan to sign in") and the code itself say
        everything that paragraph said, only in fewer words.
      */}
      <div className="qr-login__frame">
        {svg ? (
          <img
            className="qr-login__image"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
            alt="QR code to sign in to KuchuPuchu on this browser"
            width={220}
            height={220}
          />
        ) : (
          <p className="qr-login__placeholder" role="status">
            {notice?.kind === "error"
              ? "The QR code could not be loaded."
              : "Preparing your QR code…"}
          </p>
        )}
      </div>
      {notice && (
        <p
          className={`auth-notice auth-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setCycle((n) => n + 1);
          setSvg(null);
        }}
      >
        Refresh code
      </button>
      <button className="primary-button qr-login__phone-button" type="button" onClick={onUsePhone}>
        Log in with phone number
      </button>
    </div>
  );
}
