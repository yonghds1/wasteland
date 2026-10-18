/**
 * intercept-commands.ts - RxJS 操作符：拦截本地命令
 *
 * 用法：
 * ```ts
 * import { interceptCommands } from '@core/shared/intercept-commands.js';
 *
 * input$.pipe(interceptCommands(writer, { passthroughUnknown: true }))
 * ```
 *
 * ## 路由规则
 *
 * | 输入类型 | 行为 |
 * |---------|------|
 * | 非 `/` 开头 | 透传到下游（agent 处理） |
 * | `/xxx` 已注册命令 | 执行命令 + 写入 writer + **消费**（不下传） |
 * | `/xxx` provider 工具语法（local `/spawn` 等） | 透传到下游（provider 处理） |
 * | `/xxx` 未注册命令 | passthroughUnknown=true 时透传到下游；否则写入错误 + **消费** |
 * | 空字符串 | 透传（避免误拦截） |
 *
 * ## 设计
 *
 * - pipeline：调用方一行 `.pipe(interceptCommands(writer))`，无 if-else
 * - 错误策略：默认未知命令也拦截（防止交互式下 `/halp` 变成 agent 对话）；
 *   但在单轮/无头模式下通过 `passthroughUnknown: true` 放行，避免以文件路径开头的 prompt（如 `/src/app.ts 语法错误`）被误杀
 * - local provider 工具语法（`isLocalToolSyntax`）优先透传，注册命令仍优先于它
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

export interface InterceptCommandsOptions {
  /**
   * 当命令为未知命令时，是否放行作为普通聊天消息（of(turn)）给下游 Agent。
   * 单轮 / 无头模式下建议设置为 true，防止以路径开头的 prompt（如 `/src/app.ts 语法错误`）被误拦截。
   * @default false
   */
  passthroughUnknown?: boolean;
}

/**
 * RxJS 操作符：拦截本地命令，统一调用 writer 渲染结果。
 *
 * @param writer - 命令结果 writer（由调用方注入）
 * @param options - 拦截选项
 * @returns MonoTypeOperatorFunction<ChatInputTurn>
 */
export function interceptCommands(
  writer: CommandWriter,
  options?: InterceptCommandsOptions,
): MonoTypeOperatorFunction<ChatInputTurn> {
  return (source) =>
    source.pipe(
      mergeMap((turn) => routeCommand(turn, writer, options)),
    );
}

/**
 * 路由单条 turn：命令消费（EMPTY），非命令透传（of(turn)）。
 */
function routeCommand(
  turn: ChatInputTurn,
  writer: CommandWriter,
  options?: InterceptCommandsOptions,
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

  // 若为已识别的技能命令（内置或外部动态安装），放行至下游执行
  if (writer.isSkillCommand?.(input)) {
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

  // 执行命令
  const result: SyncCommandResult = executeCommandSync(input, {
    input,
    context: { mode: 'cli' },
  });

  const isUnknown = result.type === 'error' && result.error.startsWith('Unknown command:');
  if (isUnknown && options?.passthroughUnknown) {
    return of(turn);
  }

  writer.write(result);
  return EMPTY as import('rxjs').Observable<ChatInputTurn>;
}
