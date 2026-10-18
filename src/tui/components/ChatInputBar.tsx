/**
 * ChatInputBar - 聊天输入框
 * OpenCode 风格多行输入、智能补全与光标导航
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
import {
  offsetToRowCol,
  moveCursorVertical,
  moveToLineStart,
  moveToLineEnd,
  deleteToLineStart,
  deleteToLineEnd,
  deleteWordBefore,
  getVisibleLinesWindow,
} from './text-buffer.js';
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

  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const preferredColRef = useRef<number | null>(null);

  const [completionIdx, setCompletionIdx] = useState(0);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);

  const completions = useMemo(() => {
    const items: CompletionItem[] = getCommandManager()
      .getAll()
      .map((c) => ({ name: c.name, aliases: [...c.aliases], description: c.description }));
    return filterCompletions(input, cursorOffset, items);
  }, [input, cursorOffset]);

  const commandCompletionVisible =
    !completionDismissed && completions.length > 0 && input.startsWith('/') && !input.includes('\n');

  const mentionMatch = useMemo(() => {
    const beforeCursor = input.slice(0, cursorOffset);
    const match = /(?:^|\s)@([^\s]*)$/.exec(beforeCursor);
    if (!match) return null;
    return { query: match[1] ?? '', matchIndex: match.index + (match[0].startsWith(' ') ? 1 : 0) };
  }, [input, cursorOffset]);

  const mentionCandidates = useMemo(() => {
    if (!mentionMatch || mentionDismissed) return [];
    try {
      return fuzzyMatchFiles(mentionMatch.query, getWorkspaceFiles(), 6);
    } catch {
      return [];
    }
  }, [mentionMatch, mentionDismissed]);

  const mentionVisible = Boolean(mentionMatch && !mentionDismissed && mentionCandidates.length > 0);

  const applySelectedCompletion = () => {
    const item = completions[Math.min(completionIdx, completions.length - 1)];
    if (!item) return;
    const applied = applyCompletion(input, cursorOffset, item);
    setInput(applied.input);
    setCursorOffset(applied.cursor);
    preferredColRef.current = null;
    setCompletionDismissed(true);
  };

  const applySelectedMention = () => {
    if (!mentionMatch) return;
    const selectedFile = mentionCandidates[Math.min(mentionIdx, mentionCandidates.length - 1)];
    if (!selectedFile) return;
    const before = input.slice(0, mentionMatch.matchIndex);
    const replacement = `${selectedFile} `;
    setInput(before + replacement + input.slice(cursorOffset));
    setCursorOffset(before.length + replacement.length);
    preferredColRef.current = null;
    setMentionDismissed(true);
  };

  const pushHistory = (submitted: string) => {
    historyRef.current = [...historyRef.current, submitted];
    draftRef.current = '';
    setHistIdx(null);
    preferredColRef.current = null;
  };

  const goHistory = (delta: -1 | 1) => {
    const nextIdx = navigateHistory(historyRef.current.length, histIdx, delta);
    if (nextIdx !== histIdx) {
      if (histIdx === null && delta === -1) draftRef.current = input;
      setHistIdx(nextIdx);
      const nextVal = nextIdx === null ? draftRef.current : historyRef.current[nextIdx] ?? '';
      setInput(nextVal);
      setCursorOffset(nextVal.length);
      preferredColRef.current = null;
    }
  };

  const isPendingPermission = Boolean(runtime?.userInputBridge?.isPending());
  const prevPendingRef = useRef(false);

  useEffect(() => {
    if (isPendingPermission && !prevPendingRef.current) {
      if (input.trim()) draftRef.current = input;
    } else if (!isPendingPermission && prevPendingRef.current && draftRef.current) {
      setInput(draftRef.current);
      setCursorOffset(draftRef.current.length);
      preferredColRef.current = null;
    }
    prevPendingRef.current = isPendingPermission;
  }, [isPendingPermission, input]);

  useEffect(() => {
    if (state.inputDraft !== undefined) {
      setInput(state.inputDraft);
      setCursorOffset(state.inputDraft.length);
      draftRef.current = state.inputDraft;
      preferredColRef.current = null;
      setState((prev) => ({ ...prev, inputDraft: undefined, inputNonEmpty: Boolean(state.inputDraft && state.inputDraft.length > 0) }));
    }
  }, [state.inputDraft, setState]);

  useEffect(() => {
    const nonEmpty = input.length > 0;
    if (state.inputNonEmpty !== nonEmpty) {
      setState((prev) => ({ ...prev, inputNonEmpty: nonEmpty }));
    }
  }, [input, state.inputNonEmpty, setState]);

  useInput((inputChar, key) => {
    if (!state.inputMode) return;

    // 0. 权限确认拦截
    const bridge = runtime?.userInputBridge;
    if (bridge?.isPending()) {
      const pending = state.permission?.pending ?? null;
      const pattern = pending ? describeAllowPattern(pending.toolName, pending.input) : null;
      const gate = runtime?.permissionGate;
      const canRemember = pattern !== null && typeof gate?.addSessionRule === 'function';
      const resetSel = (): void => {
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        setCursorOffset(0);
        preferredColRef.current = null;
      };
      const confirmOnce = (): void => { bridge.provideInput('yes'); resetSel(); };
      const confirmAlways = (): void => {
        if (!pattern || !gate?.addSessionRule) { confirmOnce(); return; }
        gate.addSessionRule({
          toolName: pending?.toolName ?? '', decision: 'allow',
          inputPrefix: { key: pattern.key, prefix: pattern.prefix },
          reason: `ask-user always: ${pattern.label}`,
        });
        bridge.provideInput('always');
        resetSel();
      };
      const deny = (): void => { bridge.provideInput('no'); resetSel(); };
      const moveSel = (dir: 1 | -1): void => setState((prev) => {
        let next = (prev.permissionSelection + dir + 3) % 3;
        if (!canRemember && next === 1) next = (next + dir + 3) % 3;
        return { ...prev, permissionSelection: next };
      });

      if (key.upArrow) { moveSel(-1); return; }
      if (key.downArrow) { moveSel(1); return; }
      if (key.return) {
        if (state.permissionSelection === 1) confirmAlways();
        else if (state.permissionSelection === 2) deny();
        else confirmOnce();
        return;
      }
      const token = inputChar.trim().toLowerCase();
      if (key.escape || token === '3' || token === 'n' || token === 'no') { deny(); return; }
      if (token === '2' || token === 'a' || token === 'always') { confirmAlways(); return; }
      if (token === '1' || token === 'y' || token === 'yes' || token === '是') { confirmOnce(); return; }
      return;
    }

    // 1. `@` 文件补全拦截
    if (mentionVisible) {
      if (key.upArrow) { setMentionIdx((cur) => (cur - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (key.downArrow) { setMentionIdx((cur) => (cur + 1) % mentionCandidates.length); return; }
      if (key.tab || (key.return && !key.shift && !key.meta)) { applySelectedMention(); return; }
      if (key.escape) { setMentionDismissed(true); return; }
    }

    // 2. `/` 命令补全拦截
    if (commandCompletionVisible) {
      if (key.upArrow) { setCompletionIdx((cur) => moveCompletionIndex(cur, -1, completions.length)); return; }
      if (key.downArrow) { setCompletionIdx((cur) => moveCompletionIndex(cur, 1, completions.length)); return; }
      if (key.tab || (key.return && !input.includes(' ') && !input.includes('\n'))) { applySelectedCompletion(); return; }
      if (key.escape) { setCompletionDismissed(true); return; }
    }

    // 3. Enter 逻辑：换行或发送
    if (key.return) {
      preferredColRef.current = null;
      if (key.shift || key.meta) {
        setInput((prev) => prev.slice(0, cursorOffset) + '\n' + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev + 1);
      } else if (input.trim()) {
        sendMessage(input);
        pushHistory(input);
        setInput(''); setCursorOffset(0);
        setCompletionIdx(0); setCompletionDismissed(false);
        setMentionIdx(0); setMentionDismissed(false);
      }
      return;
    }

    if (key.escape) {
      setInputMode(false);
      if (state.currentPage === 'session') setFocusArea('agentTabs');
      return;
    }

    // 4. 水平光标移动
    if (key.leftArrow) { preferredColRef.current = null; setCursorOffset((p) => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { preferredColRef.current = null; setCursorOffset((p) => Math.min(input.length, p + 1)); return; }

    // 5. 纵向光标跨行移动与历史逃逸
    if (!key.shift && !key.ctrl && !key.meta && (key.upArrow || key.downArrow)) {
      const dir = key.upArrow ? -1 : 1;
      const res = moveCursorVertical(input, cursorOffset, dir, preferredColRef.current);
      if (res.escaped) {
        goHistory(dir);
        preferredColRef.current = null;
      } else {
        setCursorOffset(res.nextOffset);
        preferredColRef.current = res.newPreferredCol;
      }
      return;
    }

    // 6. 快捷编辑导航
    if (key.home || (key.ctrl && (inputChar === 'a' || inputChar === 'A'))) {
      preferredColRef.current = null; setCursorOffset(moveToLineStart(input, cursorOffset)); return;
    }
    if (key.end || (key.ctrl && (inputChar === 'e' || inputChar === 'E'))) {
      preferredColRef.current = null; setCursorOffset(moveToLineEnd(input, cursorOffset)); return;
    }
    if (key.ctrl && (inputChar === 'u' || inputChar === 'U')) {
      preferredColRef.current = null; const res = deleteToLineStart(input, cursorOffset);
      setInput(res.text); setCursorOffset(res.offset); setHistIdx(null); return;
    }
    if (key.ctrl && (inputChar === 'k' || inputChar === 'K')) {
      preferredColRef.current = null; const res = deleteToLineEnd(input, cursorOffset);
      setInput(res.text); setCursorOffset(res.offset); setHistIdx(null); return;
    }
    if (key.ctrl && (inputChar === 'w' || inputChar === 'W')) {
      preferredColRef.current = null; const res = deleteWordBefore(input, cursorOffset);
      setInput(res.text); setCursorOffset(res.offset); setHistIdx(null); return;
    }

    // 7. 退格与删除
    if (key.backspace || key.delete) {
      preferredColRef.current = null;
      if (cursorOffset > 0) {
        setInput((prev) => prev.slice(0, cursorOffset - 1) + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev - 1);
        setMentionDismissed(false);
        setCompletionDismissed(false);
      }
      return;
    }

    if (key.pageUp || key.pageDown || ((key.shift || key.ctrl) && (key.upArrow || key.downArrow))) return;

    // 8. 文本字符录入
    if (
      inputChar &&
      !inputChar.startsWith('\x1b') &&
      !inputChar.includes('[<') &&
      !/\[<\d+;\d+;\d+[Mm]/.test(inputChar) &&
      !(inputChar === '<' && input.endsWith('[')) &&
      !key.ctrl && !key.meta && inputChar !== '\r' && inputChar !== '\n' && !key.tab
    ) {
      preferredColRef.current = null;
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
  const { row: cursorRow } = offsetToRowCol(input, cursorOffset);
  const { visibleLines, startLineIndex } = getVisibleLinesWindow(lines, cursorRow, MAX_VISIBLE_INPUT_ROWS);
  const contentColor = isCommand ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;

  const pendingPermission = state.permission?.pending ?? null;
  const queuedCount = state.permission?.queue.length ?? 0;
  const permissionSelection = state.permissionSelection ?? 0;

  const renderPermissionBadge = () => {
    const mode = state.config?.permissionMode ?? 'default';
    return mode === 'bypass_permissions' ? <Text color={wastelandTheme.colors.error} bold>skip-all</Text>
      : mode === 'accept_edits' ? <Text color={wastelandTheme.colors.warning}>auto-edit</Text>
      : <Text color={wastelandTheme.colors.muted} dimColor>default</Text>;
  };

  const popupWidth = Math.max(30, width - 4);

  return (
    <Box flexDirection="column" width={width} flexShrink={0} paddingX={1} paddingTop={1}>
      {isPendingPermission ? (
        <PermissionPromptBar card={pendingPermission} queuedCount={queuedCount} selection={permissionSelection} />
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="flex-start" marginBottom={0}>
            <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.session.input.statusBar.permission')}: </Text>
            {renderPermissionBadge()}
          </Box>

          {mentionVisible && <MentionPopup candidates={mentionCandidates} selectedIndex={mentionIdx} width={popupWidth} />}
          {commandCompletionVisible && <CommandPalettePopup candidates={completions} selectedIndex={completionIdx} width={popupWidth} />}

          {input ? (
            <>
              {visibleLines.map((line, i) => {
                const isFirstAbsoluteLine = startLineIndex + i === 0;
                return (
                  <Box key={startLineIndex + i} flexDirection="row">
                    <Text color={state.inputMode ? wastelandTheme.colors.primary : wastelandTheme.colors.muted} bold={state.inputMode}>
                      {isFirstAbsoluteLine ? '❯ ' : '  '}
                    </Text>
                    <Text color={contentColor} dimColor={!state.inputMode}>{line}</Text>
                  </Box>
                );
              })}
            </>
          ) : (
            <Box flexDirection="row">
              <Text color={state.inputMode ? wastelandTheme.colors.primary : wastelandTheme.colors.muted} bold={state.inputMode}>❯ </Text>
              {state.inputMode && <Text color={wastelandTheme.colors.primary}>{wastelandTheme.decorations.streamingCursor}</Text>}
              <Text color={wastelandTheme.colors.muted} dimColor>
                {state.inputMode ? ' ' + t('tui.session.input.placeholder.focused') : ' ' + t('tui.session.input.placeholder.unfocused')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box flexDirection="row" marginTop={1}>
        {isPendingPermission ? (
          <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.session.input.hints.permission')}</Text>
        ) : input === '' ? (
          <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.session.input.hints.default')}</Text>
        ) : null}
      </Box>
    </Box>
  );
}
