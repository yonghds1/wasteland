/**
 * arg-parser.ts - 通用参数解析器
 *
 * 提供统一的参数解析功能，支持：
 * - 位置参数
 * - 命名参数（--name value 或 -n value）
 * - 布尔参数（--flag 或 --no-flag）
 * - 枚举参数
 * - 默认值
 * - 引号包裹的字符串
 *
 * ## 使用示例
 *
 * ```typescript
 * const argDefs: ArgDefinition[] = [
 *   { name: 'session-id', type: 'string', optional: true },
 *   { name: 'format', type: 'enum', values: ['text', 'json'], default: 'text' },
 *   { name: 'details', type: 'boolean', default: false },
 * ];
 *
 * const args = parseArgs('/context abc123 --format json --details', argDefs);
 * // { 'session-id': 'abc123', format: 'json', details: true }
 * ```
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 参数类型
 */
export type ArgType = 'string' | 'number' | 'boolean' | 'enum';

/**
 * 参数定义
 */
export interface ArgDefinition {
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
 * 解析结果
 */
export interface ParseResult {
  /** 解析后的参数 */
  args: Record<string, unknown>;
  /** 未解析的剩余部分 */
  remaining: string;
}

// ============================================================
// 核心解析函数
// ============================================================

/**
 * 解析命令参数
 *
 * @param input - 原始输入（包含命令名）
 * @param argDefs - 参数定义数组
 * @returns 解析结果
 */
export function parseArgs(input: string, argDefs: ArgDefinition[] = []): ParseResult {
  const args: Record<string, unknown> = {};
  const tokens = tokenizeInput(input);

  // 跳过命令名
  let i = 1;
  let positionalIndex = 0;

  // 获取位置参数定义
  const positionalDefs = argDefs.filter((d) => !d.name.startsWith('-'));

  // 初始化默认值
  for (const def of argDefs) {
    if (def.default !== undefined) {
      args[def.name] = def.default;
    }
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      // 长参数：--name value 或 --flag
      const result = parseLongArg(token, tokens, i, argDefs);
      if (result.parsed) {
        Object.assign(args, result.args);
        i = result.nextIndex;
      } else {
        // 未知参数，跳过
        i++;
      }
    } else if (token.startsWith('-') && token.length === 2 && token[1] !== '-') {
      // 短参数：-n value 或 -f
      const result = parseShortArg(token, tokens, i, argDefs);
      if (result.parsed) {
        Object.assign(args, result.args);
        i = result.nextIndex;
      } else {
        i++;
      }
    } else {
      // 位置参数
      if (positionalIndex < positionalDefs.length) {
        const def = positionalDefs[positionalIndex];
        args[def.name] = convertValue(token, def.type);
        positionalIndex++;
      }
      i++;
    }
  }

  // 计算剩余部分
  const remaining = tokens.slice(i).join(' ');

  return { args, remaining };
}

/**
 * 只解析参数，不包含命令名
 *
 * @param argsString - 参数字符串（不包含命令名）
 * @param argDefs - 参数定义数组
 * @returns 解析后的参数
 */
