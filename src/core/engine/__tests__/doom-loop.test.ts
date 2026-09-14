/**
 * doom-loop.test.ts - doom loop 检测（判据纯函数 + 守卫集成）
 *
 * 覆盖：
 * - isDoomLoop 纯函数边界（0/1/2 次、达阈值、参数不同、重置、键序无关）
 * - 阈值真正生效（非写死 3）
 * - checkDoomLoop 集成：短路本轮、不再发起 provider 调用、发出 turn.doom_loop trace
 * - 阈值 0 关闭检测：行为回落到既有 maxSteps 兜底
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { lastValueFrom, toArray, from, type Observable } from 'rxjs';

import { initI18n } from '@locales/i18n.js';
import { runAgentLoop } from '../agent-loop.js';
import { isDoomLoop } from '../loop-helpers.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type { AgentTool, ToolCall } from '@tools/core/tool-types.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { DebugTraceEvent } from '../../runtime/debug-events.js';
import type { ChatInputTurn, RuntimeEvent } from '../../runtime/event-types.js';
import type { SessionManager, SessionMetadata } from '../../session/session-manager.js';

// 加载真实字典，让持久化消息断言的是渲染后的文案（含插值）
beforeAll(async () => {
  await initI18n('zh');
});

// ============================================================
// 纯函数：isDoomLoop
// ============================================================

/** 构造一个工具调用 */
function call(toolName: string, input: Record<string, unknown>, id = 'call'): ToolCall {
  return { id, toolName, input };
}

describe('isDoomLoop（纯函数判据）', () => {
  it('调用次数不足阈值时不触发', () => {
    expect(isDoomLoop([], 3)).toBe(false);
    expect(isDoomLoop([call('bash', {})], 3)).toBe(false);
    expect(isDoomLoop([call('bash', {}), call('bash', {})], 3)).toBe(false);
  });

  it('达到阈值（连续同名同参）触发', () => {
    const calls = [call('bash', { cmd: 'ls' }), call('bash', { cmd: 'ls' }), call('bash', { cmd: 'ls' })];
    expect(isDoomLoop(calls, 3)).toBe(true);
  });

  it('第 N 次参数不同不触发', () => {
    const calls = [call('bash', { cmd: 'ls' }), call('bash', { cmd: 'ls' }), call('bash', { cmd: 'pwd' })];
    expect(isDoomLoop(calls, 3)).toBe(false);
  });

  it('第 N 次工具名不同不触发', () => {
    const calls = [call('bash', { cmd: 'ls' }), call('bash', { cmd: 'ls' }), call('read-file', { cmd: 'ls' })];
    expect(isDoomLoop(calls, 3)).toBe(false);
  });

  it('中间插入不同调用后连续段重置', () => {
    const calls = [
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
      call('read-file', { path: 'a' }),
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
    ];
    // 尾部只剩连续 2 次 bash
    expect(isDoomLoop(calls, 3)).toBe(false);
  });

  it('键序不同但语义相同的参数判定为相同', () => {
    const calls = [
      call('bash', { cmd: 'ls', cwd: '/tmp' }),
      call('bash', { cwd: '/tmp', cmd: 'ls' }),
      call('bash', { cmd: 'ls', cwd: '/tmp' }),
    ];
    expect(isDoomLoop(calls, 3)).toBe(true);
  });

  it('嵌套对象的键序同样无关', () => {
    const calls = [
      call('grep', { opts: { ignoreCase: true, files: ['a', 'b'] }, pattern: 'x' }),
      call('grep', { pattern: 'x', opts: { files: ['a', 'b'], ignoreCase: true } }),
      call('grep', { opts: { ignoreCase: true, files: ['a', 'b'] }, pattern: 'x' }),
    ];
    expect(isDoomLoop(calls, 3)).toBe(true);
  });

  it('阈值真的生效：阈值 5 时 4 次不触发，5 次才触发', () => {
    const four = [
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
    ];
    expect(isDoomLoop(four, 5)).toBe(false);
    expect(isDoomLoop([...four, call('bash', { cmd: 'ls' })], 5)).toBe(true);
  });

  it('阈值 <= 0 表示关闭检测', () => {
    const many = [
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
      call('bash', { cmd: 'ls' }),
    ];
    expect(isDoomLoop(many, 0)).toBe(false);
    expect(isDoomLoop(many, -1)).toBe(false);
  });
});

// ============================================================
// 集成：checkDoomLoop 挂在 TurnExecutor 尾部
// ============================================================

/** 创建 mock tool */
function createMockTool(name: string, output = 'tool output'): AgentTool {
  return {
    name,
    riskLevel: 'read',
    async execute() {
      return { status: 'success', output };
    },
  } as unknown as AgentTool;
}

