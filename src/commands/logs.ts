/**
 * logs.ts - wasteland logs CLI 子命令
 *
 * 提供 3 个非交互子命令，PR4 拆分下的 "PR4b — CLI 旁路" 范围：
 * - `wasteland logs errors`            查看 error.jsonl 尾部
 * - `wasteland logs show <sid>`        按 sessionId 反查 runtime + error 合并视图
 * - `wasteland logs tail`              跟踪 runtime 日切文件（支持 --follow）
 *
 * 与 FileSink 关系：本文件直接 `readdir` + 内部过滤
 * `/^(runtime|sessions)-.+\.jsonl(\.\d+)?$/`，
 * 与 FileSink.listFiles() 的过滤正则（`file-sink.ts:listFiles`）保持一致；
 * 解析为绝对路径方便后续重定向；保留轮转档（.jsonl.N）与 gzip 档（.gz）以
 * 兼容已归档文件。`FileSink.listFiles()` 只返回文件名，本函数需补绝对路径。
 *
 * 不引入新依赖：使用 `node:readline` + `node:fs` + `node:path` + `node:fs/promises`。
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { Command } from 'commander';

import { FileSink } from '@core/logger/file-sink.js';
import { LOG_LEVEL_RANK, type LogEntry, type LogLevel } from '@core/logger/types.js';
import { t } from '@locales/index.js';

// ============================================================
// 路径解析
// ============================================================

/**
 * 默认日志主目录：`<cwd>/.wasteland/logs`。
 *
 * 与 `src/core/runtime/debug-logger.ts:resolveLogDir` 行为一致；不需要从 `paths.ts`
 * 引入是因为这里只读 dir，不写。
 */
export function resolveDefaultLogsDir(cwd: string): string {
  return join(resolvePath(cwd), '.wasteland', 'logs');
}

// ============================================================
// 通用：读取目录下的日志文件
// ============================================================

const ERROR_FILENAME = 'error.jsonl';

/**
 * 在 dir 下找出所有应当被读取的日志文件（sessions/*.jsonl + error.jsonl）。
 *
 * 与 FileSink.listFiles() 区别：本函数解析为绝对路径，方便后续重定向；保留轮转
 * 档（.jsonl.N）与 gzip 档（.gz）以兼容已归档文件。
 */
export async function listLogFiles(dir: string): Promise<{
  errorFile: string | null;
  runtimeFiles: string[];
  allFiles: string[];
}> {
  const sessionDir = join(dir, 'sessions');

  // 读取 error.jsonl（根目录）
  let errorFile: string | null = null;
  try {
    const rootEntries = await readdir(dir);
    if (rootEntries.includes(ERROR_FILENAME)) {
      errorFile = join(dir, ERROR_FILENAME);
    }
  } catch {
    // 忽略
  }

  // 读取 sessions/ 子目录
  const runtimeFiles: string[] = [];
  const allFiles: string[] = [];

  let sessionEntries: string[];
  try {
    sessionEntries = await readdir(sessionDir);
  } catch {
    sessionEntries = [];
  }

  for (const name of sessionEntries) {
    if (name.startsWith('.')) continue;
    if (name === ERROR_FILENAME) continue;

    // <sessionId>.jsonl 或 <sessionId>.jsonl.<N>（轮转保留档）
    if (name.endsWith('.jsonl') || /\.jsonl\.\d+$/.test(name)) {
      const abs = join(sessionDir, name);
      runtimeFiles.push(abs);
      allFiles.push(abs);
    } else if (name.endsWith('.gz')) {
      // gzip 归档：列入 allFiles 但不参与本实现的解析
      const abs = join(sessionDir, name);
      allFiles.push(abs);
    }
  }

  // 字典序排序
  runtimeFiles.sort();
  allFiles.sort();

  return { errorFile, runtimeFiles, allFiles };
}

// ============================================================
// 通用：JSONL 行解析
// ============================================================

/**
 * 安全解析一行 JSONL 为 LogEntry；解析失败返回 null（行被跳过）。
 */
