/**
 * intercept-commands.ts - RxJS 操作符：拦截本地命令
 *
 * 用法：
 * ```ts
 * import { interceptCommands } from '@core/shared/intercept-commands.js';
 *
 * input$.pipe(interceptCommands(writer))
 * ```
 *
 * ## 路由规则
 *
 * | 输入类型 | 行为 |
 * |---------|------|
 * | 非 `/` 开头 | 透传到下游（agent 处理） |
 * | `/xxx` 已注册命令 | 执行命令 + 写入 writer + **消费**（不下传） |
 * | `/xxx` provider 工具语法（local `/spawn` 等） | 透传到下游（provider 处理） |
 * | `/xxx` 未注册命令 | 写入错误 + **消费**（不下传，避免 agent 误解） |
 * | 空字符串 | 透传（避免误拦截） |
 *
 * ## 设计
 *
 * - pipeline：调用方一行 `.pipe(interceptCommands(writer))`，无 if-else
 * - 错误策略：未知命令也拦截（防止 `/halp` 变成 agent 对话）；
 *   但 local provider 工具语法（`isLocalToolSyntax`）优先透传，注册命令仍优先于它
 * - 依赖注入：writer 由调用方提供，便于测试和复用
 */

import { EMPTY, of, mergeMap, type MonoTypeOperatorFunction } from 'rxjs';

import type { ChatInputTurn } from '@core/runtime/event-types.js';
import {
  executeCommandSync,
  type SyncCommandResult,
} from './command-executor-sync.js';
import type { CommandWriter } from './command-writer.js';
import { getCommandManager } from './command-manager.js';
import { isLocalToolSyntax } from '@providers/local.js';

/**
 * RxJS 操作符：拦截本地命令，统一调用 writer 渲染结果。
 *
 * @param writer - 命令结果 writer（由调用方注入）
 * @returns MonoTypeOperatorFunction<ChatInputTurn>
 */
export function interceptCommands(
  writer: CommandWriter,
): MonoTypeOperatorFunction<ChatInputTurn> {
  return (source) =>
    source.pipe(
      mergeMap((turn) => routeCommand(turn, writer)),
    );
}

/**
 * 路由单条 turn：命令消费（EMPTY），非命令透传（of(turn)）。
 */
function routeCommand(
  turn: ChatInputTurn,
  writer: CommandWriter,
): import('rxjs').Observable<ChatInputTurn> {
  const input = turn.content.trim();

  // 空输入直接透传（避免误拦截）
  if (input.length === 0) {
    return of(turn);
  }

  // 非 / 开头：透传（agent 处理普通对话）
  if (!input.startsWith('/')) {
    return of(turn);
  }

  // provider 工具语法（local `/spawn` 等）：透传到下游 provider。
  // 注册命令优先（先判注册），未知拼写（`/halp`）仍走错误消费。
  if (!getCommandManager().isCommand(input) && isLocalToolSyntax(input)) {
    return of(turn);
  }

  const firstWord = input.split(/\s+/)[0]?.toLowerCase();
  const cmd = getCommandManager().get(firstWord);
  const passthroughSkills = new Set(["/workflows", "/wf", "/review", "/init", "/status"]);
  if (
    passthroughSkills.has(firstWord) ||
    (cmd?.category === "skill" && !["/help", "/tools", "/skills"].includes(firstWord))
  ) {
    return of(turn);
  }

  // / 开头（含未注册命令）：执行 + 写入 + 消费
  // 关键：拦截所有 / 前缀输入，未注册命令也会被 writer.write(error) 报错
  // 防止 /unknown /halp 等拼写错误变成 agent 对话
  const result: SyncCommandResult = executeCommandSync(input, {
    input,
    context: { mode: 'cli' },
  });
  writer.write(result);
  // EMPTY as Observable<ChatInputTurn>：类型收窄
  return EMPTY as import('rxjs').Observable<ChatInputTurn>;
}