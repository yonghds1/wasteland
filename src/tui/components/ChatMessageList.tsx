
/**
 * ChatMessageList - 聊天消息列表
 *
 * OpenCode 风格:author 标签制,去边框,靠颜色与留白区分消息。
 *
 * ## 消息呈现
 *
 * - user / assistant:author 标签(带色) + 内容,消息间留白
 * - tool / 子 Agent:紧凑单行 `⏺ ...`
 * - system:淡色单行
 *
 * ## 思考块（minimax/DeepSeek R1 等）
 *
 * 模型把思考过程作为 `<think>...</think>` 拼到 assistant content。
 * 这里用 splitThinkTags 拆出 thinking，单独用 💭 + dim 样式渲染
 * （参考 Claude Code / OpenCode）。showThinking=false 时隐藏。
 */

import React from 'react';
import { Text, Box, useInput, useStdout } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { type Skin } from '@skins/index.js';
import { resolvePalette } from '@theme/palette.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { Scrollbar } from './Scrollbar.js';
import { buildStreamingLines } from './streaming-status.js';
import { useMouseWheel } from '../mouse/useMouseWheel.js';
import {
  countNewLines,
  useSpinnerFrame,
  useElapsedTimer,
  getRoleCatchphrase,
} from './chat-message-utils.js';
import {
  flattenSingleMessage,
  type FlattenContext,
} from './chat/flattenMessageToLines.js';


interface ChatMessageListProps {
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

  const hasRunningSubAgent = state.session.agents.some((a) => a.depth >= 1 && a.status === 'running');
  const hasRunningTool = state.session.tools.some((t) => t.status === 'running');
  const isWorking = state.session.isStreaming || state.session.isThinking || hasRunningSubAgent || hasRunningTool;
  const currentSpinnerIcon = useSpinnerFrame(spinnerIntervalMs, isWorking);
  const elapsedSec = useElapsedTimer(isWorking);
  // 欢迎语每挂载一次只抽一次，避免流式重绘时每次 render 变化闪烁
  const [greeting] = React.useState(
    () => selectedSkin.greeting[Math.floor(Math.random() * selectedSkin.greeting.length)] ?? ''
  );
  // R8/R9 详情态（Ctrl+T）：展开思考全文 + 工具原文，默认收起（零视口挤占）
  // 注意：必须在 visualLines 构建之前声明（构建期即读取）。
  const [showDetails, setShowDetails] = React.useState(false);

  // 1. 将所有聊天元素展平为虚拟物理行（Visual Lines）
  const visualLines: React.ReactElement[] = [];

  // (1) 欢迎消息
  if (messages.length === 0 && viewFilter === undefined) {
    visualLines.push(
      <Box key="w-1" width={contentWidth} justifyContent="center" height={1}>
        <Text color={palette.label} bold>{greeting}</Text>
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

  // (2) 消息列表展平（含代码高亮、Diff 对比与两级渲染缓存）
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

  // (3) 流式输出 + 后台状态尾部（抽至 streaming-status，零逻辑改动）
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
    }),
  );

  const totalLines = visualLines.length;
  const maxOffset = Math.max(0, totalLines - availableHeight);
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const [stickToBottom, setStickToBottom] = React.useState(true);

  // 2. 自动钉底
  React.useEffect(() => {
    if (stickToBottom) {
      setScrollOffset(maxOffset);
    }
  }, [totalLines, maxOffset, stickToBottom]);

  const isDraggingScrollbarRef = React.useRef(false);

  // 3. 鼠标滚轮与滚动条拖拽监听（方案 B：文本区释放给原生划词复制，右侧专精滑块拖拽与轨道跳转）
  useMouseWheel({
    enabled: true,
    onWheelUp: () => {
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - 3));
    },
    onWheelDown: () => {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + 3);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
    },
    onMouseDown: (x, y) => {
      // 仅在右侧滚动条区域（x >= width - 2）且在视口垂直范围内激活滑块拖拽与跳转
      if (x >= width - 2 && y >= 2 && y <= 1 + availableHeight) {
        isDraggingScrollbarRef.current = true;
        const relY = Math.max(0, Math.min(y - 2, availableHeight - 1));
        const ratio = relY / Math.max(1, availableHeight - 1);
        const targetOffset = Math.round(ratio * maxOffset);
        setScrollOffset(targetOffset);
        setStickToBottom(targetOffset >= maxOffset);
      }
    },
    onMouseDrag: (_x, y) => {
      if (!isDraggingScrollbarRef.current) return;
      const relY = Math.max(0, Math.min(y - 2, availableHeight - 1));
      const ratio = relY / Math.max(1, availableHeight - 1);
      const targetOffset = Math.round(ratio * maxOffset);
      setScrollOffset(targetOffset);
      setStickToBottom(targetOffset >= maxOffset);
    },
    onMouseUp: () => {
      isDraggingScrollbarRef.current = false;
    },
  });

  // 4. 键盘翻页监听（支持 PageUp/Down、Shift+↑/↓ 微调、Ctrl+U/D 翻半屏、Home/End 跳首尾、Ctrl+T 详情）
  useInput((input, key) => {
    const halfPage = Math.max(1, Math.floor(availableHeight / 2));
    if (key.ctrl && (input === 't' || input === 'T')) {
      setShowDetails((cur) => !cur);
      return;
    }
    if (key.home && !state.inputMode) {
      setStickToBottom(false);
      setScrollOffset(0);
      return;
    }
    if (key.end && !state.inputMode) {
      setStickToBottom(true);
      setScrollOffset(maxOffset);
      return;
    }
    if (key.pageUp || (key.ctrl && input === 'u')) {
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - halfPage));
    } else if (key.pageDown || (key.ctrl && input === 'd')) {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + halfPage);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
    } else if (key.shift && key.upArrow) {
      // Shift + ↑ 微调向上 3 行
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - 3));
    } else if (key.shift && key.downArrow) {
      // Shift + ↓ 微调向下 3 行
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + 3);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
    }
  });

  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const showTopHint = clampedOffset > 0;
  const maxDisplayLines = showTopHint ? Math.max(1, availableHeight - 1) : availableHeight;
  // R7 未读 badge：脱钉且视口下方有新行时预留末行展示
  const pendingNew = countNewLines(totalLines, clampedOffset, maxDisplayLines, stickToBottom);
  const contentLineBudget = pendingNew > 0 ? Math.max(1, maxDisplayLines - 1) : maxDisplayLines;
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

