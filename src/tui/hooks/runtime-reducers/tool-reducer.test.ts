/**
 * tool-reducer.test.ts - user_input_received → permission history decision 映射
 *
 * 覆盖 once/always/no 三种回答的 history 落点（allow / allow_always / deny）。
 */

import { describe, it, expect } from 'vitest';

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { reduceToolEvent } from './tool-reducer.js';
import type { EventDraft, ReducerShared } from './types.js';

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
