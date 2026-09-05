/**
 * cli-input-adapter.test.ts - CLI ask 关键字（always/once）回归
 *
 * 覆盖：输入 `always` 时注册 session 规则并回答 'always'；
 * 无可记模式时降级为本次允许（回答 'always' 但不注册）。
 */

import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';

import { CliInputAdapter } from './cli-input-adapter.js';
import { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import { createPermissionGate } from '@core/runtime/permission-gate.js';

class FakeStdin extends Readable {
  isTTY = true;
  _read(): void {}
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }
}

class FakeStdout extends Writable {
  output = '';
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.output += chunk.toString();
    cb();
  }
}

function bashCall(command: string) {
  return { id: 'c1', toolName: 'bash', input: { command } };
}

describe('CliInputAdapter ask 关键字', () => {
  it("输入 'always'：注册 session 规则并回答 'always'", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const bridge = new UserInputBridge();
    const gate = createPermissionGate({ mode: 'default' });
    const adapter = new CliInputAdapter({
      input: stdin,
      output: stdout,
      userInputBridge: bridge,
      permissionGate: gate,
    });
    try {
      // input$ 是冷流：先订阅才会监听 rl 事件
      const sub = adapter.input$.subscribe({ next: () => {}, error: () => {} });
      try {
        const pending = bridge.requestInput({
          callId: 'c1',
          toolName: 'bash',
          input: { command: 'git status' },
        });
        (adapter as unknown as { rl: EventEmitter }).rl.emit('line', 'always');
        await expect(pending).resolves.toBe('always');
      } finally {
        sub.unsubscribe();
      }
      // 同 pattern 后续调用直接放行
      expect(
        gate.evaluate(bashCall('git status --short'), 'execute').decision
      ).toBe('allow');
      // 不同 pattern 照旧 ask
      expect(gate.evaluate(bashCall('rm -rf /'), 'execute').decision).toBe('ask');
    } finally {
      adapter.destroy();
    }
  });

  it('无可记模式时 always 降级：回答 always 但不注册', async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const bridge = new UserInputBridge();
    const gate = createPermissionGate({ mode: 'default' });
    const adapter = new CliInputAdapter({
      input: stdin,
      output: stdout,
      userInputBridge: bridge,
      permissionGate: gate,
    });
    try {
      const sub = adapter.input$.subscribe({ next: () => {}, error: () => {} });
      try {
        const pending = bridge.requestInput({
          callId: 'c1',
          toolName: 'spawn_agent',
          input: { task: 'x' },
        });
        (adapter as unknown as { rl: EventEmitter }).rl.emit('line', 'always');
        await expect(pending).resolves.toBe('always');
      } finally {
        sub.unsubscribe();
      }
      expect(stdout.output).toContain('仅支持本次');
      expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('ask');
    } finally {
      adapter.destroy();
    }
  });
});
