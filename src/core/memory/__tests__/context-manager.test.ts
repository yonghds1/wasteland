/**
 * context-manager.test.ts - 上下文管理器单元测试
 *
 * 覆盖：
 * - resolveContextWindow：配置 > 查找表 > 默认值的优先级
 * - truncateToolOutput：超大输出截断（头 + 尾）
 * - trackRecord：增量 token 计数
 * - planCompaction：按 token 预算切割（短记录保留更多、长记录保留更少、工具安全边界）
 * - applyCompaction：含摘要记录的压缩落地
 */

import { describe, it, expect } from 'vitest';
import {
  ContextManager,
  resolveContextWindow,
  truncateToolOutput,
  DEFAULT_TOOL_OUTPUT_TRUNCATION,
} from '../context-manager.js';
import type { HistoryRecord } from '../../runtime/event-types.js';
import type { CompactionResult } from '../context-manager.js';

// ============================================================
// 辅助构造
// ============================================================

function userMsg(turn: number, content: string): HistoryRecord {
  return {
    type: 'message',
    role: 'user',
    turn,
    content,
    timestamp: new Date().toISOString(),
  };
}

function assistantMsg(turn: number, content: string): HistoryRecord {
  return {
    type: 'message',
    role: 'assistant',
    turn,
    content,
    timestamp: new Date().toISOString(),
  };
}

function toolCall(turn: number, callId: string): HistoryRecord {
  return {
    type: 'tool_call',
    sessionId: 's',
    turn,
    callId,
    toolName: 'bash',
    input: {},
    timestamp: new Date().toISOString(),
  };
}

function toolResult(turn: number, callId: string): HistoryRecord {
  return {
    type: 'tool_result',
    sessionId: 's',
    turn,
    callId,
    toolName: 'bash',
    status: 'success',
    output: 'ok',
    timestamp: new Date().toISOString(),
  };
}

/**
 * 可预测 token 的消息：非 CJK 文本 ~4 字符/token。
 * - 'x'.repeat(400)  ≈ 100 tokens
 * - 'x'.repeat(800)  ≈ 200 tokens
 * - 'x'.repeat(1200) ≈ 300 tokens
 */
function tokenBudgetManager(contextWindow = 1000, ratio = 0.6): ContextManager {
  return new ContextManager({ contextWindow, compactionBudgetRatio: ratio });
}

// ============================================================
// resolveContextWindow
// ============================================================

describe('resolveContextWindow', () => {
  it('优先使用用户配置值', () => {
    expect(resolveContextWindow('unknown-model', 99999)).toBe(99999);
  });

  it('忽略非法配置值（0/负数）', () => {
    expect(resolveContextWindow('gpt-4', 0)).toBe(8192);
    expect(resolveContextWindow('gpt-4', -1)).toBe(8192);
  });

  it('精确匹配内置查找表', () => {
    expect(resolveContextWindow('claude-3-5-sonnet')).toBe(200000);
    expect(resolveContextWindow('gpt-4o')).toBe(128000);
  });

  it('模糊匹配带版本后缀的模型名', () => {
    expect(resolveContextWindow('gpt-4o-2024-08-06')).toBe(128000);
  });

  it('未知模型返回默认值', () => {
    expect(resolveContextWindow('some-random-model')).toBe(128000);
  });

  it('大小写不敏感匹配（如 MiniMax-M3 / GLM-5）', () => {
    expect(resolveContextWindow('MiniMax-M3')).toBe(128000);
    expect(resolveContextWindow('GLM-5')).toBe(128000);
    expect(resolveContextWindow('glm-4')).toBe(128000);
  });

  it('未配置时内置查表来自 ProviderProfile（deepseek-v3）', () => {
    expect(resolveContextWindow('deepseek-v3')).toBe(64000);
    expect(resolveContextWindow('deepseek-v2.5')).toBe(32768);
    expect(resolveContextWindow('deepseek-v4')).toBe(128000);
  });
});

// ============================================================
// truncateToolOutput
// ============================================================

