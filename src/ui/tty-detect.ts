/**
 * TTY 环境检测与适配
 *
 * 根据 TTY 环境动态调整输出样式：
 * - TTY 模式：彩色、交互式、TUI 可用
 * - 非 TTY 模式：纯文本、无 ANSI、简化输出
 */

import { Writable } from "node:stream";

// ============================================================
// 类型定义
// ============================================================

export interface TTYContext {
  /** 是否在交互式终端 */
  isInteractive: boolean;
  /** stdout 是否是 TTY */
  stdoutIsTTY: boolean;
  /** stdin 是否是 TTY */
  stdinIsTTY: boolean;
  /** stderr 是否是 TTY */
  stderrIsTTY: boolean;
  /** 终端宽度（列数） */
  columns: number;
  /** 终端高度（行数） */
  rows: number;
  /** 是否支持颜色 */
  supportsColor: boolean;
  /** 是否支持 Unicode */
  supportsUnicode: boolean;
}

// ============================================================
// 检测函数
// ============================================================

/**
 * 检测当前 TTY 环境
 */
export function detectTTY(params?: {
  stdout?: Writable;
  stdin?: NodeJS.ReadStream;
  stderr?: Writable;
}): TTYContext {
  const stdout = params?.stdout ?? process.stdout;
  const stdin = params?.stdin ?? process.stdin;
  const stderr = params?.stderr ?? process.stderr;

  const stdoutIsTTY = "isTTY" in stdout && stdout.isTTY === true;
  const stdinIsTTY = "isTTY" in stdin && stdin.isTTY === true;
  const stderrIsTTY = "isTTY" in stderr && stderr.isTTY === true;

  // 交互模式：stdin 和 stdout 都是 TTY
  const isInteractive = stdinIsTTY && stdoutIsTTY;

  // 获取终端尺寸
  const columns = "columns" in stdout && typeof stdout.columns === "number"
    ? stdout.columns
    : 80;
  const rows = "rows" in stdout && typeof stdout.rows === "number"
    ? stdout.rows
    : 24;

  // 颜色支持检测
  const supportsColor = detectColorSupport(stdout);

  // Unicode 支持检测
  const supportsUnicode = detectUnicodeSupport();

  return {
    isInteractive,
    stdoutIsTTY,
    stdinIsTTY,
    stderrIsTTY,
    columns,
    rows,
    supportsColor,
    supportsUnicode,
  };
}

/**
 * 检测颜色支持
 */
function detectColorSupport(stream: Writable): boolean {
  if (!("isTTY" in stream) || stream.isTTY !== true) {
    return false;
  }

  // 检查 FORCE_COLOR 环境变量
  if (process.env.FORCE_COLOR === "0") {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }

  // 检查 NO_COLOR 环境变量
  if (process.env.NO_COLOR) {
    return false;
  }

  // 检查 COLORTERM
  if (process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit") {
    return true;
  }

  // 检查 TERM
  const term = process.env.TERM ?? "";
  if (term.includes("color") || term.includes("256")) {
    return true;
  }

  // 默认假设支持基本颜色
  return true;
}

/**
 * 检测 Unicode 支持
 */
function detectUnicodeSupport(): boolean {
  // Windows 默认不支持 Unicode（除非使用 Windows Terminal）
  if (process.platform === "win32") {
    return process.env.WT_SESSION !== undefined || process.env.TERM_PROGRAM === "vscode";
  }

  // Unix-like 系统默认支持
  return true;
}

// ============================================================
// 样式适配器
// ============================================================

/**
 * 创建样式适配器
 *
 * 根据 TTY 环境决定是否使用 ANSI 样式
 */
export function createStyleAdapter(tty: TTYContext) {
  return {
    /**
     * 条件性应用 ANSI 样式
     */
    style(text: string, ...styles: string[]): string {
      if (!tty.supportsColor || styles.length === 0) {
        return text;
      }
      return `${styles.join("")}${text}\x1b[0m`;
    },

    /**
     * 获取符号（根据 Unicode 支持）
     */
    get symbol() {
      return {
        check: tty.supportsUnicode ? "✓" : "[OK]",
        cross: tty.supportsUnicode ? "✗" : "[X]",
        arrow: tty.supportsUnicode ? "→" : "->",
        bullet: tty.supportsUnicode ? "●" : "*",
        pointer: tty.supportsUnicode ? "▶" : ">",
        spinner: tty.supportsUnicode
          ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
          : ["-", "\\", "|", "/"],
      };
    },

    /**
     * 获取颜色
     */
    get color() {
      return tty.supportsColor
        ? {
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m",
            white: "\x1b[37m",
            gray: "\x1b[90m",
            reset: "\x1b[0m",
            bold: "\x1b[1m",
            dim: "\x1b[2m",
          }
        : {
            red: "",
            green: "",
            yellow: "",
            blue: "",
            magenta: "",
            cyan: "",
            white: "",
            gray: "",
            reset: "",
            bold: "",
            dim: "",
          };
    },

    /**
     * 格式化标签
     */
    label(text: string, color?: string): string {
      if (!tty.supportsColor) {
        return `[${text}]`;
      }
      const label = text.padEnd(5, " ");
      if (color) {
        return `${color}${label}\x1b[0m`;
      }
      return label;
    },

    /**
     * 格式化时间戳
     */
    timestamp(date?: Date): string {
      const now = date ?? new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      if (!tty.supportsColor) {
        return `[${time}]`;
      }
      return `\x1b[90m[${time}]\x1b[0m`;
    },
  };
}

// ============================================================
// 预设样式适配器
// ============================================================

/** 默认 TTY 上下文 */
export const defaultTTY = detectTTY();

/** 默认样式适配器 */
export const defaultStyle = createStyleAdapter(defaultTTY);
