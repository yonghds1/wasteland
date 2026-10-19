/**
 * find-symbol.ts - 零原生依赖的多语言符号精准定位工具
 *
 * 专门用于在代码库中快速且精准地定位函数、类、接口、类型等顶层符号声明定义。
 * 基于通用抽象正则模式匹配与三层搜索引擎架构（ripgrep > git-grep > node fallback），
 * 无需预建庞大的 AST 索引，无原生二进制依赖，响应极其敏捷。
 *
 * ## 风险等级
 * read - 只读操作，不修改文件系统
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { resolveWithinCwd } from '../utils/path-utils.js';
import type { AgentTool, JsonSchema, ToolExecutionResult } from '../core/tool-types.js';
import { detectSearchEngine } from '../sys/grep/search-engine-detector.js';
import {
  parseRawGrepOutput,
  type FileGrepResult,
} from '../sys/grep/grep-formatter.js';
import { runNodeFallback } from '../sys/grep.js';
import { buildSymbolRegex } from './symbol-patterns.js';

const execFileAsync = promisify(execFile);

// ============================================================
// 常量与配置
// ============================================================

const CONTEXT_LINES = 2;
const MAX_SYMBOL_MATCHES = 100;

// ============================================================
// Zod Schema
// ============================================================

export const findSymbolInputSchema = z.object({
  name: z.string().min(1).describe('要查找的符号名（如类名、函数名、接口名等）'),
  kind: z
    .enum(['all', 'function', 'class', 'interface', 'type'])
    .default('all')
    .optional()
    .describe('符号类型过滤'),
  path: z.string().optional().describe('限定搜索的子目录或相对路径'),
  include: z.string().optional().describe('文件包含过滤（如 "*.ts"）'),
});

export type FindSymbolInput = z.infer<typeof findSymbolInputSchema>;

// ============================================================
// 结果格式化
// ============================================================

/**
 * 格式化符号定位结果
 *
 * 清晰展示文件路径、行号、代码签名与上下文，末尾附带统计摘要。
 */
export function formatFindSymbolOutput(
  name: string,
  results: FileGrepResult[],
): string {
  let totalMatches = 0;
  for (const file of results) {
    for (const line of file.lines) {
      if (line.isMatch) {
        totalMatches++;
      }
    }
  }

  if (totalMatches === 0 || results.length === 0) {
    return `未找到符号 "${name}" 的定义。\n\nFound 0 symbol definition(s)`;
  }

  const blocks: string[] = [];
  for (const file of results) {
    const linesOut: string[] = [];
    let prevLineNum = -1;

    for (const item of file.lines) {
      if (prevLineNum !== -1 && item.lineNum > prevLineNum + 1) {
        linesOut.push('--');
      }
      prevLineNum = item.lineNum;

      const sep = item.isMatch ? ':' : '-';
      linesOut.push(item.content ? `${item.lineNum}${sep} ${item.content}` : `${item.lineNum}${sep}`);
    }

    blocks.push(`${file.filePath}:\n${linesOut.join('\n')}`);
  }

  return `${blocks.join('\n\n')}\n\nFound ${totalMatches} symbol definition(s)`;
}

// ============================================================
// 引擎执行
// ============================================================

async function runRipgrep(
  pattern: string,
  searchRelPath: string | undefined,
  include: string | undefined,
  cwd: string,
): Promise<FileGrepResult[]> {
  const args = ['-n', '--color=never', '--no-heading', '-C', String(CONTEXT_LINES)];
  if (include) {
    args.push('--glob', include);
  }
  args.push('-e', pattern);
  if (searchRelPath) {
    args.push(searchRelPath);
  }

  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseRawGrepOutput(stdout, MAX_SYMBOL_MATCHES, include);
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
  cwd: string,
): Promise<FileGrepResult[]> {
  const args = ['grep', '--untracked', '-n', '--no-color', '-E', '-C', String(CONTEXT_LINES)];
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
    return parseRawGrepOutput(stdout, MAX_SYMBOL_MATCHES, include);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
      return [];
    }
    throw error;
  }
}

// ============================================================
// 工具导出
// ============================================================

/**
 * 创建多语言符号精准定位工具
 */
export function createFindSymbolTool(): AgentTool {
  return {
    name: 'find-symbol',
    riskLevel: 'read',
    description: '零原生依赖的多语言符号精准定位工具，快速检索函数、类、接口、类型等顶层定义',
    inputSchema: zodToJsonSchema(findSymbolInputSchema) as JsonSchema,

    async execute(input, context): Promise<ToolExecutionResult> {
      const parsed = findSymbolInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          status: 'error',
          error: parsed.error.issues.map((i) => i.message).join(', '),
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
      const pattern = buildSymbolRegex(parsed.data.name, parsed.data.kind);

      const engine = await detectSearchEngine(context.cwd);
      let results: FileGrepResult[];

      try {
        if (engine === 'ripgrep') {
          results = await runRipgrep(
            pattern,
            searchRelPath,
            parsed.data.include,
            context.cwd,
          );
        } else if (engine === 'git-grep') {
          results = await runGitGrep(
            pattern,
            searchRelPath,
            parsed.data.include,
            context.cwd,
          );
        } else {
          results = await runNodeFallback(
            new RegExp(pattern, 'm'),
            searchDir,
            parsed.data.include,
            CONTEXT_LINES,
            MAX_SYMBOL_MATCHES,
            context.cwd,
          );
        }
      } catch {
        // 当外部工具发生意外异常时，平滑降级到 Node 兜底引擎
        results = await runNodeFallback(
          new RegExp(pattern, 'm'),
          searchDir,
          parsed.data.include,
          CONTEXT_LINES,
          MAX_SYMBOL_MATCHES,
          context.cwd,
        );
      }

      return {
        status: 'success',
        output: formatFindSymbolOutput(parsed.data.name, results),
      };
    },
  };
}
