import { afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-32chars-min";
process.env.SPV_MODE = "sandbox";
process.env.PUBLIC_APP_URL = "http://localhost:4000";
process.env.ADMIN_BOOTSTRAP_EMAIL = "";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "";

afterAll(() => {
  const db = path.resolve("prisma/test.db");
  if (existsSync(db)) {
    try {
      unlinkSync(db);
    } catch {
      /* ignore */
    }
  }
});
