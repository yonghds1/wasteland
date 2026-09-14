/**
 * PermissionPrompt - 权限确认卡片
 *
 * 从 ChatInputBar 抽出（该文件已顶到 500 行上限）。三种状态：
 *
 * 1. 有队头卡片 → 展示 toolName + command + 三选项；无可记模式时第 2 项置灰。
 * 2. 队列非空 → 追加「还有 N 个确认排队等待回答」。
 *    并行子 agent 同批提问时，卡片会 FIFO 逐个上位，此前用户无从知道还排着几个
 *    （09-14-subagent-permission-hang）。
 * 3. bridge 有待处理请求但「队头卡片为空」→ 展示可操作兜底。
 *    此时 ChatInputBar 仍会把按键当权限回答（它按 bridge.isPending() 分流），
 *    若不给任何提示就是「输入被吞、界面空白」的静默死锁。
 */

import React from 'react';
import { Box, Text } from 'ink';

import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { describeAllowPattern } from '@core/engine/permission-gate.js';
import type { PermissionCard } from '../context/AppContext.js';

export interface PermissionPromptProps {
  /** 队头卡片；为 null 表示只有 bridge 侧有待处理请求 */
  card: PermissionCard | null;
  /** 排队等待中的确认数（不含队头） */
  queuedCount: number;
  /** 当前高亮项：0=本次允许 1=记住这类 2=拒绝 */
  selection: number;
}

const CARD_BOX = {
  flexDirection: 'column' as const,
  backgroundColor: '#0A0A0A',
  paddingLeft: 1,
  borderLeftColor: wastelandTheme.colors.warning,
  borderStyle: 'single' as const,
  borderTop: false,
  borderRight: false,
  borderBottom: false,
};

function HintRow(props: { label: string; active: boolean; disabled?: boolean; color: string }): React.ReactElement {
  return (
    <Box flexDirection="row">
      <Text
        color={props.disabled ? wastelandTheme.colors.muted : props.color}
        bold={props.active && !props.disabled}
        dimColor={!props.active || Boolean(props.disabled)}
      >
        {props.active && !props.disabled ? '▶ ' : '  '}
        {props.label}
      </Text>
    </Box>
  );
}

export function PermissionPrompt({ card, queuedCount, selection }: PermissionPromptProps): React.ReactElement {
  // 详情缺失兜底：只给可用的两个选项（无法判断该工具能否「记住这类」）
  if (!card) {
    // selection===1（记住这类）在本兜底里没有对应行，而按 Enter 会走 confirmAlways
    // → 后者因 pattern 为 null 降级为 confirmOnce。故这里把 1 也高亮到「本次允许」，
    // 让显示与实际行为一致。
    const yesActive = selection === 0 || selection === 1;
    return (
      <Box {...CARD_BOX}>
        <Box flexDirection="row">
          <Text color={wastelandTheme.colors.warning} bold>
            {t('tui.session.input.hints.permissionUnknownTitle')}
          </Text>
        </Box>
        <HintRow
          label={t('tui.session.input.hints.yes')}
          active={yesActive}
          color={wastelandTheme.colors.success}
        />
        <HintRow label={t('tui.session.input.hints.no')} active={selection === 2} color={wastelandTheme.colors.error} />
      </Box>
    );
  }

  const allowPattern = describeAllowPattern(card.toolName, card.input);
  const canRemember = allowPattern !== null;

  return (
    <Box {...CARD_BOX}>
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
          marginTop={1}
          marginBottom={1}
        >
          <Text color={wastelandTheme.colors.secondary}>$ {card.command}</Text>
        </Box>
      )}
      <HintRow
        label={t('tui.session.input.hints.yes')}
        active={selection === 0}
        color={wastelandTheme.colors.success}
      />
      <HintRow
        label={
          canRemember
            ? t('tui.session.input.hints.always', { label: allowPattern.label })
            : t('tui.session.input.hints.alwaysDisabled')
        }
        active={selection === 1}
        disabled={!canRemember}
        color={wastelandTheme.colors.primary}
      />
      <HintRow label={t('tui.session.input.hints.no')} active={selection === 2} color={wastelandTheme.colors.error} />
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
