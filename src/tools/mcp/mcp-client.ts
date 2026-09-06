/**
 * mcp-client.ts - MCP (Model Context Protocol) 客户端实现
 *
 * 实现与 MCP Server 的通信，支持：
 * - stdio 传输层（本地进程）
 * - SSE 传输层（远程服务器）
 * - JSON-RPC 2.0 消息格式
 * - 工具发现 (tools/list)
 * - 工具调用 (tools/call)
 * - 资源访问 (resources/list, resources/read)
 * - 提示词模板 (prompts/list, prompts/get)
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
 *     },
 *     "remote-tool": {
 *       "url": "https://mcp.example.com/sse"
 *     }
 *   }
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { t } from '@locales/index.js';
import { type Transport, type JsonRpcMessage, createTransport } from './mcp-transport.js';

// ============================================================
// JSON-RPC 类型定义
// ============================================================

/**
 * JSON-RPC 请求
 */
export type JSONRPCRequest = {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
};

/**
 * JSON-RPC 响应（成功）
 */
export type JSONRPCResponse<T = unknown> = {
  jsonrpc: '2.0';
  id: string | number;
  result: T;
};

/**
 * JSON-RPC 错误响应
 */
export type JSONRPCError = {
  jsonrpc: '2.0';
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
  jsonrpc: '2.0';
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
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

/**
 * MCP 工具调用结果
 */
export type MCPToolResult = {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
};

/**
 * MCP 资源定义
 */
export type MCPResourceDefinition = {
  /** 资源 URI */
  uri: string;
  /** 资源名称 */
  name: string;
  /** 资源描述 */
  description?: string;
  /** 资源 MIME 类型 */
  mimeType?: string;
};

/**
 * MCP 资源内容
 */
export type MCPResourceContent = {
  /** 资源 URI */
  uri: string;
  /** 资源 MIME 类型 */
  mimeType?: string;
  /** 文本内容 */
  text?: string;
  /** 二进制内容（Base64 编码） */
  blob?: string;
};

/**
 * MCP 资源读取结果
 */
export type MCPResourceResult = {
  contents: MCPResourceContent[];
};

/**
 * MCP 提示词模板定义
 */
export type MCPPromptDefinition = {
  /** 提示词名称 */
  name: string;
  /** 提示词描述 */
  description?: string;
  /** 提示词参数定义 */
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
};

/**
 * MCP 提示词消息
 */
export type MCPPromptMessage = {
  /** 角色 */
  role: 'user' | 'assistant';
  /** 消息内容 */
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  };
};

/**
 * MCP 提示词获取结果
 */
export type MCPPromptResult = {
  /** 提示词描述 */
  description?: string;
  /** 提示词消息列表 */
  messages: MCPPromptMessage[];
};

// ============================================================
// MCP 客户端配置
// ============================================================

/**
 * MCP 服务器配置
 *
 * 支持两种传输方式：
 * - stdio: 通过命令行启动本地进程
 * - SSE: 通过 HTTP 连接远程服务器
 */
