/**
 * ScrollableBox - 通用滚动容器组件
 *
 * 封装垂直滚动逻辑，提供统一的滚动体验：
 * - 自动计算可见区域
 * - 切片渲染（只渲染可见内容）
 * - 滚动指示器（▲/▼）
 * - 终端高度自适应
 *
 * 用法：
 * ```tsx
 * const [offset, setOffset] = useState(0);
 * <ScrollableBox
 *   offset={offset}
 *   onOffsetChange={setOffset}
 *   totalItems={items.length}
 *   itemHeight={2}
 * >
 *   {items.map(item => <Item key={item.id} {...item} />)}
 * </ScrollableBox>
 * ```
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { Scrollbar } from './Scrollbar.js';

// ============================================================
// Types
// ============================================================

export interface ScrollableBoxProps {
  /** 子元素（需要滚动的内容） */
  children: React.ReactNode;
  /** 可见高度（行数），不传则自动计算 */
  height?: number;
  /** 当前滚动偏移量 */
  offset: number;
  /** 滚动偏移量变化回调 */
  onOffsetChange: (offset: number) => void;
  /** 总内容项目数 */
  totalItems: number;
  /** 每个项目的大致行数（用于计算可见项目数） */
  itemHeight?: number;
  /** 是否显示滚动指示器文字 */
  showIndicators?: boolean;
  /** 是否显示右侧 Unicode 垂直滚动条（默认 false） */
  showScrollbar?: boolean;
  /** 指示器颜色 */
  indicatorColor?: string;
  /** 额外的垂直内边距（行数） */
  paddingY?: number;
  /**
   * 子元素已由调用方按可见窗口切好（大列表场景：先在数据层 slice 再做 map，
   * 避免为不可见条目创建 React 元素 / 计算耗时 data）。为 true 时跳过二次切片，
   * 原样渲染传入的子元素。
   */
  windowed?: boolean;
}

// ============================================================
// Component
// ============================================================

/**
 * ScrollableBox - 通用垂直滚动容器
 *
 * 功能：
 * - 根据终端高度或指定 height 计算可见区域
 * - 只渲染可见范围内的子元素
 * - 显示 ▲/▼ 滚动指示器
 * - 支持动态 itemHeight
 */
export function ScrollableBox({
  children,
  height: propHeight,
  offset,
  onOffsetChange,
  totalItems,
  itemHeight = 1,
  showIndicators = true,
  showScrollbar = false,
  indicatorColor = wastelandTheme.colors.muted,
  paddingY = 0,
  windowed = false,
}: ScrollableBoxProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // 计算实际可用高度
  const availableHeight = propHeight ?? terminalRows;

  // 计算可见项目数
  const maxVisible = Math.max(1, Math.floor((availableHeight - paddingY * 2) / itemHeight));

  // 边界检查
  const clampedOffset = Math.max(0, Math.min(offset, Math.max(0, totalItems - maxVisible)));

  // 滚动指示器状态
  const hasMoreAbove = clampedOffset > 0;
  const hasMoreBelow = clampedOffset + maxVisible < totalItems;
  const aboveCount = clampedOffset;
  const belowCount = Math.max(0, totalItems - clampedOffset - maxVisible);

  // 将 children 转为数组；windowed 模式下 children 已由调用方切好可见窗口，跳过二次切片
  const childArray = React.Children.toArray(children);
  const visibleChildren = windowed
    ? childArray
    : childArray.slice(clampedOffset, clampedOffset + maxVisible);

  // 如果 offset 与 clampedOffset 不同步，触发修正
  React.useEffect(() => {
    if (clampedOffset !== offset) {
      onOffsetChange(clampedOffset);
    }
  }, [clampedOffset, offset, onOffsetChange]);

  const body = (
    <Box flexDirection="column" flexGrow={1}>
      {/* 向上滚动指示器 */}
      {showIndicators && hasMoreAbove && (
        <Box flexDirection="row" flexShrink={0}>
          <Text color={indicatorColor}>▲ {aboveCount} more above</Text>
        </Box>
      )}

      {/* 可见内容区域 */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleChildren}
      </Box>

      {/* 向下滚动指示器 */}
      {showIndicators && hasMoreBelow && (
        <Box flexDirection="row" flexShrink={0}>
          <Text color={indicatorColor}>▼ {belowCount} more below</Text>
        </Box>
      )}
    </Box>
  );

  if (showScrollbar) {
    return (
      <Box flexDirection="row" flexGrow={1} height={availableHeight}>
        {body}
        <Scrollbar
          height={availableHeight}
          totalItems={totalItems}
          visibleItems={maxVisible}
          offset={clampedOffset}
        />
      </Box>
    );
  }

  return body;
}

