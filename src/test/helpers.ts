import request from "supertest";
import { createApp } from "../server/app.js";
import { prisma } from "../server/db.js";
import { createId } from "../domain/ids.js";

export function app() {
  return createApp();
}

export async function register(
  agent: ReturnType<typeof request>,
  input: { email: string; password?: string; displayName?: string; referralCode?: string },
) {
  const password = input.password ?? "StrongPass123";
  const res = await agent.post("/api/auth/register").send({
    email: input.email,
    password,
    displayName: input.displayName ?? input.email.split("@")[0],
    referralCode: input.referralCode,
  });
  return res;
}

export async function seedCatalog() {
  await prisma.coinPackage.upsert({
    where: { id: "pkg_test" },
    create: {
      id: "pkg_test",
      name: "Test pack",
      coins: 100,
      priceBdt: 50,
      active: true,
      sortOrder: 1,
    },
    update: { active: true },
  });
  await prisma.product.upsert({
    where: { id: "prd_test" },
    create: {
      id: "prd_test",
      name: "Test frame",
      description: "A test frame",
      category: "frames",
      priceCoins: 25,
      imageKey: "frame-ink",
      rarity: "COMMON",
      status: "ACTIVE",
      giftable: true,
    },
    update: { status: "ACTIVE", priceCoins: 25 },
  });
}

export async function grantCoins(userId: string, amount: number) {
  const { creditCoins } = await import("../server/services/wallet.js");
  await creditCoins({
    userId,
    amount,
    type: "admin_grant",
    source: "test",
    idempotencyKey: createId("test"),
  });
}

export async function userIdFromEmail(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("missing user");
  return user;
}
