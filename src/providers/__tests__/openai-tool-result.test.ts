/**
 * openai-tool-result.test.ts - OpenAI Provider 端到端测试：Tool result 回灌后继续推理
 *
 * 测试工具执行结果正确回灌到对话历史后，Provider 能继续生成响应。
 * 覆盖场景：单轮工具调用、多轮工具调用、工具调用链。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { createOpenAIProvider } from '../openai.js';
import type { ProviderSettings } from '@config/settings-types.js';
import type { TurnContext } from '@core/runtime/turn-context.js';
import type { TurnState, TurnToolResult } from '@core/engine/turn-state.js';
import type { HistoryRecord } from '@core/runtime/event-types.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type { AgentTool } from '@tools/core/tool-types.js';

// ============================================================
// Helpers
// ============================================================

/** Build SSE data lines from a list of JSON chunks */
function buildSSE(...chunks: object[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** Build a text response SSE stream */
function textSSE(text: string, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): string {
  const chunks: object[] = [];

  // Initial role chunk
  chunks.push({
    id: 'chatcmpl-test',
    choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }],
  });

  // Content chunks (split into individual characters for streaming)
  for (const char of text) {
    chunks.push({
      id: 'chatcmpl-test',
      choices: [{ index: 0, delta: { content: char }, finish_reason: null }],
    });
  }

  // Finish chunk
  chunks.push({
    id: 'chatcmpl-test',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });

  // Usage chunk
  if (usage) {
    chunks.push({ id: 'chatcmpl-test', usage });
  }

  return buildSSE(...chunks);
}

/** Build a tool-call response SSE stream */
function toolCallSSE(
  calls: Array<{ id: string; name: string; arguments: string }>,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
): string {
  const chunks: object[] = [];

  // Initial role chunk
  chunks.push({
    id: 'chatcmpl-test',
    choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }],
  });

  // Tool call chunks (one chunk per call)
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    chunks.push({
      id: 'chatcmpl-test',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: i,
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  }

  // Finish chunk
  chunks.push({
    id: 'chatcmpl-test',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  });

  // Usage chunk
  if (usage) {
    chunks.push({ id: 'chatcmpl-test', usage });
  }

  return buildSSE(...chunks);
}

