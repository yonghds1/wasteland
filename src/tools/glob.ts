/**
 * glob.ts - 文件模式匹配工具
 *
 * 使用 Node.js 内置的 fs.glob 函数按 glob 模式查找文件。
 *
 * ## 功能特性
 * - 支持 glob 模式（如 "*.ts"、"src/**" 等）
 * - 默认在当前工作目录下搜索
 * - 返回相对于工作目录的路径，便于阅读
 *
 * ## 风险等级
 * read - 只读操作，不修改文件系统
 *
 * ## 参数
 * - pattern: glob 模式（必需）
 * - cwd: 搜索根目录（可选，默认为当前工作目录）
 */

import { glob } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { resolveWithinCwd } from './path-utils.js';
import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const globInputSchema = z.object({
  pattern: z.string().min(1).describe('文件匹配模式（glob pattern，如 "*.ts"、"src/**"）'),
  cwd: z.string().optional().describe('搜索根目录（默认当前工作目录）'),
  limit: z.number().int().positive().optional().default(100).describe('最大返回匹配数量（默认 100）'),
});

export type GlobInput = z.infer<typeof globInputSchema>;

// ============================================================
// 辅助函数
// ============================================================

const DEFAULT_IGNORES = ['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.cache'];

function shouldIgnorePath(relPath: string, pattern: string): boolean {
  // 如果模式显式搜索某个特殊目录，不进行默认过滤
  for (const dir of DEFAULT_IGNORES) {
    if (pattern.includes(dir)) continue;
    if (relPath === dir || relPath.startsWith(`${dir}/`) || relPath.includes(`/${dir}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * 格式化搜索结果
 *
 * @param files - 找到的文件路径数组
 * @param baseDir - 基准目录
 * @param pattern - 搜索模式
 * @param totalCount - 实际总匹配数
 * @returns 格式化后的输出文本
 */
function formatResult(
  files: string[],
  baseDir: string,
  pattern: string,
  totalCount: number
): string {
  if (files.length === 0) {
    return `🔍 glob "${pattern}" — no matches found`;
  }

  const relativePaths = files
    .map((file) => relative(baseDir, file))
    .sort((a, b) => a.localeCompare(b));

  const truncated = totalCount > files.length;
  const countLabel = truncated
    ? `${files.length} of ${totalCount} matches`
    : `${files.length} ${files.length === 1 ? 'match' : 'matches'}`;

  const header = `🔍 glob "${pattern}" — ${countLabel}\n${'─'.repeat(48)}`;
  const body = relativePaths.map((path) => `  ${path}`).join('\n');
  const footer = truncated
    ? `\n\n... and ${totalCount - files.length} more matches truncated. Please use a more specific pattern.`
    : '';

  return `${header}\n${body}${footer}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createGlobTool(): AgentTool {
  return {
    name: 'glob',
    riskLevel: 'read',
    description: '使用 glob 模式查找文件（自动忽略 node_modules/dist 等目录）',
    inputSchema: zodToJsonSchema(globInputSchema) as JsonSchema,

    async execute(input, context): Promise<ToolExecutionResult> {
      const parsed = globInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      // 解析搜索目录（基于 realpath 防止符号链接穿越与路径遍历）
      const searchDir = parsed.data.cwd
        ? await resolveWithinCwd(context.cwd, parsed.data.cwd)
        : context.cwd;

      if (!searchDir) {
        return {
          status: 'error',
          error: `搜索目录 "${parsed.data.cwd}" 位于工作目录之外。`,
        };
      }

      const limit = parsed.data.limit ?? 100;

      try {
        // 使用 Node.js 内置 glob 函数
        const files: string[] = [];
        let totalCount = 0;

        for await (const file of glob(parsed.data.pattern, { cwd: searchDir })) {
          const rel = relative(searchDir, resolve(searchDir, file));
          if (shouldIgnorePath(rel, parsed.data.pattern)) {
            continue;
          }

          totalCount++;
          if (files.length < limit) {
            files.push(resolve(searchDir, file));
          }
        }

        return {
          status: 'success',
          output: formatResult(files, searchDir, parsed.data.pattern, totalCount),
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
