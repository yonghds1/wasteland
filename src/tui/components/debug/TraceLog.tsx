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
import { t } from "../../../locales/index.js";

interface TraceLogProps {
  height?: number;
}

/**
 * 根据 scope 获取颜色
 */
function getScopeColor(scope: string): string {
  switch (scope) {
    case "tool":
      return "yellow";
    case "session":
      return "cyan";
    case "skill":
      return "magenta";
    case "provider":
      return "green";
    default:
      return SECONDARY;
  }
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
    if (valueStr.length > 25) {
      valueStr = valueStr.slice(0, 25) + "...";
    }
    parts.push(`${key}=${valueStr}`);
  }

  const result = parts.join(", ");
  return result.length > 60 ? result.slice(0, 60) + "..." : result;
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

  return parts.join(" ").slice(0, 50);
}

/**
 * 渲染增强的trace消息
 */
function renderTraceMessage(trace: TraceEvent): { icon: string; content: string; detail?: string; phaseLabel: string } {
  // 工具调用
  if (trace.scope === "tool" && trace.data?.toolName) {
    const toolName = trace.data.toolName as string;
    const params = formatToolParams(trace.data.input as Record<string, unknown>);

    switch (trace.phase) {
      case "call":
        return { icon: "🔧", content: `${t("tui.debug.call")} ${toolName}`, detail: params ? `(${params})` : undefined, phaseLabel: "call" };
      case "success":
        return { icon: "✓", content: `${toolName} ${t("tui.debug.success")}`, phaseLabel: "success" };
      case "error":
        return { icon: "✗", content: `${toolName} ${t("tui.debug.failed")}`, detail: trace.data?.error as string, phaseLabel: "error" };
    }
  }

  // 权限决策
  if (trace.scope === "tool" && trace.phase === "permission") {
    const decision = trace.data?.decision as string;
    const toolName = trace.data?.toolName as string;
    const icon = decision === "allow" ? "✓" : decision === "deny" ? "✗" : "?";
    return { icon, content: `${t("tui.debug.permission")} ${toolName}`, detail: decision, phaseLabel: "permission" };
  }

  // Agent 事件
  if (trace.scope === "session" && trace.phase.includes("agent")) {
    if (trace.phase === "agent_spawned") {
      const name = trace.data?.name as string;
      const task = trace.data?.task as string;
      const depth = trace.data?.depth as number ?? 0;
      const indent = "  ".repeat(depth);
      return { icon: "🤖", content: `${indent}${t("tui.debug.createSubAgent")} ${name}`, detail: task?.slice(0, 35), phaseLabel: "spawn" };
    }
    if (trace.phase === "agent_completed") {
      const name = trace.data?.name as string;
      const status = trace.data?.status as string;
      const depth = trace.data?.depth as number ?? 0;
      const indent = "  ".repeat(depth);
      return { icon: status === "success" ? "✓" : "✗", content: `${indent}${t("tui.debug.agentDone")} ${name}`, phaseLabel: "complete" };
    }
  }

  // 技能调用
  if (trace.scope === "skill" && trace.data?.skillName) {
    const skillName = trace.data.skillName as string;
    const args = trace.data.args as { positional: string[]; named: Record<string, unknown> };

    switch (trace.phase) {
      case "started":
        return { icon: "⚡", content: `${t("tui.debug.executeSkill")} /${skillName}`, detail: formatSkillArgs(args), phaseLabel: "started" };
      case "success":
        return { icon: "✓", content: `/${skillName} ${t("tui.debug.success")}`, phaseLabel: "success" };
      case "error":
        return { icon: "✗", content: `/${skillName} ${t("tui.debug.failed")}`, phaseLabel: "error" };
    }
  }

  // Provider 事件
  if (trace.scope === "provider") {
    if (trace.phase === "request") {
      return { icon: "→", content: t("tui.debug.sendRequest"), phaseLabel: "request" };
    }
    if (trace.phase === "response") {
      return { icon: "←", content: t("tui.debug.receiveResponse"), phaseLabel: "response" };
    }
  }

  // 默认渲染
  return { icon: "●", content: trace.message, phaseLabel: trace.phase };
}

