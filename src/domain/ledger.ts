import { AppError } from "../shared/errors.js";
import { LEDGER_TYPES } from "../shared/constants.js";

export type LedgerType = (typeof LEDGER_TYPES)[number];

export type LedgerEntryInput = {
  type: LedgerType;
  amount: number;
  source: string;
  referenceId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("INVALID_AMOUNT", "Amount must be a positive integer.", 400);
  }
}

export function applyLedger(balance: number, type: LedgerType, amount: number): number {
  assertPositiveAmount(amount);
  const signed = isDebitType(type) ? -amount : amount;
  const next = balance + signed;
  if (next < 0) {
    throw new AppError("INSUFFICIENT_COINS", "Not enough coins for this transaction.", 400);
  }
  return next;
}

export function isDebitType(type: LedgerType): boolean {
  return type === "debit" || type === "purchase" || type === "gift" || type === "boost";
}

export function assertNoClientBalance(body: unknown): void {
  if (body && typeof body === "object" && "balance" in body) {
    throw new AppError("CLIENT_BALANCE_FORBIDDEN", "Clients cannot set wallet balance.", 400);
  }
}
