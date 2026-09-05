/**
 * logs.test.ts - `wasteland logs` CLI 子命令测试
 *
 * PR4b 范围测试，覆盖：
 * 1. 命令结构（help + 3 个子命令）
 * 2. errors 子命令（空 dir、3 条 warn fixture）
 * 3. show 子命令（多 session 过滤）
 * 4. tail 子命令（level filter）
 * 5. level / scope 过滤 helper
 * 6. JSONL 解析 helper
 *
 * 测试隔离：mkdtemp(os.tmpdir() + 'wasteland-logs-test-')，afterEach 清理。
 *
 * 关键约束：本测试不依赖 TUI / runtime / 真实 .wasteland/ 配置；只测 CLI 层的
 * directory → entry → stdout 流程。
 */

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LogEntry } from '@core/logger/types.js';
import {
  createLogsCommand,
  formatRow,
  matchesScope,
  matchesSession,
  meetsLevel,
  parseLevelOption,
  parseLogLine,
  runLogsErrors,
  runLogsShow,
  runLogsTail,
  writeEntryViaSink,
  listLogFiles,
} from '../logs.js';

// ============================================================
// 工具
// ============================================================

/**
 * 收集 stdout 输出的 Writable。
 */
class CollectingWritable extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
  text(): string {
    return this.chunks.join('');
  }
}

/**
 * 取子命令（缺则 throw，便于测试清晰失败）。
 */
function getSubcommand(cmd: ReturnType<typeof createLogsCommand>, name: string) {
  const sub = cmd.commands.find((c) => c.name() === name);
  if (!sub) throw new Error(`subcommand ${name} not found`);
  return sub;
}

/**
 * 取 commander Command 的 registered arguments（commander 内部字段）。
 */
function getCmdArgs(cmd: {
  registeredArguments?: { required: boolean }[];
}): { required: boolean }[] {
  return cmd.registeredArguments ?? [];
}

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'session',
    sessionId: 'sid-default',
    message: 'hello',
    ...overrides,
  };
}

/**
 * 构造 utc 时间戳，便于跨期排序测试。
 */
function tsAt(iso: string): string {
  return new Date(iso).toISOString();
}

let dir: string;

beforeEach(async () => {
  const fs = await import('node:fs/promises');
  dir = await fs.mkdtemp(join(tmpdir(), 'wasteland-logs-test-'));
});

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 1. 命令结构
// ============================================================

describe('createLogsCommand', () => {
  it('返回顶层 logs Command', () => {
    const cmd = createLogsCommand();
    expect(cmd.name()).toBe('logs');
    expect(cmd.commands).toHaveLength(3);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['errors', 'show', 'tail']));
  });

  it('errors 子命令接受 --tail 与 --dir', () => {
    const cmd = createLogsCommand();
    const errors = getSubcommand(cmd, 'errors');
    const opts = errors.options.map((o) => o.long);
    expect(opts).toContain('--tail');
    expect(opts).toContain('--dir');
  });

  it('show 子命令接受 <sid> 参数', () => {
    const cmd = createLogsCommand();
    const show = getSubcommand(cmd, 'show');
    const args = getCmdArgs(
      show as unknown as { registeredArguments?: { required: boolean }[] }
    );
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].required).toBe(true);
  });

  it('tail 子命令接受 --follow / --level / --scope', () => {
    const cmd = createLogsCommand();
    const tail = getSubcommand(cmd, 'tail');
    const opts = tail.options.map((o) => o.long);
    expect(opts).toContain('--follow');
    expect(opts).toContain('--level');
    expect(opts).toContain('--scope');
  });

  it('--help 输出 3 个子命令名且不抛错', () => {
    const cmd = createLogsCommand();
    cmd.exitOverride();
    const buf: string[] = [];
    const write = (s: string): void => {
      buf.push(s);
    };
    cmd.configureOutput({ writeOut: write, writeErr: write });
    try {
      cmd.parse(['--help'], { from: 'user' });
    } catch (err) {
      // commander 帮我们 exit（exitOverride 抛 CommanderError），仅当有输出时算成功
      const isHelpExit =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'commander.helpDisplayed';
      if (!isHelpExit) throw err;
    }
    const out = buf.join('');
    expect(out).toContain('errors');
    expect(out).toContain('show');
    expect(out).toContain('tail');
  });
});

