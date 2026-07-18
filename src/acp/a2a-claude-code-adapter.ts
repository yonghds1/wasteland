/**
 * a2a-claude-code-adapter.ts - Claude Code A2A 适配器
 *
 * 将 Claude Code 封装为 A2A 服务器，支持通过 A2A 协议调用。
 *
 * ## 架构
 *
 * ```
 * 主 Agent（wasteland）
 *      ↓
 * 调用 a2aClient.sendTask("分析代码")
 *      ↓
 * HTTP POST 到 Claude Code A2A 服务器（本地）
 *      ↓
 * Claude Code A2A 服务器调用 Claude Code CLI
 *      ↓
 * 通过 SSE 流推送实时状态
 *      ↓
 * 主 Agent 接收状态更新
 *      ↓
 * Claude Code 完成，返回最终结果
 * ```
 *
 * ## 功能
 *
 * - 实现 A2A 协议端点
 * - 调用 Claude Code CLI 执行任务
 * - 通过 SSE 流推送实时状态
 * - 支持任务取消
 * - 支持子 Agent 进度事件
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Observable, type Subscriber } from 'rxjs';
import type {
  AgentCard,
  Task,
  TaskStatus,
  Message,
  SSEEvent,
  TaskStatusUpdateEvent,
} from './a2a-types.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Claude Code A2A 服务器配置
 */
export type ClaudeCodeA2AConfig = {
  /** 监听端口 */
  port: number;
  /** 监听地址 */
  host?: string;
  /** Claude Code 命令路径 */
  claudeCommand?: string;
  /** 默认超时（毫秒） */
  defaultTimeoutMs?: number;
};

/**
 * 任务状态
 */
type TaskState = {
  id: string;
  status: TaskStatus;
  result?: string;
  process?: ChildProcess;
  subscribers: Set<Subscriber<SSEEvent>>;
};

// ============================================================
// Claude Code A2A 服务器
// ============================================================

/**
 * Claude Code A2A 服务器
 *
 * 将 Claude Code 封装为 A2A 服务器，支持通过 A2A 协议调用。
 *
 * @example
 * ```typescript
 * const server = new ClaudeCodeA2AServer({ port: 8080 });
 * await server.start();
 * console.log('Claude Code A2A 服务器运行在 http://localhost:8080');
 *
 * // 主 Agent 可以通过 A2A 协议调用
 * const client = new A2AClient({ baseUrl: 'http://localhost:8080' });
 * const task = await client.sendTask('分析代码');
 * ```
 */
export class ClaudeCodeA2AServer {
  private server: Server | null = null;
  private tasks = new Map<string, TaskState>();
  private config: Required<ClaudeCodeA2AConfig>;

