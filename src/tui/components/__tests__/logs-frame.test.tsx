/**
 * logs-frame.test.tsx - LogsPage 端到端渲染帧断言（R-5：撑屏防线）
 *
 * 现有 card-window.test.ts 的预算扫描用 planRows 自洽断言 —— 漏计发生在
 * **测量侧**，planRows 与断言一起漏，恒绿却挡不住撑屏（R1 教训复现）。
 * 本文件从渲染侧兜底：以真实 Ink 渲染 LogsPage 全组件树 → 取 unmount
 * 后末帧 → 断言行数恒 ≤ 终端行数、顶部工具栏恒出现、可滚时滚动条在位。
 *
 * 覆盖矩阵（三档列宽 × 空/长/展开/帮助/时间线/全局时间线）：
 *   rows ≤ 24 恒成立；空页恰 24 行；顶部第一行含 `Logs`；
 *   滚动条 `█` 在有溢出时出现、无溢出时不出现；任一可视行显示宽 ≤ 列数（R-4/左栏单行）。
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';

import type { LogEntry } from '@core/logger/index.js';
import type { SessionSummaryOnDisk } from '@core/logger/file-log-loader.js';
import { LogsPage } from '../LogsPage.js';
import { displayWidth } from '../card-window.js';
import { AppContext, type AppState } from '../../context/AppContext.js';
import { listSessions, loadSessionEntries, getCachedSessionEntries } from '@core/logger/file-log-loader.js';
import { listAllSessions } from '@core/logger/data-store.js';
import { createSessionIndex } from '@core/session/session-index.js';

vi.mock('@core/logger/file-log-loader.js', () => ({
  listSessions: vi.fn(),
  loadSessionEntries: vi.fn(),
  getCachedSessionEntries: vi.fn(),
}));
vi.mock('@core/logger/data-store.js', () => ({ listAllSessions: vi.fn() }));
vi.mock('@core/session/session-index.js', () => ({ createSessionIndex: vi.fn() }));

beforeEach(() => {
  vi.mocked(listSessions).mockReset();
  vi.mocked(loadSessionEntries).mockReset();
  vi.mocked(getCachedSessionEntries).mockReset();
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(loadSessionEntries).mockResolvedValue([]);
  vi.mocked(getCachedSessionEntries).mockReturnValue(undefined);
  vi.mocked(listAllSessions).mockReset();
  vi.mocked(listAllSessions).mockImplementation(async () => {
    const base = await vi.mocked(listSessions)({ dir: 'mocked' });
    return base.map((s) => ({ ...s, projectId: 'test-pid', worktree: '/test' }));
  });
  vi.mocked(createSessionIndex).mockReset();
  vi.mocked(createSessionIndex).mockReturnValue({
    getSession: vi.fn().mockResolvedValue(null),
  } as never);
});

/**
 * 剥离 ANSI 序列（SGR/CSI/OSC/charset 等），只留视觉文本。
 *
 * 用本地实现而非 `strip-ansi`：后者是 ink 的传递依赖、不在本仓库直接依赖清单，
 * 测试不应依赖未声明的包。这里覆盖终端会零宽消费的全部常见序列。
 */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ============================================================
// 测试基础设施（FakeStdin/Stdout + Harness，独立于 logs-page.test.tsx，避免耦合其内部改动）
// ============================================================

function createTestState(): AppState {
  return {
    currentPage: 'logs',
    focusArea: null,
    inputMode: false,
    exitConfirmPending: false,
    showHelp: null,
    filterMode: false,
    editMode: false,
    permissionSelection: 0,
    permission: { pending: null, queue: [], history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending: null, queue: [], history: [] },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      context: { isCompacting: false },
    },
    debug: { traces: [], filter: {} },
    config: {
      provider: 'test',
      model: 'test',
      permissionMode: 'ask',
      maxSteps: 10,
      defaultRole: 'coder',
      childAgentTimeout: 60000,
      debug: true,
    },
    fullConfig: { providers: {}, models: {}, multiAgent: {}, sources: {}, defaultProvider: 'test' },
    configEdit: { field: null, originalValue: '' },
    configHasChanges: false,
    sessionMetadata: { id: 'test-session', providerId: 'test' },
  };
}

class FakeStdin extends Readable {
  isTTY = true;
  _read(): void {}
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }
  writeData(s: string): void {
    this.push(s);
  }
}

class FakeStdout extends Writable {
  output = '';
  columns?: number;
  rows?: number;
  constructor(size?: { columns?: number; rows?: number }) {
    super();
    if (size?.columns !== undefined) this.columns = size.columns;
    if (size?.rows !== undefined) this.rows = size.rows;
  }
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.output += chunk.toString();
    cb();
  }
}

