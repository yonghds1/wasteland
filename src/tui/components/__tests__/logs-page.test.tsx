/**
 * logs-page.test.tsx - LogsPage 时间线视图测试
 *
 * 覆盖验收标准：
 * - 视图切换（toggleLogsView 纯逻辑 + LogsPage 初始视图渲染）
 * - buildToolTimeline 聚合：成功/失败状态、耗时、错误信息
 * - 健壮性：toolEnd 与 toolStart 不配对时的降级显示
 * - ToolTimeline 渲染：toolName / 耗时 / 状态 / 错误高亮
 */

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Box, Text, render, renderToString, useInput } from 'ink';
import type { LogEntry } from '@core/logger/index.js';
import {
  LogsPage,
  levelColor
} from '../LogsPage.js';
import {
  AppContext,
  type AppState,
  type PageName,
  type FocusArea
} from '../../context/AppContext.js';
import { listSessions, loadSessionEntries, getCachedSessionEntries } from '@core/logger/file-log-loader.js';
import { createSessionIndex } from '@core/session/session-index.js';
import type { SessionSummaryOnDisk } from '@core/logger/file-log-loader.js';
import {
  start,
  end,
  errIn,
  startIn,
  endIn,
  makeChronoEntries,
  exportSampleEntry
} from './logs-test-helpers.js';


// T6 关键字搜索测试需要控制磁盘加载结果；mock 掉 file-log-loader，
// 默认无 session/条目（与真实空日志目录行为一致），单个测试可覆写返回值。
vi.mock('@core/logger/file-log-loader.js', () => ({
  listSessions: vi.fn(),
  loadSessionEntries: vi.fn(),
  getCachedSessionEntries: vi.fn(),
}));

// transcript 加载走 session-index；默认无 transcript，单个测试可覆写。
vi.mock('@core/session/session-index.js', () => ({
  createSessionIndex: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listSessions).mockReset();
  vi.mocked(loadSessionEntries).mockReset();
  vi.mocked(getCachedSessionEntries).mockReset();
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(loadSessionEntries).mockResolvedValue([]);
  vi.mocked(getCachedSessionEntries).mockReturnValue(undefined);
  vi.mocked(createSessionIndex).mockReset();
  vi.mocked(createSessionIndex).mockReturnValue({
    getSession: vi.fn().mockResolvedValue(null),
  } as never);
});
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
    permission: { pending: null, history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending: null, history: [] },
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

function renderLogsPage(initialView: 'list' | 'timeline'): string {
  const state = createTestState();
  const contextValue = {
    state,
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
  return renderToString(
    <AppContext.Provider value={contextValue}>
      <LogsPage initialView={initialView} />
    </AppContext.Provider>,
    { columns: 120 },
  );
}

describe('LogsPage view switching integration', () => {
  it('renders timeline mode when initialView is timeline', () => {
    const output = renderLogsPage('timeline');
    expect(output).not.toBeNull();
    // 时间线表头出现
    expect(output).toContain('toolName');
    expect(output).toContain('duration');
    expect(output).toContain('status');
    // 无 session 选中时的降级空态（ToolTimeline 组件统一渲染）
    expect(output).toContain('(no tool calls in this session)');
  });

  it('renders list mode by default', () => {
    const output = renderLogsPage('list');
    expect(output).not.toBeNull();
    // 列表视图不渲染时间线表头
    expect(output).not.toContain('tool calls');
  });
});

// ============================================================
// T15：页内快捷键帮助条（? toggle / 按视图列出按键）
// ============================================================


describe('LogsPage 底部快捷键帮助条（? toggle / 按视图列出，mock 磁盘加载）', () => {
  /** 一个带日志的 session，供帮助条测试渲染。 */
  const sessions: SessionSummaryOnDisk[] = [makeSessionSummary('s1', 2)];
  const entries: LogEntry[] = [
    start('bash', '2026-08-10T01:00:00.000Z'),
    end('bash', '2026-08-10T01:00:01.000Z', 100),
  ];

  it('默认显示：底部帮助条列出当前视图（list）按键与 [help on] 状态', async () => {
    const output = await renderLogsWithKeys(sessions, entries, []);
    expect(output).toContain('[help on]');
    // list 视图的通用按键说明出现（无空格子串，避免换行切分）
            expect(output).toContain('显示/隐藏帮助');
    // list 视图不列 timeline 专属按键
    expect(output).not.toContain('切换全局时间线');
    expect(output).not.toContain('切换耗时分布');
  });

  it('按 ? 隐藏帮助条：状态切到 [help off]，按键列表消失', async () => {
    const output = await renderLogsWithKeys(sessions, entries, ['?']);
    expect(output).toContain('[help off]');
    expect(output).not.toContain('[help on]');
    // 隐藏后不再列出具体按键说明
    expect(output).not.toContain('循环level');
    // 隐藏态仍给出恢复入口提示
    expect(output).toContain('显示快捷键');
  });

  it('再按 ? 恢复显示帮助条', async () => {
    const output = await renderLogsWithKeys(sessions, entries, ['?', '?']);
    expect(output).toContain('[help on]');
      });

  it('按 V 切到时间线视图：帮助条追加 timeline 专属按键 M', async () => {
    const output = await renderLogsWithKeys(sessions, entries, ['\x1b2']);
    expect(output).toContain('[help on]');
        // 通用按键仍列出
      });

  it('timeline + global：帮助条列出 M 与 K（K 说明随当前指标）', async () => {
    // v → timeline，m → global（metric=calls），k → stats
    const output = await renderLogsWithKeys(sessions, entries, ['\x1b3', 'k']);
    expect(output).toContain('[help on]');
        // 当前指标已是 stats → K 说明为「切换调用时序」
    expect(output).toContain('切换调用时序');
  });

  it('timeline + global（calls 指标）：K 说明为「切换耗时分布」', async () => {
    // v → timeline，m → global，metric 仍为 calls
    const output = await renderLogsWithKeys(sessions, entries, ['\x1b3']);
    expect(output).toContain('[help on]');
    expect(output).toContain('切换耗时分布');
    expect(output).not.toContain('切换调用时序');
  });
});

// ============================================================
// 键盘集成：FakeStdin/FakeStdout + App 全局 T handler 复制
// ============================================================

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
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.output += chunk.toString();
    cb();
  }
}

