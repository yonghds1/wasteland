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

import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { AgentTool } from "./tool-types.js";

/**
 * 解析可编辑的文件路径
 *
 * 确保路径在当前工作目录内，防止路径遍历攻击。
 *
 * @param cwd - 当前工作目录
 * @param value - 用户输入的路径
 * @returns 解析后的绝对路径，或 null（路径无效）
 */
function resolveEditablePath(cwd: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const targetPath = resolve(cwd, value);
  const relativePath = relative(cwd, targetPath);

  // 防止路径遍历：不允许 .. 开头
  if (relativePath.startsWith("..")) {
    return null;
  }

  return targetPath;
}

/**
 * 创建 edit-file 工具
 *
 * @returns AgentTool 实例
 */
export function createEditFileTool(): AgentTool {
  return {
    name: "edit-file",
    riskLevel: "write",

    async execute(input, context) {
      // 解析路径
      const targetPath = resolveEditablePath(context.cwd, input.path);

      if (!targetPath) {
        return {
          status: "error",
          error: "edit-file 需要一个位于当前工作目录内的相对路径。",
        };
      }

      // 验证参数
      const oldString = typeof input.old_string === "string" ? input.old_string : "";
      const newString = typeof input.new_string === "string" ? input.new_string : "";
      const replaceAll = input.replace_all === true;

      if (oldString.length === 0) {
        return {
          status: "error",
          error: "edit-file 需要非空的 old_string 参数。",
        };
      }

      try {
        // 读取文件内容
        const content = await readFile(targetPath, "utf8");

        // 检查匹配次数
        const matchCount = countMatches(content, oldString);

        if (matchCount === 0) {
          return {
            status: "error",
            error: `未找到匹配的字符串。请确保 old_string 与文件内容完全一致（包括空格和缩进）。`,
          };
        }

        if (matchCount > 1 && !replaceAll) {
          return {
            status: "error",
            error: `找到 ${matchCount} 处匹配，但 replace_all 为 false。请扩大 old_string 的上下文使其唯一，或设置 replace_all: true。`,
          };
        }

        // 执行替换
        const newContent = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);

        // 写入文件
        await writeFile(targetPath, newContent, "utf8");

        return {
          status: "success",
          output: `成功编辑文件 ${targetPath}（替换了 ${replaceAll ? matchCount : 1} 处）。`,
        };
      } catch (error) {
        return {
          status: "error",
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