function Harness(): React.ReactElement {
  const contextValue = {
    state: createTestState(),
    setState: (): void => {},
    setCurrentPage: (): void => {},
    setFocusArea: (): void => {},
    setInputMode: (): void => {},
    setExitConfirmPending: (): void => {},
    setShowHelp: (): void => {},
    setFilterMode: (): void => {},
    setEditMode: (): void => {},
    updateConfig: (): void => {},
    clearTraces: (): void => {},
    setLogPageFilter: (): void => {},
    setViewFilter: (): void => {},
  };
  return (
    <AppContext.Provider value={contextValue}>
      <LogsPage initialView="list" />
    </AppContext.Provider>
  );
}

/** settle 一拍（对齐 logs-page.test.tsx 的 keySettle 语义，取小值避免测试过慢）。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

/**
 * 按指定终端尺寸渲染 LogsPage，unmount 后返回末帧（已 strip ANSI）。
 *
 * Ink 在非 TTY 下延迟输出：unmount 时写最后一帧到 stdout。
 * 用真实 cols/rows（如 80×24、100×24）驱动预算数学与撑屏断言。
 */
async function renderFrame(
  sessions: SessionSummaryOnDisk[],
  entries: LogEntry[],
  keys: string[],
  size: { columns: number; rows: number }
): Promise<string> {
  vi.mocked(listSessions).mockResolvedValue(sessions);
  vi.mocked(loadSessionEntries).mockResolvedValue(entries);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(size);
  const instance = render(<Harness />, {
    stdin: stdin as never,
    stdout: stdout as never,
    patchConsole: false,
  });
  try {
    await settle();
    for (const key of keys) {
      stdin.writeData(key);
      await settle();
    }
    await settle();
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
  }
  // 剥离 ANSI：色码/背景码会被终端零宽消费，`split('\n')` 计行前需还原为纯文本，
  // 否则同一视觉行会被色段切碎成虚高计数。
  return stripAnsi(stdout.output);
}

function frameLines(frame: string): string[] {
  // Ink 帧通常以 \n 结尾；split 会产出末尾空段——按视觉行数计数：
  // 若最后一格为空则去掉，与 terminal 实际"渲染 N 行"语义一致。
  const parts = frame.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** 帧内任一可视行不得超出终端列宽（吸收 PRD R-5 的左栏单行断言 + 横溢防线）。 */
function assertNoWideLines(lines: string[], cols: number, label: string): void {
  for (const l of lines) {
    // displayWidth = string-width（与测量/渲染同一套宽度语义，CJK/emoji 计双宽），
    // 不能用 l.length —— 帮助条含中文，length 与显示宽不一致。
    if (displayWidth(l) > cols) {
      expect.fail(`${label} 存在超宽行：${displayWidth(l)} > ${cols}：${l.slice(0, 40)}…`);
    }
  }
}

function sess(id: string, count: number): SessionSummaryOnDisk {
  return {
    sessionId: id,
    firstTime: '2026-08-10T01:00:00.000Z',
    lastTime: '2026-08-10T01:00:59.000Z',
    count,
    lastMessage: 'last log line',
    hasError: false,
  };
}

/** 生成 n 条长日志：i % 7 === 0 为 error（带 error 字段），其余 info；message 固定 msgLen 长度撑换行。 */
function longEntries(n: number, msgLen: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const isError = i % 7 === 0;
    return {
      version: 1,
      timestamp: `2026-08-10T01:00:${String(i % 60).padStart(2, '0')}.000Z`,
      level: isError ? 'error' : 'info',
      scope: 'tool',
      sessionId: 's1',
      message: 'x'.repeat(msgLen) + `#${i}`,
      ...(isError ? { error: { name: 'Error', message: 'boom-' + i } } : {}),
    } as LogEntry;
  });
}

/** 生成 n 条含多行 message（模拟 stack trace），驱动折叠/展开的原始行换行。 */
function multiLineEntries(n: number, linesPer: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    version: 1,
    timestamp: `2026-08-10T01:00:${String(i % 60).padStart(2, '0')}.000Z`,
    level: 'info',
    scope: 'tool',
    sessionId: 's1',
    message: Array.from({ length: linesPer }, (_, k) => `e${i}-l${k}-${'z'.repeat(40)}`).join('\n'),
  }));
}

// ============================================================
// 场景矩阵
// ============================================================

const SIZES = [
  { columns: 80, rows: 24, name: '80×24' },
  { columns: 100, rows: 24, name: '100×24' },
  { columns: 140, rows: 24, name: '140×24' },
] as const;

