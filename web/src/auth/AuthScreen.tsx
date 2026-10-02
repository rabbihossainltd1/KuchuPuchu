import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import countryData from "../../../public/countries.json";
import { ApiError } from "../api";
import { BrandMark } from "../icons";
import { useAuth } from "./AuthContext";
import { authApi, authErrorCopy, isSessionPayload, isTransientPollError } from "./authApi";
import { GoogleIdentityButton } from "./GoogleIdentityButton";
import { buildE164, validOtp, type PhoneCountry } from "./phone";

const countries = (countryData as PhoneCountry[])
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name));
const bangladesh = countries.find((country) => country.iso === "BD") ?? {
  iso: "BD",
  name: "Bangladesh",
  dial: "880",
};

export type AuthFlow =
  | { kind: "phone"; mode: "login" | "recovery" }
  | {
      kind: "approval";
      phone: string;
      requestId: string;
      expiresAt: string;
      otpAvailable: boolean;
      deviceGone: boolean;
    }
  | { kind: "google"; purpose: "bind" | "recovery"; phone: string };

type Notice = { kind: "error" | "success" | "info"; text: string } | null;

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 4)}••••${phone.slice(-3)}`;
}

function approvalTerminalCopy(status: string): string {
  switch (status) {
    case "DECLINED":
      return "The sign-in request was declined on another device.";
    case "CANCELLED":
      return "The sign-in request was cancelled.";
    case "EXPIRED":
      return "The approval request expired. Start again with your phone number.";
    default:
      return "This approval request is no longer available. Start again.";
  }
}

function expiredAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now() + 5 * 60 * 1000;
}

export function AuthScreen({ onBackToChats }: { onBackToChats: () => void }) {
  const { api, deviceId, signIn } = useAuth();
  const [flow, setFlow] = useState<AuthFlow>({ kind: "phone", mode: "login" });
  const [countryIso, setCountryIso] = useState(bangladesh.iso);
  const [phoneInput, setPhoneInput] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpLocked, setOtpLocked] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleConfigLoading, setGoogleConfigLoading] = useState(false);
  const [googleConfigFailed, setGoogleConfigFailed] = useState(false);
  const otpAttempted = useRef(false);
  const actionController = useRef<AbortController | null>(null);

  const selectedCountry = useMemo(
    () => countries.find((country) => country.iso === countryIso) ?? bangladesh,
    [countryIso],
  );

  useEffect(() => {
    return () => actionController.current?.abort();
  }, []);

  useEffect(() => {
    if (flow.kind !== "google") {
      setGoogleClientId(null);
      setGoogleConfigLoading(false);
      setGoogleConfigFailed(false);
      return;
    }

    const controller = new AbortController();
    setGoogleClientId(null);
    setGoogleConfigLoading(true);
    setGoogleConfigFailed(false);
    void authApi
      .getGoogleConfig(api, controller.signal)
      .then((config) => {
        if (controller.signal.aborted) return;
        setGoogleClientId(
          typeof config.googleWebClientId === "string" && config.googleWebClientId.trim()
            ? config.googleWebClientId.trim()
            : null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setGoogleConfigFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setGoogleConfigLoading(false);
      });

    return () => controller.abort();
  }, [api, flow.kind]);

  useEffect(() => {
    if (flow.kind !== "approval") return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    let delay = 3_000;
    const deadline = expiredAt(flow.expiresAt);
    const controller = new AbortController();

    const finishWithNotice = (copy: string) => {
      if (cancelled) return;
      setFlow({ kind: "phone", mode: "login" });
      setOtp("");
      setOtpLocked(false);
      setNotice({ kind: "error", text: copy });
    };

    const schedule = () => {
      if (cancelled) return;
      if (Date.now() >= deadline || attempts >= 100) {
        finishWithNotice("The approval request expired. Start again with your phone number.");
        return;
      }
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const result = await authApi.pollLogin(
          api,
          { requestId: flow.requestId, deviceId },
          controller.signal,
        );
        if (cancelled) return;
        if (result.status === "SESSION" && isSessionPayload(result)) {
          signIn({ token: result.token, user: result.user, status: "SESSION" });
          return;
        }
        if (
          result.status === "PENDING" ||
          result.status === "APPROVED" ||
          result.status === "OTP_LOCKED"
        ) {
          delay = 3_000;
          if (!otpAttempted.current) {
            setNotice({
              kind: "info",
              text:
                result.status === "APPROVED"
                  ? "Approved. Finishing sign-in securely…"
                  : result.status === "OTP_LOCKED"
                    ? "The code is locked; a signed-in device can still approve this request."
                    : "Waiting for approval from a signed-in KuchuPuchu device…",
            });
          }
          schedule();
          return;
        }
        finishWithNotice(approvalTerminalCopy(result.status));
      } catch (error) {
        if (
          cancelled ||
          controller.signal.aborted ||
          (error instanceof ApiError && error.kind === "aborted")
        )
          return;
        if (!isTransientPollError(error)) {
          finishWithNotice(authErrorCopy(error));
          return;
        }
        delay = Math.min(Math.max(delay, 3_000) * 2, 15_000);
        setNotice({
          kind: "info",
          text: "Connection interrupted. The approval check will retry automatically.",
        });
        schedule();
      }
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    api,
    deviceId,
    flow.kind,
    flow.kind === "approval" ? flow.requestId : "",
    flow.kind === "approval" ? flow.expiresAt : "",
    signIn,
  ]);

  function startAction(): AbortController {
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    return controller;
  }

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || flow.kind !== "phone") return;
    const phone = buildE164(phoneInput, selectedCountry);
    if (!phone) {
      setNotice({
        kind: "error",
        text:
          selectedCountry.iso === "BD"
            ? "Enter a valid Bangladesh mobile number, for example 01712345678."
            : "Enter a valid phone number for the selected country.",
      });
      return;
    }

    const controller = startAction();
    setBusy(true);
    setNotice({
      kind: "info",
      text: flow.mode === "recovery" ? "Checking recovery options…" : "Checking this number…",
    });
    try {
      if (flow.mode === "recovery") {
        const lookup = await authApi.lookupRecovery(api, { phone }, controller.signal);
        if (!lookup.exists) {
          setNotice({
            kind: "error",
            text: "No recoverable account was found for that number. Check the number or start a new sign-in.",
          });
          return;
        }
        setFlow({ kind: "google", purpose: "recovery", phone });
        setNotice({
          kind: "info",
          text: "Verify with the Google account already linked to this KuchuPuchu account.",
        });
        return;
      }

      const result = await authApi.verifyPhone(
        api,
        {
          phone,
          // Browsers cannot read a SIM. Never claim Android SIM verification from Web.
          sim: "UNAVAILABLE",
          deviceId,
          deviceName: "Web browser",
          platform: "WEB",
        },
        controller.signal,
      );

      if (result.status === "SESSION" && isSessionPayload(result)) {
        signIn({ token: result.token, user: result.user, status: "SESSION" });
        return;
      }
      if (result.status === "ACCOUNT_CREATED" || result.status === "BIND_REQUIRED") {
        setFlow({ kind: "google", purpose: "bind", phone: result.phone || phone });
        setNotice({
          kind: "info",
          text:
            result.method === "DEVICE_ONLY"
              ? "This browser cannot verify a SIM. Finish setup by linking the Google account you control."
              : "Finish setting up this account by linking a Google account.",
        });
        return;
      }
      if (result.status === "APPROVAL_REQUIRED" && result.requestId) {
        otpAttempted.current = false;
        setOtp("");
        setOtpLocked(false);
        setFlow({
          kind: "approval",
          phone: result.phone || phone,
          requestId: result.requestId,
          expiresAt: result.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          otpAvailable: result.otpAvailable === true,
          deviceGone: result.deviceGone === true,
        });
        setNotice({
          kind: "info",
          text: "Approve this sign-in from another signed-in device, or enter the six-digit code shown on its approval card.",
        });
        return;
      }
      setNotice({
        kind: "error",
        text: "The sign-in response was incomplete. Please start again.",
      });
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: authErrorCopy(error) });
    } finally {
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || flow.kind !== "approval" || otpLocked) return;
    if (!validOtp(otp)) {
      setNotice({ kind: "error", text: "Enter the six-digit code from the approval card." });
      return;
    }

    otpAttempted.current = true;
    const controller = startAction();
    setBusy(true);
    setNotice({ kind: "info", text: "Checking the one-time code…" });
    try {
      const result = await authApi.submitOtp(
        api,
        { requestId: flow.requestId, deviceId, otp: otp.trim() },
        controller.signal,
      );
      if (result.status === "SESSION" && isSessionPayload(result)) {
        signIn({ token: result.token, user: result.user, status: "SESSION" });
        return;
      }
      if (result.status === "INVALID_CODE") {
        setOtp("");
        setNotice({
          kind: "error",
          text:
            typeof result.attemptsRemaining === "number"
              ? `That code is not correct. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? "" : "s"} remaining.`
              : "That code is not correct. Try again or use device approval.",
        });
        return;
      }
      if (result.status === "OTP_LOCKED") {
        setOtpLocked(true);
        setNotice({
          kind: "error",
          text: "Too many code attempts. The code is locked, but approval from another signed-in device can still finish sign-in.",
        });
        return;
      }
      if (result.status === "OTP_UNAVAILABLE") {
        setFlow({ ...flow, otpAvailable: false });
        setNotice({
          kind: "error",
          text: "Code sign-in is unavailable right now. Use approval from another signed-in device or account recovery if your device is lost.",
        });
        return;
      }
      finishApprovalLocally(approvalTerminalCopy(result.status));
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: authErrorCopy(error) });
    } finally {
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function finishApprovalLocally(copy: string) {
    otpAttempted.current = false;
    setFlow({ kind: "phone", mode: "login" });
    setOtp("");
    setOtpLocked(false);
    setNotice({ kind: "error", text: copy });
  }

  async function cancelApproval() {
    if (flow.kind !== "approval" || busy) return;
    const activeFlow = flow;
    const controller = startAction();
    setBusy(true);
    try {
      await authApi.cancelLogin(
        api,
        { requestId: activeFlow.requestId, deviceId },
        controller.signal,
      );
      finishApprovalLocally("The sign-in request was cancelled.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice({
          kind: "error",
          text: `${authErrorCopy(error)} You can still leave this screen.`,
        });
      }
    } finally {
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function submitGoogleCredential(credential: string) {
    if (busy || flow.kind !== "google") return;
    const activeFlow = flow;
    const controller = startAction();
    setBusy(true);
    setNotice({
      kind: "info",
      text:
        activeFlow.purpose === "bind"
          ? "Linking the Google account…"
          : "Verifying account recovery…",
    });
    try {
      if (activeFlow.purpose === "bind") {
        const result = await authApi.bindGoogle(
          api,
          {
            phone: activeFlow.phone,
            idToken: credential,
            deviceId,
            displayName: displayName.trim().slice(0, 40),
            platform: "WEB",
          },
          controller.signal,
        );
        if (result.status === "SESSION" && isSessionPayload(result)) {
          signIn({ token: result.token, user: result.user, status: "SESSION" });
          return;
        }
        setNotice({
          kind: "error",
          text: "The account could not be set up from that Google response. Start again.",
        });
        return;
      }

      const started = await authApi.startRecovery(
        api,
        { phone: activeFlow.phone, idToken: credential, deviceId, platform: "WEB" },
        controller.signal,
      );
      if (!started.requestId) {
        setNotice({ kind: "error", text: "The recovery request could not be started. Try again." });
        return;
      }
      const result = await authApi.completeRecovery(
        api,
        { requestId: started.requestId, deviceId },
        controller.signal,
      );
      if (isSessionPayload(result)) {
        signIn({ token: result.token, user: result.user, status: "SESSION" });
        return;
      }
      setNotice({ kind: "error", text: "Recovery could not be completed. Start again." });
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: authErrorCopy(error) });
    } finally {
      if (actionController.current === controller) actionController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function switchToRecovery() {
    setFlow({ kind: "phone", mode: "recovery" });
    setNotice({
      kind: "info",
      text: "Enter the phone number on the account, then verify its linked Google account.",
    });
  }

  function leaveAuth() {
    if (flow.kind === "approval") {
      void authApi.cancelLogin(api, { requestId: flow.requestId, deviceId }).catch(() => undefined);
    }
    onBackToChats();
  }

  function switchToPhone(mode: "login" | "recovery" = "login") {
    actionController.current?.abort();
    actionController.current = null;
    setBusy(false);
    otpAttempted.current = false;
    setOtp("");
    setOtpLocked(false);
    setFlow({ kind: "phone", mode });
    setNotice(null);
  }

  const isApproval = flow.kind === "approval";
  const isGoogle = flow.kind === "google";
  const isRecoveryEntry = flow.kind === "phone" && flow.mode === "recovery";

  return (
    <main className="auth-page">
      <div className="auth-background-glow auth-background-glow--blue" />
      <div className="auth-background-glow auth-background-glow--amber" />
      <section className="auth-card" aria-labelledby="auth-heading">
        <header className="auth-brand">
          <BrandMark size={46} />
          <div>
            <p className="eyebrow">KUCHUPUCHU WEB</p>
            <h1 id="auth-heading">
              {isApproval
                ? "Confirm this sign-in"
                : isGoogle
                  ? flow.purpose === "bind"
                    ? "Finish setting up"
                    : "Recover your account"
                  : isRecoveryEntry
                    ? "Recover your account"
                    : "Sign in or create an account"}
            </h1>
          </div>
        </header>

        {flow.kind === "phone" && (
          <form className="auth-form" onSubmit={submitPhone}>
            <p className="auth-copy">
              {isRecoveryEntry
                ? "Enter the phone number on your account. Recovery uses only the Google account already linked to it."
                : "Choose your country and enter the phone number for your KuchuPuchu account."}
            </p>
            <label className="field-label" htmlFor="auth-country">
              Country
            </label>
            <select
              id="auth-country"
              className="auth-input"
              value={countryIso}
              onChange={(event) => setCountryIso(event.target.value)}
              disabled={busy}
            >
              {countries.map((country) => (
                <option key={country.iso} value={country.iso}>
                  {country.name} (+{country.dial})
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="auth-phone">
              Phone number
            </label>
            <div className="phone-input-row">
              <span className="phone-dial" aria-hidden="true">
                +{selectedCountry.dial}
              </span>
              <input
                id="auth-phone"
                className="auth-input phone-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={countryIso === "BD" ? "01712345678" : "Phone number"}
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                disabled={busy}
                required
              />
            </div>
            {!isRecoveryEntry && (
              <p className="auth-footnote">
                Web cannot read SIM details. New-account phone checks use the Worker’s device-only
                policy; Android SIM verification is not claimed here.
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Please wait…" : isRecoveryEntry ? "Continue to recovery" : "Continue"}
            </button>
            {isRecoveryEntry ? (
              <button
                className="text-button"
                type="button"
                onClick={() => switchToPhone("login")}
                disabled={busy}
              >
                Back to sign-in
              </button>
            ) : (
              <button
                className="text-button"
                type="button"
                onClick={switchToRecovery}
                disabled={busy}
              >
                Recover account with Google
              </button>
            )}
          </form>
        )}

        {isApproval && flow.kind === "approval" && (
          <div className="auth-form" aria-live="polite">
            <p className="auth-copy">
              A signed-in KuchuPuchu device can approve this request. You can also use the six-digit
              code shown on its approval card.
            </p>
            <div className="approval-summary">
              <span className="approval-summary__label">Phone account</span>
              <strong>{maskPhone(flow.phone)}</strong>
              <span className="approval-summary__expiry">
                Request expires automatically in about five minutes.
              </span>
            </div>
            {flow.otpAvailable && !otpLocked && (
              <form className="otp-form" onSubmit={submitOtp}>
                <label className="field-label" htmlFor="auth-otp">
                  Six-digit code
                </label>
                <input
                  id="auth-otp"
                  className="auth-input otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={busy}
                />
                <button className="primary-button" type="submit" disabled={busy || !validOtp(otp)}>
                  {busy ? "Checking…" : "Verify code"}
                </button>
              </form>
            )}
            {!flow.otpAvailable && (
              <p className="auth-footnote">
                Code sign-in is not available for this request. Use approval from a signed-in
                device.
              </p>
            )}
            {flow.deviceGone && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setFlow({ kind: "google", purpose: "recovery", phone: flow.phone });
                  setNotice({
                    kind: "info",
                    text: "Verify with the Google account already linked to this number.",
                  });
                }}
                disabled={busy}
              >
                Recover with linked Google account
              </button>
            )}
            <button
              className="text-button"
              type="button"
              onClick={() => void cancelApproval()}
              disabled={busy}
            >
              Cancel sign-in request
            </button>
          </div>
        )}

        {isGoogle && flow.kind === "google" && (
          <div className="auth-form" aria-live="polite">
            <p className="auth-copy">
              {flow.purpose === "bind"
                ? `Link a Google account to ${maskPhone(flow.phone)} to finish account setup.`
                : `Use the Google account already linked to ${maskPhone(flow.phone)}. Other Google accounts cannot recover this account.`}
            </p>
            {flow.purpose === "bind" && (
              <>
                <label className="field-label" htmlFor="auth-display-name">
                  Display name (optional)
                </label>
                <input
                  id="auth-display-name"
                  className="auth-input"
                  type="text"
                  autoComplete="name"
                  maxLength={40}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {googleConfigLoading && (
              <p className="auth-footnote" role="status">
                Loading secure Google sign-in…
              </p>
            )}
            {googleClientId && !googleConfigLoading && (
              <div className="google-button-wrap" aria-busy={busy}>
                <GoogleIdentityButton
                  clientId={googleClientId}
                  onCredential={(credential) => void submitGoogleCredential(credential)}
                />
              </div>
            )}
            {!googleConfigLoading && googleConfigFailed && (
              <p className="auth-inline-error" role="alert">
                Google sign-in configuration could not be loaded. Check your connection and try
                again.
              </p>
            )}
            {!googleConfigLoading && !googleConfigFailed && googleClientId === null && (
              <p className="auth-inline-error" role="alert">
                Google sign-in is not configured for this service. No account has been linked or
                recovered.
              </p>
            )}
            {busy && (
              <p className="auth-footnote" role="status">
                Verifying with the account service…
              </p>
            )}
            <button
              className="text-button"
              type="button"
              onClick={() => switchToPhone(flow.purpose === "recovery" ? "recovery" : "login")}
              disabled={busy}
            >
              Use a different phone number
            </button>
          </div>
        )}

        {notice && (
          <p
            className={`auth-notice auth-notice--${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}

        <footer className="auth-footer">
          <p>
            Sign-in uses the existing KuchuPuchu account service. Your token is never placed in the
            URL.
          </p>
          <p>Messaging, status, media and calls are not enabled by this account screen.</p>
          <button className="auth-back-link" type="button" onClick={leaveAuth}>
            Back to Chats preview
          </button>
        </footer>
      </section>
    </main>
  );
}