export function parseArgsOnly(argsString: string, argDefs: ArgDefinition[] = []): Record<string, unknown> {
  const result = parseArgs(`cmd ${argsString}`, argDefs);
  return result.args;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析长参数（--name value 或 --flag）
 */
function parseLongArg(
  token: string,
  tokens: string[],
  currentIndex: number,
  argDefs: ArgDefinition[]
): { parsed: boolean; args: Record<string, unknown>; nextIndex: number } {
  const name = token.slice(2);

  // 检查是否为 --no-xxx 格式（布尔参数取反）
  if (name.startsWith('no-')) {
    const realName = name.slice(3);
    const def = argDefs.find((d) => d.name === realName);
    if (def && def.type === 'boolean') {
      return {
        parsed: true,
        args: { [realName]: false },
        nextIndex: currentIndex + 1,
      };
    }
    // 如果没有找到对应的布尔参数，返回未解析
    return { parsed: false, args: {}, nextIndex: currentIndex };
  }

  // 查找参数定义
  const def = argDefs.find((d) => d.name === name);

  if (!def) {
    return { parsed: false, args: {}, nextIndex: currentIndex };
  }

  if (def.type === 'boolean') {
    // 布尔参数，不需要值
    return {
      parsed: true,
      args: { [name]: true },
      nextIndex: currentIndex + 1,
    };
  }

  // 需要值的参数
  if (currentIndex + 1 < tokens.length) {
    const value = tokens[currentIndex + 1];
    return {
      parsed: true,
      args: { [name]: convertValue(value, def.type) },
      nextIndex: currentIndex + 2,
    };
  }

  // 缺少值
  return { parsed: false, args: {}, nextIndex: currentIndex };
}

/**
 * 解析短参数（-n value 或 -f）
 */
function parseShortArg(
  token: string,
  tokens: string[],
  currentIndex: number,
  argDefs: ArgDefinition[]
): { parsed: boolean; args: Record<string, unknown>; nextIndex: number } {
  const flag = token.slice(1);

  // 查找参数定义（支持别名）
  const def = argDefs.find((d) => d.name === flag || d.aliases?.includes(flag));

  if (!def) {
    return { parsed: false, args: {}, nextIndex: currentIndex };
  }

  if (def.type === 'boolean') {
    // 布尔参数，不需要值
    return {
      parsed: true,
      args: { [def.name]: true },
      nextIndex: currentIndex + 1,
    };
  }

  // 需要值的参数
  if (currentIndex + 1 < tokens.length) {
    const value = tokens[currentIndex + 1];
    return {
      parsed: true,
      args: { [def.name]: convertValue(value, def.type) },
      nextIndex: currentIndex + 2,
    };
  }

  // 缺少值
  return { parsed: false, args: {}, nextIndex: currentIndex };
}

/**
 * 将输入字符串分割为 token
 *
 * 处理引号包裹的字符串：
 * - `"hello world"` -> `hello world`
 * - `'hello world'` -> `hello world`
 */
export function tokenizeInput(input: string): string[] {
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
export function convertValue(value: string, type: ArgType): string | number | boolean {
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

/**
 * 验证参数值是否符合定义
 *
 * @param args - 解析后的参数
 * @param argDefs - 参数定义数组
 * @returns 验证错误数组（空数组表示验证通过）
 */
export function validateArgs(
  args: Record<string, unknown>,
  argDefs: ArgDefinition[]
): string[] {
  const errors: string[] = [];

  for (const def of argDefs) {
    const value = args[def.name];

    // 检查必填参数
    if (!def.optional && def.default === undefined && value === undefined) {
      errors.push(`Missing required argument: ${def.name}`);
      continue;
    }

    // 检查枚举值
    if (def.type === 'enum' && def.values && value !== undefined) {
      if (typeof value !== 'string' || !def.values.includes(value)) {
        errors.push(`Invalid value for ${def.name}: ${value}. Must be one of: ${def.values.join(', ')}`);
      }
    }

    // 检查数字类型
    if (def.type === 'number' && value !== undefined) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`Invalid number for ${def.name}: ${value}`);
      }
    }
  }

  return errors;
}

/**
 * 生成参数帮助文本
 *
 * @param argDefs - 参数定义数组
 * @returns 帮助文本数组
 */
export function generateArgsHelp(argDefs: ArgDefinition[]): string[] {
  const lines: string[] = [];

  for (const def of argDefs) {
    const parts: string[] = [];

    // 参数名
    if (def.type === 'boolean') {
      parts.push(`--[no-]${def.name}`);
    } else {
      parts.push(`--${def.name} <${def.type}>`);
    }

    // 别名
    if (def.aliases && def.aliases.length > 0) {
      parts.push(`(-${def.aliases.join(', -')})`);
    }

    // 可选标记
    if (def.optional) {
      parts.push('[optional]');
    }

    // 默认值
    if (def.default !== undefined) {
      parts.push(`[default: ${def.default}]`);
    }

    // 枚举值
    if (def.type === 'enum' && def.values) {
      parts.push(`[${def.values.join('|')}]`);
    }

    lines.push(`  ${parts.join(' ')}`);
  }

  return lines;
}