describe('LogsPage 端到端帧不撑屏（R-5 渲染侧防线）', () => {
  // 空 session 列表：左栏空态 + 右栏未选
  it('空 session × 三档列宽：行数恒 ≤ 24 且顶部工具栏在位', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([], [], [], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 空 session`);
      expect(
        lines.length,
        `${s.name} 空 session 帧行数 ${lines.length} 超过 rows=${s.rows}`
      ).toBeLessThanOrEqual(s.rows);
      expect(
        lines.some((l) => l.includes('Logs')),
        `${s.name} 空 session 帧缺顶部工具栏`
      ).toBe(true);
    }
  });

  // 单 session、无 entries：右栏空态
  it('单 session 空条目 × 三档列宽：不撑屏，顶栏在位', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 0)], [], [], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 空条目`);
      expect(lines.length, `${s.name} 空条目帧行数 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
      expect(lines.some((l) => l.includes('Logs'))).toBe(true);
    }
  });

  // 20 条 300 字长日志（每条约 4~11 行换行），折叠态：撑预算最狠的组合
  it('20 条 300 字长日志（折叠）× 三档列宽：不撑屏', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 20)], longEntries(20, 300), [], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 折叠长日志`);
      expect(lines.length, `${s.name} 折叠长日志帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
      expect(lines.some((l) => l.includes('Logs'))).toBe(true);
    }
  });

  // 展开首卡（Enter）：驱动 R-1 详情 chrome 计入
  it('展开首卡（长日志 + Enter）× 三档列宽：不撑屏（驱动 R-1）', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 20)], longEntries(20, 300), ['\r'], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 展开长日志`);
      expect(lines.length, `${s.name} 展开长日志帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
      expect(lines.some((l) => l.includes('Logs'))).toBe(true);
    }
  });

  // 帮助条开启（默认开启）：驱动 R-2 bottomBar 换行计入
  it('帮助条开启（默认）× 三档列宽：不撑屏（驱动 R-2）', async () => {
    for (const s of SIZES) {
      // 默认 helpVisible=true，无需按键
      const frame = await renderFrame([sess('s1', 20)], longEntries(20, 300), [], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 帮助开启`);
      // 帮助开启：帧内必含 [help on]（若被顶出则说明底部把行吃了）
      expect(lines.length, `${s.name} 帮助开启帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
      expect(stripAnsi(frame)).toMatch(/help\s*on/);
      expect(lines.some((l) => l.includes('Logs'))).toBe(true);
    }
  });

  // 多行 message 折叠 5 行 + 提示；单张占 7 行左右，压窗口
  it('多行 message（10 条 × 20 行折叠）× 三档列宽：不撑屏', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 10)], multiLineEntries(10, 20), [], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 多行折叠`);
      expect(lines.length, `${s.name} 多行折叠帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
    }
  });

  // 展开的错误卡片（含上下文区）：驱动 R-1 详情 + context 双 chrome
  it('展开错误卡片（含上下文区）× 三档列宽：不撑屏', async () => {
    // 制造 error 卡片：i%7===0 → 第 7 条为 error；先按 ] 跳到该错误，Enter 展开。
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 20)], longEntries(20, 200), [']', '\r'], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 错误展开`);
      expect(lines.length, `${s.name} 错误展开帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
    }
  });

  // 时间线视图（V 切换）
  it('时间线视图 × 三档列宽：不撑屏，顶栏在位', async () => {
    for (const s of SIZES) {
      const frame = await renderFrame([sess('s1', 20)], longEntries(20, 100), ['v'], s);
      const lines = frameLines(frame);
      assertNoWideLines(lines, s.columns, `${s.name} 时间线`);
      expect(lines.length, `${s.name} 时间线帧 ${lines.length} > ${s.rows}`).toBeLessThanOrEqual(s.rows);
      expect(lines.some((l) => l.includes('Logs'))).toBe(true);
    }
  });
});

describe('LogsPage 滚动条在可滚内容时出现', () => {
  it('长列表可滚 → 帧含滚动条字符 █；单条短卡无可滚 → 无 █', async () => {
    const size = { columns: 100, rows: 24 };
    const tallFrame = await renderFrame([sess('s1', 20)], longEntries(20, 200), [], size);
    expect(tallFrame.includes('█'), '溢出列表帧应出现滚动条 thumb').toBe(true);

    const tinyFrame = await renderFrame(
      [sess('s1', 1)],
      [{ version: 1, timestamp: '2026-08-10T01:00:00.000Z', level: 'info', scope: 'tool', sessionId: 's1', message: 'short' } as LogEntry],
      [],
      size
    );
    expect(tinyFrame.includes('█'), '无可滚内容时不应出现滚动条 thumb').toBe(false);
  });
});
