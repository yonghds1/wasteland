import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useCheckpointCommands,
  pruneMessagesForUndo,
} from '../useCheckpointCommands.js';
import { getCheckpointManager } from '@core/checkpoint/index.js';
import type { AppState, Message } from '../../context/AppContext.js';
import type { TuiRuntimeContext } from '../../types.js';

vi.mock('@core/checkpoint/index.js', () => {
  const manager = {
    rollback: vi.fn(),
    redo: vi.fn(),
    getDiff: vi.fn(),
    list: vi.fn(),
  };
  return {
    getCheckpointManager: () => manager,
  };
});

function createMockAppState(): AppState {
  return {
    currentPage: 'session',
    focusArea: 'inputBar',
    inputMode: true,
    exitConfirmPending: false,
    showHelp: null,
    filterMode: false,
    editMode: false,
    permissionSelection: 0,
    permission: { pending: null, queue: [], history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending: null, queue: [], history: [] },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      context: { isCompacting: false },
    },
    debug: { traces: [], filter: {} },
    config: {
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'default',
      maxSteps: 10,
      defaultRole: 'coder',
      childAgentTimeout: 60000,
      debug: false,
    },
    fullConfig: { providers: {}, models: {}, multiAgent: {}, sources: {}, defaultProvider: 'mock' },
    configEdit: { field: null, originalValue: '' },
    configHasChanges: false,
    sessionMetadata: { id: 'test-session', providerId: 'mock' },
  };
}

describe('pruneMessagesForUndo', () => {
  it('去除 turn >= targetTurn 的助手与工具消息，保留早期消息和用户消息', () => {
    const messages: Message[] = [
      { id: 'msg-user-1-100', timestamp: '', agentId: 's', type: 'user', content: 'Turn 1 prompt' },
      { id: 'msg-tool-call1', timestamp: '', agentId: 's', type: 'tool', content: 'Tool output 1' },
      { id: 'msg-assistant-1-101', timestamp: '', agentId: 's', type: 'assistant', content: 'Turn 1 reply' },
      { id: 'msg-user-2-200', timestamp: '', agentId: 's', type: 'user', content: 'Turn 2 prompt' },
      { id: 'msg-dispatch-call2', timestamp: '', agentId: 's', type: 'system', content: 'dispatching' },
      { id: 'msg-tool-call2', timestamp: '', agentId: 's', type: 'tool', content: 'Tool output 2' },
      { id: 'msg-assistant-2-201', timestamp: '', agentId: 's', type: 'assistant', content: 'Turn 2 reply' },
      { id: 'msg-success-2-202', timestamp: '', agentId: 's', type: 'system', content: 'Done' },
    ];

    const pruned = pruneMessagesForUndo(messages, 2);

    expect(pruned.map((m) => m.id)).toEqual([
      'msg-user-1-100',
      'msg-tool-call1',
      'msg-assistant-1-101',
      'msg-user-2-200',
    ]);
  });
});