// ============================================================
// 2. parseLogLine / matchesSession / meetsLevel / matchesScope
// ============================================================

describe('parseLogLine', () => {
  it('解析合法 LogEntry', () => {
    const entry = makeEntry({ sessionId: 'abc' });
    const parsed = parseLogLine(JSON.stringify(entry));
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('expected parsed entry');
    expect(parsed.sessionId).toBe('abc');
  });

  it('空行返回 null', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
  });

  it('非法 JSON 返回 null', () => {
    expect(parseLogLine('not json')).toBeNull();
  });

  it('缺关键字段返回 null', () => {
    expect(parseLogLine(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });
});

describe('meetsLevel', () => {
  it('null minLevel 全部通过', () => {
    expect(meetsLevel(makeEntry({ level: 'debug' }), null)).toBe(true);
    expect(meetsLevel(makeEntry({ level: 'error' }), null)).toBe(true);
  });

  it('minLevel=info 过滤掉 debug', () => {
    expect(meetsLevel(makeEntry({ level: 'debug' }), 'info')).toBe(false);
    expect(meetsLevel(makeEntry({ level: 'info' }), 'info')).toBe(true);
    expect(meetsLevel(makeEntry({ level: 'warn' }), 'info')).toBe(true);
    expect(meetsLevel(makeEntry({ level: 'error' }), 'info')).toBe(true);
  });

  it('minLevel=error 只放行 error', () => {
    expect(meetsLevel(makeEntry({ level: 'warn' }), 'error')).toBe(false);
    expect(meetsLevel(makeEntry({ level: 'error' }), 'error')).toBe(true);
  });
});

describe('matchesScope', () => {
  it('空 scopes 全部通过', () => {
    expect(matchesScope(makeEntry({ scope: 'tool' }), null)).toBe(true);
    expect(matchesScope(makeEntry({ scope: 'tool' }), [])).toBe(true);
  });

  it('scope 列表精确匹配', () => {
    expect(matchesScope(makeEntry({ scope: 'tool' }), ['tool', 'turn'])).toBe(true);
    expect(matchesScope(makeEntry({ scope: 'file' }), ['tool', 'turn'])).toBe(false);
  });
});

describe('matchesSession', () => {
  it('null sid 全部通过', () => {
    expect(matchesSession(makeEntry({ sessionId: 'a' }), null)).toBe(true);
  });

  it('精确匹配 sessionId', () => {
    expect(matchesSession(makeEntry({ sessionId: 'sid-1' }), 'sid-1')).toBe(true);
    expect(matchesSession(makeEntry({ sessionId: 'sid-2' }), 'sid-1')).toBe(false);
  });
});

describe('parseLevelOption', () => {
  it('合法字符串 → LogLevel', () => {
    expect(parseLevelOption('debug')).toBe('debug');
    expect(parseLevelOption('INFO')).toBe('info');
    expect(parseLevelOption('warn')).toBe('warn');
    expect(parseLevelOption('error')).toBe('error');
  });

  it('非法字符串 → null', () => {
    expect(parseLevelOption('trace')).toBeNull();
    expect(parseLevelOption('')).toBeNull();
  });
});

describe('formatRow', () => {
  it('包含 timestamp / level / scope / sessionId / message', () => {
    const row = formatRow(makeEntry({
      sessionId: 'sid-123',
      level: 'warn',
      scope: 'tool',
      message: 'boom',
    }));
    expect(row).toContain('warn');
    expect(row).toContain('tool');
    expect(row).toContain('sid-123');
    expect(row).toContain('boom');
  });
});

// ============================================================
// 3. listLogFiles
// ============================================================

describe('listLogFiles', () => {
  it('dir 不存在返回空', async () => {
    const result = await listLogFiles('/nonexistent/path/' + Date.now());
    expect(result.errorFile).toBeNull();
    expect(result.runtimeFiles).toEqual([]);
  });

  it('列出 sessions/*.jsonl 与 error.jsonl', async () => {
    const fs = await import('node:fs/promises');
    const sessionDir = join(dir, 'sessions');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(join(sessionDir, '2026-07-29_100000-s1.jsonl'), '', 'utf8');
    await fs.writeFile(join(dir, 'error.jsonl'), '', 'utf8');
    await fs.writeFile(join(dir, 'other.txt'), '', 'utf8');

    const result = await listLogFiles(dir);
    expect(result.errorFile).toBe(join(dir, 'error.jsonl'));
    expect(result.runtimeFiles).toContain(join(sessionDir, '2026-07-29_100000-s1.jsonl'));
    expect(result.runtimeFiles).toHaveLength(1);
  });
});

// ============================================================
// 4. runLogsErrors
// ============================================================

describe('runLogsErrors', () => {
  it('dir 不存在输出 No error entries. 并返回 0', async () => {
    const out = new CollectingWritable();
    const code = await runLogsErrors({ dir: '/nonexistent/' + Date.now() }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('No error entries');
  });

  it('dir 存在但 error.jsonl 不存在 → No error entries.', async () => {
    const out = new CollectingWritable();
    const code = await runLogsErrors({ dir }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('No error entries');
  });

  it('读取真实 fixture：3 条 warn entry 输出 3 行表格', async () => {
    // 用 FileSink 写入 3 条 warn entry
    const entries: LogEntry[] = [
      makeEntry({
        level: 'warn',
        scope: 'tool',
        sessionId: 'sid-a',
        timestamp: tsAt('2026-07-29T10:00:00.000Z'),
        message: 'first warn',
      }),
      makeEntry({
        level: 'error',
        scope: 'tool',
        sessionId: 'sid-a',
        timestamp: tsAt('2026-07-29T10:00:01.000Z'),
        message: 'an error',
      }),
      makeEntry({
        level: 'warn',
        scope: 'permission',
        sessionId: 'sid-b',
        timestamp: tsAt('2026-07-29T10:00:02.000Z'),
        message: 'third warn',
      }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    const code = await runLogsErrors({ tail: '3', dir }, { stdout: out });
    expect(code).toBe(0);

    const text = out.text();
    expect(text).toContain('TIME');
    expect(text).toContain('LEVEL');
    expect(text).toContain('SCOPE');
    expect(text).toContain('SESSIONID');
    expect(text).toContain('MESSAGE');
    expect(text).toContain('first warn');
    expect(text).toContain('an error');
    expect(text).toContain('third warn');
    // 表格行数（header + 3 entries）
    expect(text.split('\n').filter((l) => l.trim().length > 0).length).toBeGreaterThanOrEqual(5);
  });

  it('--tail 1 只输最后 1 条', async () => {
    const entries: LogEntry[] = [
      makeEntry({ level: 'warn', message: 'older', timestamp: tsAt('2026-07-29T10:00:00.000Z') }),
      makeEntry({ level: 'error', message: 'newest', timestamp: tsAt('2026-07-29T10:00:02.000Z') }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    await runLogsErrors({ tail: '1', dir }, { stdout: out });
    const text = out.text();
    expect(text).toContain('newest');
    expect(text).not.toContain('older');
  });
});

// ============================================================
// 5. runLogsShow
// ============================================================

describe('runLogsShow', () => {
  it('dir 不存在 → No logs directory', async () => {
    const out = new CollectingWritable();
    const code = await runLogsShow('sid-x', { dir: '/nonexistent/' + Date.now() }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('No logs directory');
  });

  it('dir 为空（存在但无日志文件）→ No log entries for sessionId', async () => {
    const out = new CollectingWritable();
    const code = await runLogsShow('sid-x', { dir }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('No log entries');
  });

  it('写 2 个 session 各 2 条 → show sid1 只输出 sid1 的 2 条', async () => {
    const sid1Entries: LogEntry[] = [
      makeEntry({
        sessionId: 'sid-1',
        scope: 'turn',
        message: 'sid1-turn',
        timestamp: tsAt('2026-07-29T10:00:00.000Z'),
      }),
      makeEntry({
        sessionId: 'sid-1',
        scope: 'tool',
        message: 'sid1-tool',
        timestamp: tsAt('2026-07-29T10:00:01.000Z'),
      }),
    ];
    const sid2Entries: LogEntry[] = [
      makeEntry({
        sessionId: 'sid-2',
        scope: 'turn',
        message: 'sid2-turn',
        timestamp: tsAt('2026-07-29T10:00:00.500Z'),
      }),
      makeEntry({
        sessionId: 'sid-2',
        scope: 'tool',
        message: 'sid2-tool',
        timestamp: tsAt('2026-07-29T10:00:01.500Z'),
      }),
    ];
    for (const e of [...sid1Entries, ...sid2Entries]) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    const code = await runLogsShow('sid-1', { dir }, { stdout: out });
    expect(code).toBe(0);

    const text = out.text();
    expect(text).toContain('sid-1');
    expect(text).toContain('sid1-turn');
    expect(text).toContain('sid1-tool');
    expect(text).not.toContain('sid2-turn');
    expect(text).not.toContain('sid2-tool');
  });

  it('按 timestamp 升序输出', async () => {
    const entries: LogEntry[] = [
      makeEntry({
        sessionId: 'sid-ord',
        message: 'late',
        timestamp: tsAt('2026-07-29T10:00:05.000Z'),
      }),
      makeEntry({
        sessionId: 'sid-ord',
        message: 'early',
        timestamp: tsAt('2026-07-29T10:00:00.000Z'),
      }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    await runLogsShow('sid-ord', { dir }, { stdout: out });
    const text = out.text();
    const earlyIdx = text.indexOf('early');
    const lateIdx = text.indexOf('late');
    expect(earlyIdx).toBeGreaterThan(0);
    expect(lateIdx).toBeGreaterThan(earlyIdx);
  });
});

// ============================================================
// 6. runLogsTail
// ============================================================

describe('runLogsTail', () => {
  it('无文件 → 输出 No log file', async () => {
    const out = new CollectingWritable();
    const code = await runLogsTail({ dir, follow: false }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('No log file');
  });

  it('--level error 只输出 error 行', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries: LogEntry[] = [
      makeEntry({
        level: 'info',
        scope: 'tool',
        message: 'info-entry',
        timestamp: tsAt(`${today}T10:00:00.000Z`),
      }),
      makeEntry({
        level: 'warn',
        scope: 'tool',
        message: 'warn-entry',
        timestamp: tsAt(`${today}T10:00:01.000Z`),
      }),
      makeEntry({
        level: 'error',
        scope: 'tool',
        message: 'error-entry',
        timestamp: tsAt(`${today}T10:00:02.000Z`),
      }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    const code = await runLogsTail(
      { dir, level: 'error', follow: false },
      { stdout: out }
    );
    expect(code).toBe(0);

    const text = out.text();
    expect(text).toContain('error-entry');
    expect(text).not.toContain('info-entry');
    expect(text).not.toContain('warn-entry');
  });

  it('默认 follow=false 不阻塞', async () => {
    const out = new CollectingWritable();
    const today = new Date().toISOString().slice(0, 10);
    const entries = [
      makeEntry({
        level: 'info',
        timestamp: tsAt(`${today}T10:00:00.000Z`),
      }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }
    const code = await runLogsTail({ dir, follow: false }, { stdout: out });
    expect(code).toBe(0);
    expect(out.text()).toContain('hello');
  });

  it('scope 过滤：只输出 scope=tool 的行', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries: LogEntry[] = [
      makeEntry({
        scope: 'turn',
        message: 'turn-only',
        timestamp: tsAt(`${today}T10:00:00.000Z`),
      }),
      makeEntry({
        scope: 'tool',
        message: 'tool-only',
        timestamp: tsAt(`${today}T10:00:01.000Z`),
      }),
    ];
    for (const e of entries) {
      await writeEntryViaSink(dir, e);
    }

    const out = new CollectingWritable();
    await runLogsTail(
      { dir, scope: 'tool', follow: false },
      { stdout: out }
    );
    const text = out.text();
    expect(text).toContain('tool-only');
    expect(text).not.toContain('turn-only');
  });
});
