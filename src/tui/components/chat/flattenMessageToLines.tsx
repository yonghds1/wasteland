import React from 'react';
import { Text, Box } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import { getSkin, type Skin } from '@skins/index.js';
import { type resolvePalette } from '@theme/palette.js';
import { splitThinkTags } from '@ui/think-tags.js';
import {
  wrapTextToLines,
  parsePermissionQuestion,
  getMessageColor,
  getMessageLabel,
  parseSemanticTool,
  isErrorContent,
  isWarnContent,
  formatTimeHHMM,
} from '../chat-message-utils.js';
import { splitMarkdownBlocks } from '../render/markdown-splitter.js';
import { CodeBlockView } from '../render/CodeBlockView.js';
import { UnifiedDiffView } from '../render/UnifiedDiffView.js';
import type { AppState, Message } from '../../context/AppContext.js';

export interface FlattenContext {
  contentWidth: number;
  palette: ReturnType<typeof resolvePalette>;
  selectedSkin: Skin;
  state: AppState;
  showThinking: boolean;
  showDetails: boolean;
}

// 内存级别两级渲染缓存，消除重复分词与语法高亮
const messageLineCache = new Map<
  string,
  {
    content: string;
    showDetails: boolean;
    width: number;
    lines: React.ReactElement[];
  }
>();

/**
 * 将单个 Message 展平为视觉虚拟行 Visual Lines
 */
