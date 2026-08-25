import { PrismaClient } from "@prisma/client";
import { createId } from "../src/domain/ids.js";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, take: 8 });
  const count = await prisma.post.count();
  if (count > 0 || users.length === 0) return;
  for (const user of users.slice(0, 3)) {
    await prisma.post.create({
      data: {
        id: createId("pst"),
        authorId: user.id,
        body:
          user.displayName === "Super Admin"
            ? "Looking for a calm Clash Squad duo tonight. Mic optional, ranked Gold+."
            : "Anyone up for BR ranked this evening? South Asia server.",
        visibility: "PUBLIC",
      },
    });
  }
}

void main().finally(() => prisma.$disconnect());