export type MCPServerConfig = {
  /** 命令路径（stdio 模式） */
  command?: string;
  /** 命令参数（stdio 模式） */
  args?: string[];
  /** 环境变量（stdio 模式） */
  env?: Record<string, string>;
  /** 工作目录（stdio 模式） */
  cwd?: string;
  /** 服务器 URL（SSE 模式） */
  url?: string;
  /** 请求头（SSE 模式，用于认证） */
  headers?: Record<string, string>;
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
 * 负责与 MCP Server 通信，管理生命周期。
 * 支持 stdio（本地进程）和 SSE（远程服务器）两种传输方式。
 *
 * @example
 * ```typescript
 * // stdio 方式（本地进程）
 * const client = new MCPClient({
 *   name: "coder",
 *   server: {
 *     command: "claude",
 *     args: ["--mcp"],
 *   }
 * });
 *
 * // SSE 方式（远程服务器）
 * const client = new MCPClient({
 *   name: "remote-tool",
 *   server: {
 *     url: "https://mcp.example.com/sse",
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

  private transport: Transport | null = null;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

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
    if (this.transport) {
      throw new Error(t('mcp.clientAlreadyStarted'));
    }

    // 创建传输实例
    this.transport = createTransport({
      command: this.config.command,
      args: this.config.args,
      url: this.config.url,
      env: this.config.env,
      cwd: this.config.cwd,
      headers: this.config.headers,
      startupTimeout: this.config.startupTimeout,
      requestTimeout: this.config.requestTimeout,
    });

    // 注册传输事件处理器
    this.transport.onMessage((message) => {
      this.handleMessage(message);
    });

    this.transport.onError((error) => {
      this.emit('error', error);
    });

    this.transport.onClose((code) => {
      this.emit('close', code);
      this.cleanup();
    });

    // 连接到服务器
    await this.transport.connect();

    // 执行初始化握手
    const startupTimeout = this.config.startupTimeout ?? 10000;
    const initResult = await this.sendRequest<MCPInitializeResult>(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        clientInfo: {
          name: 'wasteland',
          version: '0.1.0',
        },
      },
      startupTimeout
    );

    this.capabilities = initResult.capabilities;
    this.initialized = true;

    // 发送 initialized 通知
    this.sendNotification('notifications/initialized');

    return initResult;
  }

  /**
   * 停止 MCP Server
   */
  async stop(): Promise<void> {
    if (!this.transport) {
      return;
    }

    // 发送 shutdown 请求（如果支持）
    try {
      await this.sendRequest('shutdown', {}, 5000);
    } catch {
      // 忽略错误
    }

    // 发送 exit 通知
    this.sendNotification('exit');

    // 给服务器时间处理
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 断开传输连接
    await this.transport.disconnect();
    this.transport = null;

    this.cleanup();
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    this.ensureInitialized();

    const response = await this.sendRequest<{
      tools: MCPToolDefinition[];
    }>('tools/list', {});

    return response.tools;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    this.ensureInitialized();

    return this.sendRequest<MCPToolResult>('tools/call', {
      name,
      arguments: args,
    });
  }

  /**
   * 列出可用资源
   */
  async listResources(): Promise<MCPResourceDefinition[]> {
    this.ensureInitialized();

    const response = await this.sendRequest<{
      resources: MCPResourceDefinition[];
    }>('resources/list', {});

    return response.resources;
  }

  /**
   * 读取资源内容
   */
  async readResource(uri: string): Promise<MCPResourceResult> {
    this.ensureInitialized();

    return this.sendRequest<MCPResourceResult>('resources/read', {
      uri,
    });
  }

  /**
   * 列出可用提示词模板
   */
  async listPrompts(): Promise<MCPPromptDefinition[]> {
    this.ensureInitialized();

    const response = await this.sendRequest<{
      prompts: MCPPromptDefinition[];
    }>('prompts/list', {});

    return response.prompts;
  }

  /**
   * 获取提示词模板内容
   */
  async getPrompt(
    name: string,
    args?: Record<string, unknown>
  ): Promise<MCPPromptResult> {
    this.ensureInitialized();

    return this.sendRequest<MCPPromptResult>('prompts/get', {
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
    if (!this.initialized || !this.transport) {
      throw new Error(t('mcp.clientNotInitialized'));
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    // 响应
    if ('id' in message && 'result' in message) {
      const response = message as { id: string | number; result: unknown };
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response.result);
      }
      return;
    }

    // 错误响应
    if ('id' in message && 'error' in message) {
      const error = message as { id: string | number; error: { code: number; message: string } };
      const pending = this.pendingRequests.get(error.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(error.id);
        pending.reject(new Error(`MCP Error ${error.error.code}: ${error.error.message}`));
      }
      return;
    }

    // 通知
    if ('method' in message && !('id' in message)) {
      const notification = message as { method: string; params?: unknown };
      this.emit('notification', notification);
      return;
    }
  }

  private sendRequest<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error('MCP transport not connected'));
        return;
      }

      const id = randomUUID();
      const request: JsonRpcMessage = {
        jsonrpc: '2.0',
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

      this.transport.send(request).catch((err) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.transport) {
      return;
    }

    const notification: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.transport.send(notification).catch(() => {
      // 忽略通知发送错误
    });
  }

  private cleanup(): void {
    // 清理所有待处理的请求
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MCP client stopped'));
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
  definition: MCPToolDefinition
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
