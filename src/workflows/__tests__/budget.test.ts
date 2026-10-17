import { describe, expect, it } from "vitest";
import { MODEL_PRICES, estimateTokens, costForUsage, BudgetLedger } from "../budget.js";

describe("budget", () => {
  it("has static price table", () => {
    expect(MODEL_PRICES["deepseek-v4.1-flash"].input).toBe(0.15);
    expect(MODEL_PRICES["deepseek-v4.1-flash"].output).toBe(0.6);
    expect(MODEL_PRICES["mimo-v2.6-flash"].input).toBe(0.14);
    expect(MODEL_PRICES["mimo-v2.6-flash"].output).toBe(0.28);
  });

  it("estimateTokens is ceil(len/4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("hello world")).toBe(Math.ceil("hello world".length / 4));
  });

  it("charge accumulates cost with model pricing and default fallback", () => {
    const l = new BudgetLedger({ estimated: 100 });
    const c1 = l.charge({ inputTokens: 1_000_000, outputTokens: 0 }, "deepseek-v4.1-flash");
    expect(c1).toBe(0.15);
    expect(l.spent).toBe(0.15);
    const c2 = l.charge({ inputTokens: 0, outputTokens: 1_000_000 }, "mimo-v2.6-flash");
    expect(c2).toBe(0.28);
    expect(Math.abs(l.spent - 0.43)).toBeLessThan(1e-9);
    const c3 = l.charge({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "unknown-model");
    expect(c3).toBe(0.3 + 1.2);
    const n = l.charge(2);
    expect(n).toBe(2);
    expect(Math.abs(l.spent - (0.43 + 1.5 + 2))).toBeLessThan(1e-9);
    expect(costForUsage({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("fires warn/confirm/hard in order exactly once", () => {
    const order: string[] = [];
    const l = new BudgetLedger({
      estimated: 10,
      onWarn: () => order.push("warn"),
      onConfirm: () => order.push("confirm"),
      onHard: () => order.push("hard"),
    });
    l.charge(6.9);
    expect(order).toEqual([]);
    l.charge(0.1);
    expect(order).toEqual(["warn"]);
    l.charge(2);
    expect(order).toEqual(["warn", "confirm"]);
    l.charge(1);
    expect(order).toEqual(["warn", "confirm", "hard"]);
    l.charge(100);
    expect(order).toEqual(["warn", "confirm", "hard"]);
  });

  it("single jump fires all three in order", () => {
    const order: string[] = [];
    const l = new BudgetLedger({
      estimated: 10,
      onWarn: () => order.push("warn"),
      onConfirm: () => order.push("confirm"),
      onHard: () => order.push("hard"),
    });
    l.charge(100);
    expect(order).toEqual(["warn", "confirm", "hard"]);
  });
});
