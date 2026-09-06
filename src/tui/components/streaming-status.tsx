/**
 * streaming-status - 流式输出与后台状态尾部行构建器（R7–R10 支撑拆分）
 *
 * 从 `ChatMessageList.tsx` 纯搬运（零逻辑改动，R10 中止提示除外）：
 * `(3) 流式输出展平` + 子 Agent 实时任务树 / thinking 指示器。
 * 返回视觉行数组，由调用方拼入 `visualLines`。
 */

import React from 'react';
import { Box, Text } from 'ink';

import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { splitThinkTags } from '@ui/think-tags.js';
import type { AgentNode, ToolCall } from '../context/AppContext.js';
import { wrapTextToLines } from './chat-message-utils.js';

export interface StreamingStatusArgs {
  contentWidth: number;
  streamingContent: string;
  isStreaming: boolean;
  paletteLabel: string;
  paletteText: string;
  paletteThinking: string;
  skinLabel: string;
  showThinking: boolean;
  spinnerIcon: string;
  subAgents: ReadonlyArray<AgentNode>;
  runningSubAgents: ReadonlyArray<AgentNode>;
  runningTool: ToolCall | undefined;
  viewFilter: string | undefined;
  elapsedSec: string;
  showInspector: boolean;
  isWorking: boolean;
  allAgentsIdle: boolean;
}

export function buildStreamingLines(args: StreamingStatusArgs): React.ReactElement[] {
  const {
    contentWidth,
    streamingContent,
    isStreaming,
    paletteLabel,
    paletteText,
    paletteThinking,
    skinLabel,
    showThinking,
    spinnerIcon,
    subAgents,
    runningSubAgents,
    runningTool,
    viewFilter,
    elapsedSec,
    showInspector,
    isWorking,
    allAgentsIdle,
  } = args;
  const out: React.ReactElement[] = [];

  // (3) 流式输出展平
  if (isStreaming && streamingContent) {
    if (out.length > 0) {
      out.push(<Box key="streaming-space" width={contentWidth} height={1} />);
    }
    const split = splitThinkTags(streamingContent);
    const hasContent = split.content.trim().length > 0;
    out.push(
      <Box key="streaming-header" width={contentWidth} height={1} flexDirection="row">
        <Text color={wastelandTheme.colors.secondary}>{spinnerIcon}</Text>
        <Text color={paletteLabel} bold> {skinLabel}</Text>
      </Box>
    );

    if (showThinking && split.thinking) {
      const lineCount = split.thinking.split('\n').filter((l) => l.trim().length > 0).length || 1;
      if (hasContent) {
        out.push(
          <Box key="streaming-think-collapsed" width={contentWidth} height={1} paddingLeft={2}>
            <Text color={paletteThinking} dimColor italic>
              💭 思考完成 (共 {lineCount} 行)
            </Text>
          </Box>
        );
      } else {
        const rawLines = split.thinking.trim().split('\n').filter((l) => l.trim().length > 0);
        const latestLine = rawLines[rawLines.length - 1] ?? '';
        const preview = latestLine.length > 25 ? '…' + latestLine.slice(-25) : latestLine;
        out.push(
          <Box key="streaming-think-active" width={contentWidth} height={1} flexDirection="row" overflow="hidden" paddingLeft={2}>
            <Text color={paletteThinking} dimColor italic>
              Thinking ({lineCount} lines)... {preview ? `[${preview}]` : ''}
            </Text>
          </Box>
        );
      }
    }

    const stLines = wrapTextToLines(split.content, contentWidth - 2);
    stLines.forEach((sLine, idx) => {
      const isLast = idx === stLines.length - 1 && allAgentsIdle;
      out.push(
        <Box key={`streaming-line-${idx}`} width={contentWidth} height={1} overflow="hidden">
          <Text color={paletteText}>
            {sLine}
            {isLast ? <Text color={wastelandTheme.colors.primary}>{wastelandTheme.decorations.streamingCursor}</Text> : null}
          </Text>
        </Box>
      );
    });
  }

  // Claude Code 规范：当有子 Agent 在后台执行时，无论是否有前置流式文字，都在流尾部展开实时任务树
  if (!showInspector) {
    if (runningSubAgents.length > 0 && viewFilter === undefined) {
      out.push(
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
        const icon = isRunning ? spinnerIcon : '✓';
        const color = isRunning ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;

        out.push(
          <Box key={`subagent-item-${agent.id}`} width={contentWidth} height={1} flexDirection="row" overflow="hidden" paddingLeft={2}>
            <Text color={color} bold>
              {icon} [{idx + 1}] {roleLabel}{taskText}
            </Text>
          </Box>
        );
        if (isRunning && agent.currentAction) {
          out.push(
            <Box key={`subagent-action-${agent.id}`} width={contentWidth} height={1} flexDirection="row" overflow="hidden" paddingLeft={4}>
              <Text color={wastelandTheme.colors.muted} dimColor>
                └ {agent.currentAction}
              </Text>
            </Box>
          );
        }
      });
    } else if (!streamingContent && isWorking) {
      out.push(
        <Box key="thinking-indicator" width={contentWidth} height={1} marginTop={1} flexDirection="row">
          <Text color={wastelandTheme.colors.secondary}>{spinnerIcon} </Text>
          {runningTool ? (
            <Text color={wastelandTheme.colors.primary} bold>
              Run {runningTool.name} ({elapsedSec}s)... · {t('tui.session.messages.stopHint')}
            </Text>
          ) : (
            <Text color={paletteThinking} dimColor italic>
              Thinking ({elapsedSec}s)... · {t('tui.session.messages.stopHint')}
            </Text>
          )}
        </Box>
      );
    }
  }

  return out;
}
