/**
 * 焦点管理器 - 统一管理 TUI 焦点逻辑
 *
 * 职责：
 * 1. 焦点区域配置（添加新区域只需修改配置）
 * 2. 焦点状态管理
 * 3. 键盘事件处理
 */

import { useState, useCallback, useMemo } from "react";
import type { PageName } from "../context/AppContext.js";

// ============================================================
// 区域配置
// ============================================================

export interface AreaCapabilities {
  scrollable?: boolean;      // 方向键滚动
  navigable?: boolean;       // 方向键切换页面
  inputable?: boolean;       // 输入区域
  interactive?: boolean;     // 交互区域
}

export interface AreaConfig {
  id: string;
  label: string;
  capabilities: AreaCapabilities;
}

export interface PageConfig {
  areas: AreaConfig[];
}

// 页面配置表（添加新区域只需修改此处）
export const PAGE_CONFIGS: Record<PageName, PageConfig> = {
  session: {
    areas: [
      { id: "header", label: "顶部导航", capabilities: { navigable: true } },
      { id: "agentTree", label: "Agent 树", capabilities: {} },
      { id: "messageList", label: "消息列表", capabilities: { scrollable: true } },
      { id: "inputBar", label: "输入框", capabilities: { inputable: true } },
    ],
  },
  debug: {
    areas: [
      { id: "header", label: "顶部导航", capabilities: { navigable: true } },
      { id: "sessionInfo", label: "Session 信息", capabilities: {} },
      { id: "traceLog", label: "日志列表", capabilities: { scrollable: true } },
    ],
  },
  config: {
    areas: [
      { id: "header", label: "顶部导航", capabilities: { navigable: true } },
      { id: "configList", label: "配置列表", capabilities: { interactive: true } },
    ],
  },
};

// ============================================================
// 类型
// ============================================================

export type FocusArea = string | null;

// ============================================================
// 焦点管理器 Hook
// ============================================================

export interface FocusManager {
  // 状态
  focusArea: FocusArea;
  inputMode: boolean;

  // 查询
  isFocused: (areaId: string) => boolean;
  getBorderColor: (areaId: string) => string;
  hasCapability: (areaId: FocusArea, capability: keyof AreaCapabilities) => boolean;

  // 操作
  setFocusArea: (area: FocusArea) => void;
  enterInputMode: () => void;
  exitInputMode: () => void;
  clearFocus: () => void;

  // 键盘处理
  handleKeyDown: (input: string, key: {
    tab?: boolean;
    shift?: boolean;
    escape?: boolean;
    return?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
  }) => boolean; // 返回 true 表示已处理

  // 页面切换
  onPageChange: (page: PageName) => void;
}

export interface UseFocusManagerOptions {
  currentPage: PageName;
  onPageChange?: (page: PageName) => void;
  onSendMessage?: () => void;
}

