/**
 * mcp-client.ts - MCP (Model Context Protocol) 客户端实现
 *
 * 实现与 MCP Server 的通信，支持：
 * - stdio 传输层
 * - JSON-RPC 2.0 消息格式
 * - 工具发现 (tools/list)
 * - 工具调用 (tools/call)
 *
 * ## MCP 协议概述
 *
 * MCP 使用 JSON-RPC 2.0 协议通过 stdio 或 SSE 进行通信：
 *
 * 1. 初始化握手：
 *    - client -> server: initialize request
 *    - server -> client: initialize response (with capabilities)
 *    - client -> server: initialized notification
 *
 * 2. 工具发现：
 *    - client -> server: tools/list request
 *    - server -> client: tools/list response (tool definitions)
 *
 * 3. 工具调用：
 *    - client -> server: tools/call request (name, arguments)
 *    - server -> client: tools/call response (content)
 *
 * ## 配置示例
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "coder": {
 *       "command": "claude",
 *       "args": ["--mcp"],
 *       "env": { "ANTHROPIC_API_KEY": "..." }
 *     }
 *   }
 * }
 * ```
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { t } from "../locales/index.js";

// ============================================================
// JSON-RPC 类型定义
// ============================================================

/**
 * JSON-RPC 请求
 */
export type JSONRPCRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};

/**
 * JSON-RPC 响应（成功）
 */
export type JSONRPCResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: string | number;
  result: T;
};

/**
 * JSON-RPC 错误响应
 */
