/**
 * logs-test-helpers.ts - LogsPage 测试共享工厂
 *
 * 从 logs-page.test.tsx 抽取的纯数据工厂，供多个测试文件复用。
 */

import type { LogEntry } from '@core/logger/index.js';

export function start(toolName: string, timestamp: string): LogEntry {
  return {
    version: 1,
    timestamp,
    level: 'info',
    scope: 'tool',
    sessionId: 's1',
    message: 'tool.start',
    data: { kind: 'tool_start', toolName },
  };
}

/** 构造 tool_end 事件条目（durationMs 可选，缺失时走时间戳推算）。 */
export function end(toolName: string, timestamp: string, durationMs?: number): LogEntry {
  return {
    version: 1,
    timestamp,
    level: 'info',
    scope: 'tool',
    sessionId: 's1',
    message: 'tool.end',
    data: { kind: 'tool_end', toolName, ...(durationMs !== undefined ? { durationMs } : {}) },
  };
}

/** 构造 tool_error 事件条目。 */
export function err(
  toolName: string,
  timestamp: string,
  message: string,
  durationMs?: number,
): LogEntry {
  return {
    version: 1,
    timestamp,
    level: 'error',
    scope: 'tool',
    sessionId: 's1',
    message: 'tool.error',
    error: { name: 'Error', message },
    data: { kind: 'tool_error', toolName, ...(durationMs !== undefined ? { durationMs } : {}) },
  };
}

/** 非工具事件条目（应被忽略）。 */
export function nonToolEntry(timestamp: string): LogEntry {
  return {
    version: 1,
    timestamp,
    level: 'info',
    scope: 'session',
    sessionId: 's1',
    message: 'session.start',
  };
}

/** 构造指定 session 的 tool_start 事件条目（全局时间线测试用）。 */
export function startIn(sessionId: string, toolName: string, timestamp: string): LogEntry {
  return { ...start(toolName, timestamp), sessionId };
}

/** 构造指定 session 的 tool_end 事件条目（全局时间线测试用）。 */
export function endIn(
  sessionId: string,
  toolName: string,
  timestamp: string,
  durationMs?: number,
): LogEntry {
  return { ...end(toolName, timestamp, durationMs), sessionId };
}

/** 构造指定 session 的 tool_error 事件条目（全局时间线测试用）。 */
export function errIn(
  sessionId: string,
  toolName: string,
  timestamp: string,
  message: string,
  durationMs?: number,
): LogEntry {
  return { ...err(toolName, timestamp, message, durationMs), sessionId };
}

// ============================================================
// 视图切换
// ============================================================


/** 构造导出测试用的样例日志条目。 */
export function exportSampleEntry(ts: string, level: string, message: string): LogEntry {
  return {
    version: 1,
    timestamp: ts,
    level: level as LogEntry['level'],
    scope: 'tool',
    sessionId: 's1',
    message,
    data: { kind: 'tool_error', toolName: 'read-file' },
    ...(level === 'error' ? { error: { name: 'Error', message } } : {}),
  };
}

/** 构造按时间正序的条目流（可指定错误位置）。 */
export function makeChronoEntries(
  opts: { count: number; errorAt: number }): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 1; i <= opts.count; i++) {
    const isError = i === opts.errorAt;
    entries.push({
      version: 1,
      timestamp: `2026-08-10T01:00:${String(i).padStart(2, '0')}.000Z`,
      level: isError ? 'error' : 'info',
      scope: isError ? 'tool' : 'session',
      sessionId: 's1',
      message: `step-${i}`,
      ...(isError ? { error: { name: 'Error', message: `boom-${i}` } } : {}),
    });
  }
  return entries;
}

