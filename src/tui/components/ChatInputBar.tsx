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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { getAgentMode } from '@config/agent-mode-state.js';
import { resolveContextWindow } from '@core/runtime/context-manager.js';
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

export function ChatInputBar({ width, sendMessage, selectedSkin, providerId, runtime }: ChatInputBarProps): React.ReactElement {
  const { state, setState, setInputMode, setFocusArea } = useAppContext();
  const [input, setInput] = useState('');

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

    // 优先处理权限确认交互（OpenCode 规范：↑/↓ 选择 + Enter 确认，或 1/2/3/Y/A/N/Esc 单键秒级响应）
    if (runtime?.userInputBridge?.isPending()) {
      if (key.upArrow) {
        setState((prev) => ({
          ...prev,
          permissionSelection: (prev.permissionSelection - 1 + 3) % 3,
        }));
        return;
      }
      if (key.downArrow) {
        setState((prev) => ({
          ...prev,
          permissionSelection: (prev.permissionSelection + 1) % 3,
        }));
        return;
      }

      if (key.return) {
        if (state.permissionSelection === 0) {
          runtime.userInputBridge.provideInput('yes');
        } else if (state.permissionSelection === 1) {
          sendMessage('/perm bypass');
          runtime.userInputBridge.provideInput('yes');
        } else {
          runtime.userInputBridge.provideInput('no');
        }
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        return;
      }

      if (inputChar === '1' || inputChar === 'y' || inputChar === 'Y') {
        runtime.userInputBridge.provideInput('yes');
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        return;
      }
      if (inputChar === '2' || inputChar === 'a' || inputChar === 'A') {
        sendMessage('/perm bypass');
        runtime.userInputBridge.provideInput('yes');
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        return;
      }
      if (inputChar === '3' || inputChar === 'n' || inputChar === 'N' || key.escape) {
        runtime.userInputBridge.provideInput('no');
        setState((prev) => ({ ...prev, permissionSelection: 0 }));
        setInput('');
        return;
      }
      // 等待权限确认时拦截其他无关字符输入，防止误发聊天消息
      return;
    }

    // Enter:Shift/Alt+Enter 换行,否则发送
    if (key.return) {
      if (key.shift || key.meta) {
        setInput((prev) => prev + '\n');
      } else if (input.trim()) {
        sendMessage(input);
        setInput('');
      }
      return;
    }

    // Esc 退出输入模式
    // 注意:不在此处 setFocusArea —— 焦点下一站由 App.tsx 的 Esc 双向 toggle 决定
    // (inputMode → agentTabs;agentTabs → inputBar)。否则 ChatInputBar 与 App 父子
    // useInput 都会写 focusArea,后跑的子组件会覆盖父组件,导致焦点被钉到 null。
    if (key.escape) {
      setInputMode(false);
      return;
    }

    // Backspace 删除末字符(含换行)
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // 忽略翻页键与快速滚动，留给 ChatMessageList 视口处理
    if (key.pageUp || key.pageDown || ((key.shift || key.ctrl) && (key.upArrow || key.downArrow))) {
      return;
    }

    // 普通字符输入(保留 Shift 以支持大写,Enter 已在上方拦截, 过滤 ANSI 与 SGR 鼠标报文残片)
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
      setInput((prev) => prev + inputChar);
    }
  });

  const isCommand = input.startsWith('/');
  const isPendingPermission = Boolean(runtime?.userInputBridge?.isPending());
  const lines = input.split('\n');
  const promptColor = isPendingPermission
    ? wastelandTheme.colors.warning
    : isCommand
      ? wastelandTheme.colors.secondary
      : wastelandTheme.colors.primary;
  const contentColor = isCommand ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;
  // 主题输入提示符
  const promptSymbol = isPendingPermission ? '?' : wastelandTheme.decorations.prompt;
  const promptIndent = ' '.repeat(promptSymbol.length + 1);
  // 框体颜色
  const borderColor = isPendingPermission
    ? wastelandTheme.colors.warning
    : state.inputMode
      ? wastelandTheme.colors.borderFocused
      : wastelandTheme.colors.borderDim;
  // 最小输入行数
  const minInputRows = 2;
  // Token 使用量
  const { usage } = state.session;
  // Context window: 动态解析当前模型的 context window（优先读取用户配置，再查表）
  const configuredContextWindow =
    Object.values(state.fullConfig?.models ?? {}).find((m) => m.model === state.config.model)?.contextWindow ??
    state.fullConfig?.models?.['default']?.contextWindow;
  const contextWindow = resolveContextWindow(state.config.model, configuredContextWindow);
  // 格式化 token 数（k 表示千，M 表示百万）
  const formatTokens = (n: number): string => {
    if (n === 0) return '──';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  // 权限徽章渲染
  const renderPermissionBadge = () => {
    const mode = state.config?.permissionMode ?? 'default';
    if (mode === 'bypass_permissions') {
      return (
        <Text color={wastelandTheme.colors.error} bold>
          {t('tui.session.input.statusBar.permission')}: skip-all
        </Text>
      );
    }
    if (mode === 'accept_edits') {
      return (
        <Text color={wastelandTheme.colors.warning}>
          {t('tui.session.input.statusBar.permission')}: auto-edit
        </Text>
      );
    }
    return (
      <Text color={wastelandTheme.colors.muted} dimColor>
        {t('tui.session.input.statusBar.permission')}: default
      </Text>
    );
  };

  // 稳定台词管理：单轮锁定 + 超时温和轮播，彻底消除每帧随机抽取导致的台词疯狂抽搐
  // 角色专属台词（固定 1 行，置于输入框上方，静默常驻无多余 spinner 噪点）
  const idleQuote = useMemo(() => {
    const list = selectedSkin?.catchphrases?.length ? selectedSkin.catchphrases : selectedSkin?.greeting ?? [];
    return list.length > 0 ? list[0] : '';
  }, [selectedSkin]);

  const characterFlavor = useMemo(() => {
    if (idleQuote && selectedSkin) {
      return {
        text: `${selectedSkin.label}: ${idleQuote}`,
        color: wastelandTheme.colors.muted,
        dim: true,
      };
    }
    return null;
  }, [idleQuote, selectedSkin]);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {/* 顶部分隔线 */}
      <Text color={borderColor}>
        {wastelandTheme.decorations.separator.repeat(width)}
      </Text>
      {/* 角色台词 / 动态运行状态固定单行 */}
      {characterFlavor && (
        <Box paddingX={1}>
          <Text color={characterFlavor.color} dimColor={characterFlavor.dim}>
            {characterFlavor.text}
          </Text>
        </Box>
      )}
      {/* 输入内容（最小 2 行） */}
      <Box flexDirection="column" paddingX={1}>
        {input ? (
          <>
            {lines.map((line, i) => (
              <Box key={i} flexDirection="row">
                <Text color={promptColor} bold>
                  {i === 0 ? `${promptSymbol} ` : promptIndent}
                </Text>
                <Text color={contentColor}>
                  {line}
                  {i === lines.length - 1 && (
                    <Text color={wastelandTheme.colors.primary}>
                      {wastelandTheme.decorations.streamingCursor}
                    </Text>
                  )}
                </Text>
              </Box>
            ))}
            {/* 填充到最小行数 */}
            {Array.from({ length: Math.max(0, minInputRows - lines.length) }, (_, i) => (
              <Box key={`pad-${i}`} flexDirection="row">
                <Text>{promptIndent}</Text>
              </Box>
            ))}
          </>
        ) : (
          <>
            <Box flexDirection="row">
              <Text color={promptColor} bold>
                {promptSymbol}{' '}
              </Text>
              <Text
                color={isPendingPermission ? wastelandTheme.colors.warning : wastelandTheme.colors.muted}
                bold={isPendingPermission}
              >
                {isPendingPermission
                  ? '? [Permission] ↑/↓ to move · Enter to confirm · or press Y/A/N/Esc'
                  : state.inputMode
                    ? t('tui.session.input.placeholder.focused')
                    : t('tui.session.input.placeholder.unfocused')}
              </Text>
            </Box>
            <Box flexDirection="row">
              <Text>{promptIndent}</Text>
            </Box>
          </>
        )}
      </Box>
      {/* 底部状态栏：左侧信息（皮肤/模式/provider/ctx/turns） + 右侧快捷键提示 */}
      <Box flexDirection="row" paddingX={1} justifyContent="space-between">
        <Box flexDirection="row">
          {selectedSkin && (
            <>
              <Text color={wastelandTheme.colors.muted} dimColor>
                {t('tui.session.input.statusBar.skin')}: {selectedSkin.label}
              </Text>
              <Text color={wastelandTheme.colors.muted} dimColor> · </Text>
            </>
          )}
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.session.input.statusBar.mode')}: {state.config.mode ?? getAgentMode()}
          </Text>
          <Text color={wastelandTheme.colors.muted} dimColor> · </Text>
          {renderPermissionBadge()}
          {(state.config.model || providerId) && (
            <>
              <Text color={wastelandTheme.colors.muted} dimColor> · </Text>
              <Text color={wastelandTheme.colors.muted} dimColor>
                {t('tui.session.input.statusBar.provider')}: {state.config.model || providerId}
                {state.config.model && providerId && providerId !== 'openai-compatible' ? ` (${providerId})` : ''}
              </Text>
            </>
          )}
          <Text color={wastelandTheme.colors.muted} dimColor> · </Text>
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.session.input.statusBar.ctx')}: {formatTokens(usage.totalTokens)}/{formatTokens(contextWindow)}
          </Text>
        </Box>
        <Text color={wastelandTheme.colors.muted} dimColor>
          {t('tui.session.input.statusBar.shortcuts')}
        </Text>
      </Box>
    </Box>
  );
}
