/**
 * cli-input-adapter.ts - CLI 输入适配器
 *
 * 封装 readline 逻辑，实现 InputAdapter 接口。
 * 处理本地命令（/help, /tools, /clear, /exit, /skills）并输出 ChatInputTurn。
 */

import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { filter, fromEvent, map, scan, takeUntil, tap, type Observable } from 'rxjs';

import type { ChatInputTurn } from '@core/runtime/event-types.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import {
  executeLocalCommand,
  isExitCommand,
  isLocalCommand,
  type LocalCommandResult,
} from '@core/shared/local-commands.js';
import type { InputAdapter } from '@core/adapters/input-adapter.js';
import { ANSI, paint } from './terminal-theme.js';

// ============================================================
// Types
// ============================================================

/**
 * CliInputAdapter 参数
 */
export type CliInputAdapterParams = {
  /** 输入流（默认 process.stdin） */
  input?: Readable;
  /** 输出流（默认 process.stdout） */
  output?: Writable;
  /** 欢迎信息 */
  intro?: string;
  /** 提示符文本 */
  promptText?: string;
  /** 技能执行器（用于 /skills 命令） */
  skillExecutor?: SkillExecutor;
  /** 本地命令回调（可选，默认使用 executeLocalCommand） */
  onCommand?: (result: LocalCommandResult) => void;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: { isPending: () => boolean; provideInput: (input: string) => void };
};

// ============================================================
// UI Helpers
// ============================================================

/**
 * 创建交互模式欢迎信息
 */
function createInteractiveIntro(): string {
  return [
    paint('wasteland interactive', ANSI.bold, ANSI.cyan),
    paint('Prompt: >    Replies: wasteland', ANSI.bold, ANSI.brightWhite),
    paint('Commands: /help /tools /skills /clear /exit', ANSI.brightWhite),
  ].join('\n');
}


// ============================================================
// CliInputAdapter
// ============================================================

/**
 * CLI 输入适配器
 *
 * 封装 readline 逻辑，实现 InputAdapter 接口。
 * 处理本地命令并输出 ChatInputTurn。
 */
export class CliInputAdapter implements InputAdapter {
  readonly input$: Observable<ChatInputTurn>;
  readonly done: Promise<void>;

  private rl: ReturnType<typeof createInterface>;
  private output: Writable;
  private renderPrompt: () => void;
  private skillExecutor?: SkillExecutor;
  private onCommand?: (result: LocalCommandResult) => void;
  private userInputBridge?: { isPending: () => boolean; provideInput: (input: string) => void };

  constructor(params?: CliInputAdapterParams) {
    const input = params?.input ?? process.stdin;
    this.output = params?.output ?? process.stdout;
    this.skillExecutor = params?.skillExecutor;
    this.onCommand = params?.onCommand;
    this.userInputBridge = params?.userInputBridge;

    const intro = params?.intro ?? createInteractiveIntro();
    const promptText = params?.promptText ?? '> ';

    // 创建 readline 接口
    this.rl = createInterface({
      input,
      output: this.output,
      prompt: promptText,
      terminal: true,
    });

    // 渲染提示符
    this.renderPrompt = () => {
      this.rl.prompt();
    };

    // 显示欢迎信息
    this.output.write(`${ANSI.reset}\n${intro}\n\n`);

    // 创建 Observable 流
    const close$ = fromEvent(this.rl, 'close');

    this.input$ = fromEvent<string>(this.rl, 'line').pipe(
      // ---- tap: 处理 ask-user 输入路由 ----
      // 如果 UserInputBridge 有待处理的输入请求，路由输入到它
      tap((line) => {
        if (this.userInputBridge?.isPending()) {
          this.userInputBridge.provideInput(line.trim());
          this.renderPrompt();
        }
      }),

      // ---- filter: 过滤 ask-user 输入 ----
      // 如果 UserInputBridge 有待处理的输入请求，不创建新 turn
      filter(() => !this.userInputBridge?.isPending()),

      // 去除首尾空白
      map((line) => line.trim()),

      // 处理本地命令
      tap((line) => {
        const result = executeLocalCommand({
          command: line,
          skillExecutor: this.skillExecutor,
        });

        if (result.handled) {
          // 回调
          if (this.onCommand) {
            this.onCommand(result);
          }

          // 处理退出
          if (result.action === 'exit') {
            this.rl.close();
            return;
          }

          // 处理清屏
          if (result.action === 'clear') {
            this.output.write(`${ANSI.reset}\x1b[2J\x1b[H`);
            this.output.write(`${intro}\n`);
            this.renderPrompt();
            return;
          }

          // 输出命令结果
          if (result.output) {
            this.output.write(
              `${ANSI.reset}\n${result.output}\n\n`
            );
          }

          this.renderPrompt();
        }
      }),

      // 在 close$ 发出时结束
      takeUntil(close$),

      // 过滤无效输入
      filter((line) => line.length > 0 && !isExitCommand(line) && !isLocalCommand(line)),

      // 累积 turn 计数
      scan<string, ChatInputTurn>(
        (state, line) => ({
          turn: state.turn + 1,
          content: line,
          source: 'interactive',
        }),
        {
          turn: 0,
          content: '',
          source: 'interactive',
        }
      )
    );

    // 等待关闭
    this.done = once(this.rl, 'close').then(() => {
      this.output.write(`${ANSI.reset}${paint('Session ended.', ANSI.dim, ANSI.gray)}\n`);
    });

    // 显示提示符
    this.renderPrompt();
  }

  /**
   * 显示提示符
   */
  prompt(): void {
    this.renderPrompt();
  }

  /**
   * 销毁适配器
   */
  destroy(): void {
    this.rl.close();
  }
}
