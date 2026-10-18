import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { LogEntry } from '@core/logger/index.js';
import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import {
  formatTime,
  levelColor,
  pad,
  scopeColor,
  kindColor,
  truncate,
  ctxLevelColor,
} from '../logs-page-utils.js';
import { ScrollableBox, type UseScrollResult } from '../ScrollableBox.js';
import { parseTimings, TimingsBar } from '../TimingsBar.js';
import type { CardWindowItem } from '../card-window.js';
import { CARD_HEIGHT, relativeTimeStrFor } from './types.js';

function ContextLine({ entry }: { entry: LogEntry }): React.ReactElement {
  return (
    <Box flexDirection="row" paddingLeft={2}>
      <Text color={wastelandTheme.colors.muted}>│ </Text>
      <Text color={wastelandTheme.colors.muted}>{formatTime(entry.timestamp)}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={ctxLevelColor(entry.level)}>{entry.level}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={wastelandTheme.colors.muted}>{truncate(entry.scope, 12)}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={wastelandTheme.colors.text}>{truncate(entry.message, 64)}</Text>
    </Box>
  );
}

function ErrorContextLocator({ entry }: { entry: LogEntry }): React.ReactElement {
  return (
    <Box flexDirection="row" paddingLeft={2}>
      <Text color={wastelandTheme.colors.error}>▼ </Text>
      <Text color={wastelandTheme.colors.error}>
        {`${formatTime(entry.timestamp)} | ${entry.level} | ${entry.scope} | ${truncate(entry.message, 64)}`}
      </Text>
    </Box>
  );
}

function HighlightedText({ text, keyword }: { text: string; keyword: string }): React.ReactElement {
  if (!keyword.trim()) return <Text color={wastelandTheme.colors.text} wrap="wrap">{text}</Text>;

  const tokens = keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => {
      if (t.includes(':') && !t.startsWith('http')) {
        const parts = t.split(':');
        return parts.slice(1).join(':');
      }
      return t;
    })
    .filter(Boolean);

  if (tokens.length === 0) return <Text color={wastelandTheme.colors.text} wrap="wrap">{text}</Text>;

  const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <Text color={wastelandTheme.colors.text} wrap="wrap">
      {parts.map((part, i) => {
        const isMatch = tokens.some((t) => part.toLowerCase() === t.toLowerCase());
        return isMatch ? (
          <Text key={i} backgroundColor="yellow" color="black">{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        );
      })}
    </Text>
  );
}

function JsonHighlighter({ data }: { data: unknown }) {
  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const regex = /("(?:\\[^]|[^\\"])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  const parts = str.split(regex);
  return (
    <Text>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Text key={i}>{p}</Text>;
        let color: string = wastelandTheme.colors.warning;
        if (p.startsWith('"')) {
          if (p.trim().endsWith(':')) color = wastelandTheme.colors.primary;
          else color = wastelandTheme.colors.success;
        } else if (p === 'true' || p === 'false') {
          color = wastelandTheme.colors.text;
        } else if (p === 'null') {
          color = wastelandTheme.colors.error;
        }
        return (
          <Text key={i} color={color}>
            {p}
          </Text>
        );
      })}
    </Text>
  );
}

export interface LogCardStreamProps {
  sessionCards: LogEntry[];
  cardWindow: CardWindowItem[];
  cardScroll: UseScrollResult;
  rightListHeight: number;
  selectedCardIdx: number;
  keywordFilter: string;
  errorFocus: boolean;
  selectedSessionSummary?: ProjectSessionSummary;
  selectedSessionLoading: boolean;
  cardKeyOf: (e: LogEntry) => string;
}

