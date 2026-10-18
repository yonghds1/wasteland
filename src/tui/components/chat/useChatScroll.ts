import React, { useState, useEffect, useRef } from 'react';
import { useInput } from 'ink';
import { useMouseWheel } from '../../mouse/useMouseWheel.js';
import { countNewLines } from '../chat-message-utils.js';

export interface UseChatScrollProps {
  totalLines: number;
  availableHeight: number;
  width: number;
  inputMode: boolean;
  setShowDetails: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UseChatScrollReturn {
  scrollOffset: number;
  clampedOffset: number;
  maxOffset: number;
  stickToBottom: boolean;
  showTopHint: boolean;
  pendingNew: number;
  contentLineBudget: number;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setStickToBottom: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * useChatScroll - 聊天视口滚动状态机与交互管理 Hook
 *
 * 职责：
 * 1. 自动滚底跟随 (stickToBottom)
 * 2. 键盘导航 (PageUp/Down, Shift+Up/Down, Ctrl+U/D, Home/End)
 * 3. 鼠标滚轮与右侧滚动条拖拽
 * 4. 未读新行统计 (pendingNew) 与顶部历史行提示 (showTopHint)
 */
export function useChatScroll({
  totalLines,
  availableHeight,
  width,
  inputMode,
  setShowDetails,
}: UseChatScrollProps): UseChatScrollReturn {
  const maxOffset = Math.max(0, totalLines - availableHeight);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  // 1. 自动滚底跟随：当总行数变大且处于钉底模式时，平滑追赶到底部
  useEffect(() => {
    if (stickToBottom) {
      setScrollOffset(maxOffset);
    }
  }, [totalLines, maxOffset, stickToBottom]);

  const isDraggingScrollbarRef = useRef(false);

  // 2. 鼠标滚轮与滚动条拖拽监听
  useMouseWheel({
    enabled: true,
    onWheelUp: () => {
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - 3));
    },
    onWheelDown: () => {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + 3);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
    },
    onMouseDown: (x: number, y: number) => {
      // 仅在右侧滚动条区域（x >= width - 2）且在视口垂直范围内激活滑块拖拽与跳转
      if (x >= width - 2 && y >= 2 && y <= 1 + availableHeight) {
        isDraggingScrollbarRef.current = true;
        const relY = Math.max(0, Math.min(y - 2, availableHeight - 1));
        const ratio = relY / Math.max(1, availableHeight - 1);
        const targetOffset = Math.round(ratio * maxOffset);
        setScrollOffset(targetOffset);
        setStickToBottom(targetOffset >= maxOffset);
      }
    },
    onMouseDrag: (_x: number, y: number) => {
      if (!isDraggingScrollbarRef.current) return;
      const relY = Math.max(0, Math.min(y - 2, availableHeight - 1));
      const ratio = relY / Math.max(1, availableHeight - 1);
      const targetOffset = Math.round(ratio * maxOffset);
      setScrollOffset(targetOffset);
      setStickToBottom(targetOffset >= maxOffset);
    },
    onMouseUp: () => {
      isDraggingScrollbarRef.current = false;
    },
  });

  // 3. 键盘翻页监听
  useInput((input, key) => {
    const halfPage = Math.max(1, Math.floor(availableHeight / 2));

    // Ctrl+T: 切换工具详情/折叠
    if (key.ctrl && (input === 't' || input === 'T')) {
      setShowDetails((cur) => !cur);
      return;
    }

    // Home / End 仅在非输入模式下生效
    if (key.home && !inputMode) {
      setStickToBottom(false);
      setScrollOffset(0);
      return;
    }
    if (key.end && !inputMode) {
      setStickToBottom(true);
      setScrollOffset(maxOffset);
      return;
    }

    // PageUp / Ctrl+U
    if (key.pageUp || (!inputMode && key.ctrl && input === 'u')) {
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - halfPage));
      return;
    }

    // PageDown / Ctrl+D
    if (key.pageDown || (!inputMode && key.ctrl && input === 'd')) {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + halfPage);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
      return;
    }

    // Shift + ↑ 微调向上 3 行
    if (key.shift && key.upArrow) {
      setStickToBottom(false);
      setScrollOffset((prev) => Math.max(0, prev - 3));
      return;
    }

    // Shift + ↓ 微调向下 3 行
    if (key.shift && key.downArrow) {
      setScrollOffset((prev) => {
        const next = Math.min(maxOffset, prev + 3);
        if (next >= maxOffset) setStickToBottom(true);
        return next;
      });
      return;
    }
  });

  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const showTopHint = clampedOffset > 0;
  const maxDisplayLines = showTopHint ? Math.max(1, availableHeight - 1) : availableHeight;
  const pendingNew = countNewLines(totalLines, clampedOffset, maxDisplayLines, stickToBottom);
  const contentLineBudget = pendingNew > 0 ? Math.max(1, maxDisplayLines - 1) : maxDisplayLines;

  return {
    scrollOffset,
    clampedOffset,
    maxOffset,
    stickToBottom,
    showTopHint,
    pendingNew,
    contentLineBudget,
    setScrollOffset,
    setStickToBottom,
  };
}
