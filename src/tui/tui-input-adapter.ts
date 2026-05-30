/**
 * tui-input-adapter.ts - TUI 输入适配器
 *
 * 封装 React Subject 逻辑，实现 InputAdapter 接口。
 * 处理本地命令（/help, /tools, /clear, /exit, /skills）并输出 ChatInputTurn。
 */

import { Subject, type Observable } from 'rxjs';

import type { ChatInputTurn } from '@core/runtime/event-types.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import {
  executeLocalCommand,
  type LocalCommandResult,
} from '@core/shared/local-commands.js';
import type { InputAdapter } from '@core/adapters/input-adapter.js';

// ============================================================
// Types
// ============================================================

/**
 * TuiInputAdapter 参数
 */
export type TuiInputAdapterParams = {
  /** 技能执行器（用于 /skills 命令） */
  skillExecutor?: SkillExecutor;
  /** 本地命令回调（可选） */
  onCommand?: (result: LocalCommandResult) => void;
  /** 退出回调（可选） */
  onExit?: () => void;
};

// ============================================================
// TuiInputAdapter
// ============================================================

/**
 * TUI 输入适配器
 *
 * 封装 React Subject 逻辑，实现 InputAdapter 接口。
 * 处理本地命令并输出 ChatInputTurn。
 */
export class TuiInputAdapter implements InputAdapter {
  readonly input$: Observable<ChatInputTurn>;

  private subject: Subject<ChatInputTurn>;
  private turnCounter: number = 0;
  private skillExecutor?: SkillExecutor;
  private onCommand?: (result: LocalCommandResult) => void;
  private onExit?: () => void;

  constructor(params?: TuiInputAdapterParams) {
    this.subject = new Subject<ChatInputTurn>();
    this.input$ = this.subject.asObservable();
    this.skillExecutor = params?.skillExecutor;
    this.onCommand = params?.onCommand;
    this.onExit = params?.onExit;
  }

  /**
   * 发送用户输入
   *
   * 处理本地命令，如果是普通输入则发送到 Subject。
   *
   * @param content - 用户输入内容
   */
  send(content: string): void {
    const trimmed = content.trim();

    if (!trimmed) {
      return;
    }

    // 处理本地命令
    const result = executeLocalCommand({
      command: trimmed,
      skillExecutor: this.skillExecutor,
    });

    if (result.handled) {
      // 回调
      if (this.onCommand) {
        this.onCommand(result);
      }

      // 处理退出
      if (result.action === 'exit') {
        if (this.onExit) {
          this.onExit();
        }
        return;
      }

      // 其他本地命令（/help, /tools, /skills, /clear）
      // 由 UI 层通过 onCommand 回调处理
      return;
    }

    // 普通输入，发送到 Subject
    this.turnCounter++;
    this.subject.next({
      turn: this.turnCounter,
      content: trimmed,
      source: 'interactive',
    });
  }

  /**
   * 销毁适配器
   */
  destroy(): void {
    this.subject.complete();
  }
}
