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

import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const globInputSchema = z.object({
  pattern: z.string().min(1).describe('文件匹配模式（glob pattern，如 "*.ts"、"src/**"）'),
  cwd: z.string().optional().describe('搜索根目录（默认当前工作目录）'),
});

export type GlobInput = z.infer<typeof globInputSchema>;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析并验证 glob 模式
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
 * 解析可选的工作目录
 *
 * @param cwd - 当前工作目录
 * @param value - 输入目录值
 * @returns 解析后的绝对路径，或默认使用 cwd
 */
function resolveSearchDir(cwd: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return cwd;
  }
  return resolve(cwd, value);
}

/**
 * 格式化搜索结果
 *
 * @param files - 找到的文件路径数组
 * @param baseDir - 基准目录
 * @param pattern - 搜索模式
 * @returns 格式化后的输出文本
 */
function formatResult(files: string[], baseDir: string, pattern: string): string {
  if (files.length === 0) {
    return `🔍 glob "${pattern}" — no matches found`;
  }

  const relativePaths = files
    .map((file) => relative(baseDir, file))
    .sort((a, b) => a.localeCompare(b));

  const header = `🔍 glob "${pattern}" — ${files.length} ${files.length === 1 ? 'match' : 'matches'}\n${'─'.repeat(48)}`;
  const body = relativePaths.map((path) => `  ${path}`).join('\n');

  return `${header}\n${body}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createGlobTool(): AgentTool {
  return {
    name: 'glob',
    riskLevel: 'read',
    description: '使用 glob 模式查找文件',
    inputSchema: zodToJsonSchema(globInputSchema) as JsonSchema,

    async execute(input, context): Promise<ToolExecutionResult> {
      const parsed = globInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      // 解析搜索目录
      const searchDir = resolveSearchDir(context.cwd, parsed.data.cwd);

      try {
        // 使用 Node.js 内置 glob 函数
        const files: string[] = [];

        for await (const file of glob(parsed.data.pattern, { cwd: searchDir })) {
          files.push(resolve(searchDir, file));
        }

        return {
          status: 'success',
          output: formatResult(files, searchDir, parsed.data.pattern),
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
