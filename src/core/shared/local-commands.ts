/**
 * local-commands.ts - 本地命令处理
 *
 * 提取 CLI 和 TUI 共享的本地命令处理逻辑，包括：
 * - /help: 显示帮助
 * - /tools: 显示工具语法
 * - /skills: 显示可用技能
 * - /clear: 清屏
 * - /exit, /quit: 退出
 */

import type { SkillExecutor } from '../../skills/skill-executor.js';

// ============================================================
// Types
// ============================================================

/**
 * 本地命令结果
 */
export type LocalCommandResult = {
  /** 是否处理了该命令 */
  handled: boolean;
  /** 命令输出内容 */
  output?: string;
  /** 特殊动作标识 */
  action?: 'clear' | 'exit' | 'help' | 'sessions';
};

/**
 * executeLocalCommand 参数
 */
export type ExecuteLocalCommandParams = {
  /** 用户输入的命令（如 /help） */
  command: string;
  /** 技能执行器（可选，用于 /skills 命令） */
  skillExecutor?: SkillExecutor;
};

// ============================================================
// 常量
// ============================================================

/** 退出命令集合 */
const EXIT_COMMANDS = new Set(['/exit', '/quit']);

/** 本地命令集合 */
const LOCAL_COMMANDS = new Set(['/help', '/tools', '/clear', '/skills', '/sessions']);

// ============================================================
// Main Function
// ============================================================

/**
 * 执行本地命令
 *
 * 处理 /help, /tools, /skills, /clear, /exit, /quit 命令。
 * 返回 LocalCommandResult，包含是否处理了该命令、输出内容和动作标识。
 *
 * @param params - 命令参数
 * @returns LocalCommandResult
 */
export function executeLocalCommand(
  params: ExecuteLocalCommandParams
): LocalCommandResult {
  const { command, skillExecutor } = params;
  const trimmedCommand = command.trim().toLowerCase();

  // /exit 或 /quit: 返回退出动作
  if (EXIT_COMMANDS.has(trimmedCommand)) {
    return {
      handled: true,
      action: 'exit',
    };
  }

  // /help: 返回帮助文本
  if (trimmedCommand === '/help') {
    return {
      handled: true,
      output: createHelpText(),
      action: 'help',
    };
  }

  // /tools: 返回工具语法
  if (trimmedCommand === '/tools') {
    return {
      handled: true,
      output: createToolsText(),
    };
  }

  // /skills: 返回技能列表
  if (trimmedCommand === '/skills') {
    if (skillExecutor) {
      const skillsHelp = skillExecutor.createSkillsHelp();
      return {
        handled: true,
        output: createSkillsText(skillsHelp),
      };
    }
    // 没有 skillExecutor 时，返回提示
    return {
      handled: true,
      output: 'Skills not available.',
    };
  }

  // /clear: 返回清屏动作
  if (trimmedCommand === '/clear') {
    return {
      handled: true,
      action: 'clear',
    };
  }

  // /sessions: 进入 session 索引页（列出历史会话供浏览）
  if (trimmedCommand === '/sessions') {
    return {
      handled: true,
      action: 'sessions',
    };
  }

  // 未处理的命令
  return {
    handled: false,
  };
}

/**
 * 检查是否是本地命令
 *
 * @param command - 用户输入
 * @returns 是否是本地命令
 */
export function isLocalCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return LOCAL_COMMANDS.has(trimmed) || EXIT_COMMANDS.has(trimmed);
}

/**
 * 检查是否是退出命令
 *
 * @param command - 用户输入
 * @returns 是否是退出命令
 */
export function isExitCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return EXIT_COMMANDS.has(trimmed);
}

// ============================================================
// Text Generators
// ============================================================

/**
 * 创建帮助文本
 * @returns 帮助信息
 */
function createHelpText(): string {
  return [
    'Session commands:',
    '  /help   Show interactive help',
    '  /tools  Show current local tool syntax',
    '  /skills Show available skills',
    '  /clear  Clear screen and redraw',
    '  /sessions  List and browse past sessions',
    '  /exit   Exit the session',
  ].join('\n');
}

/**
 * 创建工具语法文本
 * @returns 工具语法信息
 */
function createToolsText(): string {
  return [
    'Local tool syntax:',
    '  /read <path>           Read file contents',
    '  /write <path> <text>   Write to file',
    '  /edit <path> <old> <new>  Edit file (replace text)',
    '  /bash <command>        Execute shell command',
    '  /glob <pattern>        Find files by pattern',
    '  /grep <pattern>        Search file contents',
    '  /ls [path]             List directory contents',
  ].join('\n');
}

/**
 * 创建技能文本
 * @param skillsHelp - 技能帮助信息
 * @returns 技能信息
 */
function createSkillsText(skillsHelp: string): string {
  return [`Available skills:`, skillsHelp].join('\n');
}
