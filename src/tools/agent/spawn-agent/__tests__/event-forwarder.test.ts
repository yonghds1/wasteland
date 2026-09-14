/**
 * event-forwarder.test.ts - 子 Agent 事件转发单元测试
 *
 * 覆盖：
 * - translateChildEvent：子 agent 内部事件翻译为父侧事件
 *   （assistant_chunk → agent_thinking、tool_call → agent_tool_use、
 *    context_compacted → agent_progress 等；未知事件 → null）
 */
import { describe, it, expect } from 'vitest';
import { NEVER, catchError, of, retry, type Observable } from 'rxjs';

import { translateChildEvent, invokeFinish, assembleForwardObservable } from '../event-forwarder.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { SpawnAgentContext } from '../types.js';

const CHILD_ID = 'child-1';
const CHILD_NAME = 'researcher';
const PARENT_ID = 'parent-1';

function childEvent(partial: Partial<RuntimeEvent> & { type: RuntimeEvent['type'] }): RuntimeEvent {
  return partial as RuntimeEvent;
}

describe('translateChildEvent', () => {
  it('assistant_chunk → agent_thinking', () => {
    const ev = translateChildEvent(
      childEvent({ type: 'assistant_chunk', chunk: 'hello' }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_thinking',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      content: 'hello',
    });
  });

  it('tool_call_requested → agent_tool_use（带 input）', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'tool_call_requested',
        toolName: 'bash',
        input: { cmd: 'ls' },
      }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_tool_use',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      toolName: 'bash',
      input: { cmd: 'ls' },
    });
  });

  it('agent_completed → agent_progress', () => {
    const ev = translateChildEvent(
      childEvent({ type: 'agent_completed', status: 'success' }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_progress',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      status: 'sub-completed: success',
    });
  });

  it('context_compacted（摘要）→ agent_progress 带压缩信息', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'context_compacted',
        sessionId: CHILD_ID,
        turn: 1,
        removedCount: 12,
        tokensSaved: 4800,
        summarized: true,
      }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('agent_progress');
    const progress = ev as { type: 'agent_progress' } & Record<string, unknown>;
    expect(progress.status).toBe('compacted');
    expect(progress.message).toContain('removed 12 records');
    expect(progress.message).toContain('saved ~4800 tokens');
    expect(progress.message).toContain('summarized');
  });

  it('context_compacted（同步切割）→ 无 summarized 标注', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'context_compacted',
        sessionId: CHILD_ID,
        turn: 2,
        removedCount: 6,
        tokensSaved: 2100,
        summarized: false,
      }),
      CHILD_ID,
      CHILD_NAME
    );
    const progress = ev as { message?: string };
    expect(progress.message).toContain('removed 6 records');
    expect(progress.message).not.toContain('summarized');
  });

  it('未知事件 → null', () => {
    expect(
      translateChildEvent(childEvent({ type: 'session_started', sessionId: CHILD_ID }), CHILD_ID, CHILD_NAME)
    ).toBeNull();
  });
});

// ============================================================
// invokeFinish：终结事件产出点（09-14-duplicate-tool-call-id 回归）
// ============================================================

/**
 * 失败分支只允许 subscriber.error()，**不得**再 next(tool_failed)。
 *
 * 否则外层 catchError 会再发一条，同一 callId 出现两条终结事件；
 * turn-executor 把两条都记进 state.toolResults，buildMessages 因而生成重复
 * tool_call_id，被上游以 invalid_request_error 拒收整个 turn。
 */
