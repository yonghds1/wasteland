// ============================================================
// ANSI 转义码
// ============================================================

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // 前景色
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // 亮色
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // 背景色
  bgGray: "\x1b[100m",

  // 光标控制
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  clearLineRight: "\x1b[0K",
  cursorUp: "\x1b[1A",
  cursorDown: "\x1b[1B",
} as const;

// ============================================================
// Agent 深度颜色映射
// ============================================================

/** 根据深度获取颜色 */
export function getDepthColor(depth: number): string {
  const colors = [
    ANSI.cyan,      // depth 0: 主 Agent
    ANSI.magenta,   // depth 1: 一级子 Agent
    ANSI.yellow,    // depth 2: 二级子 Agent
    ANSI.green,     // depth 3: 三级子 Agent
    ANSI.blue,      // depth 4+
  ];
  return colors[Math.min(depth, colors.length - 1)];
}

/** 根据深度获取标签前缀 */
export function getDepthPrefix(depth: number, name?: string): string {
  if (depth === 0) {
    return "rxc";
  }
  const indent = "  ".repeat(depth - 1);
  const arrow = depth === 1 ? "└─" : "  └─";
  return `${indent}${arrow} ${name ?? "child"}`;
}

// ============================================================
// Spinner 动画
// ============================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let spinnerIndex = 0;

export function getSpinnerFrame(): string {
  const frame = SPINNER_FRAMES[spinnerIndex];
  spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
  return frame;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_PANEL_WIDTH = 24;
const MAX_PANEL_WIDTH = 72;
const STATUS_LABEL_WIDTH = 6;

// ============================================================
// 格式化工具
// ============================================================

export function paint(text: string, ...styles: string[]): string {
  if (styles.length === 0) {
    return text;
  }

  return `${styles.join("")}${text}${ANSI.reset}`;
}

export const PANEL_GUTTER = `${paint("│", ANSI.dim, ANSI.gray)}  `;

export function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function resolvePanelWidth(columns?: number): number {
  const terminalColumns = resolveTerminalWidth(columns);

  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, terminalColumns - 8));
}

export function resolveTerminalWidth(columns?: number): number {
  return typeof columns === "number" && Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_TERMINAL_COLUMNS;
}

export function formatStatusLabel(label: string): string {
  return label.padEnd(STATUS_LABEL_WIDTH, " ");
}

export function wrapText(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => wrapLine(line, width))
    .join("\n");
}

function wrapLine(line: string, width: number): string {
  if (line.length === 0) {
    return "";
  }

  const chars = Array.from(line);
  const chunks: string[] = [];

  for (let index = 0; index < chars.length; index += width) {
    chunks.push(chars.slice(index, index + width).join(""));
  }

  return chunks.join("\n");
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * 创建当前时间戳
 */
export function createDisplayTimestamp(): string {
  return formatTimestamp(new Date().toISOString());
}

/**
 * 格式化耗时
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60000).toFixed(1)}m`;
}
