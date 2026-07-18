/**
 * Claude Code A2A 适配器测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClaudeCodeA2AServer } from './a2a-claude-code-adapter.js';
import { A2AClient } from './a2a-client.js';

describe('ClaudeCodeA2AServer', () => {
  let server: ClaudeCodeA2AServer;
  let testPort: number;

  beforeEach(() => {
    testPort = 10000 + Math.floor(Math.random() * 1000);
    server = new ClaudeCodeA2AServer({ port: testPort });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('基本操作', () => {
    it('should start and stop server', async () => {
      await server.start();
      // 服务器已启动
      await server.stop();
      // 服务器已停止
    });

    it('should return correct Agent Card', () => {
      const card = server.getAgentCard();
      expect(card.name).toBe('claude-code');
      expect(card.capabilities.streaming).toBe(true);
      expect(card.skills.length).toBeGreaterThan(0);
    });
  });

  describe('Agent 发现', () => {
    it('should respond to agent discovery request', async () => {
      await server.start();

      const response = await fetch(`http://localhost:${testPort}/.well-known/agent.json`);
      expect(response.ok).toBe(true);

      const card = await response.json();
      expect(card.name).toBe('claude-code');
    });
  });

  describe('A2A 客户端集成', () => {
    it('should work with A2AClient', async () => {
      await server.start();

      const client = new A2AClient({
        baseUrl: `http://localhost:${testPort}`,
      });

      // 发现 Agent
      const card = await client.discoverAgent();
      expect(card.name).toBe('claude-code');
    });

    it('should send task via A2A client', async () => {
      await server.start();

      const client = new A2AClient({
        baseUrl: `http://localhost:${testPort}`,
        timeoutMs: 5000,
      });

      // 发送任务（使用异步模式避免阻塞）
      const taskId = await client.sendTaskAsync('test task');
      expect(taskId).toBeDefined();

      // 查询任务状态
      const task = await client.getTask(taskId);
      expect(task.id).toBe(taskId);
      expect(task.status.state).toBeDefined();
    });
  });

  describe('SSE 流', () => {
    it('should support SSE subscription', async () => {
      await server.start();

      // 创建任务
      const response = await fetch(`http://localhost:${testPort}/tasks/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-task-123',
          message: { role: 'user', parts: [{ type: 'text', text: 'test' }] },
        }),
      });

      expect(response.ok).toBe(true);

      // 订阅 SSE（不等待完成，只测试连接）
      const abortController = new AbortController();
      setTimeout(() => abortController.abort(), 1000);

      try {
        const sseResponse = await fetch(
          `http://localhost:${testPort}/tasks/test-task-123/subscribe`,
          { signal: abortController.signal }
        );

        expect(sseResponse.ok).toBe(true);
        expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');
      } catch {
        // 超时是预期的
      }
    });
  });
});