describe('invokeFinish', () => {
  function makeHarness(): {
    params: Parameters<typeof invokeFinish>[0];
    siblingRecords: unknown[];
    nextEvents: RuntimeEvent[];
    flags: { errorCalled: boolean; errorMessage: string; completeCalled: boolean };
  } {
    const siblingRecords: unknown[] = [];
    const nextEvents: RuntimeEvent[] = [];
    const flags = { errorCalled: false, errorMessage: '', completeCalled: false };
    const params = {
      parentId: 'parent-1',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      childSessionPath: '/tmp/child.jsonl',
      call: { id: 'call-1', toolName: 'spawn_agent' },
      turn: 3,
      context: {
        sessionManager: {
          closeSession: async () => {},
          appendRecord: async (_session: unknown, record: unknown) => {
            siblingRecords.push(record);
          },
        },
        session: { id: 'parent-1' },
      },
      forwarded: [],
      // 留空以跳过 skin 释放分支（与本用例无关）
      subAgentSkinCandidates: [],
      selectedSkinId: 'default',
      childAgentTimeoutMs: 600000,
    } as unknown as Parameters<typeof invokeFinish>[0];
    return { params, siblingRecords, nextEvents, flags };
  }

  function makeSubscriber(h: ReturnType<typeof makeHarness>) {
    return {
      next: (e: RuntimeEvent) => h.nextEvents.push(e),
      complete: () => {
        h.flags.completeCalled = true;
      },
      error: (err: Error) => {
        h.flags.errorCalled = true;
        h.flags.errorMessage = err.message;
      },
    };
  }

  it('timeout：不发 tool_failed，只 error（终结事件交由外层 catchError）', () => {
    const h = makeHarness();
    invokeFinish(
      h.params,
      'timeout',
      undefined,
      '子 Agent 执行超时 (timeout: 600000ms)',
      makeSubscriber(h),
      { resolved: false, called: false }
    );

    // 关键断言：没有任何 tool_failed 事件
    expect(h.nextEvents.filter((e) => e.type === 'tool_failed')).toHaveLength(0);
    // agent_completed 仍然发（进度展示依赖）
    expect(h.nextEvents.filter((e) => e.type === 'agent_completed')).toHaveLength(1);
    // 失败记录**不**在这里写：maxRetries>0 时每次 attempt 各写一条会让 /resume
    // 重建出重复 tool_call_id。记录与事件一并收归外层 catchError（见下一组用例）。
    expect(h.siblingRecords).toHaveLength(0);
    // 走 error 触发外层 retry / catchError
    expect(h.flags.errorCalled).toBe(true);
    expect(h.flags.completeCalled).toBe(false);
    // 原始失败原因要经 err.message 传给 catchError（否则终结事件会丢掉「超时」细节）
    expect(h.flags.errorMessage).toContain('超时');
  });

  it('success：发 tool_result、写记录且 complete（成功路径不受影响）', () => {
    const h = makeHarness();
    invokeFinish(h.params, 'success', '子 agent 结论', undefined, makeSubscriber(h), {
      resolved: false,
      called: false,
    });

    const results = h.nextEvents.filter((e) => e.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'success', callId: 'call-1' });
    expect(h.nextEvents.filter((e) => e.type === 'tool_failed')).toHaveLength(0);
    // 成功路径仍由 invokeFinish 自己写记录
    expect(h.siblingRecords).toHaveLength(1);
    expect(h.siblingRecords[0]).toMatchObject({ type: 'tool_result', callId: 'call-1', status: 'success' });
    expect(h.flags.completeCalled).toBe(true);
    expect(h.flags.errorCalled).toBe(false);
  });

  it('幂等：重复调用不产生第二条事件或记录', () => {
    const h = makeHarness();
    const state = { resolved: false, called: false };
    const sub = makeSubscriber(h);
    invokeFinish(h.params, 'timeout', undefined, 'boom', sub, state);
    invokeFinish(h.params, 'timeout', undefined, 'boom', sub, state);

    expect(h.nextEvents.filter((e) => e.type === 'agent_completed')).toHaveLength(1);
    expect(h.siblingRecords).toHaveLength(0);
  });
});

// ============================================================
// assembleForwardObservable：父侧终结事件唯一性（09-14 回归核心）
//
// 根因链路：invokeFinish 失败分支若既 next(tool_failed) 又 error()，
// 外层 catchError 会再产一条 —— 同一 callId 两条终结事件，
// turn-executor 把两条都记进 state.toolResults，
// buildMessages 因而生成重复 tool_call_id 被上游拒收整个 turn。
//
// 上一组用例只锁住 invokeFinish 这个「产出点」；本组在 Observable 边界
// 锁住 PRD 验收口径「父侧只收到一条终结事件」。
// ============================================================

const CALL_ID = 'call-dup-1';

type CollectedRun = {
  events: RuntimeEvent[];
  error?: Error;
  /** 被 turn-executor 记进 state.toolResults 的终结事件 */
  terminal: RuntimeEvent[];
};

/** 订阅到结束，收集事件 / error / 终结事件（终结事件数 = 父侧重复计数的直接指标） */
function collectRun(source$: Observable<RuntimeEvent>): Promise<CollectedRun> {
  return new Promise((resolve) => {
    const events: RuntimeEvent[] = [];
    const build = (error?: Error): CollectedRun => ({
      events,
      error,
      terminal: events.filter((e) => e.type === 'tool_result' || e.type === 'tool_failed'),
    });
    source$.subscribe({
      next: (e) => events.push(e),
      error: (err: Error) => resolve(build(err)),
      complete: () => resolve(build()),
    });
  });
}

