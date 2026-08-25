import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS, DEFAULT_MATCH_WEIGHTS } from "../src/shared/constants.js";

const prisma = new PrismaClient();

const products = [
  {
    id: "prd_banner_dusk",
    name: "Dusk Field Banner",
    description: "A quiet dusk landscape for your profile header.",
    category: "banners",
    priceCoins: 120,
    imageKey: "banner-dusk",
    rarity: "RARE",
  },
  {
    id: "prd_banner_mist",
    name: "River Mist Banner",
    description: "Soft morning mist over still water.",
    category: "banners",
    priceCoins: 90,
    imageKey: "banner-mist",
    rarity: "COMMON",
  },
  {
    id: "prd_frame_ink",
    name: "Ink Line Frame",
    description: "A thin charcoal frame for your avatar.",
    category: "frames",
    priceCoins: 80,
    imageKey: "frame-ink",
    rarity: "COMMON",
  },
  {
    id: "prd_frame_gold",
    name: "Warm Brass Frame",
    description: "A restrained brass edge for verified-looking profiles.",
    category: "frames",
    priceCoins: 180,
    imageKey: "frame-brass",
    rarity: "EPIC",
  },
  {
    id: "prd_badge_reliable",
    name: "Reliable Teammate",
    description: "A small badge that says you show up on time.",
    category: "badges",
    priceCoins: 60,
    imageKey: "badge-reliable",
    rarity: "COMMON",
  },
  {
    id: "prd_badge_igl",
    name: "Calm IGL",
    description: "For players who call without shouting.",
    category: "badges",
    priceCoins: 70,
    imageKey: "badge-igl",
    rarity: "RARE",
  },
  {
    id: "prd_name_serif",
    name: "Editorial Name Style",
    description: "A serif treatment for your display name.",
    category: "name_styles",
    priceCoins: 100,
    imageKey: "name-serif",
    rarity: "RARE",
  },
  {
    id: "prd_deco_seal",
    name: "Pressed Seal",
    description: "A wax-seal decoration for your profile card.",
    category: "profile_decorations",
    priceCoins: 150,
    imageKey: "deco-seal",
    rarity: "EPIC",
  },
  {
    id: "prd_boost_12h",
    name: "12-hour Discovery Boost",
    description: "Raises your ranking in recommendations for 12 hours.",
    category: "boosts",
    priceCoins: 200,
    imageKey: "boost-12",
    rarity: "RARE",
    giftable: false,
    uniqueItem: false,
    maxPerUser: 5,
  },
  {
    id: "prd_limited_founders",
    name: "Founders Cloth Mark",
    description: "A limited mark for early KuchuPuchu players.",
    category: "limited",
    priceCoins: 300,
    imageKey: "limited-founders",
    rarity: "LEGENDARY",
    limited: true,
    stock: 500,
  },
];

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

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      create: {
        giftable: product.giftable ?? true,
        limited: product.limited ?? false,
        stock: product.stock ?? null,
        maxPerUser: product.maxPerUser ?? 1,
        uniqueItem: product.uniqueItem ?? true,
        status: "ACTIVE",
        ...product,
      },
      update: {
        name: product.name,
        description: product.description,
        priceCoins: product.priceCoins,
        rarity: product.rarity,
      },
    });
  }

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