describe('truncateToolOutput', () => {
  it('未超限原样返回', () => {
    expect(truncateToolOutput('short')).toBe('short');
  });

  it('undefined 原样返回', () => {
    expect(truncateToolOutput(undefined)).toBeUndefined();
  });

  it('超限时保留头尾并插入截断标记', () => {
    const { maxChars, headChars, tailChars } = DEFAULT_TOOL_OUTPUT_TRUNCATION;
    const text = 'a'.repeat(maxChars + 1000);
    const result = truncateToolOutput(text);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThan(text.length);
    expect(result).toContain('[truncated');
    expect(result!.startsWith('a'.repeat(headChars))).toBe(true);
    expect(result!.endsWith('a'.repeat(tailChars))).toBe(true);
  });

  it('支持自定义配置', () => {
    const text = 'x'.repeat(100);
    const result = truncateToolOutput(text, { maxChars: 50, headChars: 20, tailChars: 10 });
    expect(result).toContain('[truncated 70 characters]');
  });
});

// ============================================================
// trackRecord
// ============================================================

describe('trackRecord', () => {
  it('累加估算 token 数', () => {
    const manager = new ContextManager({ contextWindow: 100000 });
    expect(manager.getTotalTokens()).toBe(0);
    manager.trackRecord(userMsg(1, 'hello world'));
    expect(manager.getTotalTokens()).toBeGreaterThan(0);
  });
});

// ============================================================
// planCompaction 按 token 预算切割
// ============================================================
// 预算 = round(contextWindow × compactionBudgetRatio)（默认 contextWindow=1000 × 0.6 = 600）。
// 从尾部向前累积 estimateMessageTokens，达到预算即停，短记录保留更多、长记录保留更少。

