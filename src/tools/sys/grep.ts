/**
 * grep.ts - 极速文本搜索探针
 *
 * 在文件中搜索匹配指定模式的文本行。
 * 支持三层引擎检测降级（ripgrep > git-grep > node fallback），
 * 支持上下文行（contextLines）与最大匹配限制（maxMatches）。
 *
 * ## 风险等级
 * read - 只读操作，不修改文件系统
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { resolveWithinCwd } from '../utils/path-utils.js';
import type { AgentTool, JsonSchema, ToolExecutionResult } from '../core/tool-types.js';
import { detectSearchEngine } from './grep/search-engine-detector.js';
import {
  formatGrepOutput,
  globToRegex,
  parseRawGrepOutput,
  truncateLine,
  type FileGrepResult,
  type GrepLineItem,
} from './grep/grep-formatter.js';

const execFileAsync = promisify(execFile);

// ============================================================
// Zod Schema
// ============================================================

export const grepInputSchema = z.object({
  pattern: z.string().min(1).describe('搜索模式（支持正则表达式）'),
  path: z.string().optional().describe('搜索相对路径（默认当前工作目录）'),
  include: z.string().optional().describe('文件包含模式（如 "*.ts"）'),
  ignoreCase: z.boolean().default(false).describe('是否忽略大小写'),
  contextLines: z.number().int().min(0).max(10).default(2).describe('匹配行前后的上下文行数'),
  maxMatches: z.number().int().min(1).max(500).default(100).describe('最大匹配数'),
});

export type GrepInput = z.infer<typeof grepInputSchema>;

// ============================================================
// 配置常量
// ============================================================

const MAX_FILES_TO_SEARCH = 200;
const MAX_LINES_PER_FILE = 2000;

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
// 辅助函数
// ============================================================

export function compilePattern(
  pattern: string,
  ignoreCase: boolean,
): { regex: RegExp } | { error: string } {
  try {
    const flags = ignoreCase ? 'gim' : 'gm';
    return { regex: new RegExp(pattern, flags) };
  } catch {
    return { error: `无效的正则表达式: "${pattern}"` };
  }
}

async function collectFiles(
  searchDir: string,
  include?: string,
  maxDepth = 10,
): Promise<string[]> {
  const files: string[] = [];
  const includeRegex = include ? globToRegex(include) : null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || files.length >= MAX_FILES_TO_SEARCH) {
      return;
    }

    let entries;
    try {
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

// ============================================================
// 三层引擎实现
// ============================================================

async function runRipgrep(
  pattern: string,
  searchRelPath: string | undefined,
  include: string | undefined,
  ignoreCase: boolean,
  contextLines: number,
  maxMatches: number,
  cwd: string,
): Promise<FileGrepResult[]> {
  const args = ['-n', '--color=never', '--no-heading'];
  if (contextLines > 0) {
    args.push('-C', String(contextLines));
  }
  if (ignoreCase) {
    args.push('-i');
  }
  if (include) {
    args.push('--glob', include);
  }
  args.push('--max-count', String(maxMatches));
  args.push(pattern);
  if (searchRelPath) {
    args.push(searchRelPath);
  }

  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseRawGrepOutput(stdout, maxMatches, include);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
      return [];
    }
    throw error;
  }
}

async function runGitGrep(
  pattern: string,
  searchRelPath: string | undefined,
  include: string | undefined,
  ignoreCase: boolean,
  contextLines: number,
  maxMatches: number,
  cwd: string,
): Promise<FileGrepResult[]> {
  const args = ['grep', '-n', '--no-color'];
  if (contextLines > 0) {
    args.push('-C', String(contextLines));
  }
  if (ignoreCase) {
    args.push('-i');
  }
  args.push('-e', pattern);
  args.push('--');
  if (searchRelPath) {
    args.push(searchRelPath);
  }

  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseRawGrepOutput(stdout, maxMatches, include);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
      return [];
    }
    throw error;
  }
}

export async function runNodeFallback(
  regex: RegExp,
  searchDir: string,
  include: string | undefined,
  contextLines: number,
  maxMatches: number,
  cwd: string,
): Promise<FileGrepResult[]> {
  const s = await stat(searchDir);
  const files = s.isFile() ? [searchDir] : await collectFiles(searchDir, include);
  const results: FileGrepResult[] = [];
  let totalMatches = 0;

  for (const filePath of files) {
    if (totalMatches >= maxMatches) {
      break;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineLimit = Math.min(lines.length, MAX_LINES_PER_FILE);

      const matchedIndices = new Set<number>();
      for (let i = 0; i < lineLimit; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matchedIndices.add(i);
          totalMatches++;
          if (totalMatches >= maxMatches) {
            break;
          }
        }
      }

      if (matchedIndices.size === 0) {
        continue;
      }

      const neededLineIndices = new Set<number>();
      for (const idx of matchedIndices) {
        const start = Math.max(0, idx - contextLines);
        const end = Math.min(lines.length - 1, idx + contextLines);
        for (let l = start; l <= end; l++) {
          neededLineIndices.add(l);
        }
      }

      const fileLines: GrepLineItem[] = Array.from(neededLineIndices)
        .sort((a, b) => a - b)
        .map((idx) => ({
          lineNum: idx + 1,
          isMatch: matchedIndices.has(idx),
          content: truncateLine(lines[idx]),
        }));

      results.push({
        filePath: relative(cwd, filePath),
        lines: fileLines,
      });
    } catch {
      // 忽略无法读取的文件
    }
  }

  return results;
}

// ============================================================
// 工具实现
// ============================================================

export function createGrepTool(): AgentTool {
  return {
    name: 'grep',
    riskLevel: 'read',
    description: '在文件中搜索匹配指定模式的文本行（支持上下文行与极速引擎加速）',
    inputSchema: zodToJsonSchema(grepInputSchema) as JsonSchema,

    async execute(input, context): Promise<ToolExecutionResult> {
      const parsed = grepInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map((i) => i.message).join(', ') };
      }

      const compiled = compilePattern(parsed.data.pattern, parsed.data.ignoreCase);
      if ('error' in compiled) {
        return {
          status: 'error',
          error: compiled.error,
        };
      }

      const searchDir = parsed.data.path
        ? await resolveWithinCwd(context.cwd, parsed.data.path)
        : context.cwd;

      if (!searchDir) {
        return {
          status: 'error',
          error: `路径 "${parsed.data.path}" 位于工作目录之外。`,
        };
      }

      try {
        await stat(searchDir);
      } catch {
        return {
          status: 'error',
          error: `路径 "${searchDir}" 不存在或无法访问。`,
        };
      }

      const searchRelPath = parsed.data.path ? relative(context.cwd, searchDir) : undefined;
      let engine = await detectSearchEngine(context.cwd);
      let results: FileGrepResult[];

      try {
        if (engine === 'ripgrep') {
          results = await runRipgrep(
            parsed.data.pattern,
            searchRelPath,
            parsed.data.include,
            parsed.data.ignoreCase,
            parsed.data.contextLines,
            parsed.data.maxMatches,
            context.cwd,
          );
        } else if (engine === 'git-grep') {
          results = await runGitGrep(
            parsed.data.pattern,
            searchRelPath,
            parsed.data.include,
            parsed.data.ignoreCase,
            parsed.data.contextLines,
            parsed.data.maxMatches,
            context.cwd,
          );
        } else {
          results = await runNodeFallback(
            compiled.regex,
            searchDir,
            parsed.data.include,
            parsed.data.contextLines,
            parsed.data.maxMatches,
            context.cwd,
          );
        }
      } catch {
        // 当外部工具发生意外异常时，平滑降级到 Node 兜底引擎
        engine = 'node';
        results = await runNodeFallback(
          compiled.regex,
          searchDir,
          parsed.data.include,
          parsed.data.contextLines,
          parsed.data.maxMatches,
          context.cwd,
        );
      }

      return {
        status: 'success',
        output: formatGrepOutput(results, engine),
      };
    },
  };
}
