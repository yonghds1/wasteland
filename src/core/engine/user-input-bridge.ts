/**
 * user-input-bridge.ts - 用户输入桥接器
 *
 * 提供 ask-user 工具与 UI 层之间的输入桥接机制。
 * 当 AI 需要用户输入时，通过此桥接器暂停 agent loop 并等待用户响应。
 */

import { Subject, firstValueFrom } from 'rxjs';

import type { ToolInput } from '@tools/tool-types.js';

/**
 * 待处理输入请求的结构化上下文（权限问询时由 dispatch 侧填入，
 * CLI 等无事件订阅的 UI 由此推导 once/always 模式）。
 */
export type PendingInputContext = {
  callId: string;
  toolName: string;
  input: ToolInput;
};

/**
 * 用户输入桥接器
 *
 * 使用 RxJS Subject 实现 agent loop 与 UI 之间的输入路由。
 * 当 ask-user 工具被调用时：
 * 1. special handler 调用 requestInput() 等待用户输入
 * 2. UI 层检测到 user_input_requested 事件后，将用户输入路由到 provideInput()
 * 3. requestInput() 返回用户的回答，agent loop 继续执行
 */
export class UserInputBridge {
  /** 用户响应的 Subject */
  private responseSubject = new Subject<string>();

  /** 是否有待处理的输入请求 */
  private pending = false;

  /** 待处理请求的结构化上下文（无则为 null，如 ask-user 工具问答）。 */
  private pendingContext: PendingInputContext | null = null;

  /** 等待用户输入 */
  async requestInput(context?: PendingInputContext): Promise<string> {
    this.pending = true;
    this.pendingContext = context ?? null;
    const answer = await firstValueFrom(this.responseSubject);
    this.pending = false;
    this.pendingContext = null;
    return answer;
  }

  /** 提供用户输入 */
  provideInput(answer: string): void {
    if (this.pending) {
      this.responseSubject.next(answer);
    }
  }

  /** 是否有待处理的输入请求 */
  isPending(): boolean {
    return this.pending;
  }

  /** 取待处理请求的结构化上下文（无 pending 或无上下文时返回 null）。 */
  getPendingContext(): PendingInputContext | null {
    return this.pending ? this.pendingContext : null;
  }

  /** 清理资源 */
  destroy(): void {
    this.responseSubject.complete();
  }
}
