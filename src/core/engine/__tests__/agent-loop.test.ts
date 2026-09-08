/**
 * agent-loop.test.ts - 核心 Agent 循环单元测试
 *
 * 覆盖 runAgentLoop 的核心路径：
 * - session 生命周期
 * - 单 turn 响应（简单/流式）
 * - 工具调用（单个/多个/spawn_agent 并行）
 * - 多 turn 处理
 * - step 限制
 * - provider 错误处理
 * - provider fallback
 * - usage tracking
 * - skill 路由
 * - debug trace
 * - 取消订阅
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lastValueFrom, toArray, Observable, of, from, EMPTY } from 'rxjs';

import { runAgentLoop } from '../agent-loop.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type { AgentTool } from '@tools/core/tool-types.js';
import type { AgentProvider } from '../../../providers/provider-types.js';
import type {
  ChatInputTurn,
  HistoryRecord,
  RuntimeEvent,
  SessionMessageRecord
} from '../../runtime/event-types.js';
import type { SessionManager, SessionMetadata } from '../../session/session-manager.js';
import type { PermissionGate } from '../permission-gate.js';

// ============================================================
// Mock 基础设施
// ============================================================

/** 创建 mock AgentProvider */
function createMockProvider(events: Array<{ type: string; text?: string; call?: unknown; usage?: unknown }>): AgentProvider {
  return {
    id: 'mock-provider',
    runStep: () => {
      return from(events as any[]);
    },
  } as unknown as AgentProvider;
}

/** 创建 mock SessionManager */
function createMockSessionManager() {
  const records: SessionMessageRecord[] = [];
  return {
    manager: {
      startSession: vi.fn().mockResolvedValue({
        id: 'test-session-1',
        path: '/tmp/test-session.jsonl',
        mode: 'single',
        cwd: '/tmp',
        providerId: 'mock-provider',
      } as SessionMetadata),
      appendRecord: vi.fn().mockImplementation((_session: unknown, record: SessionMessageRecord) => {
        records.push(record);
        return Promise.resolve();
      }),
    } as unknown as SessionManager,
    records,
  };
}

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

// ============================================================
// 测试套件
// ============================================================

