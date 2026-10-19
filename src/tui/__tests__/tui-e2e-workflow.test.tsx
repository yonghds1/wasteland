/**
 * tui-e2e-workflow.test.tsx - TUI 端到端交互与屏幕快照测试
 *
 * 覆盖全流程：
 * 1. 初始装配与虚拟屏幕快照验证（输入提示符与 Inspector 面板）
 * 2. 打字输入与 Shift+Enter 多行换行编辑
 * 3. 快捷撤销调度（Ctrl+Z）与 inputDraft 上下文草稿回填
 * 4. 键盘 Tab 焦点轮转与导航模式切换
 * 5. Inspector 面板中的智能体树（AgentTreeView）层级分支与状态徽章渲染
 */

import React, { useState, useMemo, useCallback } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Subject } from 'rxjs';
import { createTuiTestHarness } from './helpers/tui-test-harness.js';
import { ChatArea } from '../components/ChatArea.js';
import {
  AppContext,
  type AppState,
  type PageName,
  type FocusArea,
  type HelpView,
  type LogPageFilter,
  type AgentNode,
} from '../context/AppContext.js';
import { useGlobalKeymapDispatcher } from '../keymap/useGlobalKeymapDispatcher.js';
import { getSkin, initSkinRegistry } from '../../skins/index.js';
import type { InputAgentNode } from '../components/agent-tree/tree-builder.js';
import type { TuiRuntimeContext } from '../types.js';

type AppContextValue = NonNullable<React.ContextType<typeof AppContext>>;

function createDefaultAppState(): AppState {
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
      provider: 'test-provider',
      model: 'test-model',
      permissionMode: 'ask',
      maxSteps: 10,
      defaultRole: 'coder',
      childAgentTimeout: 60000,
      debug: false,
    },
    fullConfig: {
      providers: {},
      models: {},
      multiAgent: {},
      sources: {},
      defaultProvider: 'test-provider',
    },
    configEdit: { field: null, originalValue: '' },
    configHasChanges: false,
    sessionMetadata: { id: 'test-session', providerId: 'test-provider' },
  };
}

interface TestTuiWorkbenchProps {
  initialState?: Partial<AppState>;
  onSendMessage?: (content: string) => void;
  contextRef?: React.MutableRefObject<AppContextValue | null>;
}

function TestTuiWorkbench({
  initialState,
  onSendMessage,
  contextRef,
}: TestTuiWorkbenchProps): React.ReactElement {
  const [state, setState] = useState<AppState>(() => {
    const base = createDefaultAppState();
    return {
      ...base,
      ...initialState,
      session: {
        ...base.session,
        ...(initialState?.session ?? {}),
      },
    };
  });

  const mockRuntime: TuiRuntimeContext = useMemo(
    () =>
      ({
        providerId: 'test-provider',
        config: {
          provider: 'test-provider',
          model: 'test-model',
          permissionMode: 'ask',
          maxSteps: 10,
          defaultRole: 'coder',
          childAgentTimeout: 60000,
          debug: false,
        },
        session: { id: 'test-session', title: 'Test Session' } as unknown as TuiRuntimeContext['session'],
        fullConfig: {
          providers: {},
          models: {},
          multiAgent: {},
          sources: {},
          defaultProvider: 'test-provider',
        },
        skin: getSkin(),
        showThinking: false,
        spinnerIntervalMs: 100,
        typewriterRateMs: 0,
        userInputBridge: { isPending: () => false, provideInput: vi.fn() } as unknown as TuiRuntimeContext['userInputBridge'],
        permissionGate: { addSessionRule: vi.fn() } as unknown as TuiRuntimeContext['permissionGate'],
        events$: new Subject(),
        debug$: new Subject(),
        input$: new Subject(),
        abort$: new Subject(),
        sessionManager: {} as unknown as TuiRuntimeContext['sessionManager'],
      }) as unknown as TuiRuntimeContext,
    []
  );

  const setCurrentPage = useCallback((page: PageName) => {
    setState((prev) => ({ ...prev, currentPage: page, focusArea: 'inputBar' }));
  }, []);

  const setFocusArea = useCallback((area: FocusArea) => {
    setState((prev) => ({ ...prev, focusArea: area }));
  }, []);

  const setInputMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, inputMode: mode }));
  }, []);

  const setExitConfirmPending = useCallback((pending: boolean) => {
    setState((prev) => ({ ...prev, exitConfirmPending: pending }));
  }, []);

  const setShowHelp = useCallback((view: HelpView) => {
    setState((prev) => ({ ...prev, showHelp: view }));
  }, []);

  const setFilterMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, filterMode: mode }));
  }, []);

  const setEditMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, editMode: mode }));
  }, []);

  const updateConfig = useCallback((updates: Partial<AppState['config']>) => {
    setState((prev) => ({ ...prev, config: { ...prev.config, ...updates } }));
  }, []);

  const clearTraces = useCallback(() => {
    setState((prev) => ({ ...prev, debug: { ...prev.debug, traces: [] } }));
  }, []);

  const setLogPageFilter = useCallback((patch: Partial<LogPageFilter>) => {
    setState((prev) => ({ ...prev, logPageFilter: { ...prev.logPageFilter, ...patch } }));
  }, []);

  const setViewFilter = useCallback((filter: string | undefined) => {
    setState((prev) => ({ ...prev, viewFilter: filter }));
  }, []);

  const handleSendMessage = useCallback(
    (msg: string) => {
      onSendMessage?.(msg);
    },
    [onSendMessage]
  );

  useGlobalKeymapDispatcher({
    state,
    setState,
    runtime: mockRuntime,
    cyclePermissionMode: vi.fn(),
    setCurrentPage,
    setFocusArea,
    setInputMode,
    setExitConfirmPending,
    setShowHelp,
    sendMessage: handleSendMessage,
  });

  const contextValue: AppContextValue = {
    state,
    setState,
    setCurrentPage,
    setFocusArea,
    setInputMode,
    setExitConfirmPending,
    setShowHelp,
    setFilterMode,
    setEditMode,
    updateConfig,
    clearTraces,
    setLogPageFilter,
    setViewFilter,
  };

  if (contextRef) {
    contextRef.current = contextValue;
  }

  return (
    <AppContext.Provider value={contextValue}>
      <ChatArea runtime={mockRuntime} sendMessage={handleSendMessage} />
    </AppContext.Provider>
  );
}