/** 创建 mock SessionManager */
function createMockSessionManager() {
  const records: Array<Record<string, unknown>> = [];
  return {
    manager: {
      startSession: vi.fn().mockResolvedValue({
        id: 'test-session-doom',
        path: '/tmp/test-session-doom.jsonl',
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

/** 创建 input$ Observable */
function createInput$(...turns: string[]): Observable<ChatInputTurn> {
  return from(
    turns.map((content, i) => ({
      turn: i + 1,
      content,
      source: 'message' as const,
    }))
  );
}

/** 收集事件的辅助函数 */
async function collectEvents(obs: Observable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  return lastValueFrom(obs.pipe(toArray()));
}

/** 无限重复同一个工具调用的 provider，并记录被调用次数 */
function createRepeatingProvider(toolName: string, input: Record<string, unknown>) {
  let calls = 0;
  const provider: AgentProvider = {
    id: 'repeating-provider',
    runStep: () => {
      calls++;
      return from([
        {
          type: 'tool_call',
          call: { id: `call-${calls}`, toolName, input },
        },
      ] as never[]);
    },
  } as unknown as AgentProvider;
  return { provider, callCount: () => calls };
}

describe('checkDoomLoop（runAgentLoop 集成）', () => {
  it('默认阈值 3：连续 3 次同名同参触发短路，provider 只被调用 3 次', async () => {
    const { provider, callCount } = createRepeatingProvider('bash', { cmd: 'ls' });
    const toolRegistry = new ToolRegistry([createMockTool('bash')]);
    const session = createMockSessionManager();

    const run = runAgentLoop({
      provider,
      input$: createInput$('Loop forever'),
      sessionManager: session.manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry,
    });

    const debugEvents: DebugTraceEvent[] = [];
    run.debug$.subscribe((e) => debugEvents.push(e));

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    expect(callCount()).toBe(3);
    expect(assistantMsgs[0]?.content).toContain('bash');
    expect(assistantMsgs[0]?.content).toContain('3');
    // 只允许一条说明消息：短路后不得再补一条 provider fallback 消息
    expect(assistantMsgs).toHaveLength(1);
    expect(debugEvents.some((e) => e.phase === 'turn.doom_loop')).toBe(true);
  });

  it('阈值 5：第 3、4 次不触发，第 5 次才触发（阈值真生效）', async () => {
    const { provider, callCount } = createRepeatingProvider('bash', { cmd: 'ls' });
    const toolRegistry = new ToolRegistry([createMockTool('bash')]);
    const session = createMockSessionManager();

    const run = runAgentLoop({
      provider,
      input$: createInput$('Loop forever'),
      sessionManager: session.manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry,
      doomLoopThreshold: 5,
    });

    const events = await collectEvents(run.events$);
    const assistantMsg = events.find((e) => e.type === 'assistant_message') as
      | { type: 'assistant_message'; content: string }
      | undefined;

    expect(callCount()).toBe(5);
    expect(assistantMsg?.content).toContain('5');
  });

  it('参数键序不同判定为相同：第 3 次仍触发', async () => {
    let calls = 0;
    const inputs = [
      { cmd: 'ls', cwd: '/tmp' },
      { cwd: '/tmp', cmd: 'ls' },
      { cmd: 'ls', cwd: '/tmp' },
    ];
    const provider: AgentProvider = {
      id: 'key-order-provider',
      runStep: () => {
        const input = inputs[Math.min(calls, inputs.length - 1)];
        calls++;
        return from([
          { type: 'tool_call', call: { id: `call-${calls}`, toolName: 'bash', input } },
        ] as never[]);
      },
    } as unknown as AgentProvider;
    const toolRegistry = new ToolRegistry([createMockTool('bash')]);

    const run = runAgentLoop({
      provider,
      input$: createInput$('Loop forever'),
      sessionManager: createMockSessionManager().manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry,
    });

    const events = await collectEvents(run.events$);
    const assistantMsg = events.find((e) => e.type === 'assistant_message') as
      | { type: 'assistant_message'; content: string }
      | undefined;

    expect(calls).toBe(3);
    expect(assistantMsg?.content).toContain('bash');
  });

  it('阈值 0 关闭检测：不再短于 3 步，回落到 maxSteps 兜底', async () => {
    const { provider, callCount } = createRepeatingProvider('bash', { cmd: 'ls' });
    const toolRegistry = new ToolRegistry([createMockTool('bash')]);
    const session = createMockSessionManager();

    const run = runAgentLoop({
      provider,
      input$: createInput$('Loop forever'),
      sessionManager: session.manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry,
      doomLoopThreshold: 0,
      maxStepsPerTurn: 5,
    });

    const debugEvents: DebugTraceEvent[] = [];
    run.debug$.subscribe((e) => debugEvents.push(e));

    await collectEvents(run.events$);

    // 关闭后不会被 doom loop 在第 3 步拦下，而是走满 5 步被 maxSteps 兜底
    expect(callCount()).toBe(5);
    expect(debugEvents.some((e) => e.phase === 'turn.doom_loop')).toBe(false);
    expect(session.records.some((r) => r.type === 'message' && r.role === 'assistant')).toBe(true);
  });

  it('不跨 turn 检测：三个 turn 各调一次同名同参工具不触发', async () => {
    // 每个 turn 的 step1 发 tool_call、step2 发 assistant_message，
    // 于是三个 turn 累计 3 次完全相同的 bash 调用——若判据跨 turn 累积就会误触发。
    let step = 0;
    const provider: AgentProvider = {
      id: 'per-turn-provider',
      runStep: () => {
        step += 1;
        return step % 2 === 1
          ? from([
              { type: 'tool_call', call: { id: `call-${step}`, toolName: 'bash', input: { cmd: 'ls' } } },
            ] as never[])
          : from([{ type: 'assistant_message', text: 'done' }] as never[]);
      },
    } as unknown as AgentProvider;
    const toolRegistry = new ToolRegistry([createMockTool('bash')]);

    const run = runAgentLoop({
      provider,
      input$: createInput$('继续', '继续', '继续'),
      sessionManager: createMockSessionManager().manager,
      cwd: '/tmp',
      mode: 'single',
      toolRegistry,
    });

    const debugEvents: DebugTraceEvent[] = [];
    run.debug$.subscribe((e) => debugEvents.push(e));

    const events = await collectEvents(run.events$);
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message') as Array<{
      type: 'assistant_message';
      content: string;
    }>;

    // 三个 turn 都拿到正常收尾消息（若判据跨 turn 累积，第三个 turn 会变成 doom loop 说明消息）
    expect(assistantMsgs.map((m) => m.content)).toEqual(['done', 'done', 'done']);
    expect(debugEvents.some((e) => e.phase === 'turn.doom_loop')).toBe(false);
  });
});
