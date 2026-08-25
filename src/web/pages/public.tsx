import { FormEvent, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { explainError } from "../lib/api";
import { firebaseAuth, explainFirebaseError } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { BrandMark, FieldError, Notice } from "../components/ui";

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <img className="auth-mark" src="/brand/icon-app-gold.png" alt="" />
        <img className="auth-wordmark" src="/brand/logo-horizontal.png" alt="KuchuPuchu" />
        <div style={{ height: 18 }} />
        {children}
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div>
      <header className="site-nav">
        <BrandMark />
        <div className="row">
          <Link className="btn-ghost" to="/login">
            Sign in
          </Link>
          <Link className="btn" to="/register">
            Create account
          </Link>
        </div>
      </header>
      <div className="landing">
        <section className="landing-hero">
          <div className="kicker">Social discovery for Free Fire</div>
          <h1 className="hero-title">Find a Duo or Squad partner you can trust.</h1>
          <p className="lede">
            KuchuPuchu matches players by server, rank, mode, language, and the hours you actually
            play. Exact location stays private. Coins only move on a server ledger.
          </p>
          <div className="row" style={{ marginTop: 18 }}>
            <Link className="btn" to="/register">
              Create account
            </Link>
            <Link className="btn-secondary" to="/login">
              Sign in
            </Link>
          </div>
        </section>
        <div className="grid cols-3">
          <article className="card">
            <h3>Compatible first</h3>
            <p className="meta">
              Recommendations are scored on the server and explain why someone appeared.
            </p>
          </article>
          <article className="card">
            <h3>Private by default</h3>
            <p className="meta">
              District, UID, and relationship status only show if you allow them.
            </p>
          </article>
          <article className="card">
            <h3>Safety controls</h3>
            <p className="meta">Block, report, and privacy settings sit next to every profile.</p>
          </article>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function login(email: string, password: string) {
    setError("");
    setPending(true);
    try {
      await signIn(email, password);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  }

  return (
    <AuthFrame>
      <h1 className="page-title">Welcome back</h1>
      <p className="lede">Sign in with your email and password.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="grid" style={{ marginTop: 18 }} onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Email</span>
          <input name="email" type="text" inputMode="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="meta" style={{ marginTop: 16 }}>
        <Link to="/forgot-password">Forgot password</Link> ·{" "}
        <Link to="/register">Create account</Link>
      </p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [fieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await signUp({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        username: String(form.get("username") || "") || undefined,
        referralCode: String(form.get("referralCode") || "") || undefined,
      });
      navigate("/home", { replace: true });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="page-title">Create account</h1>
      <p className="lede">Use a real email and a password with at least 6 characters.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="grid" style={{ marginTop: 18 }} onSubmit={onSubmit} noValidate>
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
          <input name="email" type="text" inputMode="email" autoComplete="email" required />
          <FieldError message={fieldErrors.email} />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" required minLength={6} />
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
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await sendPasswordResetEmail(firebaseAuth, String(form.get("email") ?? "").trim());
      setDone(true);
    } catch (err) {
      setError(explainFirebaseError(err));
    }
  }
  return (
    <AuthFrame>
      <h1 className="page-title">Reset password</h1>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? (
        <Notice tone="ok">If that email exists, a reset link is on its way.</Notice>
      ) : (
        <form className="grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input name="email" type="text" inputMode="email" required />
          </label>
          <button className="btn">Send reset link</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  return (
    <AuthFrame>
      <h1 className="page-title">Reset password</h1>
      <p className="lede">Open the reset link from your email, or request a new one.</p>
      <Link className="btn" to="/forgot-password" style={{ marginTop: 16 }}>
        Send reset email
      </Link>
    </AuthFrame>
  );
}

export function VerifyEmailPage() {
  return (
    <AuthFrame>
      <h1 className="page-title">Email verification</h1>
      <p className="lede">You can use the app after creating an account.</p>
      <Link className="btn" to="/home" style={{ marginTop: 16 }}>
        Continue
      </Link>
    </AuthFrame>
  );
}
