/**
 * tool-reducer.test.ts - user_input_received → permission history decision 映射
 *
 * 覆盖 once/always/no 三种回答的 history 落点（allow / allow_always / deny）。
 */

import { describe, it, expect } from 'vitest';

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { reduceToolEvent } from '../tool-reducer.js';
import type { EventDraft, ReducerShared } from '../types.js';

type ReceivedEvent = Extract<RuntimeEvent, { type: 'user_input_received' }>;

function makeDraft(): EventDraft {
  return {
    agents: [],
    messages: [],
    tools: [],
    flow: { isThinking: false, isStreaming: false, streamingContent: '', streamingMessageId: null },
    permission: {
      pending: {
        callId: 'c1',
        toolName: 'bash',
        question: '是否允许执行 bash (git status)?',
        status: 'pending',
        timestamp: '',
      },
      history: [],
      queue: [],
    },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
    context: { isCompacting: false },
  };
}

const shared: ReducerShared = {
  chunkAccumulator: { current: '' },
  toolStartTimes: new Map(),
  multiAgent: {},
};

function decide(answer: string): string | undefined {
  const draft = makeDraft();
  const event: ReceivedEvent = {
    type: 'user_input_received',
    sessionId: 's',
    turn: 1,
    callId: 'c1',
    answer,
  };
  reduceToolEvent(draft, shared, event);
  return draft.permission.history[0]?.decision;
}

describe('user_input_received decision 映射', () => {
  it("'yes' → allow", () => {
    expect(decide('yes')).toBe('allow');
  });

  it("'always' → allow_always（与 UI always 选项对齐）", () => {
    expect(decide('always')).toBe('allow_always');
  });

  it("'no' → deny", () => {
    expect(decide('no')).toBe('deny');
  });

  it('pending callId 不一致时不落 history', () => {
    const draft = makeDraft();
    const event: ReceivedEvent = {
      type: 'user_input_received',
      sessionId: 's',
      turn: 1,
      callId: 'other',
      answer: 'yes',
    };
    reduceToolEvent(draft, shared, event);
    expect(draft.permission.history).toHaveLength(0);
    expect(draft.permission.pending).not.toBeNull();
  });
});

describe('user_input_requested FIFO 排队', () => {
  type RequestedEvent = Extract<RuntimeEvent, { type: 'user_input_requested' }>;

  function request(draft: EventDraft, callId: string, toolName: string): void {
    const event: RequestedEvent = {
      type: 'user_input_requested',
      sessionId: 's',
      turn: 1,
      callId,
      toolName,
      question: `是否允许执行 ${toolName}?`,
    };
    reduceToolEvent(draft, shared, event);
  }

  function receive(draft: EventDraft, callId: string, answer: string): void {
    const event: ReceivedEvent = {
      type: 'user_input_received',
      sessionId: 's',
      turn: 1,
      callId,
      answer,
    };
    reduceToolEvent(draft, shared, event);
  }

  function emptyDraft(): EventDraft {
    const draft = makeDraft();
    draft.permission.pending = null;
    return draft;
  }

  it('无队头时直接上位', () => {
    const draft = emptyDraft();
    request(draft, 'c1', 'bash');
    expect(draft.permission.pending?.callId).toBe('c1');
    expect(draft.permission.queue).toHaveLength(0);
  });

  it('有队头时排队，不覆盖', () => {
    const draft = emptyDraft();
    request(draft, 'c1', 'bash');
    request(draft, 'c2', 'web-fetch');
    expect(draft.permission.pending?.callId).toBe('c1');
    expect(draft.permission.queue.map((c) => c.callId)).toEqual(['c2']);
  });

  it('回答队头后排队者上位（按 callId 对号）', () => {
    const draft = emptyDraft();
    request(draft, 'c1', 'bash');
    request(draft, 'c2', 'web-fetch');
    receive(draft, 'c1', 'yes');
    expect(draft.permission.history).toHaveLength(1);
    expect(draft.permission.pending?.callId).toBe('c2');
    expect(draft.permission.queue).toHaveLength(0);
    receive(draft, 'c2', 'no');
    expect(draft.permission.history).toHaveLength(2);
    expect(draft.permission.pending).toBeNull();
  });

  it('非队头的回答：把它从队列摘除并记入 history（不留幽灵卡片）', () => {
    // 09-14-subagent-permission-hang：卡片 FIFO 与 bridge 等待者 FIFO 若背离，
    // 被回答的可能不是队头。旧行为（原样留在队列）会留下幽灵项——之后答队头时它会
    // 错误上位，用户对着「已被回答过」的卡片再答一次，provideInput 就会认领**另一个**
    // 等待者的答案（错配：例如 always 规则注册到错的工具上）。故改为摘除 + 记入 history。
    const draft = emptyDraft();
    request(draft, 'c1', 'bash');
    request(draft, 'c2', 'web-fetch');
    receive(draft, 'c2', 'yes');
    expect(draft.permission.history).toHaveLength(1);
    expect(draft.permission.history[0]?.callId).toBe('c2');
    expect(draft.permission.history[0]?.status).toBe('resolved');
    // 队头不被这次回答推进（它自己的答案还没来）
    expect(draft.permission.pending?.callId).toBe('c1');
    // 关键：c2 不再滞留在队列中
    expect(draft.permission.queue).toHaveLength(0);
  });
});