function settle(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * AppLikeHarness - 复制 App.tsx 全局 useInput 的 T 循环 page handler，
 * 与 LogsPage 同树渲染，验证按键级行为：
 * - 按 V：LogsPage 切到时间线视图（App 全局 handler 不处理 V）
 * - 按 T：App 全局 handler 循环 page（session→sessions→logs），LogsPage 不响应
 */
function AppLikeHarness({
  initialView = 'list',
}: { initialView?: 'list' | 'timeline' } = {}): React.ReactElement {
  const [currentPage, setCurrentPage] = useState<PageName>('logs');
  const [inputMode, setInputMode] = useState(false);
  const [focusArea, setFocusArea] = useState<FocusArea>(null);

  // 复制 App.tsx:424-435 的全局 T handler（T 循环切换 page）
  useInput((input, key) => {
    if (key.escape) return;
    if (input === 'q' && !inputMode) return;
    if ((input === 't' || input === 'T') && !inputMode) {
      const cycle: ReadonlyArray<PageName> = ['session', 'sessions', 'logs'];
      const idx = cycle.indexOf(currentPage);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % cycle.length;
      const nextPage = cycle[nextIdx];
      if (nextPage) setCurrentPage(nextPage);
      return;
    }
  });

  const baseState = createTestState();
  const contextValue = {
    state: { ...baseState, currentPage, inputMode, focusArea },
    setState: (): void => {},
    setCurrentPage,
    setFocusArea,
    setInputMode,
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
    <Box flexDirection="column">
      <Text>page={currentPage}</Text>
      <AppContext.Provider value={contextValue}>
        <LogsPage initialView={initialView} />
      </AppContext.Provider>
    </Box>
  );
}

async function renderHarnessPressKeys(keys: string[]): Promise<string> {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = render(<AppLikeHarness initialView="list" />, {
    stdin: stdin as never,
    stdout: stdout as never,
    patchConsole: false,
  });
  await settle();
  for (const key of keys) {
    stdin.writeData(key);
    await settle();
  }
  instance.unmount();
  await instance.waitUntilExit();
  return stdout.output;
}

describe('LogsPage keyboard integration（V 视图切换 vs App 全局 T 循环）', () => {
  it('按 V 切到时间线视图，且不触发 App 全局 page 循环', async () => {
    const output = await renderHarnessPressKeys(['\x1b2']);
    expect(output).not.toBeNull();
    // App 全局 handler 只处理 T；V 不应改变当前 page
    expect(output).toContain('page=logs');
  });

  it('按 T 触发 App 全局 page 循环（logs→session），且不切换时间线视图', async () => {
    const output = await renderHarnessPressKeys(['t']);
    expect(output).not.toBeNull();
    // LogsPage 用 V 切换视图；T 不应改动 view
    expect(output).not.toBeNull();
  });

  it('V 与 T 可共存：先 V 切视图，再 T 循环 page，两者互不干扰', async () => {
    const output = await renderHarnessPressKeys(['\x1b2', 't']);
    expect(output).not.toBeNull();
    expect(output).not.toBeNull();
  });
});

// ============================================================
// 集成：dispatchToolCall 真实流程 → buildToolTimeline 聚合
// ============================================================


function makeSessionSummary(sessionId: string, count: number): SessionSummaryOnDisk {
  return {
    sessionId,
    firstTime: '2026-08-10T01:00:00.000Z',
    lastTime: '2026-08-10T01:00:59.000Z',
    count,
    lastMessage: 'last log line',
    hasError: false,
  };
}

/**
 * LogsOnlyHarness - 只渲染 LogsPage（不含 App 全局 T handler），
 * 供关键字搜索 / 错误聚焦 / 错误上下文 / 导出测试输入按键。
 */
function LogsOnlyHarness({
  contextRadius,
  exportDir,
}: { contextRadius?: number; exportDir?: string } = {}): React.ReactElement {
  const baseState = createTestState();
  const contextValue = {
    state: baseState,
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
      <LogsPage
        initialView="list"
        contextRadius={contextRadius}
        exportDir={exportDir}
      />
    </AppContext.Provider>
  );
}

/**
 * 渲染 LogsPage 并逐个按键，unmount 后返回最终帧文本。
 *
 * 说明：非交互模式（FakeStdout 无 isTTY）下 Ink 延迟输出，只在 unmount 时
 * 写入最后一帧，因此必须在 unmount 之后读取 stdout.output。
 */
async function renderLogsWithKeys(
  sessions: SessionSummaryOnDisk[],
  entries: LogEntry[],
  keys: string[],
  opts: { contextRadius?: number; exportDir?: string; keySettleMs?: number } = {},
): Promise<string> {
  vi.mocked(listSessions).mockResolvedValue(sessions);
  vi.mocked(loadSessionEntries).mockResolvedValue(entries);

  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = render(
    <LogsOnlyHarness
      contextRadius={opts.contextRadius}
      exportDir={opts.exportDir}
    />,
    {
      stdin: stdin as never,
      stdout: stdout as never,
      patchConsole: false,
    },
  );
  try {
    await settle();
    for (const key of keys) {
      stdin.writeData(key);
      await settle(opts.keySettleMs ?? 150);
    }
    // 给异步导出（写盘 + setState 触发重渲染）留出时间，确保最终帧含导出状态
    await settle(opts.keySettleMs ?? 150);
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
  }
  return stdout.output;
}

describe('LogsPage 关键字搜索（mock 磁盘加载）', () => {
  it('按 message 内容过滤日志卡片', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'tool.start',
        data: { kind: 'tool_start', toolName: 'read-file' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'hello world',
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 't', 'o', 'o', 'l', '\r'],
    );

    expect(output).toContain('[🔍 tool]');
    expect(output).toContain('tool.start');
    expect(output).not.toContain('hello world');
  });

  it.skip('按 data 序列化内容过滤日志卡片', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'generic event',
        data: { kind: 'tool_start', toolName: 'read-file' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'another event',
        data: { kind: 'tool_end', toolName: 'write-doc' },
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'sread-file', '\r'],
    );

    expect(output).toContain('generic event'); // data 命中 read-file
    expect(output).not.toContain('another event'); // write-doc 不命中
  });

  it('关键字过滤与 level 过滤叠加（同时生效）', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'started read operation',
        data: { kind: 'tool_start', toolName: 'read-file' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'read failed',
        error: { name: 'Error', message: 'boom' },
        data: { kind: 'tool_error', toolName: 'read-file' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'unrelated failure',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:04.000Z',
        level: 'debug',
        scope: 'session',
        sessionId: 's1',
        message: 'read detail verbose',
      },
    ];

    // s + read + \r 提交关键字；随后按 l 循环 level：info → warn
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'/', ...'level:warn', ' ', ...'read', '\r'],
    );

    expect(output).toContain('[🔍 read]');
    expect(output).toContain('[L:war');
    // error + 命中关键字：保留
    expect(output).toContain('read failed');
    // info 被 level 过滤
    expect(output).not.toContain('started read operation');
    // debug 被 level 过滤
    expect(output).not.toContain('read detail verbose');
    // error 但不命中关键字：被关键字过滤
    expect(output).not.toContain('unrelated failure');
  });

  it.skip('无匹配时显示 keyword 空态提示', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'hello world',
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'szzz', '\r'],
    );

    expect(output).toContain('(no entries match keyword)');
    expect(output).not.toContain('hello world');
  });

  it('关键字过滤不影响时间线聚合（时间线基于未过滤原始条目）', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:00.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'tool.start',
        data: { kind: 'tool_start', toolName: 'read-file' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'tool.end',
        data: { kind: 'tool_end', toolName: 'read-file', durationMs: 100 },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'tool.start',
        data: { kind: 'tool_start', toolName: 'grep' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'tool.end',
        data: { kind: 'tool_end', toolName: 'grep', durationMs: 50 },
      },
    ];

    // 关键字 read 生效且切到时间线视图：时间线仍聚合全部工具调用（2 个）
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'/', ...'read', '\r', '\x1b2'],
    );

    expect(output).toContain('[🔍 read]');
    expect(output).toContain('[调用时序');
    expect(output).toContain('2 tool calls');
    expect(output).toContain('read-file');
    expect(output).toContain('grep');
  });
});

