/**
 * command-handlers.ts - 命令 handler 池
 *
 * 按 CommandHandlerType 分发的 handler 字典。
 * 用于处理本地命令的执行。
 *
 * 职责分层:
 * - skill-executor / route-logs-command: 返回 { handled: false },让上层继续路由
 * - clear-screen / exit-session / session-list: 单一动作,直接返回 action
 * - help-dialog: 单独标记需要打开 help dialog(由 TUI App.tsx 拦截)
 * - mode-switch: /mode 命令,只返回 action(异步写配置由 App.tsx / CLI 适配层落地)
 * - execute-local: 处理 /tools /skills 的复杂输出(调 text generator)
 */

/**
 * 本地命令结果
 */
export type LocalCommandResult = {
  /** 是否处理了该命令 */
  handled: boolean;
  /** 命令输出内容 */
  output?: string;
  /** 特殊动作标识 */
  action?: 'clear' | 'exit' | 'help' | 'sessions' | 'mode' | 'context';
};

/**
 * Handler 函数签名
 */
export type CommandHandlerFn = () => LocalCommandResult;

// ============================================================
// Handler 池
// ============================================================

/**
 * 命令 handler 池,key 为 CommandHandlerType
 *
 * - 'skill-executor' / 'route-logs-command': 由其他层处理,这里只标记未处理
 * - 'clear-screen' / 'exit-session' / 'session-list': 单一动作
 * - 'help-dialog': /help 命令触发,只返回 action(由 App.tsx 拦截打开 dialog)
 * - 'mode-switch': /mode 命令触发,只返回 action(异步写配置由适配层落地)
 * - 'execute-local': 复杂文本生成(/tools /skills)
 */
export const commandHandlers: Record<string, CommandHandlerFn> = {
  // 由 SkillExecutor 处理,不应拦截
  'skill-executor': () => ({ handled: false }),

  // 由 App.tsx dispatchLogsRoute 处理,不应拦截
  'route-logs-command': () => ({ handled: false }),

  // 清屏
  'clear-screen': () => ({ handled: true, action: 'clear' }),

  // 退出
  'exit-session': () => ({ handled: true, action: 'exit' }),

  // 进入 session 索引页
  'session-list': () => ({ handled: true, action: 'sessions' }),

  // /help 命令:只返回 action,由 App.tsx 拦截打开 help dialog
  'help-dialog': () => ({ handled: true, action: 'help' }),

  // /mode 命令:只返回 action,写配置是异步 IO,由适配层落地
  'mode-switch': () => ({ handled: true, action: 'mode' }),

  // /context 命令:显示 context 使用情况
  'context-command': () => ({ handled: true, action: 'context' }),

  // 复杂本地命令(/tools /skills)
  'execute-local': () => {
    // 这些命令现在由 command-executor.ts 处理
    return { handled: false };
  },
};

// ============================================================
// 文本生成器(从 local-commands.ts 提取)
// ============================================================

/**
 * Commands 段(/help /tools /skills 等)
 *
 * 由 HelpCommandsView 复用渲染;CLI fallback 路径通过 .join('\n') 拼成纯文本。
 */
export function createHelpCommandsSection(): string[] {
  return [
    'Session commands:',
    '  /help   Show interactive help',
    '  /tools  Show current local tool syntax',
    '  /skills Show available skills',
    '  /clear  Clear screen and redraw',
    '  /sessions  List and browse past sessions',
    '  /exit   Exit the session',
  ];
}

/**
 * Tools 段(本地工具语法;与 runtime toolRegistry 无关,提供 CLI fallback)
 */
export function createHelpToolsSection(): string[] {
  return [
    'Local tool syntax:',
    '  /read <path>           Read file contents',
    '  /write <path> <text>   Write to file',
    '  /edit <path> <old> <new>  Edit file (replace text)',
    '  /bash <command>        Execute shell command',
    '  /glob <pattern>        Find files by pattern',
    '  /grep <pattern>        Search file contents',
    '  /ls [path]             List directory contents',
  ];
}

/**
 * Skills 段(skills 列表)
 *
 * @param skillsHelp - 来自 skillExecutor.createSkillsHelp() 的预格式化技能帮助。
 *   传入空字符串时降级为最小提示(由 HelpCommandsView 在无 skillExecutor 时使用)。
 */
export function createHelpSkillsSection(skillsHelp: string): string[] {
  if (skillsHelp === '') {
    return ['Available skills:', '  (Run /skills to see all available skills.)'];
  }
  return ['Available skills:', skillsHelp];
}

/**
 * Local commands 段(/logs /clear /exit /sessions 等 TUI 本地路由)
 */
export function createHelpLocalCommandsSection(): string[] {
  return [
    'Local commands:',
    '  /logs      Open the runtime logs page',
    '  /mode      Switch agent mode (single/multi); takes effect after restart',
    '  /context   View current context usage and token consumption statistics',
    '  /clear     Clear the current chat surface',
    '  /sessions  Browse and resume past sessions',
    '  /exit      Exit wasteland',
  ];
}
