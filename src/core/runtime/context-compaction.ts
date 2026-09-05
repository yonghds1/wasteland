/**
 * context-compaction.ts - 上下文压缩辅助
 *
 * 同步窗口压缩（低水位安全网）与异步摘要压缩（高水位）的触发与落盘逻辑，
 * 从 agent-loop 中抽取以保持核心循环精简。
 */

import type { AgentProvider } from '@providers/provider-types.js';
import type { ContextManager } from './context-manager.js';
import type { SessionManager, SessionMetadata } from './session-manager.js';
import type { HistoryRecord, RuntimeEvent } from './event-types.js';
import { summarizeRecords } from './context-summarizer.js';
import { createTimestamp } from './session-records.js';

/**
 * 检查并执行上下文压缩（在 history 增长后调用）
 *
 * 若触发压缩，返回 context_compacted RuntimeEvent 供 UI 展示；否则返回 null。
 * 压缩本身由 ContextManager.compact() 完成（含安全切割边界处理），
 * 本函数负责同步 history 数组并把结果包装为 UI 事件。
 */
export function maybeCompactContext(params: {
  contextManager: ContextManager;
  history: HistoryRecord[];
  sessionId: string;
  turn: number;
}): RuntimeEvent | null {
  if (!params.contextManager.needsCompaction()) return null;
  const result = params.contextManager.compact(params.history);
  if (result.removedCount === 0) return null;
  // 同步内存 history：移除被压缩的旧记录
  params.history.splice(0, result.removedCount);
  return {
    type: 'context_compacted',
    sessionId: params.sessionId,
    turn: params.turn,
    removedCount: result.removedCount,
    tokensSaved: result.tokensSaved,
    summarized: false,
  };
}

/**
 * 持久化一次上下文压缩事件到会话记录
 *
 * 供 session 索引聚合出会话级压缩统计（可观测性）。压缩函数保持纯逻辑，
 * 由调用方在事件产生后调用本函数落地记录。异步写入不阻塞主流程。
 */
export function persistCompactionRecord(
  sessionManager: SessionManager,
  session: SessionMetadata,
  event: RuntimeEvent
): void {
  if (event.type !== 'context_compacted') return;
  void sessionManager.appendRecord(session, {
    type: 'compaction',
    sessionId: event.sessionId,
    turn: event.turn,
    removedCount: event.removedCount,
    tokensSaved: event.tokensSaved,
    summarized: event.summarized ?? false,
    timestamp: createTimestamp(),
  });
}

/**
 * 异步摘要压缩（usage 事件路径使用）
 *
 * 仅在高水位（summarizationThreshold，默认 0.95）触发，与同步的
 * maybeCompactContext（低水位安全网）构成缓冲带：低水位先做便宜切割，
 * 冲到高水位才用 LLM 生成摘要。这样摘要时 removedRecords 尚未被同步切割
 * 拿走过，能覆盖更完整的早期上下文。
 *
 * 降级策略：未启用摘要、摘要生成失败或返回空时，退回普通窗口压缩，
 * 保证压缩本身一定发生（不会因摘要失败而撑爆 context）。
 */
export async function maybeSummaryCompact(params: {
  contextManager: ContextManager;
  history: HistoryRecord[];
  provider: AgentProvider;
  sessionId: string;
  turn: number;
  cwd: string;
  summarizationEnabled: boolean;
}): Promise<RuntimeEvent | null> {
  if (!params.contextManager.needsSummarization()) return null;
  const plan = params.contextManager.planCompaction(params.history);
  if (!plan) return null;

  // 优先尝试摘要压缩
  if (params.summarizationEnabled) {
    try {
      const summaryText = await summarizeRecords(params.provider, plan.removedRecords, {
        sessionId: params.sessionId,
        turn: params.turn,
        cwd: params.cwd,
      });
      if (summaryText.length > 0) {
        const summaryRecord: import('./event-types.js').SessionSummaryRecord = {
          type: 'summary',
          turn: params.turn,
          content: summaryText,
          summarizedCount: plan.removedRecords.length,
          timestamp: createTimestamp(),
        };
        const result = params.contextManager.applyCompaction(
          params.history,
          plan,
          summaryRecord
        );
        return {
          type: 'context_compacted',
          sessionId: params.sessionId,
          turn: params.turn,
          removedCount: result.removedCount,
          tokensSaved: result.tokensSaved,
          summarized: true,
        };
      }
    } catch {
      // 摘要失败：fall through 到普通压缩
    }
  }

  // 降级：普通窗口压缩（无摘要）
  const result = params.contextManager.applyCompaction(params.history, plan);
  if (result.removedCount === 0) return null;
  return {
    type: 'context_compacted',
    sessionId: params.sessionId,
    turn: params.turn,
    removedCount: result.removedCount,
    tokensSaved: result.tokensSaved,
    summarized: false,
  };
}
