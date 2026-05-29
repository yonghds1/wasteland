/**
 * readline-input.ts - 用户交互输入流
 *
 * 本文件实现了用户输入的 RxJS 封装，支持：
 * - 单次输入模式（命令行参数或管道）
 * - 交互式 REPL 模式
 *
 * ## 核心设计模式
 *
 * ### 1. fromEvent + 操作符链
 * 使用 `fromEvent` 将 Node.js EventEmitter 转换为 Observable，
 * 然后通过操作符链处理过滤、映射、副作用等。
 *
 * ### 2. 数据流向
 * ```
 * 用户输入 → readline "line" 事件
 *              ↓
 *           fromEvent (转为 Observable)
 *              ↓
 *           map (trim)
 *              ↓
 *           tap (处理本地命令)
 *              ↓
 *           filter (过滤空行和命令)
 *              ↓
 *           scan (累积 turn 计数)
 *              ↓
 *           ChatInputTurn 流
 * ```
 */

import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { filter, from, fromEvent, map, scan, takeUntil, tap, type Observable } from "rxjs";

import type { ChatInputTurn } from "../runtime/event-types.js";
import type { SkillExecutor } from "../skills/skill-executor.js";
import {
  ANSI,
  PANEL_GUTTER,
  indentBlock,
  paint,
  resolvePanelWidth,
  wrapText,
} from "./terminal-theme.js";

// ============================================================
// 常量定义
// ============================================================

/** 退出命令集合 */
const EXIT_COMMANDS = new Set(["/exit", "/quit"]);

/** 本地命令集合（不发送给 Agent） */
const LOCAL_COMMANDS = new Set(["/help", "/tools", "/clear", "/skills"]);

// ============================================================
// UI 辅助函数
// ============================================================

/**
 * 创建交互模式欢迎信息
 * @returns 多行欢迎文本
 */
function createInteractiveIntro(): string {
  return [
    paint("wasteland interactive", ANSI.bold, ANSI.cyan),
    paint("Prompt: >    Replies: wasteland", ANSI.bold, ANSI.brightWhite),
    paint("Commands: /help /tools /clear /exit", ANSI.brightWhite),
  ].join("\n");
}

/**
 * 创建本地命令输出格式
 * @param title - 标题
 * @param lines - 内容行
 * @param columns - 终端宽度
 * @returns 格式化后的输出
 */
function createLocalOutput(title: string, lines: string[], columns?: number): string {
  return [
    paint("local", ANSI.bold, ANSI.gray),
    indentBlock(wrapText([title, ...lines].join("\n"), resolvePanelWidth(columns)), PANEL_GUTTER),
  ].join("\n");
}

/**
 * 创建帮助文本
 * @param columns - 终端宽度
 * @returns 帮助信息
 */
function createHelpText(columns?: number): string {
  return createLocalOutput("Session commands", [
    "/help   Show interactive help",
    "/tools  Show current local tool syntax",
    "/skills Show available skills",
    "/clear  Clear the terminal and redraw the header",
    "/exit   Exit interactive mode",
  ], columns);
}

/**
 * 创建工具语法文本
 * @param columns - 终端宽度
 * @returns 工具语法信息
 */
function createToolsText(columns?: number): string {
  return createLocalOutput("Current local tool syntax", ["/read <relative-path>", "/bash <command>"], columns);
}

/**
 * 解析输出流的列宽度
 * @param output - 输出流
 * @returns 列宽度（如果可用）
 */
function resolveOutputColumns(output: Writable): number | undefined {
  return "columns" in output && typeof output.columns === "number" ? output.columns : undefined;
}

// ============================================================
// 类型定义
// ============================================================

/**
 * 交互式输入流的返回结果
 */
export type InteractiveTurnStream = {
  /** 用户输入的 Turn 流 */
  turns$: Observable<ChatInputTurn>;
  /** 显示提示符的函数 */
  prompt: () => void;
  /** 关闭输入流的函数 */
  close: () => void;
  /** 输入流结束的 Promise */
  done: Promise<void>;
};

