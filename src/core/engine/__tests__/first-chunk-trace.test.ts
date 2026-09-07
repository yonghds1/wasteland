import { describe, expect, it } from 'vitest';

import { consumeFirstChunkTrace, type FirstChunkMeasure } from '../turn-helpers.js';

function measure(startMs: number | null): FirstChunkMeasure {
  return { startMs, sessionId: 's', turn: 1, step: 1, providerId: 'qwen' };
}

describe('consumeFirstChunkTrace', () => {
  it('首个文本 chunk 产生 trace 并归零', () => {
    const { trace, next } = consumeFirstChunkTrace(measure(1000), {
      type: 'assistant_chunk',
      text: 'hi',
    });
    expect(trace).toMatchObject({
      scope: 'provider',
      phase: 'provider.first_chunk',
      data: { provider: 'qwen' },
    });
    expect(typeof (trace?.data as { elapsedMs: number }).elapsedMs).toBe('number');
    expect(next.startMs).toBeNull();
  });

  it('第二个 chunk 不再产生', () => {
    const first = consumeFirstChunkTrace(measure(1000), { type: 'assistant_chunk', text: 'a' });
    const second = consumeFirstChunkTrace(
      { ...measure(1000), startMs: first.next.startMs },
      { type: 'assistant_chunk', text: 'b' }
    );
    expect(second.trace).toBeNull();
  });

  it('非文本事件不消耗计时（tool_call/usage 透过）', () => {
    const { trace, next } = consumeFirstChunkTrace(measure(1000), { type: 'tool_call' });
    expect(trace).toBeNull();
    expect(next.startMs).toBe(1000);
    const msg = consumeFirstChunkTrace(measure(1000), { type: 'assistant_message', text: '' });
    expect(msg.trace?.phase).toBe('provider.first_chunk');
  });

  it('未计时返回空', () => {
    expect(consumeFirstChunkTrace(measure(null), { type: 'assistant_chunk', text: 'x' }).trace).toBeNull();
  });
});
