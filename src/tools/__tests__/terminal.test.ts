/**
 * terminal.test.ts - 交互式终端工具单元测试
 *
 * 覆盖：
 * - 创建会话
 * - 发送命令
 * - 读取输出
 * - 列出会话
 * - 关闭会话
 * - 超时处理
 * - 错误处理
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createTerminalTool, closeAllSessions } from '../terminal.js';
import type { ToolExecutionResult } from '../tool-types.js';

function assertSuccess(result: ToolExecutionResult) {
  expect(result.status).toBe('success');
  return result as Extract<ToolExecutionResult, { status: 'success' }>;
}

function assertError(result: ToolExecutionResult) {
  expect(result.status).toBe('error');
  return result as Extract<ToolExecutionResult, { status: 'error' }>;
}

describe('terminal 工具', () => {
  afterEach(async () => {
    closeAllSessions();
    // Small delay to ensure processes are cleaned up
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  describe('create 操作', () => {
    it('创建新会话并返回 session_id', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      const success = assertSuccess(result);
      expect(success.output).toContain('Terminal session created');
      expect(success.output).toContain('session_id:');
    });

    it('创建会话时支持自定义工作目录', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'create', cwd: '/tmp' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const success = assertSuccess(result);
      expect(success.output).toContain('session_id:');
    });

    it('创建会话时支持自定义超时', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'create', timeout: 60000 },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      assertSuccess(result);
    });
  });

  describe('send 操作', () => {
    it('发送命令到会话', async () => {
      const tool = createTerminalTool();
      const createResult = assertSuccess(
        await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' })
      );

      const sessionId = (createResult.data as { session_id: string }).session_id;
      const result = await tool.execute(
        { action: 'send', session_id: sessionId, command: 'echo hello' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const success = assertSuccess(result);
      expect(success.output).toContain('Command sent');
    });

    it('发送命令到不存在的会话返回错误', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'send', session_id: 'nonexistent', command: 'echo hello' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const error = assertError(result);
      expect(error.error).toContain('Session not found');
    });
  });

  describe('read 操作', () => {
    it('读取会话输出', async () => {
      const tool = createTerminalTool();
      const createResult = assertSuccess(
        await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' })
      );

      const sessionId = (createResult.data as { session_id: string }).session_id;

      // Send command
      await tool.execute(
        { action: 'send', session_id: sessionId, command: 'echo test-output' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      // Wait for output
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await tool.execute(
        { action: 'read', session_id: sessionId },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const success = assertSuccess(result);
      expect(success.output).toContain('test-output');
    });

    it('读取不存在会话返回错误', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'read', session_id: 'nonexistent' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const error = assertError(result);
      expect(error.error).toContain('Session not found');
    });

    it('读取清空输出缓冲区', async () => {
      const tool = createTerminalTool();
      const createResult = assertSuccess(
        await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' })
      );

      const sessionId = (createResult.data as { session_id: string }).session_id;

      // Send command
      await tool.execute(
        { action: 'send', session_id: sessionId, command: 'echo first' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      // First read
      await tool.execute(
        { action: 'read', session_id: sessionId },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      // Second read should be empty
      const result2 = await tool.execute(
        { action: 'read', session_id: sessionId },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const success2 = assertSuccess(result2);
      expect(success2.output).toBe('(no output)');
    });
  });

  describe('list 操作', () => {
    it('列出空会话列表', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute({ action: 'list' }, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      const success = assertSuccess(result);
      expect(success.output).toContain('No active sessions');
    });

    it('列出活跃会话', async () => {
      const tool = createTerminalTool();

      // Create two sessions
      await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' });
      await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      const result = await tool.execute({ action: 'list' }, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      const success = assertSuccess(result);
      expect(success.output).toContain('Active sessions (2)');
    });
  });

  describe('close 操作', () => {
    it('关闭会话', async () => {
      const tool = createTerminalTool();
      const createResult = assertSuccess(
        await tool.execute({ action: 'create' }, { sessionId: 'test', turn: 1, cwd: '/tmp' })
      );

      const sessionId = (createResult.data as { session_id: string }).session_id;
      const result = await tool.execute(
        { action: 'close', session_id: sessionId },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const success = assertSuccess(result);
      expect(success.output).toContain('Session closed');

      // Verify session is removed from list
      const listResult = assertSuccess(
        await tool.execute({ action: 'list' }, { sessionId: 'test', turn: 1, cwd: '/tmp' })
      );
      expect(listResult.output).toContain('No active sessions');
    });

    it('关闭不存在的会话返回错误', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'close', session_id: 'nonexistent' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const error = assertError(result);
      expect(error.error).toContain('Session not found');
    });
  });

  describe('超时处理', () => {
    it('会话超时后自动关闭', async () => {
      const tool = createTerminalTool();
      const createResult = assertSuccess(
        await tool.execute(
          { action: 'create', timeout: 100 }, // 100ms timeout
          { sessionId: 'test', turn: 1, cwd: '/tmp' }
        )
      );

      const sessionId = (createResult.data as { session_id: string }).session_id;

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      // Session should be closed
      const result = await tool.execute(
        { action: 'send', session_id: sessionId, command: 'echo hello' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      const error = assertError(result);
      expect(error.error).toContain('Session not found');
    });
  });

  describe('错误处理', () => {
    it('无效操作返回错误', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'invalid' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      assertError(result);
    });

    it('缺少必要参数返回错误', async () => {
      const tool = createTerminalTool();
      const result = await tool.execute(
        { action: 'send' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      assertError(result);
    });
  });
});
