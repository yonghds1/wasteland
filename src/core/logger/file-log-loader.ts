/**
 * file-log-loader.ts - 从磁盘 JSONL 文件加载历史日志
 *
 * LogsPage 需要显示历史日志（不仅是当前 session 的内存 buffer）。
 * 本模块扫描中央数据根 data/logs/<projectId>/*.jsonl 文件，按 mtime 倒序读取，
 * 合并 + 按 timestamp 排序，取最近 N 条。
 *
 * 设计要点：
 * - 流式读取：避免一次性加载大文件到内存
 * - 损坏行容错：单行 JSON.parse 失败不影响其他行
 * - AbortSignal：调用方可取消长时间读取
 * - 0 依赖：纯 fs / readline
 */

import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { logEntrySchema, type LogEntry } from './types.js';

// ============================================================
// Session 摘要类型
// ============================================================

/** Session 摘要信息（不包含日志条目，用于列表展示）。 */
export type SessionSummaryOnDisk = {
  sessionId: string;
  firstTime: string;
  lastTime: string;
  count: number;
  lastMessage: string;
  hasError: boolean;
};

/**
 * 从文件名提取 sessionId（<sessionId>.jsonl → <sessionId>）。
 *
 * 用于标识 session 文件。
 */
function extractSessionId(filename: string): string | null {
  if (!filename.endsWith('.jsonl')) return null;
  const sessionId = filename.slice(0, -6); // remove '.jsonl'
  return sessionId.length > 0 ? sessionId : null;
}

// ============================================================
// 加载缓存
// ============================================================
//
// 设计动机：LogsPage 在用户反复切换 session 时会重复调用 loadSessionEntries /
// listSessions。每次调用都做完整 readdir + stat + 流式读盘，对大 session / 大目录
// 是明显的重复 IO。这里用「文件版本指纹」做缓存：
//   - 指纹 = 文件 mtimeMs + size（日志追加/轮转会改变 size 或 mtime，因而失效）
//   - 指纹不变 → 命中缓存，跳过读盘
//   - 指纹变化（日志写入 / session 文件新增/删除）→ 自动失效重读
// 该策略天然覆盖「session 列表变化」与「日志写入后失效」两类失效场景。

/** 单条 session 条目缓存项。 */
type SessionEntriesCacheItem = {
  /** 文件版本指纹（mtimeMs:size）。 */
  version: string;
  /** 缓存的日志条目。 */
  entries: LogEntry[];
};

/** session 条目缓存：key = `${dir}::${sessionId}`。 */
const sessionEntriesCache = new Map<string, SessionEntriesCacheItem>();

/** session 条目缓存上限：超过时按插入序淘汰最旧（防止长期运行无界增长）。 */
export const MAX_SESSION_CACHE_ITEMS = 200;

/** session 摘要列表缓存：key = dir。 */
const sessionListCache = new Map<string, { version: string; sessions: SessionSummaryOnDisk[] }>();

/**
 * 单个文件的版本指纹（不存在返回 null）。
 *
 * 指纹由 mtimeMs 与 size 组成：任一变化都代表文件内容可能变更。
 */
