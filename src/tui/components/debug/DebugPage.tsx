/**
 * DebugPage - 调试页面
 *
 * 布局：
 * - 顶部：Session 信息 label（一行显示）
 * - 状态摘要行
 * - 主体：Trace 日志或过滤器
 */

import React from "react";
import { Text, Box } from "ink";
import { SessionInfo } from "./SessionInfo.js";
import { TraceLog } from "./TraceLog.js";
import { TraceFilter } from "./TraceFilter.js";
import { useAppContext } from "../../context/AppContext.js";
import {
  PRIMARY,
  SUCCESS,
  WARNING,
  SEPARATORS,
} from "../../utils/colors.js";
import { t } from "../../../locales/index.js";

interface DebugPageProps {
  height?: number;
  width?: number;
}

export function DebugPage({ height, width }: DebugPageProps): React.ReactElement {
  const { state, setFilterMode } = useAppContext();
  const { traces, filter } = state.debug;

  const hasFilter = Boolean(filter.scope || filter.phase);
  const filteredCount = traces.filter((t) => {
    if (filter.scope && t.scope !== filter.scope) return false;
    if (filter.phase && t.phase !== filter.phase) return false;
    return true;
  }).length;

  // 如果在过滤模式，显示过滤器
  if (state.filterMode) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <SessionInfo />
        <TraceFilter onExit={() => setFilterMode(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height} width={width}>
      {/* 顶部：Session 信息 label */}
      <SessionInfo />

      {/* 状态摘要行 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={PRIMARY}>Trace</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text>{filteredCount}/{traces.length} {t("tui.debug.count", { count: "" })}</Text>
          {hasFilter && (
            <Text color={WARNING}> ⚑ {t("tui.debug.filtering")}</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>Provider: </Text>
          <Text color="green">{state.config.provider}</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>{t("tui.debug.hint")}</Text>
        </Box>
      </Box>

      {/* 主体：Trace 日志 - 占据全部宽度 */}
      <Box
        flexGrow={1}
        flexShrink={1}
        flexDirection="column"
      >
        <TraceLog height={height ? height - 3 : undefined} />
      </Box>
    </Box>
  );
}