// ============================================================
// 单次输入模式
// ============================================================

/**
 * 创建单次输入的 Observable
 *
 * 用于非交互模式：
 * - 命令行参数模式 (--message)
 * - 管道输入模式 (stdin pipe)
 *
 * @param message - 用户消息
 * @param source - 输入来源
 * @returns 发出单个 ChatInputTurn 的 Observable
 *
 * @example
 * // 命令行参数
 * const turns$ = createSingleTurnInput("Hello", "message");
 *
 * // 管道输入
 * const turns$ = createSingleTurnInput(pipedContent, "stdin");
 */
export function createSingleTurnInput(
  message: string,
  source: "message" | "stdin",
): Observable<ChatInputTurn> {
  // from: 将数组转换为 Observable，依次发出每个元素
  // 这里只有一个元素，所以发出一次
  return from([
    {
      turn: 1,
      content: message.trim(),
      source,
    } satisfies ChatInputTurn,
  ]);
}

/**
 * 读取管道输入
 *
 * 检测 stdin 是否为 TTY。如果不是 TTY，说明有管道输入。
 *
 * @param stdin - 标准输入流
 * @returns 管道内容，或 null（如果是 TTY）
 *
 * @example
 * // 使用方式
 * // echo "Hello" | rxc chat
 * const pipedContent = await readPipedInput();
 */
export async function readPipedInput(stdin: Readable = process.stdin): Promise<string | null> {
  // TTY 检测：如果 stdin.isTTY 为 true，说明是交互式终端
  // 管道输入时，isTTY 为 undefined 或 false
  if ("isTTY" in stdin && stdin.isTTY) {
    return null;
  }

  // 异步迭代读取所有 chunk
  let content = "";

  for await (const chunk of stdin) {
    content += chunk.toString();
  }

  const trimmed = content.trim();

  return trimmed.length > 0 ? trimmed : null;
}

// ============================================================
// 交互式输入模式
// ============================================================

/**
 * 创建交互式输入流
 *
 * ## 设计模式：fromEvent + 操作符链
 *
 * ```
 * readline "line" 事件
 *      ↓
 * fromEvent<string>  (转为 Observable<string>)
 *      ↓
 * map (trim)         (去除首尾空白)
 *      ↓
 * tap                (处理本地命令：/help, /tools, /clear, /exit)
 *      ↓
 * takeUntil(close$)  (close 事件时结束)
 *      ↓
 * filter             (过滤空行和命令)
 *      ↓
 * scan               (累积 turn 计数)
 *      ↓
 * ChatInputTurn 流
 * ```
 *
 * ## 关键操作符说明
 *
 * - **fromEvent**: 将 EventEmitter 的指定事件转换为 Observable
 *   - 参数1: EventEmitter 对象
 *   - 参数2: 事件名
 *   - 返回: Observable<事件参数>
 *
 * - **map**: 转换每个值
 *   - 这里用于 trim 用户输入
 *
 * - **tap**: 执行副作用，不改变流
 *   - 用于处理本地命令（/help, /tools 等）
 *   - 这些命令不会产生 ChatInputTurn
 *
 * - **takeUntil**: 在另一个 Observable 发出值时结束
 *   - 用于在 close 事件时结束流
 *
 * - **filter**: 过滤值
 *   - 过滤掉空行和本地命令
 *   - 只保留真正的用户输入
 *
 * - **scan**: 累积器，类似 reduce 但发出每次累积结果
 *   - 用于维护 turn 计数
 *   - 每次 emit 时 turn + 1
 *
 * @param params - 可选的配置参数
 * @param params.input - 输入流（默认 process.stdin）
 * @param params.output - 输出流（默认 process.stdout）
 * @param params.intro - 欢迎信息
 * @param params.promptText - 提示符文本
 * @returns InteractiveTurnStream 对象
 */
