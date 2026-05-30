/**
 * grep.ts - 文本搜索工具
 *
 * 在文件中搜索匹配指定模式的文本行。
 *
 * ## 功能特性
 * - 支持正则表达式和普通字符串搜索
 * - 支持指定搜索目录（默认为当前工作目录）
 * - 支持文件包含/排除模式过滤
 * - 返回匹配行及行号，附带文件路径
 *
 * ## 风险等级
 * read - 只读操作，不修改文件系统
 *
 * ## 参数
 * - pattern: 搜索模式（必需，支持正则表达式）
 * - path: 搜索路径（可选，默认为当前工作目录）
 * - include: 文件包含模式（可选，如 "*.ts"）
 * - ignoreCase: 是否忽略大小写（可选，默认 false）
 */

import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { t } from '../locales/index.js';
import type { AgentTool, ToolExecutionResult } from './tool-types.js';

// ============================================================
// 配置常量
// ============================================================

/** 单文件最大搜索行数 */
const MAX_LINES_PER_FILE = 2000;

/** 最大搜索文件数 */
const MAX_FILES_TO_SEARCH = 100;

/** 最大匹配结果数 */
const MAX_MATCHES = 200;

/** 单行最大截断长度 */
const MAX_LINE_LENGTH = 300;

/** 默认忽略的目录 */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.wasteland',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
]);

// ============================================================
// 类型定义
// ============================================================

type GrepMatch = {
  filePath: string;
  line: number;
  content: string;
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析搜索模式
 *
 * @param value - 输入模式值
 * @returns 有效模式字符串，或 null 表示无效
 */
function resolvePattern(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

/**
 * 编译正则表达式
 *
 * @param pattern - 搜索模式
 * @param ignoreCase - 是否忽略大小写
 * @returns 编译后的正则表达式，或错误信息
 */
function compilePattern(
  pattern: string,
  ignoreCase: boolean
): { regex: RegExp } | { error: string } {
  try {
    const flags = ignoreCase ? 'gim' : 'gm';
    return { regex: new RegExp(pattern, flags) };
  } catch {
    return { error: `无效的正则表达式: "${pattern}"` };
  }
}

/**
 * 截断过长的行
 *
 * @param line - 原始行内容
 * @returns 截断后的行内容
 */
function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) {
    return line;
  }
  return line.slice(0, MAX_LINE_LENGTH) + '…';
}

/**
 * 收集需要搜索的文件列表
 *
 * @param searchDir - 搜索根目录
 * @param include - 文件包含模式（glob）
 * @param maxDepth - 最大递归深度
 * @returns 文件路径数组
 */
async function collectFiles(
  searchDir: string,
  include?: string,
  maxDepth: number = 10
): Promise<string[]> {
  const files: string[] = [];
  const includeRegex = include ? globToRegex(include) : null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || files.length >= MAX_FILES_TO_SEARCH) {
      return;
    }

    let entries;
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES_TO_SEARCH) {
        break;
      }

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
          await walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        if (includeRegex) {
          if (includeRegex.test(entry.name)) {
            files.push(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(searchDir, 0);
  return files;
}

/**
 * 将简单 glob 模式转换为正则表达式
 *
 * 仅支持 * 和 ? 通配符
 *
 * @param pattern - glob 模式
 * @returns 对应的正则表达式
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * 在单个文件中搜索匹配
 *
 * @param filePath - 文件路径
 * @param regex - 搜索正则
 * @param baseDir - 基准目录（用于计算相对路径）
 * @returns 匹配结果数组
 */
async function searchInFile(
  filePath: string,
  regex: RegExp,
  baseDir: string
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const lineLimit = Math.min(lines.length, MAX_LINES_PER_FILE);

    for (let i = 0; i < lineLimit; i++) {
      // 重置正则 lastIndex（因为有 g 标志）
      regex.lastIndex = 0;

      if (regex.test(lines[i])) {
        matches.push({
          filePath: relative(baseDir, filePath),
          line: i + 1,
          content: truncateLine(lines[i]),
        });
      }
    }
  } catch {
    // 跳过无法读取的文件（二进制文件、权限不足等）
  }

  return matches;
}

/**
 * 格式化搜索结果
 *
 * @param matches - 所有匹配结果
 * @param pattern - 搜索模式
 * @param baseDir - 搜索目录
 * @returns 格式化后的输出文本
 */
function formatResult(matches: GrepMatch[], pattern: string): string {
  if (matches.length === 0) {
    return `🔍 grep "${pattern}" — no matches found`;
  }

  // 按文件分组
  const grouped = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const group = grouped.get(match.filePath) ?? [];
    group.push(match);
    grouped.set(match.filePath, group);
  }

  const header = `🔍 grep "${pattern}" — ${matches.length} ${matches.length === 1 ? 'match' : 'matches'} in ${grouped.size} ${grouped.size === 1 ? 'file' : 'files'}\n${'─'.repeat(48)}`;

  const body = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, fileMatches]) => {
      const matchLines = fileMatches
        .map((m) => `  ${String(m.line).padStart(4)} │ ${m.content}`)
        .join('\n');
      return `📄 ${filePath}\n${matchLines}`;
    })
    .join('\n\n');

  const truncationNote =
    matches.length >= MAX_MATCHES ? `\n\n⚠ Results truncated at ${MAX_MATCHES} matches.` : '';

  return `${header}\n\n${body}${truncationNote}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createGrepTool(): AgentTool {
  return {
    name: 'grep',
    riskLevel: 'read',

    async execute(input, context): Promise<ToolExecutionResult> {
      // 解析搜索模式
      const pattern = resolvePattern(input.pattern);

      if (pattern === null) {
        return {
          status: 'error',
          error: t('tools.grep.needPattern'),
        };
      }

      // 编译正则表达式
      const ignoreCase = input.ignoreCase === true;
      const compiled = compilePattern(pattern, ignoreCase);

      if ('error' in compiled) {
        return {
          status: 'error',
          error: compiled.error,
        };
      }

      // 解析搜索路径
      const searchDir =
        typeof input.path === 'string' && input.path.trim().length > 0
          ? resolve(context.cwd, input.path)
          : context.cwd;

      // 验证路径存在且是目录
      try {
        const s = await stat(searchDir);
        if (!s.isDirectory()) {
          return {
            status: 'error',
            error: `路径 "${input.path}" 不是一个目录。`,
          };
        }
      } catch {
        return {
          status: 'error',
          error: `路径 "${searchDir}" 不存在或无法访问。`,
        };
      }

      try {
        // 收集文件
        const include =
          typeof input.include === 'string' && input.include.trim().length > 0
            ? input.include.trim()
            : undefined;

        const files = await collectFiles(searchDir, include);

        // 在所有文件中搜索
        const allMatches: GrepMatch[] = [];

        for (const file of files) {
          if (allMatches.length >= MAX_MATCHES) {
            break;
          }

          const fileMatches = await searchInFile(file, compiled.regex, searchDir);
          allMatches.push(...fileMatches);
        }

        return {
          status: 'success',
          output: formatResult(allMatches.slice(0, MAX_MATCHES), pattern),
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
