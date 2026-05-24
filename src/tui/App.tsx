import React, { useState, useCallback } from "react";
import { Box, useInput, useStdout } from "ink";
import { Header } from "./components/common/Header.js";
import { Footer } from "./components/common/Footer.js";
import { HelpModal } from "./components/common/HelpModal.js";
import { ExitConfirm } from "./components/common/ExitConfirm.js";
import { SessionPage } from "./components/session/SessionPage.js";
import { DebugPage } from "./components/debug/DebugPage.js";
import { ConfigPage } from "./components/config/ConfigPage.js";
import { AppContext, type AppState, type PageName } from "./context/AppContext.js";
import { useRuntimeEvents } from "./hooks/useRuntimeEvents.js";
import { useUserInput } from "./hooks/useUserInput.js";
import type { TuiRuntimeContext } from "./types.js";

// 初始状态
const createInitialState = (config: TuiRuntimeContext["config"], session: TuiRuntimeContext["session"], providerId: string): AppState => ({
  currentPage: "session",

  // 模式状态
  inputMode: false,
  exitConfirmPending: false,
  showHelp: false,
  filterMode: false,
  editMode: false,

  session: {
    agents: [],
    messages: [],
    tools: [],
    isStreaming: false,
  },

  debug: {
    traces: [],
    filter: {},
  },

  config,
  configEdit: {
    field: null,
    originalValue: "",
  },
  configHasChanges: false,

  // Session 元数据
  sessionMetadata: {
    id: session.id,
    providerId,
  },
});

interface AppProps {
  runtime: TuiRuntimeContext;
}

export function App({ runtime }: AppProps): React.ReactElement {
  const [state, setState] = useState<AppState>(() => createInitialState(runtime.config, runtime.session, runtime.providerId));

  // 订阅 runtime 事件
  useRuntimeEvents(runtime.events$, runtime.debug$, setState);

  // 用户输入处理
  const { sendMessage } = useUserInput(runtime.input$);

  const setCurrentPage = useCallback((page: PageName) => {
    setState((prev) => ({ ...prev, currentPage: page }));
  }, []);

  const setInputMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, inputMode: mode }));
  }, []);

  const setExitConfirmPending = useCallback((pending: boolean) => {
    setState((prev) => ({ ...prev, exitConfirmPending: pending }));
  }, []);

  const setShowHelp = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showHelp: show }));
  }, []);

  const setFilterMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, filterMode: mode }));
  }, []);

  const setEditMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, editMode: mode }));
  }, []);

  const updateConfig = useCallback((updates: Partial<AppState["config"]>) => {
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

  // 获取终端尺寸，实现全屏布局
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalColumns = stdout?.columns ?? 80;

  // Header 约 3 行（含边框），Footer 约 3 行（含边框）
  const contentHeight = Math.max(terminalRows - 6, 5);

  // 全局键盘快捷键（所有模式下都生效，但行为不同）
  useInput((input, key) => {
    // Ctrl+C 全局退出（所有模式下都生效）
    if (key.ctrl && input === "c") {
      if (state.exitConfirmPending) {
        // 已在退出确认状态，直接退出
        process.exit(0);
      } else {
        // 进入退出确认状态，同时退出输入模式
        setInputMode(false);
        setExitConfirmPending(true);
      }
      return;
    }

    // 退出确认处理（优先级高于模式判断，确保 y/n 始终可用）
    if (state.exitConfirmPending) {
      if (input === "y") {
        process.exit(0);
      } else {
        // 其他键取消退出
        setExitConfirmPending(false);
      }
      return;
    }

    // 输入模式下，不处理快捷键（由 InputBar 处理）
    if (state.inputMode) {
      return;
    }

    // 过滤模式下（调试页面），不处理快捷键（由 TraceFilter 处理）
    if (state.filterMode) {
      // Esc 退出过滤模式
      if (key.escape) {
        setFilterMode(false);
        return;
      }
      return;
    }

    // 编辑模式下（配置页面），不处理快捷键（由 ConfigPage 处理）
    if (state.editMode) {
      return;
    }

    // ===== 导航模式快捷键 =====

    // 显示帮助
    if (input === "h" && !state.showHelp) {
      setShowHelp(true);
      return;
    }

    // 关闭帮助
    if ((input === "h" || key.escape) && state.showHelp) {
      setShowHelp(false);
      return;
    }

    // q 键请求退出
    if (input === "q") {
      setExitConfirmPending(true);
      return;
    }

    // Tab / Shift+Tab 切换页面
    if (key.tab) {
      const pages: PageName[] = ["session", "debug", "config"];
      const currentIndex = pages.indexOf(state.currentPage);
      const nextIndex = key.shift
        ? (currentIndex - 1 + pages.length) % pages.length
        : (currentIndex + 1) % pages.length;
      setCurrentPage(pages[nextIndex]);
      return;
    }

    // Enter 进入输入模式（仅在会话页面）
    if (key.return && state.currentPage === "session") {
      setInputMode(true);
      return;
    }

    // ===== 页面特定快捷键 =====

    // 调试页面快捷键
    if (state.currentPage === "debug") {
      // f 进入过滤模式
      if (input === "f") {
        setFilterMode(true);
        return;
      }
      // c 清空日志
      if (input === "c") {
        clearTraces();
        return;
      }
    }

    // 配置页面快捷键
    if (state.currentPage === "config") {
      // Ctrl+S 保存配置
      if (input === "s" && key.ctrl) {
        // 保存逻辑在 ConfigPage 中处理
        return;
      }
      // Ctrl+R 重置配置
      if (input === "r" && key.ctrl) {
        // 重置逻辑在 ConfigPage 中处理
        return;
      }
    }
  });

  const renderPage = () => {
    switch (state.currentPage) {
      case "session":
        return <SessionPage height={contentHeight} width={terminalColumns} sendMessage={sendMessage} />;
      case "debug":
        return <DebugPage height={contentHeight} width={terminalColumns} />;
      case "config":
        return <ConfigPage height={contentHeight} width={terminalColumns} />;
    }
  };

  // 渲染内容区域（可能被模态框覆盖）
  const renderContent = () => {
    // 帮助模态框
    if (state.showHelp) {
      return (
        <Box
          height={contentHeight}
          width={terminalColumns}
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <HelpModal width={terminalColumns} />
        </Box>
      );
    }

    // 退出确认模态框
    if (state.exitConfirmPending) {
      return (
        <Box
          height={contentHeight}
          width={terminalColumns}
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <ExitConfirm width={terminalColumns} />
        </Box>
      );
    }

    // 正常内容
    return <Box height={contentHeight} width={terminalColumns}>{renderPage()}</Box>;
  };

  return (
    <AppContext.Provider
      value={{
        state,
        setState,
        setCurrentPage,
        setInputMode,
        setExitConfirmPending,
        setShowHelp,
        setFilterMode,
        setEditMode,
        updateConfig,
        clearTraces,
      }}
    >
      <Box flexDirection="column" width={terminalColumns}>
        <Header width={terminalColumns} />
        {renderContent()}
        <Footer width={terminalColumns} />
      </Box>
    </AppContext.Provider>
  );
}
