import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS, DEFAULT_MATCH_WEIGHTS } from "../src/shared/constants.js";
import { STORE_CATALOG } from "../src/shared/catalog.js";

const prisma = new PrismaClient();

const packages = [
  { id: "pkg_80", name: "Starter pouch", coins: 80, priceBdt: 49, sortOrder: 1 },
  { id: "pkg_200", name: "Squad pack", coins: 200, priceBdt: 99, sortOrder: 2 },
  { id: "pkg_500", name: "Custom night", coins: 500, priceBdt: 199, sortOrder: 3 },
  { id: "pkg_1200", name: "Season chest", coins: 1200, priceBdt: 399, sortOrder: 4 },
];

async function main() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, valueJson: JSON.stringify(value) },
      update: {},
    });
  }
  await prisma.systemSetting.upsert({
    where: { key: "matchWeights" },
    create: { key: "matchWeights", valueJson: JSON.stringify(DEFAULT_MATCH_WEIGHTS) },
    update: {},
  });

  for (const product of STORE_CATALOG) {
    const data = {
      name: product.name,
      description: product.description,
      category: product.category,
      priceCoins: product.priceCoins,
      imageKey: product.imageKey,
      rarity: product.rarity,
      giftable: product.giftable ?? true,
      limited: product.limited ?? false,
      stock: product.stock ?? null,
      maxPerUser: product.maxPerUser ?? 1,
      uniqueItem: product.uniqueItem ?? true,
      status: "ACTIVE",
    };
    await prisma.product.upsert({
      where: { id: product.id },
      create: { id: product.id, ...data },
      update: data,
    });
  }

  await prisma.product.updateMany({
    where: {
      id: { notIn: [...STORE_CATALOG.map((item) => item.id), "prd_test"] },
      status: "ACTIVE",
    },
    data: { status: "RETIRED" },
  });

  for (const pack of packages) {
    await prisma.coinPackage.upsert({
      where: { id: pack.id },
      create: { ...pack, active: true },
      update: { name: pack.name, coins: pack.coins, priceBdt: pack.priceBdt, active: true },
    });
  }
}

void main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
