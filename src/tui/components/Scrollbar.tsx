/**
 * Scrollbar.tsx - 独立的 Unicode 终端垂直滚动条组件
 *
 * 在视口右侧绘制 1 列垂直滑块（█ / │），动态展示当前滚动位置与内容占比。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';

export interface ScrollbarProps {
  /** 滚动条高度（行数） */
  height: number;
  /** 总行数 / 总项目数 */
  totalItems: number;
  /** 当前视口可见行数 / 项目数 */
  visibleItems: number;
  /** 当前滚动偏移量 (0 ~ totalItems - visibleItems) */
  offset: number;
  /** 滑块颜色 */
  thumbColor?: string;
  /** 轨道颜色 */
  trackColor?: string;
}

export function Scrollbar({
  height,
  totalItems,
  visibleItems,
  offset,
  thumbColor = wastelandTheme.colors.secondary,
  trackColor = wastelandTheme.colors.borderDim,
}: ScrollbarProps): React.ReactElement | null {
  if (height <= 0) {
    return null;
  }

  // 当内容超出视口时计算滑块比例，未超出时渲染静态轨道
  const isScrollable = totalItems > visibleItems;
  const thumbHeight = isScrollable
    ? Math.max(1, Math.min(height, Math.round((visibleItems / totalItems) * height)))
    : height;
  const maxOffset = Math.max(1, totalItems - visibleItems);
  const clampedOffset = Math.max(0, Math.min(offset, maxOffset));
  const maxThumbTop = Math.max(0, height - thumbHeight);
  const thumbTop = isScrollable
    ? Math.min(maxThumbTop, Math.round((clampedOffset / maxOffset) * maxThumbTop))
    : 0;

  const rows: React.ReactElement[] = [];
  for (let i = 0; i < height; i++) {
    const isThumb = isScrollable && i >= thumbTop && i < thumbTop + thumbHeight;
    rows.push(
      <Box key={i} height={1}>
        <Text color={isThumb ? thumbColor : trackColor} dimColor={!isThumb}>
          {isThumb ? '█' : '│'}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={1} height={height}>
      {rows}
    </Box>
  );
}