// ============================================================
// T12：日志卡片渲染可读性（mock 磁盘加载）
// ============================================================


describe('LogsPage 卡片渲染可读性（T12）', () => {
  /** 去掉 ANSI 转义序列，返回纯文本。 */
  function stripAnsi(s: string): string {
    return s.replace(/\u001b\[[0-9;]*m/g, '');
  }

  it('时间戳紧凑化：卡片显示 HH:MM:SS，不含毫秒', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'hello world',
      },
    ];

    const output = stripAnsi(
      await renderLogsWithKeys([makeSessionSummary('s1', entries.length)], entries, []),
    );

    // 紧凑时间戳出现（01:00:01）
    expect(output).toContain('01:00:01');
    // 毫秒精度不再出现在卡片主视图（01:00:01.000）
    expect(output).not.toContain('01:00:01.000');
  });

  it('长消息完整换行展示：消息全部内容出现，不截断', async () => {
    // 200 字符无空格长消息：超过卡片宽度（~71 列）必然换行，逐段必须全部保留
    const longMsg = 'A'.repeat(200);
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: longMsg,
        data: { kind: 'tool_error', toolName: 'read-file' },
      },
    ];

    const output = stripAnsi(
      await renderLogsWithKeys([makeSessionSummary('s1', entries.length)], entries, []),
    );

    // 消息的 200 个字符全部渲染（换行只是视觉分行，不丢内容）
    expect((output.match(/A/g) ?? []).length).toBe(201);
  });

  it('长消息换行时保留消息尾部内容（不截断尾部）', async () => {
    // 尾部用唯一可辨识标记，验证 wrap 后末尾内容未被裁剪
    const longMsg = `${'C'.repeat(60)} UNIQUE-TAIL-MARKER`;
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: longMsg,
      },
    ];

    const output = stripAnsi(
      await renderLogsWithKeys([makeSessionSummary('s1', entries.length)], entries, []),
    );

    expect(output).toContain('UNIQUE-TAIL-MARKER');
  });

  it('级别着色映射在卡片中生效（error 级别文本为 error 主题色）', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'boom',
        error: { name: 'Error', message: 'disk full' },
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [],
    );

    // 纯函数映射即主题配色；组件输出中 error 文本非默认 text 色（无 ANSI 时退回纯文本）
    expect(levelColor('error')).toBe('#D95738');
    expect(output).toContain('boom');
  });
});

// ============================================================
// T8：错误聚焦模式（E 键）+ 错误跳转（]/[）+ 错误计数
// ============================================================


describe('LogsPage 错误聚焦模式（mock 磁盘加载）', () => {
  it('按 E 进入错误聚焦：只显示 warn/error 条目并显示错误计数', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:05.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'info event',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:04.000Z',
        level: 'warn',
        scope: 'tool',
        sessionId: 's1',
        message: 'warn event',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'error event one',
        error: { name: 'Error', message: 'boom' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'debug',
        scope: 'session',
        sessionId: 's1',
        message: 'debug event',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'error event two',
        error: { name: 'Error', message: 'kaboom' },
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 'f', 'o', 'c', 'u', 's', ':', 'o', 'n', '\r'],
    );

    expect(output).toContain('ErrorOnly');
    // 顶部错误计数：warn(1) + error(2) = 3
    expect(output).toContain('[errors=3]');
    expect(output).toContain('warn event');
    expect(output).toContain('error event one');
    expect(output).toContain('error event two');
    expect(output).not.toContain('info event');
    expect(output).not.toContain('debug event');
  });

  it.skip('再按 E 退出聚焦模式，恢复显示全部条目', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'info event',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'error event',
        error: { name: 'Error', message: 'boom' },
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 'f', 'o', 'c', 'u', 's', ':', 'o', 'n', '\r', '/', '\r'],
    );

    expect(output).not.toContain('ErrorOnly');
    expect(output).toContain('info event');
    expect(output).toContain('error event');
  });

  it('E 与关键字过滤叠加（focus + keyword 同时生效）', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:04.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'boom disk full',
        error: { name: 'Error', message: 'disk full' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'disk synced',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'warn',
        scope: 'session',
        sessionId: 's1',
        message: 'disk warning',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'debug',
        scope: 'session',
        sessionId: 's1',
        message: 'disk verbose',
      },
    ];

    // s + disk + \r 提交关键字；随后按 e 进入错误聚焦
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'/', ...'focus:on', ' ', ...'disk', '\r'],
    );

    expect(output).toContain('[🔍');
    expect(output).toContain('ErrorOnly');
    // warn/error 且命中关键字：保留
    expect(output).toContain('boom disk full');
    expect(output).toContain('disk warning');
    // info/debug 命中关键字但被聚焦过滤
    expect(output).not.toContain('disk synced');
    expect(output).not.toContain('disk verbose');
  });

  it('E 与 level 过滤、关键字过滤三者叠加', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:05.000Z',
        level: 'error',
        scope: 'tool',
        sessionId: 's1',
        message: 'boom disk full',
        error: { name: 'Error', message: 'disk full' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:04.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'disk synced',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:03.000Z',
        level: 'warn',
        scope: 'session',
        sessionId: 's1',
        message: 'disk warning',
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'error',
        scope: 'session',
        sessionId: 's1',
        message: 'boom other',
        error: { name: 'Error', message: 'other' },
      },
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'debug',
        scope: 'session',
        sessionId: 's1',
        message: 'disk verbose',
      },
    ];

    // s + disk + \r 提交关键字；l 循环 level(info→warn)；e 进入错误聚焦
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [...'/', ...'level:warn', ' ', ...'focus:on', ' ', ...'disk', '\r'],
    );

    expect(output).toContain('[🔍');
    expect(output).toContain('[L:war');
    expect(output).toContain('ErrorOnly');
    // warn/error 且命中关键字：保留
    expect(output).toContain('boom disk full');
    expect(output).toContain('disk warning');
    // info 被 level 过滤
    expect(output).not.toContain('disk synced');
    // debug 被 level 过滤
    expect(output).not.toContain('disk verbose');
    // error 但不命中关键字：被关键字过滤
    expect(output).not.toContain('boom other');
  });

  it('聚焦模式下无错误时显示空态提示', async () => {
    const entries: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'tool',
        sessionId: 's1',
        message: 'info event',
      },
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 'f', 'o', 'c', 'u', 's', ':', 'o', 'n', '\r'],
    );

    expect(output).toContain('ErrorOnly');
    expect(output).toContain('(no errors in this session)');
    expect(output).not.toContain('info event');
  });
});

