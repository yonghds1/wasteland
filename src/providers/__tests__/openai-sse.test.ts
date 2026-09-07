/**
 * openai-sse.test.ts - OpenAI Provider SSE 流式输出端到端测试
 *
 * 使用 Mock Server 模拟 OpenAI API 响应，验证：
 * 1. SSE 流正确解析
 * 2. assistant_chunk/assistant_message/usage 事件正确发出
 * 3. 错误响应正确处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lastValueFrom, toArray, take } from 'rxjs';

// Mock fetch globally before importing the module under test
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

// Mock the locales module to avoid i18n dependencies
vi.mock('@locales/index.js', () => ({
  t: (key: string) => {
    const messages: Record<string, string> = {
      'providers.openai.missingModel': 'provider openai-compatible missing model configuration.',
      'providers.openai.missingBaseUrl': 'provider openai-compatible missing baseUrl configuration.',
      'providers.openai.requestFailed': 'openai-compatible request failed:',
      'providers.openai.invalidJson': 'openai-compatible returned unparseable JSON.',
      'providers.openai.missingChoices': 'openai-compatible response missing choices[0].',
    };
    return messages[key] ?? key;
  },
}));

// Mock fetchWithRetry to call fetch directly (no retry logic in tests)
vi.mock('../shared/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/retry.js')>();
  return {
    ...actual,
    fetchWithRetry: async (url: string, options: RequestInit) => {
      return mockFetch(url, options);
    },
  };
});

// Import after mocks are set up
import { createOpenAIProvider } from '../openai.js';

// ============================================================
// Helpers
// ============================================================

/** Create a mock SSE response body as a ReadableStream */
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

