import { createHash } from "node:crypto";
import { createId } from "../../domain/ids.js";
import { AppError } from "../../shared/errors.js";
import { safeEqual } from "../../domain/hash.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { notify } from "./notify.js";
import { postLedger } from "./wallet.js";
import { writeAudit } from "./audit.js";
import { getSpvGateway, mapSpvStatus } from "./spv.js";

export async function listPackages() {
  return prisma.coinPackage.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createPaymentOrder(
  userId: string,
  packageId: string,
  idempotencyKey: string,
) {
  const existing = await prisma.paymentOrder.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  const pack = await prisma.coinPackage.findUnique({ where: { id: packageId } });
  if (!pack || !pack.active) throw new AppError("NOT_FOUND", "Coin package not found.", 404);

  const order = await prisma.paymentOrder.create({
    data: {
      id: createId("pay"),
      userId,
      packageId,
      coins: pack.coins,
      amountBdt: pack.priceBdt,
      status: "CREATED",
      idempotencyKey,
    },
  });
  await addEvent(order.id, null, "CREATED", "Internal order created");

  const gateway = getSpvGateway();
  const intent = await gateway.createIntent({
    amount: pack.priceBdt,
    orderReference: order.id,
    description: `${pack.name} — ${pack.coins} KuchuPuchu coins`,
    returnUrl: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/wallet/payment/${order.id}`,
  });

  const pending = await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: "PENDING",
      providerPaymentId: intent.paymentId,
      checkoutUrl: intent.checkoutUrl,
      checkoutToken: intent.checkoutToken,
    },
  });
  await addEvent(order.id, "CREATED", "PENDING", "SPV intent created", intent);
  return pending;
}

export async function getPaymentOrder(userId: string, orderId: string, isAdmin = false) {
  const order = await prisma.paymentOrder.findUnique({
    where: { id: orderId },
    include: { package: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!order || (!isAdmin && order.userId !== userId)) {
    throw new AppError("NOT_FOUND", "Payment order not found.", 404);
  }
  return settleOrder(order.id);
}

export async function cancelPaymentOrder(userId: string, orderId: string) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== userId)
    throw new AppError("NOT_FOUND", "Payment order not found.", 404);
  if (order.status !== "CREATED" && order.status !== "PENDING") {
    throw new AppError("INVALID_STATE", "This payment can no longer be cancelled.", 409);
  }
  if (order.providerPaymentId) {
    try {
      await getSpvGateway().cancelIntent(order.providerPaymentId);
    } catch {
      /* still cancel locally */
    }
  }
  const updated = await prisma.paymentOrder.update({
    where: { id: orderId },
    data: { status: "CANCELLED" },
  });
  await addEvent(orderId, order.status, "CANCELLED", "Cancelled by user");
  return updated;
}

export async function settleOrder(orderId: string) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Payment order not found.", 404);
  if (order.status === "PAID" || order.status === "REFUNDED") return order;
  if (!order.providerPaymentId) return order;

  let remoteStatus = order.status;
  try {
    const intent = await getSpvGateway().getIntent(order.providerPaymentId);
    if (intent.amount && intent.amount !== order.amountBdt) {
      await addEvent(order.id, order.status, order.status, "Amount mismatch from provider", intent);
      await writeAudit({
        action: "payment.amount_mismatch",
        entityType: "payment_order",
        entityId: order.id,
        metadata: { expected: order.amountBdt, actual: intent.amount },
      });
      return order;
    }
    remoteStatus = mapSpvStatus(intent.status);
  } catch {
    return order;
  }

  if (remoteStatus === "PAID") {
    return creditPaidOrder(order.id);
  }
  if (remoteStatus === "FAILED" || remoteStatus === "CANCELLED") {
    const updated = await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: remoteStatus, failureCode: remoteStatus.toLowerCase() },
    });
    await addEvent(order.id, order.status, remoteStatus, "Provider status update");
    if (remoteStatus === "FAILED") {
      await notify({
        userId: order.userId,
        type: "payment_failed",
        title: "Payment failed",
        body: "Your coin purchase did not complete.",
        link: "/wallet",
      });
    }
    return updated;
  }
  return order;
}

export async function creditPaidOrder(orderId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError("NOT_FOUND", "Payment order not found.", 404);
    if (order.status === "PAID" && order.settledAt) return order;
    await postLedger(tx, order.userId, {
      type: "credit",
      amount: order.coins,
      source: "spv_purchase",
      referenceId: order.id,
      idempotencyKey: `payment:${order.id}`,
      metadata: { amountBdt: order.amountBdt, packageId: order.packageId },
    });
    return tx.paymentOrder.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: order.paidAt ?? new Date(), settledAt: new Date() },
    });
  });
  await addEvent(orderId, "PENDING", "PAID", "Coins credited");
  await notify({
    userId: result.userId,
    type: "payment_success",
    title: "Payment confirmed",
    body: `${result.coins} coins were added to your wallet.`,
    link: "/wallet",
    dedupeKey: `pay-success-${result.id}`,
  });
  return result;
}

export async function handleSpvWebhook(rawBody: string, signature: string | undefined) {
  if (env.SPV_WEBHOOK_SECRET) {
    const expected = createHash("sha256")
      .update(`${env.SPV_WEBHOOK_SECRET}.${rawBody}`)
      .digest("hex");
    if (!signature || !safeEqual(expected, signature)) {
      throw new AppError("UNAUTHORIZED", "Invalid webhook signature.", 401);
    }
  } else if (env.SPV_MODE === "live") {
    throw new AppError("UNAUTHORIZED", "Webhook secret is not configured.", 401);
  }
  const payload = JSON.parse(rawBody) as {
    paymentId?: string;
    orderReference?: string;
    status?: string;
  };
  const order = payload.orderReference
    ? await prisma.paymentOrder.findUnique({ where: { id: payload.orderReference } })
    : payload.paymentId
      ? await prisma.paymentOrder.findUnique({ where: { providerPaymentId: payload.paymentId } })
      : null;
  if (!order) throw new AppError("NOT_FOUND", "Order not found.", 404);
  await addEvent(order.id, order.status, order.status, "Webhook received", payload);
  return settleOrder(order.id);
}

export async function reconcilePayments() {
  const pending = await prisma.paymentOrder.findMany({
    where: { status: { in: ["CREATED", "PENDING"] } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  const results = [];
  for (const order of pending) {
    results.push(await settleOrder(order.id));
  }
  return results;
}

export async function listUserPayments(userId: string) {
  return prisma.paymentOrder.findMany({
    where: { userId },
    include: { package: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

async function addEvent(
  orderId: string,
  fromStatus: string | null,
  toStatus: string,
  note?: string,
  raw?: unknown,
) {
  await prisma.paymentEvent.create({
    data: {
      id: createId("pev"),
      orderId,
      fromStatus,
      toStatus,
      note,
      rawJson: JSON.stringify(raw ?? {}),
    },
  });
}
