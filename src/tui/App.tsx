import React, { useState, useCallback, useEffect } from 'react';
import { useInput, useApp, useStdout } from 'ink';
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

  // 终端标题通知：根据状态设置 window title，让用户在 tab/任务栏一眼看到状态
  // - 流式中：⠋ wasteland（与 TUI 内 spinner 同节奏提示）
  // - 思考中：⏳ wasteland（等首个 chunk）
  // - 空闲：wasteland
  const { stdout } = useStdout();
  useEffect(() => {
    let title = 'wasteland';
    if (state.session.isStreaming) {
      title = '⠋ wasteland';
    } else if (state.session.isThinking) {
      title = '⏳ wasteland';
    }
    // OSC 0 (set window title) + BEL 终止符
    stdout.write(`\x1b]0;${title}\x07`);
  }, [state.session.isStreaming, state.session.isThinking, stdout]);

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

          // 处理 /sessions：进入 session 索引页
          if (result.action === 'sessions') {
            setCurrentPage('sessions');
          }

          return;
        }
      }

      // 非本地命令，发送到 agent loop
      rawSendMessage(content);
    },
    [rawSendMessage, setExitConfirmPending, setCurrentPage]
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
  const { exit } = useApp();
  useInput((input, key) => {
    // Ctrl+C 全局退出
    if (key.ctrl && input === 'c') {
      if (state.exitConfirmPending) {
        exit();
      } else {
        setInputMode(false);
        setExitConfirmPending(true);
      }
      return;
    }

    // 退出确认
    if (state.exitConfirmPending) {
      if (input === 'y') {
        exit();
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

    // Tab / Shift+Tab 在当前页面的可聚焦区域间循环切换
    // （修复前：没有 Tab 处理，按 Tab 会被 ChatInputBar 当作字符插入输入框）
    if (key.tab) {
      const focusCycle: Record<PageName, FocusArea[]> = {
        session: ['messageList', 'inputBar'],
        debug: ['traceLog'],
        config: ['configList'],
        sessions: [],
      };
      const cycle = focusCycle[state.currentPage] ?? [];
      if (cycle.length > 1) {
        const currentIdx = state.focusArea ? cycle.indexOf(state.focusArea) : -1;
        const direction = key.shift ? -1 : 1;
        const nextIdx = currentIdx < 0
          ? (direction > 0 ? 0 : cycle.length - 1)
          : (currentIdx + direction + cycle.length) % cycle.length;
        const nextArea = cycle[nextIdx];
        setFocusArea(nextArea);
        // 同步 inputMode：进入输入框自动开启输入模式；离开则关闭
        if (nextArea === 'inputBar') {
          setInputMode(true);
        } else if (state.focusArea === 'inputBar') {
          setInputMode(false);
        }
      }
      return;
    }

    // Esc 在 sessions 页退出（回到 session 页，sessions 页没有输入框所以 Esc 走这里）
    if (
      key.escape &&
      state.currentPage === 'sessions' &&
      !state.exitConfirmPending
    ) {
      setCurrentPage('session');
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
