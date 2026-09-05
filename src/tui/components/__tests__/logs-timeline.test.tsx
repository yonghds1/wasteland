/**
 * logs-page.test.tsx - LogsPage 时间线视图测试
 *
 * 覆盖验收标准：
 * - 视图切换（toggleLogsView 纯逻辑 + LogsPage 初始视图渲染）
 * - buildToolTimeline 聚合：成功/失败状态、耗时、错误信息
 * - 健壮性：toolEnd 与 toolStart 不配对时的降级显示
 * - ToolTimeline 渲染：toolName / 耗时 / 状态 / 错误高亮
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { renderToString } from 'ink';
import { Logger, MemorySink, type LogSink } from '@core/logger/index.js';
import { LogBus } from '@core/logger/log-bus.js';
import { dispatchToolCall } from '../../../core/runtime/tool-dispatch.js';
import { SessionManager, type SessionMetadata } from '../../../core/runtime/session-manager.js';
import { createInitialTurnState, type TurnState } from '../../../core/runtime/turn-state.js';
import { ToolRegistry } from '../../../tools/tool-registry.js';
import { createPermissionGate } from '../../../core/runtime/permission-gate.js';
import type { ToolCall, ToolExecutionResult } from '../../../tools/tool-types.js';
import {
  buildToolTimeline,
  ToolTimeline,
  type ToolCallRecord
} from '../ToolTimeline.js';
import {
  GlobalTimeline,
  GlobalStatsTable,
  type GlobalToolCallRecord,
  type ToolCallStats
} from '../GlobalTimeline.js';
import {
  start,
  end,
  err,
  nonToolEntry
} from './logs-test-helpers.js';

describe('buildToolTimeline', () => {
  it('pairs start/end into a success call with event durationMs', () => {
    const timeline = buildToolTimeline([
      start('bash', '2026-08-10T01:00:00.000Z'),
      end('bash', '2026-08-10T01:00:01.000Z', 450),
    ]);
    expect(timeline).toEqual([
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:00:00.000Z',
        endTime: '2026-08-10T01:00:01.000Z',
        durationMs: 450,
        status: 'success',
      },
    ]);
  });

  it('marks failed calls with error status and errorMessage', () => {
    const timeline = buildToolTimeline([
      start('edit-file', '2026-08-10T01:00:00.000Z'),
      err('edit-file', '2026-08-10T01:00:00.500Z', 'file not found', 500),
    ]);
    expect(timeline).toHaveLength(1);
    expect(timeline).toMatchObject([
      { status: 'error', durationMs: 500, errorMessage: 'file not found' },
    ]);
  });

  it('keeps started calls without an end event as started with no duration', () => {
    const timeline = buildToolTimeline([start('bash', '2026-08-10T01:00:00.000Z')]);
    expect(timeline).toEqual([
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:00:00.000Z',
        status: 'started',
      },
    ]);
    expect(timeline[0]).not.toHaveProperty('durationMs');
  });

  it('creates orphan record when end arrives without a matching start', () => {
    const timeline = buildToolTimeline([
      end('bash', '2026-08-10T01:00:00.000Z', 123),
    ]);
    expect(timeline).toEqual([
      {
        toolName: 'bash',
        endTime: '2026-08-10T01:00:00.000Z',
        durationMs: 123,
        status: 'success',
      },
    ]);
  });

  it('creates orphan error record when error has no matching start', () => {
    const timeline = buildToolTimeline([
      err('bash', '2026-08-10T01:00:00.000Z', 'boom', 50),
    ]);
    expect(timeline).toMatchObject([
      { status: 'error', durationMs: 50, errorMessage: 'boom' },
    ]);
    expect(timeline[0]).not.toHaveProperty('startTime');
  });

  it('falls back to timestamp-derived duration when durationMs is missing', () => {
    const timeline = buildToolTimeline([
      start('bash', '2026-08-10T01:00:00.000Z'),
      end('bash', '2026-08-10T01:00:01.250Z'),
    ]);
    expect(timeline).toMatchObject([{ durationMs: 1250 }]);
  });

  it('pairs overlapping same-tool calls FIFO', () => {
    const timeline = buildToolTimeline([
      start('bash', '2026-08-10T01:00:00.000Z'),
      start('bash', '2026-08-10T01:00:01.000Z'),
      end('bash', '2026-08-10T01:00:02.000Z', 100),
      end('bash', '2026-08-10T01:00:03.000Z', 200),
    ]);
    expect(timeline.map((r) => [r.startTime, r.durationMs])).toEqual([
      ['2026-08-10T01:00:00.000Z', 100],
      ['2026-08-10T01:00:01.000Z', 200],
    ]);
  });

  it('orders records chronologically by start time', () => {
    const timeline = buildToolTimeline([
      start('grep', '2026-08-10T01:00:02.000Z'),
      start('bash', '2026-08-10T01:00:00.000Z'),
      end('bash', '2026-08-10T01:00:01.000Z', 100),
      end('grep', '2026-08-10T01:00:03.000Z', 100),
    ]);
    expect(timeline.map((r) => r.toolName)).toEqual(['bash', 'grep']);
  });

  it('ignores non-tool entries', () => {
    const timeline = buildToolTimeline([
      nonToolEntry('2026-08-10T01:00:00.000Z'),
      start('bash', '2026-08-10T01:00:01.000Z'),
      end('bash', '2026-08-10T01:00:02.000Z', 10),
    ]);
    expect(timeline).toHaveLength(1);
    expect(timeline).toMatchObject([{ toolName: 'bash' }]);
  });

  it('is not affected by input order (sorts by timestamp)', () => {
    const timeline = buildToolTimeline([
      end('bash', '2026-08-10T01:00:01.000Z', 100),
      start('bash', '2026-08-10T01:00:00.000Z'),
    ]);
    expect(timeline).toMatchObject([{ status: 'success', durationMs: 100 }]);
  });
});

// ============================================================
// formatDuration / formatToolTime
// ============================================================


describe('ToolTimeline rendering', () => {
  it('renders toolName, duration and success status', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:04.000Z',
        durationMs: 1000,
        status: 'success',
      },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(output).toContain('bash');
    expect(output).toContain('1s');
    expect(output).toContain('success');
    expect(output).toContain('✓');
  });

  it('highlights failed calls with error color and message', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'edit-file',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:03.500Z',
        durationMs: 500,
        status: 'error',
        errorMessage: 'file not found',
      },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(output).toContain('edit-file');
    expect(output).toContain('500ms');
    expect(output).toContain('error');
    expect(output).toContain('file not found');
  });

  it('annotates started (incomplete) calls', () => {
    const records: ToolCallRecord[] = [
      { toolName: 'bash', startTime: '2026-08-10T01:02:03.000Z', status: 'started' },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(output).toContain('bash');
    expect(output).toContain('--');
    expect(output).toContain('started');
    expect(output).toContain('incomplete');
  });

  it('shows empty state when there are no records', () => {
    const output = renderToString(<ToolTimeline records={[]} />, { columns: 120 });
    expect(output).toContain('no tool calls');
  });
});

// ============================================================
// LogsPage 集成：初始视图渲染
// ============================================================


function makeDispatchSession(): SessionMetadata {
  return {
    id: 'test-session',
    path: '/tmp/test.jsonl',
    cwd: '/tmp',
    mode: 'single',
    providerId: 'local',
  };
}

function makeDispatchSessionManager(): SessionManager {
  const sm = Object.create(SessionManager.prototype);
  sm.appendRecord = async (): Promise<void> => {
    /* no-op */
  };
  return sm as SessionManager;
}

