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
 * 支持两种互斥的编辑模式，一次调用只能选择其中一种：
 *
 * 1. 单处编辑（兼容原调用，行为不变）：
 *    - path: 文件路径（相对于 cwd）
 *    - old_string: 要替换的原始字符串
 *    - new_string: 替换后的新字符串
 *    - replace_all: 是否替换所有匹配项（可选，默认 false）
 *
 * 2. 批量编辑（MultiEdit）：
 *    - path: 文件路径（相对于 cwd）
 *    - edits: 编辑项数组，按顺序逐条替换同一文件的多处内容。
 *      每项为 { old_string, new_string, replace_all? }，
 *      任一条失败则整体不写入文件（原子性）。
 *
 * 校验规则：
 * - edits 与 old_string/new_string 不能同时传入（冲突报错）
 * - edits 与单处参数都不提供时报错
 * - 单处模式必须同时提供 old_string 与 new_string
 */

import { readFile, writeFile } from 'node:fs/promises';

import { resolveWithinCwd } from '../utils/path-utils.js';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '@locales/index.js';
import type { AgentTool } from '../core/tool-types.js';
import type { JsonSchema } from '../core/tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

/**
 * 批量编辑中的单条编辑项
 */
export const editItemSchema = z.object({
  old_string: z.string().describe('要替换的原始字符串'),
  new_string: z.string().describe('替换后的新字符串'),
  replace_all: z.boolean().default(false).describe('是否替换所有匹配项（默认 false）'),
});

export type EditItem = z.infer<typeof editItemSchema>;

export const editFileInputSchema = z.object({
  path: z.string().min(1).describe('要编辑的文件路径（相对于工作目录）'),
  // 单处编辑模式参数（与 edits 互斥）
  old_string: z.string().optional().describe('要替换的原始字符串（单处编辑模式）'),
  new_string: z.string().optional().describe('替换后的新字符串（单处编辑模式）'),
  replace_all: z.boolean().default(false).describe('是否替换所有匹配项（默认 false）；仅在单处编辑模式生效，批量模式请在各 edits 条目内指定 replace_all'),
  // 批量编辑模式参数（与单处参数互斥）
  edits: z
    .array(editItemSchema)
    .optional()
    .describe('批量编辑项列表，按顺序逐条替换同一文件的多处内容'),
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

      const data = parsed.data;

      // === 模式校验 ===
      const singleProvided = data.old_string !== undefined || data.new_string !== undefined;
      const batchProvided = data.edits !== undefined;

      // 冲突：edits 与单处参数不能同时传
      if (singleProvided && batchProvided) {
        return { status: 'error', error: t('tools.editFile.conflict') };
      }

      // 两者都空
      if (!singleProvided && !batchProvided) {
        return { status: 'error', error: t('tools.editFile.needEdits') };
      }

      // 归一化为编辑项列表，并记录是否批量模式（决定错误文案是否带条目索引）
      let isBatch = false;
      let edits: EditItem[];
      if (batchProvided) {
        const editsList = data.edits;
        // edits 数组必须非空
        if (!editsList || editsList.length === 0) {
          return { status: 'error', error: t('tools.editFile.needEdits') };
        }
        isBatch = true;
        edits = editsList;
      } else {
        // 单处模式：old_string 与 new_string 都必须提供
        if (data.old_string === undefined || data.new_string === undefined) {
          return { status: 'error', error: t('tools.editFile.needBothOldAndNew') };
        }
        edits = [
          {
            old_string: data.old_string,
            new_string: data.new_string,
            replace_all: data.replace_all,
          },
        ];
      }

      // 解析路径（基于 realpath 防止符号链接穿越）
      const targetPath = await resolveWithinCwd(context.cwd, data.path);

      if (!targetPath) {
        return {
          status: 'error',
          error: t('tools.editFile.needRelativePath'),
        };
      }

      try {
        // 读取文件内容
        let content = await readFile(targetPath, 'utf8');
        let totalReplacements = 0;

        // 按顺序逐条应用编辑，全部成功才写入（原子性）
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i];
          const matchCount = countMatches(content, edit.old_string);

          if (matchCount === 0) {
            return {
              status: 'error',
              error: isBatch
                ? t('tools.editFile.noMatchInEdit', { index: String(i + 1) })
                : t('tools.editFile.noMatch'),
            };
          }

          if (matchCount > 1 && !edit.replace_all) {
            return {
              status: 'error',
              error: isBatch
                ? t('tools.editFile.multipleMatchesInEdit', {
                    index: String(i + 1),
                    count: String(matchCount),
                  })
                : t('tools.editFile.multipleMatches', { count: String(matchCount) }),
            };
          }

          content = edit.replace_all
            ? content.split(edit.old_string).join(edit.new_string)
            : content.replace(edit.old_string, edit.new_string);

          totalReplacements += edit.replace_all ? matchCount : 1;
        }

        // 写入文件
        await writeFile(targetPath, content, 'utf8');

        return {
          status: 'success',
          output: t('tools.editFile.success', { count: String(totalReplacements) }),
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
