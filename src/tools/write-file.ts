/**
 * write-file.ts - 文件完整覆写工具
 *
 * 提供文件创建或完整覆写功能。
 * 自动创建文件及必要的父目录。
 *
 * ## 安全机制
 *
 * - riskLevel: "write" — 需要权限确认
 * - read-before-edit — 覆写已有文件时需要先读取（由 tool-dispatch 检查）
 * - 自动创建父目录
 *
 * ## 参数
 *
 * - path: 文件路径（相对于 cwd）
 * - content: 文件完整内容
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const writeFileInputSchema = z.object({
  path: z.string().min(1).describe('文件路径（相对于工作目录）'),
  content: z.string().describe('文件完整内容'),
});

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

/**
 * 解析可写入的文件路径
 *
 * 确保路径在当前工作目录内，防止路径遍历攻击。
 *
 * @param cwd - 当前工作目录
 * @param value - 用户输入的路径
 * @returns 解析后的绝对路径，或 null（路径无效）
 */
function resolveWritablePath(cwd: string, value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const targetPath = resolve(cwd, value);
  const relativePath = relative(cwd, targetPath);

  // 防止路径遍历：不允许 .. 开头
  if (relativePath.startsWith('..')) {
    return null;
  }

  return targetPath;
}

/**
 * 创建 write-file 工具
 *
 * @returns AgentTool 实例
 */
export function createWriteFileTool(): AgentTool {
  return {
    name: 'write-file',
    riskLevel: 'write',
    description: '创建或覆写文件内容',
    inputSchema: zodToJsonSchema(writeFileInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = writeFileInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      // 解析路径
      const targetPath = resolveWritablePath(context.cwd, parsed.data.path);

      if (!targetPath) {
        return {
          status: 'error',
          error: 'write-file 需要一个位于当前工作目录内的相对路径。',
        };
      }

      try {
        // 检查文件是否存在
        let fileExists = false;
        try {
          await readFile(targetPath, 'utf8');
          fileExists = true;
        } catch {
          // 文件不存在，继续
        }

        // 创建父目录（如果不存在）
        const parentDir = dirname(targetPath);
        await mkdir(parentDir, { recursive: true });

        // 写入文件
        await writeFile(targetPath, parsed.data.content, 'utf8');

        const action = fileExists ? '覆写' : '创建';
        return {
          status: 'success',
          output: `成功${action}文件 ${targetPath}（${parsed.data.content.length} 字符）。`,
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