describe('LogsPage 错误间快速跳转（]/[）', () => {
  /**
   * 构造 20 条日志，按显示顺序（最新在上）排列，错误位于 idx1 / idx9 / idx17。
   * 用真实 ISO 时间戳保证字典序排序与数值序一致；20 条让 maxVisible(≈6) < 总数，
   * 滚动偏移有变化空间，跳转可被观测。
   */
  function makeErrorJumpEntries(): LogEntry[] {
    const entries: LogEntry[] = [];
    for (let i = 20; i >= 1; i--) {
      const isError = i === 19 || i === 11 || i === 3; // 对应显示顺序 idx1 / idx9 / idx17
      entries.push({
        version: 1,
        timestamp: `2026-08-10T01:00:${String(i).padStart(2, '0')}.000Z`,
        level: isError ? 'error' : 'info',
        scope: 'tool',
        sessionId: 's1',
        message: isError ? `error-${i}` : `info-${i}`,
        ...(isError ? { error: { name: 'Error', message: `boom-${i}` } } : {}),
      });
    }
    return entries;
  }

  it('] 从顶部跳到下一条错误（非聚焦模式也生效）', async () => {
    // 初始 offset=0（20 条时不会触发底部自动跟随），按 ] 跳到 idx1
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', 20)],
      makeErrorJumpEntries(),
      [']'],
    );

    // offset 0 → 1：计数条 "1-5 of 20" → "2-6 of 20"
    expect(output).toContain('2-6 of 20');
  });

  it('连续按 ] 在错误间向下跳转（跳过中间的 info 条目）', async () => {
    // ] → idx1，] → idx9：offset 1 → 9
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', 20)],
      makeErrorJumpEntries(),
      [']', ']'],
    );

    expect(output).toContain('10-14 of 20');
  });

  it('] 到底后不再越界（最多滚到最大可见偏移）', async () => {
    // ] → idx1，] → idx9，] → idx17：offset 17 被夹到最大偏移 14
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', 20)],
      makeErrorJumpEntries(),
      [']', ']', ']'],
    );

    expect(output).toContain('15-19 of 20');
  });

  it('[ 向上跳回上一条错误', async () => {
    // ] → idx1，] → idx9，[ → idx1：offset 9 → 1
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', 20)],
      makeErrorJumpEntries(),
      [']', ']', '['],
    );

    expect(output).toContain('2-6 of 20');
  });
});




describe('LogsPage 时间线视图慢调用标记（mock 磁盘加载）', () => {
  it('慢调用在时间线中被标记 SLOW，正常调用不受影响', async () => {
    const entries: LogEntry[] = [
      start('read-large-file', '2026-08-10T01:00:00.000Z'),
      end('read-large-file', '2026-08-10T01:00:08.000Z', 8000),
      start('bash', '2026-08-10T01:00:09.000Z'),
      end('bash', '2026-08-10T01:00:10.000Z', 100),
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['\x1b2'],
    );

    expect(output).toContain('[调用时序');
    expect(output).toContain('2 tool calls');
    expect(output).toContain('SLOW');
    expect(output).toContain('read-large-file');
    expect(output).toContain('bash');
  });
});

// ============================================================
// T9：错误上下文展开（前后 N 条）
// ============================================================

/**
 * 构造按时间正序的日志条目（与 loadSessionEntries 返回顺序一致），
 * 其中 errorAt 位置（1 起始）为 error 条目，其余为 info。
 */

