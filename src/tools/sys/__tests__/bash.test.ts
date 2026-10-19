import { describe, it, expect } from 'vitest';
import type { ToolExecutionContext } from '../../core/tool-types.js';
import { createBashTool, killProcessTree } from '../bash.js';

describe('bash tool', () => {
  const tool = createBashTool();
  const dummyContext: ToolExecutionContext = { cwd: process.cwd(), sessionId: 'test', turn: 1 };

  it('正确执行简单命令', async () => {
    const res = await tool.execute({ command: 'echo "hello bash"' }, dummyContext);
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toBe('hello bash');
    }
  });

  it('非零退出码返回 error 状态与错误信息', async () => {
    const res = await tool.execute({ command: 'sh -c "echo err >&2; exit 42"' }, dummyContext);
    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.error).toContain('err');
    }
  });

  it('stdio 为 ignore 避免 stdin 挂死', async () => {
    const res = await tool.execute({ command: 'cat' }, dummyContext);
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toBe('');
    }
  });

  it('超时熔断机制生效并清理进程组', async () => {
    const start = Date.now();
    const res = await tool.execute(
      { command: 'sleep 10', timeout: 300 },
      dummyContext,
    );
    const elapsed = Date.now() - start;
    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.error).toContain('命令执行超时熔断');
    }
    expect(elapsed).toBeLessThan(5000);
  });

  it('参数校验失败返回提示', async () => {
    const res = await tool.execute({ command: '' }, dummyContext);
    expect(res.status).toBe('error');
  });

  describe('killProcessTree', () => {
    it('清理已退出或无效 pid 不抛异常', async () => {
      await expect(killProcessTree(999999, 10)).resolves.not.toThrow();
    });

    it('在 Windows 平台下执行清理安全降级且不崩溃抛错', async () => {
      const originalPlatform = process.platform;
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        await expect(killProcessTree(12345)).resolves.not.toThrow();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });
});
