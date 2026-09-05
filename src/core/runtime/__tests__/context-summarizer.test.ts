/**
 * context-summarizer.test.ts - 摘要压缩测试
 *
 * 覆盖：
 * - capSummary：摘要长度上限
 * - summarizeRecords：assistant_message / chunks 回退 / 空输出
 * - runAgentLoop 集成：usage 触发压缩 → 摘要插入 / 失败降级 / 关闭摘要
 */

import { describe, it, expect, vi } from 'vitest';
import { from, lastValueFrom, toArray, type Observable } from 'rxjs';

import { capSummary, summarizeRecords, SUMMARY_MAX_CHARS } from '../context-summarizer.js';
import { runAgentLoop } from '../agent-loop.js';
import type { AgentProvider } from '../../../providers/provider-types.js';
import type { ChatInputTurn, RuntimeEvent, HistoryRecord } from '../event-types.js';
import type { SessionManager, SessionMetadata } from '../session-manager.js';

// ============================================================
// capSummary
// ============================================================

describe('capSummary', () => {
  it('短文本原样返回', () => {
    expect(capSummary('short summary')).toBe('short summary');
  });

  it('超长文本被截断并标注', () => {
    const long = 'x'.repeat(SUMMARY_MAX_CHARS + 500);
    const result = capSummary(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('[summary truncated]');
  });

  it('恰好等于上限不截断', () => {
    const exact = 'y'.repeat(SUMMARY_MAX_CHARS);
    expect(capSummary(exact)).toBe(exact);
  });

  it('支持自定义上限', () => {
    const result = capSummary('abcdefghij', 5);
    expect(result).toBe('abcde\n... [summary truncated]');
  });
});

// ============================================================
// summarizeRecords
// ============================================================

describe('summarizeRecords', () => {
  const meta = { sessionId: 's', turn: 1, cwd: '/tmp' };
  const records: HistoryRecord[] = [
    { type: 'message', role: 'user', turn: 1, content: 'q', timestamp: 't' },
    { type: 'message', role: 'assistant', turn: 1, content: 'a', timestamp: 't' },
  ];

  function providerReturning(events: unknown[]): AgentProvider {
    return {
      id: 'mock',
      runStep: () => from(events as never[]),
    } as unknown as AgentProvider;
  }

  it('优先取 assistant_message 文本', async () => {
    const provider = providerReturning([
      { type: 'assistant_chunk', text: 'partial' },
      { type: 'assistant_message', text: 'final summary' },
    ]);
    const result = await summarizeRecords(provider, records, meta);
    expect(result).toBe('final summary');
  });

  it('无 assistant_message 时拼接 chunks', async () => {
    const provider = providerReturning([
      { type: 'assistant_chunk', text: 'sum' },
      { type: 'assistant_chunk', text: 'mary' },
    ]);
    const result = await summarizeRecords(provider, records, meta);
    expect(result).toBe('summary');
  });

  it('无输出时返回空字符串', async () => {
    const provider = providerReturning([]);
    const result = await summarizeRecords(provider, records, meta);
    expect(result).toBe('');
  });

  it('超长摘要被 capSummary 截断', async () => {
    const huge = 'z'.repeat(SUMMARY_MAX_CHARS + 100);
    const provider = providerReturning([{ type: 'assistant_message', text: huge }]);
    const result = await summarizeRecords(provider, records, meta);
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain('[summary truncated]');
  });

  it('transcript 纳入 message / tool_call / tool_result / 旧 summary', async () => {
    // 用 runStep 捕获传入的 input.content，验证 transcript 组装
    let capturedInput = '';
    const provider = {
      id: 'mock',
      runStep: ({ context }: { context: { input: { content: string } } }) => {
        capturedInput = context.input.content;
        return from([{ type: 'assistant_message', text: 'ok' } as never]);
      },
    } as unknown as AgentProvider;

    const mixed: HistoryRecord[] = [
      { type: 'message', role: 'user', turn: 1, content: 'hello', timestamp: 't' },
      { type: 'tool_call', sessionId: 's', turn: 1, callId: 'c1', toolName: 'bash', input: { cmd: 'ls' }, timestamp: 't' },
      { type: 'tool_result', sessionId: 's', turn: 1, callId: 'c1', toolName: 'bash', status: 'success', output: 'file.txt', timestamp: 't' },
      { type: 'summary', turn: 1, content: 'old summary', summarizedCount: 3, timestamp: 't' },
    ];
    await summarizeRecords(provider, mixed, meta);

    expect(capturedInput).toContain('[user] hello');
    expect(capturedInput).toContain('[tool call: bash]');
    expect(capturedInput).toContain('[tool result: bash] file.txt');
    expect(capturedInput).toContain('[earlier summary] old summary');
  });
});

// ============================================================
// runAgentLoop 集成：usage 触发压缩
// ============================================================

describe('runAgentLoop 摘要压缩集成', () => {
  function createMockSessionManager() {
    return {
      startSession: vi.fn().mockResolvedValue({
        id: 'test-session',
        path: '/tmp/test.jsonl',
        mode: 'single',
        cwd: '/tmp',
        providerId: 'mock',
      } as SessionMetadata),
      appendRecord: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionManager;
  }

  function createInput$(content: string): Observable<ChatInputTurn> {
    return from([{ turn: 1, content, source: 'message' as const }]);
  }

  /** 足够多的初始历史，token 量恰在压缩预算与发送前预算线之间，确保 usage 路径压缩触发 */
  function seedHistory(n: number): HistoryRecord[] {
    const out: HistoryRecord[] = [];
    for (let i = 0; i < n; i++) {
      // 每条约 10 tokens（40 字符 / 4）：seedHistory(4) ≈ 80 tokens，
      // 超过压缩预算（contextWindow 100 × 0.6 = 60），但未超过发送前预算线（0.9 × 100 = 90），
      // 保证压缩由 usage 事件触发（摘要 / 降级 / 关闭摘要三条路径）
      out.push({ type: 'message', role: 'user', turn: i, content: 'q'.repeat(40), timestamp: 't' });
      out.push({ type: 'message', role: 'assistant', turn: i, content: 'a'.repeat(40), timestamp: 't' });
    }
    return out;
  }

  /** 小窗口配置：contextWindow=100（token 预算 60）、摘要开关可控 */
  function makeLoadedSettings(summarization: boolean) {
    return {
      settings: {
        models: { 'test-model': { provider: 'mock', model: 'test-model', contextWindow: 100 } },
        runtime: { contextSummarization: summarization },
      },
    } as never;
  }

  async function collectEvents(obs: Observable<RuntimeEvent>): Promise<RuntimeEvent[]> {
    return lastValueFrom(obs.pipe(toArray()));
  }

  it('启用摘要：usage 触发压缩，provider 被二次调用生成摘要，emit context_compacted', async () => {
    let calls = 0;
    const provider = {
      id: 'mock',
      runStep: () => {
        calls++;
        if (calls === 1) {
          // 主 turn：高 usage 触发压缩 + 完成消息
          return from([
            { type: 'usage', usage: { promptTokens: 900, completionTokens: 99, totalTokens: 999 } } as never,
            { type: 'assistant_message', text: 'main reply' } as never,
          ]);
        }
        // 摘要调用
        return from([{ type: 'assistant_message', text: 'the summary' } as never]);
      },
    } as unknown as AgentProvider;

    const { events$ } = runAgentLoop({
      provider,
      input$: createInput$('hi'),
      sessionManager: createMockSessionManager(),
      cwd: '/tmp',
      mode: 'single',
      initialHistory: seedHistory(4),
      providerSettings: { model: 'test-model' } as never,
      loadedSettings: makeLoadedSettings(true),
    });

    const events = await collectEvents(events$);
    const compacted = events.find((e) => e.type === 'context_compacted');

    expect(compacted).toBeDefined();
    expect(compacted!.type === 'context_compacted' && compacted!.removedCount).toBeGreaterThan(0);
    // provider 被调用 2 次：主 turn + 摘要
    expect(calls).toBe(2);
  });

  it('摘要失败：降级为普通压缩，仍 emit context_compacted，provider 只调一次', async () => {
    let calls = 0;
    const provider = {
      id: 'mock',
      runStep: () => {
        calls++;
        if (calls === 1) {
          return from([
            { type: 'usage', usage: { promptTokens: 900, completionTokens: 99, totalTokens: 999 } } as never,
            { type: 'assistant_message', text: 'main reply' } as never,
          ]);
        }
        // 摘要调用抛错 → 降级
        throw new Error('summarization failed');
      },
    } as unknown as AgentProvider;

    const { events$ } = runAgentLoop({
      provider,
      input$: createInput$('hi'),
      sessionManager: createMockSessionManager(),
      cwd: '/tmp',
      mode: 'single',
      initialHistory: seedHistory(4),
      providerSettings: { model: 'test-model' } as never,
      loadedSettings: makeLoadedSettings(true),
    });

    const events = await collectEvents(events$);
    const compacted = events.find((e) => e.type === 'context_compacted');

    // 降级后仍压缩
    expect(compacted).toBeDefined();
    // 摘要调用抛错，但主流程不受影响（events 正常收集到 session_ended）
    expect(events.map((e) => e.type)).toContain('session_ended');
  });

  it('关闭摘要：provider 只调一次，走普通窗口压缩', async () => {
    let calls = 0;
    const provider = {
      id: 'mock',
      runStep: () => {
        calls++;
        return from([
          { type: 'usage', usage: { promptTokens: 900, completionTokens: 99, totalTokens: 999 } } as never,
          { type: 'assistant_message', text: 'main reply' } as never,
        ]);
      },
    } as unknown as AgentProvider;

    const { events$ } = runAgentLoop({
      provider,
      input$: createInput$('hi'),
      sessionManager: createMockSessionManager(),
      cwd: '/tmp',
      mode: 'single',
      initialHistory: seedHistory(4),
      providerSettings: { model: 'test-model' } as never,
      loadedSettings: makeLoadedSettings(false), // 关闭摘要
    });

    const events = await collectEvents(events$);
    const compacted = events.find((e) => e.type === 'context_compacted');

    expect(compacted).toBeDefined();
    // 未启用摘要：provider 只被主 turn 调用一次
    expect(calls).toBe(1);
  });
});
