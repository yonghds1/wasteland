/**
 * debug-logger.ts - 统一 debug 日志写入
 *
 * 把 DebugTraceEvent 和其他调试事件以 JSONL 格式追加到 .wasteland/debug.log，
 * 方便用户用 `tail -f .wasteland/debug.log` 实时观察流式、工具调用、错误等。
 *
 * 设计原则：
 * - 仅 debug 开启时实际写入（enableDebugLog() 被调用后）；否则是 no-op
 * - JSONL 格式（每行一个 JSON），便于 grep/jq 分析
 * - 同步追加 appendFileSync，单行写入是原子的，多事件不会交错
 * - 写入失败静默忽略（日志不应阻塞主流程）
 *
 * 写入位置统一：所有调用方（agent-loop trace、provider event、runtime event）
 * 都通过 debugLog() 写到这里，确保日志路径一致。
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let enabled = false;
let initialized = false;
let filePath: string | null = null;

function ensureInit(): string | null {
  if (initialized) return filePath;
  initialized = true;
  try {
    const dir = join(process.cwd(), '.wasteland');
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'debug.log');
    // 启动时追加一行 header 标记本次会话开始
    appendFileSync(
      filePath,
      `# wasteland debug session started at ${new Date().toISOString()}\n`
    );
    return filePath;
  } catch {
    return null;
  }
}

/**
 * 启用 debug 日志写入。调用前 debugLog() 是 no-op，调用后开始写入 .wasteland/debug.log。
 *
 * 应在启动时根据 settings.runtime.debug 决定是否调用。
 */
export function enableDebugLog(): void {
  enabled = true;
}

/**
 * 关闭 debug 日志（关闭后 debugLog 又是 no-op）。
 * 当前未使用（进程退出自然终止），保留供未来动态切换。
 */
export function disableDebugLog(): void {
  enabled = false;
}

/**
 * 写入一条 debug 日志条目（JSONL 格式）。
 *
 * 自动追加 `timestamp` 字段；entry 其余字段原样写入。
 * 单行原子写入，多并发调用不会交错（每行独立完整 JSON）。
 *
 * @example
 * debugLog({ type: 'trace', scope: 'provider', phase: 'chunk', textLength: 12 });
 * // 写入: {"timestamp":"2026-07-27T...","type":"trace","scope":"provider",...}\n
 */
export function debugLog(entry: Record<string, unknown>): void {
  if (!enabled) return;
  const path = ensureInit();
  if (!path) return;
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    appendFileSync(path, line);
  } catch {
    // 静默：日志不应阻塞主流程
  }
}

/**
 * 当前 debug 日志文件路径（仅在 enableDebugLog 后有值）。供测试/展示用。
 */
export function getDebugLogPath(): string | null {
  return filePath;
}