describe('planCompaction', () => {
  it('空 history 返回 null', () => {
    const manager = tokenBudgetManager();
    expect(manager.planCompaction([])).toBeNull();
  });

  it('全部记录不超过预算时返回 null', () => {
    const manager = tokenBudgetManager(); // budget 600
    // 5 × 100 tokens = 500 ≤ 600，全部纳入
    const history: HistoryRecord[] = Array.from({ length: 5 }, (_, i) =>
      userMsg(i + 1, 'x'.repeat(400))
    );
    expect(manager.planCompaction(history)).toBeNull();

    // 大 contextWindow 下小历史同样无需压缩
    const big = new ContextManager({ contextWindow: 100000 });
    expect(big.planCompaction(history)).toBeNull();
  });

  it('短记录(条数多但 token 少)保留更多条', () => {
    const manager = tokenBudgetManager(); // budget 600
    // 7 × 100 tokens = 700 > 600：尾部累积到 6 条(600)刚好在预算内，第 7 条(700)超限
    const history: HistoryRecord[] = Array.from({ length: 7 }, (_, i) =>
      userMsg(i + 1, 'x'.repeat(400))
    );
    const plan = manager.planCompaction(history);
    expect(plan).not.toBeNull();
    // 保留 6 条，只移除第 1 条
    expect(plan!.cutIndex).toBe(1);
    expect(plan!.removedRecords.length).toBe(1);
    expect(plan!.removedRecords[0]).toEqual(history[0]);
  });

  it('长记录(条数少但 token 多)保留更少条', () => {
    const manager = tokenBudgetManager(); // budget 600
    // 7 × 200 tokens = 1400 > 600：尾部累积到 3 条(600)在预算内，第 4 条(800)超限
    const history: HistoryRecord[] = Array.from({ length: 7 }, (_, i) =>
      userMsg(i + 1, 'x'.repeat(800))
    );
    const plan = manager.planCompaction(history);
    expect(plan).not.toBeNull();
    // 只保留 3 条，移除 4 条（短记录场景移除 1 条，长记录移除更多）
    expect(plan!.cutIndex).toBe(4);
    expect(plan!.removedRecords.length).toBe(4);
    expect(plan!.removedRecords[0]).toEqual(history[0]);
  });

  it('单条记录就超预算时至少保留最后一条（不删光）', () => {
    const manager = tokenBudgetManager(); // budget 600
    const history: HistoryRecord[] = [
      userMsg(1, 'x'.repeat(400)), // 100 tokens
      userMsg(2, 'x'.repeat(4000)), // 1000 tokens > 600，单条即超预算
    ];
    const plan = manager.planCompaction(history);
    expect(plan).not.toBeNull();
    // 保留超预算的最后一条，移除旧的较小记录
    expect(plan!.cutIndex).toBe(1);
    expect(plan!.removedRecords.length).toBe(1);
    expect(plan!.removedRecords[0]).toEqual(history[0]);
  });

  it('切割点跳过 tool_call/tool_result，不拆散工具配对', () => {
    const manager = tokenBudgetManager(); // budget 600
    const history: HistoryRecord[] = [
      userMsg(1, 'x'.repeat(1200)), // 300 tokens
      toolCall(1, 'c1'), // ~1 token
      toolResult(1, 'c1'), // ~11 tokens
      assistantMsg(1, 'x'.repeat(400)), // 100 tokens
      userMsg(2, 'x'.repeat(400)), // 100 tokens
      assistantMsg(2, 'x'.repeat(400)), // 100 tokens
    ];
    const plan = manager.planCompaction(history);
    expect(plan).not.toBeNull();
    // 初始累积停在第 1 条(tool_call)，向后推进到第 3 条(message)作为保留窗口起点
    expect(plan!.cutIndex).toBe(3);
    const boundary = history[plan!.cutIndex];
    expect(boundary?.type).toBe('message');
    // 工具配对完整保留在 removedRecords 内，未被切割点拆散
    expect(plan!.removedRecords.map((r) => r.type)).toEqual([
      'message',
      'tool_call',
      'tool_result',
    ]);
  });

  it('保留窗口起点之后全是工具记录时放弃压缩', () => {
    const manager = tokenBudgetManager(); // budget 600
    const history: HistoryRecord[] = [
      userMsg(1, 'x'.repeat(2400)), // 600 tokens
      toolCall(1, 'c1'), // ~1 token
      toolResult(1, 'c1'), // ~11 tokens
      toolCall(2, 'c2'), // ~1 token
      toolResult(2, 'c2'), // ~11 tokens
    ];
    // 累积停在 tool_call 上，向后推进到末尾仍全是工具记录 → 无法找到安全边界 → null
    expect(manager.planCompaction(history)).toBeNull();
  });
});

// ============================================================
// applyCompaction（含摘要）
// ============================================================

describe('applyCompaction', () => {
  const budgetHistory = (): HistoryRecord[] => [
    userMsg(1, 'q1'.repeat(400)), // 800 字符 ≈ 200 tokens
    assistantMsg(1, 'a1'.repeat(400)), // 200 tokens
    userMsg(2, 'q2'.repeat(400)), // 200 tokens
    assistantMsg(2, 'a2'.repeat(400)), // 200 tokens
  ];

  it('无摘要：移除旧记录', () => {
    const manager = tokenBudgetManager(); // budget 600，history 800 tokens > 600
    const history = budgetHistory();
    const plan = manager.planCompaction(history)!;
    expect(plan).toBeDefined();
    const result = manager.applyCompaction(history, plan);
    expect(result.removedCount).toBeGreaterThan(0);
    expect(history.length).toBe(result.newLength);
    // 保留的是最近的记录（比较内容，避免时间戳差异）
    const last = history[history.length - 1];
    expect(last?.type).toBe('message');
    expect(last?.type === 'message' && last.content).toBe('a2'.repeat(400));
  });

  it('含摘要：头部插入 summary 记录', () => {
    const manager = tokenBudgetManager();
    const history = budgetHistory();
    const plan = manager.planCompaction(history)!;
    const summary: HistoryRecord = {
      type: 'summary',
      turn: 2,
      content: 'earlier context',
      summarizedCount: plan.removedRecords.length,
      timestamp: new Date().toISOString(),
    };
    const result = manager.applyCompaction(history, plan, summary);
    expect(result.removedCount).toBeGreaterThan(0);
    // 头部是摘要记录
    expect(history[0]?.type).toBe('summary');
  });

  it('tokensSaved 扣除摘要占用', () => {
    const manager = tokenBudgetManager();
    const history = budgetHistory();
    const plan = manager.planCompaction(history)!;
    const noSummary = tokenBudgetManager();
    const h2 = [...history];
    const plan2 = noSummary.planCompaction(h2)!;
    const resultNoSummary = noSummary.applyCompaction(h2, plan2);

    const summary: HistoryRecord = {
      type: 'summary',
      turn: 2,
      content: 'big summary '.repeat(10),
      summarizedCount: plan.removedRecords.length,
      timestamp: new Date().toISOString(),
    };
    const resultWithSummary = manager.applyCompaction(history, plan, summary);

    // 有摘要时净节省更少
    expect(resultWithSummary.tokensSaved).toBeLessThan(resultNoSummary.tokensSaved);
  });
});

