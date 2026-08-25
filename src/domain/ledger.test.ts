import { describe, expect, it } from "vitest";
import { applyLedger, assertNoClientBalance } from "./ledger.js";
import { AppError } from "../shared/errors.js";

describe("ledger", () => {
  it("credits and debits without going negative", () => {
    expect(applyLedger(10, "credit", 5)).toBe(15);
    expect(applyLedger(10, "purchase", 4)).toBe(6);
    expect(() => applyLedger(3, "purchase", 4)).toThrow(AppError);
  });

  it("rejects non-integer amounts", () => {
    expect(() => applyLedger(10, "credit", 1.5)).toThrow(AppError);
    expect(() => applyLedger(10, "credit", 0)).toThrow(AppError);
  });

  it("forbids client-supplied balances", () => {
    expect(() => assertNoClientBalance({ balance: 9999 })).toThrow(AppError);
  });
});
