/**
 * 并行 spawn_agent 集成测试
 *
 * 测试多个 spawn_agent 并行执行的场景
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, lastValueFrom, of, from, toArray } from 'rxjs';
import { runAgentLoop } from './agent-loop.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import type { AgentTool } from '@tools/tool-types.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { ChatInputTurn } from '../runtime/event-types.js';
import type { SessionManager } from '../session/session-manager.js';
import type { PermissionGate } from './permission-gate.js';

describe('Parallel spawn_agent integration', () => {
  const mockSession = {
    id: 'test-session-parallel',
    filePath: '/tmp/test-session-parallel.jsonl',
  };

  const mockSessionManager = {
    startSession: vi.fn().mockResolvedValue(mockSession),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    appendRecord: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue([]),
    createChildSession: vi.fn().mockResolvedValue({
      id: 'child-session',
      filePath: '/tmp/child-session.jsonl',
    }),
  } as unknown as SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute multiple tool calls from single provider step', async () => {
    // Create mock tools
    const mockReadFileTool: AgentTool = {
      name: 'read-file',
      description: 'Read file',
      riskLevel: 'read',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({
        status: 'success' as const,
        output: 'File content',
      }),
    };

    const mockToolRegistry = new ToolRegistry([mockReadFileTool]);

    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    // Provider that emits 3 read-file calls
    let providerCallCount = 0;
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          // First call: emit 3 read-file calls
          return from([
            {
              type: 'tool_call' as const,
              call: { id: 'read-1', toolName: 'read-file', input: { path: 'file1.txt' } },
            },
            {
              type: 'tool_call' as const,
              call: { id: 'read-2', toolName: 'read-file', input: { path: 'file2.txt' } },
            },
            {
              type: 'tool_call' as const,
              call: { id: 'read-3', toolName: 'read-file', input: { path: 'file3.txt' } },
            },
          ]);
        }
        // Second call: return assistant message
        return from([
          { type: 'assistant_message' as const, text: 'All files read' },
        ]);
      },
    };

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'Read 3 files',
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

    // Verify all 3 tools were executed
    expect(mockReadFileTool.execute).toHaveBeenCalledTimes(3);

    // Verify events include tool results for all 3 calls
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(3);

    // Verify tool results are in order
    const toolResultCallIds = toolResults.map((e) => e.callId);
    expect(toolResultCallIds).toEqual(['read-1', 'read-2', 'read-3']);
  });

  it('should handle single tool call correctly', async () => {
    const mockReadFileTool: AgentTool = {
      name: 'read-file',
      description: 'Read file',
      riskLevel: 'read',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({
        status: 'success' as const,
        output: 'File content',
      }),
    };

    const mockToolRegistry = new ToolRegistry([mockReadFileTool]);

    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    let providerCallCount = 0;
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return from([
            {
              type: 'tool_call' as const,
              call: { id: 'read-1', toolName: 'read-file', input: { path: 'file.txt' } },
            },
          ]);
        }
        return from([
          { type: 'assistant_message' as const, text: 'Done' },
        ]);
      },
    };

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'Read a file',
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

    // Verify tool was executed
    expect(mockReadFileTool.execute).toHaveBeenCalledTimes(1);

    // Verify events include tool result
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].callId).toBe('read-1');
  });

  it('should emit events in correct order', async () => {
    const mockReadFileTool: AgentTool = {
      name: 'read-file',
      description: 'Read file',
      riskLevel: 'read',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({
        status: 'success' as const,
        output: 'File content',
      }),
    };

    const mockToolRegistry = new ToolRegistry([mockReadFileTool]);

    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    let providerCallCount = 0;
    const provider: AgentProvider = {
      id: 'test-provider',
      runStep: () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return from([
            { type: 'assistant_chunk' as const, text: 'Processing...' },
            {
              type: 'tool_call' as const,
              call: { id: 'read-1', toolName: 'read-file', input: { path: 'file.txt' } },
            },
          ]);
        }
        return from([
          { type: 'assistant_message' as const, text: 'Done' },
        ]);
      },
    };

    const input$: Observable<ChatInputTurn> = of({
      turn: 1,
      content: 'Process and read',
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

    // Verify events are in order
    const types = events.map((e) => e.type);
    const userTurnIndex = types.indexOf('user_turn');
    const chunkIndex = types.indexOf('assistant_chunk');
    const toolResultIndex = types.indexOf('tool_result');
    const assistantMessageIndex = types.indexOf('assistant_message');

    expect(userTurnIndex).toBeLessThan(chunkIndex);
    expect(chunkIndex).toBeLessThan(toolResultIndex);
    expect(toolResultIndex).toBeLessThan(assistantMessageIndex);
  });
});
