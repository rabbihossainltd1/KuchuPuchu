import { createId } from "../../domain/ids.js";
import { hashPassword } from "../../domain/hash.js";
import { assertPermission } from "../../domain/rbac.js";
import { reputationDelta } from "../../domain/reputation.js";
import { AppError } from "../../shared/errors.js";
import type { AdminRole } from "../../shared/constants.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { setSetting } from "../settings.js";
import { writeAudit } from "./audit.js";
import { notify } from "./notify.js";
import { postLedger } from "./wallet.js";
import { maybeSettleReferral } from "./users.js";

export async function bootstrapAdmin() {
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD) return;
  const existing = await prisma.adminUser.findFirst();
  if (existing) return;
  const email = env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const { registerWithEmail } = await import("./users.js");
    const created = await registerWithEmail({
      email,
      password: env.ADMIN_BOOTSTRAP_PASSWORD,
      displayName: env.ADMIN_BOOTSTRAP_NAME || "Super Admin",
      username: "admin",
    });
    user = created.user;
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  } else if (!user.passwordHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD) },
    });
  }
  await prisma.adminUser.create({
    data: { userId: user.id, role: "SUPER_ADMIN" },
  });
  await writeAudit({
    actorId: user.id,
    action: "admin.bootstrap",
    entityType: "admin_user",
    entityId: user.id,
  });
}

export async function adminDashboard() {
  const [users, reports, pendingPayments, coins] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.report.count({ where: { status: { in: ["SUBMITTED", "TRIAGED", "INVESTIGATING"] } } }),
    prisma.paymentOrder.count({ where: { status: { in: ["CREATED", "PENDING"] } } }),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
  ]);
  return {
    users,
    openReports: reports,
    pendingPayments,
    coinsInCirculation: coins._sum.balance ?? 0,
  };
}

export async function adminListUsers(q?: string) {
  return prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q } },
            { username: { contains: q } },
            { displayName: { contains: q } },
          ],
        }
      : { deletedAt: null },
    include: { wallet: true, adminUser: true, profile: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function adminModerateUser(
  actorId: string,
  role: AdminRole,
  userId: string,
  action: "warn" | "restrict" | "suspend" | "ban" | "restore",
  reason: string,
) {
  assertPermission(role, "users.moderate");
  const status =
    action === "restore"
      ? "ACTIVE"
      : action === "restrict"
        ? "RESTRICTED"
        : action === "suspend"
          ? "SUSPENDED"
          : action === "ban"
            ? "BANNED"
            : undefined;
  if (status) {
    await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status !== "ACTIVE") {
      await prisma.session.deleteMany({ where: { userId } });
    }
  }
  if (action === "warn" || action === "restrict") {
    await prisma.reputationEvent.create({
      data: {
        id: createId("rep"),
        userId,
        kind: action === "warn" ? "warning" : "restriction",
        delta: reputationDelta(action === "warn" ? "warning" : "restriction"),
        source: `admin:${actorId}`,
      },
    });
  }
  await notify({
    userId,
    type: "moderation",
    title: "Account notice",
    body: `A moderator action was applied: ${action}. ${reason}`,
    essential: true,
    link: "/help",
  });
  await writeAudit({
    actorId,
    action: `users.${action}`,
    entityType: "user",
    entityId: userId,
    metadata: { reason },
  });
}

