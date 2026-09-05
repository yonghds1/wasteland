/**
 * A2A Webhook 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookServer, WebhookClient } from './a2a-webhook.js';

describe('WebhookServer', () => {
  let server: WebhookServer;
  let testPort: number;

  beforeEach(() => {
    // 使用随机端口（避开常用端口）
    testPort = 20000 + Math.floor(Math.random() * 5000);
    server = new WebhookServer({ port: testPort });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('基本操作', () => {
    it('should have correct initial state', () => {
      expect(server.getState()).toBe('stopped');
    });

    it('should generate correct webhook URL', () => {
      const testServer = new WebhookServer({ port: 3000, host: 'example.com' });
      expect(testServer.getWebhookUrl()).toBe('http://example.com:3000/webhook');
    });

    it('should generate correct webhook URL with custom path', () => {
      const testServer = new WebhookServer({ port: 3000, path: '/notify' });
      expect(testServer.getWebhookUrl()).toBe('http://localhost:3000/notify');
    });
  });

  describe('服务器生命周期', () => {
    it('should start and stop server', async () => {
      await server.start();
      expect(server.getState()).toBe('running');

      await server.stop();
      expect(server.getState()).toBe('stopped');
    });

    it('should handle multiple start/stop cycles', async () => {
      await server.start();
      await server.stop();
      await server.start();
      expect(server.getState()).toBe('running');
    });
  });

  describe('事件处理', () => {
    it('should receive webhook events', async () => {
      const events: any[] = [];
      server.onEvent((event) => events.push(event));

      await server.start();

      // 等待服务器完全启动
      await new Promise((resolve) => setTimeout(resolve, 200));

      const client = new WebhookClient(`http://localhost:${testPort}/webhook`);
      await client.sendNotification({
        taskId: 'test-123',
        type: 'status',
        status: 'completed',
      });

      // 等待事件处理
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(events.length).toBe(1);
      expect(events[0].taskId).toBe('test-123');
      expect(events[0].status).toBe('completed');
    });

    it('should authenticate with secret and reject unauthorized requests', async () => {
      const authPort = 25000 + Math.floor(Math.random() * 5000);
      const authServer = new WebhookServer({ port: authPort, secret: 'super-secret-token' });
      const events: any[] = [];
      authServer.onEvent((e) => events.push(e));

      await authServer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        // 1. 无有效 secret 的请求应该被拒绝 (401)
        const unauthClient = new WebhookClient(`http://localhost:${authPort}/webhook`);
        await expect(
          unauthClient.sendNotification({
            taskId: 'attack-1',
            type: 'status',
            status: 'failed',
          })
        ).rejects.toThrow('Webhook request failed: 401 Unauthorized');

        expect(events.length).toBe(0);

        // 2. 携带正确 secret 的请求应该成功
        const validClient = new WebhookClient(
          `http://localhost:${authPort}/webhook`,
          5000,
          'super-secret-token'
        );
        await validClient.sendNotification({
          taskId: 'valid-task-1',
          type: 'status',
          status: 'completed',
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(events.length).toBe(1);
        expect(events[0].taskId).toBe('valid-task-1');
      } finally {
        await authServer.stop();
      }
    });
  });
});

describe('WebhookClient', () => {
  it('should send notification to webhook URL', async () => {
    const events: any[] = [];

    // 创建一个简单的 HTTP 服务器来接收通知
    const { createServer } = await import('node:http');
    const testServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        events.push(JSON.parse(body));
        res.writeHead(200);
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, () => resolve());
    });

    const address = testServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const client = new WebhookClient(`http://localhost:${port}/webhook`);
      await client.sendNotification({
        taskId: 'test-456',
        type: 'status',
        status: 'working',
      });

      expect(events.length).toBe(1);
      expect(events[0].taskId).toBe('test-456');
      expect(events[0].type).toBe('status');
      expect(events[0].timestamp).toBeDefined();
    } finally {
      testServer.close();
    }
  });
});
