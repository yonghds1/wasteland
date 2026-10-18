import React, { useState, useCallback } from 'react';
import { LogBusProvider } from './components/LogBusProvider.js';
import {
  AppContext,
  type AppState,
  type PageName,
  type FocusArea,
  type HelpView,
  type LogPageFilter,
} from './context/AppContext.js';
import { useRuntimeEvents } from './hooks/useRuntimeEvents.js';
import { useUserInput } from './hooks/useUserInput.js';
import { useTerminalTitle } from './hooks/useTerminalTitle.js';
import { useCommandDispatcher } from './hooks/useCommandDispatcher.js';
import {
  useGlobalKeymapDispatcher,
  shouldEnterInputModeOnReturn,
} from './keymap/useGlobalKeymapDispatcher.js';
import { AppRouter } from './AppRouter.js';
import type { TuiRuntimeContext, TuiFullConfig } from './types.js';

export { shouldEnterInputModeOnReturn };

// 初始状态
const createInitialState = (
  config: TuiRuntimeContext['config'],
  session: TuiRuntimeContext['session'],
  providerId: string,
  fullConfig: TuiFullConfig
): AppState => ({
  currentPage: 'session',
  focusArea: 'inputBar', // 默认焦点在输入框
  inputMode: true, // 默认进入输入模式
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
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    },
    context: {
      isCompacting: false,
    },
  },

  debug: {
    traces: [],
    filter: {},
  },

  config,
  fullConfig,
  configEdit: {
    field: null,
    originalValue: '',
  },
  configHasChanges: false,

  sessionMetadata: {
    id: session.id,
    providerId,
  },
});

interface AppProps {
  runtime: TuiRuntimeContext;
}

export function App({ runtime }: AppProps): React.ReactElement {
  const [state, setState] = useState<AppState>(() =>
    createInitialState(runtime.config, runtime.session, runtime.providerId, runtime.fullConfig)
  );

  // 终端标题写入
  useTerminalTitle(state, runtime);

  // 订阅 runtime 事件
  useRuntimeEvents(runtime.events$, runtime.debug$, setState, runtime.fullConfig.multiAgent);

  // 用户输入通道
  const { sendMessage: rawSendMessage, peekTurn } = useUserInput(runtime.input$);

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
    setState((prev) => ({
      ...prev,
      config: { ...prev.config, ...updates },
      configHasChanges: true,
    }));
  }, []);

  const clearTraces = useCallback(() => {
    setState((prev) => ({
      ...prev,
      debug: { ...prev.debug, traces: [] },
    }));
  }, []);

  const setLogPageFilter = useCallback((patch: Partial<LogPageFilter>) => {
    setState((prev) => ({
      ...prev,
      logPageFilter: { ...prev.logPageFilter, ...patch },
    }));
  }, []);

  const setViewFilter = useCallback((filter: string | undefined) => {
    setState((prev) => ({ ...prev, viewFilter: filter }));
  }, []);

  // 命令分发器
  const { sendMessage, cyclePermissionMode } = useCommandDispatcher({
    state,
    setState,
    runtime,
    rawSendMessage,
    peekTurn,
    setCurrentPage,
    setExitConfirmPending,
    setShowHelp,
    setLogPageFilter,
  });

  // 全局键盘调度
  useGlobalKeymapDispatcher({
    state,
    setState,
    runtime,
    cyclePermissionMode,
    setCurrentPage,
    setFocusArea,
    setInputMode,
    setExitConfirmPending,
    setShowHelp,
  });

  return (
    <LogBusProvider>
      <AppContext.Provider
        value={{
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
        }}
      >
        <AppRouter runtime={runtime} sendMessage={sendMessage} />
      </AppContext.Provider>
    </LogBusProvider>
  );
}
