/**
 * SessionIndexPage - Session 索引页
 *
 * 列出所有本地 session，支持上下键浏览、Esc 退出。
 *
 * 设计说明：故意不暴露 loading 状态。listSessions 本地 fs 读取极快（< 几 ms），
 * 没必要显示"加载中"——首次启动进入此页时（会话还未开始），
 * 渲染一次空列表就够，加载完直接覆盖为真实列表，避免视觉闪烁。
 * 仅在加载失败时显示错误信息。
 *
 * 数据来源：.wasteland/sessions/*.jsonl（自动落盘的会话文件）
 *
 * OpenCode 风格：单列列表、focus 标记（▶）、简洁预览。
 */

import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import { createSessionIndex, type SessionSummary } from '../../core/runtime/session-index.js';
import {
  PRIMARY,
  SECONDARY,
  MUTED,
  WARNING,
  TEXT,
} from '../utils/colors.js';

interface SessionIndexPageProps {
  /** 退出页面回调（返回主 session 视图） */
  onClose: () => void;
  /** 可选：选中某行时的回调（用于将来扩展"加载此 session"功能） */
  onSelect?: (session: SessionSummary) => void;
}

export function SessionIndexPage({ onClose, onSelect }: SessionIndexPageProps): React.ReactElement {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  // 加载会话列表
  useEffect(() => {
    let cancelled = false;
    const index = createSessionIndex();
    index
      .listSessions({ limit: 50 })
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 键盘导航
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (sessions.length === 0) return;

    if (key.upArrow || input === 'k') {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelected((s) => Math.min(sessions.length - 1, s + 1));
      return;
    }
    if (key.return && onSelect) {
      const picked = sessions[selected];
      if (picked) onSelect(picked);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 标题 */}
      <Box marginTop={1}>
        <Text color={PRIMARY} bold>
          Sessions{' '}
        </Text>
        <Text color={MUTED}>
          ({sessions.length}) · ↑↓/jk 选择 · Esc 退出
        </Text>
      </Box>

      {/* 错误状态（仅在加载失败时） */}
      {error && (
        <Box marginTop={1}>
          <Text color={WARNING}>❌ 加载失败: {error}</Text>
        </Box>
      )}

      {/* 空状态：会话还未开始 或 目录为空 */}
      {!error && sessions.length === 0 && (
        <Box marginTop={1}>
          <Text color={MUTED}>没有历史会话。</Text>
        </Box>
      )}

      {/* 列表 */}
      {!error && sessions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {sessions.map((s, i) => {
            const isSelected = i === selected;
            const time = s.createdAt.substring(0, 19);
            const preview = s.firstUserMessage
              ? s.firstUserMessage.replace(/\n/g, ' ').slice(0, 60)
              : '(no message)';
            const childTag = s.hasChildren ? ` · ${s.childNames.length}子agent` : '';
            const providerTag = s.providerId ? ` · ${s.providerId}` : '';
            return (
              <Box key={s.id} flexDirection="row">
                <Text color={isSelected ? SECONDARY : MUTED} bold={isSelected}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={isSelected ? PRIMARY : TEXT} bold={isSelected}>
                  {time}
                </Text>
                <Text color={MUTED}>  </Text>
                <Text color={isSelected ? TEXT : MUTED} wrap="truncate-end">
                  {preview}
                </Text>
                <Text color={MUTED}>
                  {providerTag}
                  {childTag}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}