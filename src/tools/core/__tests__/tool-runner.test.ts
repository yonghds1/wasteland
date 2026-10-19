import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import { executeToolCall } from '../tool-runner.js';
import type { AgentTool, ToolExecutionContext } from '../tool-types.js';

describe('executeToolCall', () => {
  it('在入口处自动对输入参数中的路径执行规范化清洗', async () => {
    const registry = new ToolRegistry();

    let capturedInput: unknown = null;
    const mockTool: AgentTool = {
      name: 'test-tool',
      riskLevel: 'read',
      execute: vi.fn(async (input) => {
        capturedInput = input;
        return { status: 'success' as const, output: 'ok' };
      }),
    };

    registry.register(mockTool);

    const context: ToolExecutionContext = {
      cwd: '/test/cwd',
      sessionId: 'session-1',
      turn: 1,
    };

    const result = await executeToolCall({
      registry,
      call: {
        id: 'call-1',
        toolName: 'test-tool',
        input: {
          filePath: 'src\\components\\App.tsx',
          include: ['src\\**\\*.ts', 'tests\\*'],
          command: 'echo "keep\\backslash"',
        },
      },
      context,
    });

    expect(result.status).toBe('success');
    expect(capturedInput).toEqual({
      filePath: 'src/components/App.tsx',
      include: ['src/**/*.ts', 'tests/*'],
      command: 'echo "keep\\backslash"',
    });
  });

  it('工具未找到时返回 error 状态', async () => {
    const registry = new ToolRegistry();
    const context: ToolExecutionContext = {
      cwd: '/test/cwd',
      sessionId: 'session-1',
      turn: 1,
    };

    const result = await executeToolCall({
      registry,
      call: {
        id: 'call-2',
        toolName: 'non-existent',
        input: {},
      },
      context,
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toContain('未找到工具');
    }
  });
});
