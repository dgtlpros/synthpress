import { describe, expect, it } from "vitest";
import {
  LOW_BALANCE_THRESHOLD,
  pickTokenBadgeVariant,
} from "./token-badge-variant";

describe("pickTokenBadgeVariant", () => {
  it("returns warning when balance is at the low threshold", () => {
    expect(pickTokenBadgeVariant({ balance: LOW_BALANCE_THRESHOLD })).toBe(
      "warning",
    );
  });

  it("returns warning when balance is below the low threshold", () => {
    expect(pickTokenBadgeVariant({ balance: 25 })).toBe("warning");
  });

  it("returns warning at zero balance", () => {
    expect(pickTokenBadgeVariant({ balance: 0 })).toBe("warning");
  });

  it("returns lime just above the low threshold", () => {
    expect(pickTokenBadgeVariant({ balance: LOW_BALANCE_THRESHOLD + 1 })).toBe(
      "lime",
    );
  });

  it("returns lime for very large balances", () => {
    expect(pickTokenBadgeVariant({ balance: 50_000 })).toBe("lime");
  });

  it("returns lime for moderate balances", () => {
    expect(pickTokenBadgeVariant({ balance: 500 })).toBe("lime");
  });
});