function makeDispatchTurnState(): TurnState {
  return createInitialTurnState({
    sessionId: 'test-session',
    input: { turn: 1, content: 'hi', source: 'message' },
    cwd: '/tmp',
    history: [],
  });
}

function makeDispatchCall(
  toolName: string,
  callId = 'call-1',
  input: Record<string, unknown> = {},
): ToolCall {
  return { id: callId, toolName, input };
}

describe('tool-dispatch → buildToolTimeline 集成（真实流程产出时间线）', () => {
  let memorySink: MemorySink;
  let bus: LogBus;

  beforeEach(() => {
    bus = new LogBus();
    Logger.setBus(bus);
    Logger.setLevel('debug');
    memorySink = new MemorySink();
    bus.subscribe(memorySink as LogSink);
  });

  afterEach(() => {
    Logger.reset();
  });

  it('成功工具调用产生 tool_start/tool_end 事件，聚合为 success 记录', async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'read-file',
      riskLevel: 'read',
      async execute(input): Promise<ToolExecutionResult> {
        await new Promise((r) => setTimeout(r, 2));
        return {
          status: 'success',
          output: `read ${(input as { path?: string }).path ?? ''}`,
        };
      },
    });

    const events$ = dispatchToolCall({
      session: makeDispatchSession(),
      sessionManager: makeDispatchSessionManager(),
      turn: 1,
      call: makeDispatchCall('read-file', 'c1', { path: 'package.json' }),
      registry: reg,
      permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
      cwd: '/tmp',
      turnState: makeDispatchTurnState(),
    });

    await firstValueFrom(events$.pipe(take(4), toArray()));

    const timeline = buildToolTimeline(memorySink.entries());
    expect(timeline).toHaveLength(1);
    expect(timeline).toMatchObject([{ toolName: 'read-file', status: 'success' }]);
    expect(timeline[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('失败工具调用产生 tool_error 事件，聚合为 error 记录并带错误消息', async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'flaky',
      riskLevel: 'read',
      async execute(): Promise<ToolExecutionResult> {
        return { status: 'error', error: 'boom' };
      },
    });

    const events$ = dispatchToolCall({
      session: makeDispatchSession(),
      sessionManager: makeDispatchSessionManager(),
      turn: 1,
      call: makeDispatchCall('flaky', 'c2'),
      registry: reg,
      permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
      cwd: '/tmp',
      turnState: makeDispatchTurnState(),
    });

    await firstValueFrom(events$.pipe(take(4), toArray()));

    const timeline = buildToolTimeline(memorySink.entries());
    expect(timeline).toMatchObject([
      { toolName: 'flaky', status: 'error', errorMessage: 'boom' },
    ]);
  });
});

