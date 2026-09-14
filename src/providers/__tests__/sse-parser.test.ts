import { describe, it, expect } from 'vitest';
import { parseSSEStream, isStreamDone } from '../sse-parser.js';
import { lastValueFrom, toArray } from 'rxjs';

/**
 * 创建一个 mock ReadableStreamDefaultReader
 * 将字符串数组转换为 SSE 流
 */
function createMockReader(chunks: string[]) {
  let index = 0;
  const encoder = new TextEncoder();

  return {
    read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const chunk = chunks[index++];
      return { done: false, value: encoder.encode(chunk) };
    },
    cancel: async () => {},
  } as ReadableStreamDefaultReader<Uint8Array>;
}

describe('parseSSEStream', () => {
  it('parses single SSE event', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0])).toEqual({
      choices: [{ delta: { content: 'hello' } }],
    });
  });

  it('parses multiple SSE events', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(3);
    expect(JSON.parse(events[0]).choices[0].delta.content).toBe('hel');
    expect(JSON.parse(events[1]).choices[0].delta.content).toBe('lo');
    expect(JSON.parse(events[2]).choices[0].delta.content).toBe('!');
  });

  it('handles chunked data (split across reads)', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"co',
      'ntent":"hello"}}]}\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).choices[0].delta.content).toBe('hello');
  });

  it('skips [DONE] marker', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).choices[0].delta.content).toBe('hi');
  });

  it('skips comment lines', async () => {
    const reader = createMockReader([
      ': this is a comment\n',
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(1);
  });

  it('handles multiple data lines per event', async () => {
    const reader = createMockReader([
      'data: {"part":1}\ndata: {"part":2}\n\n',
    ]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(1);
    // 多行 data 应该被合并
    expect(events[0]).toContain('"part":1');
    expect(events[0]).toContain('"part":2');
  });

  it('handles empty stream', async () => {
    const reader = createMockReader([]);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(0);
  });

  it('handles stream with only [DONE]', async () => {
    const reader = createMockReader(['data: [DONE]\n\n']);

    const events = await lastValueFrom(parseSSEStream(reader).pipe(toArray()));

    expect(events).toHaveLength(0);
  });
});

describe('isStreamDone', () => {
  it('returns true for [DONE]', () => {
    expect(isStreamDone('[DONE]')).toBe(true);
  });

  it('returns false for other strings', () => {
    expect(isStreamDone('{"choices":[]}')).toBe(false);
    expect(isStreamDone('')).toBe(false);
  });
});
