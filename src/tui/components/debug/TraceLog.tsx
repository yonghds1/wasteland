/**
 * TraceLog - Trace 日志
 *
 * 显示调试追踪日志，支持：
 * - scope.phase 显示
 * - 过滤器支持
 * - 滚动查看
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import type { TraceEvent } from "../../context/AppContext.js";
import {
  PRIMARY,
  MUTED,
  SECONDARY,
  SUCCESS,
  WARNING,
  SEPARATORS,
} from "../../utils/colors.js";

interface TraceLogProps {
  height?: number;
}

/**
 * 根据日志级别获取颜色
 */
function getLogLevelColor(phase: string): string {
  if (phase.includes("error") || phase.includes("fail")) {
    return "red";
  }
  if (phase.includes("warn")) {
    return WARNING;
  }
  if (phase.includes("success") || phase.includes("complete")) {
    return SUCCESS;
  }
  return SECONDARY;
}

/**
 * 格式化工具参数（截断过长的值）
 */
function formatToolParams(input: Record<string, unknown> | undefined): string {
  if (!input) return "";

  const parts: string[] = [];
  for (const [key, value] of Object.entries(input).slice(0, 3)) {
    let valueStr = String(value);
    if (valueStr.length > 20) {
      valueStr = valueStr.slice(0, 20) + "...";
    }
    parts.push(`${key}=${valueStr}`);
  }

  const result = parts.join(", ");
  return result.length > 50 ? result.slice(0, 50) + "..." : result;
}

/**
 * 格式化技能参数
 */