// ============================================================
// T6：关键字搜索 + 过滤增强（纯函数）
// ============================================================


describe('ToolTimeline slow-call marking', () => {
  it('超过阈值的成功调用被标记 SLOW', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'read-large-file',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:11.000Z',
        durationMs: 8000,
        status: 'success',
      },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(output).toContain('SLOW');
    expect(output).toContain('8s');
    expect(output).toContain('✓ success');
  });

  it('正常调用（未超阈值）不被标记 SLOW', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:04.000Z',
        durationMs: 1000,
        status: 'success',
      },
      {
        toolName: 'grep',
        startTime: '2026-08-10T01:02:05.000Z',
        endTime: '2026-08-10T01:02:05.500Z',
        durationMs: 500,
        status: 'error',
        errorMessage: 'no match',
      },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(output).not.toContain('SLOW');
    // 正常/错误调用原有展示不受影响
    expect(output).toContain('✓ success');
    expect(output).toContain('✗ error');
    expect(output).toContain('no match');
  });

  it('阈值 prop 覆盖：低于默认但高于自定义阈值（100ms）的调用被标记', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:03.200Z',
        durationMs: 200,
        status: 'success',
      },
    ];
    const output = renderToString(
      <ToolTimeline records={records} slowThresholdMs={100} />,
      { columns: 120 },
    );
    expect(output).toContain('SLOW');
  });

  it('阈值 prop 覆盖：同一调用在更高阈值下不被标记', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'bash',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:05.000Z',
        durationMs: 2000,
        status: 'success',
      },
    ];
    // 默认 5000ms 下不算慢，但传更高阈值 10000ms 也不慢
    const defaultOutput = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    expect(defaultOutput).not.toContain('SLOW');
    const raisedOutput = renderToString(
      <ToolTimeline records={records} slowThresholdMs={10000} />,
      { columns: 120 },
    );
    expect(raisedOutput).not.toContain('SLOW');
  });

  it('慢调用与错误高亮共存：SLOW 标记与错误子行同时出现，互不干扰', () => {
    const records: ToolCallRecord[] = [
      {
        toolName: 'mcp-server',
        startTime: '2026-08-10T01:02:03.000Z',
        endTime: '2026-08-10T01:02:11.000Z',
        durationMs: 8000,
        status: 'error',
        errorMessage: 'timeout after 8s',
      },
    ];
    const output = renderToString(<ToolTimeline records={records} />, { columns: 120 });
    // 慢调用标记
    expect(output).toContain('SLOW');
    expect(output).toContain('8s');
    // 原有错误高亮（状态 + 错误子行）仍保留
    expect(output).toContain('✗ error');
    expect(output).toContain('timeout after 8s');
  });
});


describe('GlobalTimeline rendering', () => {
  it('renders sessionId, toolName, duration and success status', () => {
    const records: GlobalToolCallRecord[] = [
      {
        sessionId: 's1',
        toolName: 'bash',
        startTime: '2026-08-10T01:00:00.000Z',
        endTime: '2026-08-10T01:00:01.000Z',
        durationMs: 1000,
        status: 'success',
      },
    ];
    const output = renderToString(<GlobalTimeline records={records} />, { columns: 120 });
    expect(output).toContain('s1');
    expect(output).toContain('bash');
    expect(output).toContain('1s');
    expect(output).toContain('success');
  });

  it('highlights failed calls with error message', () => {
    const records: GlobalToolCallRecord[] = [
      {
        sessionId: 's2',
        toolName: 'read-file',
        durationMs: 50,
        status: 'error',
        errorMessage: 'ENOENT',
      },
    ];
    const output = renderToString(<GlobalTimeline records={records} />, { columns: 120 });
    expect(output).toContain('read-file');
    expect(output).toContain('ENOENT');
    expect(output).toContain('error');
  });

  it('shows empty state when no records', () => {
    const output = renderToString(<GlobalTimeline records={[]} />, { columns: 120 });
    expect(output).toContain('(no tool calls across sessions)');
  });
});

describe('GlobalStatsTable rendering', () => {
  it('renders tool stats with failed count', () => {
    const stats: ToolCallStats[] = [
      { toolName: 'bash', calls: 3, failed: 1, avgDurationMs: 150, maxDurationMs: 200, slowCalls: 0 },
    ];
    const output = renderToString(<GlobalStatsTable stats={stats} />, { columns: 120 });
    expect(output).toContain('bash');
    expect(output).toContain('calls');
    expect(output).toContain('failed');
    expect(output).toContain('1');
  });

  it('shows empty state when no stats', () => {
    const output = renderToString(<GlobalStatsTable stats={[]} />, { columns: 120 });
    expect(output).toContain('(no tool stats across sessions)');
  });
});

/**
 * 渲染 LogsPage 并逐个按键，但允许按 sessionId 提供不同的日志条目
 * （全局时间线跨 session 聚合测试用）。
 */
