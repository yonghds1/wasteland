/**
 * tool-dispatch-concurrency.test.ts - 共享 UserInputBridge 下的并发权限提问路由
 *
 * 对应 09-14-subagent-permission-hang H-1：先钉死机制，再谈修法。
 *
 * 背景：主 agent 同批发起多个 spawn_agent 时，子 agent 各自的 tool dispatch 共用
 * 父侧的**同一个** UserInputBridge / PermissionGate（spawn-agent/index.ts 传
 * context.userInputBridge）。实测中并行子 agent 的 bash 提问无人应答，子会话无
 * permission 记录、无 tool_result，静默等到 childAgentTimeout(600s)。
 *
 * 本文件在 dispatch 层验证：并发 ask 是否各自占位、逐个回答是否逐个推进、
 * bridge 暴露给 UI 的状态（isPending / pendingCount / getPendingContext）
 * 是否与等待者 FIFO 一致。
 *
 * 若本文件全绿 → 机制在 dispatch 层是好的，问题在 TUI 侧的状态配对
 *                （state.permission.pending/queue 与 bridge.waiters 的背离）。
 * 若有失败     → 即为 root cause。
 */

import { describe, expect, it } from 'vitest';

import { dispatchToolCall } from '../tool-dispatch.js';
import { SessionManager, type SessionMetadata } from '../../session/session-manager.js';
import { createInitialTurnState, type TurnState } from '../turn-state.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import { createPermissionGate } from '../permission-gate.js';
import { UserInputBridge } from '../user-input-bridge.js';
import type { ToolCall, ToolExecutionResult } from '@tools/core/tool-types.js';
import type { RuntimeEvent } from '../../runtime/event-types.js';

// ============================================================
// Fixtures
// ============================================================

function makeSession(id = 'p'): SessionMetadata {
  return { id, path: `/tmp/${id}.jsonl`, cwd: '/tmp', mode: 'single', providerId: 'local' };
}

function makeCall(callId: string, command: string): ToolCall {
  return { id: callId, toolName: 'bash', input: { command } };
}

function makeTurnState(): TurnState {
  return createInitialTurnState({
    sessionId: 'p',
    input: { turn: 1, content: 'hi', source: 'message' },
    cwd: '/tmp',
    history: [],
  });
}

function makeSessionManagerStub(): SessionManager {
  const sm = Object.create(SessionManager.prototype);
  sm.appendRecord = async (): Promise<void> => {};
  return sm as SessionManager;
}

/** bash 是 execute 风险级：default 模式下必然 ask */
function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register({
    name: 'bash',
    riskLevel: 'execute',
    async execute(input): Promise<ToolExecutionResult> {
      return { status: 'success', output: `ran ${(input as { command?: string }).command ?? ''}` };
    },
  });
  return reg;
}

/**
 * 启动一个并发 dispatch 并把事件收集到数组。
 * 刻意**不**自动回答，由用例显式调用 bridge.provideInput 控制时序。
 */
function collect(events: RuntimeEvent[]): (event: RuntimeEvent) => void {
  return (event: RuntimeEvent): void => {
    events.push(event);
  };
}

