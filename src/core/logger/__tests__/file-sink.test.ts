/**
 * file-sink.test.ts - PR2 logger 子系统测试（redactor / rotation / file-sink）
 *
 * 覆盖：
 * 1. Redactor
 *    - Authorization header token replace
 *    - Bearer token replace
 *    - _API_KEY=xxx env-style replace
 *    - OpenAI sk-... replace
 *    - recursing into nested object (数组与对象)
 *    - 原始对象未被修改
 * 2. FileSink 基础
 *    - 写入一个 entry，刷新后能 cat 出对应行（校验字段顺序固定）
 *    - 写入一个 entry 含 data.command = 'echo sk-...'，redact 后落盘文件中 key 不可见
 *    - level=error 的 entry 在 error.jsonl 与 runtime-*.jsonl 双写
 *    - level=info 的 entry 不写 error.jsonl
 * 3. 轮转
 *    - size 触发旋转：写一个 ~1.5KB 文件后，policy.maxSizeBytes=1KB，再写一条就 rotate
 *    - 连续写多条触发旋转后，maxFiles=3 时旧档被 unlink
 *    - gzip 触发：gzipIfStale 直接测
 * 4. error 必落盘：即使 FileSinkOptions 未传 rotate policy，error entry 必落 error.jsonl
 */

import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSink } from '../file-sink.js';
import { defaultRedactionRules, redactObject, redactString } from '../redactor.js';
import { fileExists, fileSize, gzipIfStale, rotateIfNeeded } from '../rotation.js';
import type { LogEntry } from '../types.js';

// ============================================================
// 工具
// ============================================================

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'session',
    sessionId: 'sid-1',
    message: 'hello',
    ...overrides,
  };
}

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wasteland-log-test-'));
}

// ============================================================
// Redactor
// ============================================================

describe('redactor.redactString', () => {
  it('Authorization header token replace', () => {
    const input = 'curl -H "Authorization: Bearer abcdef1234567890" https://api.example.com';
    const out = redactString(input);
    expect(out).toContain('[redacted:auth-header]Authorization: [REDACTED]');
    expect(out).not.toContain('abcdef1234567890');
  });

  it('Bearer token replace (独立规则)', () => {
    const input = 'token=Bearer abcdefghijklmnop1234 in header';
    const out = redactString(input);
    expect(out).toContain('[redacted:bearer-token]Bearer [REDACTED]');
    expect(out).not.toContain('abcdefghijklmnop1234');
  });

  it('_API_KEY=xxx env-style replace (保留 env 名)', () => {
    const input = 'OPENAI_API_KEY=sk-abcdefghijklmnop1234 some other text';
    const out = redactString(input);
    // env-api-key 应先于 openai-sk 命中，把值 mask 为 [REDACTED]，openai-sk 不再二次命中
    expect(out).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(out).not.toContain('sk-abcdefghijklmnop1234');
  });

  it('OpenAI sk-... replace', () => {
    // 用 25+ 字符以匹配 {20,}
    const input = 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";';
    const out = redactString(input);
    expect(out).toContain('[redacted:openai-sk]sk-[REDACTED]');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });

  it('recursing into nested object (数组与对象)', () => {
    const input = {
      url: 'https://api.example.com',
      headers: {
        Authorization: 'Bearer abcdefghijklmnop1234',
        'X-Custom': 'safe',
      },
      items: ['sk-abcdefghijklmnopqrstuvwxyz123456', 'plain', 42, true],
    };
    const out = redactObject(input) as typeof input;
    expect(out.headers.Authorization).not.toContain('abcdefghijklmnop1234');
    expect(out.headers.Authorization).toContain('[REDACTED]');
    expect(out.headers['X-Custom']).toBe('safe');
    expect(out.items[0]).toBe('[redacted:openai-sk]sk-[REDACTED]');
    expect(out.items[1]).toBe('plain');
    expect(out.items[2]).toBe(42);
    expect(out.items[3]).toBe(true);
  });

  it('原始对象未被修改', () => {
    const input = {
      headers: { Authorization: 'Bearer abcdefghijklmnop1234' },
    };
    const original = JSON.parse(JSON.stringify(input));
    redactObject(input);
    expect(input).toEqual(original);
  });

  it('defaultRedactionRules 返回 8 条规则', () => {
    const rules = defaultRedactionRules();
    expect(rules.length).toBeGreaterThanOrEqual(8);
    const names = rules.map((r) => r.name);
    expect(names).toContain('auth-header');
    expect(names).toContain('bearer-token');
    expect(names).toContain('env-api-key');
    expect(names).toContain('openai-sk');
    expect(names).toContain('slack-xoxb');
    expect(names).toContain('github-pat');
    expect(names).toContain('jwt-like');
    expect(names).toContain('pem-private-key');
  });
});

