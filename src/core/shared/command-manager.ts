/**
 * command-manager.ts - 统一命令管理器
 *
 * 提供统一的命令注册、解析和执行框架。
 * 消除 CLI 和 TUI 命令系统的双源问题。
 *
 * ## 设计目标
 *
 * 1. **统一抽象**：CommandDefinition 包含元数据、参数定义和执行逻辑
 * 2. **模式感知**：execute 方法可以根据 cli/tui 模式返回不同结果
 * 3. **参数解析统一**：args 定义统一，自动解析
 * 4. **向后兼容**：保持旧的 CommandRegistry 接口兼容
 *
 * ## 使用示例
 *
 * ```typescript
 * const cmd: CommandDefinition = {
 *   name: '/context',
 *   aliases: ['/ctx'],
 *   category: 'local',
 *   description: 'skills.help.localCommands.context',
 *   args: [
 *     { name: 'session-id', type: 'string', optional: true },
 *   ],
 *   execute: async (params) => {
 *     if (params.context.mode === 'tui') {
 *       return { type: 'action', action: 'context' };
 *     } else {
 *       return { type: 'output', output: 'Context stats...' };
 *     }
 *   },
 * };
 *
 * const manager = new CommandManager();
 * manager.register(cmd);
 *
 * // 解析参数
 * const parsed = manager.parse('/context abc123 --format json');
 * // { command: '/context', args: { 'session-id': 'abc123', format: 'json' } }
 *
 * // 执行命令
 * const result = await manager.execute('/context abc123', { mode: 'cli' });
 * // { type: 'output', output: 'Context stats...' }
 * ```
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 命令分类
 */
export type CommandCategory = 'local' | 'session' | 'skill' | 'exit';

/**
 * 参数类型
 */
export type ArgType = 'string' | 'number' | 'boolean' | 'enum';

/**
 * 参数定义
 */
export interface CommandArgDefinition {
  /** 参数名称 */
  name: string;
  /** 参数类型 */
  type: ArgType;
  /** 是否可选 */
  optional?: boolean;
  /** 默认值 */
  default?: unknown;
  /** 枚举值（type 为 'enum' 时必填） */
  values?: string[];
  /** 别名列表（用于短参数） */
  aliases?: string[];
  /** 参数描述（i18n key） */
  description?: string;
}

/**
 * 命令定义
 */
export interface CommandDefinition {
  /** 主名，带前缀 '/'，如 '/context' */
  name: string;
  /** 别名列表，每个带前缀 '/'，如 ['/ctx'] */
  aliases: string[];
  /** 命令分类 */
  category: CommandCategory;
  /** 描述（i18n key） */
  description: string;
  /** 参数定义 */
  args?: CommandArgDefinition[];
  /** 执行方法 */
  execute: (params: CommandExecutionContext) => Promise<CommandResult>;
}

/**
 * 命令执行上下文
 */
export interface CommandExecutionContext {
  /** 原始输入 */
  input: string;
  /** 解析后的参数 */
  args: Record<string, unknown>;
  /** 执行上下文 */
  context: {
    /** 执行模式 */
    mode: 'cli' | 'tui';
    /** 当前会话元数据（可选） */
    session?: {
      id: string;
      cwd: string;
      providerId?: string;
    };
    /** 技能执行器（可选） */
    skillExecutor?: {
      execute: (command: string, args: Record<string, unknown>) => Promise<unknown>;
      createSkillsHelp: () => string;
    };
  };
}

/**
 * 命令执行结果
 */
export type CommandResult =
  | {
      /** 动作类型：由上层处理 */
      type: 'action';
      /** 动作标识，如 'clear', 'exit', 'context' */
      action: string;
      /** 可选的额外数据 */
      data?: Record<string, unknown>;
    }
  | {
      /** 输出类型：直接输出文本 */
      type: 'output';
      /** 输出内容 */
      output: string;
    }
  | {
      /** 错误类型 */
      type: 'error';
      /** 错误消息 */
      error: string;
    };

/**
 * 解析后的命令
 */
export interface ParsedCommand {
  /** 命令主名 */
  command: string;
  /** 解析后的参数 */
  args: Record<string, unknown>;
  /** 原始输入 */
  input: string;
}

/**
 * 帮助条目（i18n 已解析）
 */
