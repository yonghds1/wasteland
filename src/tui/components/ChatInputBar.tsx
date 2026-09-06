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

import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { describeAllowPattern } from '@core/runtime/permission-gate.js';
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
        // 无可记模式或无闸门时忽略（不静默降级为 once，避免误解）
        if (!pattern || !gate?.addSessionRule) return;
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

      if (inputChar === '1' || inputChar === 'y' || inputChar === 'Y') {
        confirmOnce();
        return;
      }
      if (inputChar === '2' || inputChar === 'a' || inputChar === 'A') {
        confirmAlways();
        return;
      }
      if (inputChar === '3' || inputChar === 'n' || inputChar === 'N' || key.escape) {
        deny();
        return;
      }
      // 等待权限确认时拦截其他无关字符输入，防止误发聊天消息
      return;
    }

    // Enter:Shift/Alt+Enter 换行,否则发送
    if (key.return) {
      if (key.shift || key.meta) {
        setInput((prev) => prev.slice(0, cursorOffset) + '\n' + prev.slice(cursorOffset));
        setCursorOffset((prev) => prev + 1);
      } else if (input.trim()) {
        sendMessage(input);
        setInput('');
        setCursorOffset(0);
      }
      return;
    }

    // Esc 退出输入模式
    if (key.escape) {
      setInputMode(false);
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
  const allowPattern =
    pendingPermission != null
      ? describeAllowPattern(pendingPermission.toolName, pendingPermission.input)
      : null;
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
      {isPendingPermission && pendingPermission ? (
        <Box flexDirection="column" backgroundColor="#0A0A0A" paddingLeft={1} borderLeftColor={wastelandTheme.colors.warning} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false}>
          <Box flexDirection="row">
            <Text color={wastelandTheme.colors.warning} bold>
              {t('tui.session.input.hints.permissionTitle', { toolName: pendingPermission.toolName })}
            </Text>
          </Box>
          {pendingPermission.command && (
            <Box flexDirection="row" backgroundColor={wastelandTheme.colors.backgroundSecondary || wastelandTheme.colors.borderDim} paddingLeft={1} marginTop={1} marginBottom={1}>
              <Text color={wastelandTheme.colors.secondary}>$ {pendingPermission.command}</Text>
            </Box>
          )}
          <Box flexDirection="row">
            <Text
              color={permissionSelection === 0 ? wastelandTheme.colors.success : wastelandTheme.colors.muted}
              bold={permissionSelection === 0}
              dimColor={permissionSelection !== 0}
            >
              {permissionSelection === 0 ? '▶ ' : '  '}
              {t('tui.session.input.hints.yes')}
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text
              color={permissionSelection === 1 && allowPattern ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}
              bold={permissionSelection === 1 && !!allowPattern}
              dimColor={permissionSelection !== 1 || !allowPattern}
            >
              {permissionSelection === 1 && allowPattern ? '▶ ' : '  '}
              {allowPattern ? t('tui.session.input.hints.always', { label: allowPattern.label }) : t('tui.session.input.hints.alwaysDisabled')}
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text
              color={permissionSelection === 2 ? wastelandTheme.colors.error : wastelandTheme.colors.muted}
              bold={permissionSelection === 2}
              dimColor={permissionSelection !== 2}
            >
              {permissionSelection === 2 ? '▶ ' : '  '}
              {t('tui.session.input.hints.no')}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* 靠左的醒目状态栏（只保留权限模式） */}
          <Box flexDirection="row" justifyContent="flex-start" marginBottom={0}>
            <Text color={wastelandTheme.colors.muted} dimColor>
              {t('tui.session.input.statusBar.permission')}:{' '}
            </Text>
            {renderPermissionBadge()}
          </Box>
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
