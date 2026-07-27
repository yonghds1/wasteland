/**
 * mcp-transport.ts - MCP 传输层抽象
 *
 * 定义 Transport 接口，支持多种传输方式：
 * - StdioTransport: 标准输入/输出传输（本地进程）
 * - SseTransport: HTTP SSE 传输（远程服务器）
 *
 * ## 设计模式
 *
 * 使用策略模式，将传输逻辑与 MCPClient 解耦。
 * MCPClient 只关心消息的发送和接收，不关心底层传输方式。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ============================================================
// JSON-RPC 类型定义（与 mcp-client.ts 保持一致）
// ============================================================

/**
 * JSON-RPC 消息（请求、响应、通知的联合类型）
 */
export type JsonRpcMessage =
  | { jsonrpc: '2.0'; id: string | number; method: string; params?: unknown }
  | { jsonrpc: '2.0'; id: string | number; result: unknown }
  | { jsonrpc: '2.0'; id: string | number; error: { code: number; message: string; data?: unknown } }
  | { jsonrpc: '2.0'; method: string; params?: unknown };

// ============================================================
// Transport 接口
// ============================================================

/**
 * MCP 传输接口
 *
 * 定义传输层的抽象接口，支持多种传输方式。
 * 所有传输方式都必须实现此接口。
 */
export interface Transport extends EventEmitter {
  /**
   * 连接到 MCP 服务器
   */
  connect(): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  /**
   * 发送 JSON-RPC 消息
   */
  send(message: JsonRpcMessage): Promise<void>;

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void;

  /**
   * 注册错误处理器
   */
  onError(handler: (error: Error) => void): void;

  /**
   * 注册关闭处理器
   */
  onClose(handler: (code: number | null) => void): void;

  /**
   * 检查是否已连接
   */
  isConnected(): boolean;
}

// ============================================================
// StdioTransport 实现
// ============================================================

/**
 * Stdio 传输配置
 */
export type StdioTransportConfig = {
  /** 命令路径 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** 启动超时（毫秒，默认 10000） */
  startupTimeout?: number;
};

/**
 * Stdio 传输实现
 *
 * 通过标准输入/输出与 MCP 服务器进程通信。
 * 这是 MCP 协议最常用的传输方式。
 *
 * @example
 * ```typescript
 * const transport = new StdioTransport({
 *   command: 'node',
 *   args: ['server.js'],
 * });
 *
 * await transport.connect();
 * transport.onMessage((msg) => console.log(msg));
 * await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
 * await transport.disconnect();
 * ```
 */
export class StdioTransport extends EventEmitter implements Transport {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  private connected = false;

  constructor(private config: StdioTransportConfig) {
    super();
  }

  /**
   * 连接到 MCP 服务器（启动子进程）
   */
  async connect(): Promise<void> {
    if (this.process) {
      throw new Error('StdioTransport already connected');
    }

    const startupTimeout = this.config.startupTimeout ?? 10000;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`MCP server startup timeout: ${startupTimeout}ms`));
      }, startupTimeout);

      // 启动子进程
      this.process = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdin || !this.process.stdout) {
        clearTimeout(timeoutId);
        reject(new Error('Failed to create stdio streams'));
        return;
      }

      // 处理 stdout（JSON-RPC 消息）
      this.process.stdout.on('data', (data: Buffer) => {
        this.handleStdout(data);
      });

      // 处理 stderr（日志/错误）
      this.process.stderr?.on('data', (data: Buffer) => {
        this.emit('log', data.toString('utf-8'));
      });

      // 处理进程退出
      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('close', code);
        this.closeHandler?.(code);
      });

      this.process.on('error', (error) => {
        this.connected = false;
        this.emit('error', error);
        this.errorHandler?.(error);
      });

      // 进程启动成功
      this.connected = true;
      clearTimeout(timeoutId);
      resolve();
    });
  }

  /**
   * 断开连接（终止子进程）
   */
  async disconnect(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      return;
    }

    this.process = null;
    this.connected = false;
    this.buffer = '';

    // 已退出则直接返回，避免 Promise 永久挂起
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    // 发送 SIGTERM 等待退出；超时则 SIGKILL 强制终止
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 5000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }

  /**
   * 发送 JSON-RPC 消息
   */
  async send(message: JsonRpcMessage): Promise<void> {
    const stdin = this.process?.stdin;
    if (!stdin) {
      throw new Error('StdioTransport not connected');
    }

    const data = JSON.stringify(message) + '\n';
    return new Promise((resolve, reject) => {
      stdin.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 注册错误处理器
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * 注册关闭处理器
   */
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString('utf-8');

    // 解析完整的 JSON 消息（以换行分隔）
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        this.messageHandler?.(message);
      } catch {
        this.errorHandler?.(new Error(`Failed to parse message: ${line}`));
      }
    }
  }
}

