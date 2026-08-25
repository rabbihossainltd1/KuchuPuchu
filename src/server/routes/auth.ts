import { Router } from "express";
import { env } from "../env.js";
import { asyncHandler } from "../http.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { clearSessionCookie, googleEnabled, setSessionCookie } from "../sessionCookie.js";
import {
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registerSchema,
  verifyEmailSchema,
} from "../../domain/validation.js";
import {
  deleteAccount,
  destroyAllSessions,
  destroySession,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  upsertGoogleUser,
  verifyEmail,
} from "../services/users.js";
import { readSessionToken } from "../middleware/auth.js";
import { AppError } from "../../shared/errors.js";
import type { AuthedRequest } from "../types.js";
import { prisma } from "../db.js";
import { randomToken, sha256 } from "../../domain/hash.js";

export const authRouter = Router();

authRouter.post(
  "/auth/session",
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const { token } = await loginWithEmail({
      email: body.email,
      password: body.password,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(res, token);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/register",
  rateLimit({ windowMs: 60_000, max: 8 }),
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const { token } = await registerWithEmail({
      ...body,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(res, token);
    res.status(201).json({ ok: true });
  }),
);

authRouter.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const token = readSessionToken(req);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/logout-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await destroyAllSessions((req as AuthedRequest).user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/password-reset",
  rateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const body = passwordResetRequestSchema.parse(req.body);
    await requestPasswordReset(body.email);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/password-reset/confirm",
  rateLimit({ windowMs: 60_000, max: 8 }),
  asyncHandler(async (req, res) => {
    const body = passwordResetSchema.parse(req.body);
    await resetPassword(body.token, body.password);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/verify-email",
  asyncHandler(async (req, res) => {
    const body = verifyEmailSchema.parse(req.body);
    await verifyEmail(body.token);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/auth/verify-email/resend",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 3, key: (req) => (req as AuthedRequest).user.id }),
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!user.email) throw new AppError("NO_EMAIL", "This account has no email address.", 400);
    if (user.emailVerifiedAt)
      throw new AppError("ALREADY_VERIFIED", "Email is already verified.", 400);
    await sendVerificationEmail(user.id, user.email);
    res.json({ ok: true });
  }),
);

authRouter.delete(
  "/account",
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteAccount((req as AuthedRequest).user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.get("/auth/google", (req, res) => {
  if (!googleEnabled()) {
    res.status(503).json({
      error: {
        code: "GOOGLE_AUTH_UNAVAILABLE",
        message: "Google sign-in is not configured on this server.",
        requestId: res.locals.requestId,
      },
    });
    return;
  }
  const state = randomToken(16);
  res.cookie("kp_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRouter.get(
  "/auth/google/callback",
  asyncHandler(async (req, res) => {
    if (!googleEnabled())
      throw new AppError("GOOGLE_AUTH_UNAVAILABLE", "Google sign-in is not configured.", 503);
    const state = String(req.query.state ?? "");
    const cookieState = String(req.cookies?.kp_oauth_state ?? "");
    if (!state || !cookieState || sha256(state) !== sha256(cookieState)) {
      throw new AppError("OAUTH_STATE", "Google sign-in could not be validated.", 400);
    }
    const code = String(req.query.code ?? "");
    if (!code)
      throw new AppError("OAUTH_CODE", "Google did not return an authorization code.", 400);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenJson.access_token) {
      throw new AppError("OAUTH_TOKEN", "Google token exchange failed.", 400);
    }
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const profile = (await profileRes.json()) as {
      id?: string;
      email?: string;
      verified_email?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.id || !profile.email) {
      throw new AppError("OAUTH_PROFILE", "Google did not return a usable profile.", 400);
    }
    const { token } = await upsertGoogleUser({
      googleId: profile.id,
      email: profile.email,
      emailVerified: Boolean(profile.verified_email),
      displayName: profile.name || profile.email.split("@")[0] || "Player",
      avatarUrl: profile.picture,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(res, token);
    res.clearCookie("kp_oauth_state", { path: "/" });
    res.redirect("/home");
  }),
);

authRouter.get(
  "/auth/providers",
  asyncHandler(async (_req, res) => {
    res.json({ google: googleEnabled(), email: true });
  }),
);

authRouter.get(
  "/dev/mailbox",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.NODE_ENV === "production") {
      throw new AppError("NOT_FOUND", "Not found.", 404);
    }
    const email = (req as AuthedRequest).user.email;
    if (!email) return res.json({ items: [] });
    const items = await prisma.devMailbox.findMany({
      where: { toEmail: email.toLowerCase() },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ items });
  }),
);