/** 让已排队的微任务/宏任务跑完 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 启动一个并发 dispatch（不等待完成，返回事件收集器） */
function startDispatch(opts: {
  bridge: UserInputBridge;
  callId: string;
  command: string;
  session?: SessionMetadata;
}): { events: RuntimeEvent[]; completed: Promise<void> } {
  const events: RuntimeEvent[] = [];
  const completed = new Promise<void>((resolve) => {
    dispatchToolCall({
      session: opts.session ?? makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall(opts.callId, opts.command),
      registry: makeRegistry(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: opts.bridge,
    }).subscribe({
      next: collect(events),
      error: () => resolve(),
      complete: () => resolve(),
    });
  });
  return { events, completed };
}

const typesOf = (events: RuntimeEvent[]): string[] => events.map((e) => e.type);

// ============================================================
// 共享 bridge 的并发提问
// ============================================================

describe('共享 UserInputBridge 下的并发权限提问', () => {
  it('三个并发 ask 各占一个等待者，逐个回答后全部推进到执行', async () => {
    const bridge = new UserInputBridge();

    const runs = [
      startDispatch({ bridge, callId: 'c1', command: 'ls -a' }),
      startDispatch({ bridge, callId: 'c2', command: 'pwd' }),
      startDispatch({ bridge, callId: 'c3', command: 'whoami' }),
    ];

    await flush();

    // 三个请求都应已发出 user_input_requested 并占位
    for (const r of runs) {
      expect(typesOf(r.events)).toContain('user_input_requested');
      // 尚未回答 → 不应有终结事件
      expect(typesOf(r.events)).not.toContain('tool_result');
      expect(typesOf(r.events)).not.toContain('tool_failed');
    }
    expect(bridge.isPending()).toBe(true);
    expect(bridge.pendingCount()).toBe(3);

    // 逐个回答（每次只解一个）
    bridge.provideInput('yes');
    await flush();
    expect(bridge.pendingCount()).toBe(2);

    bridge.provideInput('yes');
    await flush();
    expect(bridge.pendingCount()).toBe(1);

    bridge.provideInput('yes');
    await flush();
    expect(bridge.isPending()).toBe(false);

    await Promise.all(runs.map((r) => r.completed));

    // 三个都应真的执行完（回归：同意后必须跑，见 09-13 的 ask→allow 映射修复）
    for (const r of runs) {
      const t = typesOf(r.events);
      expect(t).toContain('tool_started');
      expect(t).toContain('tool_result');
      expect(t).not.toContain('tool_failed');
    }
  });

  it('回答按 FIFO 落到队头，且 getPendingContext 与之一致', async () => {
    const bridge = new UserInputBridge();

    const runs = [
      startDispatch({ bridge, callId: 'a1', command: 'echo one' }),
      startDispatch({ bridge, callId: 'a2', command: 'echo two' }),
    ];
    await flush();

    // 队头应是先发起的那一个 —— UI 展示的卡片必须与这个队头对应
    expect(bridge.getPendingContext()?.callId).toBe('a1');

    bridge.provideInput('yes');
    await flush();
    expect(bridge.getPendingContext()?.callId).toBe('a2');

    bridge.provideInput('yes');
    await Promise.all(runs.map((r) => r.completed));

    // 每个请求各自恰好一条完整生命周期
    for (const r of runs) {
      expect(typesOf(r.events).filter((t) => t === 'tool_result')).toHaveLength(1);
    }
  });

  it('无等待者时 provideInput 静默丢弃（不抛错、不影响后续）', async () => {
    const bridge = new UserInputBridge();

    // 队列为空时回答：应被丢弃
    expect(() => bridge.provideInput('yes')).not.toThrow();
    await flush();
    expect(bridge.isPending()).toBe(false);

    // 后续正常提问不受影响
    const run = startDispatch({ bridge, callId: 'b1', command: 'echo later' });
    await flush();
    expect(bridge.pendingCount()).toBe(1);
    bridge.provideInput('yes');
    await flush();
    await run.completed;
    expect(typesOf(run.events)).toContain('tool_result');
  });

  it('同一 tick 连续两次 provideInput 各解一个（第二个答案不被丢弃）', async () => {
    const bridge = new UserInputBridge();

    const runs = [
      startDispatch({ bridge, callId: 'd1', command: 'echo d1' }),
      startDispatch({ bridge, callId: 'd2', command: 'echo d2' }),
    ];
    await flush();
    expect(bridge.pendingCount()).toBe(2);

    // 同一 tick 连续两次 provideInput：应各解一个，而不是都被第一个吃掉
    bridge.provideInput('yes');
    bridge.provideInput('yes');
    await flush();
    expect(bridge.isPending()).toBe(false);

    await Promise.all(runs.map((r) => r.completed));
    for (const r of runs) {
      expect(typesOf(r.events)).toContain('tool_result');
    }
  });
});
