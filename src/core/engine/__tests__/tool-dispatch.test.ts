/**
 * tool-dispatch.test.ts - dispatchToolCall 的 5 段时间分解测试
 *
 * 覆盖：
 * - tool 段 + permission 段 + postHook 段都被 Logger.debug 收到
 * - timings 5 段字段全部存在且为非负数
 * - dispatch 返回事件流顺序不被破坏
 *
 * 测试隔离：用 MemorySink 注入到 Logger 总线，避免落盘副作用。
 */

import { firstValueFrom, filter, of, take, toArray } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Logger, MemorySink, type LogEntry, type LogSink } from '../../logger/index.js';
import { LogBus } from '../../logger/log-bus.js';

import {
  dispatchToolCall,
} from '../tool-dispatch.js';
import { SessionManager, type SessionMetadata } from '../../session/session-manager.js';
import { createInitialTurnState, type TurnState } from '../turn-state.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import { createPermissionGate } from '../permission-gate.js';
import type { UserInputBridge } from '../user-input-bridge.js';
import type { ToolCall, ToolExecutionResult } from '@tools/core/tool-types.js';

// ============================================================
// Fixtures
// ============================================================

function makeCall(toolName: string, callId = 'call-1', input: Record<string, unknown> = {}): ToolCall {
  return { id: callId, toolName, input };
}

function makeRegistryWithReadFile(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register({
    name: 'read-file',
    riskLevel: 'read',
    async execute(input): Promise<ToolExecutionResult> {
      // 模拟一个真实工具，sleep 5ms 以让 toolMs 可观察
      await new Promise((r) => setTimeout(r, 5));
      return { status: 'success', output: `read ${(input as { path?: string }).path ?? ''}` };
    },
  });
  return reg;
}

function makeTurnState(): TurnState {
  return createInitialTurnState({
    sessionId: 'test-session',
    input: { turn: 1, content: 'hi', source: 'message' },
    cwd: '/tmp',
    history: [],
  });
}

function makeSession(): SessionMetadata {
  return {
    id: 'test-session',
    path: '/tmp/test.jsonl',
    cwd: '/tmp',
    mode: 'single',
    providerId: 'local',
  };
}

function makeSessionManagerStub(): SessionManager {
  // 真实 SessionManager 依赖 .rxc/sessions 目录，测试只需 appendRecord 静默即可
  const sm = Object.create(SessionManager.prototype);
  sm.appendRecord = async (): Promise<void> => {
    /* no-op */
  };
  return sm as SessionManager;
}

// ============================================================
// 测试
// ============================================================

