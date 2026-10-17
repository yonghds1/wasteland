export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "deepseek-v4.1-flash": { input: 0.15, output: 0.6 },
  "mimo-v2.6-flash": { input: 0.14, output: 0.28 },
};

export const DEFAULT_MODEL_PRICE = { input: 0.3, output: 1.2 } as const;

export const WARN_RATIO = 0.7;
export const CONFIRM_RATIO = 0.9;
export const HARD_RATIO = 1.0;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

export function priceFor(model?: string): { input: number; output: number } {
  if (typeof model === "string" && model in MODEL_PRICES) return MODEL_PRICES[model];
  return { ...DEFAULT_MODEL_PRICE };
}

export function costForUsage(usage: TokenUsage, model?: string): number {
  const p = priceFor(model);
  const i = Number(usage.inputTokens) || 0;
  const o = Number(usage.outputTokens) || 0;
  return (i / 1_000_000) * p.input + (o / 1_000_000) * p.output;
}

export interface BudgetLedgerOptions {
  estimated: number;
  onWarn?: () => void;
  onConfirm?: () => void;
  onHard?: () => void;
}

export class BudgetLedger {
  spent = 0;
  estimated: number;
  onWarn?: () => void;
  onConfirm?: () => void;
  onHard?: () => void;
  private warned = false;
  private confirmed = false;
  private harded = false;

  constructor(opts: BudgetLedgerOptions) {
    this.estimated = Number(opts.estimated) || 0;
    this.onWarn = opts.onWarn;
    this.onConfirm = opts.onConfirm;
    this.onHard = opts.onHard;
  }

  charge(usage: TokenUsage, model?: string): number;
  charge(amount: number): number;
  charge(usage: TokenUsage | number, model?: string): number {
    let cost: number;
    if (typeof usage === "number") {
      cost = usage;
    } else {
      cost = costForUsage(usage, model);
    }
    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    this.spent += cost;
    this.checkThresholds();
    return cost;
  }

  snapshot(): Readonly<{ spent: number; estimated: number }> {
    return Object.freeze({ spent: this.spent, estimated: this.estimated });
  }

  private checkThresholds(): void {
    if (!(this.estimated > 0)) return;
    const s = this.spent;
    const e = this.estimated;
    if (!this.warned && s >= e * WARN_RATIO) {
      this.warned = true;
      this.onWarn?.();
    }
    if (!this.confirmed && s >= e * CONFIRM_RATIO) {
      this.confirmed = true;
      this.onConfirm?.();
    }
    if (!this.harded && s >= e * HARD_RATIO) {
      this.harded = true;
      this.onHard?.();
    }
  }
}