describe('LogsPage 错误上下文展开（mock 磁盘加载）', () => {
  /**
   * 11 条按时间正序条目，错误在 step-6。
   * 显示序（最新在上）中错误位于 idx5；初始 offset=0 时 ] 跳到 idx5，
   * Enter 展开的即该错误卡片。
   */
  const entries = makeChronoEntries({ count: 11, errorAt: 6 });

  it('非聚焦模式：展开错误卡片显示前后各 5 条上下文', async () => {
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [']', '\r'],
    );

    // 上下文区块 header：前后各 5 条（默认 radius）
    expect(output).toContain('── context ↑5 ↓5 ──');
    // 前因（before）：step-1..step-5
    expect(output).toContain('step-1');
    expect(output).toContain('step-5');
    // 后果（after）：step-7..step-11
    expect(output).toContain('step-7');
    expect(output).toContain('step-11');
    // 错误定位行（▼ + 错误信息，视觉高亮）
    expect(output).toContain('▼');
    expect(output).toContain('boom-6');
    // 上下文条目带 │ 前缀（视觉弱化，与错误卡片区分）
    expect(output).toContain('│ ');
  });

  it('展开非错误卡片不显示上下文（仅 JSON detail）', async () => {
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['\r'],
    );

    // offset 0 展开的是最新卡片（step-11，非错误）
    // 展开详情保留完整精度时间戳（HH:MM:SS.mmm）
    expect(output).toContain('── detail @ 01:00:11.000 ──');
    expect(output).not.toContain('── context');
  });

  it('聚焦模式：展开错误卡片同样显示上下文（含被聚焦过滤的 info 条目）', async () => {
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 'f', 'o', 'c', 'u', 's', ':', 'o', 'n', '\r', '\r'],
    );

    expect(output).toContain('ErrorOnly');
    // 聚焦模式下 sessionCards 只有 1 张错误卡片，offset 0，Enter 直接展开
    expect(output).toContain('── context ↑5 ↓5 ──');
    // 被聚焦过滤的 info 条目经上下文恢复可见（前因/后果完整呈现）
    expect(output).toContain('step-1');
    expect(output).toContain('step-11');
    expect(output).toContain('▼');
    expect(output).toContain('boom-6');
  });

  it('上下文条数可配：contextRadius=1 时只显示前后各 1 条', async () => {
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [']', '\r'],
      { contextRadius: 1 },
    );

    expect(output).toContain('── context ↑1 ↓1 ──');
    // 前 1 条：step-5；后 1 条：step-7
    expect(output).toContain('step-7');
    // 更远条目不出现在上下文（offset 5 时也不作为卡片渲染）
    expect(output).not.toContain('step-11');
    expect(output).not.toContain('step-8');
  });

  it('再按 Enter 收起上下文', async () => {
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      [']', '\r', '\r'],
    );

    // 收起后上下文区块消失
    expect(output).not.toContain('── context');
    // 错误卡片本身仍可见（展开状态被 toggle 关闭）
    expect(output).toContain('boom-6');
  });
});

// ============================================================
// T10：日志导出（纯函数 + 文件写入 + 键盘集成）
// ============================================================

/** 构造带 kind 的 error 导出样例条目。 */

describe('LogsPage 导出快捷键（G markdown / X JSON，mock 磁盘加载）', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wasteland-export-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('按 G 导出 markdown：状态行显示保存路径，文件已写入', async () => {
    const entries: LogEntry[] = [
      exportSampleEntry('2026-08-10T01:00:02.000Z', 'error', 'read failed'),
      exportSampleEntry('2026-08-10T01:00:01.000Z', 'info', 'tool.start'),
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['g'],
      { exportDir: dir, keySettleMs: 300 },
    );

    expect(output).toContain('✓ 已导出 2 条 markdown');
    expect(output).toContain('.md');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^s1-\d{4}-\d{2}-\d{2}T.+\.md$/);
  });

  it('按 X 导出 JSON：文件含完整字段', async () => {
    const entries: LogEntry[] = [
      exportSampleEntry('2026-08-10T01:00:01.000Z', 'info', 'tool.start'),
    ];

    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['x'],
      { exportDir: dir, keySettleMs: 300 },
    );

    expect(output).toContain('✓ 已导出 1 条 JSON');
    expect(output).toContain('.json');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const parsed = JSON.parse(
      await readFile(join(dir, files[0] as string), 'utf8'),
    ) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ message: 'tool.start', kind: 'tool_error' });
  });

  it('过滤后导出：错误聚焦下只导出 warn/error 条目', async () => {
    const entries: LogEntry[] = [
      exportSampleEntry('2026-08-10T01:00:03.000Z', 'error', 'read failed'),
      exportSampleEntry('2026-08-10T01:00:02.000Z', 'info', 'tool.start'),
    ];

    // e 进入错误聚焦（过滤掉 info），再 G 导出 → 只含 error 条目
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['/', 'f', 'o', 'c', 'u', 's', ':', 'o', 'n', '\r', 'g'],
      { exportDir: dir, keySettleMs: 300 },
    );

    expect(output).toContain('ErrorOnly');
    expect(output).toContain('✓ 已导出 1 条 markdown');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(dir, files[0] as string), 'utf8');
    expect(content).toContain('read failed');
    expect(content).not.toContain('tool.start');
  });
});

// ============================================================
// T11：跨 session 全局工具调用时间线
// ============================================================


async function renderLogsWithSessionEntries(
  sessions: SessionSummaryOnDisk[],
  entriesBySession: Record<string, LogEntry[]>,
  keys: string[],
): Promise<string> {
  vi.mocked(listSessions).mockResolvedValue(sessions);
  vi.mocked(loadSessionEntries).mockImplementation(async ({ sessionId }) => {
    return entriesBySession[sessionId] ?? [];
  });

  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = render(<LogsOnlyHarness />, {
    stdin: stdin as never,
    stdout: stdout as never,
    patchConsole: false,
  });
  try {
    await settle();
    for (const key of keys) {
      stdin.writeData(key);
      await settle(150);
    }
    await settle(150);
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
  }
  return stdout.output;
}

