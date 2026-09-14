/**
 * user-input-bridge.ts - 用户输入桥接器
 *
 * 提供 ask-user 工具、权限确认与 UI 层之间的输入桥接机制。
 * 当 AI 需要用户输入时，通过此桥接器暂停 agent loop 并等待用户响应。
 *
 * 并发语义（FIFO 队列，与 Claude Code 等主流 agent 一致）：
 * - 多个 requestInput() 按调用顺序排队，每次 provideInput(answer) 回答队首**尚未被认领**的那个；
 * - 后到的请求不会覆盖先到的上下文，也不会偷走别人的回答；
 * - 同一 tick 内的多次 provideInput 各认领一个等待者，不会丢答案（见 provideInput 注释）；
 * - isPending() = **物理队列**是否非空（含已认领未出队的，CLI 的 tap→filter 靠它吞行）；
 * - pendingCount() = 仍**未认领**（真正还在等回答）的请求数；
 * - getPendingContext() = 第一个**尚未被认领**的请求上下文（UI 展示与规则推导以它为准）。
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
  /**
   * 已被某次 provideInput 认领，会在**本 tick 的微任务**里出队并 resolve。
   * 用于让同一 tick 内的多次 provideInput 各认领一个等待者（见 provideInput）。
   */
  claimed?: boolean;
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

  /**
   * 提供用户输入（回答队列中**第一个尚未被认领**的请求）
   *
   * 认领语义：同 tick 内的多次 provideInput 必须各认领一个等待者。
   * 若照旧取 `waiters[0]`，第二次调用时前一个微任务还没跑、队头仍是同一个对象，
   * 它的微任务会因 `indexOf(head) < 0` 而直接 return ——
   * **第二个答案被静默丢弃、对应的等待者永久挂起**（一直等到 agent/子 agent 超时）。
   * 真实触发：`cli-input-adapter` 的 `fromEvent(rl, 'line')` 在同一个输入块里同步连发
   * 多个 line 事件（多行粘贴 / 终端缓冲）——已实测 Node readline 一次 write 会同步
   * emit N 个 line 事件。见 09-14-subagent-permission-hang。
   *
   * 出队仍是异步（微任务）的：保持既有同 tick 时序——provideInput 返回后、
   * 微任务执行前 `isPending()` 仍为 true，调用方的 tap→filter 链能正确吞掉
   * 当前输入行，不会泄漏成聊天消息。
   */
  provideInput(answer: string): void {
    const head = this.waiters.find((w) => !w.claimed);
    if (!head) return;
    head.claimed = true;
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

  /**
   * 仍在等待回答的请求数（**不含**已被 provideInput 认领、只是等微任务出队的那些）。
   *
   * 这就是 UI 想展示的「还有几个待确认」；不要改用 `isPending()`/物理队列长度，
   * 刚 `provideInput` 完会多算 1。TUI 侧另有自己的卡片队列
   * （`state.permission.queue.length`），因为它还要排除已展示的队头。
   */
  pendingCount(): number {
    return this.waiters.reduce((n, w) => (w.claimed ? n : n + 1), 0);
  }

  /**
   * 取队内**第一个尚未被认领**的请求上下文（无可展示请求时返回 null）。
   *
   * 跳过已认领（已被 provideInput 回答、正在等微任务出队）的等待者：
   * 同一 tick 内连续两次 provideInput 时，第二次读到的必须是下一个未答的问题，
   * 否则 CLI 的 `always` 会把 session 规则注册到已经答过的那一条上。
   */
  getPendingContext(): PendingInputContext | null {
    const head = this.waiters.find((w) => !w.claimed);
    return head?.context ?? null;
  }

  /** 清理资源：排空队列（等待者收到空串，按拒绝处理），防止进程退出时挂起 */
  destroy(): void {
    const drained = this.waiters.splice(0);
    for (const waiter of drained) waiter.resolve('');
  }
}
