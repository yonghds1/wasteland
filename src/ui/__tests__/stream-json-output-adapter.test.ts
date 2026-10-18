import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { from, throwError } from 'rxjs';
import { StreamJsonOutputAdapter } from '../stream-json-output-adapter.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';

describe('StreamJsonOutputAdapter', () => {
  it('正确将各 RuntimeEvent 序列化为符合协议的 JSONL', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = [];

    stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      text.trim().split('\n').forEach((l) => {
        if (l) lines.push(l);
      });
    });

    const onTurnComplete = vi.fn();
    const adapter = new StreamJsonOutputAdapter({ stdout, stderr, onTurnComplete });

    const events: RuntimeEvent[] = [
      { type: 'session_started', sessionId: 'sess-1', sessionPath: '/tmp/s1', mode: 'single' },
      { type: 'user_turn', sessionId: 'sess-1', turn: 1, content: 'hi', source: 'message' },
      { type: 'assistant_chunk', sessionId: 'sess-1', turn: 1, chunk: '<think>thinking hard</think>final answer' },
      { type: 'tool_call_requested', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'permission_decision', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', decision: 'allow', reason: 'ok', mode: 'default' },
      { type: 'tool_started', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash' },
      { type: 'tool_result', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', status: 'success', output: 'file1' },
      { type: 'tool_failed', sessionId: 'sess-1', turn: 1, callId: 'c2', toolName: 'bash', status: 'error', error: 'boom' },
      {
        type: 'usage_update',
        sessionId: 'sess-1',
        turn: 1,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        timing: { ttftMs: 100, totalMs: 500, tokensPerSec: 40 },
      },
      { type: 'assistant_message', sessionId: 'sess-1', turn: 1, content: 'final answer' },
      { type: 'session_ended', sessionId: 'sess-1', finishReason: 'stop' },
    ];

    await adapter.handleEvents(from(events));

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed).toEqual([
      { type: 'session_start', sessionId: 'sess-1', sessionPath: '/tmp/s1', mode: 'single' },
      { type: 'turn_start', sessionId: 'sess-1', turn: 1, content: 'hi', source: 'message' },
      { type: 'thinking_delta', sessionId: 'sess-1', turn: 1, delta: 'thinking hard' },
      { type: 'text_delta', sessionId: 'sess-1', turn: 1, delta: 'final answer' },
      { type: 'tool_call', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', input: { command: 'ls' } },
      { type: 'permission_decision', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', decision: 'allow', reason: 'ok', mode: 'default' },
      { type: 'tool_started', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash' },
      { type: 'tool_result', sessionId: 'sess-1', turn: 1, callId: 'c1', toolName: 'bash', status: 'success', output: 'file1' },
      { type: 'tool_result', sessionId: 'sess-1', turn: 1, callId: 'c2', toolName: 'bash', status: 'error', error: 'boom' },
      {
        type: 'usage',
        sessionId: 'sess-1',
        turn: 1,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        timing: { ttftMs: 100, totalMs: 500, tokensPerSec: 40 },
      },
      { type: 'turn_end', sessionId: 'sess-1', turn: 1, content: 'final answer' },
      { type: 'session_ended', sessionId: 'sess-1', finishReason: 'stop' },
    ]);
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
  });

  it('跨 chunk 的思考标签正确拆分', async () => {
    const stdout = new PassThrough();
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => {
      c.toString('utf-8').trim().split('\n').forEach((l) => { if (l) lines.push(l); });
    });

    const adapter = new StreamJsonOutputAdapter({ stdout });
    const events: RuntimeEvent[] = [
      { type: 'assistant_chunk', sessionId: 's1', turn: 1, chunk: '<think>step 1 ' },
      { type: 'assistant_chunk', sessionId: 's1', turn: 1, chunk: 'step 2</think>' },
      { type: 'assistant_chunk', sessionId: 's1', turn: 1, chunk: 'answer' },
    ];

    await adapter.handleEvents(from(events));

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed).toEqual([
      { type: 'thinking_delta', sessionId: 's1', turn: 1, delta: 'step 1 ' },
      { type: 'thinking_delta', sessionId: 's1', turn: 1, delta: 'step 2' },
      { type: 'text_delta', sessionId: 's1', turn: 1, delta: 'answer' },
    ]);
  });

  it('未知/内部事件不输出到 stdout', async () => {
    const stdout = new PassThrough();
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => {
      lines.push(c.toString('utf-8'));
    });

    const adapter = new StreamJsonOutputAdapter({ stdout });
    await adapter.handleEvents(from([{
      type: 'agent_spawned',
      parentId: 'p1',
      childId: 'c1',
      childSessionPath: '/p',
      name: 'worker',
      task: 'do job',
    } as RuntimeEvent]));

    expect(lines).toHaveLength(0);
  });

  it('流异常时记录 stderr 并拒绝 Promise', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stderrOutput = '';
    stderr.on('data', (c: Buffer) => {
      stderrOutput += c.toString('utf-8');
    });

    const adapter = new StreamJsonOutputAdapter({ stdout, stderr });
    await expect(adapter.handleEvents(throwError(() => new Error('stream broke')))).rejects.toThrow('stream broke');
    expect(stderrOutput).toContain('stream broke');
  });
});
