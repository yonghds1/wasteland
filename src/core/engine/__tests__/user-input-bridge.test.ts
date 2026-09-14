/**
 * user-input-bridge.test.ts - UserInputBridge FIFO 语义
 *
 * 覆盖：
 * - 单请求：回答后 resolve + 不再 pending
 * - 并发两请求：依次回答，各得其所（不互相覆盖、不共用答案）
 * - getPendingContext 返回第一个**未认领**的请求（同 tick 认领后即推进）
 * - 无等待时 provideInput 无操作
 * - destroy 排空等待者（收空串，按拒绝处理）
 */

import { describe, it, expect } from 'vitest';

import { UserInputBridge } from '../user-input-bridge.js';

describe('UserInputBridge', () => {
  it('单请求：回答后 resolve，本次 pending 结束', async () => {
    const bridge = new UserInputBridge();
    const pending = bridge.requestInput({ callId: 'c1', toolName: 'bash', input: {} });
    expect(bridge.isPending()).toBe(true);

    bridge.provideInput('yes');
    await expect(pending).resolves.toBe('yes');
    // 微任务出队后不再 pending
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(bridge.isPending()).toBe(false);
  });

  it('并发两请求：依次回答，各得其所', async () => {
    const bridge = new UserInputBridge();
    const first = bridge.requestInput({ callId: 'c1', toolName: 'bash', input: {} });
    const second = bridge.requestInput({ callId: 'c2', toolName: 'web-fetch', input: {} });
    expect(bridge.pendingCount()).toBe(2);

    // 队头上下文不被后到覆盖
    expect(bridge.getPendingContext()?.callId).toBe('c1');

    bridge.provideInput('yes');
    await expect(first).resolves.toBe('yes');
    // second 不应被提前唤醒
    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondDone).toBe(false);

    // 队头推进到 c2
    expect(bridge.isPending()).toBe(true);
    expect(bridge.getPendingContext()?.callId).toBe('c2');

    bridge.provideInput('no');
    await expect(second).resolves.toBe('no');
    await new Promise((r) => setTimeout(r, 0));
    expect(bridge.isPending()).toBe(false);
    expect(bridge.getPendingContext()).toBeNull();
  });

  it('无等待时 provideInput 无操作', () => {
    const bridge = new UserInputBridge();
    expect(() => bridge.provideInput('yes')).not.toThrow();
    expect(bridge.isPending()).toBe(false);
  });

  it('同一 tick 认领后：getPendingContext 推进到下一个未认领请求', async () => {
    // 回归 09-14-subagent-permission-hang：claimed 等待者仍留在物理队列里等微任务出队，
    // 但「当前问题」必须跳过它——否则同一 tick 的第二次读取会拿到已答的那条。
    const bridge = new UserInputBridge();
    const first = bridge.requestInput({ callId: 'c1', toolName: 'bash', input: { command: 'ls' } });
    const second = bridge.requestInput({ callId: 'c2', toolName: 'bash', input: { command: 'pwd' } });

    bridge.provideInput('yes');
    // 物理队列尚非空（tap→filter 依赖这一点吞掉当前输入行）
    expect(bridge.isPending()).toBe(true);
    // 但结构化上下文必须已推进到 c2
    expect(bridge.getPendingContext()?.callId).toBe('c2');

    await expect(first).resolves.toBe('yes');
    bridge.provideInput('yes');
    await expect(second).resolves.toBe('yes');
  });

  it('destroy 排空等待者（收空串）', async () => {
    const bridge = new UserInputBridge();
    const pending = bridge.requestInput({ callId: 'c1', toolName: 'bash', input: {} });
    bridge.destroy();
    await expect(pending).resolves.toBe('');
    expect(bridge.isPending()).toBe(false);
  });
});