export function parseLogLine(line: string): LogEntry | null {
  if (line.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(line) as LogEntry;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.level === 'string' &&
      typeof parsed.scope === 'string' &&
      typeof parsed.timestamp === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 读一个日志文件全部 JSONL 行（返回 LogEntry[]，失败或不存在返回空数组）。
 */
export async function readLogEntries(filePath: string): Promise<LogEntry[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf8');
  const out: LogEntry[] = [];
  for (const line of content.split('\n')) {
    const entry = parseLogLine(line);
    if (entry) out.push(entry);
  }
  return out;
}

// ============================================================
// 通用：表格输出
// ============================================================

/**
 * 表格列定义（与 PRD R22 对齐）。
 */
const TABLE_COLUMNS = [
  { key: 'TIME', width: 24 },
  { key: 'LEVEL', width: 6 },
  { key: 'SCOPE', width: 11 },
  { key: 'SESSIONID', width: 36 },
  { key: 'MESSAGE', width: 0 }, // 0 = 自适应剩余宽度
] as const;

/**
 * 拼一行表格（用空格列分隔，简单 view 不依赖 ANSI）。
 */
export function formatRow(entry: LogEntry): string {
  const ts = entry.timestamp ?? '';
  const lvl = entry.level;
  const scope = entry.scope;
  const sid = entry.sessionId ?? '';
  const message = entry.message ?? '';
  return `${padOrTruncate(ts, 24)}  ${padOrTruncate(lvl, 6)}  ${padOrTruncate(scope, 11)}  ${padOrTruncate(sid, 36)}  ${message}`;
}

function padOrTruncate(value: string, width: number): string {
  if (value.length === width) return value;
  if (value.length > width) return value.slice(0, Math.max(0, width - 1)) + '…';
  return value + ' '.repeat(width - value.length);
}

/**
 * 表格分隔行 + 标题。
 */
export function formatHeader(): string {
  const header = TABLE_COLUMNS.map((c) => c.key.padEnd(c.width || c.key.length)).join('  ');
  const separator = TABLE_COLUMNS.map((c) => '─'.repeat(c.width || c.key.length)).join('  ');
  return `${header}\n${separator}`;
}

// ============================================================
// filter
// ============================================================

/**
 * level 过滤：entry.level rank ≥ minLevelRank 才保留。
 *
 * 若 minLevel 是 undefined/null 则不过滤（保留全部）。
 */
export function meetsLevel(entry: LogEntry, minLevel: LogLevel | null): boolean {
  if (!minLevel) return true;
  return LOG_LEVEL_RANK[entry.level] >= LOG_LEVEL_RANK[minLevel];
}

/**
 * scope 过滤：entry.scope ∈ scopes 才保留。
 *
 * 若 scopes 为空数组则不过滤。
 */
export function matchesScope(
  entry: LogEntry,
  scopes: readonly string[] | null
): boolean {
  if (!scopes || scopes.length === 0) return true;
  return scopes.includes(entry.scope);
}

/**
 * sessionId 过滤：entry.sessionId === sid 才保留。
 */
export function matchesSession(entry: LogEntry, sid: string | null): boolean {
  if (!sid) return true;
  return entry.sessionId === sid;
}

// ============================================================
// 1a. logs errors
// ============================================================

type ErrorsOptions = {
  tail?: string;
  dir?: string;
};

/**
 * wasteland logs errors [--tail N] [--dir <path>]
 *
 * 从 `<dir>/error.jsonl` 读取最后 N 条 warn/error 条目（N 默认 20）。
 */
export async function runLogsErrors(
  options: ErrorsOptions,
  opts: { stdout?: NodeJS.WritableStream } = {}
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const dir = options.dir ? resolvePath(options.dir) : resolveDefaultLogsDir(process.cwd());
  const tail = Math.max(1, Number.parseInt(options.tail ?? '20', 10) || 20);

  const file = join(dir, ERROR_FILENAME);
  if (!existsSync(file)) {
    stdout.write(`No error entries.\n`);
    return 0;
  }

  const entries = await readLogEntries(file);
  if (entries.length === 0) {
    stdout.write(`No error entries.\n`);
    return 0;
  }

  const sliced = entries.slice(-tail);
  stdout.write(`${formatHeader()}\n`);
  for (const entry of sliced) {
    stdout.write(`${formatRow(entry)}\n`);
  }
  return 0;
}

// ============================================================
// 1b. logs show <sid>
// ============================================================

type ShowOptions = {
  dir?: string;
  tail?: string;
};

/**
 * wasteland logs show <sid> [--dir <path>] [--tail N]
 *
 * 遍历 dir 下所有 runtime 日切 + error.jsonl，过滤 sessionId === sid，按 timestamp
 * 升序输出。
 */
export async function runLogsShow(
  sid: string,
  options: ShowOptions,
  opts: { stdout?: NodeJS.WritableStream } = {}
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const dir = options.dir ? resolvePath(options.dir) : resolveDefaultLogsDir(process.cwd());
  const tail = Math.max(1, Number.parseInt(options.tail ?? '200', 10) || 200);

  if (!existsSync(dir)) {
    stdout.write(`No logs directory at ${dir}\n`);
    return 0;
  }

  const { errorFile, runtimeFiles } = await listLogFiles(dir);

  const allEntries: LogEntry[] = [];
  for (const file of [errorFile, ...runtimeFiles]) {
    if (!file) continue;
    const entries = await readLogEntries(file);
    for (const entry of entries) {
      if (matchesSession(entry, sid)) allEntries.push(entry);
    }
  }

  if (allEntries.length === 0) {
    stdout.write(`No log entries for sessionId ${sid}\n`);
    return 0;
  }

  // 按 timestamp 升序
  allEntries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const sliced = allEntries.slice(-tail);
  stdout.write(`${formatHeader()}\n`);
  for (const entry of sliced) {
    stdout.write(`${formatRow(entry)}\n`);
  }
  return 0;
}

// ============================================================
// 1c. logs tail
// ============================================================

type TailOptions = {
  dir?: string;
  level?: string;
  scope?: string;
  tail?: string;
  follow?: boolean;
};

/**
 * 解析 sessions 目录路径。
 */
export function resolveSessionsDir(dir: string): string {
  return join(dir, 'sessions');
}

/**
 * wasteland logs tail [--dir <path>] [--level lv] [--scope s] [--tail N] [--follow]
 *
 * 从 sessions/ 目录下所有 session 文件读取最近 N 条日志。
 * --follow 时监听 sessions/ 目录变化。
 */
export async function runLogsTail(
  options: TailOptions,
  opts: {
    stdout?: NodeJS.WritableStream;
    signal?: AbortSignal;
  } = {}
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const dir = options.dir ? resolvePath(options.dir) : resolveDefaultLogsDir(process.cwd());
  const tail = Math.max(1, Number.parseInt(options.tail ?? '50', 10) || 50);
  const level = options.level ? parseLevelOption(options.level) : null;
  const scopes = options.scope
    ? options.scope.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : null;

  const sessionsDir = resolveSessionsDir(dir);

  if (!existsSync(sessionsDir)) {
    if (options.follow) {
      stdout.write(`Waiting for ${sessionsDir} ...\n`);
    } else {
      stdout.write(`No log files at ${sessionsDir}\n`);
      return 0;
    }
  }

  // 1) 读取所有 session 文件
  const { runtimeFiles } = await listLogFiles(dir);
  const allEntries: LogEntry[] = [];
  for (const file of runtimeFiles) {
    const entries = await readLogEntries(file);
    allEntries.push(...entries);
  }

  // 按 timestamp 排序，取最后 N 条
  allEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const filtered = allEntries.filter((e) => meetsLevel(e, level) && matchesScope(e, scopes));
  const sliced = filtered.slice(-tail);
  if (sliced.length > 0) {
    stdout.write(`${formatHeader()}\n`);
    for (const entry of sliced) {
      stdout.write(`${formatRow(entry)}\n`);
    }
  }

  if (!options.follow) {
    return 0;
  }

  // 2) --follow 模式：监听 sessions/ 目录变化
  const fs = await import('node:fs');
  return new Promise<number>((resolve) => {
    let watcher: import('node:fs').FSWatcher | null = null;

    try {
      watcher = fs.watch(sessionsDir, { persistent: false }, async () => {
        try {
          // 重新读取所有 session 文件
          const { runtimeFiles: updatedFiles } = await listLogFiles(dir);
          const newEntries: LogEntry[] = [];
          for (const file of updatedFiles) {
            const entries = await readLogEntries(file);
            newEntries.push(...entries);
          }
          newEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          const newFiltered = newEntries.filter((e) => meetsLevel(e, level) && matchesScope(e, scopes));
          // 输出新增的条目（简化实现：输出最后几条）
          const newSliced = newFiltered.slice(-10);
          for (const entry of newSliced) {
            stdout.write(`${formatRow(entry)}\n`);
          }
        } catch {
          // single read 失败不应终止 watch
        }
      });
    } catch {
      // 某些 FS 不支持 watch；降级为 no-op
      resolve(0);
      return;
    }

    const cleanup = (): void => {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    };

    if (opts.signal) {
      const onAbort = (): void => {
        cleanup();
        resolve(0);
      };
      if (opts.signal.aborted) {
        cleanup();
        resolve(0);
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 解析 --level 选项；非法值返回 null（视为不过滤）。
 */
export function parseLevelOption(value: string): LogLevel | null {
  const lower = value.trim().toLowerCase();
  if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error') {
    return lower;
  }
  return null;
}

// ============================================================
// Command factory
// ============================================================

/**
 * 创建 `wasteland logs` 顶层命令（含 3 个子命令）。
 *
 * 已废弃：TUI LogsPage 为唯一日志界面（见 memory / logging-guidelines §20）。
 * 子命令保留可用，但每次执行先打 stderr 废弃提示，指路 TUI。
 */
export function createLogsCommand(): Command {
  const logs = new Command('logs').description(t('commands.logs.description'));

  logs.hook('preAction', () => {
    process.stderr.write(`${t('commands.logs.deprecated')}\n`);
  });

  logs
    .command('errors')
    .description(t('commands.logs.errors.description'))
    .option('--tail <n>', t('commands.logs.errors.options.tail'), '20')
    .option('--dir <path>', t('commands.logs.options.dir'))
    .action(async (options: ErrorsOptions) => {
      const code = await runLogsErrors(options);
      process.exitCode = code;
    });

  logs
    .command('show <sid>')
    .description(t('commands.logs.show.description'))
    .option('--dir <path>', t('commands.logs.options.dir'))
    .option('--tail <n>', t('commands.logs.show.options.tail'), '200')
    .action(async (sid: string, options: ShowOptions) => {
      const code = await runLogsShow(sid, options);
      process.exitCode = code;
    });

  logs
    .command('tail')
    .description(t('commands.logs.tail.description'))
    .option('--dir <path>', t('commands.logs.options.dir'))
    .option('--level <level>', t('commands.logs.tail.options.level'))
    .option('--scope <scope>', t('commands.logs.tail.options.scope'))
    .option('--tail <n>', t('commands.logs.tail.options.tail'), '50')
    .option('--follow', t('commands.logs.tail.options.follow'), false)
    .action(async (options: TailOptions) => {
      const code = await runLogsTail(options);
      process.exitCode = code;
    });

  return logs;
}

// ============================================================
// 工具：临时目录（仅测试用导出）
// ============================================================

/**
 * 测试用临时目录（封装 mkdtemp 便于 afterEach 清理）。
 */
export async function createTempLogsDir(prefix = 'wasteland-logs-test-'): Promise<string> {
  const dir = await import('node:fs/promises');
  return dir.mkdtemp(join(tmpdir(), prefix));
}

/**
 * 写入单条 LogEntry 到指定 file（用于测试 fixture）。
 */
export async function writeEntryToFile(filePath: string, entry: LogEntry): Promise<void> {
  const dir = await import('node:fs/promises');
  await dir.mkdir(join(filePath, '..'), { recursive: true });
  await dir.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * 利用 FileSink 写入一条 entry（确保与生产写入路径一致）。
 */
export async function writeEntryViaSink(
  dir: string,
  entry: LogEntry,
  opts: { errorFilename?: string } = {}
): Promise<FileSink> {
  const sink = new FileSink({ dir, errorFilename: opts.errorFilename ?? ERROR_FILENAME });
  sink.write(entry);
  await sink.flush();
  await sink.close();
  return sink;
}