/** Create a ReadableStream from a string (for mocking fetch Response.body) */
function stringToReadableStream(str: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      // Send in small chunks to simulate streaming
      const chunkSize = Math.min(64, data.length - offset);
      controller.enqueue(data.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

/** Create a mock fetch Response */
function mockResponse(sseBody: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stringToReadableStream(sseBody),
    json: async () => ({}),
    headers: new Headers(),
    redirected: false,
    statusText: 'OK',
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockResponse(sseBody, status),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    bytes: async () => new Uint8Array(),
    text: async () => sseBody,
  } as Response;
}

/** Build a minimal TurnContext */
function buildContext(params: {
  history?: readonly HistoryRecord[];
  input?: string;
  toolRegistry?: ToolRegistry;
  prompt?: string;
}): TurnContext {
  return {
    sessionId: 'test-session',
    turn: 1,
    input: { turn: 1, content: params.input ?? 'test input', source: 'interactive' },
    cwd: '/tmp',
    history: params.history ?? [],
    toolRegistry: params.toolRegistry,
    prompt: params.prompt,
  };
}

/** Build a minimal TurnState */
function buildState(params: {
  toolResults?: readonly TurnToolResult[];
  step?: number;
}): TurnState {
  return {
    sessionId: 'test-session',
    turn: 1,
    cwd: '/tmp',
    input: { turn: 1, content: 'test input', source: 'interactive' },
    history: [],
    step: params.step ?? 1,
    status: 'running',
    assistantChunks: [],
    toolCalls: [],
    toolResults: params.toolResults ?? [],
  };
}

/** Create a mock AgentTool */
function createMockTool(name: string, output: string): AgentTool {
  return {
    name,
    riskLevel: 'read' as const,
    description: `Mock ${name} tool`,
    inputSchema: { type: 'object' as const },
    execute: async () => ({ status: 'success' as const, output }),
  };
}

// ============================================================
// Tests
// ============================================================

describe('OpenAI Tool Result Feedback', () => {
  const defaultSettings: ProviderSettings = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4',
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // Test 1: Single tool call - result feedback continues inference
  // ----------------------------------------------------------
  describe('single tool call', () => {
    it('should continue inference after tool result is fed back', async () => {
      const provider = createOpenAIProvider(defaultSettings);

      // Step 1: Provider returns a tool call
      fetchSpy.mockResolvedValueOnce(
        mockResponse(
          toolCallSSE([
            { id: 'call_001', name: 'read-file', arguments: '{"path":"src/index.ts"}' },
          ])
        )
      );

      const context1 = buildContext({ input: 'read the file src/index.ts' });
      const state1 = buildState({ step: 1 });

      const events1 = await lastValueFrom(provider.runStep({ context: context1, state: state1 }).pipe(toArray()));

      // Verify step 1: should have tool_call event
      const toolCallEvents1 = events1.filter((e) => e.type === 'tool_call');
      expect(toolCallEvents1).toHaveLength(1);
      expect(toolCallEvents1[0]).toMatchObject({
        type: 'tool_call',
        call: {
          id: 'call_001',
          toolName: 'read-file',
          input: { path: 'src/index.ts' },
        },
      });

      // Step 2: Tool result is fed back, provider generates final response
      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('The file src/index.ts contains the main entry point.'))
      );

      // In the runtime, state.toolResults captures the current turn's results.
      // History only contains records from PREVIOUS turns.
      // buildMessages adds tool_call + tool messages from state.toolResults
      // after the user input, so we don't duplicate them in history.
      const toolResults: TurnToolResult[] = [
        {
          callId: 'call_001',
          toolName: 'read-file',
          input: { path: 'src/index.ts' },
          status: 'success',
          output: 'const main = () => { ... }',
        },
      ];

      const context2 = buildContext({ input: 'read the file src/index.ts' });
      const state2 = buildState({ toolResults, step: 2 });

      const events2 = await lastValueFrom(provider.runStep({ context: context2, state: state2 }).pipe(toArray()));

      // Verify step 2: should have text response (no tool_call)
      const toolCallEvents2 = events2.filter((e) => e.type === 'tool_call');
      expect(toolCallEvents2).toHaveLength(0);

      const textContent = events2
        .filter((e): e is { type: 'assistant_chunk'; text: string } => e.type === 'assistant_chunk')
        .map((e) => e.text)
        .join('');
      expect(textContent).toBe('The file src/index.ts contains the main entry point.');

      // Verify fetch was called twice
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify the second request body contains tool results
      const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      expect(secondCallBody.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'read the file src/index.ts' }),
          expect.objectContaining({
            role: 'assistant',
            content: null,
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                id: 'call_001',
                type: 'function',
                function: expect.objectContaining({
                  name: 'read-file',
                  arguments: '{"path":"src/index.ts"}',
                }),
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'call_001',
            content: 'const main = () => { ... }',
          }),
        ])
      );
    });
  });

  // ----------------------------------------------------------
  // Test 2: Multi-round tool calls
  // ----------------------------------------------------------
  describe('multi-round tool calls', () => {
    it('should handle two consecutive tool calls with results', async () => {
      const provider = createOpenAIProvider(defaultSettings);
      const toolRegistry = new ToolRegistry([
        createMockTool('read-file', 'file content'),
        createMockTool('edit-file', 'edited'),
      ]);

      // Step 1: Provider requests read-file
      fetchSpy.mockResolvedValueOnce(
        mockResponse(
          toolCallSSE([
            { id: 'call_101', name: 'read-file', arguments: '{"path":"config.json"}' },
          ])
        )
      );

      const context1 = buildContext({
        input: 'update config.json',
        toolRegistry,
      });
      const state1 = buildState({ step: 1 });

      const events1 = await lastValueFrom(provider.runStep({ context: context1, state: state1 }).pipe(toArray()));
      const tc1 = events1.filter((e) => e.type === 'tool_call');
      expect(tc1).toHaveLength(1);
      expect(tc1[0]).toMatchObject({
        type: 'tool_call',
        call: expect.objectContaining({ toolName: 'read-file', id: 'call_101' }),
      });

      // Step 2: Result of read-file fed back, provider requests edit-file
      fetchSpy.mockResolvedValueOnce(
        mockResponse(
          toolCallSSE([
            {
              id: 'call_102',
              name: 'edit-file',
              arguments: '{"path":"config.json","old_string":"a","new_string":"b"}',
            },
          ])
        )
      );

      // state.toolResults captures the current turn's results.
      // History is empty for the current turn's in-progress work.
      const toolResults2: TurnToolResult[] = [
        {
          callId: 'call_101',
          toolName: 'read-file',
          input: { path: 'config.json' },
          status: 'success',
          output: '{"version":"1.0"}',
        },
      ];

      const context2 = buildContext({
        input: 'update config.json',
        toolRegistry,
      });
      const state2 = buildState({ toolResults: toolResults2, step: 2 });

      const events2 = await lastValueFrom(provider.runStep({ context: context2, state: state2 }).pipe(toArray()));
      const tc2 = events2.filter((e) => e.type === 'tool_call');
      expect(tc2).toHaveLength(1);
      expect(tc2[0]).toMatchObject({
        type: 'tool_call',
        call: expect.objectContaining({ toolName: 'edit-file', id: 'call_102' }),
      });

      // Step 3: Result of edit-file fed back, provider generates final response
      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('Done. I have updated config.json.'))
      );

      // state.toolResults now has both results (read-file from step 2, edit-file from step 2's tool call)
      const toolResults3: TurnToolResult[] = [
        {
          callId: 'call_101',
          toolName: 'read-file',
          input: { path: 'config.json' },
          status: 'success',
          output: '{"version":"1.0"}',
        },
        {
          callId: 'call_102',
          toolName: 'edit-file',
          input: {
            path: 'config.json',
            old_string: 'a',
            new_string: 'b',
          },
          status: 'success',
          output: 'edited',
        },
      ];

      const context3 = buildContext({
        input: 'update config.json',
        toolRegistry,
      });
      const state3 = buildState({ toolResults: toolResults3, step: 3 });

      const events3 = await lastValueFrom(provider.runStep({ context: context3, state: state3 }).pipe(toArray()));
      const tc3 = events3.filter((e) => e.type === 'tool_call');
      expect(tc3).toHaveLength(0);

      const text3 = events3
        .filter((e): e is { type: 'assistant_chunk'; text: string } => e.type === 'assistant_chunk')
        .map((e) => e.text)
        .join('');
      expect(text3).toBe('Done. I have updated config.json.');

      // Total fetch calls: 3
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Verify the second request includes read-file result in history
      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      expect(secondBody.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: null,
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                function: expect.objectContaining({ name: 'read-file' }),
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'call_101',
            content: '{"version":"1.0"}',
          }),
        ])
      );
    });
  });

  // ----------------------------------------------------------
  // Test 3: Tool call chain (parallel tool calls in single response)
  // ----------------------------------------------------------
  describe('tool call chain (parallel tools)', () => {
    it('should handle multiple parallel tool calls in a single response', async () => {
      const provider = createOpenAIProvider(defaultSettings);
      const toolRegistry = new ToolRegistry([
        createMockTool('read-file', 'file content'),
        createMockTool('list-files', 'file1.ts\nfile2.ts'),
      ]);

      // Step 1: Provider requests two tools at once
      fetchSpy.mockResolvedValueOnce(
        mockResponse(
          toolCallSSE([
            { id: 'call_201', name: 'read-file', arguments: '{"path":"src/main.ts"}' },
            { id: 'call_202', name: 'list-files', arguments: '{"path":"src/"}' },
          ])
        )
      );

      const context1 = buildContext({
        input: 'explore the src directory',
        toolRegistry,
      });
      const state1 = buildState({ step: 1 });

      const events1 = await lastValueFrom(provider.runStep({ context: context1, state: state1 }).pipe(toArray()));
      const tc1 = events1.filter((e) => e.type === 'tool_call');
      expect(tc1).toHaveLength(2);

      const toolNames = tc1.map((e) => (e as { type: 'tool_call'; call: { toolName: string } }).call.toolName).sort();
      expect(toolNames).toEqual(['list-files', 'read-file']);

      // Step 2: Both results fed back, provider generates final response
      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('The src directory contains main.ts and other files.'))
      );

      const toolResults2: TurnToolResult[] = [
        {
          callId: 'call_201',
          toolName: 'read-file',
          input: { path: 'src/main.ts' },
          status: 'success',
          output: 'const main = () => {}',
        },
        {
          callId: 'call_202',
          toolName: 'list-files',
          input: { path: 'src/' },
          status: 'success',
          output: 'file1.ts\nfile2.ts',
        },
      ];

      const context2 = buildContext({
        input: 'explore the src directory',
        toolRegistry,
      });
      const state2 = buildState({ toolResults: toolResults2, step: 2 });

      const events2 = await lastValueFrom(provider.runStep({ context: context2, state: state2 }).pipe(toArray()));
      const tc2 = events2.filter((e) => e.type === 'tool_call');
      expect(tc2).toHaveLength(0);

      const text2 = events2
        .filter((e): e is { type: 'assistant_chunk'; text: string } => e.type === 'assistant_chunk')
        .map((e) => e.text)
        .join('');
      expect(text2).toBe('The src directory contains main.ts and other files.');

      // Verify the second request body has both tool results
      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      const toolMessages = secondBody.messages.filter(
        (m: { role: string }) => m.role === 'tool'
      );
      expect(toolMessages).toHaveLength(2);

      const toolCallIds = toolMessages.map(
        (m: { tool_call_id: string }) => m.tool_call_id
      ).sort();
      expect(toolCallIds).toEqual(['call_201', 'call_202']);

      // Verify assistant message with both tool_calls is present
      const assistantMsgs = secondBody.messages.filter(
        (m: { role: string; tool_calls?: unknown[] }) =>
          m.role === 'assistant' && m.tool_calls
      );
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].tool_calls).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------
  // Test 4: Tool result with error status
  // ----------------------------------------------------------
  describe('tool result with error', () => {
    it('should handle tool error result fed back correctly', async () => {
      const provider = createOpenAIProvider(defaultSettings);

      // Step 1: Provider requests a tool call
      fetchSpy.mockResolvedValueOnce(
        mockResponse(
          toolCallSSE([
            { id: 'call_301', name: 'read-file', arguments: '{"path":"nonexistent.ts"}' },
          ])
        )
      );

      const context1 = buildContext({ input: 'read nonexistent.ts' });
      const state1 = buildState({ step: 1 });

      const events1 = await lastValueFrom(provider.runStep({ context: context1, state: state1 }).pipe(toArray()));
      expect(events1.filter((e) => e.type === 'tool_call')).toHaveLength(1);

      // Step 2: Tool returned error, result fed back
      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('The file does not exist. Please check the path.'))
      );

      const toolResults2: TurnToolResult[] = [
        {
          callId: 'call_301',
          toolName: 'read-file',
          input: { path: 'nonexistent.ts' },
          status: 'error',
          error: 'ENOENT: no such file or directory',
        },
      ];

      const context2 = buildContext({
        input: 'read nonexistent.ts',
      });
      const state2 = buildState({ toolResults: toolResults2, step: 2 });

      const events2 = await lastValueFrom(provider.runStep({ context: context2, state: state2 }).pipe(toArray()));
      const tc2 = events2.filter((e) => e.type === 'tool_call');
      expect(tc2).toHaveLength(0);

      const text2 = events2
        .filter((e): e is { type: 'assistant_chunk'; text: string } => e.type === 'assistant_chunk')
        .map((e) => e.text)
        .join('');
      expect(text2).toBe('The file does not exist. Please check the path.');

      // Verify the error message is in the request body
      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      const toolMsgs = secondBody.messages.filter(
        (m: { role: string }) => m.role === 'tool'
      );
      expect(toolMsgs).toHaveLength(1);
      expect(toolMsgs[0].content).toBe('ENOENT: no such file or directory');
    });
  });

  // ----------------------------------------------------------
  // Test 5: Message history structure validation
  // ----------------------------------------------------------
  describe('message history structure', () => {
    it('should build correct message history with tool call and result in history records', async () => {
      const provider = createOpenAIProvider(defaultSettings);

      // Provider returns final text response
      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('Analysis complete.'))
      );

      // History with prior tool_call and tool_result
      const history: HistoryRecord[] = [
        {
          type: 'message',
          role: 'user',
          turn: 1,
          content: 'analyze the project',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'tool_call',
          sessionId: 'test-session',
          turn: 1,
          callId: 'call_401',
          toolName: 'list-files',
          input: { path: '.' },
          timestamp: new Date().toISOString(),
        },
        {
          type: 'tool_result',
          sessionId: 'test-session',
          turn: 1,
          callId: 'call_401',
          toolName: 'list-files',
          status: 'success',
          output: 'src/\npackage.json',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'message',
          role: 'assistant',
          turn: 1,
          content: 'I see the project structure.',
          timestamp: new Date().toISOString(),
        },
      ];

      const context = buildContext({
        history,
        input: 'what do you think?',
      });
      const state = buildState({ step: 1 });

      await lastValueFrom(provider.runStep({ context, state }).pipe(toArray()));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      const messages = body.messages;

      // Verify structure:
      // 1. user message
      // 2. assistant with tool_calls (from history tool_call record)
      // 3. tool result (from history tool_result record)
      // 4. assistant text (from history message record)
      // 5. current user input
      expect(messages[0]).toMatchObject({ role: 'user', content: 'analyze the project' });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        content: null,
        tool_calls: expect.arrayContaining([
          expect.objectContaining({
            id: 'call_401',
            type: 'function',
            function: expect.objectContaining({ name: 'list-files' }),
          }),
        ]),
      });
      expect(messages[2]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call_401',
        content: 'src/\npackage.json',
      });
      expect(messages[3]).toMatchObject({ role: 'assistant', content: 'I see the project structure.' });
      expect(messages[4]).toMatchObject({ role: 'user', content: 'what do you think?' });
    });

    it('should include system prompt as first message when provided', async () => {
      const provider = createOpenAIProvider(defaultSettings);

      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('OK'))
      );

      const context = buildContext({
        input: 'hello',
        prompt: 'You are a helpful assistant.',
      });
      const state = buildState({ step: 1 });

      await lastValueFrom(provider.runStep({ context, state }).pipe(toArray()));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.messages[0]).toMatchObject({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });
  });

  // ----------------------------------------------------------
  // Test 6: Tool results fed back via state.toolResults
  // ----------------------------------------------------------
  describe('state.toolResults message construction', () => {
    it('should construct assistant + tool messages from state.toolResults', async () => {
      const provider = createOpenAIProvider(defaultSettings);

      fetchSpy.mockResolvedValueOnce(
        mockResponse(textSSE('Done.'))
      );

      const toolResults: TurnToolResult[] = [
        {
          callId: 'call_501',
          toolName: 'bash',
          input: { command: 'ls -la' },
          status: 'success',
          output: 'total 0\ndrwxr-xr-x',
        },
        {
          callId: 'call_502',
          toolName: 'read-file',
          input: { path: 'package.json' },
          status: 'success',
          output: '{"name":"my-project"}',
        },
      ];

      const context = buildContext({ input: 'explore the project' });
      const state = buildState({ toolResults, step: 2 });

      await lastValueFrom(provider.runStep({ context, state }).pipe(toArray()));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      const messages = body.messages;

      // Messages should be:
      // 0: user input
      // 1: assistant with tool_calls (from toolResults)
      // 2: tool result for call_501
      // 3: tool result for call_502
      expect(messages).toHaveLength(4);

      expect(messages[0]).toMatchObject({ role: 'user', content: 'explore the project' });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_501',
            type: 'function',
            function: {
              name: 'bash',
              arguments: '{"command":"ls -la"}',
            },
          },
          {
            id: 'call_502',
            type: 'function',
            function: {
              name: 'read-file',
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      });
      expect(messages[2]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call_501',
        content: 'total 0\ndrwxr-xr-x',
      });
      expect(messages[3]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call_502',
        content: '{"name":"my-project"}',
      });
    });
  });
});
