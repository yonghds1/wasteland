/**
 * CLI 颜色常量定义
 *
 * 用于终端 CLI 输出的 ANSI 颜色常量。
 * 从主题系统获取颜色配置。
 *
 * 注意：
 * - TUI 组件使用 ink 颜色名（见 tui/utils/colors.ts）
 * - CLI 输出使用 ANSI 转义码（本文件）
 * - 均尊重 NO_COLOR 环境变量
 */

import { ANSI } from "./terminal-theme.js";
import { theme } from "./themes/index.js";

// ============================================================
// True-color 颜色转换
// ============================================================

/** 将 hex 转换为 true-color ANSI 前景色 */
function hexToFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** 将 hex 转换为 true-color ANSI 前景色 (bold) */
function hexToFgBold(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[1;38;2;${r};${g};${b}m`;
}

// ============================================================
// Primary Colors (from theme)
// ============================================================

/** Primary accent color */
export const PRIMARY = hexToFgBold(theme.primary);

/** Secondary accent color */
export const SECONDARY = hexToFgBold(theme.secondary);

/** Muted/dim text color */
export const MUTED = hexToFg(theme.muted);

/** Border and divider color */
export const BORDER = hexToFg(theme.border);

// ============================================================
// Status Colors (from theme)
// ============================================================

/** Success color */
export const SUCCESS = hexToFgBold(theme.success);

/** Error color */
export const ERROR = hexToFgBold(theme.error);

/** Warning color */
export const WARNING = hexToFgBold(theme.warning);

/** Info color */
export const INFO = hexToFgBold(theme.info);

// ============================================================
// Message Type Colors (from theme)
// ============================================================

/** User message color - cyan */
export const USER_COLOR = ANSI.cyan;

/** Assistant message color - green */
export const ASSISTANT_COLOR = ANSI.green;

/** Tool message color - magenta */
export const TOOL_COLOR = ANSI.magenta;

/** System message color - dim */
export const SYSTEM_COLOR = ANSI.dim;

// ============================================================
// UI Element Colors
// ============================================================

/** Prompt symbol color */
export const PROMPT_COLOR = PRIMARY;

/** Input rule color */
export const INPUT_RULE_COLOR = BORDER;

/** Tool prefix character */
export const TOOL_PREFIX = "┊";

/** Message separator line */
export const MESSAGE_SEPARATOR = "─".repeat(48);

// ============================================================
// Message Prefixes (from theme)
// ============================================================

/** User message prefix */
export const USER_PREFIX = theme.prefix.user;

/** Assistant message prefix */
export const ASSISTANT_PREFIX = theme.prefix.assistant;

/** System message prefix */
export const SYSTEM_PREFIX = theme.prefix.system;

// ============================================================
// Color-conditional rendering
// ============================================================

/**
 * 检查是否应该使用颜色
 */
export function shouldUseColor(): boolean {
  // NO_COLOR 环境变量
  if (process.env.NO_COLOR) {
    return false;
  }

  // FORCE_COLOR 环境变量
  if (process.env.FORCE_COLOR === "0") {
    return false;
  }

  // TTY 检查
  return process.stdout.isTTY ?? false;
}

/**
 * 条件性应用颜色
 */
export function colorize(text: string, ...codes: string[]): string {
  if (!shouldUseColor() || codes.length === 0) {
    return text;
  }
  return `${codes.join("")}${text}${ANSI.reset}`;
}
