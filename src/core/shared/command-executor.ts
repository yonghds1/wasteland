/**
 * command-executor.ts - 统一命令执行器
 *
 * 提供统一的命令执行逻辑，消除 App.tsx 和 CliInputAdapter 中的重复代码。
 * 所有命令的执行结果都通过这个模块处理，确保一致的行为。
 *
 * ## 设计目标
 *
 * 1. **统一执行逻辑**：所有命令的执行都通过 executeCommand 函数
 * 2. **模式感知**：根据 cli/tui 模式返回不同的结果
 * 3. **可扩展性**：支持添加新的命令处理器
 */

import type { CommandExecutionContext } from './command-manager.js';
import { getCommandManager } from './command-manager.js';

/**
 * 命令执行上下文（扩展版）
 */
export interface ExtendedCommandExecutionContext {
  /** 原始输入 */
  input: string;
  /** 解析后的参数 */
  args: Record<string, unknown>;
  /** 执行上下文 */
  context: CommandExecutionContext['context'];
}

/**
 * 命令执行结果（扩展版）
 *
 * 这是一个联合类型，包含三种可能的结果：
 * - ActionResult: 需要 UI 层处理的动作（清屏、退出、页面切换等）
 * - OutputResult: 直接输出文本
 * - ErrorResult: 错误信息
 */
export type ExtendedCommandResult =
  | ActionResult
  | OutputResult
  | ErrorResult;

/**
 * 动作结果
 */
export interface ActionResult {
  type: 'action';
  action: string;
  data?: Record<string, unknown>;
  /** 是否需要刷新提示符 */
  needsPromptRefresh?: boolean;
  /** 是否需要清屏 */
  needsClearScreen?: boolean;
  /** 是否需要退出 */
  needsExit?: boolean;
  /** 是否需要切换页面 */
  pageTransition?: string;
  /** 是否需要显示帮助对话框 */
  showHelpDialog?: string;
  /** 是否需要切换 agent 模式 */
  modeSwitch?: string;
}

/**
 * 输出结果
 */
export interface OutputResult {
  type: 'output';
  output: string;
  /** 是否需要刷新提示符 */
  needsPromptRefresh?: boolean;
}

/**
 * 错误结果
 */
export interface ErrorResult {
  type: 'error';
  error: string;
  /** 是否需要刷新提示符 */
  needsPromptRefresh?: boolean;
}

/**
 * 执行命令
 *
 * @param input - 用户输入
 * @param context - 执行上下文
 * @returns 执行结果
 */
export async function executeCommand(
  input: string,
  context: ExtendedCommandExecutionContext
): Promise<ExtendedCommandResult> {
  const manager = getCommandManager();

  // 检查是否为已注册的命令
  if (manager.isCommand(input)) {
    const result = await manager.execute(input, context.context);

    // 转换为扩展结果
    return convertToExtendedResult(result, input, context);
  }

  // 未注册的命令
  return {
    type: 'error',
    error: `Unknown command: ${input}`,
    needsPromptRefresh: true,
  };
}

/**
 * 将 CommandResult 转换为 ExtendedCommandResult
 */
function convertToExtendedResult(
  result: { type: string; action?: string; output?: string; error?: string; data?: Record<string, unknown> },
  input: string,
  _context: ExtendedCommandExecutionContext
): ExtendedCommandResult {
  if (result.type === 'output' && result.output) {
    return {
      type: 'output',
      output: result.output,
      needsPromptRefresh: true,
    };
  }

  if (result.type === 'error' && result.error) {
    return {
      type: 'error',
      error: result.error,
      needsPromptRefresh: true,
    };
  }

  if (result.type === 'action' && result.action) {
    const actionResult: ActionResult = {
      type: 'action',
      action: result.action,
      data: result.data,
      needsPromptRefresh: true,
    };

    switch (result.action) {
      case 'clear':
        actionResult.needsClearScreen = true;
        break;
      case 'exit':
        actionResult.needsExit = true;
        break;
      case 'sessions':
        actionResult.pageTransition = 'sessions';
        break;
      case 'help':
        actionResult.showHelpDialog = 'commands';
        break;
      case 'logs':
        actionResult.pageTransition = 'logs';
        break;
      case 'mode':
        // 需要特殊处理，返回原始输入以便解析参数
        actionResult.modeSwitch = input;
        break;
      case 'context':
      case 'status':
      case 'init':
      case 'review':
      case 'skills':
        // 这类命令原本依赖 SkillExecutor 执行。
        // TUI 下统一用 action 透传，App.tsx 接收后输出占位消息并执行 skill。
        // data 携带原始输入以便 handler 解析参数。
        break;
    }

    return actionResult;
  }

  // 默认返回错误
  return {
    type: 'error',
    error: 'Unknown command result',
    needsPromptRefresh: true,
  };
}

/**
 * 检查输入是否为本地命令
 *
 * @param input - 用户输入
 * @returns 是否为本地命令
 */
export function isLocalCommand(input: string): boolean {
  const manager = getCommandManager();
  return manager.isCommand(input) || input.startsWith('/');
}