async function fileVersion(filePath: string): Promise<string | null> {
  try {
    const s = await stat(filePath);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

/**
 * 目录下所有候选文件的聚合指纹（按文件名排序拼接），
 * 用于判断 session 列表是否发生变化（新增/删除/追加都会改变指纹）。
 */
async function dirVersion(dir: string, files: string[]): Promise<string> {
  const parts = await Promise.all(
    files.map(async (f) => {
      const version = await fileVersion(join(dir, f));
      return `${f}:${version ?? 'missing'}`;
    })
  );
  return parts.sort().join('|');
}

/**
 * 同步读取缓存的 session 条目（未命中返回 undefined）。
 *
 * 供 UI 在选中 session 时先查缓存：命中则直接渲染，避免闪烁 loading。
 */
export function getCachedSessionEntries(dir: string, sessionId: string): LogEntry[] | undefined {
  return sessionEntriesCache.get(`${dir}::${sessionId}`)?.entries;
}

/** 使指定 session 的条目缓存失效（下次加载重读盘）。 */
export function invalidateSessionEntryCache(dir: string, sessionId: string): void {
  sessionEntriesCache.delete(`${dir}::${sessionId}`);
}

/** 清空全部 session 条目缓存（测试 / 显式刷新用）。 */
export function clearSessionEntryCache(): void {
  sessionEntriesCache.clear();
}

/**
 * 写入一条 session 条目缓存；超限时按插入序淘汰最旧项。
 *
 * Map 保持插入顺序，keys().next() 即最早插入的 key，用它做 FIFO 淘汰。
 */
function cacheSessionEntries(key: string, item: SessionEntriesCacheItem): void {
  sessionEntriesCache.set(key, item);
  while (sessionEntriesCache.size > MAX_SESSION_CACHE_ITEMS) {
    const oldest = sessionEntriesCache.keys().next().value;
    if (oldest === undefined) break;
    sessionEntriesCache.delete(oldest);
  }
}

/**
 * 从单个 JSONL 文件流式读取 LogEntry[]，按 timestamp 倒序截取 limit 条。
 *
 * @param filePath - 完整文件路径
 * @param limit - 最大返回条数
 * @param signal - AbortSignal，用于取消
 * @returns LogEntry[]（按 timestamp 倒序）
 */
async function readLogFile(
  filePath: string,
  limit: number,
  signal?: AbortSignal,
): Promise<LogEntry[]> {
  return new Promise<LogEntry[]>((resolve, reject) => {
    const entries: LogEntry[] = [];

    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    const cleanup = (): void => {
      rl.close();
      stream.destroy();
    };

    if (signal) {
      const onAbort = (): void => {
        cleanup();
        reject(new Error('Aborted'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const parsed = logEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          entries.push(parsed.data);
        }
      } catch {
        // 单行损坏：跳过（不阻断其他行）
      }
    });

    rl.on('close', () => {
      // 文件按 timestamp 倒序（最新在上），截取 limit 条
      const sorted = entries
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit);
      resolve(sorted);
    });

    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * 从 dir/sessions/ 加载最近的 N 条日志条目（跨多个 session 文件）。
 *
 * 行为：
 * - 扫描 sessions/ 子目录下的 *.jsonl 文件（跳过 .gz）
 * - 按文件 mtime 倒序（最近修改的 session 先读）
 * - 每个文件内 timestamp 倒序
 * - 合并后取最近 limit 条
 *
 * 损坏行 / 单文件错误：跳过该行 / 该文件，继续处理。
 */
export async function loadRecentLogs(opts: {
  dir: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<LogEntry[]> {
  const { dir, limit = 50, signal } = opts;
  const sessionDir = join(dir, 'sessions');

  // 提前检查 abort signal（避免空目录情况下 readLogFile 没机会触发 abort）
  if (signal?.aborted) {
    throw new Error('Aborted');
  }

  let files: string[];
  try {
    const entries = await readdir(sessionDir);
    files = entries.filter((f) => {
      if (f.startsWith('.')) return false;
      if (f.endsWith('.gz')) return false;
      if (f === 'error.jsonl') return false;
      if (!extractSessionId(f)) return false;
      return true;
    });
  } catch (err) {
    // 目录不存在 → 返回空数组（graceful fallback）
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  // 按 mtime 倒序（最近修改的 session 文件先读）
  const filesWithMtime = await Promise.all(
    files.map(async (f) => {
      try {
        const stats = await stat(join(sessionDir, f));
        return { name: f, mtime: stats.mtimeMs };
      } catch {
        return { name: f, mtime: 0 };
      }
    })
  );
  filesWithMtime.sort((a, b) => b.mtime - a.mtime);
  const sortedFiles = filesWithMtime.map((f) => f.name);

  const all: LogEntry[] = [];

  for (const file of sortedFiles) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const filePath = join(sessionDir, file);

    // 检查文件大小（避免读巨大文件）
    try {
      const stats = await stat(filePath);
      // 单文件 > 100MB 直接跳过（异常情况）
      if (stats.size > 100 * 1024 * 1024) continue;
    } catch {
      continue;
    }

    try {
      const entries = await readLogFile(filePath, limit, signal);
      all.push(...entries);
    } catch {
      // 单文件读失败：跳过
      continue;
    }

    // 优化：如果已收集足够条目且都是最新文件，提前结束
    if (all.length >= limit) {
      break;
    }
  }

  // 合并所有文件后，按 timestamp 倒序，取 limit 条
  return all
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/**
 * 扫描磁盘日志文件，返回所有 session 的摘要信息（不加载日志条目）。
 *
 * 用于 LogsPage 的 session 列表分页显示。
 * 每个 session 只读取首尾条目来确定时间范围和最后消息。
 *
 * @param dir - 日志根目录（中央数据根 data/logs/<projectId>）
 * @param signal - AbortSignal，用于取消
 * @returns SessionSummaryOnDisk[] 按 lastTime 倒序
 */
export async function listSessions(opts: {
  dir: string;
  signal?: AbortSignal;
}): Promise<SessionSummaryOnDisk[]> {
  const { dir, signal } = opts;

  if (signal?.aborted) {
    throw new Error('Aborted');
  }

  // session 文件统一存放在 dir/sessions/ 子目录（与 FileSink 写盘布局一致，
  // 见 file-sink.ts:sessionFilePath）
  const sessionDir = join(dir, 'sessions');

  let files: string[];
  try {
    const entries = await readdir(sessionDir);
    files = entries.filter((f) => {
      if (f.startsWith('.')) return false;
      if (f.endsWith('.gz')) return false;
      if (f === 'error.jsonl') return false;
      if (!f.endsWith('.jsonl')) return false;
      return true;
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  // 缓存：文件集合指纹未变 → 直接返回上次扫描结果（避免重复流式读盘）
  const version = await dirVersion(sessionDir, files);
  const listKey = dir;
  const cached = sessionListCache.get(listKey);
  if (cached && cached.version === version) {
    return cached.sessions;
  }

  // 按 mtime 倒序
  const filesWithMtime = await Promise.all(
    files.map(async (f) => {
      try {
        const stats = await stat(join(sessionDir, f));
        return { name: f, mtime: stats.mtimeMs };
      } catch {
        return { name: f, mtime: 0 };
      }
    })
  );
  filesWithMtime.sort((a, b) => b.mtime - a.mtime);

  // 扫描所有文件，收集 session 信息
  const sessionMap = new Map<string, SessionSummaryOnDisk>();

  for (const file of filesWithMtime) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const filePath = join(sessionDir, file.name);

    // 检查文件大小
    try {
      const stats = await stat(filePath);
      if (stats.size > 100 * 1024 * 1024) continue;
    } catch {
      continue;
    }

    // 流式读取，只收集每个 session 的首尾条目和计数
    try {
      await readSessionSummary(filePath, sessionMap, signal);
    } catch {
      continue;
    }
  }

  // 按 lastTime 倒序
  const sessions = Array.from(sessionMap.values()).sort((a, b) =>
    b.lastTime.localeCompare(a.lastTime)
  );

  sessionListCache.set(listKey, { version, sessions });
  return sessions;
}

/**
 * 从单个文件中提取 session 摘要信息。
 *
 * 只读取每个 session 的首条和最后一条来确定时间范围。
 */
async function readSessionSummary(
  filePath: string,
  sessionMap: Map<string, SessionSummaryOnDisk>,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    const cleanup = (): void => {
      rl.close();
      stream.destroy();
    };

    if (signal) {
      const onAbort = (): void => {
        cleanup();
        reject(new Error('Aborted'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const parsed = logEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          const entry = parsed.data;
          const sid = entry.sessionId;
          const existing = sessionMap.get(sid);

          if (!existing) {
            // 新 session
            sessionMap.set(sid, {
              sessionId: sid,
              firstTime: entry.timestamp,
              lastTime: entry.timestamp,
              count: 1,
              lastMessage: entry.message,
              hasError: entry.level === 'error',
            });
          } else {
            // 更新：保留最早时间，更新最新时间和消息
            existing.count++;
            if (entry.timestamp < existing.firstTime) {
              existing.firstTime = entry.timestamp;
            }
            if (entry.timestamp > existing.lastTime) {
              existing.lastTime = entry.timestamp;
              existing.lastMessage = entry.message;
            }
            if (entry.level === 'error') {
              existing.hasError = true;
            }
          }
        }
      } catch {
        // 单行损坏：跳过
      }
    });

    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * 每个 session 的轮转归档上限（与 rotation.ts file → .1 → .2 顺序一致，数字越大越旧）。
 *
 * CLI（commands/logs.ts）同样读取 .jsonl.N 档，两边策略对齐，避免 TUI 看不到已归档日志。
 */
export const MAX_ROTATED_ARCHIVES = 4;

/**
 * 从磁盘加载指定 session 的所有日志条目（含轮转归档）。
 *
 * @param dir - 日志根目录（中央数据根 data/logs/<projectId>）
 * @param sessionId - 要加载的 sessionId
 * @param signal - AbortSignal，用于取消
 * @returns LogEntry[] 按 timestamp 正序
 */
export async function loadSessionEntries(opts: {
  dir: string;
  sessionId: string;
  signal?: AbortSignal;
}): Promise<LogEntry[]> {
  const { dir, sessionId, signal } = opts;

  if (signal?.aborted) {
    throw new Error('Aborted');
  }

  // 每个 session 一条 active 文件 + 最多 MAX_ROTATED_ARCHIVES 个归档：
  // dir/sessions/<sessionId>.jsonl（与 FileSink 写盘布局一致）
  const sessionDir = join(dir, 'sessions');
  const candidateFiles = [
    join(sessionDir, `${sessionId}.jsonl`),
    ...Array.from({ length: MAX_ROTATED_ARCHIVES }, (_, i) => join(sessionDir, `${sessionId}.jsonl.${i + 1}`)),
  ];
  const cacheKey = `${dir}::${sessionId}`;

  // 候选文件指纹（mtimeMs:size）：任一变化都失效；全部缺失则清缓存返回空
  const versions = await Promise.all(candidateFiles.map((f) => fileVersion(f)));
  const existing = candidateFiles.filter((_, i) => versions[i] !== null);
  if (existing.length === 0) {
    // 文件不存在（未写入 / 已归档删除）→ 清除缓存，返回空
    sessionEntriesCache.delete(cacheKey);
    return [];
  }
  const version = versions.join('|');
  const cached = sessionEntriesCache.get(cacheKey);
  if (cached && cached.version === version) {
    return cached.entries;
  }

  // 检查文件大小（避免读异常巨大的文件）
  const readable: string[] = [];
  for (const filePath of existing) {
    try {
      const stats = await stat(filePath);
      if (stats.size <= 100 * 1024 * 1024) readable.push(filePath);
    } catch {
      continue;
    }
  }
  if (readable.length === 0) {
    sessionEntriesCache.delete(cacheKey);
    return [];
  }

  // 流式读取各文件条目后合并（归档与 active 可能有毫秒级重叠写入，按时间排序收敛；
  // 单个归档损坏只跳过该档，不丢整个 session；有失败时不缓存，避免冻结残缺快照）
  const settled = await Promise.allSettled(
    readable.map((filePath) => readLogFileForSession(filePath, sessionId, signal)),
  );
  const failed = settled.some((r) => r.status === 'rejected');
  const entries: LogEntry[] = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // 按 timestamp 正序（同毫秒按 seq 收敛）
  const sorted = entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || (a.seq ?? 0) - (b.seq ?? 0));
  if (!failed) {
    cacheSessionEntries(cacheKey, { version, entries: sorted });
  }
  return sorted;
}

/**
 * 从单个文件中读取指定 sessionId 的条目。
 */
async function readLogFileForSession(
  filePath: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<LogEntry[]> {
  return new Promise<LogEntry[]>((resolve, reject) => {
    const entries: LogEntry[] = [];

    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    const cleanup = (): void => {
      rl.close();
      stream.destroy();
    };

    if (signal) {
      const onAbort = (): void => {
        cleanup();
        reject(new Error('Aborted'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const parsed = logEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success && parsed.data.sessionId === sessionId) {
          entries.push(parsed.data);
        }
      } catch {
        // 单行损坏：跳过
      }
    });

    rl.on('close', () => {
      resolve(entries);
    });

    rl.on('error', reject);
    stream.on('error', reject);
  });
}