// ============================================================
// needsCompaction 双计修复
// ============================================================
// totalTokens 有两种来源口径：
//   - 发送前：trackRecord 的 history 估算（不含 system prompt）→ 需补 promptTokens
//   - usage 后：API 完整 total（已含 system prompt）→ 直接使用，避免双计

describe('needsCompaction', () => {
  it('发送前（仅估算）将 promptTokens 计入', () => {
    // window=1000, threshold=0.8 → 阈值 800
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(700); // system prompt 估算
    // 700 / 1000 = 0.7 < 0.8，不应压缩
    expect(manager.needsCompaction()).toBe(false);

    manager.setPromptTokens(900); // 900 / 1000 = 0.9 > 0.8，应压缩
    expect(manager.needsCompaction()).toBe(true);
  });

  it('usage 后 totalTokens 已含 prompt，不再双计', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(600); // system prompt（估算，与 usage 无关）

    // API total 700（已含 system prompt），若双计则 600+700=1300 > 800 → 误压缩
    manager.reportUsage({ promptTokens: 600, completionTokens: 100, totalTokens: 700 });
    expect(manager.needsCompaction()).toBe(false);

    // API total 900 > 800，应压缩
    manager.reportUsage({ promptTokens: 800, completionTokens: 100, totalTokens: 900 });
    expect(manager.needsCompaction()).toBe(true);
  });

  it('usage 后估算的 promptTokens 不再叠加到真实 total', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(500);
    // 场景：usage total 恰好低于阈值，但被移除的历史仍在 promptTokens 中
    manager.reportUsage({ promptTokens: 500, completionTokens: 50, totalTokens: 550 });
    // 550 / 1000 = 0.55 < 0.8，不应压缩
    expect(manager.needsCompaction()).toBe(false);
  });
});

// ============================================================
// needsSummarization 高水位（缓冲带）
// ============================================================
// 低水位 compactionThreshold 触发同步切割安全网，高水位
// summarizationThreshold 才触发异步摘要。两水位构成缓冲带。

describe('needsSummarization', () => {
  it('默认高水位 0.95：超过才判定为需摘要', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(900); // 0.9 > 0.8（低水位），但 < 0.95（高水位）
    // 低水位：应同步切割
    expect(manager.needsCompaction()).toBe(true);
    // 高水位：尚不需摘要
    expect(manager.needsSummarization()).toBe(false);

    manager.setPromptTokens(960); // 0.96 > 0.95
    expect(manager.needsSummarization()).toBe(true);
  });

  it('自定义 summarizationThreshold 生效', () => {
    const manager = new ContextManager({
      contextWindow: 1000,
      compactionThreshold: 0.8,
      summarizationThreshold: 0.9,
    });
    manager.setPromptTokens(850); // 0.85
    expect(manager.needsCompaction()).toBe(true);
    expect(manager.needsSummarization()).toBe(false);

    manager.setPromptTokens(920); // 0.92
    expect(manager.needsSummarization()).toBe(true);
  });

  it('usage 后同样避免 system prompt 双计', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(600);
    // API total 700（已含 prompt），0.7 < 0.95
    manager.reportUsage({ promptTokens: 600, completionTokens: 100, totalTokens: 700 });
    expect(manager.needsSummarization()).toBe(false);
    // API total 960 > 0.95
    manager.reportUsage({ promptTokens: 800, completionTokens: 160, totalTokens: 960 });
    expect(manager.needsSummarization()).toBe(true);
  });
});

