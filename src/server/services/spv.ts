import { env } from "../env.js";
import { AppError } from "../../shared/errors.js";
import { createId } from "../../domain/ids.js";
import { randomToken } from "../../domain/hash.js";

export type SpvIntent = {
  paymentId: string;
  status: string;
  amount: number;
  checkoutUrl: string;
  checkoutToken?: string;
  expiresAt?: number;
};

export interface SpvGateway {
  createIntent(input: {
    amount: number;
    orderReference: string;
    description: string;
    returnUrl: string;
  }): Promise<SpvIntent>;
  getIntent(paymentId: string): Promise<SpvIntent>;
  cancelIntent(paymentId: string): Promise<SpvIntent>;
}

const sandboxStore = new Map<string, SpvIntent & { orderReference: string; secret: string }>();

export function resetSandboxSpv() {
  sandboxStore.clear();
}

export function getSandboxIntent(paymentId: string) {
  return sandboxStore.get(paymentId);
}

export function verifySandboxPayment(paymentId: string, secret: string): SpvIntent {
  const intent = sandboxStore.get(paymentId);
  if (!intent) throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
  if (intent.secret !== secret) throw new AppError("INVALID_TOKEN", "Invalid sandbox secret.", 400);
  intent.status = "verified";
  sandboxStore.set(paymentId, intent);
  return intent;
}

export function failSandboxPayment(paymentId: string): SpvIntent {
  const intent = sandboxStore.get(paymentId);
  if (!intent) throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
  intent.status = "rejected";
  sandboxStore.set(paymentId, intent);
  return intent;
}

export class SandboxSpvGateway implements SpvGateway {
  async createIntent(input: {
    amount: number;
    orderReference: string;
    description: string;
    returnUrl: string;
  }): Promise<SpvIntent> {
    const paymentId = createId("pi");
    const token = randomToken(12);
    const secret = randomToken(8);
    const intent: SpvIntent & { orderReference: string; secret: string } = {
      paymentId,
      status: "pending",
      amount: input.amount,
      checkoutUrl: `/sandbox-pay/${paymentId}?token=${token}`,
      checkoutToken: token,
      expiresAt: Date.now() + 30 * 60 * 1000,
      orderReference: input.orderReference,
      secret,
    };
    sandboxStore.set(paymentId, intent);
    return intent;
  }

  async getIntent(paymentId: string): Promise<SpvIntent> {
    const intent = sandboxStore.get(paymentId);
    if (!intent) throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    return intent;
  }

  async cancelIntent(paymentId: string): Promise<SpvIntent> {
    const intent = sandboxStore.get(paymentId);
    if (!intent) throw new AppError("NOT_FOUND", "Sandbox payment not found.", 404);
    intent.status = "cancelled";
    sandboxStore.set(paymentId, intent);
    return intent;
  }
}

export class LiveSpvGateway implements SpvGateway {
  constructor(
    private readonly apiKey: string,
    private readonly base = env.SPV_API_BASE,
    private readonly origin = env.SPV_INTEGRATION_ORIGIN || env.PUBLIC_APP_URL,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-SPV-Integration-Origin": this.origin,
    };
  }

  async createIntent(input: {
    amount: number;
    orderReference: string;
    description: string;
    returnUrl: string;
  }): Promise<SpvIntent> {
    const res = await fetch(`${this.base}/payment-intents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      paymentId?: string;
      status?: string;
      amount?: number;
      checkoutUrl?: string;
      expiresAt?: number;
      message?: string;
    };
    if (!res.ok || !data.ok || !data.paymentId || !data.checkoutUrl) {
      throw new AppError("SPV_ERROR", data.message || "Could not create payment session.", 502);
    }
    return {
      paymentId: data.paymentId,
      status: data.status ?? "pending",
      amount: data.amount ?? input.amount,
      checkoutUrl: data.checkoutUrl,
      expiresAt: data.expiresAt,
    };
  }

  async getIntent(paymentId: string): Promise<SpvIntent> {
    const res = await fetch(`${this.base}/payment-intents/${encodeURIComponent(paymentId)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      paymentId?: string;
      status?: string;
      amount?: number;
      checkoutUrl?: string;
      expiresAt?: number;
    };
    if (!res.ok || !data.ok || !data.paymentId) {
      throw new AppError("SPV_ERROR", "Could not read payment status.", 502);
    }
    return {
      paymentId: data.paymentId,
      status: data.status ?? "pending",
      amount: data.amount ?? 0,
      checkoutUrl: data.checkoutUrl ?? "",
      expiresAt: data.expiresAt,
    };
  }

  async cancelIntent(paymentId: string): Promise<SpvIntent> {
    const current = await this.getIntent(paymentId);
    return { ...current, status: current.status === "pending" ? "cancelled" : current.status };
  }
}

export function getSpvGateway(): SpvGateway {
  if (env.SPV_MODE === "live") {
    if (!env.SPV_API_KEY) {
      throw new AppError("SPV_UNAVAILABLE", "SPV is not configured on this server.", 503);
    }
    return new LiveSpvGateway(env.SPV_API_KEY);
  }
  return new SandboxSpvGateway();
}

export function mapSpvStatus(status: string): "PENDING" | "PAID" | "FAILED" | "CANCELLED" {
  const normalized = status.toLowerCase();
  if (normalized === "verified" || normalized === "success" || normalized === "paid") return "PAID";
  if (normalized === "cancelled" || normalized === "canceled") return "CANCELLED";
  if (
    normalized === "rejected" ||
    normalized === "failed" ||
    normalized === "expired" ||
    normalized === "declined"
  ) {
    return "FAILED";
  }
  return "PENDING";
}
