/**
 * message-builder-reasoning.test.ts - R-3：历史重建按源字段名回传 reasoning
 *
 * 纯函数级测试（不起 Ink、不发网络），覆盖 PRD R-5 第 1 项：
 * - 旧记录（无 reasoning）零回归：序列化结果与改前逐字节一致
 * - user 消息不造字段
 * - history assistant message 带 reasoning → 原 key 原值
 * - history tool_call 带 reasoning → 挂到合并/新建的 assistant 消息，同 step 只挂一次
 * - intra-turn toolResults（section-3）→ 按 field 去重后挂载
 * - 混合 field → 各通道都挂上
 */

import { describe, it, expect } from 'vitest';
import { buildMessages } from '../message-builder.js';
import type { HistoryRecord } from '@core/runtime/event-types.js';
import type { TurnToolResult } from '@core/engine/turn-state.js';

type Msg = Record<string, unknown>;

function assistantMessageRecord(overrides: Partial<Msg> = {}): HistoryRecord {
  return {
    type: 'message',
    role: 'assistant',
    turn: 1,
    content: 'hi',
    timestamp: '2026-09-13T00:00:00.000Z',
    ...overrides,
  } as unknown as HistoryRecord;
}

function toolCallRecord(overrides: Partial<Msg> = {}): HistoryRecord {
  return {
    type: 'tool_call',
    sessionId: 's1',
    turn: 2,
    callId: 'call_1',
    toolName: 'read_file',
    input: { path: 'a.ts' },
    timestamp: '2026-09-13T00:00:00.000Z',
    ...overrides,
  } as unknown as HistoryRecord;
}

const toolResult = (overrides: Partial<TurnToolResult> = {}): TurnToolResult => ({
  callId: 'call_x',
  toolName: 'read_file',
  input: { path: 'a.ts' },
  status: 'success',
  output: 'file body',
  ...overrides,
});

