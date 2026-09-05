/**
 * context-manager.ts - RxJS 驱动的上下文管理器
 *
 * 监控 token 使用量，在接近 context window 上限时自动压缩对话历史。
 *
 * ## 设计原则
 *
 * - 使用 RxJS Subject 作为事件总线
 * - Token 预算策略：按预算从尾部累积估算 token，保留最近记录直至达到压缩预算
 * - 阈值触发：token 使用量超过 80% 时自动压缩
 */

import { Subject, Observable, filter } from 'rxjs';
import type { HistoryRecord } from './event-types.js';
import { resolveModelContextWindow } from '@providers/profiles.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Token 使用量报告
 */
export type UsageReport = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
};

/**
 * 压缩结果
 */
export type CompactionResult = {
  /** 被移除的消息数 */
  removedCount: number;
  /** 节省的 token 数（估算） */
  tokensSaved: number;
  /** 压缩后的历史长度 */
  newLength: number;
};

/**
 * 压缩计划
 *
 * 由 planCompaction 计算得出，描述"应移除哪些记录"，但不实际修改 history。
 * 调用方据此可先对 removedRecords 做摘要，再用 applyCompaction 落地。
 */
export type CompactionPlan = {
  /** 切割点：history[0..cutIndex) 将被移除 */
  cutIndex: number;
  /** 将被移除的记录（用于摘要） */
  removedRecords: HistoryRecord[];
};

/**
 * 上下文管理器配置
 */
