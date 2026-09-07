/**
 * log-export.ts - LogsPage 导出纯函数模块
 *
 * 将当前选中 session 的日志（应用过滤后）导出为 markdown / JSON 文件，
 * 保存到中央数据根 data/exports/<projectId>/。纯函数与文件写入分离，便于单测：
 * - serializeLogEntriesToMarkdown / serializeLogEntriesToJson：纯序列化
 * - buildExportFileName：文件名生成
 * - writeExportFile：写盘（目录自动创建），返回完整路径
 * - exportLogEntries：串起「序列化 → 写盘」的入口
 *
 * 文件字段对齐 PRD：timestamp / level / kind / message / data（另含 scope/turn/step/error）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry, LogError, LogLevel, LogScope } from '@core/logger/index.js';

// ============================================================
// 导出类型
// ============================================================

/** 导出文件格式：markdown 表格 / JSON 结构化数组。 */
export type LogExportFormat = 'markdown' | 'json';

/**
 * 导出用的扁平日志条目（在 LogEntry 基础上派生 kind 字段）。
 *
 * kind 从 data.kind 提取（与 LogsPage 卡片头部展示一致），
 * 未定义时省略；其余字段透传。
 */
export type ExportLogEntry = {
  timestamp: string;
  level: LogLevel;
  kind?: string;
  scope: LogScope;
  message: string;
  data?: Record<string, unknown>;
  turn?: number;
  step?: number;
  error?: LogError;
};

// ============================================================
// 条目转换
// ============================================================

/** 从 LogEntry 提取 data.kind（未定义/非字符串 → undefined）。 */
function extractKind(data: Record<string, unknown> | undefined): string | undefined {
  const kind = data?.kind;
  return typeof kind === 'string' ? kind : undefined;
}

/** LogEntry → ExportLogEntry（kind 从 data.kind 派生，其余透传）。 */
export function toExportLogEntry(entry: LogEntry): ExportLogEntry {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    kind: extractKind(entry.data),
    scope: entry.scope,
    message: entry.message,
    data: entry.data,
    turn: entry.turn,
    step: entry.step,
    error: entry.error,
  };
}

// ============================================================
// 纯序列化
// ============================================================

/** data 序列化为单行字符串（undefined/null → 空串；对象 → 紧凑 JSON）。 */
function serializeDataInline(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/** markdown 表格单元格转义：`|` → `\|`，换行 → 空格（保证表格不破行）。 */
function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * 序列化为 markdown 表格。
 *
 * 每行含 # / timestamp / level / kind / scope / message / data 七列；
 * 头部带 session、条目数、导出时间元信息。
 *
 * entries 保持调用方传入的顺序（LogsPage 传入过滤后的 sessionCards 显示顺序）。
 */
export function serializeLogEntriesToMarkdown(
  entries: LogEntry[],
  opts: { sessionId?: string; now?: string } = {},
): string {
  const now = opts.now ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push('# Session Log Export');
  lines.push('');
  lines.push(`- session: ${opts.sessionId ?? '-'}`);
  lines.push(`- entries: ${entries.length}`);
  lines.push(`- exported at: ${now}`);
  lines.push('');
  lines.push('| # | timestamp | level | kind | scope | message | data |');
  lines.push('|---|---|---|---|---|---|---|');
  entries.forEach((entry, i) => {
    const exp = toExportLogEntry(entry);
    const dataStr = exp.data !== undefined ? serializeDataInline(exp.data) : '';
    lines.push(
      [
        `| ${i + 1}`,
        markdownCell(exp.timestamp),
        exp.level,
        markdownCell(exp.kind ?? '-'),
        markdownCell(exp.scope),
        markdownCell(exp.message),
        `${markdownCell(dataStr) || '-'} |`,
      ].join(' | '),
    );
  });
  lines.push('');
  return lines.join('\n');
}

/**
 * 序列化为 JSON 结构化数组（缩进美化，便于人读与 diff）。
 *
 * 数组元素为 ExportLogEntry（含 timestamp/level/kind/message/data 等字段）。
 */
export function serializeLogEntriesToJson(
  entries: LogEntry[],
  opts: { pretty?: boolean } = {},
): string {
  const payload: ExportLogEntry[] = entries.map(toExportLogEntry);
  return opts.pretty === false ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
}

// ============================================================
// 文件名
// ============================================================

/**
 * 生成导出文件名：<sessionId>-<ISO时间戳去冒号点>.<ext>。
 *
 * sessionId 中非 [a-zA-Z0-9._-] 的字符替换为 `_`（磁盘文件名安全）。
 * 例：`s1-2026-08-11T01-02-03-000Z.md`。
 */
export function buildExportFileName(
  sessionId: string,
  format: LogExportFormat,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'session';
  const ext = format === 'markdown' ? 'md' : 'json';
  return `${safeId}-${stamp}.${ext}`;
}

// ============================================================
// 写盘
// ============================================================

/**
 * 写导出文件到磁盘（目录不存在时递归创建），返回完整保存路径。
 *
 * @param opts.dir - 导出根目录（中央数据根 data/exports/<projectId>）
 */
export async function writeExportFile(opts: {
  dir: string;
  sessionId: string;
  format: LogExportFormat;
  content: string;
  now?: Date;
}): Promise<string> {
  const { dir, sessionId, format, content, now } = opts;
  const fileName = buildExportFileName(sessionId, format, now);
  const filePath = join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * 导出入口：序列化 + 写盘，返回完整保存路径。
 *
 * @param opts.dir - 导出根目录
 * @param opts.sessionId - 当前 session id（用于文件名与 markdown 元信息）
 * @param opts.entries - 应用过滤后的日志条目
 * @param opts.format - markdown / json
 * @param opts.now - 可选，注入导出时间（测试用）
 */
export async function exportLogEntries(opts: {
  dir: string;
  sessionId: string;
  entries: LogEntry[];
  format: LogExportFormat;
  now?: Date;
}): Promise<string> {
  const { dir, sessionId, entries, format, now } = opts;
  const content =
    format === 'markdown'
      ? serializeLogEntriesToMarkdown(entries, { sessionId, now: now?.toISOString() })
      : serializeLogEntriesToJson(entries);
  return writeExportFile({ dir, sessionId, format, content, now });
}
