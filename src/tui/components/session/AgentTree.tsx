/**
 * AgentTree - Agent 树状图
 *
 * 使用主题系统的状态图标
 * 添加运行时长显示
 * 使用树形连接线（└─、│）
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import {
  PRIMARY,
  MUTED,
  SUCCESS,
  ERROR,
  WARNING,
  STATUS_ICONS,
  SEPARATORS,
} from "../../utils/colors.js";
import { t } from "../../../locales/index.js";

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  idle: "gray",
  completed: SUCCESS,
  failed: ERROR,
  timeout: WARNING,
};

/**
 * 格式化运行时长
 */
function formatDuration(startTime: number, endTime?: number): string {
  const end = endTime ?? Date.now();
  const durationMs = end - startTime;

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${(durationMs / 60000).toFixed(1)}m`;
}

interface AgentTreeProps {
  width?: number;
}

export function AgentTree({ width = 25 }: AgentTreeProps): React.ReactElement {
  const { state } = useAppContext();
  const { agents } = state.session;

  // 计算总运行时长
  const mainAgent = agents.find(a => a.depth === 0);
  const totalDuration = mainAgent
    ? formatDuration(mainAgent.startTime, mainAgent.endTime)
    : "0ms";

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      width={width}
      borderStyle="single"
      borderColor={state.focusArea === "agentTree" ? "cyan" : "gray"}
    >
      {/* 标题 */}
      <Box flexDirection="row" gap={1}>
        <Text bold color={PRIMARY}>
          Agents
        </Text>
        <Text dimColor>
          ({agents.length || 1})
        </Text>
      </Box>

      {/* Agent 列表 */}
      {agents.length === 0 ? (
        // 默认显示主 Agent
        <Box flexDirection="row" gap={1}>
          <Text bold color="green">
            {STATUS_ICONS.running}
          </Text>
          <Text>{t("tui.session.agentTree.main")}</Text>
        </Box>
      ) : (
        agents.map((agent) => {
          const icon = STATUS_ICONS[agent.status];
          const color = STATUS_COLORS[agent.status];
          const duration = formatDuration(agent.startTime, agent.endTime);
          const indent = "  ".repeat(agent.depth);
          const branch = agent.depth > 0 ? SEPARATORS.branch + " " : "";

          return (
            <Box key={agent.id} flexDirection="column">
              {/* Agent 行 */}
              <Box flexDirection="row" gap={1}>
                <Text dimColor>
                  {indent}{branch}
                </Text>
                <Text bold color={color}>
                  {icon}
                </Text>
                <Text>{agent.name}</Text>
                {/* 运行时长 */}
                {agent.status === "running" && (
                  <Text dimColor color="gray">
                    {duration}
                  </Text>
                )}
                {/* 完成状态 */}
                {agent.status === "completed" && (
                  <Text color={SUCCESS}>
                    ✓ {duration}
                  </Text>
                )}
                {/* 失败状态 */}
                {agent.status === "failed" && (
                  <Text color={ERROR}>
                    ✗ {duration}
                  </Text>
                )}
                {/* 超时状态 */}
                {agent.status === "timeout" && (
                  <Text color={WARNING}>
                    ⏱ {duration}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })
      )}

      {/* 总运行时长 */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>─────────────</Text>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{t("tui.session.agentTree.running")}</Text>
          <Text color={MUTED}>{totalDuration}</Text>
        </Box>
      </Box>
    </Box>
  );
}
