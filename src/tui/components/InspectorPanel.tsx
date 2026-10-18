/**
 * InspectorPanel - 右侧检查器
 *
 * 左右结构右栏：子 agent 实时状态 + 工具详情 + 会话用量。
 * 空态不占位（对应区块直接不渲染）；auto-follow 最新 running 工具，无需选中态。
 * 窄屏（<120 列）由 ChatArea 直接不挂载本组件。
 */

import React from 'react';
import { Box, Text } from 'ink';

import { useAppContext } from '../context/AppContext.js';
import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { getAgentMode } from '@config/agent-mode-state.js';
import { resolveContextWindow } from '@core/memory/context-manager.js';
import { AgentTreeView } from './agent-tree/AgentTreeView.js';

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
  const { state, setState } = useAppContext();

  const agents = state.session.agents;
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
  const contentInnerWidth = Math.max(10, width - 4);

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

        {/* 智能体全景树状看板 */}
        {agents.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={wastelandTheme.colors.muted} dimColor>{t('tui.inspector.subagents')}</Text>
            <AgentTreeView
              agents={agents}
              width={contentInnerWidth}
              onSelectAgent={(targetId) => setState((prev) => ({ ...prev, viewFilter: targetId }))}
            />
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

      {/* 下半部分：固定会话状态（沉底展示） */}
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