// ============================================================
// useScroll hook - 辅助键盘滚动
// ============================================================

export interface UseScrollOptions {
  /** 总项目数 */
  totalItems: number;
  /** 每个项目行数 */
  itemHeight?: number;
  /** 可见高度 */
  height?: number;
  /** 初始偏移量 */
  initialOffset?: number;
}

export interface UseScrollResult {
  /** 当前偏移量 */
  offset: number;
  /** 设置偏移量 */
  setOffset: (offset: number) => void;
  /** 向上滚动（显示更早的内容） */
  scrollUp: (delta?: number) => void;
  /** 向下滚动（显示更新的内容） */
  scrollDown: (delta?: number) => void;
  /** 滚动到顶部 */
  scrollToTop: () => void;
  /** 滚动到底部 */
  scrollToBottom: () => void;
  /** 是否可以向上滚动 */
  canScrollUp: boolean;
  /** 是否可以向下滚动 */
  canScrollDown: boolean;
  /** 单屏可见条目数（由 height/itemHeight 导出，供 reveal 联动精确对齐渲染窗口） */
  maxVisible: number;
}

/**
 * useScroll - 滚动状态管理 hook
 *
 * 封装滚动偏移量的计算和边界检查。
 */
export function useScroll({
  totalItems,
  itemHeight = 1,
  height,
  initialOffset = 0,
}: UseScrollOptions): UseScrollResult {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const availableHeight = height ?? terminalRows;
  const maxVisible = Math.max(1, Math.floor(availableHeight / itemHeight));

  const [offset, setOffset] = React.useState(initialOffset);

  // 边界检查后的偏移量
  const clampedOffset = Math.max(0, Math.min(offset, Math.max(0, totalItems - maxVisible)));

  const canScrollUp = clampedOffset > 0;
  const canScrollDown = clampedOffset + maxVisible < totalItems;

  const scrollUp = React.useCallback(
    (delta: number = maxVisible) => {
      setOffset((prev) => Math.max(0, prev - delta));
    },
    [maxVisible],
  );

  const scrollDown = React.useCallback(
    (delta: number = maxVisible) => {
      setOffset((prev) => Math.min(Math.max(0, totalItems - maxVisible), prev + delta));
    },
    [totalItems, maxVisible],
  );

  const scrollToTop = React.useCallback(() => {
    setOffset(0);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    setOffset(Math.max(0, totalItems - maxVisible));
  }, [totalItems, maxVisible]);

  // Live tail 跟随：仅当“列表变长且之前已钉底”时跟到新底部。
  // 程序化跳转（offset 单独变化，如 ] 错误跳转 / Enter 定位）不扰动；
  // 历史区阅读中途来新数据也不抢夺视口（旧语义会在 offset 接近底部时无脑吸附）；
  // 初次加载（0 → N）不跟随，停在顶部（旧语义此处恰好 no-op，保持一致）。
  const followRef = React.useRef({ total: totalItems, offset });
  React.useEffect(() => {
    const prev = followRef.current;
    const grew = totalItems > prev.total && prev.total > 0;
    if (grew) {
      const wasPinned = prev.offset >= prev.total - maxVisible - 2;
      if (wasPinned) {
        setOffset(Math.max(0, totalItems - maxVisible));
      }
    }
    followRef.current = { total: totalItems, offset };
  }, [totalItems, offset, maxVisible]);

  return {
    offset: clampedOffset,
    setOffset,
    scrollUp,
    scrollDown,
    scrollToTop,
    scrollToBottom,
    canScrollUp,
    canScrollDown,
    maxVisible,
  };
}
