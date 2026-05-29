import React, { useState, useCallback } from "react";
import { Box, useInput, useStdout } from "ink";
import { Header } from "./components/common/Header.js";
import { Footer } from "./components/common/Footer.js";
import { HelpModal } from "./components/common/HelpModal.js";
import { ExitConfirm } from "./components/common/ExitConfirm.js";
import { SessionPage } from "./components/session/SessionPage.js";
import { DebugPage } from "./components/debug/DebugPage.js";
import { ConfigPage } from "./components/config/ConfigPage.js";
import { AppContext, type AppState, type PageName, type FocusArea } from "./context/AppContext.js";
import { useRuntimeEvents } from "./hooks/useRuntimeEvents.js";
import { useUserInput } from "./hooks/useUserInput.js";
import type { TuiRuntimeContext, TuiFullConfig } from "./types.js";

// 初始状态
const createInitialState = (config: TuiRuntimeContext["config"], session: TuiRuntimeContext["session"], providerId: string, fullConfig: TuiFullConfig): AppState => ({
  currentPage: "session",
  focusArea: null,  // 初始无焦点
  inputMode: false,
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
    streamingContent: "",
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
    originalValue: "",
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
  const [state, setState] = useState<AppState>(() => createInitialState(runtime.config, runtime.session, runtime.providerId, runtime.fullConfig));

  // 订阅 runtime 事件
  useRuntimeEvents(runtime.events$, runtime.debug$, setState);

  // 用户输入处理
  const { sendMessage } = useUserInput(runtime.input$);

  // 页面切换（重置焦点到 header）
  const setCurrentPage = useCallback((page: PageName) => {
    setState((prev) => ({ ...prev, currentPage: page, focusArea: "header" }));
  }, []);

  // 焦点设置
  const setFocusArea = useCallback((area: FocusArea) => {
    setState((prev) => ({ ...prev, focusArea: area }));
  }, []);

  // 输入模式设置
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

  // 获取终端尺寸
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalColumns = stdout?.columns ?? 80;
  const contentHeight = Math.max(terminalRows - 6, 5);

  // 页面区域配置
  const pageAreas: Record<PageName, FocusArea[]> = {
    session: ["header", "agentTree", "messageList", "inputBar"],
    debug: ["header", "traceLog"],
    config: ["header", "configList"],
  };

  // 全局键盘处理
  useInput((input, key) => {
    // Ctrl+C 全局退出
    if (key.ctrl && input === "c") {
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
      if (input === "y") {
        process.exit(0);
      } else {
        setExitConfirmPending(false);
      }
      return;
    }

    // 帮助模态框
    if (state.showHelp) {
      if (input === "h" || key.escape) {
        setShowHelp(false);
      }
      return;
    }

    // 过滤模式
    if (state.filterMode) {
      if (key.escape) {
        setFilterMode(false);
      }
      return;
    }

    // 编辑模式
    if (state.editMode) {
      return;
    }

    // ===== 输入模式下的处理 =====
    if (state.inputMode) {
      // Tab 切换焦点
      if (key.tab) {
        const areas = pageAreas[state.currentPage];
        const currentIndex = state.focusArea ? (areas as string[]).indexOf(state.focusArea) : -1;
        const nextIndex = key.shift
          ? (currentIndex - 1 + areas.length) % areas.length
          : (currentIndex + 1) % areas.length;
        const nextArea = areas[nextIndex];

        // 切换焦点时退出输入模式
        if (nextArea !== "inputBar") {
          setInputMode(false);
        }
        setFocusArea(nextArea);
        return;
      }
      // Esc 退出输入模式
      if (key.escape) {
        setInputMode(false);
        return;
      }
      return;
    }

    // ===== 非输入模式下的处理 =====

    // Esc 清除焦点
    if (key.escape) {
      setFocusArea(null);
      return;
    }

    // Tab 切换焦点
    if (key.tab) {
      const areas = pageAreas[state.currentPage];
      const currentIndex = state.focusArea ? (areas as string[]).indexOf(state.focusArea) : -1;
      // 无焦点时 Tab 进入第一个区域，有焦点时循环切换
      const nextIndex = state.focusArea === null
        ? 0
        : key.shift
          ? (currentIndex - 1 + areas.length) % areas.length
          : (currentIndex + 1) % areas.length;
      setFocusArea(areas[nextIndex]);
      return;
    }

    // Ctrl+Enter 进入输入模式 (Session 页面)
    if (key.return && key.ctrl && state.currentPage === "session") {
      setFocusArea("inputBar");
      setInputMode(true);
      return;
    }

    // Enter 快捷进入
    if (key.return && !key.ctrl) {
      if (state.focusArea === "inputBar") {
        setInputMode(true);
        return;
      }
      if (state.focusArea === null || state.focusArea === "header") {
        if (state.currentPage === "session") {
          setFocusArea("inputBar");
        } else if (state.currentPage === "debug") {
          setFocusArea("traceLog");
        } else if (state.currentPage === "config") {
          setFocusArea("configList");
        }
        return;
      }
    }

    // 导航区域方向键
    if (state.focusArea === "header") {
      if (key.leftArrow) {
        const pages: PageName[] = ["session", "debug", "config"];
        const idx = pages.indexOf(state.currentPage);
        setCurrentPage(pages[(idx - 1 + pages.length) % pages.length]);
        return;
      }
      if (key.rightArrow) {
        const pages: PageName[] = ["session", "debug", "config"];
        const idx = pages.indexOf(state.currentPage);
        setCurrentPage(pages[(idx + 1) % pages.length]);
        return;
      }
    }

    // 其他快捷键
    if (input === "h") {
      setShowHelp(true);
      return;
    }

    if (input === "q") {
      setExitConfirmPending(true);
      return;
    }

    // 页面特定快捷键
    if (state.currentPage === "debug") {
      if (input === "f") {
        setFilterMode(true);
        return;
      }
      if (input === "c") {
        clearTraces();
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

  const renderContent = () => {
    if (state.showHelp) {
      return (
        <Box height={contentHeight} width={terminalColumns} flexDirection="column" alignItems="center" justifyContent="center">
          <HelpModal width={terminalColumns} />
        </Box>
      );
    }

    if (state.exitConfirmPending) {
      return (
        <Box height={contentHeight} width={terminalColumns} flexDirection="column" alignItems="center" justifyContent="center">
          <ExitConfirm width={terminalColumns} />
        </Box>
      );
    }

    return <Box height={contentHeight} width={terminalColumns}>{renderPage()}</Box>;
  };

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
      <Box flexDirection="column" width={terminalColumns} height={terminalRows}>
        <Header width={terminalColumns} />
        {renderContent()}
        <Footer width={terminalColumns} />
      </Box>
    </AppContext.Provider>
  );
}
