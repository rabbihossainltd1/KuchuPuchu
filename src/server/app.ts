import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import { env } from "./env.js";
import { errorHandler, requestId } from "./http.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { socialRouter } from "./routes/social.js";
import { economyRouter } from "./routes/economy.js";
import { notificationRouter } from "./routes/notifications.js";
import { adminRouter } from "./routes/admin.js";

export function createApiApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(cookieParser());

  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "KuchuPuchu",
      env: env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  app.use("/api", authRouter);
  app.use("/api", meRouter);
  app.use("/api", socialRouter);
  app.use("/api", economyRouter);
  app.use("/api", notificationRouter);
  app.use("/api", adminRouter);
  return app;
}

export function attachStaticFrontend(app: express.Express) {
  const webDir = path.resolve(process.cwd(), "dist/web");
  if (!existsSync(webDir)) return;
  app.use(express.static(webDir));
  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(webDir, "index.html"));
  });
}

export function createApp() {
  const app = createApiApp();
  attachStaticFrontend(app);
  app.use(errorHandler);
  return app;
}

export { errorHandler };