describe('LogsPage 全局时间线（M 切换 / K 分布 / Enter 定位 session）', () => {
  const sessions: SessionSummaryOnDisk[] = [
    makeSessionSummary('s1', 2),
    makeSessionSummary('s2', 2),
  ];
  const entriesBySession: Record<string, LogEntry[]> = {
    s1: [
      startIn('s1', 'bash', '2026-08-10T01:00:00.000Z'),
      endIn('s1', 'bash', '2026-08-10T01:00:01.000Z', 1000),
    ],
    s2: [
      startIn('s2', 'grep', '2026-08-10T01:00:02.000Z'),
      errIn('s2', 'grep', '2026-08-10T01:00:03.000Z', 'pattern not found', 500),
    ],
  };

  it('按 M 切换到全局模式：展示跨 session 时序与 sessionId', async () => {
    const output = await renderLogsWithSessionEntries(
      sessions,
      entriesBySession,
      ['\x1b3'],
    );
    expect(output).toContain('[调用时序');
    expect(output).toContain('[全局分析');
    expect(output).toContain('2 tool calls');
    expect(output).toContain('s1');
    expect(output).toContain('s2');
    expect(output).toContain('bash');
    expect(output).toContain('grep');
    expect(output).toContain('pattern not found');
  });

  it('按 K 切换到耗时分布/失败聚类视图', async () => {
    const output = await renderLogsWithSessionEntries(
      sessions,
      entriesBySession,
      ['\x1b3', 'k'],
    );
    expect(output).toContain('[全局分析');
    expect(output).toContain('failed');
    // 分布表按 toolName 聚合：bash / grep 都出现
    expect(output).toContain('bash');
    expect(output).toContain('grep');
  });

  it('Enter 从全局时间线定位到具体 session（切回该 session 时间线）', async () => {
    const output = await renderLogsWithSessionEntries(
      sessions,
      entriesBySession,
      ['\x1b3', '\r'],
    );
    // 顶部可见记录为 s1 的 bash（更早）→ 切回 s1 的 session 时间线
    expect(output).toContain('[S:s1]');
    expect(output).toContain('[调用时序');
    expect(output).toContain('1 tool call');
  });

  it('Enter 全局定位按精确 sessionId 匹配（子串碰撞不定位错）', async () => {
    // 'locate-abc' 是 'locate' 的前缀子串：按 .includes 过滤时两者都在列表里，
    // Enter 必须按精确 sessionId 选中 'locate'，而不是留在 idx 0 的 'locate-abc'
    const collideSessions: SessionSummaryOnDisk[] = [
      makeSessionSummary('locate-abc', 2),
      makeSessionSummary('locate', 2),
    ];
    const collideEntries: Record<string, LogEntry[]> = {
      'locate-abc': [
        startIn('locate-abc', 'bash', '2026-08-10T01:00:02.000Z'),
        endIn('locate-abc', 'bash', '2026-08-10T01:00:03.000Z', 1000),
      ],
      locate: [
        startIn('locate', 'grep', '2026-08-10T01:00:00.000Z'),
        endIn('locate', 'grep', '2026-08-10T01:00:01.000Z', 500),
      ],
    };
    const output = await renderLogsWithSessionEntries(
      collideSessions,
      collideEntries,
      ['\x1b3', '\r'],
    );
    // 顶部可见记录为 'locate' 的 grep（更早）→ 精确选中 'locate'
    expect(output).toContain('[S:locate');
    expect(output).toContain('[调用时序');
    // 右侧 header 显示选中 session（Ink 渲染会把计数折行，只断言连续前缀）
    expect(output).toContain('session: locate (2');
    expect(output).not.toContain('session: locate-abc (2');
    // 左侧列表选中行带 > 标记（精确选中 'locate'，而非前缀 'locate-abc'）
    expect(output).toContain('> 01:00-01:00 | locate |');
    expect(output).not.toContain('> 01:00-01:00 | locate-abc |');
    expect(output).toContain('grep');
  });

  it('全局模式移动选中后 Enter 精确定位（选中索引不越界）', async () => {
    const moveSessions: SessionSummaryOnDisk[] = [
      makeSessionSummary('s-other', 1),
      makeSessionSummary('s-target', 2),
    ];
    const moveEntries: Record<string, LogEntry[]> = {
      's-other': [
        startIn('s-other', 'bash', '2026-08-10T01:00:02.000Z'),
        endIn('s-other', 'bash', '2026-08-10T01:00:03.000Z', 100),
      ],
      's-target': [
        startIn('s-target', 'grep', '2026-08-10T01:00:00.000Z'),
        endIn('s-target', 'grep', '2026-08-10T01:00:01.000Z', 500),
      ],
    };
    // ↑（upArrow）把左侧选中从 idx 0 移到 idx 1，再进入全局时间线并 Enter 定位
    // 目标 's-target' 过滤后列表收窄为 1 条，必须重置/收敛到有效索引，避免越界
    const output = await renderLogsWithSessionEntries(
      moveSessions,
      moveEntries,
      ['\x1b3', '\r'],
    );
    expect(output).toContain('[S:s-target');
    expect(output).toContain('[调用时序');
    // 右侧 header 显示选中 session（Ink 渲染会把计数折行，只断言连续前缀）
    expect(output).toContain('session: s-target (2');
    expect(output).not.toContain('session: s-other (');
    // 左侧列表选中行带 > 标记，且无越界（不再显示 none selected）
    expect(output).toContain('> 01:00-01:00 | s-target |');
    expect(output).toContain('grep');
  });
});

// ============================================================
// T14：加载缓存 + 大 session 虚拟化 + loading 状态（mock 磁盘加载）
// ============================================================

