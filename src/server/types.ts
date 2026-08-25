import type { Request } from "express";
import type { AdminRole } from "../shared/constants.js";

export type AuthUser = {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  status: string;
  emailVerifiedAt: Date | null;
};

export type AuthedRequest = Request & {
  user: AuthUser;
  sessionId: string;
  adminRole: AdminRole | null;
};
