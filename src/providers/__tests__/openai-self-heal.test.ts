/**
 * openai-self-heal.test.ts - R-4：reasoning 回传被拒收时的自愈
 *
 * 覆盖 PRD R-4 / R-5 第 3 项：
 * - 命中"字段被拒收"类错误 → 去 reasoning 字段**重试一次**并成功
 * - 进程内（per provider 实例）记住"停回传"，后续请求不再带
 * - "must be passed back"（要求多带）类错误 → 不 retry、不 strip，原文抛回
 * - 非 reasoning 错误 → 不 retry
 * - 已 suppress 后再遇"要求多带"错误 → 不能二次自愈，只能原样抛错
 * - 纯函数 isReasoningRoundTripError / stripReasoningFields 行为边界
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
import {
  isReasoningRoundTripError,
  stripReasoningFields,
} from '../shared/reasoning-roundtrip.js';
import type { OpenAIMessage } from '../openai-compatible/types.js';
import type { HistoryRecord } from '@core/runtime/event-types.js';
import type { AgentProvider } from '../provider-types.js';

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

function createMockErrorResponse(status: number, errorMessage: string): Response {
  return {
    ok: false,
    status,
    body: null,
    json: async () => ({ error: { message: errorMessage } }),
    headers: new Headers(),
    redirected: false,
    statusText: 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockErrorResponse(status, errorMessage),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => '',
  } as unknown as Response;
}

const OK_STREAM = [
  'data: {"id":"c1","choices":[{"delta":{"content":"ok"},"index":0,"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];

const REASONING_KEYS = ['reasoning_content', 'reasoning', 'thought'] as const;

/** 历史里带一条 reasoning assistant 消息，触发回传（round-trip） */
const historyWithReasoning: HistoryRecord[] = [
  {
    type: 'message',
    role: 'assistant',
    turn: 1,
    content: 'earlier answer',
    timestamp: '2026-09-13T00:00:00.000Z',
    reasoning: { field: 'reasoning_content', content: 'earlier thinking' },
  } as unknown as HistoryRecord,
];

const baseSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-4',
};

function runStepOnce(provider: AgentProvider, history: HistoryRecord[]) {
  return lastValueFrom(
    provider
      .runStep({
        context: {
          history,
          input: { content: 'go' },
          prompt: 'sys',
          toolRegistry: undefined,
        },
        state: { toolResults: [] },
      } as never)
      .pipe(toArray())
  );
}

/** 解析第 n 次 fetch（0-based）请求体里的 messages */
function requestMessages(callIndex: number): Record<string, unknown>[] {
  const options = mockFetch.mock.calls[callIndex][1] as RequestInit;
  const body = JSON.parse(options.body as string) as { messages: Record<string, unknown>[] };
  return body.messages;
}

function hasAnyReasoningKey(messages: Record<string, unknown>[]): boolean {
  return messages.some((m) => REASONING_KEYS.some((k) => k in m));
}

// ============================================================
// Tests
// ============================================================