describe('useCheckpointCommands', () => {
  let mockState: AppState;
  let setState: React.Dispatch<React.SetStateAction<AppState>>;
  let runtime: TuiRuntimeContext;
  let appendRecordMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockState = createMockAppState();
    setState = vi.fn((updater) => {
      if (typeof updater === 'function') {
        mockState = updater(mockState);
      } else {
        mockState = updater;
      }
    }) as unknown as React.Dispatch<React.SetStateAction<AppState>>;

    appendRecordMock = vi.fn().mockResolvedValue(undefined);
    runtime = {
      session: {
        id: 'session-123',
        cwd: '/workspace/test',
        path: '/tmp/session-123.json',
        mode: 'chat',
        providerId: 'mock',
      },
      sessionManager: {
        appendRecord: appendRecordMock,
      },
    } as unknown as TuiRuntimeContext;

    vi.clearAllMocks();
  });

  it('成功执行 /undo：回滚快照、修剪消息、回填草稿并持久化 undo 记录', async () => {
    const manager = getCheckpointManager();
    vi.mocked(manager.rollback).mockResolvedValueOnce({
      success: true,
      rolledBackTurn: 2,
      targetTurn: 1,
      restoredFiles: ['src/a.ts', 'src/b.ts'],
      originalPrompt: 'Refactor database module',
    });

    mockState.session.messages = [
      { id: 'msg-user-1-10', timestamp: '', agentId: 's', type: 'user', content: 'p1' },
      { id: 'msg-assistant-1-11', timestamp: '', agentId: 's', type: 'assistant', content: 'a1' },
      { id: 'msg-user-2-20', timestamp: '', agentId: 's', type: 'user', content: 'p2' },
      { id: 'msg-assistant-2-21', timestamp: '', agentId: 's', type: 'assistant', content: 'a2' },
    ];

    const setDraft = vi.fn();
    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
      peekTurn: () => 2,
      setDraft,
    });

    const handled = await handleCheckpointCommand('/undo 1');
    expect(handled).toBe(true);

    expect(manager.rollback).toHaveBeenCalledWith({
      cwd: '/workspace/test',
      sessionId: 'session-123',
      currentTurn: 2,
      options: { targetTurnId: 1, force: false },
    });

    expect(setDraft).toHaveBeenCalledWith('Refactor database module');
    expect(mockState.inputDraft).toBe('Refactor database module');

    expect(mockState.session.messages.some((m) => m.id === 'msg-assistant-2-21')).toBe(false);
    expect(mockState.session.messages.some((m) => m.id === 'msg-assistant-1-11')).toBe(false); // targetTurn = 1, so >= 1 assistant pruned
    expect(mockState.session.messages.some((m) => m.content.includes('成功撤销至 Turn 1'))).toBe(true);

    expect(appendRecordMock).toHaveBeenCalledWith(
      runtime.session,
      expect.objectContaining({
        type: 'undo',
        sessionId: 'session-123',
        undoneTurn: 2,
        targetTurn: 1,
        restoredFiles: ['src/a.ts', 'src/b.ts'],
      })
    );
  });

  it('/undo 遇到外部并发冲突时输出冲突阻断提示', async () => {
    const manager = getCheckpointManager();
    vi.mocked(manager.rollback).mockResolvedValueOnce({
      success: false,
      rolledBackTurn: 2,
      targetTurn: 1,
      restoredFiles: [],
      conflicts: [{ path: 'src/main.ts', reason: 'Modified on disk externally' }],
      error: 'External modifications detected',
    });

    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
    });

    const handled = await handleCheckpointCommand('/undo');
    expect(handled).toBe(true);
    expect(appendRecordMock).not.toHaveBeenCalled();
    expect(
      mockState.session.messages.some((m) => m.content.includes('安全阻断') && m.content.includes('src/main.ts'))
    ).toBe(true);
  });

  it('成功执行 /redo 重做', async () => {
    const manager = getCheckpointManager();
    vi.mocked(manager.redo).mockResolvedValueOnce({
      success: true,
      rolledBackTurn: 0,
      targetTurn: 2,
      restoredFiles: ['src/a.ts'],
    });

    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
    });

    const handled = await handleCheckpointCommand('/redo');
    expect(handled).toBe(true);
    expect(manager.redo).toHaveBeenCalledWith({
      cwd: '/workspace/test',
      sessionId: 'session-123',
    });
    expect(mockState.session.messages.some((m) => m.content.includes('重做成功') && m.content.includes('Turn 2'))).toBe(true);
  });

  it('执行 /diff 查看差异', async () => {
    const manager = getCheckpointManager();
    vi.mocked(manager.getDiff).mockResolvedValueOnce({
      filesChanged: 2,
      additions: 15,
      deletions: 3,
      rawDiff: 'diff --git a/foo b/foo\n+line',
    });

    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
    });

    const handled = await handleCheckpointCommand('/diff');
    expect(handled).toBe(true);
    expect(manager.getDiff).toHaveBeenCalledWith({
      cwd: '/workspace/test',
      sessionId: 'session-123',
      turnId: undefined,
    });
    expect(mockState.session.messages.some((m) => m.content.includes('+15 / -3 行'))).toBe(true);
  });

  it('执行 /checkpoints 列出快照记录', async () => {
    const manager = getCheckpointManager();
    vi.mocked(manager.list).mockReturnValueOnce([
      {
        id: 'chk-1',
        turnId: 1,
        sessionId: 'session-123',
        commitHash: 'hash1',
        treeHash: 'tree1',
        createdAt: '2026-10-18T10:00:00Z',
        promptSummary: 'Initial setup',
        affectedFiles: ['package.json'],
      },
    ]);

    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
    });

    const handled = await handleCheckpointCommand('/checkpoints');
    expect(handled).toBe(true);
    expect(manager.list).toHaveBeenCalledWith('session-123');
    expect(mockState.session.messages.some((m) => m.content.includes('Initial setup'))).toBe(true);
  });

  it('非 checkpoint 命令返回 false 且不拦截', async () => {
    const { handleCheckpointCommand } = useCheckpointCommands({
      state: mockState,
      setState,
      runtime,
    });

    expect(await handleCheckpointCommand('/help')).toBe(false);
    expect(await handleCheckpointCommand('plain text message')).toBe(false);
  });
});
