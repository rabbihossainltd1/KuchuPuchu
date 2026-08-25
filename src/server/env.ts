import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

function loadDotEnv(fileName: string) {
  const file = path.resolve(process.cwd(), fileName);
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(".env");
loadDotEnv(".env.local");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_APP_URL: z.string().min(1).default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  SESSION_SECRET: z.string().min(16).default("dev-only-session-secret-change-me"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().optional().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("KuchuPuchu <no-reply@localhost>"),
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional().default(""),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional().default(""),
  ADMIN_BOOTSTRAP_NAME: z.string().optional().default("Super Admin"),
  SPV_MODE: z.enum(["live", "sandbox"]).default("sandbox"),
  SPV_API_KEY: z.string().optional().default(""),
  SPV_API_BASE: z.string().optional().default("https://spv-payment-api.pages.dev/api/v1"),
  SPV_INTEGRATION_ORIGIN: z.string().optional().default(""),
  SPV_WEBHOOK_SECRET: z.string().optional().default(""),
  LOG_LEVEL: z.string().optional().default("info"),
});

export const env = schema.parse(process.env);

export function isProd(): boolean {
  return env.NODE_ENV === "production";
}

export function cookieSecure(): boolean {
  if (env.COOKIE_SECURE) return true;
  return isProd();
}
