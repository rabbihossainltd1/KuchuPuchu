import { createId } from "../../domain/ids.js";
import { assertGiftableTransfer } from "../../domain/referral.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";
import { getSettings } from "../settings.js";
import { notify } from "./notify.js";
import { postLedger } from "./wallet.js";

export async function listProducts(category?: string) {
  return prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ...(category ? { category } : {}),
    },
    orderBy: [{ category: "asc" }, { priceCoins: "asc" }],
  });
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", "Product not found.", 404);
  }
  return product;
}

export async function purchaseProduct(userId: string, productId: string, idempotencyKey: string) {
  const existing = await prisma.storeOrder.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  return prisma
    .$transaction(async (tx) => {
      const again = await tx.storeOrder.findUnique({ where: { idempotencyKey } });
      if (again) return again;
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product || product.status !== "ACTIVE") {
        throw new AppError("NOT_FOUND", "Product not found.", 404);
      }
      if (product.limited && product.stock !== null && product.stock <= 0) {
        throw new AppError("OUT_OF_STOCK", "This item is sold out.", 409);
      }
      const ownedCount = await tx.inventoryItem.count({ where: { ownerId: userId, productId } });
      if (ownedCount >= product.maxPerUser) {
        throw new AppError("ALREADY_OWNED", "You already own this item.", 409);
      }
      if (product.limited && product.stock !== null) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: 1 } },
        });
      }
      const inventory = await tx.inventoryItem.create({
        data: {
          id: createId("inv"),
          ownerId: userId,
          productId,
          quantity: 1,
          giftable: product.giftable,
          equipped: false,
        },
      });
      await postLedger(tx, userId, {
        type: "purchase",
        amount: product.priceCoins,
        source: "store",
        referenceId: inventory.id,
        idempotencyKey: `store:${idempotencyKey}`,
        metadata: { productId, priceCoins: product.priceCoins },
      });
      const order = await tx.storeOrder.create({
        data: {
          id: createId("sord"),
          userId,
          productId,
          priceCoins: product.priceCoins,
          inventoryId: inventory.id,
          idempotencyKey,
          status: "COMPLETED",
        },
      });
      return order;
    })
    .then(async (order) => {
      await notify({
        userId,
        type: "store_purchase",
        title: "Purchase complete",
        body: "Your item was added to inventory.",
        link: "/inventory",
        dedupeKey: `purchase-${order.id}`,
      });
      return order;
    });
}

export async function listInventory(userId: string) {
  return prisma.inventoryItem.findMany({
    where: { ownerId: userId },
    include: { product: true },
    orderBy: { acquiredAt: "desc" },
  });
}

export async function listStoreOrders(userId: string) {
  return prisma.storeOrder.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function equipItem(userId: string, inventoryId: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: inventoryId },
    include: { product: true },
  });
  if (!item || item.ownerId !== userId) throw new AppError("NOT_FOUND", "Item not found.", 404);
  await prisma.$transaction(async (tx) => {
    await tx.inventoryItem.updateMany({
      where: {
        ownerId: userId,
        equipped: true,
        product: { category: item.product.category },
      },
      data: { equipped: false },
    });
    await tx.inventoryItem.update({ where: { id: inventoryId }, data: { equipped: true } });
    if (item.product.category === "boosts") {
      await tx.profileBoost.create({
        data: {
          id: createId("bst"),
          userId,
          inventoryId,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        },
      });
    }
  });
  return listInventory(userId);
}

export async function unequipItem(userId: string, inventoryId: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: inventoryId } });
  if (!item || item.ownerId !== userId) throw new AppError("NOT_FOUND", "Item not found.", 404);
  await prisma.inventoryItem.update({ where: { id: inventoryId }, data: { equipped: false } });
  return listInventory(userId);
}

export async function giftItem(
  senderId: string,
  input: { inventoryId: string; receiverId: string; message?: string; idempotencyKey: string },
) {
  const existing = await prisma.gift.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;
  const settings = await getSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const gifted = await prisma.gift.count({ where: { senderId, createdAt: { gte: since } } });
  if (gifted >= settings.giftDailyLimit) {
    throw new AppError("RATE_LIMITED", "You have reached today's gift limit.", 429);
  }

  const gift = await prisma.$transaction(async (tx) => {
    const again = await tx.gift.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (again) return again;
    const item = await tx.inventoryItem.findUnique({ where: { id: input.inventoryId } });
    if (!item) throw new AppError("NOT_FOUND", "Item not found.", 404);
    const receiver = await tx.user.findUnique({
      where: { id: input.receiverId },
      include: { privacy: true },
    });
    if (!receiver || receiver.status !== "ACTIVE" || receiver.deletedAt) {
      throw new AppError("NOT_FOUND", "Player not found.", 404);
    }
    const blocked = await tx.block.findFirst({
      where: {
        OR: [
          { fromUserId: senderId, toUserId: input.receiverId },
          { fromUserId: input.receiverId, toUserId: senderId },
        ],
      },
    });
    const friend = await tx.relationship.findFirst({
      where: { type: "FRIEND", fromUserId: senderId, toUserId: input.receiverId },
    });
    const allow =
      receiver.privacy?.allowGifts === "EVERYONE" ||
      (receiver.privacy?.allowGifts === "FRIENDS" && Boolean(friend));
    assertGiftableTransfer({
      senderId,
      receiverId: input.receiverId,
      ownedBy: item.ownerId,
      giftable: item.giftable,
      blocked: Boolean(blocked),
      allowGifts: Boolean(allow),
    });
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { ownerId: input.receiverId, equipped: false },
    });
    return tx.gift.create({
      data: {
        id: createId("gft"),
        senderId,
        receiverId: input.receiverId,
        inventoryId: item.id,
        productId: item.productId,
        message: input.message,
        idempotencyKey: input.idempotencyKey,
      },
    });
  });
  await notify({
    userId: input.receiverId,
    type: "gift",
    title: "You received a gift",
    body: input.message || "A player sent you a cosmetic item.",
    link: "/inventory",
  });
  return gift;
}

export async function claimDailyReward(userId: string) {
  const settings = await getSettings();
  if (!settings.dailyRewardEnabled) {
    throw new AppError("DISABLED", "Daily rewards are not available.", 400);
  }
  const dayKey = new Date().toISOString().slice(0, 10);
  try {
    const reward = await prisma.$transaction(async (tx) => {
      const created = await tx.dailyReward.create({
        data: {
          id: createId("dly"),
          userId,
          dayKey,
          amount: settings.dailyRewardCoins,
        },
      });
      await postLedger(tx, userId, {
        type: "reward",
        amount: settings.dailyRewardCoins,
        source: "daily_reward",
        referenceId: created.id,
        idempotencyKey: `daily:${userId}:${dayKey}`,
      });
      return created;
    });
    await notify({
      userId,
      type: "daily_reward",
      title: "Daily reward",
      body: `You received ${settings.dailyRewardCoins} coins.`,
      link: "/wallet",
      dedupeKey: `daily-${userId}-${dayKey}`,
    });
    return reward;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new AppError("ALREADY_CLAIMED", "You already claimed today's reward.", 409);
    }
    throw error;
  }
}

export async function listReferrals(userId: string) {
  return prisma.referral.findMany({
    where: { referrerId: userId },
    include: {
      referee: { select: { id: true, displayName: true, username: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