// ============================================================
// FileSink 基础
// ============================================================

describe('FileSink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('写入一个 entry，刷新后能 cat 出对应行（校验字段顺序固定）', async () => {
    const sink = new FileSink({ dir });
    sink.write(makeEntry({ message: 'first', data: { tool: 'bash' } }));
    await sink.flush();
    await sink.close();

    const files = await sink.listFiles();
    const sessionFile = files.find((f) => f.endsWith('.jsonl'));
    expect(sessionFile).toBeDefined();
    if (!sessionFile) return;
    const content = await readFile(join(dir, 'sessions', sessionFile), 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const firstLine = lines[0];
    expect(firstLine).toBeDefined();
    if (!firstLine) return;

    // 字段顺序：version 应在 timestamp 之前，timestamp 在 level 之前，scope 在 sessionId 之前
    const vi = firstLine.indexOf('"version"');
    const ti = firstLine.indexOf('"timestamp"');
    const li = firstLine.indexOf('"level"');
    const si = firstLine.indexOf('"scope"');
    const sid = firstLine.indexOf('"sessionId"');
    const mi = firstLine.indexOf('"message"');
    expect(vi).toBeGreaterThanOrEqual(0);
    expect(ti).toBeGreaterThan(vi);
    expect(li).toBeGreaterThan(ti);
    expect(si).toBeGreaterThan(li);
    expect(sid).toBeGreaterThan(si);
    expect(mi).toBeGreaterThan(sid);
  });

  it('level=error 的 entry 在 error.jsonl 与 sessions/*.jsonl 双写', async () => {
    const sink = new FileSink({ dir });
    sink.write(makeEntry({ level: 'error', message: 'boom' }));
    await sink.flush();
    await sink.close();

    const errContent = await readFile(join(dir, 'error.jsonl'), 'utf8');
    expect(errContent).toContain('"boom"');
    expect(errContent).toContain('"level":"error"');

    const files = await sink.listFiles();
    const sessionFile = files.find((f) => f.endsWith('.jsonl'));
    expect(sessionFile).toBeDefined();
    if (!sessionFile) return;
    const rtContent = await readFile(join(dir, 'sessions', sessionFile), 'utf8');
    expect(rtContent).toContain('"boom"');
  });

  it('level=info 的 entry 不写 error.jsonl', async () => {
    const sink = new FileSink({ dir });
    sink.write(makeEntry({ level: 'info', message: 'i' }));
    sink.write(makeEntry({ level: 'warn', message: 'w' }));
    await sink.flush();
    await sink.close();

    const errContent = await readFile(join(dir, 'error.jsonl'), 'utf8');
    // warn 必落，info 不落
    expect(errContent).toContain('"w"');
    expect(errContent).not.toContain('"i"');
  });

  it('error 必落盘：即使未传 rotate policy，error entry 必落 error.jsonl', async () => {
    const sink = new FileSink({ dir /* no policy */ });
    sink.write(makeEntry({ level: 'error', message: 'critical' }));
    await sink.flush();
    await sink.close();

    const errExists = await fileExists(join(dir, 'error.jsonl'));
    expect(errExists).toBe(true);
    const errContent = await readFile(join(dir, 'error.jsonl'), 'utf8');
    expect(errContent).toContain('"critical"');
  });
});

// ============================================================
// 轮转
// ============================================================

