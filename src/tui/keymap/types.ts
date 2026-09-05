/**
 * keymap/types.ts - 键盘映射与分发类型定义
 */

import type { Key } from "ink";

/**
 * 键盘作用域/层级
 * 优先级从高到低：
 * 1. modal: 模态框/退出确认/全屏帮助对话框（独占处理，最高优先级）
 * 2. focus: 当前聚焦组件专属按键（如 ChatInputBar 打字、AgentTabs 选 Agent）
 * 3. navigation: 全局导航与控制快捷键（如 Shift+Tab 权限轮换、T 换页、Esc 焦点切换）
 */
export type KeyScope = "modal" | "focus" | "navigation";

/**
 * 按键组合匹配结构
 */
export interface KeyCombo {
  /** 主键名称（如 "c", "t", "v", "escape", "return", "tab", "backspace", "upArrow", "downArrow", "leftArrow", "rightArrow"） */
  key?: string;
  /** 控制键 */
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  /** 原始 ANSI 字符串精确匹配（如 "\x1b[Z" 代表 Shift+Tab） */
  rawInput?: string;
}

/**
 * 快捷键定义项
 */
export interface KeybindingDefinition {
  /** 唯一动作标识（如 "app.cycle_permissions", "chat.send"） */
  id: string;
  /** 绑定的按键组合（支持多个别名/组合） */
  combos: KeyCombo[];
  /** 所属层级 */
  scope: KeyScope;
  /** 描述（用于生成帮助栏/菜单） */
  description: string;
  /** 所属组件/区域过滤（当 scope === "focus" 时匹配 focusArea） */
  targetArea?: string;
}

/**
 * 用户自定义快捷键文件格式 (~/.wasteland/keybindings.json)
 */
export interface UserKeybindingsConfig {
  /** key: action ID, value: 快捷键组合描述（如 "shift+tab", "ctrl+c", "alt+enter"） */
  bindings?: Record<string, string | string[]>;
}

/**
 * 按键事件上下文
 */
export interface KeyHandlerContext {
  input?: string;
  key?: Key;
  /** 当前聚焦区域 */
  focusArea?: string | null;
  /** 是否处于输入模式 */
  inputMode?: boolean;
  /** 是否存在打开的模态框 */
  activeModal?: string | null;
}
