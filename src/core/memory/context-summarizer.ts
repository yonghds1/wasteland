/**
 * context-summarizer.ts - 上下文摘要生成器
 *
 * 上下文压缩时，对被移除的旧消息调用 LLM 生成一段摘要，
 * 替代"直接丢弃"，让模型仍能看到早期对话的关键信息。
 *
 * ## 设计
 *
 * - 把 removedRecords 渲染为纯文本 transcript（role + content；工具调用/结果
 *   压缩成短行），作为一条 user 指令交给 provider。
 * - 复用现有 AgentProvider.runStep（不传 toolRegistry，模型不会触发工具），
 *   收集 assistant_message（缺失时退化为拼接 chunks）。
 * - 带超时保护；失败/空结果由调用方捕获并降级为普通窗口压缩。
 */

import { lastValueFrom, timeout, toArray } from 'rxjs';

import type { AgentProvider } from '@providers/provider-types.js';
import type { ChatInputTurn, HistoryRecord } from '../runtime/event-types.js';
import { createTurnContext } from '../runtime/turn-context.js';
import { createInitialTurnState } from '../engine/turn-state.js';

/** 摘要生成超时（毫秒）——压缩罕见，给足时间但避免挂死 */
const SUMMARIZATION_TIMEOUT_MS = 30000;

/** transcript 中单条工具输出的最大字符数（避免摘要 prompt 过大） */
const TOOL_BODY_LIMIT = 500;

/**
 * 摘要输出的最大字符数
 *
 * 摘要的目的是"省空间"，若模型返回超长摘要则压缩失去意义。
 * 约 2000 字符 ≈ 500-1000 token，远小于被摘要的旧消息块。
 * 超出时截断并标注（截断点取整到换行附近由调用方无感知，直接硬截即可）。
 */
export const SUMMARY_MAX_CHARS = 2000;

/**
 * 对摘要文本施加长度上限
 *
 * @param summary - 模型生成的摘要
 * @param maxChars - 上限（默认 SUMMARY_MAX_CHARS）
 * @returns 不超过上限的摘要文本
 */
export function capSummary(summary: string, maxChars: number = SUMMARY_MAX_CHARS): string {
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars)}\n... [summary truncated]`;
}

/**
 * 把被移除的记录渲染为纯文本 transcript
 */
function formatRecordsForSummary(records: readonly HistoryRecord[]): string {
  const lines: string[] = [];
  for (const record of records) {
    if (record.type === 'message') {
      lines.push(`[${record.role}] ${record.content}`);
    } else if (record.type === 'summary') {
      // 之前的摘要也纳入，让新摘要"滚动"合并旧摘要
      lines.push(`[earlier summary] ${record.content}`);
    } else if (record.type === 'tool_call') {
      lines.push(`[tool call: ${record.toolName}] ${JSON.stringify(record.input ?? {})}`);
    } else if (record.type === 'tool_result') {
      const body = record.status === 'success' ? (record.output ?? '') : (record.error ?? '');
      const short =
        body.length > TOOL_BODY_LIMIT ? `${body.slice(0, TOOL_BODY_LIMIT)}...` : body;
      lines.push(`[tool result: ${record.toolName}] ${short}`);
    }
  }
  return lines.join('\n');
}

/**
 * 用 provider 对一组被移除的记录生成摘要
 *
 * @param provider - 用于生成摘要的 provider（通常复用主 provider）
 * @param records - 被压缩移除的记录
 * @param meta - 会话/轮次/工作目录（构造合成 TurnContext 用）
 * @returns 摘要文本；无有效输出时返回空字符串（由调用方降级处理）
 */
export async function summarizeRecords(
  provider: AgentProvider,
  records: readonly HistoryRecord[],
  meta: { sessionId: string; turn: number; cwd: string }
): Promise<string> {
  const transcript = formatRecordsForSummary(records);
  const instruction =
    `请将以下对话历史压缩成一段简洁的摘要（不超过 ${SUMMARY_MAX_CHARS} 字符），` +
    '保留关键事实、决策、文件路径和上下文，省略寒暄与细节。' +
    '直接输出摘要文本，不要加标题或前缀。\n\n' +
    transcript;

  const input: ChatInputTurn = { turn: meta.turn, content: instruction, source: 'interactive' };
  const context = createTurnContext({
    sessionId: meta.sessionId,
    input,
    cwd: meta.cwd,
    history: [],
    prompt:
      'You are a conversation summarizer. Condense the provided history faithfully and concisely.',
  });
  const state = createInitialTurnState({
    sessionId: meta.sessionId,
    input,
    cwd: meta.cwd,
    history: [],
  });

  const events = await lastValueFrom(
    provider.runStep({ context, state }).pipe(timeout(SUMMARIZATION_TIMEOUT_MS), toArray()),
    { defaultValue: [] }
  );

  // 优先取完整 assistant_message；缺失时退化为拼接 chunks。
  // 两条路径都施加长度上限，防止超长摘要让压缩失去意义。
  const finalMsg = events.find((e) => e.type === 'assistant_message');
  if (finalMsg && finalMsg.type === 'assistant_message' && finalMsg.text.trim().length > 0) {
    return capSummary(finalMsg.text.trim());
  }
  return capSummary(
    events
      .map((e) => (e.type === 'assistant_chunk' ? e.text : ''))
      .join('')
      .trim()
  );
}
