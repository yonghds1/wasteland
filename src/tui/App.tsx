/**
 * App - TUI 根组件
 *
 * 管理页面路由和全局状态
 */

import React, { useState, useCallback } from "react";
import { Box, useInput, useStdout } from "ink";
import { Header } from "./components/common/Header.js";
import { Footer } from "./components/common/Footer.js";
import { SessionPage } from "./components/session/SessionPage.js";
import { DebugPage } from "./components/debug/DebugPage.js";
import { ConfigPage } from "./components/config/ConfigPage.js";
import { AppContext, type AppState, type PageName } from "./context/AppContext.js";

export function App(): React.ReactElement {
  const [state, setState] = useState<AppState>({
    currentPage: "session",
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
    config: {
      provider: "local",
      model: "",
      permissionMode: "default",
      maxTurns: 20,
      maxSteps: 8,
    },
  });

  const setCurrentPage = useCallback((page: PageName) => {
    setState((prev) => ({ ...prev, currentPage: page }));
  }, []);

  // 获取终端尺寸，实现全屏布局
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // 内容区高度 = 终端行数 - Header(3行) - Footer(3行)
  const contentHeight = Math.max(terminalRows - 6, 5);

  // 全局键盘快捷键
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      process.exit(0);
    }

    if (key.tab) {
      // Tab 切换页面
      const pages: PageName[] = ["session", "debug", "config"];
      const currentIndex = pages.indexOf(state.currentPage);
      const nextIndex = (currentIndex + 1) % pages.length;
      setCurrentPage(pages[nextIndex]);
    }

    if (input === "1") setCurrentPage("session");
    if (input === "2") setCurrentPage("debug");
    if (input === "3") setCurrentPage("config");
  });

  const renderPage = () => {
    switch (state.currentPage) {
      case "session":
        return <SessionPage height={contentHeight} />;
      case "debug":
        return <DebugPage height={contentHeight} />;
      case "config":
        return <ConfigPage height={contentHeight} />;
    }
  };

  return (
    <AppContext.Provider value={{ state, setState, setCurrentPage }}>
      <Box flexDirection="column">
        <Header />
        <Box height={contentHeight}>{renderPage()}</Box>
        <Footer />
      </Box>
    </AppContext.Provider>
  );
}