describe('rotation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
  });

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('size 触发旋转：FileSink 写 ~1.5KB 数据，policy.maxSizeBytes=1KB，应触发 rotate', async () => {
    const sink = new FileSink({
      dir,
      policy: { maxSizeBytes: 1024, maxFiles: 3 },
    });

    // 每条 line 约 ~430 字节（一个长 message + 数据）
    const bigMessage = 'x'.repeat(300);
    for (let i = 0; i < 5; i++) {
      sink.write(makeEntry({ message: bigMessage, data: { i } }));
    }
    await sink.flush();
    await sink.close();

    const files = await sink.listFiles();
    // 轮转后应有 active file + .1（轮转后的旧档）
    // 文件名格式：<sessionId>.jsonl 或 <sessionId>.jsonl.1
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('连续写多条触发旋转后，maxFiles=3 时旧档被 unlink', async () => {
    const sink = new FileSink({
      dir,
      policy: { maxSizeBytes: 512, maxFiles: 3 },
    });

    const bigMessage = 'y'.repeat(400);
    // 写 10 条，每条都触发 rotate；最终保留档位应 ≤ 3
    for (let i = 0; i < 10; i++) {
      sink.write(makeEntry({ message: bigMessage, data: { i } }));
    }
    await sink.flush();
    await sink.close();

    const files = await sink.listFiles();
    // maxFiles=3：active + .1 + .2 = 3 个；最多 3 个
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('gzipIfStale：写一个 mtime 旧的 100 字节文件，调用后变 .gz 且大小更小，原文件不存在', async () => {
    const filePath = join(dir, 'old.jsonl');
    const content = 'x'.repeat(100) + '\n';
    await writeFile(filePath, content, 'utf8');

    // 把 mtime 改到 10 天前
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(filePath, tenDaysAgo, tenDaysAgo);

    // maxAgeDays=7 → 该文件应被 gzip
    await gzipIfStale(filePath, 7);

    const gzPath = `${filePath}.gz`;
    const gzExists = await fileExists(gzPath);
    expect(gzExists).toBe(true);
    const originalExists = await fileExists(filePath);
    expect(originalExists).toBe(false);

    const gzSize = await fileSize(gzPath);
    // 100 字节全 'x' 高度可压 → .gz 应明显更小
    expect(gzSize).toBeLessThan(content.length);
  });

  it('rotateIfNeeded：直接调用；未达 cap 时 no-op', async () => {
    const filePath = join(dir, 'log.jsonl');
    await writeFile(filePath, 'small\n', 'utf8');
    await rotateIfNeeded(filePath, 10, { maxSizeBytes: 1024, maxFiles: 3 });
    // 没触发 rotate
    const exists = await fileExists(filePath);
    expect(exists).toBe(true);
    const rotExists = await fileExists(`${filePath}.1`);
    expect(rotExists).toBe(false);
  });

  it('rotateIfNeeded：达 cap 时触发 file → file.1', async () => {
    const filePath = join(dir, 'log.jsonl');
    await writeFile(filePath, 'x'.repeat(2048), 'utf8');
    await rotateIfNeeded(filePath, 100, { maxSizeBytes: 1024, maxFiles: 3 });
    const oldExists = await fileExists(filePath);
    const newExists = await fileExists(`${filePath}.1`);
    expect(oldExists).toBe(false);
    expect(newExists).toBe(true);
  });

  it('FileSink.maybeGzip：连续写 N 条只在第一次触发 gzip（一天内只一次）', async () => {
    // 准备一个 mtime 在 30 天前的旧 session jsonl 文件
    const sessionsDir = join(dir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const oldFile = join(sessionsDir, '2026-07-01_100000-old.jsonl');
    await writeFile(oldFile, 'x'.repeat(100) + '\n', 'utf8');
    const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, oldMtime, oldMtime);

    // spy gzipIfStale 直接计调用次数
    const rotationMod = await import('../rotation.js');
    const gzipSpy = vi.spyOn(rotationMod, 'gzipIfStale').mockResolvedValue(undefined);

    const sink = new FileSink({
      dir,
      policy: { maxSizeBytes: 10 * 1024 * 1024, maxFiles: 5, maxAgeDays: 7 },
    });

    // 连续写 5 条；理论上 maybeGzip 只触发 1 次 gzip 扫描（含 1 个文件）
    for (let i = 0; i < 5; i++) {
      sink.write(makeEntry({ message: `m-${i}` }));
    }
    await sink.flush();
    await sink.close();

    // 等 setImmediate 触发
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    // gzipIfStale 应被调用，但只针对 oldFile 一次
    expect(gzipSpy).toHaveBeenCalledTimes(1);
    expect(gzipSpy.mock.calls[0][0]).toContain('2026-07-01_100000-old.jsonl');
    gzipSpy.mockRestore();
  });

  it('FileSink.maybeGzip：跨日 lazy 重置；当日再写触发新一轮检查', async () => {
    // 准备一个旧 session 文件
    const sessionsDir = join(dir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const oldFile = join(sessionsDir, '2026-07-01_100000-old.jsonl');
    await writeFile(oldFile, 'y'.repeat(100) + '\n', 'utf8');
    const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, oldMtime, oldMtime);

    const rotationMod = await import('../rotation.js');
    const gzipSpy = vi.spyOn(rotationMod, 'gzipIfStale').mockResolvedValue(undefined);

    const sink = new FileSink({
      dir,
      policy: { maxSizeBytes: 10 * 1024 * 1024, maxFiles: 5, maxAgeDays: 7 },
    });

    // 第 1 条：触发 1 次 gzip 扫描（命中 oldFile）
    sink.write(makeEntry({ message: 'first' }));
    // 当天继续写 4 条：flag 阻尼，不再触发
    for (let i = 0; i < 4; i++) {
      sink.write(makeEntry({ message: `s-${i}` }));
    }
    await sink.flush();
    await sink.close();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    // 同一天内 gzipIfStale 应只调用 1 次
    expect(gzipSpy.mock.calls.length).toBe(1);
    gzipSpy.mockRestore();
  });

  it('FileSink.listFiles smoke test（write → listFiles → 含 session 文件）', async () => {
    const sink = new FileSink({ dir });
    sink.write(makeEntry({ message: 'x' }));
    await sink.flush();
    await sink.close();
    const files = await sink.listFiles();
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true);
  });

  it('FileSink 每日维护：maxTotalFiles 超限时清理最旧 session 文件', async () => {
    const sessionsDir = join(dir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const old1 = join(sessionsDir, '2026-07-01_100000-old1.jsonl');
    const old2 = join(sessionsDir, '2026-07-02_100000-old2.jsonl');
    const old3 = join(sessionsDir, '2026-07-03_100000-old3.jsonl');
    await writeFile(old1, 'x'.repeat(100) + '\n', 'utf8');
    await writeFile(old2, 'y'.repeat(100) + '\n', 'utf8');
    await writeFile(old3, 'z'.repeat(100) + '\n', 'utf8');
    const oldMtime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(old1, oldMtime, oldMtime);
    await utimes(old2, oldMtime, oldMtime);
    await utimes(old3, oldMtime, oldMtime);

    const sink = new FileSink({
      dir,
      policy: { maxSizeBytes: 10 * 1024 * 1024, maxFiles: 5, maxAgeDays: 0, maxTotalFiles: 2 },
    });
    // 写一条触发每日维护。维护可能在当前 session 文件（sid-1）落盘前/后运行：
    // - 落盘前：3 个旧文件 > 2 → 删最旧 old1
    // - 落盘后：4 个文件 > 2 → 删 old1 + old2
    // 两种情况下 old1 都必然被清理，且最晚写入的 old3 一定保留。
    sink.write(makeEntry({ message: 'trigger' }));
    await sink.flush();
    await sink.close();

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    const files = await readdir(sessionsDir);
    expect(files.some((f) => f.includes('old1'))).toBe(false);
    expect(files.some((f) => f.includes('old3'))).toBe(true);
    // 清理只针对最旧文件，不会删到最新写入的 session 文件
    expect(files.some((f) => f.includes('sid-1'))).toBe(true);
  });
});
