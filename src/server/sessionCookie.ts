import type { Response } from "express";
import { cookieSecure, env } from "./env.js";
import { SESSION_TTL_MS } from "../shared/constants.js";

export function setSessionCookie(res: Response, token: string) {
  res.cookie("kp_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("kp_session", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
  });
}

export function googleEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
