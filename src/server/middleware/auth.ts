import type { Request, Response, NextFunction } from "express";
import { sha256 } from "../../domain/hash.js";
import { AppError } from "../../shared/errors.js";
import type { AdminRole } from "../../shared/constants.js";
import { hasPermission } from "../../domain/rbac.js";
import { prisma } from "../db.js";
import type { AuthUser, AuthedRequest } from "../types.js";
import { touchActivity } from "../services/users.js";

export function readSessionToken(req: Request): string | null {
  const cookie = req.cookies?.kp_session as string | undefined;
  if (cookie) return cookie;
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readSessionToken(req);
    if (!token) return next();
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { adminUser: true } } },
    });
    if (!session || session.expiresAt < new Date() || session.user.deletedAt) return next();
    if (session.user.status === "BANNED" || session.user.status === "SUSPENDED") return next();
    attach(req, session.user, session.id);
    void touchActivity(session.user.id);
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  await optionalAuth(req, res, (err) => {
    if (err) return next(err);
    if (!("user" in req) || !(req as AuthedRequest).user) {
      next(new AppError("UNAUTHENTICATED", "Please sign in to continue.", 401));
      return;
    }
    const user = (req as AuthedRequest).user;
    if (user.status === "BANNED" || user.status === "SUSPENDED") {
      next(new AppError("ACCOUNT_DISABLED", "This account cannot use the app.", 403));
      return;
    }
    next();
  });
}

export function requireAdmin(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = (req as AuthedRequest).adminRole;
    if (!role) {
      next(new AppError("FORBIDDEN", "Admin access required.", 403));
      return;
    }
    if (permission !== "*" && role !== "SUPER_ADMIN" && !hasPermission(role, permission)) {
      next(new AppError("FORBIDDEN", "You do not have permission for this action.", 403));
      return;
    }
    next();
  };
}

function attach(
  req: Request,
  user: {
    id: string;
    email: string | null;
    username: string;
    displayName: string;
    status: string;
    emailVerifiedAt: Date | null;
    adminUser: { role: string } | null;
  },
  sessionId: string,
) {
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
  };
  (req as AuthedRequest).user = authUser;
  (req as AuthedRequest).sessionId = sessionId;
  (req as AuthedRequest).adminRole = (user.adminUser?.role as AdminRole | undefined) ?? null;
}