describe('runAgentLoop', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
  });

  describe('session 生命周期', () => {
    it('emit session_started 和 session_ended 事件', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const types = events.map((e) => e.type);

      expect(types).toContain('session_started');
      expect(types).toContain('session_ended');
      // session_started 应在 session_ended 之前
      expect(types.indexOf('session_started')).toBeLessThan(types.indexOf('session_ended'));
    });

    it('session_started 包含正确 sessionId、sessionPath、mode', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const started = events.find((e) => e.type === 'session_started') as any;

      expect(started).toBeDefined();
      expect(started.sessionId).toBe('test-session-1');
      expect(started.sessionPath).toBe('/tmp/test-session.jsonl');
      expect(started.mode).toBe('single');
    });

    it('有 existingSession 时使用已有 session', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');
      const existingSession = {
        id: 'existing-session',
        path: '/tmp/existing.jsonl',
        mode: 'interactive' as const,
        cwd: '/tmp',
        providerId: 'mock-provider',
      };

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'interactive',
        existingSession,
      });

      const events = await collectEvents(events$);
      const started = events.find((e) => e.type === 'session_started') as any;

      expect(started.sessionId).toBe('existing-session');
      expect(mockSessionManager.manager.startSession).not.toHaveBeenCalled();
    });

    it('initialHistory 恢复：provider 收到恢复的历史上下文', async () => {
      // resume 场景：恢复之前会话的 message 记录（含已压缩的 summary）
      const initialHistory: HistoryRecord[] = [
        { type: 'message', turn: 1, role: 'user', content: 'earlier question', timestamp: 't1' },
        { type: 'message', turn: 1, role: 'assistant', content: 'earlier answer', timestamp: 't2' },
        { type: 'summary', turn: 1, content: 'earlier context summary', summarizedCount: 5, timestamp: 't3' },
      ];
      let capturedHistory: unknown[] | undefined;
      let callCount = 0;
      const provider = {
        id: 'mock-provider',
        runStep: ({ context }: { context: { history: unknown[] } }) => {
          callCount++;
          if (callCount === 1) capturedHistory = context.history;
          return of({ type: 'assistant_message', text: 'Hello' });
        },
      } as unknown as AgentProvider;

      const { events$ } = runAgentLoop({
        provider,
        input$: createInput$('Hi'),
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        initialHistory,
      });

      await collectEvents(events$);
      expect(capturedHistory).toBeDefined();
      const serialized = JSON.stringify(capturedHistory);
      // 恢复的消息与摘要都应进入 provider 上下文
      expect(serialized).toContain('earlier question');
      expect(serialized).toContain('earlier answer');
      expect(serialized).toContain('earlier context summary');
    });
  });

  describe('单 turn - 简单响应', () => {
    it('provider 仅返回 assistant_message', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello world' }]);
      const input$ = createInput$('Hi');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const assistantMsg = events.find((e) => e.type === 'assistant_message') as any;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBe('Hello world');
    });

    it('provider 返回 assistant_chunk + assistant_message（流式）', async () => {
      const provider = createMockProvider([
        { type: 'assistant_chunk', text: 'Hello' },
        { type: 'assistant_chunk', text: ' world' },
        { type: 'assistant_message', text: 'Hello world' },
      ]);
      const input$ = createInput$('Hi');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const chunks = events.filter((e) => e.type === 'assistant_chunk') as any[];
      const assistantMsg = events.find((e) => e.type === 'assistant_message') as any;

      expect(chunks).toHaveLength(2);
      expect(chunks[0].chunk).toBe('Hello');
      expect(chunks[1].chunk).toBe(' world');
      expect(assistantMsg.content).toBe('Hello world');
    });

    it('事件顺序：user_turn → assistant_chunks → assistant_message', async () => {
      const provider = createMockProvider([
        { type: 'assistant_chunk', text: 'Hi' },
        { type: 'assistant_message', text: 'Hi there' },
      ]);
      const input$ = createInput$('Hello');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const types = events.map((e) => e.type).filter((t) => t !== 'session_started' && t !== 'session_ended');

      expect(types).toEqual(['user_turn', 'assistant_chunk', 'assistant_message']);
    });
  });

  describe('单 turn - 工具调用', () => {
    const mockPermissionGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
    } as unknown as PermissionGate;

    it('单个 tool_call → 工具执行 → provider 返回 assistant_message', async () => {
      const tool = createMockTool('read-file', 'file content');
      const toolRegistry = new ToolRegistry([tool]);
      const provider = createMockProvider([
        { type: 'tool_call', call: { id: 'call-1', toolName: 'read-file', input: { path: '/tmp/test' } } },
        { type: 'assistant_message', text: 'I read the file' },
      ]);
      const input$ = createInput$('Read the file');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        toolRegistry,
        permissionGate: mockPermissionGate,
      });

      const events = await collectEvents(events$);
      const toolCall = events.find((e) => e.type === 'tool_call_requested') as any;
      const toolResult = events.find((e) => e.type === 'tool_result') as any;

      expect(toolCall).toBeDefined();
      expect(toolCall.toolName).toBe('read-file');
      expect(toolResult).toBeDefined();
      expect(toolResult.output).toContain('file content');
    });

    it('多个 tool_calls → 全部执行', async () => {
      const tool1 = createMockTool('read-file', 'content 1');
      const tool2 = createMockTool('bash', 'command output');
      const toolRegistry = new ToolRegistry([tool1, tool2]);
      const provider = createMockProvider([
        { type: 'tool_call', call: { id: 'call-1', toolName: 'read-file', input: {} } },
        { type: 'tool_call', call: { id: 'call-2', toolName: 'bash', input: {} } },
        { type: 'assistant_message', text: 'Done' },
      ]);
      const input$ = createInput$('Do both');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        toolRegistry,
        permissionGate: mockPermissionGate,
      });

      const events = await collectEvents(events$);
      const toolResults = events.filter((e) => e.type === 'tool_result');

      expect(toolResults).toHaveLength(2);
    });
  });

  describe('abort$ 常驻 Subject（TUI 场景回归）', () => {
    // TUI 传入永不 complete 的 abort$ Subject。provider 流必须照常 complete，
    // 否则 tail/continuation 饿死：工具不派发、turn 不结束（usage 后静默）。
    it('abort$ pending 时文本 turn 照常结束', async () => {
      const { Subject } = await import('rxjs');
      const provider = createMockProvider([
        { type: 'assistant_message', text: 'Hello' },
        { type: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
      ]);
      const input$ = createInput$('Hi');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'interactive',
        abort$: new Subject<void>(),
      });

      const events = await collectEvents(events$);
      const types = events.map((e) => e.type);
      expect(types).toContain('assistant_message');
      expect(types).toContain('usage_update');
      expect(types).toContain('session_ended');
    });

    it('abort$ pending 时 tool_call 照常派发执行', async () => {
      const { Subject } = await import('rxjs');
      const tool = createMockTool('read-file', 'file content');
      const toolRegistry = new ToolRegistry([tool]);
      const gate = {
        evaluate: vi.fn().mockReturnValue({ decision: 'allow', mode: 'default' }),
      } as unknown as PermissionGate;
      const provider = createMockProvider([
        { type: 'tool_call', call: { id: 'call-1', toolName: 'read-file', input: { path: '/tmp/test' } } },
      ]);
      const input$ = createInput$('Read the file');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'interactive',
        toolRegistry,
        permissionGate: gate,
        abort$: new Subject<void>(),
      });

      const events = await collectEvents(events$);
      expect(events.find((e) => e.type === 'tool_call_requested')).toBeDefined();
      expect(events.find((e) => e.type === 'tool_result')).toBeDefined();
    });
  });

  describe('多 turn', () => {
    it('顺序处理多个用户输入', async () => {
      let callCount = 0;
      const provider: AgentProvider = {
        id: 'mock-provider',
        runStep: () => {
          callCount++;
          return from([{ type: 'assistant_message', text: `Response ${callCount}` } as any]);
        },
      } as unknown as AgentProvider;
      const input$ = createInput$('Question 1', 'Question 2');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const userTurns = events.filter((e) => e.type === 'user_turn');
      const assistantMsgs = events.filter((e) => e.type === 'assistant_message');

      expect(userTurns).toHaveLength(2);
      expect(assistantMsgs).toHaveLength(2);
    });
  });

  describe('step 限制', () => {
    it('maxStepsPerTurn 超限：emit fallback message 并停止', async () => {
      // 创建一个会无限循环的 provider（总是返回 tool_call）
      let step = 0;
      const infiniteProvider: AgentProvider = {
        id: 'infinite-provider',
        runStep: () => {
          step++;
          return from([
            {
              type: 'tool_call',
              call: { id: `call-${step}`, toolName: 'bash', input: {} },
            } as any,
          ]);
        },
      } as unknown as AgentProvider;

      const tool = createMockTool('bash');
      const toolRegistry = new ToolRegistry([tool]);
      const input$ = createInput$('Loop forever');

      const { events$ } = runAgentLoop({
        provider: infiniteProvider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        toolRegistry,
        maxStepsPerTurn: 3,
      });

      const events = await collectEvents(events$);
      const assistantMsgs = events.filter((e) => e.type === 'assistant_message');

      // 应该有一个 fallback message（maxStepsReached）
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('provider 错误处理', () => {
    it('provider.runStep 抛错：错误转为 assistant_message', async () => {
      const errorProvider: AgentProvider = {
        id: 'error-provider',
        runStep: () => {
          return new Observable((subscriber) => {
            subscriber.error(new Error('Provider failed'));
          });
        },
      } as unknown as AgentProvider;

      const input$ = createInput$('Hello');

      const { events$ } = runAgentLoop({
        provider: errorProvider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const assistantMsg = events.find((e) => e.type === 'assistant_message') as any;

      expect(assistantMsg).toBeDefined();
      // 错误消息应包含错误信息
      expect(assistantMsg.content).toContain('错误');
    });

    it('错误不崩溃循环', async () => {
      let callCount = 0;
      const flakyProvider: AgentProvider = {
        id: 'flaky-provider',
        runStep: () => {
          callCount++;
          if (callCount === 1) {
            return new Observable((subscriber) => {
              subscriber.error(new Error('First call fails'));
            });
          }
          return from([{ type: 'assistant_message', text: 'Second call works' } as any]);
        },
      } as unknown as AgentProvider;

      const input$ = createInput$('Try twice');

      const { events$ } = runAgentLoop({
        provider: flakyProvider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const assistantMsgs = events.filter((e) => e.type === 'assistant_message');

      // 第一次失败，但循环继续，第二次成功
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('provider fallback', () => {
    it('provider 无 assistant_message 且无 tool_calls：使用 i18n fallback', async () => {
      const emptyProvider: AgentProvider = {
        id: 'empty-provider',
        runStep: () => {
          return EMPTY;
        },
      } as unknown as AgentProvider;

      const input$ = createInput$('Hello');

      const { events$ } = runAgentLoop({
        provider: emptyProvider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events = await collectEvents(events$);
      const assistantMsg = events.find((e) => e.type === 'assistant_message') as any;

      expect(assistantMsg).toBeDefined();
      // 应该有 fallback message
      expect(assistantMsg.content).toBeDefined();
    });
  });

  describe('debug trace', () => {
    it('debug$ stream emit DebugTraceEvent', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');

      const { events$, debug$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      // 订阅 events$ 以触发执行
      await collectEvents(events$);

      // 收集 debug 事件
      const debugEvents = await lastValueFrom(debug$.pipe(toArray()));

      expect(debugEvents.length).toBeGreaterThan(0);
      // 应该有 session.start 和 session.end
      const phases = debugEvents.map((e) => e.phase);
      expect(phases).toContain('session.start');
      expect(phases).toContain('session.end');
    });

    it('debug$ emit turn.input 事件', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');

      const { events$, debug$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      await collectEvents(events$);
      const debugEvents = await lastValueFrom(debug$.pipe(toArray()));
      const phases = debugEvents.map((e) => e.phase);

      expect(phases).toContain('turn.input');
    });

    it('trace 默认写入 Logger.info（落盘，/logs 开箱即用，不依赖 debug 开关）', async () => {
      const provider = createMockProvider([{ type: 'assistant_message', text: 'Hello' }]);
      const input$ = createInput$('Hi');

      // Mock Logger
      const loggerSpy = vi.spyOn(
        await import('../../logger/index.js').then((m) => m.Logger),
        'info'
      );

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        debug: true,
      });

      await collectEvents(events$);

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('非交互模式 ask 直接拒绝（不挂起）', () => {
    const askGate = {
      evaluate: vi.fn().mockReturnValue({ decision: 'ask', mode: 'default', reason: 'need confirm' }),
    } as unknown as PermissionGate;

    it('interactive:false + 无 bridge → tool_failed 且流正常结束', async () => {
      const tool = createMockTool('bash', 'never runs');
      const toolRegistry = new ToolRegistry([tool]);
      const provider = createMockProvider([
        { type: 'tool_call', call: { id: 'call-1', toolName: 'bash', input: {} } },
      ]);
      const input$ = createInput$('Run it');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
        toolRegistry,
        permissionGate: askGate,
        interactive: false,
      });

      // 5 秒内必须结束：挂起即失败（旧行为会永远等待 bridge）
      const events = await Promise.race([
        collectEvents(events$),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timed out waiting for events (hang!)')), 5000)
        ),
      ]);
      const failed = events.find((e) => e.type === 'tool_failed') as any;
      expect(failed).toBeDefined();
      expect(failed.toolName).toBe('bash');
      // 未发出询问事件（无人可问，直接拒绝）
      expect(events.some((e) => e.type === 'user_input_requested')).toBe(false);
    });
  });

  describe('取消订阅', () => {
    it('取消 events$ 停止处理', async () => {
      const provider = createMockProvider([
        { type: 'assistant_message', text: 'R1' },
        { type: 'assistant_message', text: 'R2' },
      ]);
      const input$ = createInput$('Q1', 'Q2', 'Q3', 'Q4', 'Q5');

      const { events$ } = runAgentLoop({
        provider,
        input$,
        sessionManager: mockSessionManager.manager,
        cwd: '/tmp',
        mode: 'single',
      });

      const events: RuntimeEvent[] = [];
      const sub = events$.subscribe((e) => {
        events.push(e);
        // 处理 2 个 turn 后取消
        if (events.filter((ev) => ev.type === 'assistant_message').length >= 2) {
          sub.unsubscribe();
        }
      });

      // 等待一下让异步完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 应该只处理了部分 turn
      expect(events.filter((e) => e.type === 'assistant_message').length).toBeLessThanOrEqual(2);
    });
  });
});