export function LogCardStream({
  sessionCards,
  cardWindow,
  cardScroll,
  rightListHeight,
  selectedCardIdx,
  keywordFilter,
  errorFocus,
  selectedSessionSummary,
  selectedSessionLoading,
  cardKeyOf,
}: LogCardStreamProps): React.ReactElement {
  if (selectedSessionLoading) {
    return <></>;
  }

  if (sessionCards.length === 0) {
    return (
      <Box>
        <Text color={wastelandTheme.colors.muted}>
          {selectedSessionSummary
            ? errorFocus
              ? keywordFilter.trim()
                ? '(no errors match keyword)'
                : '(no errors in this session)'
              : keywordFilter.trim()
                ? '(no entries match keyword)'
                : '(no entries match current filter)'
            : '(select a session from the left)'}
        </Text>
      </Box>
    );
  }

  return (
    <ScrollableBox
      offset={cardScroll.offset}
      onOffsetChange={cardScroll.setOffset}
      totalItems={sessionCards.length}
      itemHeight={CARD_HEIGHT}
      height={rightListHeight}
      showScrollbar={cardScroll.canScrollUp || cardScroll.canScrollDown}
      showIndicators={false}
      windowed
    >
      {cardWindow.map(({ index: idx, plan }, windowIdx) => {
        const entry = sessionCards[idx];
        if (!entry) return null;

        const isCurrentCard = windowIdx === 0;
        const isSelectedCard = idx === selectedCardIdx;
        const entryKind = (entry.data as Record<string, unknown> | undefined)?.kind;
        const kindStr = typeof entryKind === 'string' ? entryKind : '-';
        const timings = parseTimings(entry.data);

        let cardBorderColor: string = wastelandTheme.colors.borderDim;
        if (entry.level === 'error') {
          cardBorderColor = wastelandTheme.colors.error;
        } else if (entry.level === 'warn') {
          cardBorderColor = wastelandTheme.colors.warning;
        }

        const relativeTimeStr = relativeTimeStrFor(sessionCards, idx);

        return (
          <Box
            key={cardKeyOf(entry)}
            flexDirection="column"
            backgroundColor={isSelectedCard ? '#2b2d31' : undefined}
            borderStyle={wastelandTheme.decorations.borderStyle}
            borderLeft
            borderBottom
            borderTop={false}
            borderRight={false}
            borderColor={cardBorderColor}
            paddingLeft={1}
            marginBottom={1}
          >
            {/* 卡片头部 */}
            <Box flexDirection="row">
              <Text
                color={
                  isCurrentCard
                    ? wastelandTheme.colors.borderFocused
                    : wastelandTheme.colors.muted
                }
              >
                {isCurrentCard ? '▶ ' : '  '}
              </Text>
              {entry.turn !== undefined && (
                <Text color={wastelandTheme.colors.borderDim}>
                  {entry.step === 0 ? `▼ T${entry.turn} ` : (entry.step ? ` ├─ ` : ` │ `)}
                </Text>
              )}
              <Text color={wastelandTheme.colors.muted}>
                {formatTime(entry.timestamp)}
                {relativeTimeStr ? ` ${relativeTimeStr}` : ''}
              </Text>
              <Text color={wastelandTheme.colors.muted}> | </Text>
              <Text color={levelColor(entry.level)} bold>
                {entry.level.padEnd(5)}
              </Text>
              <Text color={wastelandTheme.colors.muted}> | </Text>
              <Text color={scopeColor(entry.scope)}>{pad(entry.scope, 10)}</Text>
              <Text color={wastelandTheme.colors.muted}> | </Text>
              <Text color={kindColor(kindStr)}>{kindStr}</Text>
            </Box>

            {/* 卡片消息 */}
            <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
              <Box flexDirection="column">
                <HighlightedText text={plan.messageLines.join('\n')} keyword={keywordFilter} />
                {plan.messageMore && (
                  <Text color={wastelandTheme.colors.muted}>
                    {plan.messageMore}
                  </Text>
                )}
              </Box>
            </Box>

            {/* Timings 进度条 */}
            {timings && plan.timingsRows > 0 && <TimingsBar timings={timings} />}

            {/* 错误信息 */}
            {plan.errorLines.length > 0 && (
              <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                <Text color={wastelandTheme.colors.error}>
                  {plan.errorLines.join('\n')}
                </Text>
              </Box>
            )}

            {/* JSON 详情 */}
            {(plan.detailHeaderLines.length > 0 || plan.detailLines.length > 0 || plan.detailMore) && (
              <Box flexDirection="column" marginTop={1} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                {plan.detailHeaderLines.length > 0 && (
                  <Text color={wastelandTheme.colors.muted}>
                    {plan.detailHeaderLines.join('\n')}
                  </Text>
                )}
                {plan.detailLines.length > 0 && (
                  <Box flexDirection="row">
                    <JsonHighlighter data={plan.detailLines.join('\n')} />
                  </Box>
                )}
                {plan.detailMore && (
                  <Text color={wastelandTheme.colors.muted}>
                    {plan.detailMore}
                  </Text>
                )}
              </Box>
            )}

            {/* 错误上下文 */}
            {plan.contextChromeRows > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color={wastelandTheme.colors.muted}>
                  {`── context ↑${plan.contextBefore.length} ↓${plan.contextAfter.length} ──`}
                </Text>
                {plan.contextBefore.map((ctx, i) => (
                  <ContextLine key={`ctx-before-${i}`} entry={ctx} />
                ))}
                <ErrorContextLocator entry={entry} />
                {plan.contextAfter.map((ctx, i) => (
                  <ContextLine key={`ctx-after-${i}`} entry={ctx} />
                ))}
                {plan.contextMore && (
                  <Text color={wastelandTheme.colors.muted}>
                    {plan.contextMore}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </ScrollableBox>
  );
}