export type JSONRPCError = {
  jsonrpc: "2.0";
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/**
 * JSON-RPC 通知
 */
export type JSONRPCNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

// ============================================================
// MCP 类型定义
// ============================================================

/**
 * MCP 服务器能力
 */
export type MCPServerCapabilities = {
  tools?: {
    supported?: boolean;
    listChanged?: boolean;
  };
  resources?: {
    supported?: boolean;
    listChanged?: boolean;
    subscribe?: boolean;
  };
  prompts?: {
    supported?: boolean;
    listChanged?: boolean;
  };
  logging?: {
    level?: string;
  };
};

/**
 * MCP 初始化结果
 */
export type MCPInitializeResult = {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
};

/**
 * MCP 工具定义
 */
export type MCPToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

/**
 * MCP 工具调用结果
 */
export type MCPToolResult = {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
};

// ============================================================
// MCP 客户端配置
// ============================================================

/**
 * MCP 服务器配置
 */
export type MCPServerConfig = {
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
  /** 请求超时（毫秒，默认 300000） */
  requestTimeout?: number;
};

/**
 * MCP 客户端配置
 */
export type MCPClientConfig = {
  /** 服务器名称 */
  name: string;
  /** 服务器配置 */
  server: MCPServerConfig;
};

// ============================================================
// MCP 客户端实现
// ============================================================

/**
 * MCP 客户端
 *
 * 负责与 MCP Server 进程通信，管理生命周期。
 *
 * @example
 * ```typescript
 * const client = new MCPClient({
 *   name: "coder",
 *   server: {
 *     command: "claude",
 *     args: ["--mcp"],
 *   }
 * });
 *
 * await client.start();
 * const tools = await client.listTools();
 * const result = await client.callTool("write_code", { task: "..." });
 * await client.stop();
 * ```
 */
export class MCPClient extends EventEmitter {
  readonly name: string;
  readonly config: MCPServerConfig;

  private process: ChildProcess | null = null;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  private buffer: string = "";
  private initialized = false;
  private capabilities: MCPServerCapabilities | null = null;
  private requestTimeout: number;

  constructor(config: MCPClientConfig) {
    super();
    this.name = config.name;
    this.config = config.server;
    this.requestTimeout = config.server.requestTimeout ?? 300000;
  }

  /**
   * 启动 MCP Server 并完成初始化握手
   */
  async start(): Promise<MCPInitializeResult> {
    if (this.process) {
      throw new Error(t("mcp.clientAlreadyStarted"));
    }

    // 启动子进程
    this.process = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error(t("mcp.failedToCreateStdio"));
    }

    // 处理 stdout（JSON-RPC 响应）
    this.process.stdout.on("data", (data: Buffer) => {
      this.handleStdout(data);
    });

    // 处理 stderr（日志/错误）
    this.process.stderr?.on("data", (data: Buffer) => {
      this.emit("log", data.toString("utf-8"));
    });

    // 处理进程退出
    this.process.on("close", (code) => {
      this.emit("close", code);
      this.cleanup();
    });

    this.process.on("error", (error) => {
      this.emit("error", error);
    });

    // 执行初始化握手
    const startupTimeout = this.config.startupTimeout ?? 10000;
    const initResult = await this.sendRequest<MCPInitializeResult>(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: "joe",
          version: "0.1.0",
        },
      },
      startupTimeout,
    );

    this.capabilities = initResult.capabilities;
    this.initialized = true;

    // 发送 initialized 通知
    this.sendNotification("notifications/initialized");

    return initResult;
  }

  /**
   * 停止 MCP Server
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    // 发送 shutdown 请求（如果支持）
    try {
      await this.sendRequest("shutdown", {}, 5000);
    } catch {
      // 忽略错误
    }

    // 发送 exit 通知
    this.sendNotification("exit");

    // 给进程时间退出
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 强制终止
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }

    this.cleanup();
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    this.ensureInitialized();

    const response = await this.sendRequest<{
      tools: MCPToolDefinition[];
    }>("tools/list", {});

    return response.tools;
  }

  /**
   * 调用工具
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    this.ensureInitialized();

    return this.sendRequest<MCPToolResult>("tools/call", {
      name,
      arguments: args,
    });
  }

  /**
   * 获取服务器能力
   */
  getCapabilities(): MCPServerCapabilities | null {
    return this.capabilities;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private ensureInitialized(): void {
    if (!this.initialized || !this.process) {
      throw new Error(t("mcp.clientNotInitialized"));
    }
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString("utf-8");

    // 解析完整的 JSON 消息（以换行分隔）
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        this.emit("error", new Error(t("mcp.failedToParseMessage", { line })));
      }
    }
  }

  private handleMessage(message: unknown): void {
    // 响应
    if (
      typeof message === "object" &&
      message !== null &&
      "id" in message &&
      "result" in message
    ) {
      const response = message as JSONRPCResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response.result);
      }
      return;
    }

    // 错误响应
    if (
      typeof message === "object" &&
      message !== null &&
      "id" in message &&
      "error" in message
    ) {
      const error = message as JSONRPCError;
      const pending = this.pendingRequests.get(error.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(error.id);
        pending.reject(
          new Error(`MCP Error ${error.error.code}: ${error.error.message}`),
        );
      }
      return;
    }

    // 通知
    if (
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      !("id" in message)
    ) {
      const notification = message as JSONRPCNotification;
      this.emit("notification", notification);
      return;
    }
  }

  private sendRequest<T>(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("MCP process not running"));
        return;
      }

      const id = randomUUID();
      const request: JSONRPCRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs ?? this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutId,
      });

      const message = JSON.stringify(request) + "\n";
      this.process.stdin.write(message);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin) {
      return;
    }

    const notification: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const message = JSON.stringify(notification) + "\n";
    this.process.stdin.write(message);
  }

  private cleanup(): void {
    // 清理所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP client stopped"));
    }
    this.pendingRequests.clear();
    this.initialized = false;
    this.capabilities = null;
  }
}

// ============================================================
// MCP 工具适配器
// ============================================================

/**
 * 将 MCP 工具包装为 AgentTool
 */
export type MCPToolAdapter = {
  /** MCP 客户端 */
  client: MCPClient;
  /** 工具名称 */
  toolName: string;
  /** 工具定义 */
  definition: MCPToolDefinition;
  /** 执行工具 */
  execute: (args: Record<string, unknown>) => Promise<MCPToolResult>;
};

/**
 * 创建 MCP 工具适配器
 */
export function createMCPToolAdapter(
  client: MCPClient,
  definition: MCPToolDefinition,
): MCPToolAdapter {
  return {
    client,
    toolName: definition.name,
    definition,
    async execute(args: Record<string, unknown>) {
      return client.callTool(definition.name, args);
    },
  };
}