export interface CommandHelpEntry {
  /** 主名 */
  name: string;
  /** 别名 */
  aliases: string[];
  /** 分类 */
  category: CommandCategory;
  /** 描述 */
  description: string;
  /** 参数帮助 */
  args?: Array<{
    name: string;
    type: string;
    optional: boolean;
    description?: string;
  }>;
}

// ============================================================
// 参数解析器
// ============================================================

/**
 * 解析命令参数
 *
 * 支持：
 * - 位置参数：`/context abc123`
 * - 命名参数：`--format json` 或 `-f json`
 * - 布尔参数：`--details` 或 `--no-details`
 * - 默认值
 *
 * @param input - 原始输入
 * @param argDefs - 参数定义
 * @returns 解析后的参数
 */
export function parseArgs(
  input: string,
  argDefs: CommandArgDefinition[] = []
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const tokens = tokenizeInput(input);

  // 跳过命令名
  let i = 1;
  let positionalIndex = 0;

  // 初始化默认值
  for (const def of argDefs) {
    if (def.default !== undefined) {
      args[def.name] = def.default;
    }
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      // 命名参数
      const name = token.slice(2);

      // 检查是否为 --no-xxx 格式（布尔参数取反）
      if (name.startsWith('no-')) {
        const realName = name.slice(3);
        const def = argDefs.find((d) => d.name === realName);
        if (def && def.type === 'boolean') {
          args[realName] = false;
        } else {
          // 未知参数，跳过
          i++;
          continue;
        }
      } else {
        const def = argDefs.find((d) => d.name === name);

        if (def) {
          if (def.type === 'boolean') {
            args[name] = true;
          } else {
            i++;
            if (i < tokens.length) {
              args[name] = convertValue(tokens[i], def.type);
            }
          }
        } else {
          // 未知参数，跳过
          i++;
          if (i < tokens.length && !tokens[i].startsWith('-')) {
            // 可能是值，跳过
          }
        }
      }
    } else if (token.startsWith('-') && token.length === 2) {
      // 短参数
      const flag = token.slice(1);
      const def = argDefs.find((d) => d.name === flag || d.aliases?.includes(flag));

      if (def) {
        if (def.type === 'boolean') {
          args[def.name] = true;
        } else {
          i++;
          if (i < tokens.length) {
            args[def.name] = convertValue(tokens[i], def.type);
          }
        }
      }
    } else {
      // 位置参数
      const positionalDefs = argDefs.filter((d) => !d.name.startsWith('-'));
      if (positionalIndex < positionalDefs.length) {
        const def = positionalDefs[positionalIndex];
        args[def.name] = convertValue(token, def.type);
        positionalIndex++;
      }
    }

    i++;
  }

  return args;
}

/**
 * 将输入字符串分割为 token
 *
 * 处理引号包裹的字符串：
 * - `"hello world"` -> `hello world`
 * - `'hello world'` -> `hello world`
 */
function tokenizeInput(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of input) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * 将字符串值转换为目标类型
 */