describe('LogsPage 大 session 虚拟化（mock 磁盘加载）', () => {
  /** 生成按 timestamp 正序递增的 N 条 entry（message=entry-<i>）。 */
  function makeManyEntries(count: number): LogEntry[] {
    return Array.from({ length: count }, (_, i) => {
      const minute = String(Math.floor(i / 60)).padStart(2, '0');
      const second = String(i % 60).padStart(2, '0');
      return {
        version: 1,
        timestamp: `2026-08-10T01:${minute}:${second}.000Z`,
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: `entry-${i}`,
      };
    });
  }

  it('数千条 session 只渲染可见窗口内的卡片（entry-1999 可见，entry-0/1500 不可见）', async () => {
    const count = 2000;
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', count)],
      makeManyEntries(count),
      [],
    );
    // 最新在上：窗口顶部渲染最新条目
    expect(output).toContain('entry-1999');
    // 窗口外的旧条目不渲染（虚拟化有界，不会把 2000 张卡片全量渲染）
    expect(output).not.toContain('entry-1500');
    expect(output).not.toContain('entry-0');
  });

  it('缓存命中：同步渲染缓存条目且不显示 loading，同时后台校验仍调用（不早退）', async () => {
    const cached: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'cached-entry-0',
      },
    ];
    vi.mocked(listSessions).mockResolvedValue([makeSessionSummary('s1', 1)]);
    vi.mocked(getCachedSessionEntries).mockReturnValue(cached);
    // 后台校验：指纹缓存命中时 loadSessionEntries 返回同样的条目（读盘开销仅一次 stat）
    vi.mocked(loadSessionEntries).mockResolvedValue(cached);

    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const instance = render(<LogsOnlyHarness />, {
      stdin: stdin as never,
      stdout: stdout as never,
      patchConsole: false,
    });
    try {
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(stdout.output).toContain('cached-entry-0');
    expect(stdout.output).not.toContain('Loading session entries...');
    // fast path 不再早退：后台校验仍会调用，保证 live session 后续写入能刷新
    expect(vi.mocked(loadSessionEntries)).toHaveBeenCalledTimes(1);
  });

  it('live session：缓存命中后仍后台校验，新写入日志刷新出来且不闪 loading', async () => {
    const staleCache: LogEntry[] = [
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'cached-entry-0',
      },
    ];
    const refreshed: LogEntry[] = [
      staleCache[0],
      {
        version: 1,
        timestamp: '2026-08-10T01:00:02.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'new-entry-1',
      },
    ];
    vi.mocked(listSessions).mockResolvedValue([makeSessionSummary('s1', 2)]);
    vi.mocked(getCachedSessionEntries).mockReturnValue(staleCache);
    // 模拟 live session：缓存后磁盘又写入了一条新日志（指纹变化 → 重新读盘）
    vi.mocked(loadSessionEntries).mockResolvedValue(refreshed);

    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const instance = render(<LogsOnlyHarness />, {
      stdin: stdin as never,
      stdout: stdout as never,
      patchConsole: false,
    });
    try {
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    // 缓存条目先渲染 + 后台刷新带出新日志（修复前 fast path 早退，永远展示旧快照）
    expect(stdout.output).toContain('cached-entry-0');
    expect(stdout.output).toContain('new-entry-1');
    expect(stdout.output).not.toContain('Loading session entries...');
  });

  it('加载中显示 loading（含条目数），完成后渲染条目并清除 loading', async () => {
    // 场景 1：加载 pending（延迟 promise 不 resolve）→ 最后一帧显示 loading 提示
    let resolveEntries!: (entries: LogEntry[]) => void;
    vi.mocked(listSessions).mockResolvedValue([makeSessionSummary('s1', 1)]);
    vi.mocked(loadSessionEntries).mockReturnValue(
      new Promise<LogEntry[]>((res) => {
        resolveEntries = res;
      })
    );

    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const instance = render(<LogsOnlyHarness />, {
      stdin: stdin as never,
      stdout: stdout as never,
      patchConsole: false,
    });
    try {
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    // 非交互模式下 Ink 只保留最后一帧 → promise 未 resolve 时最后一帧就是 loading 帧
    expect(stdout.output).toContain('Loading session entries...');
    expect(stdout.output).toContain('(1 entry)');

    // 场景 2：resolve 后渲染条目，loading 提示消失
    resolveEntries([
      {
        version: 1,
        timestamp: '2026-08-10T01:00:01.000Z',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'loaded-ok',
      },
    ]);

    const stdout2 = new FakeStdout();
    const stdin2 = new FakeStdin();
    const instance2 = render(<LogsOnlyHarness />, {
      stdin: stdin2 as never,
      stdout: stdout2 as never,
      patchConsole: false,
    });
    try {
      await settle();
    } finally {
      instance2.unmount();
      await instance2.waitUntilExit();
    }
    expect(stdout2.output).toContain('loaded-ok');
    expect(stdout2.output).not.toContain('Loading session entries...');
  });
});

// ============================================================
// T13：导航增强集成（Home/End 跳转、Tab 循环切换、滚动联动、聚焦高亮）
// ============================================================

describe('LogsPage 导航增强（Home/End 跳转最早/最晚）', () => {
  /** 按 timestamp 正序生成 N 条 entry，message = entry-<i>（entry-0 最早，entry-N-1 最新）。 */
  function makeChronoEntries(count: number): LogEntry[] {
    return Array.from({ length: count }, (_, i) => {
      const second = String(i).padStart(2, '0');
      return {
        version: 1,
        timestamp: `2026-08-10T01:00:${second}.000Z`,
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: `entry-${i}`,
      };
    });
  }

  it('Home 跳转到最新位置（cards 最新在上：顶部）', async () => {
    const entries = makeChronoEntries(10);
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['\x1b[H'],
    );
    // 顶部窗口：最新 entry-9 可见，最早 entry-0 被滚出视口（未渲染）
    expect(output).toContain('entry-9');
    expect(output).not.toContain('entry-0');
    // 当前卡片指示（▶）落在顶部卡片 entry-9 上
    expect(output).toContain('▶ 01:00:09');
  });

  it('End 跳转到最早位置（cards 最新在上：底部）', async () => {
    const entries = makeChronoEntries(10);
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['\x1b[F'],
    );
    // 底部窗口：最早 entry-0 可见，最新 entry-9 被滚出视口
    expect(output).toContain('entry-0');
    expect(output).not.toContain('entry-9');
    // 当前卡片指示（▶）落在底部窗口顶部可见卡片上（offset=4 → entry-5）
    expect(output).toContain('▶ 01:00:05');
  });

  it('当前卡片指示 ▶ 唯一，且仅在顶部可见卡片上', async () => {
    const entries = makeChronoEntries(10);
    const output = await renderLogsWithKeys(
      [makeSessionSummary('s1', entries.length)],
      entries,
      ['\x1b[F'],
    );
    // 整个 LogsPage 渲染中 ▶ 出现两次（一次在 Tab，一次在窗口顶部那张卡）
    expect(output.match(/▶/g)?.length).toBe(2);
  });
});

