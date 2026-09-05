/**
 * openai-tool-calling.test.ts - OpenAI Provider Tool Calling 端到端测试
 *
 * 使用 Mock Server 模拟 OpenAI API 响应，验证：
 * 1. 单工具调用：正确的 tool_call 事件结构
 * 2. 多工具调用：多个工具调用正确解析
 * 3. 参数解析：JSON 参数正确累积解析
 * 4. 工具调用+文本混合：流中同时包含文本和工具调用
 * 5. tool_call 事件结构：id, toolName, input
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';

// Mock fetch globally before importing the module under test
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

// Mock the locales module to avoid i18n dependencies
vi.mock('@locales/index.js', () => ({
  t: (key: string) => {
    const messages: Record<string, string> = {
      'providers.openai.missingModel':
        'provider openai-compatible missing model configuration.',
      'providers.openai.missingBaseUrl':
        'provider openai-compatible missing baseUrl configuration.',
      'providers.openai.requestFailed': 'openai-compatible request failed:',
      'providers.openai.invalidJson':
        'openai-compatible returned unparseable JSON.',
      'providers.openai.missingChoices':
        'openai-compatible response missing choices[0].',
    };
    return messages[key] ?? key;
  },
}));

// Mock fetchWithRetry to call fetch directly (no retry logic in tests)
vi.mock('../shared/retry.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../shared/retry.js')
  >();
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

/** Build an SSE data line from a JS object */
const makeSSE = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

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

/** Provider settings for tests */
const baseSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-4',
};

/** Minimal step input for tool calling tests */
function makeStepInput(toolRegistry?: any) {
  return {
    context: {
      history: [],
      input: { content: 'test input' },
      prompt: 'You are a helpful assistant',
      toolRegistry: toolRegistry ?? undefined,
    } as any,
    state: { toolResults: [] } as any,
  };
}

// ============================================================
// Tests
// ============================================================

