/**
 * file-audit.ts - 文件访问审计
 *
 * 提供基于 TurnState 的 read-before-edit 安全检查。
 * 检查当前 turn 内是否已调用过 read-file 工具。
 *
 * ## 设计原则
 *
 * - 不引入新的运行时状态，复用已有的 TurnState
 * - 检查函数保持同步，不 RxJS 化
 * - 参考 Claude Code 的 read-before-edit 机制
 *
 * ## 限制
 *
 * 当前只检查当前 turn 内的工具调用记录。
 * 未来可扩展为读取完整 session 文件，检查整个会话历史。
 */

import type { ToolCall } from '@tools/tool-types.js';

import { t } from '@locales/index.js';
import { Logger } from '@core/logger/index.js';
import type { TurnState } from '../engine/turn-state.js';

/**
 * 检查 read-before-edit 约束
 *
 * 检查当前 turn 内是否已调用过 read-file 工具。
 *
 * @param params.toolName - 工具名称（用于判断是否需要检查）
 * @param params.filePath - 目标文件路径
 * @param params.turnState - 当前 turn 状态
 * @returns 检查结果，ok 为 true 表示通过检查，error 包含错误消息
 *
 * @example
 * const check = checkReadBeforeEdit({
 *   toolName: "edit-file",
 *   filePath: "/path/to/file.ts",
 *   turnState: state,
 * });
 *
 * if (!check.ok) {
 *   return { status: "error", error: check.error };
 * }
 */
export function checkReadBeforeEdit(params: {
  toolName: string;
  filePath: string;
  turnState: TurnState;
  sessionId?: string;
  turn?: number;
}): { ok: boolean; error?: string } {
  const { toolName, filePath, turnState, sessionId, turn } = params;

  // 只对 edit-file 和 write-file 进行检查
  if (toolName !== 'edit-file' && toolName !== 'write-file') {
    Logger.debug({
      sessionId: sessionId ?? 'unknown',
      turn,
      scope: 'file',
      message: 'file.read-before-edit.skipped',
      data: { toolName, filePath, reason: 'not-edit-or-write' },
    });
    return { ok: true };
  }

  // 检查当前 turn 内是否已调用过 read-file
  if (hasFileBeenReadInTurn(filePath, turnState.toolCalls)) {
    Logger.info({
      sessionId: sessionId ?? 'unknown',
      turn,
      scope: 'file',
      message: 'file.read-before-edit.allowed',
      data: { toolName, filePath },
    });
    return { ok: true };
  }

  // 未读取，返回错误
  Logger.warn({
    sessionId: sessionId ?? 'unknown',
    turn,
    scope: 'file',
    message: 'file.read-before-edit.denied',
    data: { toolName, filePath },
  });
  return {
    ok: false,
    error: `${t('runtime.mustReadBeforeEdit')} ${filePath}`,
  };
}

/**
 * 检查文件是否在当前 turn 内被读取
 *
 * @param filePath - 目标文件路径
 * @param toolCalls - 当前 turn 内的工具调用记录
 * @returns true 表示已读取，false 表示未读取
 */
function hasFileBeenReadInTurn(filePath: string, toolCalls: readonly ToolCall[]): boolean {
  return toolCalls.some((call) => call.toolName === 'read-file' && call.input.path === filePath);
}