export function flattenSingleMessage(
  message: Message,
  mIdx: number,
  ctx: FlattenContext,
  isLastMessage: boolean
): React.ReactElement[] {
  const { contentWidth, palette, selectedSkin, state, showThinking, showDetails } = ctx;

  // 对已完成的非流式历史消息启用缓存
  const cacheKey = message.id;
  if (!isLastMessage) {
    const cached = messageLineCache.get(cacheKey);
    if (
      cached &&
      cached.content === message.content &&
      cached.showDetails === showDetails &&
      cached.width === contentWidth
    ) {
      return cached.lines;
    }
  }

  const lines: React.ReactElement[] = [];
  const timePrefix = formatTimeHHMM(message.timestamp);
  const timePrefixRender = timePrefix ? (
    <Text color={wastelandTheme.colors.muted}>[{timePrefix}] </Text>
  ) : null;

  if (message.type === 'tool' || (message.type === 'system' && message.content.startsWith('['))) {
    const toolInfo = parseSemanticTool(message.content);
    const iconColor = toolInfo.isError
      ? wastelandTheme.colors.error
      : wastelandTheme.colors.success;

    lines.push(
      <Box
        key={`${message.id}-tool`}
        width={contentWidth}
        height={1}
        overflow="hidden"
        flexDirection="row"
      >
        {timePrefixRender}
        <Text color={iconColor} bold>
          {toolInfo.icon}{' '}
        </Text>
        <Text color={wastelandTheme.colors.textEmphasized} bold>
          {toolInfo.action}{' '}
        </Text>
        <Text color={wastelandTheme.colors.primary}>{toolInfo.target} </Text>
        {toolInfo.meta ? (
          <Text color={wastelandTheme.colors.muted} dimColor>
            {toolInfo.meta}
          </Text>
        ) : null}
      </Box>
    );

    if (showDetails) {
      const fullLines = wrapTextToLines(message.content, contentWidth - 4);
      fullLines.forEach((line, idx) => {
        lines.push(
          <Box
            key={`${message.id}-tool-full-${idx}`}
            width={contentWidth}
            height={1}
            overflow="hidden"
            paddingLeft={2}
          >
            <Text color={wastelandTheme.colors.muted} dimColor>
              {line}
            </Text>
          </Box>
        );
      });
    }
  } else if (message.type === 'system') {
    const permInfo = parsePermissionQuestion(message.content);
    if (permInfo) {
      const { toolName, detail } = permInfo;
      const historyEntry = (
        state.session.permission?.history ??
        state.permission?.history ??
        []
      ).find((h: { question: string }) => `? ${h.question}` === message.content);

      if (historyEntry) {
        const badge =
          historyEntry.decision === 'allow'
            ? ' [已允许]'
            : historyEntry.decision === 'allow_always'
              ? ' [已允许·本会话]'
              : ' [已拒绝]';
        const badgeColor =
          historyEntry.decision === 'deny'
            ? wastelandTheme.colors.error
            : wastelandTheme.colors.success;

        lines.push(
          <Box
            key={`${message.id}-perm-head`}
            width={contentWidth}
            height={1}
            flexDirection="row"
          >
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
            lines.push(
              <Box
                key={`${message.id}-perm-detail-${idx}`}
                width={contentWidth}
                height={1}
                overflow="hidden"
              >
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
      }
      return lines;
    }

    const systemColor = isErrorContent(message.content)
      ? wastelandTheme.colors.error
      : isWarnContent(message.content)
        ? wastelandTheme.colors.warning
        : wastelandTheme.colors.muted;
    const sysLines = wrapTextToLines(message.content, contentWidth - 4);
    sysLines.forEach((line, idx) => {
      lines.push(
        <Box key={`${message.id}-sys-${idx}`} width={contentWidth} height={1} overflow="hidden">
          {idx === 0 ? timePrefixRender : null}
          <Text color={systemColor} bold={isErrorContent(message.content)}>
            {' '}
            {line}
          </Text>
        </Box>
      );
    });
  } else {
    // user / assistant
    const split = splitThinkTags(message.content);
    const msgAgent = state.session.agents.find((a: { id: string; skinId?: string }) => a.id === message.agentId);
    const msgSkin = msgAgent?.skinId ? getSkin(msgAgent.skinId) : selectedSkin;
    const label = getMessageLabel(message.type, msgSkin);
    const labelColor = getMessageColor(message.type);
    const thinkingColor = palette.thinking;

    if (mIdx > 0) {
      lines.push(<Box key={`${message.id}-space`} width={contentWidth} height={1} />);
    }

    lines.push(
      <Box key={`${message.id}-header`} width={contentWidth} height={1} flexDirection="row">
        {timePrefixRender}
        <Text color={labelColor} bold>
          {label}
        </Text>
      </Box>
    );

    // 思考过程渲染
    if (showThinking && split.thinking) {
      const lineCount =
        split.thinking.split('\n').filter((l) => l.trim().length > 0).length || 1;
      const content = split.content || '';
      if (content.trim().length > 0 && !showDetails) {
        lines.push(
          <Box
            key={`${message.id}-think-collapsed`}
            width={contentWidth}
            height={1}
            paddingLeft={2}
          >
            <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
              💭 思考过程 (共 {lineCount} 行，已折叠)
            </Text>
          </Box>
        );
      } else {
        lines.push(
          <Box key={`${message.id}-think-head`} width={contentWidth} height={1} paddingLeft={2}>
            <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
              💭 {t('ui.streaming.thinking')}
            </Text>
          </Box>
        );
        const thinkLines = wrapTextToLines(split.thinking, contentWidth - 4);
        thinkLines.forEach((tLine, idx) => {
          lines.push(
            <Box
              key={`${message.id}-think-${idx}`}
              width={contentWidth}
              height={1}
              overflow="hidden"
              paddingLeft={4}
            >
              <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
                {tLine}
              </Text>
            </Box>
          );
        });
      }
    }

    // 正文展平：支持 Markdown 结构块与代码高亮
    const content = split.content || '';
    if (content.trim().length > 0) {
      const textColor =
        message.type === 'assistant' ? palette.text : wastelandTheme.colors.text;
      const blocks = splitMarkdownBlocks(content);

      blocks.forEach((block, bIdx) => {
        if (block.type === 'code' && block.codeData) {
          lines.push(
            <CodeBlockView
              key={`${message.id}-b${bIdx}-code`}
              code={block.codeData.code}
              lang={block.codeData.lang}
              filename={block.codeData.filename}
              width={contentWidth}
              showLineNumbers={true}
            />
          );
        } else if (block.type === 'diff') {
          lines.push(
            <UnifiedDiffView
              key={`${message.id}-b${bIdx}-diff`}
              diffText={block.content}
              filename={block.codeData?.filename}
              width={contentWidth}
            />
          );
        } else {
          const textLines = wrapTextToLines(block.content, contentWidth - 2);
          textLines.forEach((cLine, idx) => {
            lines.push(
              <Box
                key={`${message.id}-b${bIdx}-line-${idx}`}
                width={contentWidth}
                height={1}
                overflow="hidden"
              >
                <Text color={textColor}>{cLine}</Text>
              </Box>
            );
          });
        }
      });
    } else if (split.thinking) {
      lines.push(
        <Box key={`${message.id}-think-done`} width={contentWidth} height={1} paddingLeft={2}>
          <Text color={thinkingColor ?? wastelandTheme.colors.muted} dimColor italic>
            {t('ui.streaming.thinkingCompleted')}
          </Text>
        </Box>
      );
    }
  }

  if (!isLastMessage) {
    messageLineCache.set(cacheKey, {
      content: message.content,
      showDetails,
      width: contentWidth,
      lines,
    });
  }

  return lines;
}