describe('OpenAI Provider - Tool Calling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // 单工具调用
  // ----------------------------------------------------------
  describe('Single Tool Call', () => {
    it('should emit a single tool_call event with correct structure', async () => {
      const sseChunks = [
        // 第一个 chunk：工具调用开始，包含 id 和 name
        makeSSE({
          id: 'chatcmpl-tc1',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc123',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 第二个 chunk：参数增量
        makeSSE({
          id: 'chatcmpl-tc1',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '{"city":' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 第三个 chunk：参数完成
        makeSSE({
          id: 'chatcmpl-tc1',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"London"}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // finish_reason: tool_calls
        makeSSE({
          id: 'chatcmpl-tc1',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );

      // 应该只有一个 tool_call 事件
      expect(toolCallEvents).toHaveLength(1);

      const toolCall = (toolCallEvents[0] as any).call;

      // 验证结构：id, toolName, input
      expect(toolCall).toHaveProperty('id', 'call_abc123');
      expect(toolCall).toHaveProperty('toolName', 'get_weather');
      expect(toolCall).toHaveProperty('input');
      expect(toolCall.input).toEqual({ city: 'London' });
    });

    it('should not emit assistant_message when tool_call is present', async () => {
      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-tc2',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_xyz',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-tc2',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const messageEvents = events.filter(
        (e) => e.type === 'assistant_message'
      );

      // 工具调用时不应发出 assistant_message
      expect(messageEvents).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // 多工具调用
  // ----------------------------------------------------------
  describe('Multiple Tool Calls', () => {
    it('should emit tool_call events for multiple tools in one response', async () => {
      const sseChunks = [
        // 第一个工具调用
        makeSSE({
          id: 'chatcmpl-multi',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_tool1',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{"city":' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 第二个工具调用（同时出现）
        makeSSE({
          id: 'chatcmpl-multi',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_tool2',
                    type: 'function',
                    function: {
                      name: 'get_time',
                      arguments: '{"timezone":',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 完成第一个工具的参数
        makeSSE({
          id: 'chatcmpl-multi',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"Paris"}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 完成第二个工具的参数
        makeSSE({
          id: 'chatcmpl-multi',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    function: { arguments: '"UTC+8"}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // finish_reason: tool_calls
        makeSSE({
          id: 'chatcmpl-multi',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );

      // 应该有两个 tool_call 事件
      expect(toolCallEvents).toHaveLength(2);

      // 第一个工具调用
      const call1 = (toolCallEvents[0] as any).call;
      expect(call1.id).toBe('call_tool1');
      expect(call1.toolName).toBe('get_weather');
      expect(call1.input).toEqual({ city: 'Paris' });

      // 第二个工具调用
      const call2 = (toolCallEvents[1] as any).call;
      expect(call2.id).toBe('call_tool2');
      expect(call2.toolName).toBe('get_time');
      expect(call2.input).toEqual({ timezone: 'UTC+8' });
    });

    it('should handle three tool calls in a single response', async () => {
      const sseChunks = [
        // 三个工具同时出现
        makeSSE({
          id: 'chatcmpl-3tools',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_a',
                    type: 'function',
                    function: { name: 'tool_a', arguments: '{"x":1}' },
                  },
                  {
                    index: 1,
                    id: 'call_b',
                    type: 'function',
                    function: { name: 'tool_b', arguments: '{"y":2}' },
                  },
                  {
                    index: 2,
                    id: 'call_c',
                    type: 'function',
                    function: { name: 'tool_c', arguments: '{"z":3}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-3tools',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(3);

      const names = toolCallEvents.map(
        (e) => (e as any).call.toolName
      );
      expect(names).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });
  });

  // ----------------------------------------------------------
  // 参数解析
  // ----------------------------------------------------------
  describe('Parameter Parsing', () => {
    it('should correctly parse complex nested JSON arguments', async () => {
      const complexArgs = {
        user: { name: 'Alice', age: 30 },
        tags: ['admin', 'user'],
        active: true,
        score: 99.5,
      };

      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-args',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_complex',
                    type: 'function',
                    function: {
                      name: 'complex_tool',
                      arguments: JSON.stringify(complexArgs),
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-args',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.toolName).toBe('complex_tool');
      expect(call.input).toEqual(complexArgs);
    });

    it('should correctly parse arguments delivered incrementally across chunks', async () => {
      // Simulate argument being delivered character by character across chunks
      const fullArgs = '{"query":"hello world","limit":10}';
      const mid = Math.floor(fullArgs.length / 2);
      const chunk1 = fullArgs.slice(0, mid);
      const chunk2 = fullArgs.slice(mid);

      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-inc',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_inc',
                    type: 'function',
                    function: { name: 'search', arguments: '' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-inc',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: chunk1 },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-inc',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: chunk2 },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-inc',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.toolName).toBe('search');
      expect(call.input).toEqual({ query: 'hello world', limit: 10 });
    });

    it('should return empty object when tool arguments are empty', async () => {
      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-empty',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_empty',
                    type: 'function',
                    function: { name: 'no_args_tool', arguments: '' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-empty',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.toolName).toBe('no_args_tool');
      // parseToolArguments('') returns {}
      expect(call.input).toEqual({});
    });

    it('should return empty object for malformed JSON arguments', async () => {
      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-badjson',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_bad',
                    type: 'function',
                    function: {
                      name: 'bad_json_tool',
                      arguments: '{not valid json',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-badjson',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.toolName).toBe('bad_json_tool');
      // parseToolArguments falls back to {} for invalid JSON
      expect(call.input).toEqual({});
    });

    it('should handle string, number, boolean, null, and array argument types', async () => {
      const mixedArgs = {
        name: 'test',
        count: 42,
        enabled: true,
        metadata: null,
        items: [1, 'two', false],
      };

      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-mixed',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_mixed',
                    type: 'function',
                    function: {
                      name: 'mixed_tool',
                      arguments: JSON.stringify(mixedArgs),
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-mixed',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.input).toEqual(mixedArgs);
    });
  });

  // ----------------------------------------------------------
  // 工具调用 + 文本混合
  // ----------------------------------------------------------
  describe('Tool Call + Text Mixed', () => {
    it('should emit both assistant_chunk and tool_call events', async () => {
      const sseChunks = [
        // 先输出一段文本
        makeSSE({
          id: 'chatcmpl-mix1',
          choices: [
            {
              delta: { content: 'Let me check the weather for you.' },
              index: 0,
            },
          ],
        }),
        // 然后开始工具调用
        makeSSE({
          id: 'chatcmpl-mix1',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_mix1',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{"city":"Tokyo"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-mix1',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      // 验证有 assistant_chunk 事件
      const chunkEvents = events.filter(
        (e) => e.type === 'assistant_chunk'
      );
      expect(chunkEvents.length).toBeGreaterThanOrEqual(1);
      expect((chunkEvents[0] as any).text).toBe(
        'Let me check the weather for you.'
      );

      // 验证有 tool_call 事件
      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      const call = (toolCallEvents[0] as any).call;
      expect(call.toolName).toBe('get_weather');
      expect(call.input).toEqual({ city: 'Tokyo' });
    });

    it('should emit text chunks interleaved with tool calls from multiple tools', async () => {
      const sseChunks = [
        // 文本
        makeSSE({
          id: 'chatcmpl-mix2',
          choices: [
            {
              delta: { content: 'I will look that up.' },
              index: 0,
            },
          ],
        }),
        // 第一个工具调用
        makeSSE({
          id: 'chatcmpl-mix2',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_m2a',
                    type: 'function',
                    function: {
                      name: 'search',
                      arguments: '{"q":"weather"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        // 第二个工具调用（同时出现）
        makeSSE({
          id: 'chatcmpl-mix2',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_m2b',
                    type: 'function',
                    function: {
                      name: 'get_time',
                      arguments: '{"tz":"UTC"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-mix2',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      // 文本事件
      const chunkEvents = events.filter(
        (e) => e.type === 'assistant_chunk'
      );
      expect(chunkEvents).toHaveLength(1);
      expect((chunkEvents[0] as any).text).toBe(
        'I will look that up.'
      );

      // 工具调用事件
      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(2);

      const names = toolCallEvents.map(
        (e) => (e as any).call.toolName
      );
      expect(names).toContain('search');
      expect(names).toContain('get_time');
    });
  });

  // ----------------------------------------------------------
  // 事件结构验证
  // ----------------------------------------------------------
  describe('Event Structure', () => {
    it('should emit tool_call event with all required fields: id, toolName, input', async () => {
      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-struct',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_struct',
                    type: 'function',
                    function: {
                      name: 'my_tool',
                      arguments: '{"key":"value","num":42}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-struct',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();

      const call = (toolCallEvent as any).call;

      // 验证三个必要字段都存在且类型正确
      expect(typeof call.id).toBe('string');
      expect(call.id).toBe('call_struct');

      expect(typeof call.toolName).toBe('string');
      expect(call.toolName).toBe('my_tool');

      expect(typeof call.input).toBe('object');
      expect(call.input).not.toBeNull();
      expect(call.input).toEqual({ key: 'value', num: 42 });
    });

    it('should preserve tool call id from the API response', async () => {
      const sseChunks = [
        makeSSE({
          id: 'chatcmpl-id',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_unique_12345',
                    type: 'function',
                    function: {
                      name: 'verify',
                      arguments: '{}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
        makeSSE({
          id: 'chatcmpl-id',
          choices: [
            { delta: {}, finish_reason: 'tool_calls', index: 0 },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(sseChunks);
      mockFetch.mockResolvedValueOnce(response);

      const provider = createOpenAIProvider(baseSettings);
      const events = await lastValueFrom(
        provider.runStep(makeStepInput()).pipe(toArray())
      );

      const toolCallEvents = events.filter(
        (e) => e.type === 'tool_call'
      );
      expect(toolCallEvents).toHaveLength(1);

      // id 必须与 API 返回的 id 完全一致
      expect((toolCallEvents[0] as any).call.id).toBe(
        'call_unique_12345'
      );
    });
  });
});
