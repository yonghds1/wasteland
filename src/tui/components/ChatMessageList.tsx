/**
 * ChatMessageList - 聊天消息列表 (严格视口虚拟化版本)
 *
 * OpenCode 风格: author 标签制, 去边框, 靠颜色与留白区分消息。
 * 核心优化：
 * 1. 严格 1:1 虚拟行高度预算裁剪，杜绝富文本块撑爆视口；
 * 2. 抽离 useChatScroll 滚动与边界状态机；
 * 3. 任何时刻仅将可见切片范围内的 ~30 个节点挂入 Ink 渲染树，超长会话 0 掉帧。
 */

import React from 'react';
import { Text, Box, useStdout } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { type Skin } from '@skins/index.js';
import { resolvePalette } from '@theme/palette.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { Scrollbar } from './Scrollbar.js';
import { buildStreamingLines } from './streaming-status.js';
import { useChatScroll } from './chat/useChatScroll.js';
import {
  useSpinnerFrame,
  useElapsedTimer,
  getRoleCatchphrase,
} from './chat-message-utils.js';
import {
  flattenSingleMessage,
  type FlattenContext,
} from './chat/flattenMessageToLines.js';

export interface ChatMessageListProps {
  width: number;
  height?: number;
  selectedSkin: Skin;
  /** 是否展示 <think> 思考块，默认 true */
  showThinking?: boolean;
  /** Spinner 帧切换间隔（毫秒），默认 80 */
  spinnerIntervalMs?: number;
  /** 打字机逐字符揭示间隔（毫秒），默认 30 */
  typewriterRateMs?: number;
  /** 是否显示侧边栏 */
  showInspector?: boolean;
}

export function ChatMessageList({
  width,
  height,
  selectedSkin,
  showThinking = true,
  spinnerIntervalMs = wastelandTheme.animations.spinnerIntervalMs,
  typewriterRateMs: _typewriterRateMs = wastelandTheme.animations.typewriterRateMs,
  showInspector = false,
}: ChatMessageListProps): React.ReactElement {
  const { stdout } = useStdout();
  const { state } = useAppContext();
  const terminalRows = stdout?.rows ?? 24;
  const availableHeight = height ?? Math.max(5, terminalRows - 7);
  const contentWidth = Math.max(10, width - 1);

  const allMessages = state.session.messages;
  const viewFilter = state.viewFilter;
  const messages =
    viewFilter === undefined ? allMessages : allMessages.filter((m) => m.agentId === viewFilter);
  const palette = resolvePalette(selectedSkin);

  const [showDetails, setShowDetails] = React.useState(false);
  const hasRunningSubAgent = state.session.agents.some((a) => a.depth >= 1 && a.status === 'running');
  const hasRunningTool = state.session.tools.some((t) => t.status === 'running');
  const isWorking = state.session.isStreaming || state.session.isThinking || hasRunningSubAgent || hasRunningTool;
  const currentSpinnerIcon = useSpinnerFrame(spinnerIntervalMs, isWorking);
  const elapsedSec = useElapsedTimer(isWorking);

  // 1. 视口虚拟行收集（1:1 行高对齐）
  const visualLines: React.ReactElement[] = [];

  // (1) 空状态欢迎语
  if (messages.length === 0) {
    visualLines.push(
      <Box key="w-0" width={contentWidth} height={1} />,
      <Box key="w-1" width={contentWidth} justifyContent="center" height={1}>
        <Text color={palette.label} bold>
          {selectedSkin.label} · {t('tui.session.messages.welcomeTitle')}
        </Text>
      </Box>,
      <Box key="w-2" width={contentWidth} justifyContent="center" height={1}>
        <Text color={wastelandTheme.colors.secondary}>{getRoleCatchphrase(selectedSkin)}</Text>
      </Box>,
      <Box key="w-3" width={contentWidth} justifyContent="center" height={1}>
        <Text color={wastelandTheme.colors.muted}>{t('tui.session.messages.chatStartHint')}</Text>
      </Box>,
      <Box key="w-4" width={contentWidth} height={1} />
    );
  }

  // (2) 消息列表展平（逐行展平，含两级缓存）
  const flattenCtx: FlattenContext = {
    contentWidth,
    palette,
    selectedSkin,
    state,
    showThinking,
    showDetails,
  };

  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const message = messages[mIdx];
    if (!message) continue;
    const isLast = mIdx === messages.length - 1;
    visualLines.push(...flattenSingleMessage(message, mIdx, flattenCtx, isLast));
  }

  // (3) 流式输出 + 后台状态尾部
  const subAgents = state.session.agents.filter((a) => a.depth >= 1);
  const runningSubAgents = subAgents.filter((a) => a.status === 'running');
  const runningTool = state.session.tools.find((t) => t.status === 'running');
  visualLines.push(
    ...buildStreamingLines({
      contentWidth,
      streamingContent: state.session.streamingContent,
      isStreaming: state.session.isStreaming,
      paletteLabel: palette.label,
      paletteText: palette.text,
      paletteThinking: palette.thinking ?? wastelandTheme.colors.muted,
      skinLabel: selectedSkin.label,
      showThinking,
      spinnerIcon: currentSpinnerIcon,
      subAgents,
      runningSubAgents,
      runningTool,
      viewFilter,
      elapsedSec,
      showInspector,
      isWorking,
      allAgentsIdle: state.session.agents.every((a) => a.status !== 'running' || a.depth === 0),
    })
  );

  const totalLines = visualLines.length;

  // 2. 视口滚动状态机与按键/鼠标监听
  const { clampedOffset, showTopHint, pendingNew, contentLineBudget } = useChatScroll({
    totalLines,
    availableHeight,
    width,
    inputMode: state.inputMode,
    setShowDetails,
  });

  // 3. 严格视口窗口切片 (Strict Virtual Windowing Slicing)
  const visibleLines = visualLines.slice(clampedOffset, clampedOffset + contentLineBudget);

  return (
    <Box flexDirection="row" width={width} height={availableHeight}>
      {/* 消息主视口 */}
      <Box flexDirection="column" width={contentWidth} height={availableHeight} overflow="hidden">
        {showTopHint && (
          <Box height={1} width={contentWidth} flexShrink={0}>
            <Text color={wastelandTheme.colors.muted} dimColor>
              ▲ 上方还有 {clampedOffset} 行历史记录 (PageUp / Shift+↑ 翻看)
            </Text>
          </Box>
        )}
        {visibleLines}
        {pendingNew > 0 && (
          <Box height={1} width={contentWidth} flexShrink={0}>
            <Text color={wastelandTheme.colors.primary} bold>
              {t('tui.session.messages.newLines', { count: String(pendingNew) })}
            </Text>
          </Box>
        )}
      </Box>

      {/* 右侧垂直滚动条 */}
      <Scrollbar
        height={availableHeight}
        totalItems={totalLines}
        visibleItems={availableHeight}
        offset={clampedOffset}
      />
    </Box>
  );
}