export function useFocusManager(options: UseFocusManagerOptions): FocusManager {
  const { currentPage, onPageChange, onSendMessage } = options;

  // 状态
  const [focusArea, setFocusAreaState] = useState<FocusArea>(null);
  const [inputMode, setInputMode] = useState(false);

  // 获取当前页面的区域列表
  const areas = useMemo(() => PAGE_CONFIGS[currentPage]?.areas ?? [], [currentPage]);

  // 获取区域配置
  const getAreaConfig = useCallback((areaId: FocusArea): AreaConfig | null => {
    if (areaId === null) return null;
    return areas.find(a => a.id === areaId) ?? null;
  }, [areas]);

  // 检查区域能力
  const hasCapability = useCallback((areaId: FocusArea, capability: keyof AreaCapabilities): boolean => {
    const config = getAreaConfig(areaId);
    return config?.capabilities[capability] === true;
  }, [getAreaConfig]);

  // 判断是否聚焦
  const isFocused = useCallback((areaId: string): boolean => {
    return focusArea === areaId;
  }, [focusArea]);

  // 获取边框颜色
  const getBorderColor = useCallback((areaId: string): string => {
    return focusArea === areaId ? "cyan" : "gray";
  }, [focusArea]);

  // 设置焦点
  const setFocusArea = useCallback((area: FocusArea) => {
    setFocusAreaState(area);

    // 如果是输入区域，自动进入输入模式
    if (area && hasCapability(area, "inputable")) {
      setInputMode(true);
    } else {
      // 离开输入区域时，退出输入模式
      setInputMode(false);
    }
  }, [hasCapability]);

  // 进入输入模式
  const enterInputMode = useCallback(() => {
    const inputArea = areas.find(a => a.capabilities.inputable);
    if (inputArea) {
      setFocusArea(inputArea.id);
    }
  }, [areas, setFocusArea]);

  // 退出输入模式
  const exitInputMode = useCallback(() => {
    setInputMode(false);
    setFocusAreaState(null); // Esc 失焦
  }, []);

  // 清除焦点
  const clearFocus = useCallback(() => {
    setFocusAreaState(null);
    setInputMode(false);
  }, []);

  // 获取下一个焦点
  const getNextFocus = useCallback((reverse: boolean): string | null => {
    if (focusArea === null) {
      return areas[0]?.id ?? null;
    }

    const currentIndex = areas.findIndex(a => a.id === focusArea);
    if (currentIndex === -1) {
      return areas[0]?.id ?? null;
    }

    const nextIndex = reverse
      ? (currentIndex - 1 + areas.length) % areas.length
      : (currentIndex + 1) % areas.length;

    return areas[nextIndex]?.id ?? null;
  }, [focusArea, areas]);

  // 键盘处理
  const handleKeyDown = useCallback((input: string, key: {
    tab?: boolean;
    shift?: boolean;
    escape?: boolean;
    return?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
  }): boolean => {
    // 输入模式下的处理
    if (inputMode) {
      // Tab 切换焦点
      if (key.tab) {
        const nextFocus = getNextFocus(key.shift ?? false);
        if (nextFocus) setFocusArea(nextFocus);
        return true;
      }
      // Esc 退出输入模式并失焦
      if (key.escape) {
        exitInputMode();
        return true;
      }
      // Enter 发送消息（由 InputBar 处理，这里不拦截）
      return false;
    }

    // 非输入模式下

    // Esc 失焦
    if (key.escape) {
      clearFocus();
      return true;
    }

    // Tab 切换焦点
    if (key.tab) {
      const nextFocus = getNextFocus(key.shift ?? false);
      if (nextFocus) setFocusArea(nextFocus);
      return true;
    }

    // Enter 进入输入模式（在 session 页面）
    if (key.return && currentPage === "session") {
      if (focusArea === null || focusArea === "header") {
        enterInputMode();
        return true;
      }
    }

    // 导航区域的方向键
    if (focusArea && hasCapability(focusArea, "navigable")) {
      if (key.leftArrow || key.rightArrow) {
        const pages: PageName[] = ["session", "debug", "config"];
        const currentIdx = pages.indexOf(currentPage);
        const nextIdx = key.leftArrow
          ? (currentIdx - 1 + pages.length) % pages.length
          : (currentIdx + 1) % pages.length;
        onPageChange?.(pages[nextIdx]);
        return true;
      }
    }

    return false;
  }, [inputMode, focusArea, currentPage, getNextFocus, setFocusArea, exitInputMode, clearFocus, enterInputMode, hasCapability, onPageChange]);

  // 页面切换时清除焦点
  const handlePageChange = useCallback((_page: PageName) => {
    // 保持焦点，不清除
    // 如果需要切换页面时清除焦点，可以调用 clearFocus()
  }, []);

  return {
    focusArea,
    inputMode,
    isFocused,
    getBorderColor,
    hasCapability,
    setFocusArea,
    enterInputMode,
    exitInputMode,
    clearFocus,
    handleKeyDown,
    onPageChange: handlePageChange,
  };
}
