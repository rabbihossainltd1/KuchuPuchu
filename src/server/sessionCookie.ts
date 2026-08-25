import type { Request, Response } from "express";
import { cookieSecure, env } from "./env.js";
import { SESSION_TTL_MS } from "../shared/constants.js";

function isHttps(req?: Request) {
  if (cookieSecure()) return true;
  const proto = req?.get("x-forwarded-proto") ?? req?.protocol;
  return proto === "https";
}

function cookieOptions(req?: Request) {
  const secure = isHttps(req);
  return {
    httpOnly: true,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string, req?: Request) {
  res.cookie("kp_session", token, cookieOptions(req));
}

export function clearSessionCookie(res: Response, req?: Request) {
  res.clearCookie("kp_session", cookieOptions(req));
}

export function googleEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
