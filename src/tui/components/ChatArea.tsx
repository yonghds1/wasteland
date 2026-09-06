/**
 * ChatArea - 单聊天区域
 *
 * 左右结构：
 * - 左栏：对话区（消息流 + 输入框，输入框归属对话列）
 * - 右栏：InspectorPanel（子 agent 状态 / 工具详情 / 用量，宽屏 ≥120 列且开关打开时挂载）
 *
 * ```
 * ┌────────────────────────────────────────────────┬──────────────┐
 * │ StatusBar (顶部状态栏)                          │              │
 * ├────────────────────────────────────────────────┤              │
 * │ AgentTabs (子 agent tab 条)                     │              │
 * ├────────────────────────────────────────────────┤ InspectorPanel│
 * │ MessageList / Help / sessions 页               │              │
 * ├────────────────────────────────────────────────┤              │
 * │ InputBar（归属对话列）                          │              │
 * └────────────────────────────────────────────────┴──────────────┘
 * ```
 */

import React, { useState } from 'react';
import { Box, useInput, useStdout } from 'ink';
import { ChatMessageList } from './ChatMessageList.js';
import { ChatInputBar } from './ChatInputBar.js';
import { ExitConfirm } from './ExitConfirm.js';
import { SessionIndexPage } from './SessionIndexPage.js';
import { AgentTabs } from './AgentTabs.js';
import { InspectorPanel } from './InspectorPanel.js';
import { HelpCommandsView } from './HelpCommandsView.js';
import { useAppContext } from '../context/AppContext.js';
import { getSkin } from '@skins/index.js';
import type { TuiRuntimeContext } from '../types.js';

/** 右栏最小宽度（列）；低于此宽度即使开关打开也不挂载。 */
const INSPECTOR_MIN_WIDTH = 26;
/** 挂载右栏的终端宽度阈值（100 列起：左 70 + 右 30，消息区仍可用）。 */
const INSPECTOR_MIN_COLUMNS = 100;

interface ChatAreaProps {
  runtime: TuiRuntimeContext;
  sendMessage: (content: string) => void;
}

export function ChatArea({ runtime, sendMessage }: ChatAreaProps): React.ReactElement {
  const { stdout } = useStdout();
  const { state, setCurrentPage } = useAppContext();
  const terminalRows = stdout?.rows ?? 24;
  const terminalColumns = stdout?.columns ?? 80;
  const isSessionsPage = state.currentPage === 'sessions';
  // help dialog 优先级最高:覆盖 sessions 页 / message list
  const isHelpCommands = state.showHelp === 'commands';
  const isHelpDialog = isHelpCommands;
  // 顶部 AgentTabs 占 1 行
  const topBarHeight = 1;
  // ChatInputBar 无边框占用 5 行（paddingTop 1 + 状态 1 + 输入 1 + 提示 1 + 误差 1）
  const inputBarBaseHeight = 5;
  // 留给对话列表的高度
  const viewportHeight = Math.max(5, terminalRows - topBarHeight - inputBarBaseHeight);
  // 右侧 Inspector 及其容器的总高度
  const mainAreaHeight = terminalRows - topBarHeight;

  // 右栏开关（Ctrl+O；宽屏默认开，窄屏自动隐藏）
  const [inspectorOpen, setInspectorOpen] = useState(true);
  useInput((inputChar, key) => {
    if (key.ctrl && (inputChar === 'o' || inputChar === 'O')) {
      setInspectorOpen((cur) => !cur);
    }
  });

  const showInspector =
    inspectorOpen &&
    !isSessionsPage &&
    !isHelpDialog &&
    terminalColumns >= INSPECTOR_MIN_COLUMNS;
  const inspectorWidth = showInspector
    ? Math.max(INSPECTOR_MIN_WIDTH, Math.floor(terminalColumns * 0.22))
    : 0;
  const mainWidth = showInspector ? terminalColumns - inspectorWidth : terminalColumns;

  // 动态解析当前视口（Tab）所对应的角色 Skin（切到子 Agent 时自动展示该子 Agent 专属角色）
  const activeAgent = state.session.agents.find((a) => a.id === state.viewFilter);
  const activeSkin = activeAgent?.skinId ? getSkin(activeAgent.skinId) : runtime.skin;

  return (
    <Box flexDirection="column" width={terminalColumns} height={terminalRows} overflow="hidden">
      {/* 顶部 agent tab 条 */}
      {!isSessionsPage && !isHelpDialog && <AgentTabs runtime={runtime} />}

      {/* 主体区域:左侧(对话+输入) + 右侧(检查器) */}
      <Box flexDirection="row" width={terminalColumns} height={mainAreaHeight} flexShrink={0} overflow="hidden">
        {/* 左侧：对话列 */}
        <Box flexDirection="column" width={mainWidth} height={mainAreaHeight} flexShrink={0}>
          <Box flexDirection="column" width={mainWidth} height={viewportHeight} overflow="hidden">
            {isHelpCommands ? (
              <HelpCommandsView />
            ) : isSessionsPage ? (
              <SessionIndexPage
                onClose={() => setCurrentPage('session')}
                onSelect={() => setCurrentPage('session')}
              />
            ) : (
              <ChatMessageList
                width={mainWidth}
                height={viewportHeight}
                selectedSkin={activeSkin}
                showThinking={runtime.showThinking}
                spinnerIntervalMs={runtime.spinnerIntervalMs}
                typewriterRateMs={runtime.typewriterRateMs}
                showInspector={showInspector}
              />
            )}
          </Box>
          {/* 底部输入框：归属对话列 */}
          {!isSessionsPage && !isHelpDialog && (
            <ChatInputBar
              width={mainWidth}
              sendMessage={sendMessage}
              selectedSkin={activeSkin}
              providerId={runtime.providerId}
              runtime={runtime}
            />
          )}
        </Box>

        {/* 右侧：检查器，高度和左侧 (视口+输入框) 保持一致 */}
        {showInspector && <InspectorPanel width={inspectorWidth} height={mainAreaHeight} />}
      </Box>

      {/* 退出确认 dialog（/exit 或 Ctrl+C 触发） */}
      {state.exitConfirmPending && <ExitConfirm />}
    </Box>
  );
}
