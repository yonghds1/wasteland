/**
 * a2a-webhook.ts - A2A Webhook 推送通知
 *
 * 实现 Webhook 服务器，用于接收 A2A 任务的推送通知。
 *
 * ## 工作原理
 *
 * 1. 主 Agent 启动 Webhook 服务器，监听某个端口
 * 2. 主 Agent 派发任务给子 Agent，同时告诉子 Agent Webhook URL
 * 3. 子 Agent 完成任务后，向 Webhook URL 发送 POST 请求
 * 4. 主 Agent 收到请求，立即处理结果
 *
 * ## 使用场景
 *
 * - 本地环境下的 Agent 协作
 * - 任务完成通知
 * - 实时进度更新
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Observable, type Subscriber } from 'rxjs';

import { Logger } from '../core/logger/index.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Webhook 事件
 */
export type WebhookEvent = {
  /** 任务 ID */
  taskId: string;
  /** 事件类型 */
  type: 'status' | 'artifact' | 'error';
  /** 任务状态 */
  status?: string;
  /** 任务结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: string;
};

export type WebhookServerConfig = {
  /** 监听端口 */
  port: number;
  /** 监听地址（默认 localhost） */
  host?: string;
  /** 请求路径（默认 /webhook） */
  path?: string;
  /** 可选鉴权密钥（设置后需通过 Bearer Token 或 X-Webhook-Secret 校验） */
  secret?: string;
};

/**
 * Webhook 服务器状态
 */
export type WebhookServerState = 'stopped' | 'starting' | 'running' | 'error';

// ============================================================
// Webhook 服务器
// ============================================================

/**
 * Webhook 服务器
 *
 * 用于接收 A2A 任务的推送通知。
 *
 * @example
 * ```typescript
 * const server = new WebhookServer({ port: 3000 });
 *
 * // 监听事件
 * server.onEvent((event) => {
 *   console.log('收到 Webhook 事件:', event);
 * });
 *
 * // 启动服务器
 * await server.start();
 * console.log(`Webhook 服务器运行在 http://localhost:3000/webhook`);
 *
 * // 获取 Webhook URL
 * const url = server.getWebhookUrl();
 * // url = 'http://localhost:3000/webhook'
 *
 * // 停止服务器
 * await server.stop();
 * ```
 */
export class WebhookServer {
  private server: Server | null = null;
  private state: WebhookServerState = 'stopped';
  private eventSubscriber: Subscriber<WebhookEvent> | null = null;
  private events$ = new Observable<WebhookEvent>((subscriber) => {
    this.eventSubscriber = subscriber;
    return () => {
      this.eventSubscriber = null;
    };
  });

  private readonly config: {
    port: number;
    host: string;
    path: string;
    secret?: string;
  };

  constructor(config: WebhookServerConfig) {
    this.config = {
      port: config.port,
      host: config.host ?? 'localhost',
      path: config.path ?? '/webhook',
      secret: config.secret,
    };
  }

  /**
   * 获取 Webhook URL
   */
  getWebhookUrl(): string {
    return `http://${this.config.host}:${this.config.port}${this.config.path}`;
  }

  /**
   * 获取服务器状态 */
  getState(): WebhookServerState {
    return this.state;
  }

  /**
   * 获取事件流
   *
   * @returns Webhook 事件的 Observable
   */
  getEvents(): Observable<WebhookEvent> {
    return this.events$;
  }

  /**
   * 注册事件处理器
   *
   * @param handler - 事件处理器
   */
  onEvent(handler: (event: WebhookEvent) => void): void {
    this.events$.subscribe(handler);
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    this.state = 'starting';

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        this.state = 'error';
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.state = 'running';
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.state = 'stopped';
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // 只处理 POST 请求到指定路径
    if (req.method !== 'POST' || req.url !== this.config.path) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // 鉴权检查（如果配置了 secret）
    if (this.config.secret) {
      const authHeader = req.headers['authorization'];
      const secretHeader = req.headers['x-webhook-secret'];
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : typeof secretHeader === 'string'
          ? secretHeader
          : undefined;

      if (!token || token !== this.config.secret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const event = JSON.parse(body) as WebhookEvent;

        // 验证事件格式
        if (!event.taskId || !event.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid event format' }));
          return;
        }

        // 添加时间戳（如果没有）
        if (!event.timestamp) {
          event.timestamp = new Date().toISOString();
        }

        Logger.info({
          sessionId: 'unknown',
          scope: 'a2a',
          message: 'a2a.webhook.inbound',
          data: {
            taskId: event.taskId,
            type: event.type,
            status: event.status,
            path: this.config.path,
          },
        });

        // 发出事件
        this.eventSubscriber?.next(event);

        // 返回成功
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }
}

// ============================================================
// Webhook 客户端
// ============================================================

/**
 * Webhook 客户端
 *
 * 用于向 Webhook 服务器发送通知。
 *
 * @example
 * ```typescript
 * const client = new WebhookClient('http://localhost:3000/webhook');
 *
 * // 发送任务完成通知
 * await client.sendNotification({
 *   taskId: 'abc-123',
 *   type: 'status',
 *   status: 'completed',
 *   result: { output: '任务结果' },
 * });
 * ```
 */
export class WebhookClient {
  private readonly webhookUrl: string;
  private readonly timeoutMs: number;
  private readonly secret?: string;

  constructor(webhookUrl: string, timeoutMs: number = 5000, secret?: string) {
    this.webhookUrl = webhookUrl;
    this.timeoutMs = timeoutMs;
    this.secret = secret;
  }

  /**
   * 发送通知
   *
   * @param event - Webhook 事件
   */
  async sendNotification(event: Omit<WebhookEvent, 'timestamp'>): Promise<void> {
    const fullEvent: WebhookEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    Logger.info({
      sessionId: 'unknown',
      scope: 'a2a',
      message: 'a2a.webhook.send',
      data: { taskId: event.taskId, type: event.type, url: this.webhookUrl },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.secret) {
      headers['Authorization'] = `Bearer ${this.secret}`;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(fullEvent),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Webhook request timed out after ${this.timeoutMs}ms`, { cause: error });
      }

      throw error;
    }
  }
}