function convertValue(value: string, type: ArgType): string | number | boolean {
  switch (type) {
    case 'number': {
      const num = Number(value);
      return isNaN(num) ? value : num;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'enum':
      return value;
    case 'string':
    default:
      return value;
  }
}

// ============================================================
// CommandManager 类
// ============================================================

/**
 * 统一命令管理器
 *
 * 管理所有命令的注册、解析和执行。
 */
export class CommandManager {
  /** 命令定义映射：name -> CommandDefinition */
  private commands: Map<string, CommandDefinition> = new Map();

  /** 别名映射：alias -> name */
  private aliases: Map<string, string> = new Map();

  /**
   * 注册命令
   *
   * @param cmd - 命令定义
   */
  register(cmd: CommandDefinition): void {
    // 注册主名
    this.commands.set(cmd.name, cmd);

    // 注册别名
    for (const alias of cmd.aliases) {
      this.aliases.set(alias, cmd.name);
    }
  }

  /**
   * 批量注册命令
   *
   * @param cmds - 命令定义数组
   */
  registerAll(cmds: CommandDefinition[]): void {
    for (const cmd of cmds) {
      this.register(cmd);
    }
  }

  /**
   * 注销命令
   *
   * @param name - 命令主名
   * @returns 是否成功注销
   */
  unregister(name: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) {
      return false;
    }

    // 移除命令
    this.commands.delete(name);

    // 移除别名
    for (const alias of cmd.aliases) {
      this.aliases.delete(alias);
    }

    return true;
  }

  /**
   * 检查输入是否为已注册命令
   *
   * @param input - 用户输入
   * @returns 是否为命令
   */
  isCommand(input: string): boolean {
    const command = this.extractCommandWord(input);
    return this.commands.has(command) || this.aliases.has(command);
  }

  /**
   * 解析输入
   *
   * @param input - 用户输入
   * @returns 解析后的命令，如果不是命令则返回 null
   */
  parse(input: string): ParsedCommand | null {
    const command = this.extractCommandWord(input);
    const cmd = this.commands.get(command) || this.commands.get(this.aliases.get(command) || '');

    if (!cmd) {
      return null;
    }

    const args = parseArgs(input, cmd.args);

    return {
      command: cmd.name,
      args,
      input,
    };
  }

  /**
   * 执行命令
   *
   * @param input - 用户输入
   * @param context - 执行上下文
   * @returns 执行结果
   */
  async execute(
    input: string,
    context: CommandExecutionContext['context']
  ): Promise<CommandResult> {
    const parsed = this.parse(input);
    if (!parsed) {
      return { type: 'error', error: `Unknown command: ${input}` };
    }

    const cmd = this.commands.get(parsed.command);
    if (!cmd) {
      return { type: 'error', error: `Command not found: ${parsed.command}` };
    }

    const execContext: CommandExecutionContext = {
      input: parsed.input,
      args: parsed.args,
      context,
    };

    try {
      return await cmd.execute(execContext);
    } catch (error) {
      return {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取命令定义
   *
   * @param nameOrAlias - 命令名或别名
   * @returns 命令定义
   */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const name = this.aliases.get(nameOrAlias) || nameOrAlias;
    return this.commands.get(name);
  }

  /**
   * 获取所有已注册命令
   *
   * @returns 命令定义数组
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * 按分类过滤命令
   *
   * @param category - 命令分类
   * @returns 命令定义数组
   */
  getByCategory(category: CommandCategory): CommandDefinition[] {
    return this.getAll().filter((cmd) => cmd.category === category);
  }

  /**
   * 获取帮助信息
   *
   * @returns 帮助条目数组
   */
  getHelpEntries(): CommandHelpEntry[] {
    return this.getAll().map((cmd) => ({
      name: cmd.name,
      aliases: cmd.aliases,
      category: cmd.category,
      description: cmd.description,
      args: cmd.args?.map((arg) => ({
        name: arg.name,
        type: arg.type,
        optional: arg.optional ?? false,
        description: arg.description,
      })),
    }));
  }

  /**
   * 从输入中提取命令词（首个空白分隔的 token）
   *
   * @param input - 用户输入
   * @returns 命令词
   */
  private extractCommandWord(input: string): string {
    const trimmed = input.trim();
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      return trimmed.toLowerCase();
    }
    return trimmed.slice(0, spaceIndex).toLowerCase();
  }
}

// ============================================================
// 单例和工厂函数
// ============================================================

/** 全局 CommandManager 实例 */
let globalManager: CommandManager | null = null;

/**
 * 获取全局 CommandManager 实例
 *
 * @returns CommandManager 实例
 */
export function getCommandManager(): CommandManager {
  if (!globalManager) {
    globalManager = new CommandManager();
  }
  return globalManager;
}

/**
 * 设置全局 CommandManager 实例（用于测试）
 *
 * @param manager - CommandManager 实例
 */
export function setCommandManager(manager: CommandManager): void {
  globalManager = manager;
}

/**
 * 重置全局 CommandManager 实例（用于测试）
 */
export function resetCommandManager(): void {
  globalManager = null;
}

/**
 * 创建新的 CommandManager 实例
 *
 * @returns 新的 CommandManager 实例
 */
export function createCommandManager(): CommandManager {
  return new CommandManager();
}

/**
 * 注册内置命令到 CommandManager
 *
 * @param manager - CommandManager 实例
 */
export async function registerBuiltinCommands(manager: CommandManager): Promise<void> {
  // 动态导入避免循环依赖
  const { builtinCommands } = await import('./command-definitions.js');
  manager.registerAll(builtinCommands);
}
