import type { Prisma } from "@prisma/client";
import { createId } from "../../domain/ids.js";
import { applyLedger, type LedgerEntryInput } from "../../domain/ledger.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../db.js";

export async function getWallet(userId: string) {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
  return wallet;
}

export async function postLedger(
  tx: Prisma.TransactionClient,
  userId: string,
  entry: LedgerEntryInput,
) {
  const existing = await tx.coinLedger.findUnique({
    where: { idempotencyKey: entry.idempotencyKey },
  });
  if (existing) return existing;

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new AppError("WALLET_MISSING", "Wallet not found.", 404);
  const next = applyLedger(wallet.balance, entry.type, entry.amount);
  await tx.wallet.update({
    where: { userId },
    data: { balance: next },
  });
  return tx.coinLedger.create({
    data: {
      id: createId("led"),
      userId,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: next,
      source: entry.source,
      referenceId: entry.referenceId,
      status: "POSTED",
      idempotencyKey: entry.idempotencyKey,
      metadataJson: JSON.stringify(entry.metadata ?? {}),
    },
  });
}

export async function creditCoins(input: {
  userId: string;
  amount: number;
  type: LedgerEntryInput["type"];
  source: string;
  referenceId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.$transaction((tx) => postLedger(tx, input.userId, input));
}

export async function listTransactions(userId: string, cursor?: string, limit = 20) {
  const items = await prisma.coinLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const nextCursor = items.length > limit ? items.pop()?.id : null;
  return { items, nextCursor };
}
