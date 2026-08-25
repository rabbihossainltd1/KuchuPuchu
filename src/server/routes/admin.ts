import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  adminGrantSchema,
  adminProductSchema,
  adminSettingSchema,
  adminUserActionSchema,
} from "../../domain/validation.js";
import {
  adminAudit,
  adminDashboard,
  adminGrantCoins,
  adminListLedger,
  adminListPayments,
  adminListReferrals,
  adminListReports,
  adminListUsers,
  adminModerateUser,
  adminReleaseReferral,
  adminResolveReport,
  adminSetSetting,
  adminUpsertProduct,
  adminVerifyUser,
} from "../services/admin.js";
import { reconcilePayments } from "../services/payments.js";
import { prisma } from "../db.js";
import type { AuthedRequest } from "../types.js";
import type { AdminRole } from "../../shared/constants.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);

adminRouter.get(
  "/admin/dashboard",
  requireAdmin("users.read"),
  asyncHandler(async (_req, res) => {
    res.json(await adminDashboard());
  }),
);

adminRouter.get(
  "/admin/users",
  requireAdmin("users.read"),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json({ items: await adminListUsers(q) });
  }),
);

adminRouter.post(
  "/admin/users/:id/action",
  requireAdmin("users.moderate"),
  asyncHandler(async (req, res) => {
    const body = adminUserActionSchema.parse(req.body);
    const viewer = req as AuthedRequest;
    await adminModerateUser(
      viewer.user.id,
      viewer.adminRole as AdminRole,
      String(req.params.id),
      body.action,
      body.reason,
    );
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/admin/users/:id/verify",
  requireAdmin("users.moderate"),
  asyncHandler(async (req, res) => {
    const kind = (req.body as { kind?: "ff" | "identity" }).kind === "identity" ? "identity" : "ff";
    const viewer = req as AuthedRequest;
    await adminVerifyUser(
      viewer.user.id,
      viewer.adminRole as AdminRole,
      String(req.params.id),
      kind,
    );
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/admin/reports",
  requireAdmin("reports.read"),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ items: await adminListReports(status) });
  }),
);

adminRouter.post(
  "/admin/reports/:id",
  requireAdmin("reports.act"),
  asyncHandler(async (req, res) => {
    const viewer = req as AuthedRequest;
    const status = String((req.body as { status?: string }).status ?? "RESOLVED");
    const resolution = String((req.body as { resolution?: string }).resolution ?? "");
    res.json({
      report: await adminResolveReport(
        viewer.user.id,
        viewer.adminRole as AdminRole,
        String(req.params.id),
        status,
        resolution,
      ),
    });
  }),
);

adminRouter.get(
  "/admin/products",
  requireAdmin("products.read"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ items });
  }),
);

adminRouter.post(
  "/admin/products",
  requireAdmin("products.write"),
  asyncHandler(async (req, res) => {
    const body = adminProductSchema.parse(req.body);
    const viewer = req as AuthedRequest;
    res.status(201).json({
      product: await adminUpsertProduct(viewer.user.id, viewer.adminRole as AdminRole, body),
    });
  }),
);

adminRouter.patch(
  "/admin/products/:id",
  requireAdmin("products.write"),
  asyncHandler(async (req, res) => {
    const body = adminProductSchema.partial().parse(req.body);
    const viewer = req as AuthedRequest;
    const current = await prisma.product.findUnique({ where: { id: String(req.params.id) } });
    if (!current) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Product not found.",
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    res.json({
      product: await adminUpsertProduct(viewer.user.id, viewer.adminRole as AdminRole, {
        id: current.id,
        name: body.name ?? current.name,
        description: body.description ?? current.description,
        category: body.category ?? current.category,
        priceCoins: body.priceCoins ?? current.priceCoins,
        imageKey: body.imageKey ?? current.imageKey,
        rarity: body.rarity ?? current.rarity,
        status: body.status ?? current.status,
        giftable: body.giftable ?? current.giftable,
        limited: body.limited ?? current.limited,
        stock: body.stock === undefined ? current.stock : body.stock,
        maxPerUser: body.maxPerUser ?? current.maxPerUser,
        uniqueItem: body.uniqueItem ?? current.uniqueItem,
      }),
    });
  }),
);

adminRouter.get(
  "/admin/payments",
  requireAdmin("payments.read"),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ items: await adminListPayments(status) });
  }),
);

adminRouter.post(
  "/admin/payments/reconcile",
  requireAdmin("payments.act"),
  asyncHandler(async (_req, res) => {
    res.json({ items: await reconcilePayments() });
  }),
);

adminRouter.get(
  "/admin/ledger",
  requireAdmin("ledger.read"),
  asyncHandler(async (req, res) => {
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    res.json({ items: await adminListLedger(userId) });
  }),
);

adminRouter.post(
  "/admin/ledger/grant",
  requireAdmin("ledger.grant"),
  asyncHandler(async (req, res) => {
    const body = adminGrantSchema.parse(req.body);
    const viewer = req as AuthedRequest;
    await adminGrantCoins(viewer.user.id, viewer.adminRole as AdminRole, body);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/admin/referrals",
  requireAdmin("referrals.read"),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ items: await adminListReferrals(status) });
  }),
);

adminRouter.post(
  "/admin/referrals/:id/release",
  requireAdmin("referrals.act"),
  asyncHandler(async (req, res) => {
    const viewer = req as AuthedRequest;
    await adminReleaseReferral(
      viewer.user.id,
      viewer.adminRole as AdminRole,
      String(req.params.id),
    );
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/admin/settings",
  requireAdmin("users.read"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.systemSetting.findMany();
    res.json({ items });
  }),
);

adminRouter.post(
  "/admin/settings",
  requireAdmin("*"),
  asyncHandler(async (req, res) => {
    const body = adminSettingSchema.parse(req.body);
    const viewer = req as AuthedRequest;
    await adminSetSetting(viewer.user.id, viewer.adminRole as AdminRole, body.key, body.value);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/admin/audit",
  requireAdmin("audit.read"),
  asyncHandler(async (_req, res) => {
    res.json({ items: await adminAudit() });
  }),
);
