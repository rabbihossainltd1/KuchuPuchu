import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import {
  giftSchema,
  paginationSchema,
  paymentOrderSchema,
  storeOrderSchema,
} from "../../domain/validation.js";
import { getWallet, listTransactions } from "../services/wallet.js";
import {
  claimDailyReward,
  equipItem,
  giftItem,
  listInventory,
  listProducts,
  listReferrals,
  listStoreOrders,
  purchaseProduct,
  unequipItem,
} from "../services/store.js";
import {
  cancelPaymentOrder,
  createPaymentOrder,
  getPaymentOrder,
  handleSpvWebhook,
  listPackages,
  listUserPayments,
  settleOrder,
} from "../services/payments.js";
import { failSandboxPayment, getSandboxIntent, verifySandboxPayment } from "../services/spv.js";
import { env } from "../env.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import type { AuthedRequest } from "../types.js";

export const economyRouter = Router();

economyRouter.get(
  "/wallet",
  requireAuth,
  asyncHandler(async (req, res) => {
    const wallet = await getWallet((req as AuthedRequest).user.id);
    res.json({ wallet });
  }),
);

economyRouter.get(
  "/wallet/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = paginationSchema.parse(req.query);
    res.json(await listTransactions((req as AuthedRequest).user.id, query.cursor, query.limit));
  }),
);

economyRouter.get(
  "/wallet/referrals",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listReferrals((req as AuthedRequest).user.id) });
  }),
);

economyRouter.post(
  "/wallet/daily-reward",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ reward: await claimDailyReward((req as AuthedRequest).user.id) });
  }),
);

economyRouter.get(
  "/store/products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.json({ items: await listProducts(category) });
  }),
);

economyRouter.get(
  "/store/products/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await listProducts();
    const product = items.find((p) => p.id === req.params.id);
    if (!product) throw new AppError("NOT_FOUND", "Product not found.", 404);
    res.json({ product });
  }),
);

economyRouter.post(
  "/store/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = storeOrderSchema.parse(req.body);
    res.status(201).json({
      order: await purchaseProduct(
        (req as AuthedRequest).user.id,
        body.productId,
        body.idempotencyKey,
      ),
    });
  }),
);

economyRouter.get(
  "/store/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listStoreOrders((req as AuthedRequest).user.id) });
  }),
);

economyRouter.get(
  "/inventory",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listInventory((req as AuthedRequest).user.id) });
  }),
);

economyRouter.post(
  "/inventory/:id/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await equipItem((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

economyRouter.post(
  "/inventory/:id/unequip",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await unequipItem((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

economyRouter.post(
  "/gifts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = giftSchema.parse(req.body);
    res.status(201).json({ gift: await giftItem((req as AuthedRequest).user.id, body) });
  }),
);

economyRouter.get(
  "/payments/packages",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ items: await listPackages() });
  }),
);

economyRouter.post(
  "/payments/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = paymentOrderSchema.parse(req.body);
    res.status(201).json({
      order: await createPaymentOrder(
        (req as AuthedRequest).user.id,
        body.packageId,
        body.idempotencyKey,
      ),
    });
  }),
);

economyRouter.get(
  "/payments/orders",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listUserPayments((req as AuthedRequest).user.id) });
  }),
);

economyRouter.get(
  "/payments/orders/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = req as AuthedRequest;
    res.json({
      order: await getPaymentOrder(
        viewer.user.id,
        String(req.params.id),
        Boolean(viewer.adminRole),
      ),
    });
  }),
);

economyRouter.post(
  "/payments/orders/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      order: await cancelPaymentOrder((req as AuthedRequest).user.id, String(req.params.id)),
    });
  }),
);

economyRouter.post(
  "/payments/orders/:id/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = req as AuthedRequest;
    const current = await getPaymentOrder(
      viewer.user.id,
      String(req.params.id),
      Boolean(viewer.adminRole),
    );
    res.json({ order: await settleOrder(current.id) });
  }),
);

economyRouter.post(
  "/payments/webhooks/spv",
  asyncHandler(async (req, res) => {
    const raw =
      (req as typeof req & { rawBody?: string }).rawBody ??
      (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    const signature = req.header("x-spv-signature") ?? undefined;
    res.json({ order: await handleSpvWebhook(raw, signature) });
  }),
);

economyRouter.get(
  "/sandbox/payments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.SPV_MODE === "live") throw new AppError("NOT_FOUND", "Not found.", 404);
    const intent = getSandboxIntent(String(req.params.id));
    if (!intent) throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    const order = await prisma.paymentOrder.findUnique({
      where: { providerPaymentId: intent.paymentId },
    });
    if (!order || order.userId !== (req as AuthedRequest).user.id) {
      throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    }
    res.json({
      paymentId: intent.paymentId,
      amount: intent.amount,
      status: intent.status,
      secret: intent.secret,
    });
  }),
);

economyRouter.post(
  "/sandbox/payments/:id/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.SPV_MODE === "live") throw new AppError("NOT_FOUND", "Not found.", 404);
    const secret = String((req.body as { secret?: string }).secret ?? "");
    const intent = verifySandboxPayment(String(req.params.id), secret);
    const order = await prisma.paymentOrder.findUnique({
      where: { providerPaymentId: intent.paymentId },
    });
    if (!order || order.userId !== (req as AuthedRequest).user.id) {
      throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    }
    res.json({ order: await settleOrder(order.id) });
  }),
);

economyRouter.post(
  "/sandbox/payments/:id/fail",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.SPV_MODE === "live") throw new AppError("NOT_FOUND", "Not found.", 404);
    const intent = failSandboxPayment(String(req.params.id));
    const order = await prisma.paymentOrder.findUnique({
      where: { providerPaymentId: intent.paymentId },
    });
    if (!order || order.userId !== (req as AuthedRequest).user.id) {
      throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    }
    res.json({ order: await settleOrder(order.id) });
  }),
);
