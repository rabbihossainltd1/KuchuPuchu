import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({
    where: {
      OR: [{ email: "admin@localhost" }, { email: "admin@example.com" }, { username: "admin" }],
    },
  });
  if (!admin) {
    console.info("no admin user");
    return;
  }
  await prisma.user.update({
    where: { id: admin.id },
    data: { email: "admin@example.com", emailVerifiedAt: admin.emailVerifiedAt ?? new Date() },
  });
  console.info("admin email set to admin@example.com");
}

void main().finally(() => prisma.$disconnect());
