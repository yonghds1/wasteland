/**
 * openai-reasoning-stream.test.ts - R-1/R-2：reasoning 按源字段名累积并透传
 *
 * 覆盖 `.trellis/tasks/09-13-reasoning-roundtrip/prd.md` R-5 第 2 项：
 * - 三个字段名变体（reasoning_content / reasoning / thought）各自命中时 `{field, content}` 正确
 * - 首个非空增量锁定字段名，跨字段增量不混装
 * - 无 reasoning 流：assistant_message 事件**不含** reasoning key（而非 undefined 值）
 * - tool_call 事件同样携带同一份 reasoning
 * - UI chunk 序列与改前逐字一致（显示链零改动）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

vi.mock('@locales/index.js', () => ({
  t: (key: string) => {
    const messages: Record<string, string> = {
      'providers.openai.missingModel': 'provider openai-compatible missing model configuration.',
      'providers.openai.missingBaseUrl': 'provider openai-compatible missing baseUrl configuration.',
      'providers.openai.requestFailed': 'openai-compatible request failed:',
      'providers.openai.invalidJson': 'openai-compatible returned unparseable JSON.',
    };
    return messages[key] ?? key;
  },
}));

vi.mock('../shared/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/retry.js')>();
  return {
    ...actual,
    fetchWithRetry: async (url: string, options: RequestInit) => mockFetch(url, options),
  };
});

import { createOpenAIProvider } from '../openai.js';
import type { ProviderStreamEvent } from '../provider-types.js';

// ============================================================
// Helpers
// ============================================================

function createMockSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
}

function createMockResponse(sseChunks: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: createMockSSEBody(sseChunks),
    json: async () => ({}),
    headers: new Headers(),
    redirected: false,
    statusText: 'OK',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockResponse(sseChunks, status),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => '',
  } as unknown as Response;
}

/** SSE 行构造器：对象 → `data: {...}\n\n`，避免手写转义 */
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** 一个 reasoning delta chunk（field 由调用方指定，实现三变体复用） */
const reasoningChunk = (field: string, text: string) =>
  sse({ id: 'c1', choices: [{ delta: { [field]: text }, index: 0, finish_reason: null }] });

const contentChunk = (text: string) =>
  sse({ id: 'c1', choices: [{ delta: { content: text }, index: 0, finish_reason: 'stop' }] });

const DONE = 'data: [DONE]\n\n';

const baseSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-4',
};

async function runStep(
  sseChunks: string[],
  settings = baseSettings
): Promise<ProviderStreamEvent[]> {
  mockFetch.mockResolvedValueOnce(createMockResponse(sseChunks));
  const provider = createOpenAIProvider(settings);
  return lastValueFrom(
    provider
      .runStep({
        context: {
          history: [],
          input: { content: 'Hi' },
          prompt: 'You are a helpful assistant',
          toolRegistry: undefined,
        },
        state: { toolResults: [] },
      } as never)
      .pipe(toArray())
  );
}

// ============================================================
// Tests
// ============================================================

describe('openai provider - reasoning round-trip 接收侧 (R-1/R-2)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('三个源字段名变体', () => {
    const variants: Array<[string, string]> = [
      ['reasoning_content', 'Thinking step 1... '],
      ['reasoning', 'pondering step 1... '],
      ['thought', 'musing step 1... '],
    ];

    for (const [field, firstDelta] of variants) {
      it(`累积 ${field} 增量并在 assistant_message 上带回 {field, content}`, async () => {
        const secondDelta = field === 'reasoning_content' ? 'Thinking step 2.' : 'step 2.';
        const events = await runStep([
          reasoningChunk(field, firstDelta),
          reasoningChunk(field, secondDelta),
          contentChunk('Final Answer'),
          DONE,
        ]);

        const message = events.find((e) => e.type === 'assistant_message');
        expect(message?.type).toBe('assistant_message');
        if (message?.type !== 'assistant_message') return;
        expect(message.reasoning).toEqual({
          field,
          content: `${firstDelta}${secondDelta}`,
        });
      });
    }
  });

  it('首个非空增量锁定字段名，其它字段的增量不混装进 reasoning.content', async () => {
    const events = await runStep([
      reasoningChunk('reasoning', 'locked-1'),
      reasoningChunk('reasoning_content', 'ignored-2'),
      reasoningChunk('reasoning', 'locked-3'),
      contentChunk('body'),
      DONE,
    ]);

    const message = events.find((e) => e.type === 'assistant_message');
    if (message?.type !== 'assistant_message') throw new Error('missing assistant_message');
    // 只累积锁定字段；跨字段增量丢弃（避免拼出上游从未发过的混合串）
    expect(message.reasoning).toEqual({ field: 'reasoning', content: 'locked-1locked-3' });
  });

  it('无 reasoning 的流：assistant_message 不含 reasoning key', async () => {
    const events = await runStep([
      sse({ id: 'c1', choices: [{ delta: { content: 'plain' }, index: 0, finish_reason: 'stop' }] }),
      DONE,
    ]);

    const message = events.find((e) => e.type === 'assistant_message');
    expect(message).toBeDefined();
    // 关键：不是 "reasoning: undefined"，而是该 key 根本不存在（默认零回归）
    expect('reasoning' in (message ?? {})).toBe(false);
  });

  it('tool_call 事件携带同一份 reasoning（多个 call 各自带）', async () => {
    const events = await runStep([
      reasoningChunk('reasoning_content', 'need two tools'),
      sse({
        id: 'c1',
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } },
              { index: 1, id: 'call_b', type: 'function', function: { name: 'read_file', arguments: '{"path":"b"}' } },
            ],
          },
          index: 0,
        }],
      }),
      sse({ id: 'c1', choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] }),
      DONE,
    ]);

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    for (const ev of toolCalls) {
      if (ev.type !== 'tool_call') continue;
      expect(ev.reasoning).toEqual({ field: 'reasoning_content', content: 'need two tools' });
    }
    // 有 tool_calls 时不再发 assistant_message（保持既有约定）
    expect(events.filter((e) => e.type === 'assistant_message')).toHaveLength(0);
  });

  it('UI chunk 序列与改前逐字相同（显示链零改动）', async () => {
    // 与 openai-sse.test.ts `should parse reasoning_content deltas and emit wrapped think tags`
    // 完全相同的输入与断言：证明 R-1 的字段探测没有动到 UI 输出。
    const events = await runStep([
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Thinking step 1... "},"index":0,"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Thinking step 2."},"index":0,"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Final Answer"},"index":0,"finish_reason":"stop"}]}\n\n',
      DONE,
    ]);

    const chunks = events
      .filter((e) => e.type === 'assistant_chunk')
      .map((e) => (e.type === 'assistant_chunk' ? e.text : ''));

    expect(chunks).toEqual([
      '<think>Thinking step 1... ',
      'Thinking step 2.',
      '</think>\nFinal Answer',
    ]);
  });
});