function formatSkillArgs(args: { positional: string[]; named: Record<string, unknown> }): string {
  const parts: string[] = [];

  if (args.positional.length > 0) {
    parts.push(args.positional.join(" "));
  }

  const namedParts = Object.entries(args.named)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${String(v).slice(0, 15)}`);
  parts.push(...namedParts);

  return parts.join(" ").slice(0, 40);
}

/**
 * 渲染增强的trace消息
 */
function renderTraceMessage(trace: TraceEvent): { icon: string; content: string; detail?: string } {
  // 工具调用
  if (trace.scope === "tool" && trace.data?.toolName) {
    const toolName = trace.data.toolName as string;
    const params = formatToolParams(trace.data.input as Record<string, unknown>);

    switch (trace.phase) {
      case "call":
        return { icon: "🔧", content: `调用 ${toolName}`, detail: params ? `(${params})` : undefined };
      case "success":
        return { icon: "✓", content: `${toolName} 成功` };
      case "error":
        return { icon: "✗", content: `${toolName} 失败`, detail: trace.data?.error as string };
    }
  }

  // 权限决策
  if (trace.scope === "tool" && trace.phase === "permission") {
    const decision = trace.data?.decision as string;
    const toolName = trace.data?.toolName as string;
    const icon = decision === "allow" ? "✓" : decision === "deny" ? "✗" : "?";
    return { icon, content: `权限: ${toolName}`, detail: decision };
  }

  // Agent 事件
  if (trace.scope === "session" && trace.phase.includes("agent")) {
    if (trace.phase === "agent_spawned") {
      const name = trace.data?.name as string;
      const task = trace.data?.task as string;
      const depth = trace.data?.depth as number ?? 0;
      const indent = "  ".repeat(depth);
      return { icon: "🤖", content: `${indent}创建子Agent: ${name}`, detail: task?.slice(0, 30) };
    }
    if (trace.phase === "agent_completed") {
      const name = trace.data?.name as string;
      const status = trace.data?.status as string;
      const depth = trace.data?.depth as number ?? 0;
      const indent = "  ".repeat(depth);
      return { icon: status === "success" ? "✓" : "✗", content: `${indent}Agent完成: ${name}` };
    }
  }

  // 技能调用
  if (trace.scope === "skill" && trace.data?.skillName) {
    const skillName = trace.data.skillName as string;
    const args = trace.data.args as { positional: string[]; named: Record<string, unknown> };

    switch (trace.phase) {
      case "started":
        return { icon: "⚡", content: `执行技能: /${skillName}`, detail: formatSkillArgs(args) };
      case "success":
        return { icon: "✓", content: `/${skillName} 完成` };
      case "error":
        return { icon: "✗", content: `/${skillName} 失败` };
    }
  }

  // Provider 事件
  if (trace.scope === "provider") {
    if (trace.phase === "request") {
      return { icon: "→", content: "发送请求" };
    }
    if (trace.phase === "response") {
      return { icon: "←", content: "收到响应" };
    }
  }

  // 默认渲染
  return { icon: "●", content: trace.message };
}

export function TraceLog({ height }: TraceLogProps): React.ReactElement {
  const { state } = useAppContext();
  const { traces, filter } = state.debug;
  const [scrollOffset, setScrollOffset] = useState(0);

  // 可见行数
  const visibleLines = height ? Math.max(height - 4, 5) : 15;

  // 过滤 traces
  const filteredTraces = traces.filter((trace) => {
    if (filter.scope && trace.scope !== filter.scope) return false;
    if (filter.phase && trace.phase !== filter.phase) return false;
    return true;
  });

  // 可见 traces
  const visibleTraces = filteredTraces.slice(scrollOffset, scrollOffset + visibleLines);

  // 键盘滚动（基于焦点区域激活）
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setScrollOffset((prev) => Math.min(Math.max(0, filteredTraces.length - visibleLines), prev + 1));
      }
    },
    // 仅在 traceLog 焦点时处理
    { isActive: state.focusArea === "traceLog" && !state.inputMode && !state.filterMode && !state.editMode && !state.exitConfirmPending && !state.showHelp }
  );

  // 空状态
  if (traces.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={PRIMARY}>◆ 暂无 trace 日志</Text>
        <Text dimColor>使用 --debug 启动以查看详细追踪</Text>
        <Text dimColor color="gray">rxc chat --debug --message "你的消息"</Text>
      </Box>
    );
  }

  // 是否有激活的过滤器
  const hasFilter = Boolean(filter.scope || filter.phase);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={PRIMARY}>
            Trace 日志
          </Text>
          {hasFilter && (
            <Text color={WARNING}>⚑ 过滤</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{filteredTraces.length} 条</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>↑/↓ 滚动</Text>
        </Box>
      </Box>

      {/* 日志列表 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleTraces.map((trace, idx) => {
          const phaseColor = getLogLevelColor(trace.phase);
          const { icon, content, detail } = renderTraceMessage(trace);

          return (
            <Box key={scrollOffset + idx} flexDirection="row" gap={1}>
              {/* 时间戳 */}
              <Text dimColor>[{trace.timestamp.slice(11, 19)}]</Text>

              {/* 图标 */}
              <Text>{icon}</Text>

              {/* scope */}
              <Text color="cyan" dimColor>{trace.scope}</Text>

              {/* 主要内容 */}
              <Text color={phaseColor}>{content}</Text>

              {/* 详情 */}
              {detail && (
                <Text dimColor>{detail}</Text>
              )}

              {/* turn/step 标识 */}
              {(trace.turn || trace.step) && (
                <Text dimColor color="gray">
                  [t{trace.turn ?? "-"}s{trace.step ?? "-"}]
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 滚动指示器 */}
      {filteredTraces.length > visibleLines && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>
            {scrollOffset > 0 ? "▲ " : "  "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, filteredTraces.length)} / {filteredTraces.length}
            {scrollOffset + visibleLines < filteredTraces.length ? " ▼" : "  "}
          </Text>
        </Box>
      )}

      {/* 过滤器状态 */}
      {hasFilter && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>过滤条件:</Text>
          {filter.scope && (
            <Text color="cyan">scope={filter.scope}</Text>
          )}
          {filter.phase && (
            <Text color={SECONDARY}>phase={filter.phase}</Text>
          )}
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>f 修改</Text>
        </Box>
      )}
    </Box>
  );
}
