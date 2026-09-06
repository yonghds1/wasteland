/**
 * InspectorPanel - 右侧检查器
 *
 * 左右结构右栏：子 agent 实时状态 + 工具详情 + 会话用量。
 * 空态不占位（对应区块直接不渲染）；auto-follow 最新 running 工具，无需选中态。
 * 窄屏（<120 列）由 ChatArea 直接不挂载本组件。
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { getAgentMode } from '@config/agent-mode-state.js';
import { resolveContextWindow } from '@core/memory/context-manager.js';
import { statusIcon } from './AgentTabs.js';

interface InspectorPanelProps {
  width: number;
  height: number;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function InspectorPanel({ width, height }: InspectorPanelProps): React.ReactElement {
  const { state } = useAppContext();

  const subAgents = useMemo(
    () => state.session.agents.filter((a) => a.depth >= 1),
    [state.session.agents]
  );
  const tools = state.session.tools;
  const runningTool = [...tools].reverse().find((t) => t.status === 'running');
  const focusTool = runningTool ?? (tools.length > 0 ? tools[tools.length - 1] : undefined);
  const successCount = tools.filter((t) => t.status === 'success').length;
  const errorCount = tools.filter((t) => t.status === 'error').length;

  const usage = state.session.usage;
  const configuredContextWindow =
    Object.values(state.fullConfig?.models ?? {}).find((m) => m.model === state.config.model)?.contextWindow ??
    state.fullConfig?.models?.['default']?.contextWindow;
  const contextWindow = resolveContextWindow(state.config.model, configuredContextWindow);
  const usageRatio = contextWindow > 0 ? usage.totalTokens / contextWindow : 0;

  return (
    <Box
      flexDirection="column"
      justifyContent="space-between"
      width={width}
      height={height}
      flexShrink={0}
      overflow="hidden"
      borderStyle={wastelandTheme.decorations.borderStyle}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderLeftColor={wastelandTheme.colors.borderDim}
      paddingLeft={2}
      paddingRight={1}
      paddingBottom={1}
    >
      {/* 上半部分：动态活跃内容（空时不占位） */}
      <Box flexDirection="column" marginTop={1}>
        {/* 当前计划 */}
        {(() => {
          const planTool = [...tools].reverse().find((t) => t.name === 'tui_update_panel' && t.args);
          if (!planTool || !planTool.args) return null;
          try {
            const args = JSON.parse(planTool.args);
            if (!args.tasks || args.tasks.length === 0) return null;
            return (
              <Box flexDirection="column" marginBottom={1}>
                <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.inspector.plan')}</Text>
                {args.tasks.map((task: any, index: number) => {
                  let icon = '◯ ';
                  let color: string = wastelandTheme.colors.muted;
                  let isBold = false;
                  if (task.status === 'done') {
                    icon = '✓ ';
                    color = wastelandTheme.colors.success;
                  } else if (task.status === 'running') {
                    icon = '▶ ';
                    color = wastelandTheme.colors.primary;
                    isBold = true;
                  } else if (task.status === 'error') {
                    icon = '✗ ';
                    color = wastelandTheme.colors.error;
                  }
                  return (
                    <Box key={index} flexDirection="row">
                      <Text color={color} bold={isBold}>{icon}{index + 1}. {task.title}</Text>
                    </Box>
                  );
                })}
              </Box>
            );
          } catch {
            return null;
          }
        })()}

        {/* 活跃智能体 */}
        {subAgents.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.inspector.subagents')}</Text>
            {subAgents.map((a) => {
              const color =
                a.status === 'failed'
                  ? wastelandTheme.colors.error
                  : a.status === 'timeout'
                    ? wastelandTheme.colors.warning
                    : a.status === 'running'
                      ? wastelandTheme.colors.primary
                      : wastelandTheme.colors.muted;
              return (
                <Box key={a.id} flexDirection="row">
                  <Text color={color} bold={a.status === 'running'}>
                    {statusIcon(a.status)} {a.roleName ?? a.name}
                    {a.status === 'running' && a.currentAction ? ` · ${a.currentAction}` : ''}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* 焦点工具 */}
        {focusTool && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.inspector.tool')}</Text>
            <Text
              color={
                focusTool.status === 'error'
                  ? wastelandTheme.colors.error
                  : focusTool.status === 'success'
                    ? wastelandTheme.colors.success
                    : wastelandTheme.colors.primary
              }
              bold
            >
              ⚡ {focusTool.name} · {focusTool.status}
              {focusTool.duration !== undefined ? ` (${formatDuration(focusTool.duration)})` : ''}
            </Text>
          </Box>
        )}
      </Box>

      {/* 下半部分：固定会话状态（沉底展示）。
          model 不在这里显示：顶栏品牌区已有全局 model，重复属冗余。
          （若未来支持按 agent 切换 model，此处改为显示选中 agent 的 model。） */}
      <Box flexDirection="column">
        <Text color={wastelandTheme.colors.muted} dimColor>
          {t('tui.inspector.mode')}: {state.config.mode ?? getAgentMode()}
        </Text>
        <Text color={wastelandTheme.colors.muted} dimColor>
          {t('tui.inspector.tokens')}: {(usage.totalTokens / 1000).toFixed(1)}k / {(contextWindow / 1000).toFixed(0)}k ({Math.round(usageRatio * 100)}%)
        </Text>
        <Text color={wastelandTheme.colors.muted} dimColor>
          {t('tui.inspector.tools')}: {successCount}✓ {errorCount}✗
        </Text>
        
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted} dimColor>
            {t('tui.inspector.toggle')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
