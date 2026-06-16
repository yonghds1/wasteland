/**
 * a2a-client.ts - A2A (Agent-to-Agent) Protocol Client
 *
 * 实现 A2A 协议客户端，用于与远程 Agent 通信。
 *
 * ## 端点
 *
 * - GET  /.well-known/agent.json  → AgentCard (发现)
 * - POST /tasks/send              → Task      (发送)
 * - GET  /tasks/{id}              → Task      (查询)
 * - POST /tasks/{id}/cancel       → void      (取消)
 */

import type {
  AgentCard,
  Task,
  TaskSendRequest,
  TaskGetQuery,
  TaskCancelRequest,
  Message,
  TaskState,
} from './a2a-types.js';

// ============================================================
// Error Types
// ============================================================

/**
 * A2A Client 错误
 */
export class A2AClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'A2AClientError';
  }
}

// ============================================================
// Client Options
// ============================================================

/**
 * A2A Client 配置选项
 */
export type A2AClientOptions = {
  /** Agent 基础 URL */
  baseUrl: string;
  /** 认证令牌 (可选) */
  token?: string;
  /** 请求超时 (毫秒，默认 30000) */
  timeoutMs?: number;
  /** 轮询间隔 (毫秒，默认 1000) */
  pollIntervalMs?: number;
};

// ============================================================
// A2AClient
// ============================================================

/**
 * A2A 协议客户端
 *
 * 封装 A2A HTTP API，提供任务发送、查询、取消等能力。
 *
 * @example
 * ```typescript
 * const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
 * const card = await client.discoverAgent();
 * const task = await client.sendTask('Hello, agent!');
 * ```
 */
export class A2AClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: A2AClientOptions | string, token?: string) {
    if (typeof options === 'string') {
      this.baseUrl = options.replace(/\/+$/, '');
      this.token = token;
      this.timeoutMs = 30_000;
      this.pollIntervalMs = 1_000;
    } else {
      this.baseUrl = options.baseUrl.replace(/\/+$/, '');
      this.token = options.token;
      this.timeoutMs = options.timeoutMs ?? 30_000;
      this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    }
  }

  // ----------------------------------------------------------
  // Agent Discovery
  // ----------------------------------------------------------

  /**
   * 发现远程 Agent 能力
   *
   * 请求 GET /.well-known/agent.json 获取 Agent Card。
   *
   * @returns Agent Card 描述
   * @throws {A2AClientError} 请求失败时抛出
   */
  async discoverAgent(): Promise<AgentCard> {
    const url = `${this.baseUrl}/.well-known/agent.json`;
    const response = await this.fetch(url, { method: 'GET' });
    return (await response.json()) as AgentCard;
  }

  // ----------------------------------------------------------
  // Task Operations
  // ----------------------------------------------------------

  /**
   * 发送任务 (同步阻塞模式)
   *
   * 发送任务并阻塞等待 Agent 返回最终结果。
   * 如果 Agent 支持 blocking 模式，会一直等待直到任务完成。
   *
   * @param task - 任务内容 (文本)
   * @param options - 可选配置
   * @param options.sessionId - 会话 ID (用于多轮对话)
   * @returns 完成的任务
   * @throws {A2AClientError} 请求失败时抛出
   */
  async sendTask(
    task: string,
    options?: { sessionId?: string },
  ): Promise<Task> {
    const taskId = crypto.randomUUID();
    const sessionId = options?.sessionId;

    const request: TaskSendRequest = {
      id: taskId,
      sessionId,
      message: this.createUserMessage(task),
      configuration: {
        blocking: true,
      },
    };

    const response = await this.fetch(`${this.baseUrl}/tasks/send`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return (await response.json()) as Task;
  }

  /**
   * 发送任务 (异步非阻塞模式)
   *
   * 发送任务后立即返回 Task ID，调用方可通过 {@link getTask} 查询状态。
   *
   * @param task - 任务内容 (文本)
   * @returns 任务 ID
   * @throws {A2AClientError} 请求失败时抛出
   */
  async sendTaskAsync(task: string): Promise<string> {
    const taskId = crypto.randomUUID();

    const request: TaskSendRequest = {
      id: taskId,
      message: this.createUserMessage(task),
      configuration: {
        blocking: false,
      },
    };

    await this.fetch(`${this.baseUrl}/tasks/send`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return taskId;
  }

  /**
   * 查询任务状态
   *
   * @param taskId - 任务 ID
   * @param sessionId - 会话 ID (可选)
   * @returns 当前任务状态
   * @throws {A2AClientError} 请求失败时抛出
   */
  async getTask(taskId: string, sessionId?: string): Promise<Task> {
    const query: TaskGetQuery = { id: taskId, sessionId };
    const params = new URLSearchParams();
    params.set('id', taskId);
    if (sessionId) {
      params.set('sessionId', sessionId);
    }

    const url = `${this.baseUrl}/tasks/${taskId}?${params.toString()}`;
    const response = await this.fetch(url, { method: 'GET' });
    return (await response.json()) as Task;
  }

  /**
   * 等待任务完成 (轮询模式)
   *
   * 周期性查询任务状态，直到任务到达终态。
   *
   * 终态: completed, failed, canceled, rejected
   *
   * @param taskId - 任务 ID
   * @param timeoutMs - 超时时间 (毫秒，默认 60000)
   * @returns 完成的任务
   * @throws {A2AClientError} 超时或请求失败时抛出
   */
  async waitForTask(
    taskId: string,
    timeoutMs?: number,
  ): Promise<Task> {
    const deadline = Date.now() + (timeoutMs ?? 60_000);

    while (Date.now() < deadline) {
      const task = await this.getTask(taskId);

      if (this.isTerminalState(task.status.state)) {
        return task;
      }

      // Wait before next poll
      await this.sleep(this.pollIntervalMs);
    }

    throw new A2AClientError(
      `Timeout waiting for task ${taskId} to complete`,
      undefined,
      'TASK_TIMEOUT',
    );
  }

  /**
   * 取消任务
   *
   * @param taskId - 任务 ID
   * @param sessionId - 会话 ID (可选)
   * @throws {A2AClientError} 请求失败时抛出
   */
  async cancelTask(taskId: string, sessionId?: string): Promise<void> {
    const request: TaskCancelRequest = { id: taskId, sessionId };

    await this.fetch(`${this.baseUrl}/tasks/${taskId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // ----------------------------------------------------------
  // Internal Helpers
  // ----------------------------------------------------------

  /**
   * 创建用户消息
   */
  private createUserMessage(text: string): Message {
    return {
      role: 'user',
      parts: [{ type: 'text', text }],
    };
  }

  /**
   * 检查任务状态是否为终态
   */
  private isTerminalState(state: TaskState): boolean {
    return (
      state === 'completed' ||
      state === 'failed' ||
      state === 'canceled' ||
      state === 'rejected'
    );
  }

  /**
   * 执行 HTTP 请求
   */
  private async fetch(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await globalThis.fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text().catch(() => undefined);
        }

        throw new A2AClientError(
          `A2A request failed: ${response.status} ${response.statusText}`,
          response.status,
          'HTTP_ERROR',
          errorBody,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof A2AClientError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new A2AClientError(
          `A2A request timed out after ${this.timeoutMs}ms`,
          undefined,
          'REQUEST_TIMEOUT',
        );
      }

      throw new A2AClientError(
        `A2A request failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'NETWORK_ERROR',
        error,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 异步等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
