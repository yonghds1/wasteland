/**
 * list-directory.ts - 目录列表工具
 *
 * 列出指定目录的内容，包括文件和子目录。
 *
 * ## 功能特性
 * - 显示文件/目录名称、大小、修改时间
 * - 支持递归列出（可选）
 * - 支持显示隐藏文件（可选）
 * - 按名称排序输出
 *
 * ## 风险等级
 * read - 只读操作，不修改文件系统
 *
 * ## 参数
 * - path: 目录路径（可选，默认为当前工作目录）
 * - recursive: 是否递归列出子目录（可选，默认 false）
 * - showHidden: 是否显示隐藏文件（可选，默认 false）
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { AgentTool, ToolExecutionResult } from "./tool-types.js";

// ============================================================
// 配置常量
// ============================================================

/** 最大递归深度 */
const MAX_DEPTH = 5;

/** 单目录最大条目数 */
const MAX_ENTRIES_PER_DIR = 200;

/** 最大总条目数 */
const MAX_TOTAL_ENTRIES = 500;

// ============================================================
// 类型定义
// ============================================================

type DirEntry = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
  modified?: string;
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @returns 人类可读的大小字符串
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * 格式化修改时间
 *
 * @param date - 修改时间
 * @returns 格式化后的时间字符串
 */
function formatModified(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 获取目录条目信息
 *
 * @param entryPath - 条目完整路径
 * @param name - 条目名称
 * @param baseDir - 基准目录
 * @returns 目录条目信息
 */
async function getEntryInfo(
  entryPath: string,
  name: string,
  baseDir: string,
): Promise<DirEntry> {
  try {
    const s = await stat(entryPath);
    const isSymlink = s.isSymbolicLink();

    let type: DirEntry["type"];
    if (isSymlink) {
      type = "symlink";
    } else if (s.isDirectory()) {
      type = "directory";
    } else if (s.isFile()) {
      type = "file";
    } else {
      type = "other";
    }

    return {
      name,
      path: relative(baseDir, entryPath),
      type,
      size: type === "file" ? s.size : undefined,
      modified: formatModified(s.mtime),
    };
  } catch {
    return {
      name,
      path: relative(baseDir, entryPath),
      type: "other",
    };
  }
}

/**
 * 列出单个目录的内容
 *
 * @param dirPath - 目录路径
 * @param baseDir - 基准目录
 * @param showHidden - 是否显示隐藏文件
 * @returns 目录条目数组
 */
async function listSingleDir(
  dirPath: string,
  baseDir: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  const entries: DirEntry[] = [];

  try {
    const dirents = await readdir(dirPath, { withFileTypes: true });

    for (const dirent of dirents) {
      if (entries.length >= MAX_ENTRIES_PER_DIR) {
        break;
      }

      // 跳过隐藏文件（除非显式请求）
      if (!showHidden && dirent.name.startsWith(".")) {
        continue;
      }

      const entryPath = join(dirPath, dirent.name);
      const info = await getEntryInfo(entryPath, dirent.name, baseDir);
      entries.push(info);
    }
  } catch {
    // 无法读取目录
  }

  return entries;
}

/**
 * 递归列出目录内容
 *
 * @param dirPath - 起始目录路径
 * @param baseDir - 基准目录
 * @param showHidden - 是否显示隐藏文件
 * @param maxDepth - 最大递归深度
 * @returns 目录条目数组
 */
async function listRecursive(
  dirPath: string,
  baseDir: string,
  showHidden: boolean,
  maxDepth: number,
): Promise<DirEntry[]> {
  const allEntries: DirEntry[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth || allEntries.length >= MAX_TOTAL_ENTRIES) {
      return;
    }

    const entries = await listSingleDir(currentDir, baseDir, showHidden);

    // 先添加当前目录的条目
    for (const entry of entries) {
      if (allEntries.length >= MAX_TOTAL_ENTRIES) {
        break;
      }
      allEntries.push(entry);
    }

    // 递归处理子目录
    for (const entry of entries) {
      if (allEntries.length >= MAX_TOTAL_ENTRIES) {
        break;
      }
      if (entry.type === "directory") {
        const subDirPath = join(baseDir, entry.path);
        await walk(subDirPath, depth + 1);
      }
    }
  }

  await walk(dirPath, 0);
  return allEntries;
}

/**
 * 格式化条目图标
 *
 * @param entry - 目录条目
 * @returns 图标字符串
 */
function getEntryIcon(entry: DirEntry): string {
  switch (entry.type) {
    case "directory":
      return "📁";
    case "file":
      // 根据扩展名选择图标
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        return "📘";
      }
      if (entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) {
        return "📙";
      }
      if (entry.name.endsWith(".json")) {
        return "📋";
      }
      if (entry.name.endsWith(".md")) {
        return "📝";
      }
      return "📄";
    case "symlink":
      return "🔗";
    default:
      return "❓";
  }
}

/**
 * 格式化输出结果
 *
 * @param entries - 目录条目数组
 * @param dirPath - 目录路径
 * @param recursive - 是否递归
 * @returns 格式化后的输出文本
 */
function formatResult(entries: DirEntry[], dirPath: string, recursive: boolean): string {
  if (entries.length === 0) {
    return `📁 ${dirPath} — empty directory`;
  }

  // 按类型和名称排序：目录在前，然后按名称排序
  const sorted = [...entries].sort((a, b) => {
    // 目录优先
    if (a.type === "directory" && b.type !== "directory") {
      return -1;
    }
    if (a.type !== "directory" && b.type === "directory") {
      return 1;
    }
    // 同类型按名称排序
    return a.path.localeCompare(b.path);
  });

  const mode = recursive ? "recursive" : "flat";
  const header = `📁 ${dirPath} — ${entries.length} ${entries.length === 1 ? "entry" : "entries"} (${mode})\n${"─".repeat(48)}`;

  const body = sorted
    .map((entry) => {
      const icon = getEntryIcon(entry);
      const sizeStr = entry.size !== undefined ? ` ${formatSize(entry.size)}` : "";
      const pathStr = recursive ? entry.path : entry.name;
      return `  ${icon} ${pathStr}${sizeStr}`;
    })
    .join("\n");

  const truncationNote =
    entries.length >= MAX_TOTAL_ENTRIES
      ? `\n\n⚠ Results truncated at ${MAX_TOTAL_ENTRIES} entries.`
      : "";

  return `${header}\n${body}${truncationNote}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createListDirectoryTool(): AgentTool {
  return {
    name: "list-directory",
    riskLevel: "read",

    async execute(input, context): Promise<ToolExecutionResult> {
      // 解析目录路径
      const targetPath =
        typeof input.path === "string" && input.path.trim().length > 0
          ? resolve(context.cwd, input.path)
          : context.cwd;

      // 验证路径存在且是目录
      try {
        const s = await stat(targetPath);
        if (!s.isDirectory()) {
          return {
            status: "error",
            error: `路径 "${input.path}" 不是一个目录。`,
          };
        }
      } catch {
        return {
          status: "error",
          error: `路径 "${targetPath}" 不存在或无法访问。`,
        };
      }

      const recursive = input.recursive === true;
      const showHidden = input.showHidden === true;

      try {
        let entries: DirEntry[];

        if (recursive) {
          entries = await listRecursive(targetPath, targetPath, showHidden, MAX_DEPTH);
        } else {
          entries = await listSingleDir(targetPath, targetPath, showHidden);
        }

        return {
          status: "success",
          output: formatResult(entries, targetPath, recursive),
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
