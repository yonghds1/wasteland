/**
 * TraceFilter - Trace 过滤器
 *
 * 支持按 scope 和 phase 过滤 trace 日志
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

const SCOPE_OPTIONS = ["all", "session", "turn", "provider", "tool", "ui"];
const PHASE_OPTIONS = ["all", "start", "end", "step", "call", "result"];

interface TraceFilterProps {
  onExit: () => void;
}

export function TraceFilter({ onExit }: TraceFilterProps): React.ReactElement {
  const { state, setState } = useAppContext();
  const [focusField, setFocusField] = useState<"scope" | "phase">("scope");

  const currentScope = state.debug.filter.scope ?? "all";
  const currentPhase = state.debug.filter.phase ?? "all";

  // 键盘交互
  useInput((input, key) => {
    // Tab 切换字段
    if (key.tab) {
      setFocusField((prev) => (prev === "scope" ? "phase" : "scope"));
      return;
    }

    // Esc 退出过滤模式
    if (key.escape) {
      onExit();
      return;
    }

    // Enter 应用过滤
    if (key.return) {
      onExit();
      return;
    }

    // 左右切换选项
    if (key.leftArrow || key.rightArrow) {
      if (focusField === "scope") {
        const options = SCOPE_OPTIONS;
        const idx = options.indexOf(currentScope);
        const nextIdx = key.leftArrow
          ? (idx - 1 + options.length) % options.length
          : (idx + 1) % options.length;
        const nextScope = options[nextIdx];
        setState((prev) => ({
          ...prev,
          debug: {
            ...prev.debug,
            filter: {
              ...prev.debug.filter,
              scope: nextScope === "all" ? undefined : nextScope,
            },
          },
        }));
      } else {
        const options = PHASE_OPTIONS;
        const idx = options.indexOf(currentPhase);
        const nextIdx = key.leftArrow
          ? (idx - 1 + options.length) % options.length
          : (idx + 1) % options.length;
        const nextPhase = options[nextIdx];
        setState((prev) => ({
          ...prev,
          debug: {
            ...prev.debug,
            filter: {
              ...prev.debug.filter,
              phase: nextPhase === "all" ? undefined : nextPhase,
            },
          },
        }));
      }
      return;
    }

    // 上下切换字段
    if (key.upArrow || key.downArrow) {
      setFocusField((prev) => (prev === "scope" ? "phase" : "scope"));
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          过滤器
        </Text>
        <Text dimColor> (Tab 切换字段 | ←/→ 切换值 | Esc 关闭)</Text>
      </Box>

      {/* Scope 字段 */}
      <Box flexDirection="row">
        <Text bold={focusField === "scope"} color={focusField === "scope" ? "yellow" : undefined}>
          {focusField === "scope" ? "▶ " : "  "}
          Scope:
        </Text>
        <Box flexDirection="row">
          {SCOPE_OPTIONS.map((scope, idx) => (
            <Text
              key={scope}
              bold={currentScope === scope}
              color={
                currentScope === scope
                  ? "green"
                  : focusField === "scope"
                    ? "gray"
                    : undefined
              }
            >
              {idx === 0 ? " " : " | "}
              {scope}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Phase 字段 */}
      <Box flexDirection="row">
        <Text bold={focusField === "phase"} color={focusField === "phase" ? "yellow" : undefined}>
          {focusField === "phase" ? "▶ " : "  "}
          Phase:
        </Text>
        <Box flexDirection="row">
          {PHASE_OPTIONS.map((phase, idx) => (
            <Text
              key={phase}
              bold={currentPhase === phase}
              color={
                currentPhase === phase
                  ? "green"
                  : focusField === "phase"
                    ? "gray"
                    : undefined
              }
            >
              {idx === 0 ? " " : " | "}
              {phase}
            </Text>
          ))}
        </Box>
      </Box>

      {/* 当前过滤状态 */}
      <Box marginTop={1}>
        <Text dimColor>当前过滤: </Text>
        {currentScope === "all" && currentPhase === "all" ? (
          <Text dimColor>无</Text>
        ) : (
          <>
            {currentScope !== "all" && <Text color="green">scope={currentScope}</Text>}
            {currentScope !== "all" && currentPhase !== "all" && <Text dimColor> & </Text>}
            {currentPhase !== "all" && <Text color="green">phase={currentPhase}</Text>}
          </>
        )}
      </Box>
    </Box>
  );
}
