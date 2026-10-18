/**
 * context-manager.ts - RxJS 驱动的上下文管理器
 * 监控 token 使用量，在接近 context window 上限时自动压缩对话历史。
 */

import { Subject, type Observable, filter } from 'rxjs';
import type { HistoryRecord } from '../runtime/event-types.js';
import { resolveModelContextWindow } from '@providers/profiles.js';

// ============================================================
// 类型定义
// ============================================================

export type UsageReport = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
};

export type CompactionResult = {
  removedCount: number;
  tokensSaved: number;
  newLength: number;
};

export type CompactionPlan = {
  cutIndex: number;
  removedRecords: HistoryRecord[];
};

export type ContextManagerConfig = {
  contextWindow: number;
  compactionThreshold: number;
  summarizationThreshold: number;
  compactionBudgetRatio: number;
};

const DEFAULT_CONFIG: ContextManagerConfig = {
  contextWindow: 128000,
  compactionThreshold: 0.8,
  summarizationThreshold: 0.95,
  compactionBudgetRatio: 0.6,
};

// ============================================================
// 模型 Context Window 解析
// ============================================================

export function resolveContextWindow(modelName: string, configuredWindow?: number): number {
  if (configuredWindow !== undefined && configuredWindow > 0) {
    return configuredWindow;
  }
  return resolveModelContextWindow(modelName);
}

// ============================================================
// 工具输出截断
// ============================================================

export type ToolOutputTruncationConfig = {
  maxChars: number;
  headChars: number;
  tailChars: number;
};

export const DEFAULT_TOOL_OUTPUT_TRUNCATION: ToolOutputTruncationConfig = {
  maxChars: 12000,
  headChars: 8000,
  tailChars: 2000,
};

export function truncateToolOutput(
  text: string | undefined,
  config: ToolOutputTruncationConfig = DEFAULT_TOOL_OUTPUT_TRUNCATION
): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= config.maxChars) return text;

  const omitted = text.length - config.headChars - config.tailChars;
  const marker = `\n... [truncated ${omitted} characters] ...\n`;
  return text.slice(0, config.headChars) + marker + text.slice(-config.tailChars);
}

// ============================================================
// Token 估算
// ============================================================

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  let cjkChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjkChars++;
    }
  }
  const nonCjkChars = text.length - cjkChars;
  const cjkTokens = Math.ceil(cjkChars / 2);
  const nonCjkTokens = Math.ceil(nonCjkChars / 4);

  return cjkTokens + nonCjkTokens;
}

function estimateMessageTokens(message: HistoryRecord): number {
  if (message.type === 'message') {
    return estimateTokens(message.content);
  }
  if (message.type === 'summary') {
    return estimateTokens(message.content) + 10;
  }
  if (message.type === 'tool_call') {
    return estimateTokens(JSON.stringify(message.input ?? {}));
  }
  if (message.type === 'tool_result') {
    const contentTokens = estimateTokens(message.output ?? message.error ?? '');
    return contentTokens + 10;
  }
  return 50;
}

// ============================================================
// ContextManager 类
// ============================================================

export class ContextManager {
  private config: ContextManagerConfig;
  private usage$ = new Subject<UsageReport>();
  private compaction$ = new Subject<CompactionResult>();
  private totalTokens = 0;
  private lastPromptTokens = 0;
  private promptTokens = 0;
  private hasRealUsage = false;

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reportUsage(usage: UsageReport): void {
    this.totalTokens = usage.totalTokens;
    this.lastPromptTokens = usage.promptTokens;
    this.hasRealUsage = true;
    this.usage$.next(usage);
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  setPromptTokens(tokens: number): void {
    this.promptTokens = tokens;
  }

  getPromptTokens(): number {
    return this.promptTokens;
  }

  trackRecord(record: HistoryRecord): void {
    this.totalTokens += estimateMessageTokens(record);
  }

  /**
   * 回滚/同步到指定历史，根据剩余记录重新估算 totalTokens
   */
  rollbackToHistory(newHistory: readonly HistoryRecord[]): void {
    let tokens = 0;
    for (const record of newHistory) {
      tokens += estimateMessageTokens(record);
    }
    this.totalTokens = tokens;
    this.hasRealUsage = false;
  }

  getContextWindow(): number {
    return this.config.contextWindow;
  }

  private usedTokens(): number {
    return this.hasRealUsage ? this.totalTokens : this.promptTokens + this.totalTokens;
  }

  needsCompaction(): boolean {
    return this.usedTokens() / this.config.contextWindow > this.config.compactionThreshold;
  }

  needsSummarization(): boolean {
    return this.usedTokens() / this.config.contextWindow > this.config.summarizationThreshold;
  }

  onCompactionNeeded(): Observable<UsageReport> {
    return this.usage$.pipe(
      filter(() => this.needsCompaction())
    );
  }

  onCompaction(): Observable<CompactionResult> {
    return this.compaction$.asObservable();
  }

  /**
   * 规划压缩（不修改 history）
   */
  planCompaction(history: readonly HistoryRecord[]): CompactionPlan | null {
    if (history.length === 0) return null;
    const budgetTokens = Math.round(this.config.contextWindow * this.config.compactionBudgetRatio);

    let acc = 0;
    let start = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      const t = estimateMessageTokens(history[i]);
      if (acc + t > budgetTokens) break;
      acc += t;
      start = i;
    }
    if (start === history.length) start = history.length - 1;
    if (start === 0) return null;

    let cutIndex = start;
    while (cutIndex < history.length) {
      const record = history[cutIndex];
      if (record && record.type !== 'tool_call' && record.type !== 'tool_result') break;
      cutIndex++;
    }
    if (cutIndex >= history.length || cutIndex === 0) return null;

    return {
      cutIndex,
      removedRecords: history.slice(0, cutIndex),
    };
  }

  /**
   * 落地压缩（修改 history）
   */
  applyCompaction(
    history: HistoryRecord[],
    plan: CompactionPlan,
    summaryRecord?: HistoryRecord
  ): CompactionResult {
    const removedMessages = history.splice(0, plan.cutIndex);
    if (summaryRecord) {
      history.unshift(summaryRecord);
    }

    const removedTokens = removedMessages.reduce(
      (sum, msg) => sum + estimateMessageTokens(msg),
      0
    );
    const summaryTokens = summaryRecord ? estimateMessageTokens(summaryRecord) : 0;
    const tokensSaved = Math.max(0, removedTokens - summaryTokens);

    this.totalTokens = Math.max(0, this.totalTokens - tokensSaved);

    const result: CompactionResult = {
      removedCount: removedMessages.length,
      tokensSaved,
      newLength: history.length,
    };

    this.compaction$.next(result);
    return result;
  }

  /**
   * 执行压缩（同步、无摘要的 token 预算切割策略）
   */
  compact(history: HistoryRecord[]): CompactionResult {
    const plan = this.planCompaction(history);
    if (!plan) {
      return {
        removedCount: 0,
        tokensSaved: 0,
        newLength: history.length,
      };
    }
    return this.applyCompaction(history, plan);
  }

  reset(): void {
    this.totalTokens = 0;
    this.promptTokens = 0;
  }

  destroy(): void {
    this.usage$.complete();
    this.compaction$.complete();
  }
}
