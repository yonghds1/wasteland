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

  // 指示器占行预留：先按无指示器算初版，再按实际显示的指示器扣行重算一次。
  // 收缩窗口不会消除 hasMore（below 只增不减，above 与 offset 无关），一次迭代即收敛。
  // 不预留的话，指示器行会让渲染超出预算（Ink 不裁剪溢出），把页面撑开。
  const rawVisible = Math.max(1, Math.floor((availableHeight - paddingY * 2) / itemHeight));
  const rawClamped = Math.max(0, Math.min(offset, Math.max(0, totalItems - rawVisible)));
  const reservedRows =
    (showIndicators && rawClamped > 0 ? 1 : 0) +
    (showIndicators && rawClamped + rawVisible < totalItems ? 1 : 0);
  const maxVisible = Math.max(1, Math.floor((availableHeight - paddingY * 2 - reservedRows) / itemHeight));

  // 边界检查。windowed 模式下调用方已按行预算自切自钳（如 LogsPage 的
  // cardWindowStart + clampToLastItem），这里"总条数-可见条数"的等高清目钳制
  // 模型不成立（卡片变高，行预算窗口 ≠ maxVisible 条），会把调用方的合法 offset
  // 往回拽（错误跳到 idx5 → 被夹到 3），故 windowed 时信任调用方传入的 offset。
  const clampedOffset = windowed
    ? Math.max(0, Math.min(offset, Math.max(0, totalItems - 1)))
    : Math.max(0, Math.min(offset, Math.max(0, totalItems - maxVisible)));

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

  // 如果 offset 与 clampedOffset 不同步，触发修正（windowed 由调用方掌管，不回拽）。
  React.useEffect(() => {
    if (!windowed && clampedOffset !== offset) {
      onOffsetChange(clampedOffset);
    }
  }, [windowed, clampedOffset, offset, onOffsetChange]);

  const body = (
    // 传了 height 即硬上限：外层固定高度（无滚动条路径以前无约束，内容超高直接撑开页面）。
    // 内容侧由调用方按 maxVisible/行预算切片保证装得下，这里是第二道防线。
    <Box flexDirection="column" flexGrow={1} height={propHeight}>
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
  /**
   * 钳制到末项（offset 上限取 totalItems - 1 而不是 totalItems - maxVisible）。
   * 行预算窗口场景用：窗口按行装、末卡可能很矮，标称 maxVisible 会误判，
   * 导致末尾几张卡永远滚不到。用本项后 scrollToBottom 停在末卡。
   */
  clampToLastItem?: boolean;
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
  clampToLastItem = false,
}: UseScrollOptions): UseScrollResult {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const availableHeight = height ?? terminalRows;
  // 与 ScrollableBox 组件同一套窗口数学（含指示器占行预留）：
  // 组件会把 ▲/▼ 各占 1 行从 height 里扣掉，hook 若按裸 height 算 maxVisible，
  // reveal/滚动数学用的窗口就比实际渲染窗口大 → 选中行被算成"已可见"却画不出。
  const rawVisible = Math.max(1, Math.floor(availableHeight / itemHeight));
  const rawClamped = Math.max(0, Math.min(initialOffset, Math.max(0, totalItems - rawVisible)));
  const reservedRows = (rawClamped > 0 ? 1 : 0) + (rawClamped + rawVisible < totalItems ? 1 : 0);
  const maxVisible = Math.max(1, rawVisible - reservedRows);
  // offset 上限：默认按屏装（total - maxVisible）；行预算窗口按末卡钳制
  const maxOffset = clampToLastItem ? Math.max(0, totalItems - 1) : Math.max(0, totalItems - maxVisible);

  const [offset, setOffset] = React.useState(initialOffset);

  // 边界检查后的偏移量
  const clampedOffset = Math.max(0, Math.min(offset, maxOffset));

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
      setOffset((prev) => Math.min(maxOffset, prev + delta));
    },
    [totalItems, maxVisible, maxOffset],
  );

  const scrollToTop = React.useCallback(() => {
    setOffset(0);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    setOffset(maxOffset);
  }, [maxOffset]);

  // Live tail 跟随：仅当“列表变长且之前已钉底”时跟到新底部。
  // 程序化跳转（offset 单独变化，如 ] 错误跳转 / Enter 定位）不扰动；
  // 历史区阅读中途来新数据也不抢夺视口。
  // 钉底 = offset 已达上一帧的 maxOffset（clampToLastItem 时即末条 total-1；等高
  // 模型时即 total-maxVisible）。旧式的 `>= total - maxVisible - 2` 放 2 行余量在
  // 名义 maxVisible 上：行预算卡片流里名义值远小于真实窗口，列表一短就恒判钉底，
  // transcript 加入等"数据变长"会把阅读位置错误拽到尾部（offset=0 也命中）。
  const followRef = React.useRef({ total: totalItems, offset });
  React.useEffect(() => {
    const prev = followRef.current;
    const grew = totalItems > prev.total && prev.total > 0;
    if (grew) {
      const prevMax = clampToLastItem
        ? Math.max(0, prev.total - 1)
        : Math.max(0, prev.total - maxVisible);
      const wasPinned = prev.offset >= prevMax;
      if (wasPinned) {
        setOffset(maxOffset);
      }
    }
    followRef.current = { total: totalItems, offset };
  }, [totalItems, offset, maxVisible, maxOffset, clampToLastItem]);

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