export async function adminListReports(status?: string) {
  return prisma.report.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function adminResolveReport(
  actorId: string,
  role: AdminRole,
  reportId: string,
  status: string,
  resolution: string,
) {
  assertPermission(role, "reports.act");
  const report = await prisma.report.update({
    where: { id: reportId },
    data: { status, resolution, assignedTo: actorId },
  });
  if (status === "ACTIONED") {
    await prisma.reputationEvent.create({
      data: {
        id: createId("rep"),
        userId: report.targetUserId,
        kind: "report_confirmed",
        delta: reputationDelta("report_confirmed"),
        source: report.id,
      },
    });
  }
  await writeAudit({
    actorId,
    action: "reports.resolve",
    entityType: "report",
    entityId: reportId,
    metadata: { status, resolution },
  });
  return report;
}

export async function adminUpsertProduct(
  actorId: string,
  role: AdminRole,
  data: {
    id?: string;
    name: string;
    description: string;
    category: string;
    priceCoins: number;
    imageKey: string;
    rarity?: string;
    status?: string;
    giftable?: boolean;
    limited?: boolean;
    stock?: number | null;
    maxPerUser?: number;
    uniqueItem?: boolean;
  },
) {
  assertPermission(role, "products.write");
  const payload = {
    name: data.name,
    description: data.description,
    category: data.category,
    priceCoins: data.priceCoins,
    imageKey: data.imageKey,
    rarity: data.rarity ?? "COMMON",
    status: data.status ?? "ACTIVE",
    giftable: data.giftable ?? true,
    limited: data.limited ?? false,
    stock: data.stock ?? null,
    maxPerUser: data.maxPerUser ?? 1,
    uniqueItem: data.uniqueItem ?? true,
  };
  const product = data.id
    ? await prisma.product.update({ where: { id: data.id }, data: payload })
    : await prisma.product.create({ data: { id: createId("prd"), ...payload } });
  await writeAudit({
    actorId,
    action: data.id ? "products.update" : "products.create",
    entityType: "product",
    entityId: product.id,
  });
  return product;
}

export async function adminGrantCoins(
  actorId: string,
  role: AdminRole,
  input: { userId: string; amount: number; reason: string; idempotencyKey: string },
) {
  assertPermission(role, "ledger.grant");
  await prisma.$transaction((tx) =>
    postLedger(tx, input.userId, {
      type: "admin_grant",
      amount: input.amount,
      source: "admin",
      referenceId: actorId,
      idempotencyKey: `admin-grant:${input.idempotencyKey}`,
      metadata: { reason: input.reason },
    }),
  );
  await writeAudit({
    actorId,
    action: "ledger.grant",
    entityType: "user",
    entityId: input.userId,
    metadata: { amount: input.amount, reason: input.reason },
  });
}

export async function adminListLedger(userId?: string) {
  return prisma.coinLedger.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function adminListPayments(status?: string) {
  return prisma.paymentOrder.findMany({
    where: status ? { status } : {},
    include: { package: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function adminListReferrals(status?: string) {
  return prisma.referral.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function adminReleaseReferral(actorId: string, role: AdminRole, referralId: string) {
  assertPermission(role, "referrals.act");
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral) throw new AppError("NOT_FOUND", "Referral not found.", 404);
  await prisma.referral.update({
    where: { id: referralId },
    data: { status: "PENDING", holdReason: null },
  });
  await maybeSettleReferral(referral.refereeId);
  await writeAudit({
    actorId,
    action: "referrals.release",
    entityType: "referral",
    entityId: referralId,
  });
}

export async function adminSetSetting(
  actorId: string,
  role: AdminRole,
  key: string,
  value: unknown,
) {
  assertPermission(role, "*");
  if (role !== "SUPER_ADMIN")
    throw new AppError("FORBIDDEN", "Only a super admin can change settings.", 403);
  await setSetting(key, value);
  await writeAudit({
    actorId,
    action: "settings.update",
    entityType: "system_setting",
    entityId: key,
    metadata: { value },
  });
}

export async function adminAudit(limit = 80) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function adminVerifyUser(
  actorId: string,
  role: AdminRole,
  userId: string,
  kind: "ff" | "identity",
) {
  assertPermission(role, "users.moderate");
  await prisma.profile.update({
    where: { userId },
    data: kind === "ff" ? { verifiedFf: true } : { verifiedIdentity: true },
  });
  if (kind === "ff") {
    await prisma.reputationEvent.create({
      data: {
        id: createId("rep"),
        userId,
        kind: "verified_ff",
        delta: reputationDelta("verified_ff"),
        source: `admin:${actorId}`,
      },
    });
  }
  await writeAudit({
    actorId,
    action: `users.verify.${kind}`,
    entityType: "user",
    entityId: userId,
  });
}