export type ContextManagerConfig = {
  /** context window 大小（token 数） */
  contextWindow: number;
  /** 触发同步压缩的阈值（0-1，默认 0.8） */
  compactionThreshold: number;
  /** 触发异步摘要压缩的高水位（0-1，默认 0.95） */
  summarizationThreshold: number;
  /** 压缩预算占比（0-1，默认 0.6）：contextWindow × compactionBudgetRatio = 保留窗口的 token 预算 */
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

/**
 * 解析模型的 context window 大小
 *
 * 优先级：
 * 1. 用户配置（ModelSettings.contextWindow）
 * 2. 内置查找表（ProviderProfile.contextWindows，数据源：providers/profiles.ts）
 * 3. 默认值（128000）
 *
 * @param modelName - 模型名称
 * @param configuredWindow - 用户配置的 context window（可选）
 * @returns context window 大小（token 数）
 */
export function resolveContextWindow(modelName: string, configuredWindow?: number): number {
  if (configuredWindow !== undefined && configuredWindow > 0) {
    return configuredWindow;
  }

  return resolveModelContextWindow(modelName);
}

// ============================================================
// 工具输出截断
// ============================================================

/**
 * 工具输出截断配置
 */
export type ToolOutputTruncationConfig = {
  /** 超过此字符数才截断 */
  maxChars: number;
  /** 截断后保留的头部字符数 */
  headChars: number;
  /** 截断后保留的尾部字符数 */
  tailChars: number;
};

/**
 * 默认截断配置
 *
 * 工具输出（read-file / bash 等）是 context 增长的主要来源，
 * 单个超大输出可能吃掉数万 token。限制单个输出的大小，
 * 保留头部（上下文/文件开头）+ 尾部（错误信息/结果结尾通常更有用）。
 */
export const DEFAULT_TOOL_OUTPUT_TRUNCATION: ToolOutputTruncationConfig = {
  maxChars: 12000,
  headChars: 8000,
  tailChars: 2000,
};

/**
 * 截断超大的工具输出（用于进入 LLM context 的内容）
 *
 * 只影响进入上下文的副本，不影响持久化到 session 的完整记录（审计用）。
 * 采用"头 + 尾"策略：错误信息和执行结果往往在末尾，比纯头部截断更有用。
 *
 * @param text - 原始工具输出
 * @param config - 截断配置（可选，默认 DEFAULT_TOOL_OUTPUT_TRUNCATION）
 * @returns 截断后的文本；未超限时原样返回
 */
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

/**
 * 估算文本的 token 数
 *
 * 使用混合策略：
 * - 英文/ASCII：~4 字符/token
 * - 中文/CJK：~2 字符/token（每个中文字符通常是一个 token）
 * - 混合文本：取两者的加权平均
 *
 * 实现说明：单趟 charCode 扫描统计 CJK（U+4E00-9FFF / U+3400-4DBF /
 * U+F900-FAFF，与原正则等价的 BMP 区间），避免对大文本（工具输出可达
 * 数十 KB）执行 match() 时为每个命中分配数组。该函数在每条记录追踪
 * 与初始 prompt 估算时都会调用，属于热路径。
 *
 * 注意：这是估算值，实际值由 API 报告修正。
 *
 * @param text - 待估算的文本
 * @returns 估算的 token 数
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  // 统计 CJK 字符数量
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

  // CJK 字符 ~2 字符/token，非 CJK ~4 字符/token
  const cjkTokens = Math.ceil(cjkChars / 2);
  const nonCjkTokens = Math.ceil(nonCjkChars / 4);

  return cjkTokens + nonCjkTokens;
}

/**
 * 估算消息的 token 数
 */
function estimateMessageTokens(message: HistoryRecord): number {
  if (message.type === 'message') {
    return estimateTokens(message.content);
  }
  if (message.type === 'summary') {
    // 摘要记录：内容 token + 少量元数据开销
    return estimateTokens(message.content) + 10;
  }
  if (message.type === 'tool_call') {
    // 工具调用：JSON 序列化后的 input 参数
    return estimateTokens(JSON.stringify(message.input ?? {}));
  }
  if (message.type === 'tool_result') {
    // 工具结果：输出内容 + 固定开销（status, toolName 等元数据）
    const contentTokens = estimateTokens(message.output ?? message.error ?? '');
    return contentTokens + 10; // 元数据开销
  }
  return 50; // 其他类型固定开销
}

// ============================================================
// ContextManager 类
// ============================================================

/**
 * RxJS 驱动的上下文管理器
 *
 * 监控 token 使用量，在接近 context window 上限时自动压缩对话历史。
 *
 * @example
 * const manager = new ContextManager({ contextWindow: 128000 });
 *
 * // 监听压缩事件
 * manager.onCompaction().subscribe(result => {
 *   console.log(`压缩了 ${result.removedCount} 条消息`);
 * });
 *
 * // 报告 usage（从 provider 事件中调用）
 * manager.reportUsage({ totalTokens: 100000 });
 */
export class ContextManager {
  private config: ContextManagerConfig;
  private usage$ = new Subject<UsageReport>();
  private compaction$ = new Subject<CompactionResult>();
  private totalTokens = 0;
  private lastPromptTokens = 0;
  /** System prompt 的 token 数（不含 history），由调用方通过 setPromptTokens 设置 */
  private promptTokens = 0;
  /**
   * 是否已收到过 provider 的真实 usage。
   *
   * API 报告的 totalTokens 已包含 system prompt，而 promptTokens 是发送前
   * 的估算、单独维护。两者来源口径不同，只有在尚未收到真实 usage（发送前
   * totalTokens 仅是 history 估算）时才应相加，避免 system prompt 双计
   * 导致过早压缩。
   */
  private hasRealUsage = false;

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 报告 token 使用量
   *
   * 每次 provider 返回 usage 时调用。
   * 当 totalTokens 超过阈值时自动触发压缩。
   *
   * 使用 API 报告的真实 token 数，而非估算值。
   */
  reportUsage(usage: UsageReport): void {
    this.totalTokens = usage.totalTokens;
    this.lastPromptTokens = usage.promptTokens;
    this.hasRealUsage = true;
    this.usage$.next(usage);
  }

  /**
   * 获取当前 token 使用量
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * 设置 system prompt 的 token 数
   *
   * system prompt 不在 history 中，但占 context window 空间。
   * 调用方应在 prompt 确定后调用此方法，使 needsCompaction() 能正确判断
   * prompt + history 是否接近 context window 上限。
   *
   * @param tokens - system prompt 估算的 token 数
   */
  setPromptTokens(tokens: number): void {
    this.promptTokens = tokens;
  }

  /**
   * 获取 system prompt 的 token 数
   */
  getPromptTokens(): number {
    return this.promptTokens;
  }

  /**
   * 追踪新增的历史记录，累加其估算 token 数
   *
   * 每次向 history 追加记录时调用，使 totalTokens 在两次 reportUsage 之间
   * 也能反映 history 的增长（估算值，下次 reportUsage 会用 API 真实值覆盖）。
   *
   * @param record - 新增的历史记录
   */
  trackRecord(record: HistoryRecord): void {
    this.totalTokens += estimateMessageTokens(record);
  }

  /**
   * 获取 context window 大小
   */
  getContextWindow(): number {
    return this.config.contextWindow;
  }

  /**
   * 计算当前使用的 token 数（含 system prompt 处理）
   *
   * 收到真实 usage 后 totalTokens 已含 system prompt，直接用它避免双计；
   * 发送前 totalTokens 仅是 history 估算，需补上 promptTokens。
   */
  private usedTokens(): number {
    return this.hasRealUsage ? this.totalTokens : this.promptTokens + this.totalTokens;
  }

  /**
   * 检查是否需要压缩（低水位）
   *
   * 使用量超过 compactionThreshold 时触发同步 token 预算切割（快速安全网）。
   * 这是便宜、不调 LLM 的兜底路径。
   */
  needsCompaction(): boolean {
    return this.usedTokens() / this.config.contextWindow > this.config.compactionThreshold;
  }

  /**
   * 检查是否需要摘要压缩（高水位）
   *
   * 使用量超过 summarizationThreshold（默认 0.95）时才用 LLM 生成摘要。
   * 与 needsCompaction 构成缓冲带，避免"先同步切掉、摘要拿不到完整记录"。
   */
  needsSummarization(): boolean {
    return this.usedTokens() / this.config.contextWindow > this.config.summarizationThreshold;
  }

  /**
   * 监听需要压缩的信号
   *
   * 当 token 使用量超过阈值时发出信号。
   */
  onCompactionNeeded(): Observable<UsageReport> {
    return this.usage$.pipe(
      filter(() => this.needsCompaction())
    );
  }

  /**
   * 监听压缩完成事件
   */
  onCompaction(): Observable<CompactionResult> {
    return this.compaction$.asObservable();
  }

  /**
   * 规划压缩（不修改 history）
   *
   * 按 token 预算切割：从尾部向前累积各记录的估算 token 数，
   * 累计达到目标预算 budgetTokens = round(contextWindow × compactionBudgetRatio) 即停，
   * 初始切割点 start 落在"超预算前最后一条可纳入的记录"处（保留 [start..length)）。
   * 这样短记录（条数多但 token 少）能保留更多条，长记录（条数少但 token 多）保留更少条。
   *
   * 调用方可先对 removedRecords 生成摘要，再用 applyCompaction 落地。
   *
   * ## 安全切割边界
   *
   * 切割点不能落在 tool_call / tool_result 序列中间——否则会留下"孤儿"
   * 工具消息，OpenAI API 会直接拒绝请求。因此从初始切割点向后推进，
   * 直到遇到一条非工具记录（message / summary）作为保留窗口的起点。
   * 推进到末尾仍全是工具记录时放弃压缩。
   *
   * @param history - 当前对话历史
   * @returns 压缩计划；无需/无法压缩时返回 null
   */
  planCompaction(history: readonly HistoryRecord[]): CompactionPlan | null {
    if (history.length === 0) return null;
    const budgetTokens = Math.round(this.config.contextWindow * this.config.compactionBudgetRatio);

    // 从尾部向前累积估算 token，找保留窗口起点 start（保留 [start..length)）
    let acc = 0;
    let start = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      const t = estimateMessageTokens(history[i]);
      if (acc + t > budgetTokens) break;
      acc += t;
      start = i;
    }
    // 单条记录就超预算：至少保留最后一条（不删光）
    if (start === history.length) start = history.length - 1;
    // 全部记录纳入也不超预算 → 无需压缩
    if (start === 0) return null;

    // 安全切割边界：向后推进，跳过 tool_call/tool_result，直到非工具记录，
    // 保证保留窗口 [cutIndex..] 以非工具消息开头（不切孤儿工具消息）
    let cutIndex = start;
    while (cutIndex < history.length) {
      const record = history[cutIndex];
      if (record && record.type !== 'tool_call' && record.type !== 'tool_result') break;
      cutIndex++;
    }
    // 推进到末尾仍全是工具记录：放弃压缩（cutIndex === 0 已由 start === 0 提前处理，保留兜底）
    if (cutIndex >= history.length || cutIndex === 0) return null;

    return {
      cutIndex,
      removedRecords: history.slice(0, cutIndex),
    };
  }

  /**
   * 落地压缩（修改 history）
   *
   * 移除 history[0..plan.cutIndex)，可选地在头部插入一条摘要记录，
   * 更新 token 计数并发出压缩事件。
   *
   * @param history - 当前对话历史（会被原地修改）
   * @param plan - planCompaction 返回的压缩计划
   * @param summaryRecord - 可选的摘要记录（摘要压缩时传入）
   * @returns 压缩结果
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

    // 净节省 token = 移除的 - 摘要占用的（估算，下次 reportUsage 修正）
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
   *
   * 等价于 planCompaction + applyCompaction（不插摘要）。
   * 用于工具分发路径的快速安全网；摘要压缩走 agent-loop 的异步路径。
   *
   * @param history - 当前对话历史
   * @returns 压缩结果
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

  /**
   * 重置管理器
   */
  reset(): void {
    this.totalTokens = 0;
    this.promptTokens = 0;
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.usage$.complete();
    this.compaction$.complete();
  }
}