export function TraceLog({ height }: TraceLogProps): React.ReactElement {
  const { state } = useAppContext();
  const { traces, filter } = state.debug;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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
      // 空格展开/折叠详情
      if (input === " ") {
        const absIdx = scrollOffset + Math.min(visibleLines - 1, filteredTraces.length - 1);
        setExpandedIdx((prev) => prev === absIdx ? null : absIdx);
      }
    },
    // 仅在 traceLog 焦点时处理
    { isActive: state.focusArea === "traceLog" && !state.inputMode && !state.filterMode && !state.editMode && !state.exitConfirmPending && !state.showHelp }
  );

  // 空状态
  if (traces.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={PRIMARY}>◆ {t("tui.debug.waitingTrace")}</Text>
        <Text dimColor>{t("tui.debug.useDebugHint")}</Text>
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
            {t("tui.debug.traceLog")}
          </Text>
          {hasFilter && (
            <Text color={WARNING}>⚑ {t("tui.debug.filter")}</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{filteredTraces.length}/{traces.length} {t("tui.debug.count", { count: "" })}</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>{t("tui.footer.scroll")}</Text>
        </Box>
      </Box>

      {/* 日志列表 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleTraces.map((trace, idx) => {
          const absIdx = scrollOffset + idx;
          const scopeColor = getScopeColor(trace.scope);
          const phaseColor = getLogLevelColor(trace.phase);
          const { icon, content, detail, phaseLabel } = renderTraceMessage(trace);
          const isExpanded = expandedIdx === absIdx;

          return (
            <Box key={absIdx} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                {/* 展开指示 */}
                <Text dimColor color="gray">{isExpanded ? "▼" : " "}</Text>

                {/* 时间戳 */}
                <Text dimColor color="gray">[{trace.timestamp.slice(11, 19)}]</Text>

                {/* 图标 */}
                <Text>{icon}</Text>

                {/* scope */}
                <Text color={scopeColor} bold>{trace.scope}</Text>

                {/* phase 标签 */}
                <Text dimColor color="gray">.{phaseLabel}</Text>

                {/* 主要内容 */}
                <Text color={phaseColor}>{content}</Text>

                {/* turn/step 标识 */}
                {(trace.turn || trace.step) && (
                  <Text dimColor color="gray">
                    [t{trace.turn ?? "-"}s{trace.step ?? "-"}]
                  </Text>
                )}
              </Box>

              {/* 展开详情 */}
              {isExpanded && (
                <Box flexDirection="column" paddingLeft={4}>
                  {detail && (
                    <Box flexDirection="row">
                      <Text dimColor>{t("tui.debug.details")} </Text>
                      <Text>{detail}</Text>
                    </Box>
                  )}
                  <Box flexDirection="row">
                    <Text dimColor>{t("tui.debug.rawData")} </Text>
                    <Text dimColor color="gray">{JSON.stringify(trace.data ?? {}).slice(0, 80)}</Text>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 滚动指示器 */}
      {filteredTraces.length > visibleLines && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor color="gray">
            {scrollOffset > 0 ? "▲ " : "  "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, filteredTraces.length)} / {filteredTraces.length}
            {scrollOffset + visibleLines < filteredTraces.length ? " ▼" : "  "}
          </Text>
        </Box>
      )}

      {/* 过滤器状态 */}
      {hasFilter && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>{t("tui.debug.filterCondition")}</Text>
          {filter.scope && (
            <Text color="cyan">scope={filter.scope}</Text>
          )}
          {filter.phase && (
            <Text color={SECONDARY}>phase={filter.phase}</Text>
          )}
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>{t("tui.debug.modifyFilter")}</Text>
        </Box>
      )}
    </Box>
  );
}
