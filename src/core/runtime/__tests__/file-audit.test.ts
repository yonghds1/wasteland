/**
 * file-audit.test.ts - 验证 checkReadBeforeEdit 走新 logger 调用
 *
 * 覆盖：Logger 被调（allowed / denied / skipped 分支），sessionId 透传。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Logger, LogBus, MemorySink } from '../../logger/index.js';
import type { LogSink } from '../../logger/memory-sink.js';
import { checkReadBeforeEdit } from '../file-audit.js';
import type { TurnState } from '../turn-state.js';

function makeTurnState(calls: Array<{ toolName: string; input: Record<string, unknown> }>): TurnState {
  return {
    sessionId: 'test-session',
    turn: 1,
    cwd: '/tmp',
    input: { turn: 1, content: '', source: 'message' },
    history: [],
    step: 1,
    status: 'running',
    assistantChunks: [],
    toolCalls: calls.map((c, i) => ({
      id: `c${i}`,
      toolName: c.toolName,
      input: c.input,
    })),
    toolResults: [],
  };
}

describe('file-audit logger integration', () => {
  let bus: LogBus;
  let sink: MemorySink;

  beforeEach(() => {
    bus = new LogBus();
    sink = new MemorySink();
    bus.subscribe(sink as LogSink);
    Logger.setBus(bus);
    Logger.setLevel('debug');
  });

  afterEach(() => {
    Logger.reset();
  });

  it('logs "skipped" for non-edit / non-write tools', () => {
    const spy = vi.spyOn(Logger, 'debug');
    const state = makeTurnState([]);
    const result = checkReadBeforeEdit({
      toolName: 'read-file',
      filePath: 'foo.txt',
      turnState: state,
      sessionId: 's1',
      turn: 3,
    });
    expect(result.ok).toBe(true);
    const fileCalls = spy.mock.calls.filter(
      (c) => (c[0] as { scope?: string }).scope === 'file',
    );
    expect(fileCalls.length).toBe(1);
    expect((fileCalls[0][0] as { message: string }).message).toBe(
      'file.read-before-edit.skipped',
    );
    spy.mockRestore();
  });

  it('logs "allowed" when file was read in current turn', () => {
    const spy = vi.spyOn(Logger, 'info');
    const state = makeTurnState([
      { toolName: 'read-file', input: { path: 'foo.txt' } },
    ]);
    const result = checkReadBeforeEdit({
      toolName: 'edit-file',
      filePath: 'foo.txt',
      turnState: state,
      sessionId: 's1',
      turn: 1,
    });
    expect(result.ok).toBe(true);
    const fileCalls = spy.mock.calls.filter(
      (c) => (c[0] as { scope?: string }).scope === 'file',
    );
    expect(fileCalls.length).toBe(1);
    expect((fileCalls[0][0] as { message: string }).message).toBe(
      'file.read-before-edit.allowed',
    );
    spy.mockRestore();
  });

  it('logs "denied" when file was not read in current turn', () => {
    const spy = vi.spyOn(Logger, 'warn');
    const state = makeTurnState([]);
    const result = checkReadBeforeEdit({
      toolName: 'write-file',
      filePath: 'foo.txt',
      turnState: state,
      sessionId: 's2',
      turn: 2,
    });
    expect(result.ok).toBe(false);
    const fileCalls = spy.mock.calls.filter(
      (c) => (c[0] as { scope?: string }).scope === 'file',
    );
    expect(fileCalls.length).toBe(1);
    expect((fileCalls[0][0] as { message: string }).message).toBe(
      'file.read-before-edit.denied',
    );
    expect((fileCalls[0][0] as { sessionId: string }).sessionId).toBe('s2');
    spy.mockRestore();
  });

  it('does not throw when sessionId / turn are absent', () => {
    const state = makeTurnState([]);
    const result = checkReadBeforeEdit({
      toolName: 'bash',
      filePath: 'foo.txt',
      turnState: state,
    });
    expect(result.ok).toBe(true);
  });
});
