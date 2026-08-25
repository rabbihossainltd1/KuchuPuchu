import { AppError } from "../shared/errors.js";
import type { AdminRole } from "../shared/constants.js";

const PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ["*"],
  MODERATION_ADMIN: ["users.read", "users.moderate", "reports.read", "reports.act", "audit.read"],
  FINANCE_ADMIN: [
    "users.read",
    "payments.read",
    "payments.act",
    "ledger.read",
    "ledger.grant",
    "referrals.read",
    "referrals.act",
    "audit.read",
  ],
  CATALOG_ADMIN: ["products.read", "products.write", "inventory.read", "audit.read"],
  SUPPORT_ADMIN: ["users.read", "users.support", "reports.read", "audit.read"],
};

export function hasPermission(role: AdminRole | null | undefined, permission: string): boolean {
  if (!role) return false;
  const granted = PERMISSIONS[role] ?? [];
  return granted.includes("*") || granted.includes(permission);
}

export function assertPermission(role: AdminRole | null | undefined, permission: string): void {
  if (!hasPermission(role, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission for this action.", 403);
  }
}
