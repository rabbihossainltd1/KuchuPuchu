import { attachStaticFrontend, createApiApp, errorHandler } from "./app.js";
import { env } from "./env.js";
import { prisma, withBusyTimeout } from "./db.js";
import { bootstrapAdmin } from "./services/admin.js";
import { expireDueRequests } from "./services/social.js";
import { reconcilePayments } from "./services/payments.js";

async function main() {
  await withBusyTimeout();
  await bootstrapAdmin();
  const app = createApiApp();

  if (env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true, host: "0.0.0.0", allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    attachStaticFrontend(app);
  }

  app.use(errorHandler);
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.info(`KuchuPuchu listening on ${env.PORT}`);
  });

  const timer = setInterval(() => {
    void expireDueRequests();
    void reconcilePayments();
  }, 60_000);

  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
