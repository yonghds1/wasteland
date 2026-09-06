import { describe, expect, it } from 'vitest';

import { reduceSessionEvent } from '../session-reducer.js';
import type { EventDraft, ReducerShared } from '../types.js';

function makeDraft(messages: EventDraft['messages'] = []): EventDraft {
  return {
    agents: [],
    messages: [...messages],
    tools: [],
    flow: { isThinking: false, isStreaming: false, streamingContent: '', streamingMessageId: null },
    permission: { pending: null, history: [] },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
    context: { isCompacting: false },
  };
}

function makeShared(): ReducerShared {
  return { chunkAccumulator: { current: '' }, toolStartTimes: new Map(), multiAgent: {} };
}

const userTurn = (turn: number) =>
  ({
    type: 'user_turn',
    sessionId: 'sess-1',
    turn,
    content: '你好',
    source: 'interactive',
  }) as const;

describe('user_turn 乐观回显去重', () => {
  it('无本地回显时正常 push 并进入 thinking', () => {
    const draft = makeDraft();
    reduceSessionEvent(draft, makeShared(), userTurn(1));
    expect(draft.messages.length).toBe(1);
    expect(draft.messages[0]?.id).toMatch(/^msg-user-1-/);
    expect(draft.flow.isThinking).toBe(true);
  });

  it('已有同 turn 本地回显时不重复 push，但仍进入 thinking', () => {
    const draft = makeDraft([
      {
        id: 'msg-user-1-local',
        timestamp: new Date().toISOString(),
        agentId: 'sess-1',
        type: 'user',
        content: '你好',
      },
    ]);
    reduceSessionEvent(draft, makeShared(), userTurn(1));
    expect(draft.messages.length).toBe(1);
    expect(draft.messages[0]?.id).toBe('msg-user-1-local');
    expect(draft.flow.isThinking).toBe(true);
  });

  it('不同 turn 不互相去重', () => {
    const draft = makeDraft([
      {
        id: 'msg-user-1-123',
        timestamp: new Date().toISOString(),
        agentId: 'sess-1',
        type: 'user',
        content: '第一条',
      },
    ]);
    reduceSessionEvent(draft, makeShared(), userTurn(2));
    expect(draft.messages.length).toBe(2);
  });
});
