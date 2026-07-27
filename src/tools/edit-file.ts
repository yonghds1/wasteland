/**
 * edit-file.ts - 文件精确编辑工具
 *
 * 提供精确字符串替换功能，用于修改已有文件。
 * 不支持正则或模糊匹配，只做精确字符串替换。
 *
 * ## 安全机制
 *
 * - riskLevel: "write" — 需要权限确认
 * - read-before-edit — 必须先读取文件才能编辑（由 tool-dispatch 检查）
 * - old_string 必须唯一匹配，否则报错（除非 replace_all: true）
 *
 * ## 参数
 *
 * - path: 文件路径（相对于 cwd）
 * - old_string: 要替换的原始字符串
 * - new_string: 替换后的新字符串
 * - replace_all: 是否替换所有匹配项（可选，默认 false）
 */

import { readFile, writeFile } from 'node:fs/promises';

import { resolveWithinCwd } from './path-utils.js';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '../locales/index.js';
import type { AgentTool } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const editFileInputSchema = z.object({
  path: z.string().min(1).describe('要编辑的文件路径（相对于工作目录）'),
  old_string: z.string().describe('要替换的原始字符串'),
  new_string: z.string().describe('替换后的新字符串'),
  replace_all: z.boolean().default(false).describe('是否替换所有匹配项（默认 false）'),
});

export type EditFileInput = z.infer<typeof editFileInputSchema>;

/**
 * 创建 edit-file 工具
 *
 * @returns AgentTool 实例
 */
export function createEditFileTool(): AgentTool {
  return {
    name: 'edit-file',
    riskLevel: 'write',
    description: '精确编辑文件内容，通过字符串替换修改',
    inputSchema: zodToJsonSchema(editFileInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = editFileInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      // 解析路径（基于 realpath 防止符号链接穿越）
      const targetPath = await resolveWithinCwd(context.cwd, parsed.data.path);

      if (!targetPath) {
        return {
          status: 'error',
          error: t('tools.editFile.needRelativePath'),
        };
      }

      try {
        // 读取文件内容
        const content = await readFile(targetPath, 'utf8');

        // 检查匹配次数
        const matchCount = countMatches(content, parsed.data.old_string);

        if (matchCount === 0) {
          return {
            status: 'error',
            error: t('tools.editFile.noMatch'),
          };
        }

        if (matchCount > 1 && !parsed.data.replace_all) {
          return {
            status: 'error',
            error: t('tools.editFile.multipleMatches', { count: String(matchCount) }),
          };
        }

        // 执行替换
        const newContent = parsed.data.replace_all
          ? content.split(parsed.data.old_string).join(parsed.data.new_string)
          : content.replace(parsed.data.old_string, parsed.data.new_string);

        // 写入文件
        await writeFile(targetPath, newContent, 'utf8');

        return {
          status: 'success',
          output: t('tools.editFile.success', { count: String(parsed.data.replace_all ? matchCount : 1) }),
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

/**
 * 计算字符串在文本中出现的次数
 *
 * @param content - 文本内容
 * @param searchString - 要搜索的字符串
 * @returns 匹配次数
 */
function countMatches(content: string, searchString: string): number {
  if (searchString.length === 0) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (true) {
    const index = content.indexOf(searchString, position);
    if (index === -1) {
      break;
    }
    count++;
    position = index + searchString.length;
  }

  return count;
}