// ============================================================
// SseTransport 实现
// ============================================================

/**
 * SSE 传输配置
 */
export type SseTransportConfig = {
  /** 服务器 URL */
  url: string;
  /** 请求头（可选，用于认证） */
  headers?: Record<string, string>;
  /** 请求超时（毫秒，默认 30000） */
  requestTimeout?: number;
};

/**
 * SSE 传输实现
 *
 * 通过 HTTP Server-Sent Events (SSE) 与 MCP 服务器通信。
 * 支持远程 MCP 服务器连接。
 *
 * ## 工作原理
 *
 * 1. 客户端发送 POST 请求到 `/message` 端点
 * 2. 服务器通过 SSE 流返回响应
 * 3. 客户端监听 SSE 流获取消息
 *
 * @example
 * ```typescript
 * const transport = new SseTransport({
 *   url: 'https://mcp.example.com/sse',
 *   headers: { 'Authorization': 'Bearer token' },
 * });
 *
 * await transport.connect();
 * transport.onMessage((msg) => console.log(msg));
 * await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
 * await transport.disconnect();
 * ```
 */
export class SseTransport extends EventEmitter implements Transport {
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  private connected = false;
  private abortController: AbortController | null = null;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;

  constructor(private config: SseTransportConfig) {
    super();
  }

  /**
   * 连接到 MCP 服务器（建立 SSE 连接）
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('SseTransport already connected');
    }

    this.abortController = new AbortController();

    // SSE 流异步建立：等 listenForEvents 拿到 reader 后再标记 connected，
    // 避免连接未就绪时 send 误判为已连接
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.listenForEvents().catch((error) => {
      this.errorHandler?.(error);
      this.connected = false;
      this.readyReject?.(error);
    });

    await ready;
    this.connected = true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.connected = false;
  }

  /**
   * 发送 JSON-RPC 消息
   *
   * 通过 POST 请求发送消息到服务器的 /message 端点
   */
  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('SseTransport not connected');
    }

    const url = new URL('/message', this.config.url).toString();
    const timeout = this.config.requestTimeout ?? 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout: ${timeout}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 注册错误处理器
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * 注册关闭处理器
   */
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 监听 SSE 事件流
   */
  private async listenForEvents(): Promise<void> {
    if (!this.abortController) {
      return;
    }

    try {
      const response = await fetch(this.config.url, {
        headers: {
          Accept: 'text/event-stream',
          ...this.config.headers,
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response body is null');
      }

      const reader = response.body.getReader();
      // SSE 流已建立，通知 connect 可以标记 connected
      this.readyResolve?.();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '' && eventData) {
            // 空行表示事件结束
            try {
              const message = JSON.parse(eventData) as JsonRpcMessage;
              this.messageHandler?.(message);
            } catch {
              this.errorHandler?.(new Error(`Failed to parse SSE data: ${eventData}`));
            }
            eventData = '';
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 正常关闭
        return;
      }
      throw error;
    } finally {
      this.connected = false;
      this.closeHandler?.(null);
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建传输实例
 *
 * 根据配置自动选择合适的传输方式：
 * - 如果有 `command` 字段，使用 StdioTransport
 * - 如果有 `url` 字段，使用 SseTransport
 */
export function createTransport(config: {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  startupTimeout?: number;
  requestTimeout?: number;
}): Transport {
  if (config.url) {
    return new SseTransport({
      url: config.url,
      headers: config.headers,
      requestTimeout: config.requestTimeout,
    });
  }

  if (config.command) {
    return new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      startupTimeout: config.startupTimeout,
    });
  }

  throw new Error('Invalid transport config: must have either "command" or "url"');
}
