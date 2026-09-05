/**
 * skill-parser.ts - 技能参数解析器
 *
 * 解析斜杠命令中的参数，支持：
 * - 位置参数: /skill arg1 arg2
 * - 命名参数: /skill --name value
 * - 标志位: /skill --flag
 * - 引号字符串: /skill "arg with spaces"
 * - 数组: /skill --items item1,item2,item3
 */

import type { SkillArgs, SkillDefinition, SkillParameterDef } from './skill-types.js';
import { t } from '@locales/index.js';

// ============================================================
// 参数解析
// ============================================================

/**
 * 解析技能参数
 *
 * 从斜杠命令字符串中提取参数。
 *
 * @param input - 用户输入的完整命令字符串
 * @returns 解析后的参数对象
 *
 * @example
 * parseSkillArgs("/init --template minimal")
 * // => { positional: [], named: { template: "minimal" }, raw: "/init --template minimal" }
 *
 * parseSkillArgs("/review staged --format full")
 * // => { positional: ["staged"], named: { format: "full" }, raw: "..." }
 *
 * parseSkillArgs("/test --watch --coverage")
 * // => { positional: [], named: { watch: true, coverage: true }, raw: "..." }
 */
export function parseSkillArgs(input: string): SkillArgs {
  const trimmed = input.trim();

  // 提取技能名称（去掉 / 和后面的内容）
  const nameMatch = trimmed.match(/^\/(\S+)/);
  if (!nameMatch) {
    return { positional: [], named: {}, raw: input };
  }

  // 获取参数部分（技能名称之后的内容）
  const afterName = trimmed.slice(nameMatch[0].length).trim();

  if (!afterName) {
    return { positional: [], named: {}, raw: input };
  }

  const positional: string[] = [];
  const named: Record<string, unknown> = {};

  // 分词
  const tokens = tokenize(afterName);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // 命名参数 (--name)
    if (token.startsWith('--')) {
      const name = token.slice(2);

      // 检查下一个 token 是否是值（不是 -- 开头）
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        const value = tokens[i + 1];

        // 检查是否是数组语法（包含逗号）
        if (value.includes(',')) {
          named[name] = value.split(',').map((s) => s.trim());
        } else {
          // 尝试解析为数字
          const numValue = Number(value);
          if (!isNaN(numValue) && value.trim() !== '') {
            named[name] = numValue;
          } else {
            named[name] = value;
          }
        }

        i += 2;
      } else {
        // 标志位（布尔值）
        named[name] = true;
        i += 1;
      }
    } else {
      // 位置参数
      positional.push(token);
      i += 1;
    }
  }

  return { positional, named, raw: input };
}

/**
 * 分词函数
 *
 * 将字符串分割为 token，支持引号字符串。
 *
 * @param input - 要分词的字符串
 * @returns token 数组
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuote) {
      // 在引号内
      if (char === quoteChar) {
        // 结束引号
        inQuote = false;
        if (current) {
          tokens.push(current);
        }
        current = '';
      } else {
        current += char;
      }
    } else {
      // 不在引号内
      if (char === '"' || char === "'") {
        // 开始引号
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        // 空格分隔
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }

  // 处理最后一个 token
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// ============================================================
// 参数验证
// ============================================================

/**
 * 验证参数
 *
 * 检查参数是否符合技能的参数定义。
 *
 * @param args - 解析后的参数
 * @param definition - 技能定义
 * @returns 验证结果，包含是否有效和错误列表
 */
export function validateSkillArgs(
  args: SkillArgs,
  definition: SkillDefinition
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const params = definition.parameters ?? {};

  // 检查必需参数
  for (const [name, param] of Object.entries(params)) {
    if (param.required) {
      // 检查是否提供了该参数
      const hasNamed = name in args.named;
      // 对于字符串类型，也可以从位置参数获取（第一个位置参数）
      const hasPositional = param.type === 'string' && args.positional.length > 0 && !hasNamed;

      if (!hasNamed && !hasPositional) {
        errors.push(`${t('skills.common.missingRequiredParam')} ${name}`);
      }
    }
  }

  // 验证命名参数的类型
  for (const [name, value] of Object.entries(args.named)) {
    const param = params[name];
    if (!param) {
      // 未知参数（允许，但不验证）
      continue;
    }

    const typeError = validateType(name, value, param);
    if (typeError) {
      errors.push(typeError);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证单个参数的类型
 */
function validateType(name: string, value: unknown, param: SkillParameterDef): string | null {
  switch (param.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `${name} ${t('skills.common.mustBeString')}`;
      }
      if (param.enum && !param.enum.includes(value)) {
        return `${name} ${t('skills.common.mustBeOneOf')} ${param.enum.join(', ')}`;
      }
      break;

    case 'number':
      if (typeof value !== 'number') {
        return `${name} ${t('skills.common.mustBeNumber')}`;
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return `${name} ${t('skills.common.mustBeBoolean')}`;
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return `${name} ${t('skills.common.mustBeArray')}`;
      }
      break;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `${name} ${t('skills.common.mustBeObject')}`;
      }
      break;
  }

  return null;
}

// ============================================================
// 默认值应用
// ============================================================

/**
 * 应用默认值
 *
 * 为缺失的参数填充默认值。
 *
 * @param args - 解析后的参数
 * @param definition - 技能定义
 * @returns 带默认值的参数
 */
export function applyDefaults(args: SkillArgs, definition: SkillDefinition): SkillArgs {
  const params = definition.parameters ?? {};
  const named = { ...args.named };

  for (const [name, param] of Object.entries(params)) {
    if (!(name in named) && param.default !== undefined) {
      named[name] = param.default;
    }
  }

  return { ...args, named };
}

// ============================================================
// 帮助文本生成
// ============================================================

/**
 * 生成参数帮助文本
 *
 * @param definition - 技能定义
 * @returns 帮助文本
 */
export function generateArgsHelp(definition: SkillDefinition): string {
  const params = definition.parameters ?? {};
  const lines: string[] = [];

  if (Object.keys(params).length === 0) {
    return t('skills.common.noParams');
  }

  for (const [name, param] of Object.entries(params)) {
    const required = param.required ? ` ${t('skills.tools.required')}` : '';
    const defaultVal =
      param.default !== undefined ? ` [${t('skills.common.default')} ${param.default}]` : '';
    const enumVals = param.enum
      ? ` ${t('skills.common.optionalValues')} ${param.enum.join('|')}`
      : '';

    lines.push(`  --${name}${required}${defaultVal}${enumVals}`);
    if (param.description) {
      lines.push(`    ${param.description}`);
    }
  }

  return lines.join('\n');
}