describe('TUI 端到端交互与快照测试 (E2E Workflow)', () => {
  beforeAll(async () => {
    await initSkinRegistry();
  });

  it('测试 1（初始装配）：验证屏幕正确渲染初始状态（输入提示符与 Inspector 面板）', async () => {
    const harness = createTuiTestHarness(<TestTuiWorkbench />);
    try {
      const frame = await harness.waitForFrame(/❯/);
      expect(frame).toContain('❯');
      // 宽屏 120 列下 InspectorPanel 挂载，包含用量统计与控制提示
      expect(frame).toMatch(/(?:inspector|tokens|tools|ctrl\+o)/i);
    } finally {
      harness.unmount();
    }
  });

  it('测试 2（打字与多行编辑）：验证逐字输入与 Shift+Enter 多行换行编辑', async () => {
    const harness = createTuiTestHarness(<TestTuiWorkbench />);
    try {
      await harness.waitForFrame(/❯/);
      await harness.typeText('first line');
      await harness.waitForFrame(/first line/);

      // 触发 Kitty 协议 Shift+Enter (\x1b[13;2u)
      await harness.pressKey({ name: 'return', shift: true });
      await harness.typeText('second line');

      const multilineFrame = await harness.waitForFrame(/second line/);
      expect(multilineFrame).toContain('first line');
      expect(multilineFrame).toContain('second line');
    } finally {
      harness.unmount();
    }
  });

  it('测试 3（快捷撤销与草稿回填）：空输入框按 Ctrl+Z 触发撤销调度，且 inputDraft 注入自动回填', async () => {
    const sendMessage = vi.fn();
    const contextRef = { current: null as AppContextValue | null };

    const harness = createTuiTestHarness(
      <TestTuiWorkbench onSendMessage={sendMessage} contextRef={contextRef} />
    );
    try {
      await harness.waitForFrame(/❯/);

      // 1. 输入框为空时按下 Ctrl+Z
      await harness.pressKey({ name: 'z', ctrl: true });
      expect(sendMessage).toHaveBeenCalledWith('/undo');

      // 2. 模拟 context 回填 inputDraft
      expect(contextRef.current).not.toBeNull();
      contextRef.current?.setState((prev) => ({
        ...prev,
        inputDraft: 'Draft prompt content',
      }));

      // 3. 断言输入框自动回填原 Prompt
      const refilledFrame = await harness.waitForFrame(/Draft prompt content/);
      expect(refilledFrame).toContain('Draft prompt content');
    } finally {
      harness.unmount();
    }
  });

  it('测试 4（焦点轮转与 Tab 导航）：按 Tab 键焦点从输入模式切换至导航模式', async () => {
    const contextRef = { current: null as AppContextValue | null };
    const harness = createTuiTestHarness(<TestTuiWorkbench contextRef={contextRef} />);
    try {
      await harness.waitForFrame(/❯/);
      expect(contextRef.current?.state.focusArea).toBe('inputBar');
      expect(contextRef.current?.state.inputMode).toBe(true);

      // 按下 Tab 键进行焦点轮转
      await harness.pressKey('tab');

      // 等待并断言状态流转至导航模式
      await vi.waitFor(() => {
        expect(contextRef.current?.state.focusArea).toBe('agentTabs');
        expect(contextRef.current?.state.inputMode).toBe(false);
      });
    } finally {
      harness.unmount();
    }
  });

  it('测试 5（Inspector 看板树渲染）：注入层级 agents，断言树状引导线与状态徽章渲染', async () => {
    const agents: InputAgentNode[] = [
      {
        id: 'agent-root',
        name: 'Main Orchestrator',
        roleName: 'lead',
        depth: 0,
        status: 'running',
        startTime: Date.now(),
      },
      {
        id: 'agent-child-1',
        name: 'Worker Alpha',
        roleName: 'coder',
        depth: 1,
        status: 'running',
        startTime: Date.now(),
        parentId: 'agent-root',
      },
      {
        id: 'agent-child-2',
        name: 'Worker Beta',
        roleName: 'reviewer',
        depth: 1,
        status: 'completed',
        startTime: Date.now(),
        parentId: 'agent-root',
      },
    ];

    const harness = createTuiTestHarness(
      <TestTuiWorkbench
        initialState={{
          session: {
            ...createDefaultAppState().session,
            agents: agents as unknown as AgentNode[],
          },
        }}
      />
    );
    try {
      const frame = await harness.waitForFrame(/Worker Alp/);

      // 断言包含 Agent 名字核心前缀
      expect(frame).toContain('Main Orchestr');
      expect(frame).toContain('Worker Alp');
      expect(frame).toContain('Worker Be');

      // 断言包含树状引导分支字符（├─ 或 └─）
      expect(frame).toMatch(/├─|└─/);

      // 断言包含状态标识（[RUN] 或 [DONE]）
      expect(frame).toMatch(/\[RUN\]|\[DONE\]/);
    } finally {
      harness.unmount();
    }
  });
});
