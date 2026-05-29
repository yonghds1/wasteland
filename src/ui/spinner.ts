/**
 * Spinner - CLI 加载指示器
 *
 * 提供多种动画风格的 Spinner：
 * - dots: Braille 字符动画
 * - grow: 增长条动画
 * - brain: 思考动画
 */

import { t } from "../locales/index.js";
import { ANSI } from "./terminal-theme.js";

// ============================================================
// Spinner 帧定义
// ============================================================

export const SPINNERS = {
  /** Braille 点动画 */
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],

  /** 增长条 */
  grow: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],

  /** 箭头旋转 */
  arrows: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],

  /** 星星闪烁 */
  star: ["✶", "✷", "✸", "✹", "✺", "✹", "✸", "✷"],

  /** 月相变化 */
  moon: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],

  /** 脉冲 */
  pulse: ["◜", "◠", "◝", "◞", "◡", "◟"],

  /** 思考 (brain) */
  brain: ["🧠", "💭", "💡", "✨", "💫", "🌟", "💡", "💭"],

  /** 闪烁 */
  sparkle: ["⁺", "˚", "*", "✧", "✦", "✧", "*", "˚"],
} as const;

export type SpinnerStyle = keyof typeof SPINNERS;

// ============================================================
// 思考动词
// ============================================================

export const THINKING_VERBS = [
  t("ui.spinner.thinking"),
  t("ui.spinner.analyzing"),
  t("ui.spinner.processing"),
  t("ui.spinner.generating"),
  t("ui.spinner.reasoning"),
  t("ui.spinner.computing"),
  t("ui.spinner.understanding"),
  t("ui.spinner.preparing"),
];

// ============================================================
// Spinner 状态
// ============================================================

interface SpinnerState {
  frame: number;
  verb: number;
  startTime: number;
}

// ============================================================
// Spinner 类
// ============================================================

export class Spinner {
  private state: SpinnerState;
  private style: SpinnerStyle;
  private frames: readonly string[];
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(style: SpinnerStyle = "dots") {
    this.style = style;
    this.frames = SPINNERS[style];
    this.state = {
      frame: 0,
      verb: 0,
      startTime: Date.now(),
    };
  }

  /**
   * 获取当前帧
   */
  getFrame(): string {
    return this.frames[this.state.frame];
  }

  /**
   * 获取当前思考动词
   */
  getVerb(): string {
    return THINKING_VERBS[this.state.verb];
  }

  /**
   * 获取经过时间
   */
  getElapsed(): string {
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    return `${elapsed.toFixed(1)}s`;
  }

  /**
   * 推进到下一帧
   */
  tick(): void {
    this.state.frame = (this.state.frame + 1) % this.frames.length;
    // 每 10 帧切换一次动词
    if (this.state.frame === 0) {
      this.state.verb = (this.state.verb + 1) % THINKING_VERBS.length;
    }
  }

  /**
   * 渲染当前帧 (带颜色)
   */
  render(color: string = ANSI.cyan): string {
    const frame = this.getFrame();
    const verb = this.getVerb();
    const elapsed = this.getElapsed();
    return `${color}${frame}${ANSI.reset} ${verb} (${elapsed})`;
  }

  /**
   * 渲染简洁版本 (只有帧和耗时)
   */
  renderSimple(color: string = ANSI.cyan): string {
    const frame = this.getFrame();
    const elapsed = this.getElapsed();
    return `${color}${frame}${ANSI.reset} (${elapsed})`;
  }

  /**
   * 开始自动动画
   */
  start(callback: (rendered: string) => void, intervalMs: number = 80): void {
    this.stop();
    this.state.startTime = Date.now();
    this.interval = setInterval(() => {
      this.tick();
      callback(this.render());
    }, intervalMs);
  }

  /**
   * 停止动画
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.stop();
    this.state = {
      frame: 0,
      verb: 0,
      startTime: Date.now(),
    };
  }
}

// ============================================================
// 工具调用完成行格式
// ============================================================

/**
 * 格式: ┊ {emoji} {verb:9} {detail}  {duration}
 */
export function formatToolCompleteLine(params: {
  toolName: string;
  detail?: string;
  duration: string;
  success: boolean;
}): string {
  const { toolName, detail, duration, success } = params;

  // 工具图标映射
  const TOOL_ICONS: Record<string, string> = {
    "read-file": "📖",
    "read_file": "📖",
    "write-file": "✍️",
    "write_file": "✍️",
    "edit-file": "✏️",
    "edit_file": "✏️",
    bash: "💻",
    terminal: "💻",
    "search-files": "🔎",
    search_files: "🔎",
    "web-search": "🔍",
    web_search: "🔍",
  };

  // 工具动词映射
  const TOOL_VERBS: Record<string, string> = {
    "read-file": "read",
    "read_file": "read",
    "write-file": "write",
    "write_file": "write",
    "edit-file": "edit",
    "edit_file": "edit",
    bash: "exec",
    terminal: "exec",
    "search-files": "find",
    search_files: "find",
    "web-search": "search",
    web_search: "search",
  };

  const icon = TOOL_ICONS[toolName] || "⚡";
  const verb = (TOOL_VERBS[toolName] || toolName).padEnd(9);
  const color = success ? ANSI.green : ANSI.red;

  let line = `${ANSI.dim}┊${ANSI.reset} ${icon} ${color}${verb}${ANSI.reset}`;
  if (detail) {
    line += ` ${detail.slice(0, 42)}${detail.length > 42 ? "..." : ""}`;
  }
  line += `  ${ANSI.dim}${duration}${ANSI.reset}`;

  if (!success) {
    line += ` ${ANSI.red}[failed]${ANSI.reset}`;
  }

  return line;
}

// ============================================================
// 会话欢迎/告别消息
// ============================================================

/**
 * 格式化欢迎消息
 */
export function formatWelcomeMessage(): string {
  const lines = [
    `${ANSI.dim}╭${"─".repeat(48)}╮${ANSI.reset}`,
    `${ANSI.dim}│${ANSI.reset} ${ANSI.bold}${ANSI.cyan}✦ wasteland - Immortan Joe's War Machine${" ".repeat(12)}${ANSI.reset}${ANSI.dim}│${ANSI.reset}`,
    `${ANSI.dim}│${ANSI.reset}   ${t("ui.spinner.welcome")}${" ".repeat(12)}${ANSI.dim}│${ANSI.reset}`,
    `${ANSI.dim}╰${"─".repeat(48)}╯${ANSI.reset}`,
  ];
  return lines.join("\n");
}

/**
 * 格式化告别消息
 */
export function formatGoodbyeMessage(): string {
  const lines = [
    "",
    `${ANSI.dim}╭${"─".repeat(48)}╮${ANSI.reset}`,
    `${ANSI.dim}│${ANSI.reset} ${ANSI.bold}${ANSI.green}${t("ui.spinner.goodbye")} ✦${" ".repeat(38)}${ANSI.reset}${ANSI.dim}│${ANSI.reset}`,
    `${ANSI.dim}╰${"─".repeat(48)}╯${ANSI.reset}`,
  ];
  return lines.join("\n");
}
