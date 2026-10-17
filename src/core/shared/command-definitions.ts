/**
 * command-definitions.ts - 内置命令定义
 *
 * 使用新的 CommandManager 架构定义所有内置命令。
 * 每个命令包含完整的元数据、参数定义和执行逻辑。
 *
 * 命令清单：
 * - /clear        - 清屏
 * - /sessions     - 进入 session 索引页
 * - /logs         - 路由到 logs page
 * - /mode         - 切换 single/multi 模式
 * - /context      - 显示 context 使用情况
 * - /help         - 显示帮助
 * - /tools        - 显示工具语法
 * - /skills       - 显示可用技能
 * - /exit, /quit  - 退出 wasteland
 * - /status       - 显示状态信息
 * - /init         - 初始化项目上下文
 * - /review       - 代码审查
 */

import type { CommandDefinition, CommandExecutionContext, CommandResult } from './command-manager.js';
import { getCommandManager } from './command-manager.js';
import {
  createHelpToolsSection,
  createHelpSkillsSection
} from './command-handlers.js';

// ============================================================
// 命令定义
// ============================================================

/**
 * /clear - 清屏命令
 */
export const clearCommand: CommandDefinition = {
  name: '/clear',
  aliases: [],
  category: 'local',
  description: 'skills.help.localCommands.clear',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    return { type: 'action', action: 'clear' };
  },
};

/**
 * /sessions - Session 索引页命令
 */
export const sessionsCommand: CommandDefinition = {
  name: '/sessions',
  aliases: [],
  category: 'session',
  description: 'skills.help.localCommands.sessions',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    return { type: 'action', action: 'sessions' };
  },
};

/**
 * /logs - 日志路由命令
 */
export const logsCommand: CommandDefinition = {
  name: '/logs',
  aliases: [],
  category: 'local',
  description: 'skills.help.localCommands.logs',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 在 TUI 模式下返回 action，由 App.tsx 处理路由
    // 在 CLI 模式下返回提示信息
    if (_params.context.mode === 'tui') {
      return { type: 'action', action: 'logs' };
    } else {
      return { type: 'output', output: 'Logs page is only available in TUI mode.' };
    }
  },
};

/**
 * /mode - 模式切换命令
 */
export const modeCommand: CommandDefinition = {
  name: '/mode',
  aliases: [],
  category: 'local',
  description: 'skills.help.localCommands.mode',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 只返回 action，写配置是异步 IO，由 App.tsx / CLI 适配层拦截落地
    return { type: 'action', action: 'mode' };
  },
};

/**
 * /context - Context 使用情况命令
 */
export const contextCommand: CommandDefinition = {
  name: '/context',
  aliases: ['/ctx'],
  category: 'local',
  description: 'skills.help.localCommands.context',
  args: [
    { name: 'session-id', type: 'string', optional: true, description: 'Session ID to view' },
  ],
  execute: async (params: CommandExecutionContext): Promise<CommandResult> => {
    const sessionId = params.args['session-id'] as string | undefined;

    if (params.context.mode === 'tui') {
      // TUI 模式下返回 action，由 App.tsx 处理
      return { type: 'action', action: 'context', data: { sessionId } };
    } else {
      // CLI 模式下返回提示信息
      if (sessionId) {
        return { type: 'output', output: `Context for session ${sessionId}: (CLI mode - limited info)` };
      }
      return { type: 'output', output: 'Context usage: (CLI mode - limited info)' };
    }
  },
};

/**
 * /help - 帮助命令
 */
export const helpCommand: CommandDefinition = {
  name: '/help',
  aliases: ['/h'],
  category: 'skill',
  description: 'skills.help.description',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 返回 action，由 App.tsx 拦截打开 help dialog
    return { type: 'action', action: 'help' };
  },
};

/**
 * /tools - 工具语法命令
 */
export const toolsCommand: CommandDefinition = {
  name: '/tools',
  aliases: [],
  category: 'skill',
  description: 'skills.tools.description',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    const output = createHelpToolsSection().join('\n');
    return { type: 'output', output };
  },
};

/**
 * /skills - 技能列表命令
 */
export const skillsCommand: CommandDefinition = {
  name: '/skills',
  aliases: [],
  category: 'local',
  description: 'skills.common.availableSkills',
  execute: async (params: CommandExecutionContext): Promise<CommandResult> => {
    // 如果有 skillExecutor，使用它生成技能帮助
    if (params.context.skillExecutor) {
      const skillsHelp = params.context.skillExecutor.createSkillsHelp();
      const output = createHelpSkillsSection(skillsHelp).join('\n');
      return { type: 'output', output };
    }
    // fallback：从 CommandManager 派生已注册技能（不再硬编码 "Skills not available."）
    const manager = getCommandManager();
    const entries = manager.getByCategory('skill');
    if (entries.length === 0) {
      return { type: 'output', output: 'No skills registered.' };
    }
    const lines = ['Available skills:'];
    for (const entry of entries) {
      const aliases = entry.aliases.length > 0
        ? ` (${entry.aliases.join(', ')})`
        : '';
      lines.push(`  ${entry.name}${aliases}`);
    }
    return { type: 'output', output: lines.join('\n') };
  },
};

/**
 * /exit, /quit - 退出命令
 */
export const exitCommand: CommandDefinition = {
  name: '/exit',
  aliases: ['/quit'],
  category: 'exit',
  description: 'skills.help.localCommands.exit',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    return { type: 'action', action: 'exit' };
  },
};

/**
 * /status - 状态信息命令
 */
export const statusCommand: CommandDefinition = {
  name: '/status',
  aliases: [],
  category: 'skill',
  description: 'skills.status.description',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 由 SkillExecutor 处理，这里返回 action
    return { type: 'action', action: 'status' };
  },
};

/**
 * /init - 初始化项目上下文命令
 */
export const initCommand: CommandDefinition = {
  name: '/init',
  aliases: [],
  category: 'skill',
  description: 'skills.init.description',
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 由 SkillExecutor 处理，这里返回 action
    return { type: 'action', action: 'init' };
  },
};

/**
 * /review - 代码审查命令
 */
export const reviewCommand: CommandDefinition = {
  name: '/review',
  aliases: ['/rv'],
  category: 'skill',
  description: 'skills.review.description',
  args: [
    { name: 'scope', type: 'string', optional: true, description: 'Review scope' },
  ],
  execute: async (_params: CommandExecutionContext): Promise<CommandResult> => {
    // 由 SkillExecutor 处理，这里返回 action
    return { type: 'action', action: 'review' };
  },
};

export const workflowsCommand: CommandDefinition = { name: "/workflows", aliases: ["/wf"], category: "skill", description: "skills.workflows.description", args: [{ name: "name", type: "string", optional: true, description: "Workflow name or target" }], execute: async (_params: CommandExecutionContext): Promise<CommandResult> => ({ type: "action", action: "workflows" }) };

// ============================================================
// 命令列表
// ============================================================

/**
 * 所有内置命令
 */
export const builtinCommands: CommandDefinition[] = [
  clearCommand,
  sessionsCommand,
  logsCommand,
  modeCommand,
  contextCommand,
  helpCommand,
  toolsCommand,
  skillsCommand,
  exitCommand,
  statusCommand,
  initCommand,
  reviewCommand,
  workflowsCommand,
];