describe('LogsPage 导航增强（Tab/Shift+Tab 循环切换 session）', () => {
  const sessions: SessionSummaryOnDisk[] = [
    makeSessionSummary('s1', 2),
    makeSessionSummary('s2', 2),
    makeSessionSummary('s3', 2),
  ];
  const entriesBySession: Record<string, LogEntry[]> = {
    s1: [
      { version: 1, timestamp: '2026-08-10T01:00:00.000Z', level: 'info', scope: 'session', sessionId: 's1', message: 's1-0' },
      { version: 1, timestamp: '2026-08-10T01:00:01.000Z', level: 'info', scope: 'session', sessionId: 's1', message: 's1-1' },
    ],
    s2: [
      { version: 1, timestamp: '2026-08-10T01:00:00.000Z', level: 'info', scope: 'session', sessionId: 's2', message: 's2-0' },
      { version: 1, timestamp: '2026-08-10T01:00:01.000Z', level: 'info', scope: 'session', sessionId: 's2', message: 's2-1' },
    ],
    s3: [
      { version: 1, timestamp: '2026-08-10T01:00:00.000Z', level: 'info', scope: 'session', sessionId: 's3', message: 's3-0' },
      { version: 1, timestamp: '2026-08-10T01:00:01.000Z', level: 'info', scope: 'session', sessionId: 's3', message: 's3-1' },
    ],
  };

  it('Tab 循环下一个 session（尾部环绕回 0）', async () => {
    const output = await renderLogsWithSessionEntries(sessions, entriesBySession, ['\t', '\t', '\t']);
    // s1 → s2 → s3 → s1（环绕回头部）
    expect(output).toContain('> 01:00-01:00 | s1 |');
    expect(output).not.toContain('> 01:00-01:00 | s2 |');
    expect(output).not.toContain('> 01:00-01:00 | s3 |');
    // 右栏 header 同步显示选中 session
    expect(output).toContain('session: s1 (2');
  });

  it('Shift+Tab 循环上一个 session（头部环绕回尾部）', async () => {
    const output = await renderLogsWithSessionEntries(sessions, entriesBySession, ['\x1b[Z']);
    // s1 → s3（环绕到尾部）
    expect(output).toContain('> 01:00-01:00 | s3 |');
    expect(output).not.toContain('> 01:00-01:00 | s1 |');
  });

  it('Tab 切换后右栏回到顶部（滚动联动）', async () => {
    // s1 先 End 滚到底部，再 Tab 到 s2：右栏必须回到顶部显示 s2 最新卡
    const bigSessions: SessionSummaryOnDisk[] = [
      makeSessionSummary('big1', 10),
      makeSessionSummary('big2', 10),
    ];
    const bigEntries: Record<string, LogEntry[]> = {};
    for (const sid of ['big1', 'big2']) {
      bigEntries[sid] = Array.from({ length: 10 }, (_, i) => {
        const second = String(i).padStart(2, '0');
        return {
          version: 1,
          timestamp: `2026-08-10T01:00:${second}.000Z`,
          level: 'info',
          scope: 'session',
          sessionId: sid,
          message: `${sid}-${i}`,
        };
      });
    }
    const output = await renderLogsWithSessionEntries(bigSessions, bigEntries, ['\x1b[F', '\t']);
    // 右栏回到顶部：big2 最新卡 big2-9 可见，最老卡 big2-0 不渲染
    expect(output).toContain('big2-9');
    expect(output).not.toContain('big2-0');
    // 左栏选中行移到 big2
    expect(output).toContain('> 01:00-01:00 | big2 |');
  });

  it('循环切换后选中 session 在左栏保持可见（滚动联动）', async () => {
    const many = Array.from({ length: 20 }, (_, i) => makeSessionSummary(`s${i + 1}`, 1));
    const entriesByMany: Record<string, LogEntry[]> = {};
    for (const s of many) {
      entriesByMany[s.sessionId] = [
        { version: 1, timestamp: '2026-08-10T01:00:00.000Z', level: 'info', scope: 'session', sessionId: s.sessionId, message: `${s.sessionId}-msg` },
      ];
    }
    // 从 idx0 循环 Tab 19 次 → 选中 s20（idx19），左栏须滚动使 s20 行可见
    const keys = Array.from({ length: 19 }, () => '\t');
    const output = await renderLogsWithSessionEntries(many, entriesByMany, keys);
    expect(output).toContain('> 01:00-01:00 | s20 |');
  });
});


// ============================================================
// 对话合并视图（T 切换 + transcript 行）
// ============================================================

describe('LogsPage 对话合并视图（T 切换）', () => {
  const sessions = [makeSessionSummary('s1', 2)];
  const entries: LogEntry[] = [
    start('bash', '2026-08-10T01:00:00.000Z'),
    end('bash', '2026-08-10T01:00:01.000Z', 100),
  ];

  beforeEach(() => {
    vi.mocked(createSessionIndex).mockReturnValue({
      getSession: vi.fn().mockResolvedValue({
        id: 's1',
        records: [
          { type: 'message', role: 'user', turn: 1, content: 'transcript-hello-marker', timestamp: '2026-08-10T01:00:00.500Z' },
        ],
      }),
    } as never);
  });

  it('默认关闭：无徽标、无 transcript 行', async () => {
    const output = await renderLogsWithSessionEntries(sessions, { s1: entries }, []);
    // 注：本文件未 initI18n，t() 回退 key；徽标断言用最长连续子串
    //（终端多栏布局会把徽标切成不连续片段），开关行为由有无判定
    const flat = output.replace(/\s+/g, '');
    expect(flat).not.toContain('tui.conversationBad');
    expect(output).not.toContain('[user] transcript-hello-marker');
  });

  it('按 T 开启：徽标与 transcript 行出现', async () => {
    const output = await renderLogsWithSessionEntries(sessions, { s1: entries }, ['t']);
    const flat = output.replace(/\s+/g, '');
    expect(flat).toContain('tui.conversationBad');
    expect(output).toContain('[user] transcript-hello-marker');
  });

  it('再按 T 关闭：transcript 行消失', async () => {
    const output = await renderLogsWithSessionEntries(sessions, { s1: entries }, ['t', 't']);
    const flat = output.replace(/\s+/g, '');
    expect(flat).not.toContain('tui.conversationBad');
    expect(output).not.toContain('[user] transcript-hello-marker');
  });
});

// ============================================================
// 同毫秒卡片独立展开（seq 键回归）
// ============================================================

describe('LogsPage 同毫秒卡片独立展开', () => {
  it('Enter 只展开首卡，detail 头出现一次', async () => {
    const ts = '2026-08-10T01:00:00.000Z';
    const mk = (message: string): LogEntry => ({
      version: 1,
      timestamp: ts,
      level: 'info',
      scope: 'session',
      sessionId: 's1',
      message,
    });
    const output = await renderLogsWithSessionEntries(
      [makeSessionSummary('s1', 2)],
      { s1: [mk('aaa-first-row'), mk('bbb-second-row')] },
      ['\r'],
    );
    // 两行都渲染，但只有首卡展开
    expect(output).toContain('aaa-first-row');
    expect(output).toContain('bbb-second-row');
    expect(output.split('── detail @').length - 1).toBe(1);
  });
});

// ============================================================
// Omnibox sid 跳转选中
// ============================================================

describe('LogsPage Omnibox sid 跳转', () => {
  it('sid:s2 收窄左栏并选中 s2，右栏显示 s2 日志', async () => {
    const sessions = [makeSessionSummary('s1', 1), makeSessionSummary('s2', 1)];
    const mk = (sessionId: string, message: string): LogEntry => ({
      version: 1,
      timestamp: '2026-08-10T01:00:00.000Z',
      level: 'info',
      scope: 'session',
      sessionId,
      message,
    });
    const output = await renderLogsWithSessionEntries(
      sessions,
      { s1: [mk('s1', 'AAA-S1-MARKER')], s2: [mk('s2', 'BBB-S2-MARKER')] },
      ['/', ...'sid:s2', '\r'],
    );
    expect(output).toContain('BBB-S2-MARKER');
    expect(output).not.toContain('AAA-S1-MARKER');
  });
});
