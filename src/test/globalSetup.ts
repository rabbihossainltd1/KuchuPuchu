import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

export default async function setup() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "file:./test.db";
  process.env.SESSION_SECRET = "test-session-secret-32chars-min";
  process.env.SPV_MODE = "sandbox";
  process.env.PUBLIC_APP_URL = "http://localhost:4000";
  process.env.ADMIN_BOOTSTRAP_EMAIL = "";
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "";
  const db = path.resolve("prisma/test.db");
  if (existsSync(db)) unlinkSync(db);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
