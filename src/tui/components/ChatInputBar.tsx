/**
 * ChatInputBar - 聊天输入框
 *
 * OpenCode 风格多行输入与智能补全:
 * - Shift/Alt+Enter: 换行
 * - Enter: 发送
 * - @: 触发工作区文件模糊拾取 (File Mentions)
 * - /: 触发斜杠命令面板 (Command Palette)
 * - Esc: 退出补全或切换焦点
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { describeAllowPattern } from '@core/engine/permission-gate.js';
import { PermissionPromptBar } from './chat/PermissionPromptBar.js';
import { MentionPopup } from './chat/MentionPopup.js';
import { CommandPalettePopup } from './chat/CommandPalettePopup.js';
import { getCommandManager } from '@core/shared/command-manager.js';
import {
  applyCompletion,
  filterCompletions,
  moveCompletionIndex,
  navigateHistory,
  type CompletionItem,
} from './command-completion.js';
import { getWorkspaceFiles } from './mention/file-indexer.js';
import { fuzzyMatchFiles } from './mention/fuzzy-match.js';
import type { Skin } from '@skins/index.js';
import type { TuiRuntimeContext } from '../types.js';

interface ChatInputBarProps {
  width: number;
  sendMessage: (content: string) => void;
  selectedSkin?: Skin;
  providerId?: string;
  runtime?: TuiRuntimeContext;
}

export function ChatInputBar({ width, sendMessage, runtime }: ChatInputBarProps): React.ReactElement {
  const { state, setState, setInputMode, setFocusArea } = useAppContext();
  const [input, setInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);

  // 输入历史（本会话，草稿隔离）
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');
  const [histIdx, setHistIdx] = useState<number | null>(null);

  // `/` 命令补全状态
  const [completionIdx, setCompletionIdx] = useState(0);
  const [completionDismissed, setCompletionDismissed] = useState(false);

  // `@` 文件补全状态
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);

  // 1. `/` 命令补全项计算
  const completions = useMemo(() => {
    const items: CompletionItem[] = getCommandManager()
      .getAll()
      .map((c) => ({ name: c.name, aliases: [...c.aliases], description: c.description }));
    return filterCompletions(input, cursorOffset, items);
  }, [input, cursorOffset]);

  const commandCompletionVisible =
    !completionDismissed && completions.length > 0 && input.startsWith('/') && !input.includes('\n');

  // 2. `@` 文件补全项计算
  const mentionMatch = useMemo(() => {
    const beforeCursor = input.slice(0, cursorOffset);
    const match = /(?:^|\s)@([^\s]*)$/.exec(beforeCursor);
    if (!match) return null;
    const query = match[1] ?? '';
    const matchIndex = match.index + (match[0].startsWith(' ') ? 1 : 0);
    return { query, matchIndex };
  }, [input, cursorOffset]);

  const mentionCandidates = useMemo(() => {
    if (!mentionMatch || mentionDismissed) return [];
    try {
      const files = getWorkspaceFiles();
      return fuzzyMatchFiles(mentionMatch.query, files, 6);
    } catch {
      return [];
    }
  }, [mentionMatch, mentionDismissed]);

  const mentionVisible = Boolean(mentionMatch && !mentionDismissed && mentionCandidates.length > 0);

  // 补全套用逻辑
  const applySelectedCompletion = () => {
    const item = completions[Math.min(completionIdx, completions.length - 1)];
    if (!item) return;
    const applied = applyCompletion(input, cursorOffset, item);
    setInput(applied.input);
    setCursorOffset(applied.cursor);
    setCompletionDismissed(true);
  };

  const applySelectedMention = () => {
    if (!mentionMatch) return;
    const selectedFile = mentionCandidates[Math.min(mentionIdx, mentionCandidates.length - 1)];
    if (!selectedFile) return;

    const before = input.slice(0, mentionMatch.matchIndex);
    const after = input.slice(cursorOffset);
    const replacement = `${selectedFile} `;
    const nextInput = before + replacement + after;
    setInput(nextInput);
    setCursorOffset(before.length + replacement.length);
    setMentionDismissed(true);
  };

  // 历史导航
  const pushHistory = (submitted: string) => {
    historyRef.current = [...historyRef.current, submitted];
    draftRef.current = '';
    setHistIdx(null);
  };

  const goHistory = (delta: -1 | 1) => {
    const nextIdx = navigateHistory(historyRef.current.length, histIdx, delta);
    if (nextIdx !== histIdx) {
      if (histIdx === null && delta === -1) {
        draftRef.current = input;
      }
      setHistIdx(nextIdx);
      const nextVal = nextIdx === null ? draftRef.current : historyRef.current[nextIdx] ?? '';
      setInput(nextVal);
      setCursorOffset(nextVal.length);
    }
  };

  // 草稿自动暂存保护
  const isPendingPermission = Boolean(runtime?.userInputBridge?.isPending());
  const prevPendingRef = useRef(false);

  useEffect(() => {
    if (isPendingPermission && !prevPendingRef.current) {
      if (input.trim()) {
        draftRef.current = input;
      }
    } else if (!isPendingPermission && prevPendingRef.current) {
      if (draftRef.current) {
        setInput(draftRef.current);
        setCursorOffset(draftRef.current.length);
      }
    }
    prevPendingRef.current = isPendingPermission;
  }, [isPendingPermission, input]);

  useInput((inputChar, key) => {
    if (!state.inputMode) return;

    // 0. 优先处理权限确认交互（↑/↓ 选择 + Enter 确认，或 1/2/3/Y/A/N/Esc 单键秒级响应）
    const bridge = runtime?.userInputBridge;
    if (bridge?.isPending()) {
      const pending = state.permission?.pending ?? null;
      const pattern = pending ? describeAllowPattern(pending.toolName, pending.input) : null;
      const gate = runtime?.permissionGate;
      const canRemember = pattern !== null && typeof gate?.addSessionRule === 'function';

      const resetSelection = (): void => {
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        setCursorOffset(0);
      };
      const confirmOnce = (): void => {
        bridge.provideInput('yes');
        resetSelection();
      };
      const confirmAlways = (): void => {
        if (!pattern || !gate?.addSessionRule) {
          confirmOnce();
          return;
        }
        gate.addSessionRule({
          toolName: pending?.toolName ?? '',
          decision: 'allow',
          inputPrefix: { key: pattern.key, prefix: pattern.prefix },
          reason: `ask-user always: ${pattern.label}`,
        });
        bridge.provideInput('always');
        resetSelection();
      };
      const deny = (): void => {
        bridge.provideInput('no');
        resetSelection();
      };
      const moveSel = (dir: 1 | -1): void => {
        setState((prev) => {
          let next = (prev.permissionSelection + dir + 3) % 3;
          if (!canRemember && next === 1) next = (next + dir + 3) % 3;
          return { ...prev, permissionSelection: next };
        });
      };

      if (key.upArrow) {
        moveSel(-1);
        return;
      }
      if (key.downArrow) {
        moveSel(1);
        return;
      }

      if (key.return) {
        if (state.permissionSelection === 1) confirmAlways();
        else if (state.permissionSelection === 2) deny();
        else confirmOnce();
        return;
      }

      const token = inputChar.trim().toLowerCase();
      if (key.escape || token === '3' || token === 'n' || token === 'no') {
        deny();
        return;
      }
      if (token === '2' || token === 'a' || token === 'always') {
        confirmAlways();
        return;
      }
      if (token === '1' || token === 'y' || token === 'yes' || token === '是') {
        confirmOnce();
        return;
      }
      return;
    }

    // 1. `@` 文件补全键位拦截
    if (mentionVisible) {
      if (key.upArrow) {
        setMentionIdx((cur) => (cur - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (key.downArrow) {
        setMentionIdx((cur) => (cur + 1) % mentionCandidates.length);
        return;
      }
      if (key.tab || (key.return && !key.shift && !key.meta)) {
        applySelectedMention();
        return;
      }
      if (key.escape) {
        setMentionDismissed(true);
        return;
      }
    }

    // 2. `/` 命令补全键位拦截
    if (commandCompletionVisible) {
      if (key.upArrow) {
        setCompletionIdx((cur) => moveCompletionIndex(cur, -1, completions.length));
        return;
      }
      if (key.downArrow) {
        setCompletionIdx((cur) => moveCompletionIndex(cur, 1, completions.length));
        return;
      }
      if (key.tab || (key.return && !input.includes(' ') && !input.includes('\n'))) {
        applySelectedCompletion();
        return;
      }
      if (key.escape) {
        setCompletionDismissed(true);
        return;
      }
    }

    // 3. Enter 逻辑：Shift/Alt+Enter 换行，纯 Enter 发送
    if (key.return) {
      if (key.shift || key.meta) {
        setInput((prev) => prev.slice(0, cursorOffset) + '\n' + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev + 1);
      } else if (input.trim()) {
        sendMessage(input);
        pushHistory(input);
        setInput('');
        setCursorOffset(0);
        setCompletionIdx(0);
        setCompletionDismissed(false);
        setMentionIdx(0);
        setMentionDismissed(false);
      }
      return;
    }

    if (key.escape) {
      setInputMode(false);
      if (state.currentPage === 'session') setFocusArea('agentTabs');
      return;
    }

    if (key.leftArrow) {
      setCursorOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset((prev) => Math.min(input.length, prev + 1));
      return;
    }

    // 历史翻阅（仅单行且无弹出浮层时）
    if (!commandCompletionVisible && !mentionVisible && !input.includes('\n') && !key.shift && !key.ctrl && !key.meta) {
      if (key.upArrow) {
        goHistory(-1);
        return;
      }
      if (key.downArrow) {
        goHistory(1);
        return;
      }
    }

    if (key.home) {
      setCursorOffset(0);
      return;
    }
    if (key.end) {
      setCursorOffset(input.length);
      return;
    }
    if (key.ctrl && (inputChar === 'u' || inputChar === 'U')) {
      setInput((prev) => prev.slice(cursorOffset));
      setCursorOffset(0);
      setHistIdx(null);
      return;
    }
    if (key.ctrl && (inputChar === 'k' || inputChar === 'K')) {
      setInput((prev) => prev.slice(0, cursorOffset));
      setHistIdx(null);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        setInput((prev) => prev.slice(0, cursorOffset - 1) + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev - 1);
        setMentionDismissed(false);
        setCompletionDismissed(false);
      }
      return;
    }

    if (key.pageUp || key.pageDown || ((key.shift || key.ctrl) && (key.upArrow || key.downArrow))) {
      return;
    }

    // 字符输入
    if (
      inputChar &&
      !inputChar.startsWith('\x1b') &&
      !inputChar.includes('[<') &&
      !/\[<\d+;\d+;\d+[Mm]/.test(inputChar) &&
      !(inputChar === '<' && input.endsWith('[')) &&
      !key.ctrl &&
      !key.meta &&
      inputChar !== '\r' &&
      inputChar !== '\n' &&
      !key.tab
    ) {
      setInput((prev) => prev.slice(0, cursorOffset) + inputChar + prev.slice(cursorOffset));
      setCursorOffset((prev) => prev + inputChar.length);
      setHistIdx(null);
      setCompletionIdx(0);
      setCompletionDismissed(false);
      setMentionIdx(0);
      setMentionDismissed(false);
    }
  });

  const isCommand = input.startsWith('/');
  const displayInput =
    state.inputMode && !isPendingPermission
      ? input.slice(0, cursorOffset) + wastelandTheme.decorations.streamingCursor + input.slice(cursorOffset)
      : input;

  const lines = displayInput.split('\n');
  const MAX_VISIBLE_INPUT_ROWS = 5;
  const contentColor = isCommand ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;

  const pendingPermission = state.permission?.pending ?? null;
  const queuedCount = state.permission?.queue.length ?? 0;
  const permissionSelection = state.permissionSelection ?? 0;

  const renderPermissionBadge = () => {
    const mode = state.config?.permissionMode ?? 'default';
    if (mode === 'bypass_permissions') return <Text color={wastelandTheme.colors.error} bold>skip-all</Text>;
    if (mode === 'accept_edits') return <Text color={wastelandTheme.colors.warning}>auto-edit</Text>;
    return <Text color={wastelandTheme.colors.muted} dimColor>default</Text>;
  };

  const popupWidth = Math.max(30, width - 4);

  return (
    <Box flexDirection="column" width={width} flexShrink={0} paddingX={1} paddingTop={1}>
      {isPendingPermission ? (
        <PermissionPromptBar card={pendingPermission} queuedCount={queuedCount} selection={permissionSelection} />
      ) : (
        <Box flexDirection="column">
          {/* 状态徽章 */}
          <Box flexDirection="row" justifyContent="flex-start" marginBottom={0}>
            <Text color={wastelandTheme.colors.muted} dimColor>
              {t('tui.session.input.statusBar.permission')}:{' '}
            </Text>
            {renderPermissionBadge()}
          </Box>

          {/* `@` 文件补全卡片 */}
          {mentionVisible && (
            <MentionPopup candidates={mentionCandidates} selectedIndex={mentionIdx} width={popupWidth} />
          )}

          {/* `/` 斜杠命令卡片 */}
          {commandCompletionVisible && (
            <CommandPalettePopup candidates={completions} selectedIndex={completionIdx} width={popupWidth} />
          )}

          {/* 输入内容区 */}
          {input ? (
            <>
              {lines.slice(-MAX_VISIBLE_INPUT_ROWS).map((line, i) => (
                <Box key={i} flexDirection="row">
                  <Text color={state.inputMode ? wastelandTheme.colors.primary : wastelandTheme.colors.muted} bold={state.inputMode}>
                    {i === 0 ? '❯ ' : '  '}
                  </Text>
                  <Text color={contentColor} dimColor={!state.inputMode}>
                    {line}
                  </Text>
                </Box>
              ))}
            </>
          ) : (
            <Box flexDirection="row">
              <Text color={state.inputMode ? wastelandTheme.colors.primary : wastelandTheme.colors.muted} bold={state.inputMode}>
                ❯{' '}
              </Text>
              {state.inputMode ? (
                <Text color={wastelandTheme.colors.primary}>{wastelandTheme.decorations.streamingCursor}</Text>
              ) : null}
              <Text color={wastelandTheme.colors.muted} dimColor>
                {state.inputMode
                  ? ' ' + t('tui.session.input.placeholder.focused')
                  : ' ' + t('tui.session.input.placeholder.unfocused')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* 帮助提示 */}
      {!isPendingPermission && input === '' && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.session.input.hints.default')}</Text>
        </Box>
      )}
      {isPendingPermission && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.session.input.hints.permission')}</Text>
        </Box>
      )}
    </Box>
  );
}
