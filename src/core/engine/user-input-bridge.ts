/**
 * user-input-bridge.ts - 用户输入桥接器
 *
 * 提供 ask-user 工具、权限确认与 UI 层之间的输入桥接机制。
 * 当 AI 需要用户输入时，通过此桥接器暂停 agent loop 并等待用户响应。
 *
 * 并发语义（FIFO 队列，与 Claude Code 等主流 agent 一致）：
 * - 多个 requestInput() 按调用顺序排队，每次 provideInput(answer) 只回答队头；
 * - 后到的请求不会覆盖先到的上下文，也不会偷走别人的回答；
 * - isPending() = 队列非空；getPendingContext() = 队头上下文（UI 应展示队头问题）。
 */

import type { ToolInput } from '@tools/core/tool-types.js';

/**
 * 待处理输入请求的结构化上下文（权限问询时由 dispatch 侧填入，
 * CLI 等无事件订阅的 UI 由此推导 once/always 模式）。
 */
export type PendingInputContext = {
  callId: string;
  toolName: string;
  input: ToolInput;
};

type Waiter = {
  context: PendingInputContext | null;
  resolve: (answer: string) => void;
};

/**
 * 用户输入桥接器
 *
 * 使用 FIFO 队列实现 agent loop 与 UI 之间的输入路由。
 * 父子 agent 共享同一实例时，并行子 agent 的多个问询依次等待用户回答，
 * 不会互相覆盖（单槽 Subject 时代：后到的 context 覆盖先到的，一次回答唤醒所有等待者）。
 */
export class UserInputBridge {
  /** 等待中的输入请求队列（队头优先被回答） */
  private waiters: Waiter[] = [];

  /** 等待用户输入（按调用顺序排队） */
  async requestInput(context?: PendingInputContext): Promise<string> {
    return new Promise<string>((resolve) => {
      this.waiters.push({ context: context ?? null, resolve });
    });
  }

  /** 提供用户输入（只回答队头） */
  provideInput(answer: string): void {
    const head = this.waiters[0];
    if (!head) return;
    // 异步出队：保持与旧 Subject 实现一致的同 tick 时序——provideInput 调用后、
    // 微任务执行前 isPending() 仍为 true，调用方的 tap→filter 链能正确吞掉
    // 当前输入行，不会泄漏成聊天消息；同时防止同 tick 重复回答偷走下一个请求。
    queueMicrotask(() => {
      const idx = this.waiters.indexOf(head);
      if (idx < 0) return; // 已被 destroy 排空
      this.waiters.splice(idx, 1);
      head.resolve(answer);
    });
  }

  /** 是否有待处理的输入请求 */
  isPending(): boolean {
    return this.waiters.length > 0;
  }

  /** 队内等待中的请求数（UI 可选展示“还有 N 个确认”） */
  pendingCount(): number {
    return this.waiters.length;
  }

  /** 取队头请求的结构化上下文（无 pending 或无上下文时返回 null）。 */
  getPendingContext(): PendingInputContext | null {
    return this.waiters.length > 0 ? (this.waiters[0]?.context ?? null) : null;
  }

  /** 清理资源：排空队列（等待者收到空串，按拒绝处理），防止进程退出时挂起 */
  destroy(): void {
    const drained = this.waiters.splice(0);
    for (const waiter of drained) waiter.resolve('');
  }
}
