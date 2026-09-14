/**
 * ChatInputBar - 聊天输入框
 *
 * OpenCode 风格多行输入:Shift/Alt+Enter 换行,Enter 发送。
 *
 * ## 快捷键
 *
 * - Enter: 发送消息
 * - Shift/Alt+Enter: 换行
 * - Esc: 取消输入
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { describeAllowPattern } from '@core/engine/permission-gate.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { getCommandManager } from '@core/shared/command-manager.js';
import {
  applyCompletion,
  filterCompletions,
  moveCompletionIndex,
  navigateHistory,
  type CompletionItem,
} from './command-completion.js';
import type { Skin } from '@skins/index.js';
import type { TuiRuntimeContext } from '../types.js';

interface ChatInputBarProps {
  width: number;
  sendMessage: (content: string) => void;
  /** 当前皮肤（用于状态栏显示） */
  selectedSkin?: Skin;
  /** 当前 provider ID（用于状态栏显示） */
  providerId?: string;
  /** 运行时上下文（用于 userInputBridge 权限确认单键拦截） */
  runtime?: TuiRuntimeContext;
}

export function ChatInputBar({ width, sendMessage, runtime }: ChatInputBarProps): React.ReactElement {
  const { state, setState, setInputMode, setFocusArea } = useAppContext();
  const [input, setInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  // R2 输入历史（本会话，草稿隔离）
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');
  const [histIdx, setHistIdx] = useState<number | null>(null);
  // R3 `/` 补全（registry 单一来源，局部 UI 态）
  const [completionIdx, setCompletionIdx] = useState(0);
  const [completionDismissed, setCompletionDismissed] = useState(false);

  const completions = useMemo(() => {
    // 每次输入变化时重新读取注册表：技能命令经 bootstrap 后注册，
    // 挂载期快照会漏掉后注册项，这里跟随输入即时计算（getAll 开销可忽略）。
    const items: CompletionItem[] = getCommandManager()
      .getAll()
      .map((c) => ({ name: c.name, aliases: [...c.aliases], description: c.description }));
    return filterCompletions(input, cursorOffset, items);
  }, [input, cursorOffset]);
  const completionVisible =
    state.inputMode && input.startsWith('/') && !completionDismissed && completions.length > 0;

  const applySelectedCompletion = (): boolean => {
    const item = completions[completionIdx] ?? completions[0];
    if (!item) return false;
    const next = applyCompletion(input, cursorOffset, item);
    setInput(next.input);
    setCursorOffset(next.cursor);
    setCompletionIdx(0);
    setCompletionDismissed(true);
    return true;
  };

  const goHistory = (dir: 1 | -1): void => {
    const h = historyRef.current;
    const next = navigateHistory(h.length, histIdx, dir);
    if (next === histIdx) return;
    if (histIdx === null) draftRef.current = input;
    setHistIdx(next);
    if (next === null) {
      setInput(draftRef.current);
      setCursorOffset(draftRef.current.length);
    } else {
      const v = h[next] ?? '';
      setInput(v);
      setCursorOffset(v.length);
    }
    setCompletionDismissed(true);
  };

  const pushHistory = (value: string): void => {
    const h = historyRef.current;
    if (h[h.length - 1] !== value) {
      h.push(value);
      if (h.length > 50) h.splice(0, h.length - 50);
    }
    draftRef.current = '';
    setHistIdx(null);
  };

  // 自动进入输入模式（但用户按 Esc 主动退出后不自动拉回，需按 Enter 重新进入）
  const prevInputModeRef = useRef(state.inputMode);
  useEffect(() => {
    const wasInputMode = prevInputModeRef.current;
    prevInputModeRef.current = state.inputMode;

    if (!state.inputMode && state.showHelp === null && !state.exitConfirmPending) {
      // inputMode 刚从 true 变 false（用户主动 Esc 退出）时不自动拉回
      if (wasInputMode) {
        return;
      }
      setFocusArea('inputBar');
      setInputMode(true);
    }
  }, [state.inputMode, state.showHelp, state.exitConfirmPending]);

  useInput((inputChar, key) => {
    // 只在输入模式时处理
    if (!state.inputMode) {
      return;
    }

    // 优先处理权限确认交互（↑/↓ 选择 + Enter 确认，或 1/2/3/Y/A/N/Esc 单键秒级响应）。
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
          // 无可记模式/无闸门 → 降级本次允许（与 CLI 一致）；静默 return 会吞键且等待者不 resolve。
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
      // 箭头在选项间移动；无可记模式时跳过索引 1
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
        if (state.permissionSelection === 0) confirmOnce();
        else if (state.permissionSelection === 1) confirmAlways();
        else deny();
        return;
      }

      // 归一化后匹配：ink 对同一 stdin chunk 只回调一次，快速连击/粘贴会把多个字符
      // 作为一个 inputChar 传进来（实测解析器从不拆分可打印串）。若只做单键相等比较，
      // 这类输入块会**不匹配任何分支、被末尾 return 整块吞掉**——既不回答权限、也不进
      // 输入框，等待者一直挂到超时（09-14 复现：写入 'aa' 后 pendingCount 仍为 2）。
      // 故同时接受精确单词（与 CLI 侧 provideInput(line.trim()) 的语义对齐），
      // 单键语义保持不变。
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
      // 等待权限确认时拦截其他无关字符输入，防止误发聊天消息
      return;
    }

    // R3 补全导航（优先于发送/历史）：↑↓ 移动，Tab 套用，Esc 关闭
    if (completionVisible) {
      if (key.upArrow) {
        setCompletionIdx((cur) => moveCompletionIndex(cur, -1, completions.length));
        return;
      }
      if (key.downArrow) {
        setCompletionIdx((cur) => moveCompletionIndex(cur, 1, completions.length));
        return;
      }
      if (key.tab) {
        applySelectedCompletion();
        return;
      }
      if (key.escape) {
        setCompletionDismissed(true);
        return;
      }
    }

    // Enter:Shift/Alt+Enter 换行,否则发送（补全未关闭且仍在命令词时 Enter 优先套用）
    if (key.return) {
      if (completionVisible && !input.includes(' ') && !input.includes('\n')) {
        applySelectedCompletion();
        return;
      }
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
      }
      return;
    }

    // Esc 退出输入模式（session 页同时把焦点交到 agentTabs，与 App 双向 toggle 收敛）
    if (key.escape) {
      setInputMode(false);
      if (state.currentPage === 'session') {
        setFocusArea('agentTabs');
      }
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

    // R2 历史召回（无补全、无换行、无修饰键时裸 ↑↓ 在历史/草稿间移动；
    // Shift/Ctrl+↑↓ 留给消息列表视口滚动，下方翻页键透传分支会放行）
    if (!completionVisible && !input.includes('\n') && !key.shift && !key.ctrl && !key.meta) {
      if (key.upArrow) {
        goHistory(-1);
        return;
      }
      if (key.downArrow) {
        goHistory(1);
        return;
      }
    }

    // R2 行编辑：Home/End 跳行首尾，Ctrl+U/K 清光标前/后
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

    // Backspace 删除末字符(含换行)
    if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        setInput((prev) => prev.slice(0, cursorOffset - 1) + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev - 1);
      }
      return;
    }

    // 忽略翻页键与快速滚动，留给 ChatMessageList 视口处理
    if (key.pageUp || key.pageDown || ((key.shift || key.ctrl) && (key.upArrow || key.downArrow))) {
      return;
    }

    // 普通字符输入
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
    }
  });

  const isCommand = input.startsWith('/');
  const isPendingPermission = Boolean(runtime?.userInputBridge?.isPending());
  
  // 注入光标字符用于渲染
  const displayInput = state.inputMode && !isPendingPermission
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
    if (mode === 'bypass_permissions') {
      return (
        <Text color={wastelandTheme.colors.error} bold>
          skip-all
        </Text>
      );
    }
    if (mode === 'accept_edits') {
      return (
        <Text color={wastelandTheme.colors.warning}>
          auto-edit
        </Text>
      );
    }
    return (
      <Text color={wastelandTheme.colors.muted} dimColor>
        default
      </Text>
    );
  };

  return (
    <Box flexDirection="column" width={width} flexShrink={0} paddingX={1} paddingTop={1}>
      {isPendingPermission ? (
        <PermissionPrompt card={pendingPermission} queuedCount={queuedCount} selection={permissionSelection} />
      ) : (
        <Box flexDirection="column">
          {/* 靠左的醒目状态栏（只保留权限模式） */}
          <Box flexDirection="row" justifyContent="flex-start" marginBottom={0}>
            <Text color={wastelandTheme.colors.muted} dimColor>
              {t('tui.session.input.statusBar.permission')}:{' '}
            </Text>
            {renderPermissionBadge()}
          </Box>
          {/* R3 `/` 补全下拉（registry 单一来源，Tab 套用，Esc 关闭） */}
          {completionVisible && (
            <Box flexDirection="column" marginTop={0} marginBottom={0}>
              {completions.map((item, i) => {
                const selected = i === Math.min(completionIdx, completions.length - 1);
                return (
                  <Box key={item.name} flexDirection="row">
                    <Text
                      color={selected ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}
                      bold={selected}
                      dimColor={!selected}
                    >
                      {selected ? '▶ ' : '  '}
                      {item.name}
                    </Text>
                    {item.aliases.length > 0 && (
                      <Text color={wastelandTheme.colors.muted} dimColor>
                        {' '}
                        ({item.aliases.join(', ')})
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
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
      
      {/* 动态隐藏的快捷键提示 */}
      {!isPendingPermission && input === '' && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.session.input.hints.default')}
          </Text>
        </Box>
      )}
      {isPendingPermission && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.session.input.hints.permission')}
          </Text>
        </Box>
      )}
    </Box>
  );
}