/** 构造 assembleForwardObservable 的最小可用入参 */
function makeForwardHarness(
  events$: Observable<RuntimeEvent>,
  childAgentTimeoutMs = 20
): { forward$: Observable<RuntimeEvent>; parentRecords: unknown[] } {
  const parentRecords: unknown[] = [];
  const context = {
    sessionId: PARENT_ID,
    turn: 3,
    cwd: '/tmp',
    session: { id: PARENT_ID },
    sessionManager: {
      closeSession: async () => {},
      appendRecord: async (_session: unknown, record: unknown) => {
        parentRecords.push(record);
      },
    },
    history: [],
  } as unknown as SpawnAgentContext;

  const forward$ = assembleForwardObservable({
    events$,
    parentId: PARENT_ID,
    childId: CHILD_ID,
    childName: CHILD_NAME,
    childTask: 'task',
    childSessionPath: '/tmp/child.jsonl',
    call: { id: CALL_ID, toolName: 'spawn_agent' },
    turn: 3,
    context,
    subAgentSkinCandidates: [],
    selectedSkinId: 'default',
    childAgentTimeoutMs,
  });

  return { forward$, parentRecords };
}

/**
 * 复刻 spawn-agent/index.ts 的收尾尾巴（retry + catchError）。
 *
 * 生产链路上 spawnChildAgentForwarding$ 内部就是这个形状：本 observable
 * error → 按 multiAgent.maxRetries 重试 → 耗尽后 catchError 产出**唯一一条**
 * tool_failed **和唯一一条父 session 记录**。此处保持同构；若 index.ts 改了
 * 尾巴结构，本组断言需同步复核。
 */
function withSpawnTail(
  source$: Observable<RuntimeEvent>,
  maxRetries: number,
  records: unknown[]
): Observable<RuntimeEvent> {
  return source$.pipe(
    // retry: count <= 0 时 rxjs 直接等价 identity（不重试），error 直达 catchError
    retry({ count: maxRetries }),
    // catchError: 重试耗尽后把 error 转成唯一一条终结事件 + 唯一一条记录
    catchError((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      records.push({
        type: 'tool_result',
        sessionId: PARENT_ID,
        turn: 3,
        callId: CALL_ID,
        toolName: 'spawn_agent',
        status: 'error',
        error: message,
      });
      return of<RuntimeEvent>({
        type: 'tool_failed',
        sessionId: PARENT_ID,
        turn: 3,
        callId: CALL_ID,
        toolName: 'spawn_agent',
        status: 'error',
        error: message,
      });
    })
  );
}

describe('assembleForwardObservable — 终结事件唯一性', () => {
  it('超时失败：forwarder 自身不发终结事件、不写记录，只 error', async () => {
    const { forward$, parentRecords } = makeForwardHarness(NEVER);
    const run = await collectRun(forward$);

    // 关键断言：失败路径不发 tool_result / tool_failed
    expect(run.terminal).toHaveLength(0);
    // agent_completed 仍要发（TUI 进度依赖）
    expect(run.events.filter((e) => e.type === 'agent_completed')).toHaveLength(1);
    // 记录也交给外层写：每次 attempt 各写一条会让 /resume 重建出重复 tool_call_id
    expect(parentRecords).toHaveLength(0);
    // 通过 error 把终结权交给外层
    expect(run.error?.message).toContain('超时');
  });

  it('超时失败经 retry + catchError：父侧只收到一条终结事件 + 一条记录', async () => {
    const { forward$, parentRecords } = makeForwardHarness(NEVER);
    const run = await collectRun(withSpawnTail(forward$, 0, parentRecords));

    // 这就是被记进 state.toolResults 的条数：必须为 1
    expect(run.terminal).toHaveLength(1);
    expect(run.terminal[0]).toMatchObject({ type: 'tool_failed', callId: CALL_ID, status: 'error' });
    // 父 session 记录同样只有一条
    expect(parentRecords).toHaveLength(1);
    expect(parentRecords[0]).toMatchObject({ type: 'tool_result', callId: CALL_ID, status: 'error' });
    // 原始失败原因仍要透传到终结事件（不能被包装吞掉）
    const failed = run.terminal[0] as RuntimeEvent & { error?: string };
    expect(failed.error).toContain('超时');
    expect(run.error).toBeUndefined();
  });

  it('maxRetries > 0：重试耗尽后仍只收到一条终结事件 + 一条记录', async () => {
    const { forward$, parentRecords } = makeForwardHarness(NEVER);
    const run = await collectRun(withSpawnTail(forward$, 2, parentRecords));

    // 3 次 attempt（1 次 + 2 次重试）各自 agent_spawned，但终结产物流只有一份
    expect(run.events.filter((e) => e.type === 'agent_spawned')).toHaveLength(3);
    expect(run.terminal).toHaveLength(1);
    // 回归 09-14：记录若在每次 attempt 各写一条，/resume 经 history 分支重建消息时
    // 会出现重复 tool_call_id（同样是上游 invalid_request_error）
    expect(parentRecords).toHaveLength(1);
    expect(parentRecords[0]).toMatchObject({ type: 'tool_result', callId: CALL_ID, status: 'error' });
  });
});
