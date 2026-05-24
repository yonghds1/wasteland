/**
 * CLI 颜色常量定义 (Hermes 风格)
 *
 * 用于终端 CLI 输出的 ANSI 颜色常量。
 * 基于 Hermes default skin 的颜色方案。
 *
 * 注意：
 * - TUI 组件使用 ink 颜色名（见 tui/utils/colors.ts）
 * - CLI 输出使用 ANSI 转义码（本文件）
 * - 均尊重 NO_COLOR 环境变量
 */

import { ANSI } from "./terminal-theme.js";

// ============================================================
// True-color 颜色 (Hermes default skin)
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

/** 将 hex 转换为 true-color ANSI 背景色 */
function hexToBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
}

// ============================================================
// Primary Colors
// ============================================================

/** Gold - primary accent (#FFD700) */
export const GOLD = hexToFgBold("#FFD700");

/** Amber - secondary accent (#FFBF00) */
export const AMBER = hexToFgBold("#FFBF00");

/** Bronze - borders and dividers (#CD7F32) */
export const BRONZE = hexToFg("#CD7F32");

/** Dark goldenrod - dim/muted text (#B8860B) */
export const DARK_GOLDENROD = hexToFg("#B8860B");

/** Goldenrod - labels (#DAA520) */
export const GOLDENROD = hexToFg("#DAA520");

/** Cornsilk - body text (#FFF8DC) */
export const CORNSILK = hexToFg("#FFF8DC");

// ============================================================
// Status Colors
// ============================================================

/** Success green (#4caf50) */
export const SUCCESS = hexToFgBold("#4caf50");

/** Error red (#ef5350) */
export const ERROR = hexToFgBold("#ef5350");

/** Warning orange (#ffa726) */
export const WARNING = hexToFgBold("#ffa726");

// ============================================================
// Message Type Colors
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
export const PROMPT_COLOR = GOLD;

/** Input rule color */
export const INPUT_RULE_COLOR = BRONZE;

/** Tool prefix character */
export const TOOL_PREFIX = "┊";

/** Message separator line */
export const MESSAGE_SEPARATOR = "─".repeat(48);

// ============================================================
// Message Prefixes
// ============================================================

/** User message prefix */
export const USER_PREFIX = "❯";

/** Assistant message prefix */
export const ASSISTANT_PREFIX = "✦";

/** System message prefix */
export const SYSTEM_PREFIX = "ℹ";

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
