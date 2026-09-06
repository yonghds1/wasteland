/**
 * CompactStatusBar - 窄屏单行状态条（R4）
 *
 * `ChatArea` 在终端宽度 `< 100`（不挂载 `InspectorPanel`）时渲染本组件，
 * 把沉底关键信息（mode / tokens / tools）降级为 1 行摘要。
 *
 * 约束（`.trellis/spec/frontend/*`）：
 * - 默认 1 行，`flexShrink={0}`，不展开；
 * - 只用 `borderBottom borderDim` 做区隔，不用 `backgroundColor` 微调
 *  （256-color 量化下深色底无效，见 `theme-skin.md §3.1`）；
 * - 文案全部复用 `tui.inspector.*` 现有 i18n key，不新增；
 * - 与 `ChatInputBar` 解耦：独立 `useAppContext` 订阅。
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { getAgentMode } from '@config/agent-mode-state.js';
import { resolveContextWindow } from '@core/memory/context-manager.js';

interface CompactStatusBarProps {
  width: number;
}

/**
 * 窄屏摘要行纯格式（可单测）：`mode · tokens · tools`。
 */
export function formatCompactStatus(summary: {
  modeLabel: string;
  mode: string;
  tokensLabel: string;
  usedK: string;
  windowK: string;
  ratioPct: number;
  toolsLabel: string;
  success: number;
  errors: number;
}): string {
  return (
    `${summary.modeLabel}: ${summary.mode} · ` +
    `${summary.tokensLabel}: ${summary.usedK}/${summary.windowK} (${summary.ratioPct}%) · ` +
    `${summary.toolsLabel}: ${summary.success}✓ ${summary.errors}✗`
  );
}

export function CompactStatusBar({ width }: CompactStatusBarProps): React.ReactElement {
  const { state } = useAppContext();

  const summary = useMemo(() => {
    const tools = state.session.tools;
    const success = tools.filter((tool) => tool.status === 'success').length;
    const errors = tools.filter((tool) => tool.status === 'error').length;
    const usage = state.session.usage;
    const configured =
      Object.values(state.fullConfig?.models ?? {}).find((m) => m.model === state.config.model)
        ?.contextWindow ?? state.fullConfig?.models?.['default']?.contextWindow;
    const window = resolveContextWindow(state.config.model, configured);
    const ratio = window > 0 ? usage.totalTokens / window : 0;
    return {
      mode: state.config.mode ?? getAgentMode(),
      usedK: (usage.totalTokens / 1000).toFixed(1),
      windowK: (window / 1000).toFixed(0),
      ratioPct: Math.round(ratio * 100),
      success,
      errors,
    };
  }, [state.session.tools, state.session.usage, state.fullConfig, state.config.model, state.config.mode]);

  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      width={width}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottomColor={wastelandTheme.colors.borderDim}
    >
      <Text color={wastelandTheme.colors.muted} dimColor>
        {formatCompactStatus({
          modeLabel: t('tui.inspector.mode'),
          mode: summary.mode,
          tokensLabel: t('tui.inspector.tokens'),
          usedK: summary.usedK,
          windowK: summary.windowK,
          ratioPct: summary.ratioPct,
          toolsLabel: t('tui.inspector.tools'),
          success: summary.success,
          errors: summary.errors,
        })}
      </Text>
    </Box>
  );
}
