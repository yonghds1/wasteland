/**
 * doom-loop-circuit-breaker.test.ts - 死循环熔断防护机制针对性测试
 *
 * 覆盖：
 * - 连续同名同参工具调用达到阈值（连续 3 次）主动熔断中断
 * - 连续工具执行出错（模型固执重试相同参数）时的熔断保护与工具执行阻断
 * - 工具参数交替变化时不触发误熔断（计数器重置）
 * - 自定义熔断阈值（如 threshold = 2）即时生效
 * - 熔断后生成可解释的说明文案、持久化会话记录且避免无限 Token 吞噬与死锁
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { lastValueFrom, toArray, from, type Observable } from 'rxjs';
import { initI18n } from '@locales/i18n.js';
import { runAgentLoop } from '../agent-loop.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type { AgentTool } from '@tools/core/tool-types.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { PermissionGate } from '../permission-gate.js';
import type { DebugTraceEvent } from '../../runtime/debug-events.js';
import type { ChatInputTurn, RuntimeEvent } from '../../runtime/event-types.js';
import type { SessionManager, SessionMetadata } from '../../session/session-manager.js';

beforeAll(async () => {
  await initI18n('zh');
});

const mockPermissionGate = {
  evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
} as unknown as PermissionGate;

function createMockTool(
  name: string,
  handler?: (input: Record<string, unknown>) => Promise<{ status: 'success' | 'error'; output?: string; error?: string }>
): { tool: AgentTool; getCallCount: () => number } {
  let calls = 0;
  const tool = {
    name,
    riskLevel: 'read',
    async execute(input: Record<string, unknown>) {
      calls++;
      return handler ? handler(input) : { status: 'success', output: 'ok' };
    },
  } as unknown as AgentTool;
  return { tool, getCallCount: () => calls };
}

function createMockSessionManager() {
  const records: Array<Record<string, unknown>> = [];
  return {
    manager: {
      startSession: vi.fn().mockResolvedValue({
        id: 'test-session-circuit-breaker',
        path: '/tmp/test-session-cb.jsonl',
        mode: 'single',
        cwd: '/tmp',
        providerId: 'mock-provider',
      } as SessionMetadata),
      appendRecord: vi.fn().mockImplementation((_session: unknown, record: Record<string, unknown>) => {
        records.push(record);
        return Promise.resolve();
      }),
    } as unknown as SessionManager,
    records,
  };
}

function createInput$(...turns: string[]): Observable<ChatInputTurn> {
  return from(turns.map((content, i) => ({ turn: i + 1, content, source: 'message' as const })));
}

async function collectEvents(obs: Observable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  return lastValueFrom(obs.pipe(toArray()));
}

describe('Doom Loop 死循环熔断防护 (Circuit Breaker)', () => {
  it('连续 3 次相同工具调用熔断：Provider 停止调用，防止无限吞噬 Token 和死锁', async () => {
    let providerCalls = 0;
    const provider: AgentProvider = {
      id: 'looping-provider',
      runStep: () => {
        providerCalls++;
        return from([
          { type: 'tool_call', call: { id: `c-${providerCalls}`, toolName: 'fetch_data', input: { url: 'https://api.test' } } },
        ] as never[]);
      },
    } as unknown as AgentProvider;

    const mockTool = createMockTool('fetch_data');
    const session = createMockSessionManager();
    const run = runAgentLoop({
      provider,
      input$: createInput$('fetch something'),
      sessionManager: session.manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry: new ToolRegistry([mockTool.tool]),
      permissionGate: mockPermissionGate,
      doomLoopThreshold: 3,
    });

    const debugEvents: DebugTraceEvent[] = [];
    run.debug$.subscribe((e) => debugEvents.push(e));

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    // Provider 严格在第 3 步被截断，绝不发生第 4 步调用
    expect(providerCalls).toBe(3);
    // 熔断触发并生成解释性消息，明确包含工具名 fetch_data 与阈值 3
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toContain('fetch_data');
    expect(assistantMsgs[0]?.content).toContain('3');
    // 发出 phase 为 turn.doom_loop 的 debug trace 并持久化
    expect(debugEvents.some((e) => e.phase === 'turn.doom_loop')).toBe(true);
    expect(session.records.some((r) => r.type === 'message' && r.role === 'assistant')).toBe(true);
  });

  it('连续工具执行报错固执重试时触发熔断，且第 3 次工具调用在派发前被阻断', async () => {
    let providerCalls = 0;
    const provider: AgentProvider = {
      id: 'error-retry-provider',
      runStep: () => {
        providerCalls++;
        return from([
          { type: 'tool_call', call: { id: `call-${providerCalls}`, toolName: 'failing_tool', input: { path: '/missing.txt' } } },
        ] as never[]);
      },
    } as unknown as AgentProvider;

    const failingTool = createMockTool('failing_tool', async () => ({
      status: 'error',
      error: 'File not found on filesystem',
    }));

    const run = runAgentLoop({
      provider,
      input$: createInput$('read missing file'),
      sessionManager: createMockSessionManager().manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry: new ToolRegistry([failingTool.tool]),
      permissionGate: mockPermissionGate,
      doomLoopThreshold: 3,
    });

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    expect(providerCalls).toBe(3);
    // 第 1、2 次工具执行失败，第 3 次在 dispatch 之前被熔断拦截，故 tool 实际执行次数为 2
    expect(failingTool.getCallCount()).toBe(2);
    expect(assistantMsgs[0]?.content).toContain('failing_tool');
  });

  it('工具参数交替变化时不触发熔断，允许正常的循环迭代', async () => {
    let step = 0;
    const inputs = [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }];
    const provider: AgentProvider = {
      id: 'paging-provider',
      runStep: () => {
        step++;
        if (step <= 4) {
          return from([
            { type: 'tool_call', call: { id: `page-${step}`, toolName: 'paginate', input: inputs[step - 1] } },
          ] as never[]);
        }
        return from([{ type: 'assistant_message', text: 'All pages fetched' }] as never[]);
      },
    } as unknown as AgentProvider;

    const mockTool = createMockTool('paginate');
    const run = runAgentLoop({
      provider,
      input$: createInput$('fetch all pages'),
      sessionManager: createMockSessionManager().manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry: new ToolRegistry([mockTool.tool]),
      permissionGate: mockPermissionGate,
      doomLoopThreshold: 3,
    });

    const debugEvents: DebugTraceEvent[] = [];
    run.debug$.subscribe((e) => debugEvents.push(e));

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    // 参数每次不同，不满足连续同名同参，4 次均正常派发，最后拿到完成文案
    expect(mockTool.getCallCount()).toBe(4);
    expect(debugEvents.some((e) => e.phase === 'turn.doom_loop')).toBe(false);
    expect(assistantMsgs.some((m) => m.content === 'All pages fetched')).toBe(true);
  });

  it('自定义熔断阈值：threshold = 2 在连续第 2 次即刻触发熔断', async () => {
    let calls = 0;
    const provider: AgentProvider = {
      id: 'fast-loop-provider',
      runStep: () => {
        calls++;
        return from([
          { type: 'tool_call', call: { id: `call-${calls}`, toolName: 'ping', input: { host: '127.0.0.1' } } },
        ] as never[]);
      },
    } as unknown as AgentProvider;

    const mockTool = createMockTool('ping');
    const run = runAgentLoop({
      provider,
      input$: createInput$('ping localhost'),
      sessionManager: createMockSessionManager().manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry: new ToolRegistry([mockTool.tool]),
      permissionGate: mockPermissionGate,
      doomLoopThreshold: 2,
    });

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    expect(calls).toBe(2);
    expect(assistantMsgs[0]?.content).toContain('ping');
    expect(assistantMsgs[0]?.content).toContain('2');
  });
});