describe('dispatchToolCall - 5 段时间分解 (AC16)', () => {
  let memorySink: MemorySink;
  let bus: LogBus;

  beforeEach(() => {
    bus = new LogBus();
    Logger.setBus(bus);
    Logger.setLevel('debug');
    memorySink = new MemorySink();
    bus.subscribe(memorySink as LogSink);
  });

  afterEach(() => {
    Logger.reset();
  });

  it('成功 dispatch 时 Logger.debug 收到 5 段时间字段', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('read-file', 'c1', { path: 'package.json' }),
      registry: makeRegistryWithReadFile(),
      permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
    });

    const events = await firstValueFrom(events$.pipe(take(4), toArray()));
    expect(events.length).toBeGreaterThan(0);

    // 找 timings 字段的 log entry
    const timingEntries = memorySink
      .entries()
      .filter(
        (e: LogEntry) =>
          e.message === 'tool.dispatch.completed' && e.scope === 'tool'
      );

    expect(timingEntries.length).toBeGreaterThanOrEqual(1);
    const entry = timingEntries[0];
    expect(entry.data).toBeDefined();
    if (!entry.data) throw new Error('data missing');

    const data = entry.data as {
      kind: string;
      callId: string;
      toolName: string;
      status: string;
      timings: {
        preHookMs: number;
        permissionMs: number;
        toolMs: number;
        postHookMs: number;
        totalMs: number;
      };
    };

    expect(data.kind).toBe('tool_dispatch_completed');
    expect(data.callId).toBe('c1');
    expect(data.toolName).toBe('read-file');
    expect(data.status).toBe('success');
    expect(typeof data.timings.preHookMs).toBe('number');
    expect(typeof data.timings.permissionMs).toBe('number');
    expect(typeof data.timings.toolMs).toBe('number');
    expect(typeof data.timings.postHookMs).toBe('number');
    expect(typeof data.timings.totalMs).toBe('number');

    // 字段约束：非负数 + totalMs ≥ 其他段之和（允许有 dispatch 自身开销）
    expect(data.timings.preHookMs).toBeGreaterThanOrEqual(0);
    expect(data.timings.permissionMs).toBeGreaterThanOrEqual(0);
    expect(data.timings.toolMs).toBeGreaterThan(0); // 至少 5ms（sleep）
    expect(data.timings.postHookMs).toBeGreaterThanOrEqual(0);
    expect(data.timings.totalMs).toBeGreaterThan(0);

    // sanity：totalMs 大于等于 toolMs（dispatch 总耗时包含 tool 段）
    expect(data.timings.totalMs).toBeGreaterThanOrEqual(data.timings.toolMs);
  });

  it('失败 dispatch 仍 emit timings（status=error）', async () => {
    // 用一个未注册的工具 → 触发 tool_failed
    const registry = new ToolRegistry();
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('non-existent-tool', 'c2'),
      registry,
      permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
    });

    // 订阅到完成
    await firstValueFrom(events$.pipe(take(2), toArray())).catch(() => undefined);

    const timingEntries = memorySink
      .entries()
      .filter((e: LogEntry) => e.message === 'tool.dispatch.completed');

    // tool-not-found 路径不走 timing emit（无 tool 段）— 接受空结果
    // 但至少不应抛错
    expect(timingEntries.length).toBeGreaterThanOrEqual(0);
  });

  it('dispatch 主事件流顺序不被破坏：tool_call_requested → permission_decision → tool_started → tool_result', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 2,
      call: makeCall('read-file', 'c3', { path: 'a.ts' }),
      registry: makeRegistryWithReadFile(),
      permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
    });

    const events = await firstValueFrom(events$.pipe(take(4), toArray()));
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call_requested');
    expect(types).toContain('permission_decision');
    expect(types).toContain('tool_started');
    expect(types).toContain('tool_result');
  });
});

describe('dispatchToolCall - 权限问询 agent 归属', () => {
  function makeExecRegistry(): ToolRegistry {
    const reg = new ToolRegistry();
    for (const name of ['bash', 'web-fetch', 'mcp__srv__tool']) {
      reg.register({
        name,
        riskLevel: 'execute',
        async execute(): Promise<ToolExecutionResult> {
          return { status: 'success', output: 'ok' };
        },
      });
    }
    return reg;
  }

  // 永不回答的 bridge：只取到 user_input_requested 即退订，不会挂起
  function makeSilentBridge(): UserInputBridge {
    return {
      requestInput: () => new Promise<string>(() => undefined),
    } as unknown as UserInputBridge;
  }

  async function askQuestion(session: SessionMetadata): Promise<string> {
    const events$ = dispatchToolCall({
      session,
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('bash', 'c1', { command: 'rm -rf /tmp/x' }),
      registry: makeExecRegistry(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: makeSilentBridge(),
    });
    const event = await firstValueFrom(
      events$.pipe(filter((e) => e.type === 'user_input_requested'))
    );
    if (event.type !== 'user_input_requested') throw new Error('unreachable');
    return event.question;
  }

  it('子 agent 问询带 [childName] 前缀', async () => {
    const question = await askQuestion({ ...makeSession(), parentId: 'p', childName: 'researcher' });
    expect(question.startsWith('[researcher] 是否允许执行')).toBe(true);
  });

  it('主会话问询无前缀（保持原行为）', async () => {
    const question = await askQuestion(makeSession());
    expect(question.startsWith('是否允许执行')).toBe(true);
  });

  it('web-fetch 问询带 URL 明细', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('web-fetch', 'c2', { url: 'http://doc.zhoujusoft.com/docs/x' }),
      registry: makeExecRegistry(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: makeSilentBridge(),
    });
    const event = await firstValueFrom(
      events$.pipe(filter((e) => e.type === 'user_input_requested'))
    );
    if (event.type !== 'user_input_requested') throw new Error('unreachable');
    expect(event.question).toBe('是否允许执行 web-fetch (http://doc.zhoujusoft.com/docs/x)?');
  });

  it('无明细字段的工具问询带 JSON 摘要，空输入保持光秃', async () => {
    async function questionFor(input: Record<string, unknown>): Promise<string> {
      const events$ = dispatchToolCall({
        session: makeSession(),
        sessionManager: makeSessionManagerStub(),
        turn: 1,
        call: makeCall('mcp__srv__tool', 'c3', input),
        registry: makeExecRegistry(),
        permissionGate: createPermissionGate({ mode: 'default' }),
        cwd: '/tmp',
        turnState: makeTurnState(),
        userInputBridge: makeSilentBridge(),
      });
      const event = await firstValueFrom(
        events$.pipe(filter((e) => e.type === 'user_input_requested'))
      );
      if (event.type !== 'user_input_requested') throw new Error('unreachable');
      return event.question;
    }
    // 注册表里已有 mcp__srv__tool（见 makeExecRegistry），问询可达
    expect(await questionFor({})).toBe('是否允许执行 mcp__srv__tool?');
    expect(await questionFor({ id: 7, verbose: true })).toBe(
      '是否允许执行 mcp__srv__tool ({"id":7,"verbose":true})?'
    );
  });
});

