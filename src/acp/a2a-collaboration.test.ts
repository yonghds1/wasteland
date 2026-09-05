/**
 * A2A 协作功能集成测试
 *
 * 测试 A2AClient SSE 和 Webhook 推送通知功能
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { A2AClient } from './a2a-client.js';
import { WebhookServer, WebhookClient } from './a2a-webhook.js';

describe('A2A Collaboration', () => {
  describe('A2AClient SSE', () => {
    it('should have sendTaskStream method', () => {
      const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
      expect(typeof client.sendTaskStream).toBe('function');
    });

    it('should have subscribeToTask method', () => {
      const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
      expect(typeof client.subscribeToTask).toBe('function');
    });

    it('should return Observable from sendTaskStream', () => {
      const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
      const stream = client.sendTaskStream('test task');
      expect(stream).toBeDefined();
      expect(typeof stream.subscribe).toBe('function');
    });

    it('should return Observable from subscribeToTask', () => {
      const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
      const stream = client.subscribeToTask('task-123');
      expect(stream).toBeDefined();
      expect(typeof stream.subscribe).toBe('function');
    });
  });

  describe('WebhookServer', () => {
    let server: WebhookServer;
    let testPort: number;

    beforeEach(() => {
      testPort = 10000 + Math.floor(Math.random() * 1000);
      server = new WebhookServer({ port: testPort });
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should start and stop server', async () => {
      await server.start();
      expect(server.getState()).toBe('running');

      await server.stop();
      expect(server.getState()).toBe('stopped');
    });

    it('should generate correct webhook URL', () => {
      expect(server.getWebhookUrl()).toBe(`http://localhost:${testPort}/webhook`);
    });

    it('should receive webhook events', async () => {
      const events: any[] = [];
      server.onEvent((event) => events.push(event));

      await server.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const client = new WebhookClient(`http://localhost:${testPort}/webhook`);
      await client.sendNotification({
        taskId: 'test-123',
        type: 'status',
        status: 'completed',
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(events.length).toBe(1);
      expect(events[0].taskId).toBe('test-123');
    });
  });

  describe('Integration', () => {
    it('should work together: A2AClient + Webhook', async () => {
      // 创建 Webhook 服务器
      const webhookServer = new WebhookServer({ port: 10001 });
      await webhookServer.start();

      const events: any[] = [];
      webhookServer.onEvent((event) => events.push(event));

      // 创建 A2A 客户端
      const a2aClient = new A2AClient({
        baseUrl: 'http://localhost:8080',
      });

      // 验证客户端可以创建 SSE 流
      const stream = a2aClient.sendTaskStream('test task');
      expect(stream).toBeDefined();

      // 模拟 Webhook 通知
      const webhookClient = new WebhookClient(webhookServer.getWebhookUrl());
      await webhookClient.sendNotification({
        taskId: 'test-456',
        type: 'status',
        status: 'completed',
        result: { output: 'Task completed successfully' },
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // 验证收到通知
      expect(events.length).toBe(1);
      expect(events[0].taskId).toBe('test-456');

      await webhookServer.stop();
    });
  });
});
