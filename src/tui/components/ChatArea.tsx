/**
 * ChatArea - 单聊天区域
 *
 * OpenCode 风格的单视口界面，所有内容在一个可滚动区域。
 *
 * ## 布局
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │ StatusBar (顶部状态栏)                                   │
 * ├─────────────────────────────────────────────────────────┤
 * │ AgentTabs (子 agent tab 条)                              │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │  MessageList (消息列表)                                  │
 * │  或 HelpShortcutsView / HelpCommandsView (help dialog)   │
 * │  或 SessionIndexPage (sessions 页)                       │
 * │                                                         │
 * ├─────────────────────────────────────────────────────────┤
 * │ InputBar (输入框,help dialog / sessions 页时隐藏)         │
 * └─────────────────────────────────────────────────────────┘
 * ```
 */

import React from 'react';
import { Box, useStdout } from 'ink';
import { ChatMessageList } from './ChatMessageList.js';
import { ChatInputBar } from './ChatInputBar.js';
import { ExitConfirm } from './ExitConfirm.js';
import { SessionIndexPage } from './SessionIndexPage.js';
import { AgentTabs } from './AgentTabs.js';
import { HelpCommandsView } from './HelpCommandsView.js';
import { useAppContext } from '../context/AppContext.js';
import { getSkin } from '@skins/index.js';
import type { TuiRuntimeContext } from '../types.js';

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
  const viewportHeight = Math.max(5, terminalRows - 6);

  // 动态解析当前视口（Tab）所对应的角色 Skin（切到子 Agent 时自动展示该子 Agent 专属角色）
  const activeAgent = state.session.agents.find((a) => a.id === state.viewFilter);
  const activeSkin = activeAgent?.skinId ? getSkin(activeAgent.skinId) : runtime.skin;

  return (
    <Box flexDirection="column" width={terminalColumns} height={terminalRows}>
      {/* 顶部 agent tab 条(07-31 后,合并原 StatusBar 的品牌名 / thinking /
         streaming 三件事到同一条;内容含 skin label 与状态 prose)。
         sessions 页 / help dialog 时隐藏 */}
      {!isSessionsPage && !isHelpDialog && <AgentTabs runtime={runtime} />}

      {/* 主体区域:根据 currentPage / showHelp 切换主视图 */}
      <Box flexGrow={1} width={terminalColumns} height={viewportHeight} overflow="hidden">
        {isHelpCommands ? (
          <HelpCommandsView />
        ) : isSessionsPage ? (
          <SessionIndexPage
            onClose={() => setCurrentPage('session')}
            onSelect={() => setCurrentPage('session')}
          />
        ) : (
          <ChatMessageList
            width={terminalColumns}
            height={viewportHeight}
            selectedSkin={activeSkin}
            showThinking={runtime.showThinking}
            spinnerIntervalMs={runtime.spinnerIntervalMs}
            typewriterRateMs={runtime.typewriterRateMs}
          />
        )}
      </Box>

      {/* 底部输入框(sessions 页 / help dialog 时隐藏) */}
      {!isSessionsPage && !isHelpDialog && (
        <ChatInputBar
          width={terminalColumns}
          sendMessage={sendMessage}
          selectedSkin={activeSkin}
          providerId={runtime.providerId}
          runtime={runtime}
        />
      )}

      {/* 退出确认 dialog（/exit 或 Ctrl+C 触发） */}
      {state.exitConfirmPending && <ExitConfirm />}
    </Box>
  );
}
