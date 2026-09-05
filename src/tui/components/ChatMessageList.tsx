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
import { getSkin, type Skin } from '@skins/index.js';
import { resolvePalette } from '@theme/palette.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { splitThinkTags } from '@ui/think-tags.js';
import { Scrollbar } from './Scrollbar.js';
import { useMouseWheel } from '../mouse/useMouseWheel.js';
import {
  wrapTextToLines,
  parsePermissionQuestion,
  useSpinnerFrame,
  useElapsedTimer,
  getRoleCatchphrase,
  getMessageColor,
  getMessageLabel,
  parseSemanticTool,
  isErrorContent,
  isWarnContent,
  formatTimeHHMM,
} from './chat-message-utils.js';


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
}

export function ChatMessageList({
  width,
  height,
  selectedSkin,
  showThinking = true,
  spinnerIntervalMs = wastelandTheme.animations.spinnerIntervalMs,
  typewriterRateMs: _typewriterRateMs = wastelandTheme.animations.typewriterRateMs,
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

  // (2) 消息列表展平
  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const message = messages[mIdx];
    if (!message) continue;
    const timePrefix = formatTimeHHMM(message.timestamp);
    const timePrefixRender = timePrefix
      ? <Text color={wastelandTheme.colors.muted}>[{timePrefix}] </Text>
      : null;

    if (message.type === 'tool' || (message.type === 'system' && message.content.startsWith('['))) {
      const toolInfo = parseSemanticTool(message.content);
      const iconColor = toolInfo.isError ? wastelandTheme.colors.error : wastelandTheme.colors.success;
      visualLines.push(
        <Box key={`${message.id}-tool`} width={contentWidth} height={1} overflow="hidden" flexDirection="row">
          {timePrefixRender}
          <Text color={iconColor} bold>{toolInfo.icon} </Text>
          <Text color={wastelandTheme.colors.textEmphasized} bold>{toolInfo.action} </Text>
          <Text color={wastelandTheme.colors.primary}>{toolInfo.target} </Text>
          {toolInfo.meta ? <Text color={wastelandTheme.colors.muted} dimColor>{toolInfo.meta}</Text> : null}
        </Box>
      );
    } else if (message.type === 'system') {
      const permInfo = parsePermissionQuestion(message.content);
      if (permInfo) {
        const { toolName, detail } = permInfo;
        // 统一模型：仅 pending 高亮可交互，历史置灰并显结果
        const pending = state.session.permission?.pending ?? state.permission?.pending ?? null;
        const isPending = !!pending && message.content === `? ${pending.question}`;
        const historyEntry = !isPending
          ? (state.session.permission?.history ?? state.permission?.history ?? []).find(
              (h) => `? ${h.question}` === message.content
            )
          : null;
        const isHistory = !!historyEntry;
        const currentSel = state.permissionSelection ?? 0;

        // 历史态：置灰 + 结果徽章，不再高亮交互
        if (isHistory && historyEntry) {
          const badge =
            historyEntry.decision === 'allow'
              ? ' [已允许]'
              : historyEntry.decision === 'allow_always'
                ? ' [已允许·本会话]'
                : ' [已拒绝]';
          const badgeColor =
            historyEntry.decision === 'deny' ? wastelandTheme.colors.error : wastelandTheme.colors.success;
          visualLines.push(
            <Box key={`${message.id}-perm-head`} width={contentWidth} height={1} flexDirection="row">
              {timePrefixRender}
              <Text color={wastelandTheme.colors.muted} dimColor>
                · [Permission: {toolName}]{badge}
              </Text>
              <Text color={badgeColor} bold>
                {badge}
              </Text>
            </Box>
          );
          if (detail) {
            const detailLines = wrapTextToLines(detail, contentWidth - 12);
            detailLines.forEach((line, idx) => {
              visualLines.push(
                <Box key={`${message.id}-perm-detail-${idx}`} width={contentWidth} height={1} overflow="hidden">
                  <Text color={wastelandTheme.colors.muted} dimColor>
                    {idx === 0 ? '  Command: ' : '           '}
                  </Text>
                  <Text color={wastelandTheme.colors.muted} dimColor>
                    {line}
                  </Text>
                </Box>
              );
            });
          }
          continue;
        }

        // pending 态：高亮可交互，detail 自动换行
        visualLines.push(
          <Box key={`${message.id}-perm-head`} width={contentWidth} height={1} flexDirection="row">
            {timePrefixRender}
            <Text color={wastelandTheme.colors.warning} bold>? [Permission: {toolName}]</Text>
          </Box>
        );
        if (detail) {
          const detailLines = wrapTextToLines(detail, contentWidth - 12);
          detailLines.forEach((line, idx) => {
            visualLines.push(
              <Box key={`${message.id}-perm-detail-${idx}`} width={contentWidth} height={1} overflow="hidden">
                <Text color={wastelandTheme.colors.primary} bold>
                  {idx === 0 ? '  Command: ' : '           '}
                </Text>
                <Text color={wastelandTheme.colors.text}>{line}</Text>
              </Box>
            );
          });
        }
        // 仅 pending 时响应 selection 高亮
        const interactive = isPending || (!isHistory && !pending);
        visualLines.push(
          <Box key={`${message.id}-perm-opt-0`} width={contentWidth} height={1} flexDirection="row">
            <Text
              color={interactive && currentSel === 0 ? wastelandTheme.colors.success : wastelandTheme.colors.muted}
              bold={interactive && currentSel === 0}
              dimColor={!interactive}
            >
              {interactive && currentSel === 0 ? '   ▶ ' : '     '}[y] Allow once (允许本次)
            </Text>
          </Box>
        );
        visualLines.push(
          <Box key={`${message.id}-perm-opt-1`} width={contentWidth} height={1} flexDirection="row">
            <Text
              color={interactive && currentSel === 1 ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}
              bold={interactive && currentSel === 1}
              dimColor={!interactive}
            >
              {interactive && currentSel === 1 ? '   ▶ ' : '     '}[a] Always allow (本会话永久允许)
            </Text>
          </Box>
        );
        visualLines.push(
          <Box key={`${message.id}-perm-opt-2`} width={contentWidth} height={1} flexDirection="row">
            <Text
              color={interactive && currentSel === 2 ? wastelandTheme.colors.error : wastelandTheme.colors.muted}
              bold={interactive && currentSel === 2}
              dimColor={!interactive}
            >
              {interactive && currentSel === 2 ? '   ▶ ' : '     '}[n] Deny (拒绝)
            </Text>
          </Box>
        );
        visualLines.push(
          <Box key={`${message.id}-perm-hint`} width={contentWidth} height={1} flexDirection="row">
            <Text color={wastelandTheme.colors.muted} dimColor>
              {'     '}(↑/↓ to move · Enter to confirm · or press Y/A/N/Esc)
            </Text>
          </Box>
        );
        continue;
      }

      const systemColor = isErrorContent(message.content)
        ? wastelandTheme.colors.error
        : isWarnContent(message.content)
          ? wastelandTheme.colors.warning
          : wastelandTheme.colors.muted;
      const sysLines = wrapTextToLines(message.content, contentWidth - 4);
      sysLines.forEach((line, idx) => {
        visualLines.push(
          <Box key={`${message.id}-sys-${idx}`} width={contentWidth} height={1} overflow="hidden">
            {idx === 0 ? timePrefixRender : null}
            <Text color={systemColor} bold={isErrorContent(message.content)}> {line}</Text>
          </Box>
        );
      });
    } else {
      // user / assistant
      const split = splitThinkTags(message.content);
      const msgAgent = state.session.agents.find((a) => a.id === message.agentId);
      const msgSkin = msgAgent?.skinId ? getSkin(msgAgent.skinId) : selectedSkin;
      const label = getMessageLabel(message.type, msgSkin);
      const labelColor = getMessageColor(message.type);
      const thinkingColor = palette.thinking;

      if (mIdx > 0) {
        visualLines.push(<Box key={`${message.id}-space`} width={contentWidth} height={1} />);
      }

      // Header 行
      visualLines.push(
        <Box key={`${message.id}-header`} width={contentWidth} height={1} flexDirection="row">
          {timePrefixRender}
          <Text color={labelColor} bold>{label}</Text>
        </Box>
      );

      // Thinking 块展平（OpenCode 风格：正文存在时默认单行优雅收起，不挤占视口）
      if (showThinking && split.thinking) {
        const lineCount = split.thinking.split('\n').filter((l) => l.trim().length > 0).length || 1;
        const content = split.content || '';
        if (content.trim().length > 0) {
          // 正文已有，思考过程折叠为 1 行紧凑摘要
          visualLines.push(
            <Box key={`${message.id}-think-collapsed`} width={contentWidth} height={1}>
              <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
                {' '}💭 思考过程 (共 {lineCount} 行，已折叠)
              </Text>
            </Box>
          );
        } else {
          // 纯思考消息（无正文）
          visualLines.push(
            <Box key={`${message.id}-think-head`} width={contentWidth} height={1}>
              <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
                {' '}💭 {t('ui.streaming.thinking')}
              </Text>
            </Box>
          );
          const thinkLines = wrapTextToLines(split.thinking, contentWidth - 4);
          thinkLines.forEach((tLine, idx) => {
            visualLines.push(
              <Box key={`${message.id}-think-${idx}`} width={contentWidth} height={1} overflow="hidden">
                <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>   {tLine}</Text>
              </Box>
            );
          });
        }
      }

      // 正文展平
      const content = split.content || '';
      if (content.trim().length > 0) {
        const textLines = wrapTextToLines(content, contentWidth - 2);
        const textColor = message.type === 'assistant' ? palette.text : wastelandTheme.colors.text;
        textLines.forEach((cLine, idx) => {
          visualLines.push(
            <Box key={`${message.id}-line-${idx}`} width={contentWidth} height={1} overflow="hidden">
              <Text color={textColor}>{cLine}</Text>
            </Box>
          );
        });
      } else if (split.thinking) {
        visualLines.push(
          <Box key={`${message.id}-think-done`} width={contentWidth} height={1}>
            <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
              {' '}{t('ui.streaming.thinkingCompleted')}
            </Text>
          </Box>
        );
      }
    }
  }

  // (3) 流式输出展平（OpenCode 风格：思考中仅占 1 行动画，正文生成后折叠）
  if (state.session.isStreaming && state.session.streamingContent) {
    if (visualLines.length > 0) {
      visualLines.push(<Box key="streaming-space" width={contentWidth} height={1} />);
    }
    const split = splitThinkTags(state.session.streamingContent);
    const hasContent = split.content.trim().length > 0;
    visualLines.push(
      <Box key="streaming-header" width={contentWidth} height={1} flexDirection="row">
        <Text color={wastelandTheme.colors.secondary}>{currentSpinnerIcon}</Text>
        <Text color={palette.label} bold> {selectedSkin.label}</Text>
      </Box>
    );

    if (showThinking && split.thinking) {
      const lineCount = split.thinking.split('\n').filter((l) => l.trim().length > 0).length || 1;
      if (hasContent) {
        // 思考结束，正文已在生成：思考块收起为 1 行
        visualLines.push(
          <Box key="streaming-think-collapsed" width={contentWidth} height={1}>
            <Text color={palette.thinking} dimColor italic>
              {' '}💭 思考完成 (共 {lineCount} 行)
            </Text>
          </Box>
        );
      } else {
        // 正在思考阶段：单行展示最新思考动向，不瀑布式霸屏
        const rawLines = split.thinking.trim().split('\n').filter((l) => l.trim().length > 0);
        const latestLine = rawLines[rawLines.length - 1] ?? '';
        const preview = latestLine.length > 25 ? '…' + latestLine.slice(-25) : latestLine;
        visualLines.push(
          <Box key="streaming-think-active" width={contentWidth} height={1} flexDirection="row" overflow="hidden">
            <Text color={palette.thinking} dimColor italic>
              {' '}Thinking ({lineCount} lines)... {preview ? `[${preview}]` : ''}
            </Text>
          </Box>
        );
      }
    }

    const stLines = wrapTextToLines(split.content, contentWidth - 2);
    stLines.forEach((sLine, idx) => {
      const isLast = idx === stLines.length - 1 && state.session.agents.every((a) => a.status !== 'running' || a.depth === 0);
      visualLines.push(
        <Box key={`streaming-line-${idx}`} width={contentWidth} height={1} overflow="hidden">
          <Text color={palette.text}>
            {sLine}
            {isLast ? <Text color={wastelandTheme.colors.primary}>{wastelandTheme.decorations.streamingCursor}</Text> : null}
          </Text>
        </Box>
      );
    });
  }

  // Claude Code 规范：当有子 Agent 在后台执行时，无论是否有前置流式文字，都在流尾部展开实时任务树
  const subAgents = state.session.agents.filter((a) => a.depth >= 1);
  const runningSubAgents = subAgents.filter((a) => a.status === 'running');
  const runningTool = state.session.tools.find((t) => t.status === 'running');

  if (runningSubAgents.length > 0 && viewFilter === undefined) {
    visualLines.push(
      <Box key="subagents-header" width={contentWidth} height={1} marginTop={1} flexDirection="row">
        <Text color={wastelandTheme.colors.primary} bold>
          ⏺ Running {runningSubAgents.length} subagent{runningSubAgents.length > 1 ? 's' : ''} in parallel ({elapsedSec}s):
        </Text>
      </Box>
    );
    subAgents.forEach((agent, idx) => {
      const isRunning = agent.status === 'running';
      const roleLabel = agent.roleName || agent.name;
      const taskText = agent.task ? ` · ${agent.task}` : '';
      const icon = isRunning ? currentSpinnerIcon : '✓';
      const color = isRunning ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;

      visualLines.push(
        <Box key={`subagent-item-${agent.id}`} width={contentWidth} height={1} flexDirection="row" overflow="hidden">
          <Text color={color} bold>
            {'  '}{icon} [{idx + 1}] {roleLabel}{taskText}
          </Text>
        </Box>
      );
      if (isRunning && agent.currentAction) {
        visualLines.push(
          <Box key={`subagent-action-${agent.id}`} width={contentWidth} height={1} flexDirection="row" overflow="hidden">
            <Text color={wastelandTheme.colors.muted} dimColor>
              {'    '}└ {agent.currentAction}
            </Text>
          </Box>
        );
      }
    });
  } else if (!state.session.streamingContent && (state.session.isThinking || state.session.isStreaming || isWorking)) {
    visualLines.push(
      <Box key="thinking-indicator" width={contentWidth} height={1} marginTop={1} flexDirection="row">
        <Text color={wastelandTheme.colors.secondary}>{currentSpinnerIcon} </Text>
        {runningTool ? (
          <Text color={wastelandTheme.colors.primary} bold>
            Run {runningTool.name} ({elapsedSec}s)...
          </Text>
        ) : (
          <Text color={palette.thinking} dimColor italic>
            Thinking ({elapsedSec}s)...
          </Text>
        )}
      </Box>
    );
  }

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

  // 4. 键盘翻页监听（支持 PageUp/Down、Shift+↑/↓ 微调、Ctrl+U/D 翻半屏）
  useInput((input, key) => {
    const halfPage = Math.max(1, Math.floor(availableHeight / 2));
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
  const visibleLines = visualLines.slice(clampedOffset, clampedOffset + maxDisplayLines);

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