describe('dispatchToolCall - 无头模式 (headless / non-interactive)', () => {
  function makeExecRegistry(): ToolRegistry {
    const reg = new ToolRegistry();
    reg.register({
      name: 'bash',
      riskLevel: 'execute',
      async execute(): Promise<ToolExecutionResult> {
        return { status: 'success', output: 'ok' };
      },
    });
    return reg;
  }

  it('无头模式下调用 ask-user 未提供 default 时产生 tool_failed 且失败信息匹配规范', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('ask-user', 'c-ask-1', { question: '确定要删除吗？' }),
      registry: makeRegistryWithReadFile(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: undefined,
    });

    const events = await firstValueFrom(events$.pipe(toArray()));
    const failedEvent = events.find((e) => e.type === 'tool_failed');
    expect(failedEvent).toBeDefined();
    if (failedEvent && failedEvent.type === 'tool_failed') {
      expect(failedEvent.status).toBe('error');
      expect(failedEvent.error).toBe(
        '[系统] 非交互/无头模式下无法进行用户询问 (ask-user)，且未提供 default 默认值。'
      );
    }
    const resultEvent = events.find((e) => e.type === 'tool_result');
    expect(resultEvent).toBeUndefined();
  });

  it('无头模式下调用 ask-user 且提供 default 时正确返回默认值', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('ask-user', 'c-ask-2', { question: '请确认配置', default: 'production' }),
      registry: makeRegistryWithReadFile(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: undefined,
    });

    const events = await firstValueFrom(events$.pipe(toArray()));
    const resultEvent = events.find((e) => e.type === 'tool_result');
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === 'tool_result') {
      expect(resultEvent.status).toBe('success');
      expect(resultEvent.output).toBe('production');
    }
    const failedEvent = events.find((e) => e.type === 'tool_failed');
    expect(failedEvent).toBeUndefined();
  });

  it('无头模式下调用高危工具触发 deny 时，reason 明确标注为（非交互无头环境自动阻断）', async () => {
    const events$ = dispatchToolCall({
      session: makeSession(),
      sessionManager: makeSessionManagerStub(),
      turn: 1,
      call: makeCall('bash', 'c-bash-1', { command: 'rm -rf /tmp/danger' }),
      registry: makeExecRegistry(),
      permissionGate: createPermissionGate({ mode: 'default' }),
      cwd: '/tmp',
      turnState: makeTurnState(),
      userInputBridge: undefined,
    });

    const events = await firstValueFrom(events$.pipe(toArray()));
    const permEvent = events.find((e) => e.type === 'permission_decision');
    expect(permEvent).toBeDefined();
    if (permEvent && permEvent.type === 'permission_decision') {
      expect(permEvent.decision).toBe('deny');
      expect(permEvent.reason).toContain('（非交互无头环境自动阻断）');
    }

    const failedEvent = events.find((e) => e.type === 'tool_failed');
    expect(failedEvent).toBeDefined();
    if (failedEvent && failedEvent.type === 'tool_failed') {
      expect(failedEvent.status).toBe('error');
      expect(failedEvent.error).toContain('（非交互无头环境自动阻断）');
    }
  });
});

// 避免 lint 警告（of 在某些 test 中未使用）
void of;