/** Create a mock successful fetch Response with SSE body */
function createMockResponse(
  sseChunks: string[],
  status = 200
): Response {
  const body = createMockSSEBody(sseChunks);
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
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

/** Create a mock error fetch Response */
function createMockErrorResponse(
  status: number,
  errorMessage: string
): Response {
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

/** Create a mock empty-body fetch Response */
function createMockNoBodyResponse(): Response {
  return {
    ok: true,
    status: 200,
    body: null,
    json: async () => ({}),
    headers: new Headers(),
    redirected: false,
    statusText: 'OK',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockNoBodyResponse(),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => '',
  } as unknown as Response;
}

/** Provider settings for tests */
const baseSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-4',
};

// ============================================================
// Tests
// ============================================================

describe('OpenAI Provider - SSE Streaming', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Normal SSE Stream', () => {
    it('should emit assistant_chunk events for text content', async () => {
      // Simulate 3 chunks of text content
      mockFetch.mockResolvedValueOnce(
        createMockSSEBody([
          'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
          'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"index":0}]}\n\n',
          'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
          'data: [DONE]\n\n',
        ])
      );

      // Mock the response as a successful Response object
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Say hello' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      // Filter to only streaming events we care about
      const chunkEvents = events.filter((e) => e.type === 'assistant_chunk');
      const messageEvents = events.filter((e) => e.type === 'assistant_message');

      expect(chunkEvents.length).toBeGreaterThanOrEqual(2);
      expect((chunkEvents[0] as any).text).toBe('Hello');
      expect((chunkEvents[1] as any).text).toBe(' world');

      // assistant_message should be emitted at the end
      expect(messageEvents.length).toBe(1);
    });

    it('should emit usage event when usage data is present', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);

      const usage = (usageEvents[0] as any).usage;
      expect(usage.promptTokens).toBe(10);
      expect(usage.completionTokens).toBe(5);
      expect(usage.totalTokens).toBe(15);
    });

    it('should include cachedTokens when prompt_tokens_details is present', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0}],"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25,"prompt_tokens_details":{"cached_tokens":10}}}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);

      const usage = (usageEvents[0] as any).usage;
      expect(usage.cachedTokens).toBe(10);
    });

    it('should normalize deepseek prompt_cache_hit_tokens via profile usageFields', async () => {
      // DeepSeek 返回扁平字段 prompt_cache_hit_tokens，原实现恒读不到；
      // profile 层声明该字段后应归一化进 cachedTokens。
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0}],"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25,"prompt_cache_hit_tokens":12}}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-key',
        model: 'deepseek-chat',
      });

      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      const usage = (usageEvents[0] as any).usage;
      expect(usage.cachedTokens).toBe(12);
    });

    it('should keep OpenAI official cached_tokens fallback for suppliers without a dedicated field', async () => {
      // minimax 未声明专用缓存字段，仍应能读到 openai-compatible 协议的标准字段（行为兼容）
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0}],"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25,"prompt_tokens_details":{"cached_tokens":8}}}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider({
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test-key',
        model: 'MiniMax-M3',
      });

      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      const usage = (usageEvents[0] as any).usage;
      expect(usage.cachedTokens).toBe(8);
    });
  });

  describe('Empty and Edge Cases', () => {
    it('should handle stream with only [DONE] marker', async () => {
      const sseChunks = ['data: [DONE]\n\n'];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hello' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      // Should complete without error, with empty assistant_message
      const messageEvents = events.filter((e) => e.type === 'assistant_message');
      expect(messageEvents).toHaveLength(1);
    });

    it('should handle single chunk response', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"OK"},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'OK' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const chunkEvents = events.filter((e) => e.type === 'assistant_chunk');
      expect(chunkEvents).toHaveLength(1);
      expect((chunkEvents[0] as any).text).toBe('OK');
    });

    it('should skip chunks with no choices', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const chunkEvents = events.filter((e) => e.type === 'assistant_chunk');
      expect(chunkEvents).toHaveLength(1);
      expect((chunkEvents[0] as any).text).toBe('Hi');
    });
  });

  describe('Error Handling', () => {
    it('should error when API returns non-OK status', async () => {
      const response = createMockErrorResponse(401, 'Invalid API key');
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);

      await expect(
        lastValueFrom(
          provider.runStep({
            context: {
              history: [],
              input: { content: 'Hello' },
              prompt: 'You are a helpful assistant',
              toolRegistry: undefined,
            } as any,
            state: { toolResults: [] } as any,
          })
        )
      ).rejects.toThrow();
    });

    it('should error when response body is null', async () => {
      const response = createMockNoBodyResponse();
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);

      await expect(
        lastValueFrom(
          provider.runStep({
            context: {
              history: [],
              input: { content: 'Hello' },
              prompt: 'You are a helpful assistant',
              toolRegistry: undefined,
            } as any,
            state: { toolResults: [] } as any,
          })
        )
      ).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const provider = createOpenAIProvider(baseSettings);

      await expect(
        lastValueFrom(
          provider.runStep({
            context: {
              history: [],
              input: { content: 'Hello' },
              prompt: 'You are a helpful assistant',
              toolRegistry: undefined,
            } as any,
            state: { toolResults: [] } as any,
          })
        )
      ).rejects.toThrow();
    });

    it('should handle 500 server error', async () => {
      const response = createMockErrorResponse(500, 'Internal Server Error');
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);

      await expect(
        lastValueFrom(
          provider.runStep({
            context: {
              history: [],
              input: { content: 'Hello' },
              prompt: 'You are a helpful assistant',
              toolRegistry: undefined,
            } as any,
            state: { toolResults: [] } as any,
          })
        )
      ).rejects.toThrow();
    });
  });

  describe('Tool Calls', () => {
    it('should emit tool_call events when finish_reason is tool_calls', async () => {
      // Build SSE data using JSON.stringify to avoid escaping issues
      const makeSSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-1',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '' },
              }],
            },
            index: 0,
          }],
        }),
        makeSSE({
          id: 'chatcmpl-1',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"city":' },
              }],
            },
            index: 0,
          }],
        }),
        makeSSE({
          id: 'chatcmpl-1',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"Beijing"}' },
              }],
            },
            index: 0,
          }],
        }),
        makeSSE({
          id: 'chatcmpl-1',
          choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
        }),
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'What is the weather in Beijing?' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const toolCallEvents = events.filter((e) => e.type === 'tool_call');
      expect(toolCallEvents).toHaveLength(1);

      const toolCall = (toolCallEvents[0] as any).call;
      expect(toolCall.toolName).toBe('get_weather');
      expect(toolCall.input).toEqual({ city: 'Beijing' });
      expect(toolCall.id).toBe('call_123');
    });
  });

  describe('Configuration', () => {
    it('should include Authorization header when apiKey is provided', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-secret-key',
        model: 'gpt-4',
      });

      await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(take(1))
      );

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer sk-secret-key');
    });

    it('should omit Authorization header when no apiKey', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4',
      });

      await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(take(1))
      );

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('should send correct request body', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);

      await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(take(1))
      );

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('gpt-4');
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      expect(Array.isArray(body.messages)).toBe(true);
    });

    it('should parse reasoning_content deltas and emit wrapped think tags', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Thinking step 1... "},"index":0,"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Thinking step 2."},"index":0,"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Final Answer"},"index":0,"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );

      const chunks = events
        .filter((e) => e.type === 'assistant_chunk')
        .map((e) => (e as any).text);

      expect(chunks).toEqual([
        '<think>Thinking step 1... ',
        'Thinking step 2.',
        '</think>\nFinal Answer',
      ]);
    });
  });

  describe('OpenCode Go session headers', () => {
    const goSettings = {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'go-test-key',
      model: 'mimo-v2.5',
    };

    async function runOneStep(settings: typeof baseSettings, sessionId?: string): Promise<Record<string, string>> {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"ok"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(sseChunks));
      const provider = createOpenAIProvider(settings);
      await lastValueFrom(
        provider.runStep({
          context: {
            sessionId,
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );
      const [, options] = mockFetch.mock.calls[0];
      return (options as RequestInit).headers as Record<string, string>;
    }

    it('sends x-opencode-session and User-Agent to opencode endpoints', async () => {
      const headers = await runOneStep(goSettings, 'sess-123');
      expect(headers['x-opencode-session']).toBe('sess-123');
      expect(headers['User-Agent']).toBe('wasteland');
      expect(headers['Authorization']).toBe('Bearer go-test-key');
    });

    it('omits session header for non-opencode endpoints', async () => {
      const headers = await runOneStep(baseSettings, 'sess-123');
      expect(headers['x-opencode-session']).toBeUndefined();
      expect(headers['User-Agent']).toBeUndefined();
    });
  });

  describe('streaming final message', () => {
    async function runTextStream(): Promise<{ texts: string[]; finals: string[] }> {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(sseChunks));
      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );
      return {
        texts: events.filter((e) => e.type === 'assistant_chunk').map((e) => (e as any).text),
        finals: events.filter((e) => e.type === 'assistant_message').map((e) => (e as any).text),
      };
    }

    it('final message carries the joined chunk text for transcript', async () => {
      const { texts, finals } = await runTextStream();
      expect(finals.length).toBe(1);
      expect(finals[0]).toBe(texts.join(''));
      expect(finals[0]).toBe('Hello world');
    });

    it('think-only stream finalizes with think tags preserved', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"hi"},"index":0}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(sseChunks));
      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep({
          context: {
            history: [],
            input: { content: 'Hi' },
            prompt: 'You are a helpful assistant',
            toolRegistry: undefined,
          } as any,
          state: { toolResults: [] } as any,
        }).pipe(toArray())
      );
      const finals = events.filter((e) => e.type === 'assistant_message').map((e) => (e as any).text);
      expect(finals.length).toBe(1);
      expect(finals[0]).toContain('<think>hi');
      expect(finals[0]).toContain('</think>');
    });
  });
});