// ============================================================
// getter / reset / compact / 事件流
// ============================================================

describe('ContextManager 状态管理', () => {
  it('getContextWindow 返回配置值', () => {
    const manager = new ContextManager({ contextWindow: 123456 });
    expect(manager.getContextWindow()).toBe(123456);
  });

  it('getPromptTokens / getTotalTokens 反映当前状态', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    expect(manager.getPromptTokens()).toBe(0);
    expect(manager.getTotalTokens()).toBe(0);
    manager.setPromptTokens(300);
    expect(manager.getPromptTokens()).toBe(300);
    manager.reportUsage({ promptTokens: 200, completionTokens: 50, totalTokens: 250 });
    expect(manager.getTotalTokens()).toBe(250);
  });

  it('reset 清空 prompt 与 total token', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    manager.setPromptTokens(300);
    manager.reportUsage({ promptTokens: 200, completionTokens: 50, totalTokens: 250 });
    manager.reset();
    expect(manager.getPromptTokens()).toBe(0);
    expect(manager.getTotalTokens()).toBe(0);
  });

  it('compact 无摘要快速压缩并返回结果', () => {
    const manager = tokenBudgetManager(); // budget 600，history 800 tokens > 600
    const history: HistoryRecord[] = [
      userMsg(1, 'x'.repeat(800)), // 200 tokens
      assistantMsg(1, 'x'.repeat(800)), // 200
      userMsg(2, 'x'.repeat(800)), // 200
      assistantMsg(2, 'x'.repeat(800)), // 200
    ];
    const result = manager.compact(history);
    expect(result.removedCount).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(history.length).toBeLessThan(4);
  });

  it('compact 全部记录不超预算时不压缩', () => {
    const manager = tokenBudgetManager(); // budget 600
    const history: HistoryRecord[] = [userMsg(1, 'a'), assistantMsg(1, 'b')];
    const result = manager.compact(history);
    expect(result.removedCount).toBe(0);
    expect(result.tokensSaved).toBe(0);
    expect(history.length).toBe(2);
  });

  it('onCompaction 发出压缩事件', async () => {
    const manager = tokenBudgetManager(); // budget 600，history 800 tokens > 600
    const history: HistoryRecord[] = [
      userMsg(1, 'x'.repeat(800)),
      assistantMsg(1, 'x'.repeat(800)),
      userMsg(2, 'x'.repeat(800)),
      assistantMsg(2, 'x'.repeat(800)),
    ];
    let emitted: CompactionResult | undefined;
    manager.onCompaction().subscribe((r) => (emitted = r));
    manager.compact(history);
    expect(emitted).toBeDefined();
    expect(emitted!.removedCount).toBeGreaterThan(0);
  });

  it('onCompactionNeeded 在超阈值时发出 usage 信号', async () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    let signaled = false;
    manager.onCompactionNeeded().subscribe(() => (signaled = true));
    // 未超阈值：reportUsage 不触发
    manager.reportUsage({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(signaled).toBe(false);
    // 超阈值：触发
    manager.reportUsage({ promptTokens: 800, completionTokens: 100, totalTokens: 900 });
    expect(signaled).toBe(true);
  });

  it('destroy 完成后不再发出事件', () => {
    const manager = new ContextManager({ contextWindow: 1000 });
    let events = 0;
    manager.onCompaction().subscribe(() => events++);
    manager.destroy();
    // 完成后订阅立即结束，后续 compact 不应再触发
    manager.compact([]);
    expect(events).toBe(0);
  });
});