describe('openai provider - R-4 自愈（reasoning 字段被拒收）', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('命中"字段被拒收"错误 → 去字段重试一次并成功，第二次请求体无 reasoning', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockErrorResponse(400, 'unrecognized prompt field reasoning_content')
    );
    mockFetch.mockResolvedValueOnce(createMockResponse(OK_STREAM));

    const provider = createOpenAIProvider(baseSettings);
    await runStepOnce(provider, historyWithReasoning);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // 首发确实带了 reasoning（自愈的前提）
    expect(hasAnyReasoningKey(requestMessages(0))).toBe(true);
    // 重试请求体所有 message 均不含三个 reasoning 字段
    expect(hasAnyReasoningKey(requestMessages(1))).toBe(false);
  });

  it('自愈成功后同 provider 后续 runStep 首请求即不带 reasoning（进程内记忆）', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockErrorResponse(400, 'unexpected reasoning field in messages')
    );
    mockFetch.mockResolvedValueOnce(createMockResponse(OK_STREAM));
    mockFetch.mockResolvedValueOnce(createMockResponse(OK_STREAM));

    const provider = createOpenAIProvider(baseSettings);
    await runStepOnce(provider, historyWithReasoning);
    await runStepOnce(provider, historyWithReasoning);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // 第二次 runStep 的"首请求"（第 3 次 fetch）已被 suppress，起手 strip
    expect(hasAnyReasoningKey(requestMessages(2))).toBe(false);
    // 且没触发额外的自愈重试
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('"must be passed back"（要求多带）错误 → 不 retry，原文抛回，请求体仍带 reasoning', async () => {
    const mustPassBack =
      'The reasoning_content in the thinking mode must be passed back to the API.';
    mockFetch.mockResolvedValueOnce(createMockErrorResponse(400, mustPassBack));

    const provider = createOpenAIProvider(baseSettings);
    await expect(runStepOnce(provider, historyWithReasoning)).rejects.toThrow(mustPassBack);

    // 只发一次，不 strip（这类错误归 R-3 解决，去字段只会更糟）
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(hasAnyReasoningKey(requestMessages(0))).toBe(true);
  });

  it('非 reasoning 错误 → 不 retry，错误文案原样透传', async () => {
    mockFetch.mockResolvedValueOnce(createMockErrorResponse(401, 'Invalid API key'));

    const provider = createOpenAIProvider(baseSettings);
    await expect(runStepOnce(provider, historyWithReasoning)).rejects.toThrow(/Invalid API key/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('已 suppress 后再遇"要求多带"错误 → 不二次自愈，原样抛错', async () => {
    // 先自愈一次，进入 suppressed 态
    mockFetch.mockResolvedValueOnce(
      createMockErrorResponse(400, 'unrecognized reasoning_content field')
    );
    mockFetch.mockResolvedValueOnce(createMockResponse(OK_STREAM));
    const provider = createOpenAIProvider(baseSettings);
    await runStepOnce(provider, historyWithReasoning);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // 再来一次"必须回传"错误：数据本就没带（已 suppress），不能假重试
    const mustPassBack =
      'The reasoning_content in the thinking mode must be passed back to the API.';
    mockFetch.mockResolvedValueOnce(createMockErrorResponse(400, mustPassBack));
    await expect(runStepOnce(provider, historyWithReasoning)).rejects.toThrow(mustPassBack);

    // 第三次请求发出后直接失败，没有第四次重试
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(hasAnyReasoningKey(requestMessages(2))).toBe(false);
  });

  it('自愈重试本身也失败 → 不落下"停回传"记忆（下次仍尝试回传）', async () => {
    // 首发"拒收"→ 去字段重试 → 重试又因别的原因失败（这里用 500）
    mockFetch.mockResolvedValueOnce(
      createMockErrorResponse(400, 'unrecognized reasoning_content field')
    );
    mockFetch.mockResolvedValueOnce(createMockErrorResponse(500, 'upstream exploded'));

    const provider = createOpenAIProvider(baseSettings);
    await expect(runStepOnce(provider, historyWithReasoning)).rejects.toThrow(/upstream exploded/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(hasAnyReasoningKey(requestMessages(1))).toBe(false);

    // 记忆未被污染：下一个 runStep 起手仍带回 reasoning（再由 R-4 决定是否自愈）
    mockFetch.mockResolvedValueOnce(createMockResponse(OK_STREAM));
    await runStepOnce(provider, historyWithReasoning);
    expect(hasAnyReasoningKey(requestMessages(2))).toBe(true);
  });

  it('请求体本就无 reasoning 时遇"拒收"错误 → 不做无意义重试', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockErrorResponse(400, 'unrecognized prompt field reasoning_content')
    );

    const provider = createOpenAIProvider(baseSettings);
    // 空历史：请求体只有 system + user，没有任何 reasoning 字段
    await expect(runStepOnce(provider, [])).rejects.toThrow(/reasoning_content/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('isReasoningRoundTripError / stripReasoningFields 纯函数', () => {
  it('识别"字段被拒收"类错误', () => {
    expect(isReasoningRoundTripError('unrecognized prompt field reasoning_content')).toBe(true);
    expect(isReasoningRoundTripError('Unexpected value at messages[1].reasoning')).toBe(true);
    expect(isReasoningRoundTripError('thinking content is not supported by this model')).toBe(true);
    expect(
      isReasoningRoundTripError('invalid_request_error: unknown field reasoning_content')
    ).toBe(true);
  });

  it('排除"要求多带"类错误（交回 R-3）', () => {
    expect(
      isReasoningRoundTripError(
        'The reasoning_content in the thinking mode must be passed back to the API.'
      )
    ).toBe(false);
    expect(isReasoningRoundTripError('reasoning_content is required in thinking mode')).toBe(false);
    expect(isReasoningRoundTripError('missing reasoning_content')).toBe(false);
    // 同类"要求多带"的其它措辞：误判成"拒收"会悄悄丢掉 R-3 能力并污染进程内记忆
    expect(
      isReasoningRoundTripError('The API requires reasoning_content to be provided.')
    ).toBe(false);
    expect(isReasoningRoundTripError('reasoning_content needs to be passed back')).toBe(false);
    expect(
      isReasoningRoundTripError('invalid_request_error: please pass reasoning_content back to the API')
    ).toBe(false);
  });

  it('与 reasoning 无关的错误返回 false', () => {
    expect(isReasoningRoundTripError('Invalid API key')).toBe(false);
    expect(isReasoningRoundTripError('unrecognized tool name foo')).toBe(false);
  });

  it('stripReasoningFields 只删三个 reasoning key，其余原样', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: 'a',
        reasoning_content: 'think',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
      { role: 'user', content: 'u' },
    ] as unknown as OpenAIMessage[];

    const stripped = stripReasoningFields(msgs);
    expect(stripped).not.toBe(msgs);
    const assistant = stripped[1] as unknown as Record<string, unknown>;
    expect('reasoning_content' in assistant).toBe(false);
    expect(assistant.tool_calls).toEqual(
      (msgs[1] as unknown as Record<string, unknown>).tool_calls
    );
    expect(assistant.content).toBe('a');
    // 未命中的条目保持同引用（零拷贝）
    expect(stripped[0]).toBe(msgs[0]);
    expect(stripped[2]).toBe(msgs[2]);
  });

  it('stripReasoningFields 无命中时原样返回同引用', () => {
    const msgs = [{ role: 'user', content: 'u' }] as unknown as OpenAIMessage[];
    expect(stripReasoningFields(msgs)).toBe(msgs);
  });
});
