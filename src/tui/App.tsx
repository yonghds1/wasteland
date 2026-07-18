import React, { useState, useCallback } from 'react';
import { useInput } from 'ink';
import { ChatArea } from './components/ChatArea.js';
import { AppContext, type AppState, type PageName, type FocusArea } from './context/AppContext.js';
import { useRuntimeEvents } from './hooks/useRuntimeEvents.js';
import { useUserInput } from './hooks/useUserInput.js';
import { executeLocalCommand } from '../core/shared/local-commands.js';
import type { TuiRuntimeContext, TuiFullConfig } from './types.js';

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
  showHelp: false,
  filterMode: false,
  editMode: false,

  session: {
    agents: [],
    messages: [],
    tools: [],
    isThinking: false,
    isStreaming: false,
    streamingContent: '',
    streamingMessageId: null,
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

  // 订阅 runtime 事件
  useRuntimeEvents(runtime.events$, runtime.debug$, setState);

  // 用户输入处理（带本地命令拦截）
  const { sendMessage: rawSendMessage } = useUserInput(runtime.input$);

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

  // 本地命令拦截的 sendMessage 包装
  const sendMessage = useCallback(
    (content: string) => {
      // 检查是否为本地命令（以 / 开头）
      if (content.startsWith('/')) {
        const result = executeLocalCommand({ command: content });

        if (result.handled) {
          // 添加系统消息到 TUI 显示
          if (result.output) {
            const output = result.output;
            setState((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                messages: [
                  ...prev.session.messages,
                  {
                    id: `local-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    agentId: 'system',
                    type: 'system' as const,
                    content: output,
                  },
                ],
              },
            }));
          }

          // 处理清屏
          if (result.action === 'clear') {
            setState((prev) => ({ ...prev, session: { ...prev.session, messages: [] } }));
          }

          // 处理退出（由 ExitConfirm 组件处理）
          if (result.action === 'exit') {
            setExitConfirmPending(true);
          }

          return;
        }
      }

      // 非本地命令，发送到 agent loop
      rawSendMessage(content);
    },
    [rawSendMessage, setExitConfirmPending]
  );

  const setShowHelp = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showHelp: show }));
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

  // 全局键盘处理
  useInput((input, key) => {
    // Ctrl+C 全局退出
    if (key.ctrl && input === 'c') {
      if (state.exitConfirmPending) {
        process.exit(0);
      } else {
        setInputMode(false);
        setExitConfirmPending(true);
      }
      return;
    }

    // 退出确认
    if (state.exitConfirmPending) {
      if (input === 'y') {
        process.exit(0);
      } else {
        setExitConfirmPending(false);
      }
      return;
    }

    // 帮助对话框
    if (state.showHelp) {
      if (input === 'h' || key.escape) {
        setShowHelp(false);
      }
      return;
    }

    // Esc 退出输入模式
    if (key.escape && state.inputMode) {
      setInputMode(false);
      return;
    }

    // ? 打开帮助
    if (input === '?' && !state.inputMode) {
      setShowHelp(true);
      return;
    }

    // q 退出
    if (input === 'q' && !state.inputMode) {
      setExitConfirmPending(true);
      return;
    }

    // Enter 重新进入输入模式
    if (key.return && !state.inputMode && !state.showHelp && !state.exitConfirmPending) {
      setInputMode(true);
      setFocusArea('inputBar');
      return;
    }
  });

  return (
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
      }}
    >
      <ChatArea runtime={runtime} sendMessage={sendMessage} />
    </AppContext.Provider>
  );
}