  constructor(config: ClaudeCodeA2AConfig) {
    this.config = {
      port: config.port,
      host: config.host ?? 'localhost',
      claudeCommand: config.claudeCommand ?? 'claude',
      defaultTimeoutMs: config.defaultTimeoutMs ?? 300000,
    };
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(this.config.port, this.config.host, () => {
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // 取消所有运行中的任务
    for (const [taskId, state] of this.tasks) {
      if (state.process) {
        state.process.kill('SIGTERM');
      }
      state.subscribers.forEach((sub) => sub.complete());
    }
    this.tasks.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取 Agent Card
   */
  getAgentCard(): AgentCard {
    return {
      name: 'claude-code',
      description: 'Claude Code - AI coding assistant by Anthropic',
      url: `http://${this.config.host}:${this.config.port}`,
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      skills: [
        {
          id: 'code-analysis',
          name: 'Code Analysis',
          description: 'Analyze code for bugs, improvements, and patterns',
          tags: ['code', 'analysis', 'review'],
        },
        {
          id: 'code-refactoring',
          name: 'Code Refactoring',
          description: 'Refactor code for better structure and readability',
          tags: ['code', 'refactor', 'improve'],
        },
        {
          id: 'code-generation',
          name: 'Code Generation',
          description: 'Generate code based on requirements',
          tags: ['code', 'generate', 'create'],
        },
      ],
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
    };
  }

  /**
   * 处理 HTTP 请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // GET /.well-known/agent.json - Agent 发现
    if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getAgentCard()));
      return;
    }

    // POST /tasks/send - 发送任务
    if (req.method === 'POST' && url.pathname === '/tasks/send') {
      this.handleSendTask(req, res);
      return;
    }

    // GET /tasks/:id - 查询任务
    if (req.method === 'GET' && url.pathname.startsWith('/tasks/')) {
      this.handleGetTask(req, res, url.pathname);
      return;
    }

    // POST /tasks/:id/cancel - 取消任务
    if (req.method === 'POST' && url.pathname.endsWith('/cancel')) {
      this.handleCancelTask(req, res, url.pathname);
      return;
    }

    // GET /tasks/:id/subscribe - SSE 订阅
    if (req.method === 'GET' && url.pathname.endsWith('/subscribe')) {
      this.handleSubscribeTask(req, res, url.pathname);
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * 处理发送任务
   */
  private handleSendTask(req: IncomingMessage, res: ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        const taskId = request.id ?? randomUUID();
        const prompt = request.message?.parts?.[0]?.text ?? '';

        // 创建任务状态
        const taskState: TaskState = {
          id: taskId,
          status: { state: 'submitted' },
          subscribers: new Set(),
        };
        this.tasks.set(taskId, taskState);

        // 发送初始响应
        const task: Task = {
          id: taskId,
          status: taskState.status,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));

        // 异步执行任务
        this.executeTask(taskId, prompt);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }

  /**
   * 执行任务
   */
  private async executeTask(taskId: string, prompt: string): Promise<void> {
    const taskState = this.tasks.get(taskId);
    if (!taskState) return;

    // 更新状态为 working
    taskState.status = { state: 'working' };
    this.notifySubscribers(taskId, {
      type: 'status',
      taskId,
      status: taskState.status,
    });

    try {
      const { spawn } = await import('node:child_process');
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];

      const process = spawn(this.config.claudeCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      taskState.process = process;

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();

        // 解析流式输出，推送状态更新
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              this.handleClaudeCodeEvent(taskId, event);
            } catch {
              // 忽略解析错误
            }
          }
        }
      });

      process.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        taskState.process = undefined;

        if (code === 0) {
          // 解析最终结果
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];

          try {
            const event = JSON.parse(lastLine);
            if (event.type === 'result') {
              taskState.status = { state: 'completed' };
              taskState.result = event.result;

              this.notifySubscribers(taskId, {
                type: 'status',
                taskId,
                status: taskState.status,
                final: true,
              });
            }
          } catch {
            taskState.status = { state: 'completed' };
            taskState.result = stdout;

            this.notifySubscribers(taskId, {
              type: 'status',
              taskId,
              status: taskState.status,
              final: true,
            });
          }
        } else {
          taskState.status = {
            state: 'failed',
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: stderr || `Process exited with code ${code}` }],
            },
          };

          this.notifySubscribers(taskId, {
            type: 'status',
            taskId,
            status: taskState.status,
            final: true,
          });
        }

        // 完成所有订阅者
        taskState.subscribers.forEach((sub) => sub.complete());
        taskState.subscribers.clear();
      });

      process.on('error', (error) => {
        taskState.process = undefined;
        taskState.status = {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: error.message }],
          },
        };

        this.notifySubscribers(taskId, {
          type: 'status',
          taskId,
          status: taskState.status,
          final: true,
        });

        taskState.subscribers.forEach((sub) => sub.complete());
        taskState.subscribers.clear();
      });
    } catch (error) {
      taskState.status = {
        state: 'failed',
        message: {
          role: 'agent',
          parts: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        },
      };

      this.notifySubscribers(taskId, {
        type: 'status',
        taskId,
        status: taskState.status,
        final: true,
      });

      taskState.subscribers.forEach((sub) => sub.complete());
      taskState.subscribers.clear();
    }
  }

  /**
   * 处理 Claude Code 事件
   */
  private handleClaudeCodeEvent(taskId: string, event: any): void {
    const taskState = this.tasks.get(taskId);
    if (!taskState) return;

    switch (event.type) {
      case 'assistant':
        // AI 正在输出（思考过程）
        const content = event.message?.content?.[0]?.text ?? '';
        if (content) {
          this.notifySubscribers(taskId, {
            type: 'status',
            taskId,
            status: {
              state: 'working',
              message: {
                role: 'agent',
                parts: [{ type: 'text', text: content }],
              },
            },
          });
        }
        break;

      case 'tool_use':
        // 工具调用
        const toolName = event.tool?.name ?? 'unknown';
        const toolInput = event.tool?.input ?? {};
        this.notifySubscribers(taskId, {
          type: 'status',
          taskId,
          status: {
            state: 'working',
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: `🔧 Using tool: ${toolName}` }],
            },
          },
        });
        break;

      case 'tool_result':
        // 工具结果
        const resultStatus = event.tool_result?.status ?? 'unknown';
        this.notifySubscribers(taskId, {
          type: 'status',
          taskId,
          status: {
            state: 'working',
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: `✅ Tool result: ${resultStatus}` }],
            },
          },
        });
        break;

      case 'result':
        // 最终结果
        this.notifySubscribers(taskId, {
          type: 'status',
          taskId,
          status: {
            state: 'completed',
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: event.result ?? '' }],
            },
          },
          final: true,
        });
        break;
    }
  }

  /**
   * 通知订阅者
   */
  private notifySubscribers(taskId: string, event: SSEEvent): void {
    const taskState = this.tasks.get(taskId);
    if (!taskState) return;

    taskState.subscribers.forEach((sub) => {
      try {
        sub.next(event);
      } catch {
        // 忽略订阅者错误
      }
    });
  }

  /**
   * 处理查询任务
   */
  private handleGetTask(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const taskId = pathname.split('/')[2];
    const taskState = this.tasks.get(taskId);

    if (!taskState) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    const task: Task = {
      id: taskId,
      status: taskState.status,
      history: taskState.result
        ? [{
            role: 'agent',
            parts: [{ type: 'text', text: taskState.result }],
          }]
        : undefined,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
  }

  /**
   * 处理取消任务
   */
  private handleCancelTask(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const parts = pathname.split('/');
    const taskId = parts[2];
    const taskState = this.tasks.get(taskId);

    if (!taskState) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    if (taskState.process) {
      taskState.process.kill('SIGTERM');
      taskState.process = undefined;
    }

    taskState.status = { state: 'canceled' };
    this.notifySubscribers(taskId, {
      type: 'status',
      taskId,
      status: taskState.status,
      final: true,
    });

    taskState.subscribers.forEach((sub) => sub.complete());
    taskState.subscribers.clear();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  /**
   * 处理 SSE 订阅
   */
  private handleSubscribeTask(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const parts = pathname.split('/');
    const taskId = parts[2];
    const taskState = this.tasks.get(taskId);

    if (!taskState) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    // 设置 SSE 头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // 创建订阅者
    const subscriber = {
      next: (event: SSEEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      error: (error: Error) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      },
      complete: () => {
        res.end();
      },
    } as Subscriber<SSEEvent>;

    taskState.subscribers.add(subscriber);

    // 如果任务已完成，立即发送当前状态
    if (taskState.status.state === 'completed' || taskState.status.state === 'failed') {
      subscriber.next({
        type: 'status',
        taskId,
        status: taskState.status,
        final: true,
      });
      subscriber.complete();
      taskState.subscribers.delete(subscriber);
    }

    // 处理客户端断开
    req.on('close', () => {
      taskState.subscribers.delete(subscriber);
    });
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 创建 Claude Code A2A 服务器
 */
export async function createClaudeCodeA2AServer(
  config: ClaudeCodeA2AConfig
): Promise<ClaudeCodeA2AServer> {
  const server = new ClaudeCodeA2AServer(config);
  await server.start();
  return server;
}
