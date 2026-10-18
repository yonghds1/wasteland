/**
 * AgentTabs - 顶部子 agent 横向 tab 条 (Ink 组件)
 * 纯数学、视口计算与样式映射已解耦至 ./agent-tabs/agent-tabs-utils.js
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { TuiRuntimeContext } from '../types.js';
import {
  type AgentTab,
  buildTabs,
  computeViewport,
  getAgentBarBorderColor,
  getAgentTabStyle,
  getMainTabLabel,
  moveTabIndex,
  selectTabViewFilter,
} from './agent-tabs/agent-tabs-utils.js';

// 向下兼容导出已有公共契约与纯函数
export {
  type AgentTab,
  type ViewportResult,
  type AgentTabVisualState,
  type AgentTabStyle,
  type AgentTabsRightSideItem,
  statusIcon,
  tabWidth,
  computeViewport,
  getPersistentHighlightId,
  buildTabs,
  getAgentBarBorderColor,
  selectTabViewFilter,
  moveTabIndex,
  getMainTabLabel,
  getAgentTabStyle,
  getInitialSelectedIdx,
  getRightSideProse,
} from './agent-tabs/agent-tabs-utils.js';

export interface AgentTabsProps {
  runtime: TuiRuntimeContext;
}

export function AgentTabs({ runtime }: AgentTabsProps): React.ReactElement {
  const { state, setViewFilter, setFocusArea, setInputMode } = useAppContext();

  // tab 列表构建:Main 永远第一
  const tabs = useMemo<AgentTab[]>(() => buildTabs(state.session.agents), [state.session.agents]);

  // 当前激活 tab 索引（由 state.viewFilter 唯一驱动）
  const activeIdx = useMemo(() => {
    const idx = tabs.findIndex((t) => (t.isMain ? state.viewFilter === undefined : state.viewFilter === t.id));
    return idx >= 0 ? idx : 0;
  }, [tabs, state.viewFilter]);

  const isFocused = state.focusArea === 'agentTabs';

  // 键盘导航选中项：失焦时跟随 activeIdx，进焦后由 ←/→ 独立移动
  const [selectedIdx, setSelectedIdx] = useState<number>(() => 0);
  useEffect(() => {
    if (!isFocused) setSelectedIdx(activeIdx);
  }, [activeIdx, isFocused]);

  // 键盘交互（focus-management.md §6：先 gate focusArea）
  useInput((input, key) => {
    if (state.focusArea !== 'agentTabs') return;
    if (key.leftArrow) {
      setSelectedIdx((cur) => moveTabIndex(cur, -1, tabs.length));
    } else if (key.rightArrow) {
      setSelectedIdx((cur) => moveTabIndex(cur, 1, tabs.length));
    } else if (key.return) {
      const tab = tabs[selectedIdx];
      if (tab) setViewFilter(selectTabViewFilter(tab));
    } else if (key.escape) {
      setFocusArea('inputBar');
      setInputMode(true);
    }
  });

  const borderColor = getAgentBarBorderColor(state.focusArea);
  const brandWidth = wastelandTheme.displayName.length + (runtime.config.model?.length ?? 0) + 8;
  const reserved = Math.max(10, brandWidth + 4);
  const terminalWidth = process.stdout.columns || 80;
  const focusIdx = isFocused ? selectedIdx : activeIdx;
  const viewport = computeViewport(tabs, focusIdx, terminalWidth, reserved);

  const colorByKey = (colorKey: 'muted' | 'primary' | 'textEmphasized'): string => {
    if (colorKey === 'primary') return wastelandTheme.colors.primary;
    if (colorKey === 'textEmphasized') return wastelandTheme.colors.textEmphasized;
    return wastelandTheme.colors.muted;
  };

  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottomColor={borderColor}
    >
      <Text color={wastelandTheme.colors.primary} bold>
        {wastelandTheme.displayName}
      </Text>
      <Text color={wastelandTheme.colors.muted}>
        {' · '}
        {runtime.config.model}
      </Text>

      {tabs.length > 0 && (
        <Box flexDirection="row" marginLeft={2}>
          {viewport.showLeft && <Text color={wastelandTheme.colors.muted}>◀ </Text>}
          {viewport.visibleTabs.map((tab, i) => {
            const originalIdx = viewport.visibleIndices[i] ?? 0;
            const isActive = originalIdx === activeIdx;
            const isSelected = isFocused && originalIdx === selectedIdx;
            const style = getAgentTabStyle({ isSelected, isActive });
            const label = tab.isMain ? getMainTabLabel(runtime.skin) : tab.name;
            const tabColor = colorByKey(style.colorKey);

            return (
              <Box key={tab.id} marginRight={1}>
                <Text color={tabColor} bold={style.bold}>
                  {isSelected ? '▶ ' : ''}[{label}]{style.hasActiveMarker ? '◆' : ''}
                </Text>
              </Box>
            );
          })}
          {viewport.showRight && <Text color={wastelandTheme.colors.muted}> ▶</Text>}
          {tabs.length > 1 && (
            <Text color={wastelandTheme.colors.muted} dimColor>
              (Alt+1~{Math.min(9, tabs.length)} 切换)
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