export function createInteractiveTurnStream(params?: {
  input?: Readable;
  output?: Writable;
  intro?: string;
  promptText?: string;
  /** 技能执行器（用于 /skills 命令和技能检测） */
  skillExecutor?: SkillExecutor;
}): InteractiveTurnStream {
  // 解构参数，提供默认值
  const input = params?.input ?? process.stdin;
  const output = params?.output ?? process.stdout;
  const intro = params?.intro ?? createInteractiveIntro();
  const promptText = params?.promptText ?? "> ";
  const skillExecutor = params?.skillExecutor;

  // 创建 readline 接口
  // readline 是 Node.js 内置的逐行读取模块
  const rl = createInterface({
    input,
    output,
    prompt: promptText,
  });

  // 显示欢迎信息
  output.write(`${intro}\n`);

  /**
   * 渲染提示符
   * 在每次命令处理后调用
   */
  function renderPrompt(): void {
    output.write(ANSI.reset);
    rl.setPrompt(promptText);
    rl.prompt();
  }

  // ---- 创建 Observable 流 ----

  // close$ 事件流：用于 takeUntil 结束主流
  // fromEvent: 将 readline 的 "close" 事件转为 Observable
  const close$ = fromEvent(rl, "close");

  // turns$: 主输入流
  const turns$ = fromEvent<string>(rl, "line").pipe(
    // ---- map: 去除首尾空白 ----
    // 每次用户按回车，readline 发出 "line" 事件
    // map 将原始行转换为 trimmed 行
    map((line) => line.trim()),

    // ---- tap: 处理本地命令（副作用）----
    // tap 不会改变流中的值，只执行副作用
    // 处理 /exit, /help, /tools, /clear 命令
    tap((line) => {
      // /exit 或 /quit: 关闭 readline
      if (EXIT_COMMANDS.has(line)) {
        rl.close();
        return;
      }

      // /help: 显示帮助
      if (line === "/help") {
        output.write(`${ANSI.reset}\n${createHelpText("columns" in output ? output.columns : undefined)}\n\n`);
        renderPrompt();
        return;
      }

      // /tools: 显示工具语法
      if (line === "/tools") {
        output.write(`${ANSI.reset}\n${createToolsText("columns" in output ? output.columns : undefined)}\n\n`);
        renderPrompt();
        return;
      }

      // /clear: 清屏并重绘
      if (line === "/clear") {
        output.write(`${ANSI.reset}\x1b[2J\x1b[H`);  // ANSI 清屏和移动光标
        output.write(`${intro}\n`);
        renderPrompt();
        return;
      }

      // /skills: 显示可用技能
      if (line === "/skills" && skillExecutor) {
        const skillsHelp = skillExecutor.createSkillsHelp();
        output.write(`${ANSI.reset}\n${createLocalOutput("Available skills", [skillsHelp], "columns" in output ? output.columns : undefined)}\n\n`);
        renderPrompt();
        return;
      }
    }),

    // ---- takeUntil: 在 close$ 发出时结束 ----
    // 这确保了当 rl.close() 被调用时，整个流会正确结束
    takeUntil(close$),

    // ---- filter: 过滤无效输入 ----
    // 只保留满足条件的行：
    // 1. 非空行
    // 2. 不是退出命令
    // 3. 不是本地命令
    filter((line) => line.length > 0 && !EXIT_COMMANDS.has(line) && !LOCAL_COMMANDS.has(line)),

    // ---- scan: 累积 turn 计数 ----
    // scan 类似 reduce，但发出每次累积结果
    // 参数1: 累积函数 (previousState, currentValue) => newState
    // 参数2: 初始状态
    scan<string, ChatInputTurn>(
      (state, line) => ({
        turn: state.turn + 1,  // turn 递增
        content: line,
        source: "interactive",
      }),
      {
        turn: 0,  // 初始 turn
        content: "",
        source: "interactive",
      },
    ),
  );

  // ---- 返回结果 ----
  return {
    turns$,
    prompt: renderPrompt,
    close: () => rl.close(),
    // once: 等待单个事件，返回 Promise
    done: once(rl, "close").then(() => {
      output.write(`${ANSI.reset}${paint("Session ended.", ANSI.dim, ANSI.gray)}\n`);
    }),
  };
}
