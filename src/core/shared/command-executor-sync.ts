/**
 * command-executor-sync.ts - 同步命令执行器
 *
 * 提供同步的命令执行逻辑，用于 RxJS 流等不支持 async/await 的场景。
 * 这是 command-executor.ts 的同步版本。
 */

import { getCommandManager } from './command-manager.js';

/**
 * 命令执行上下文
 */
export interface SyncCommandExecutionContext {
  /** 原始输入 */
  input: string;
  /** 执行上下文 */
  context: {
    /** 执行模式 */
    mode: 'cli' | 'tui';
  };
}

/**
 * 命令执行结果
 */
export type SyncCommandResult =
  | SyncActionResult
  | SyncOutputResult
  | SyncErrorResult;

/**
 * 动作结果
 */
export interface SyncActionResult {
  type: 'action';
  action: string;
  data?: Record<string, unknown>;
}

/**
 * 输出结果
 */
export interface SyncOutputResult {
  type: 'output';
  output: string;
}

/**
 * 错误结果
 */
export interface SyncErrorResult {
  type: 'error';
  error: string;
}

/**
 * 执行命令（同步版本）
 *
 * 与异步 executeCommand 共享 ArgParser 解析逻辑，保证 TUI/CLI 行为一致。
 *
 * @param input - 用户输入
 * @param context - 执行上下文
 * @returns 执行结果
 */
export function executeCommandSync(
  input: string,
  context: SyncCommandExecutionContext
): SyncCommandResult {
  const manager = getCommandManager();

  // 用统一的 ArgParser 解析命令和参数（与异步执行器共用 parse 逻辑）
  const parsed = manager.parse(input);
  if (!parsed) {
    // 不是已注册命令：保留 raw input 给上层决定 fallback 或报错
    return { type: 'error', error: `Unknown command: ${input}` };
  }

  // 根据命令名处理（parsed.args 来自 ArgParser，支持 --flag / 位置参数 / 引号）
  switch (parsed.command) {
    case '/clear':
      return { type: 'action', action: 'clear' };
    case '/exit':
    case '/quit':
      return { type: 'action', action: 'exit' };
    case '/sessions':
      return { type: 'action', action: 'sessions' };
    case '/help':
      return { type: 'action', action: 'help' };
    case '/mode':
      // /mode single|multi 参数由上层解析（写配置是异步 IO）
      return { type: 'action', action: 'mode' };
    case '/logs':
      if (context.context.mode === 'tui') {
        return { type: 'action', action: 'logs' };
      }
      return { type: 'output', output: 'Logs page is only available in TUI mode.' };
    case '/context':
    case '/ctx':
      if (context.context.mode === 'tui') {
        return {
          type: 'action',
          action: 'context',
          data: { sessionId: parsed.args['session-id'] },
        };
      }
      return { type: 'output', output: 'Context usage: (CLI mode - limited info)' };
    case '/tools':
      return {
        type: 'output',
        output: [
          'Local tool syntax:',
          '  /read <path>           Read file contents',
          '  /write <path> <text>   Write to file',
          '  /edit <path> <old> <new>  Edit file (replace text)',
          '  /bash <command>        Execute shell command',
          '  /glob <pattern>        Find files by pattern',
          '  /grep <pattern>        Search file contents',
          '  /ls [path]             List directory contents',
        ].join('\n'),
      };
    case '/skills': {
      // 从 CommandManager 派生可用技能列表（不再硬编码 "Skills not available."）
      const manager = getCommandManager();
      const skillEntries = manager.getByCategory('skill');
      if (skillEntries.length === 0) {
        return { type: 'output', output: 'No skills available.' };
      }
      const skillsLines = ['Available skills:'];
      for (const entry of skillEntries) {
        const aliases = entry.aliases.length > 0
          ? ` (${entry.aliases.join(', ')})`
          : '';
        skillsLines.push(`  ${entry.name}${aliases}`);
      }
      return { type: 'output', output: skillsLines.join('\n') };
    }
    case '/status':
    case '/init':
    case '/review':
      // 由 SkillExecutor 处理：返回 action + 透传 args
      return {
        type: 'action',
        action: parsed.command.slice(1),
        data: { ...parsed.args },
      };
    default:
      return { type: 'error', error: `Unknown command: ${input}` };
  }
}

/**
 * 检查输入是否为本地命令
 *
 * @param input - 用户输入
 * @returns 是否为本地命令
 */
export function isLocalCommandSync(input: string): boolean {
  if (!input.trim().startsWith('/')) return false;
  const manager = getCommandManager();
  const word = (input.trim().split(/\s+/)[0] ?? '').toLowerCase();
  return manager.isCommand(word);
}

/**
 * 检查是否是退出命令
 *
 * @param input - 用户输入
 * @returns 是否是退出命令
 */
export function isExitCommandSync(input: string): boolean {
  if (!input.trim().startsWith('/')) return false;
  const manager = getCommandManager();
  const cmd = manager.get(input.trim().split(/\s+/)[0] ?? '');
  return cmd !== undefined && cmd.category === 'exit';
}
