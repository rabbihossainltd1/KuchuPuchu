import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { FieldError, Notice } from "../components/ui";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Link className="brand" to="/" style={{ marginBottom: 18 }}>
          <div className="brand-mark">K</div>
          <div>
            <strong>KuchuPuchu</strong>
            <span>Trusted Free Fire teammates</span>
          </div>
        </Link>
        {children}
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="kicker">Social discovery for Free Fire</div>
        <h1 className="hero-title">Find a teammate you can actually trust.</h1>
        <p className="lede">
          KuchuPuchu matches Duo and Squad partners by mode, rank, language and availability — not
          by neon noise. Your exact location stays private.
        </p>
        <div className="row">
          <Link className="btn" to="/register">
            Create account
          </Link>
          <Link className="btn-secondary" to="/login">
            Sign in
          </Link>
        </div>
      </div>
      <div className="grid cols-3">
        <article className="card">
          <h3>Compatible first</h3>
          <p className="meta">
            Recommendations explain themselves: same mode, similar rank, active now.
          </p>
        </article>
        <article className="card">
          <h3>Quiet economy</h3>
          <p className="meta">
            Coins, gifts and store items are ledgered on the server. Clients cannot mint balance.
          </p>
        </article>
        <article className="card">
          <h3>Safety tools</h3>
          <p className="meta">
            Block, report, privacy controls and a separate admin desk for moderation.
          </p>
        </article>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [google, setGoogle] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ google: boolean }>("/api/auth/providers").then((d) => setGoogle(d.google));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      await refresh();
      navigate("/home");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="page-title">Welcome back</h1>
      <p className="lede">Sign in with email or Google if this server has it configured.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="grid" style={{ marginTop: 18 }} onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {google ? (
        <a
          className="btn-secondary"
          href="/api/auth/google"
          style={{ marginTop: 10, width: "100%" }}
        >
          Continue with Google
        </a>
      ) : (
        <p className="meta" style={{ marginTop: 10 }}>
          Google sign-in is unavailable until an administrator configures OAuth credentials.
        </p>
      )}
      <p className="meta" style={{ marginTop: 16 }}>
        <Link to="/forgot-password">Forgot password</Link> ·{" "}
        <Link to="/register">Create account</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          displayName: form.get("displayName"),
          username: form.get("username") || undefined,
          referralCode: form.get("referralCode") || undefined,
        }),
      });
      await refresh();
      navigate("/onboarding");
    } catch (err) {
      if (err instanceof RequestError) {
        setError(err.body.message);
        const next: Record<string, string> = {};
        for (const detail of err.body.details ?? []) next[detail.path] = detail.message;
        setFieldErrors(next);
      } else setError("Could not create the account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="page-title">Create your account</h1>
      <p className="lede">Use a password with mixed case and a number, at least 10 characters.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="grid" style={{ marginTop: 18 }} onSubmit={onSubmit}>
        <label className="field">
          <span>Display name</span>
          <input name="displayName" required minLength={2} />
          <FieldError message={fieldErrors.displayName} />
        </label>
        <label className="field">
          <span>Username (optional)</span>
          <input name="username" />
          <FieldError message={fieldErrors.username} />
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" required />
          <FieldError message={fieldErrors.email} />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" required />
          <FieldError message={fieldErrors.password} />
        </label>
        <label className="field">
          <span>Referral code (optional)</span>
          <input name="referralCode" defaultValue={params.get("ref") ?? ""} />
        </label>
        <button className="btn" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="meta" style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email") }),
    });
    setDone(true);
  }
  return (
    <AuthShell>
      <h1 className="page-title">Reset password</h1>
      {done ? (
        <Notice tone="ok">If that email exists, a reset link is on its way.</Notice>
      ) : (
        <form className="grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <button className="btn">Send reset link</button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: params.get("token"), password: form.get("password") }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Reset failed.");
    }
  }
  return (
    <AuthShell>
      <h1 className="page-title">Choose a new password</h1>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? (
        <Notice tone="ok">
          Password updated. <Link to="/login">Sign in</Link>
        </Notice>
      ) : (
        <form className="grid" onSubmit={onSubmit}>
          <label className="field">
            <span>New password</span>
            <input name="password" type="password" required />
          </label>
          <button className="btn">Update password</button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState("working");
  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("missing");
      return;
    }
    void api("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => setState("ok"))
      .catch(() => setState("bad"));
  }, [params]);
  return (
    <AuthShell>
      <h1 className="page-title">Email verification</h1>
      {state === "ok" ? (
        <Notice tone="ok">Email verified. You can return to the app.</Notice>
      ) : null}
      {state === "bad" || state === "missing" ? (
        <Notice tone="danger">This verification link is invalid or expired.</Notice>
      ) : null}
      <Link className="btn" to="/home" style={{ marginTop: 16 }}>
        Continue
      </Link>
    </AuthShell>
  );
}