describe('buildMessages - reasoning 字面回传 (R-3)', () => {
  it('旧记录（无 reasoning）序列化与改前逐字节一致', () => {
    const messages = buildMessages({
      history: [assistantMessageRecord({ content: 'hi' })],
      input: 'next',
      toolResults: [],
    });
    const assistant = messages.find((m) => (m as Msg).role === 'assistant');
    expect(JSON.stringify(assistant)).toBe('{"role":"assistant","content":"hi"}');
    // 没有多余的 key（连 undefined 都不该有）
    expect(Object.keys(assistant as object)).toEqual(['role', 'content']);
  });

  it('user 记录即使附带 reasoning 也不造字段（防御性）', () => {
    const messages = buildMessages({
      history: [
        {
          type: 'message',
          role: 'user',
          turn: 1,
          content: 'hello',
          timestamp: 'x',
          reasoning: { field: 'reasoning_content', content: 'should be ignored' },
        } as unknown as HistoryRecord,
      ],
      input: 'next',
      toolResults: [],
    });
    const userMsg = messages.find((m) => (m as Msg).role === 'user' && (m as Msg).content === 'hello');
    expect(userMsg).toBeDefined();
    expect('reasoning_content' in (userMsg as object)).toBe(false);
  });

  it('history assistant message 带 reasoning → 原 key 原值放回', () => {
    const messages = buildMessages({
      history: [
        assistantMessageRecord({
          content: 'body',
          reasoning: { field: 'reasoning_content', content: 'think...' },
        }),
      ],
      input: 'next',
      toolResults: [],
    });
    const assistant = messages.find((m) => (m as Msg).role === 'assistant') as Msg;
    expect(assistant.reasoning_content).toBe('think...');
    expect(assistant.content).toBe('body');
    // 其它两个变体不该被凭空造出来
    expect('reasoning' in assistant).toBe(false);
    expect('thought' in assistant).toBe(false);
  });

  it('history tool_call 带 reasoning → 新建 assistant tool_calls 消息挂字段', () => {
    const messages = buildMessages({
      history: [
        toolCallRecord({ reasoning: { field: 'reasoning_content', content: 'r1' } }),
      ],
      input: 'next',
      toolResults: [],
    });
    const assistant = messages.find(
      (m) => (m as Msg).role === 'assistant' && (m as Msg).tool_calls
    ) as Msg;
    expect(assistant.reasoning_content).toBe('r1');
    expect(assistant.content).toBeNull();
  });

  it('同一步连续两条 tool_call 记录同 reasoning → 合并进一条 assistant 且只挂一次', () => {
    const messages = buildMessages({
      history: [
        toolCallRecord({
          callId: 'call_a',
          reasoning: { field: 'reasoning_content', content: 'r1' },
        }),
        toolCallRecord({
          callId: 'call_b',
          toolName: 'list_dir',
          input: { dir: '.' },
          reasoning: { field: 'reasoning_content', content: 'r1' },
        }),
      ],
      input: 'next',
      toolResults: [],
    });
    const assistantMsgs = messages.filter((m) => (m as Msg).role === 'assistant' && (m as Msg).tool_calls);
    expect(assistantMsgs).toHaveLength(1);
    const assistant = assistantMsgs[0] as Msg;
    expect((assistant.tool_calls as unknown[])).toHaveLength(2);
    // reasoning_content key 只出现一次，值不被第二条覆写成不同东西
    expect(assistant.reasoning_content).toBe('r1');
    expect(Object.keys(assistant).filter((k) => k === 'reasoning_content')).toHaveLength(1);
  });

  it('intra-turn toolResults（section-3）按 field 去重后挂载', () => {
    const r = { field: 'reasoning', content: 'r1' };
    const messages = buildMessages({
      history: [],
      input: 'go',
      toolResults: [
        toolResult({ callId: 'call_a', reasoning: r }),
        toolResult({ callId: 'call_b', toolName: 'list_dir', reasoning: r }),
      ],
    });
    const assistant = messages.find(
      (m) => (m as Msg).role === 'assistant' && (m as Msg).tool_calls
    ) as Msg;
    // 字段名 = 记录里的 field，这里是 'reasoning'
    expect(assistant.reasoning).toBe('r1');
    expect('reasoning_content' in assistant).toBe(false);
    expect(Object.keys(assistant).filter((k) => k === 'reasoning')).toHaveLength(1);
  });

  it('混合 field 的 toolResults → 两个通道都挂上', () => {
    const messages = buildMessages({
      history: [],
      input: 'go',
      toolResults: [
        toolResult({ callId: 'call_a', reasoning: { field: 'reasoning', content: 'r-a' } }),
        toolResult({ callId: 'call_b', toolName: 'list_dir', reasoning: { field: 'thought', content: 'r-b' } }),
      ],
    });
    const assistant = messages.find(
      (m) => (m as Msg).role === 'assistant' && (m as Msg).tool_calls
    ) as Msg;
    expect(assistant.reasoning).toBe('r-a');
    expect(assistant.thought).toBe('r-b');
  });

  it('reasoning.content 为空串时不回传（绝不凭空造上游没发过的字段）', () => {
    const messages = buildMessages({
      history: [
        assistantMessageRecord({
          content: 'body',
          reasoning: { field: 'reasoning_content', content: '' },
        }),
      ],
      input: 'next',
      toolResults: [],
    });
    const assistant = messages.find((m) => (m as Msg).role === 'assistant') as Msg;
    expect(Object.keys(assistant)).toEqual(['role', 'content']);
    expect('reasoning_content' in assistant).toBe(false);
  });

  it('无 reasoning 的 toolResults → section-3 assistant 消息与改前一致（仅 role/content/tool_calls）', () => {
    const messages = buildMessages({
      history: [],
      input: 'go',
      toolResults: [toolResult({ callId: 'call_a' })],
    });
    const assistant = messages.find(
      (m) => (m as Msg).role === 'assistant' && (m as Msg).tool_calls
    ) as Msg;
    expect(Object.keys(assistant)).toEqual(['role', 'content', 'tool_calls']);
  });
});
