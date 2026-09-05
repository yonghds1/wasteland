import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, lastValueFrom, of, from, toArray } from 'rxjs';
import { runAgentLoop } from './agent-loop.js';
import type { ChatInputTurn } from './event-types.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import type { PermissionGate } from './permission-gate.js';
import type { SessionManager } from './session-manager.js';
import type { AgentTool } from '@tools/tool-types.js';

// Mock providers that emit multiple tool_call events
function createMockProvider(toolCalls: Array<{ id: string; toolName: string; input: Record<string, unknown> }>): AgentProvider {
  return {
    id: 'mock-provider',
    runStep: () => {
      return from(
        toolCalls.map((call) => ({
          type: 'tool_call' as const,
          call,
        }))
      );
    },
  };
}

describe('agent-loop parallel execution', () => {
  const mockSession = {
    id: 'test-session',
    filePath: '/tmp/test-session.jsonl',
  };

  const mockSessionManager = {
    startSession: vi.fn().mockResolvedValue(mockSession),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    appendRecord: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue([]),
  } as unknown as SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should buffer provider events and process them together', async () => {
    // Create a provider that emits assistant_chunk followed by assistant_message
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        return from([
          { type: 'assistant_chunk' as const, text: 'Hello ' },
          { type: 'assistant_chunk' as const, text: 'world' },
          { type: 'assistant_message' as const, text: 'Hello world' },
        ]);
      },
    };

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'test input',
      source: 'message',
    });

    const { events$ } = runAgentLoop({
      input$,
      provider,
      existingSession: mockSession as never,
      sessionManager: mockSessionManager,
      mode: 'single',
      cwd: '/tmp',
      maxStepsPerTurn: 8,
    });

    const events = await lastValueFrom(events$.pipe(toArray()));

    // Should have user_turn, assistant_chunk events, and assistant_message
    expect(events.some((e) => e.type === 'user_turn')).toBe(true);
    expect(events.some((e) => e.type === 'assistant_chunk')).toBe(true);
    expect(events.some((e) => e.type === 'assistant_message')).toBe(true);
  });

  it('should handle single tool call correctly', async () => {
    const provider = createMockProvider([
      { id: 'call-1', toolName: 'read-file', input: { path: 'test.txt' } },
    ]);

    const mockTool: AgentTool = {
      name: 'read-file',
      description: 'Read file',
      riskLevel: 'read',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({
        status: 'success',
        output: 'file content',
      }),
    };
    const mockToolRegistry = new ToolRegistry([mockTool]);

    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'read test.txt',
      source: 'message',
    });

    const { events$ } = runAgentLoop({
      input$,
      provider,
      existingSession: mockSession as never,
      sessionManager: mockSessionManager,
      toolRegistry: mockToolRegistry,
      permissionGate: mockPermissionGate,
      mode: 'single',
      cwd: '/tmp',
      maxStepsPerTurn: 8,
    });

    const events = await lastValueFrom(events$.pipe(toArray()));

    // Should have tool_started, tool_result events (tool_call is dispatched internally)
    expect(events.some((e) => e.type === 'tool_started')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('should handle multiple tool calls in sequence', async () => {
    let providerCallCount = 0;
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        providerCallCount++;
        // First call: emit 2 tool calls
        // Second call: emit assistant_message (stop the loop)
        if (providerCallCount === 1) {
          return from([
            { type: 'tool_call' as const, call: { id: 'call-1', toolName: 'read-file', input: { path: 'file1.txt' } } },
            { type: 'tool_call' as const, call: { id: 'call-2', toolName: 'read-file', input: { path: 'file2.txt' } } },
          ]);
        }
        return from([
          { type: 'assistant_message' as const, text: 'Done' },
        ]);
      },
    };

    const mockTool: AgentTool = {
      name: 'read-file',
      description: 'Read file',
      riskLevel: 'read',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({
        status: 'success',
        output: 'content',
      }),
    };
    const mockToolRegistry = new ToolRegistry([mockTool]);

    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'read files',
      source: 'message',
    });

    const { events$ } = runAgentLoop({
      input$,
      provider,
      existingSession: mockSession as never,
      sessionManager: mockSessionManager,
      toolRegistry: mockToolRegistry,
      permissionGate: mockPermissionGate,
      mode: 'single',
      cwd: '/tmp',
      maxStepsPerTurn: 8,
    });

    const events = await lastValueFrom(events$.pipe(toArray()));

    // Should have tool_started events for both calls (tool_call is dispatched internally)
    const toolStarted = events.filter((e) => e.type === 'tool_started');
    expect(toolStarted.length).toBe(2);
  });

  it('should emit events in correct order', async () => {
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        return from([
          { type: 'assistant_chunk' as const, text: 'Processing...' },
          { type: 'assistant_message' as const, text: 'Done' },
        ]);
      },
    };

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'test',
      source: 'message',
    });

    const { events$ } = runAgentLoop({
      input$,
      provider,
      existingSession: mockSession as never,
      sessionManager: mockSessionManager,
      mode: 'single',
      cwd: '/tmp',
      maxStepsPerTurn: 8,
    });

    const events = await lastValueFrom(events$.pipe(toArray()));

    // Events should be in order: user_turn, assistant_chunk, assistant_message
    const types = events.map((e) => e.type);
    const userTurnIndex = types.indexOf('user_turn');
    const chunkIndex = types.indexOf('assistant_chunk');
    const messageIndex = types.indexOf('assistant_message');

    expect(userTurnIndex).toBeLessThan(chunkIndex);
    expect(chunkIndex).toBeLessThan(messageIndex);
  });
});
