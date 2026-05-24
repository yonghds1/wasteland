/**
 * AgentTree - Agent 树状图
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

const STATUS_ICONS: Record<string, string> = {
  running: "●",
  idle: "○",
  completed: "✓",
  failed: "✗",
  timeout: "⏱",
};

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  idle: "gray",
  completed: "green",
  failed: "red",
  timeout: "yellow",
};

export function AgentTree(): React.ReactElement {
  const { state } = useAppContext();
  const { agents } = state.session;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Agents ({agents.length || 1})
      </Text>
      {agents.length === 0 ? (
        <Box flexDirection="row">
          <Text color="green">●</Text>
          <Text> rxc (main)</Text>
        </Box>
      ) : (
        agents.map((agent) => (
          <Box key={agent.id} flexDirection="row">
            <Text>
              {"  ".repeat(agent.depth)}
              {agent.depth > 0 ? "└─ " : ""}
            </Text>
            <Text color={STATUS_COLORS[agent.status]}>
              {STATUS_ICONS[agent.status]}
            </Text>
            <Text> {agent.name}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
