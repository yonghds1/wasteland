import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { t } from "../locales/index.js";
import type { AgentTool, ToolExecutionResult } from "./tool-types.js";

// ============================================================
// 配置常量
// ============================================================

/** 显示完整内容的最大行数 */
const MAX_FULL_CONTENT_LINES = 200;

/** 大文件截断时首尾各显示的行数 */
const TRUNCATION_HALF_LINES = 50;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析并验证文件路径
 *
 * @param cwd - 当前工作目录
 * @param value - 输入路径值
 * @returns 解析后的绝对路径，或 null 表示无效
 */
function resolveReadablePath(cwd: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const targetPath = resolve(cwd, value);
  const relativePath = relative(cwd, targetPath);

  // 不允许读取工作目录外的文件
  if (relativePath.startsWith("..")) {
    return null;
  }

  return targetPath;
}

/**
 * 解析可选的数字参数
 *
 * @param value - 输入值
 * @returns 解析后的数字，或 undefined
 */
function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/**
 * 格式化文件元数据头
 */
function formatFileHeader(
  relativePath: string,
  totalLines: number,
  byteSize: number,
  truncated: boolean,
  offset?: number,
  limit?: number,
): string {
  const sizeKB = (byteSize / 1024).toFixed(1);
  const lines = totalLines === 1 ? "1 line" : `${totalLines} lines`;

  if (offset !== undefined || limit !== undefined) {
    const rangeDesc = offset !== undefined
      ? `lines ${offset}-${Math.min(offset + (limit ?? totalLines) - 1, totalLines)}`
      : `first ${limit} lines`;
    return `📄 ${relativePath} (${lines}, ${sizeKB}KB) — ${rangeDesc}\n${"─".repeat(48)}`;
  }

  if (truncated) {
    return `📄 ${relativePath} (${lines}, ${sizeKB}KB) — truncated, use offset/limit to read more\n${"─".repeat(48)}`;
  }

  return `📄 ${relativePath} (${lines}, ${sizeKB}KB)\n${"─".repeat(48)}`;
}

/**
 * 格式化带行号的内容
 *
 * @param lines - 文本行数组
 * @param startLine - 起始行号（默认 1）
 * @param totalLines - 文件总行数（用于计算行号宽度）
 * @returns 格式化后的文本
 */
function formatWithLineNumbers(
  lines: string[],
  startLine: number = 1,
  totalLines?: number,
): string {
  const maxWidth = String(totalLines ?? lines.length + startLine - 1).length;

  return lines
    .map((line, index) => {
      const lineNum = String(startLine + index).padStart(maxWidth);
      return `${lineNum}│${line}`;
    })
    .join("\n");
}

/**
 * 处理文件内容输出
 *
 * 根据文件大小和参数决定输出策略：
 * 1. 有 offset/limit 参数：返回指定范围
 * 2. 文件 <= MAX_FULL_CONTENT_LINES：返回完整内容
 * 3. 文件 > MAX_FULL_CONTENT_LINES：返回首尾截断
 */
function processFileContent(
  content: string,
  relativePath: string,
  byteSize: number,
  offset?: number,
  limit?: number,
): ToolExecutionResult {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // 情况 1：用户指定了范围
  if (offset !== undefined || limit !== undefined) {
    const startLine = offset ?? 1;
    const effectiveLimit = limit ?? totalLines;
    const endLine = Math.min(startLine + effectiveLimit - 1, totalLines);

    if (startLine > totalLines) {
      return {
        status: "error",
        error: t("tools.readFile.offsetOutOfRange", { offset: String(startLine), total: String(totalLines) }),
      };
    }

    const selectedLines = lines.slice(startLine - 1, endLine);
    const header = formatFileHeader(relativePath, totalLines, byteSize, false, startLine, limit);
    const formattedContent = formatWithLineNumbers(selectedLines, startLine, totalLines);

    return {
      status: "success",
      output: `${header}\n${formattedContent}`,
      data: {
        path: relativePath,
        totalLines,
        shownLines: selectedLines.length,
        offset: startLine,
      },
    };
  }

  // 情况 2：小文件，显示完整内容
  if (totalLines <= MAX_FULL_CONTENT_LINES) {
    const header = formatFileHeader(relativePath, totalLines, byteSize, false);
    const formattedContent = formatWithLineNumbers(lines, 1, totalLines);

    return {
      status: "success",
      output: `${header}\n${formattedContent}`,
      data: {
        path: relativePath,
        totalLines,
        truncated: false,
      },
    };
  }

  // 情况 3：大文件，首尾截断
  const firstLines = lines.slice(0, TRUNCATION_HALF_LINES);
  const lastLines = lines.slice(-TRUNCATION_HALF_LINES);
  const hiddenLines = totalLines - TRUNCATION_HALF_LINES * 2;

  const header = formatFileHeader(relativePath, totalLines, byteSize, true);
  const firstFormatted = formatWithLineNumbers(firstLines, 1, totalLines);
  const lastFormatted = formatWithLineNumbers(lastLines, totalLines - TRUNCATION_HALF_LINES + 1, totalLines);

  const separator = `\n${" ".repeat(String(totalLines).length)}│... ${hiddenLines} lines hidden ...\n`;

  return {
    status: "success",
    output: `${header}\n${firstFormatted}${separator}${lastFormatted}`,
    data: {
      path: relativePath,
      totalLines,
      truncated: true,
      hiddenLines,
    },
  };
}

// ============================================================
// 工具实现
// ============================================================

/**
 * 创建 read-file 工具
 *
 * ## 功能
 *
 * 读取指定文件的内容，支持分页读取大文件。
 *
 * ## 参数
 *
 * - `path`: 文件路径（相对于工作目录）
 * - `offset`: 起始行号（可选，从 1 开始）
 * - `limit`: 读取行数（可选）
 *
 * ## 输出格式
 *
 * ```
 * 📄 src/file.ts (100 lines, 2.5KB)
 * ────────────────────────────────────────────────────────
 *   1│import { foo } from "./bar.js";
 *   2│
 *   3│export function example() {
 * ... 50 lines hidden ...
 *  99│}
 * 100│
 * ```
 *
 * ## 使用场景
 *
 * 1. 小文件（<= 200 行）：自动显示完整内容
 * 2. 大文件：自动截断，显示首尾各 50 行
 * 3. 读取特定部分：使用 offset/limit 参数
 *
 * @example
 * // 读取完整文件
 * read-file({ path: "src/index.ts" })
 *
 * // 读取第 100-150 行
 * read-file({ path: "large-file.ts", offset: 100, limit: 50 })
 */
export function createReadFileTool(): AgentTool {
  return {
    name: "read-file",
    riskLevel: "read",

    async execute(input, context): Promise<ToolExecutionResult> {
      // 解析路径
      const targetPath = resolveReadablePath(context.cwd, input.path);

      if (!targetPath) {
        return {
          status: "error",
          error: t("tools.readFile.needRelativePath"),
        };
      }

      const relativePath = relative(context.cwd, targetPath);

      // 解析可选参数
      const offset = parseOptionalNumber(input.offset);
      const limit = parseOptionalNumber(input.limit);

      try {
        // 读取文件内容和元数据
        const [content, stats] = await Promise.all([
          readFile(targetPath, "utf8"),
          stat(targetPath),
        ]);

        return processFileContent(content, relativePath, stats.size, offset, limit);
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
