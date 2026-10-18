/**
 * PermissionPromptBar - 紧凑横向权限提示卡片
 *
 * 负责渲染紧凑的横向权限提示卡片（[1] 允许一次 [2] 本会话记住 [3] 拒绝），
 * 并提供单键快捷响应与 session 规则注册的核心状态处理。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { describeAllowPattern } from '@core/engine/permission-gate.js';
import type { PermissionCard } from '../../context/AppContext.js';
import type { TuiRuntimeContext } from '../../types.js';

export interface PermissionPromptBarProps {
  card: PermissionCard | null;
  queuedCount?: number;
  selection?: number;
}

const BOX_PROPS = {
  flexDirection: 'column' as const,
  backgroundColor: '#0A0A0A',
  paddingLeft: 1,
  borderLeftColor: wastelandTheme.colors.warning,
  borderStyle: 'single' as const,
  borderTop: false,
  borderRight: false,
  borderBottom: false,
};

/**
 * 统一权限按键交互分发器，支持 1/2/3/y/a/n/Esc 单键秒级响应及方向键选择与会话规则注册
 */
export function handlePermissionKey(
  inputChar: string,
  key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; ctrl?: boolean; [k: string]: unknown },
  pending: PermissionCard | null,
  runtime: TuiRuntimeContext,
  selection: number,
  setSelection?: (next: number) => void,
): boolean {
  const bridge = runtime.userInputBridge;
  if (!bridge || !bridge.isPending()) return false;

  const pattern = pending ? describeAllowPattern(pending.toolName, pending.input) : null;
  const gate = runtime.permissionGate;
  const canRemember = pattern !== null && typeof gate?.addSessionRule === 'function';

  const confirmOnce = (): void => {
    bridge.provideInput('yes');
    setSelection?.(0);
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
    setSelection?.(0);
  };

  const deny = (): void => {
    bridge.provideInput('no');
    setSelection?.(0);
  };

  if (key.upArrow && setSelection) {
    let next = (selection - 1 + 3) % 3;
    if (!canRemember && next === 1) next = (next - 1 + 3) % 3;
    setSelection(next);
    return true;
  }
  if (key.downArrow && setSelection) {
    let next = (selection + 1) % 3;
    if (!canRemember && next === 1) next = (next + 1) % 3;
    setSelection(next);
    return true;
  }
  if (key.return) {
    if (selection === 0) confirmOnce();
    else if (selection === 1) confirmAlways();
    else deny();
    return true;
  }

  const token = (inputChar ?? '').trim().toLowerCase();
  if (key.escape || token === '3' || token === 'n' || token === 'no') {
    deny();
    return true;
  }
  if (token === '2' || token === 'a' || token === 'always') {
    confirmAlways();
    return true;
  }
  if (token === '1' || token === 'y' || token === 'yes' || token === '是') {
    confirmOnce();
    return true;
  }

  return true;
}

export function PermissionPromptBar({
  card,
  queuedCount = 0,
  selection = 0,
}: PermissionPromptBarProps): React.ReactElement {
  if (!card) {
    const yesActive = selection === 0 || selection === 1;
    return (
      <Box {...BOX_PROPS}>
        <Box flexDirection="row">
          <Text color={wastelandTheme.colors.warning} bold>
            {t('tui.session.input.hints.permissionUnknownTitle')}
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Box marginRight={2}>
            <Text color={yesActive ? wastelandTheme.colors.success : wastelandTheme.colors.muted} bold={yesActive}>
              {yesActive ? '▶ ' : '  '}[1] {t('tui.session.input.hints.yes')}
            </Text>
          </Box>
          <Box>
            <Text color={selection === 2 ? wastelandTheme.colors.error : wastelandTheme.colors.muted} bold={selection === 2}>
              {selection === 2 ? '▶ ' : '  '}[3] {t('tui.session.input.hints.no')}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  const allowPattern = describeAllowPattern(card.toolName, card.input);
  const canRemember = allowPattern !== null;

  return (
    <Box {...BOX_PROPS}>
      <Box flexDirection="row">
        <Text color={wastelandTheme.colors.warning} bold>
          {t('tui.session.input.hints.permissionTitle', { toolName: card.toolName })}
        </Text>
      </Box>
      {card.command && (
        <Box
          flexDirection="row"
          backgroundColor={wastelandTheme.colors.backgroundSecondary || wastelandTheme.colors.borderDim}
          paddingLeft={1}
          marginY={0}
        >
          <Text color={wastelandTheme.colors.secondary}>$ {card.command}</Text>
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap">
        <Box marginRight={2}>
          <Text color={selection === 0 ? wastelandTheme.colors.success : wastelandTheme.colors.muted} bold={selection === 0}>
            {selection === 0 ? '▶ ' : '  '}[1] {t('tui.session.input.hints.yes')}
          </Text>
        </Box>
        <Box marginRight={2}>
          <Text
            color={canRemember ? (selection === 1 ? wastelandTheme.colors.primary : wastelandTheme.colors.text) : wastelandTheme.colors.muted}
            bold={selection === 1 && canRemember}
            dimColor={!canRemember || selection !== 1}
          >
            {selection === 1 && canRemember ? '▶ ' : '  '}[2] {canRemember ? t('tui.session.input.hints.always', { label: allowPattern.label }) : t('tui.session.input.hints.alwaysDisabled')}
          </Text>
        </Box>
        <Box>
          <Text color={selection === 2 ? wastelandTheme.colors.error : wastelandTheme.colors.muted} bold={selection === 2}>
            {selection === 2 ? '▶ ' : '  '}[3] {t('tui.session.input.hints.no')}
          </Text>
        </Box>
      </Box>
      {queuedCount > 0 && (
        <Box flexDirection="row">
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.session.input.hints.permissionQueued', { count: String(queuedCount) })}
          </Text>
        </Box>
      )}
    </Box>
  );
}
