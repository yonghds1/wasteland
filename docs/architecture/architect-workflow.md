# 三角色协作系统 (Architect → Coder → Reviewer)

本系统实现了一个自动化的开发工作流，包含三个协作角色：

- **Architect (主架构师)**: 负责项目分析、计划制定、编码委托和迭代控制
- **Coder (编码者)**: 通过 MCP 协议调用外部 Claude Code
- **Reviewer (审查者)**: 通过 MCP 协议调用外部 Codex

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Architect 工作流                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. PLAN: 分析需求 → 制定计划                                 │
│       ↓                                                      │
│  2. CODE: 通过 MCP 调用 Claude Code 执行编码                  │
│       ↓                                                      │
│  3. VERIFY: 验证编码结果                                      │
│       ↓                                                      │
│  4. REVIEW: 通过 MCP 调用 Codex 进行代码审查                   │
│       ↓                                                      │
│  5. DECIDE: 决策                                              │
│       ├─ 通过 → 完成                                          │
│       └─ 不通过 → 返回 PLAN (继续迭代)                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## MCP 协议

本系统使用 **MCP (Model Context Protocol)** 与外部 Agent 通信：

```
┌──────────────┐                    ┌──────────────┐
│   joe        │  JSON-RPC/stdio    │  MCP Server  │
│  (Client)    │ ←────────────────→ │  (Claude)    │
├──────────────┤                    ├──────────────┤
│              │  1. initialize     │              │
│              │  ───────────────→ │              │
│              │  ←─────────────── │              │
│              │                    │              │
│              │  2. tools/list     │              │
│              │  ───────────────→ │              │
│              │  ←─────────────── │  [tools...]  │
│              │                    │              │
│              │  3. tools/call     │              │
│              │  ───────────────→ │              │
│              │  ←─────────────── │  result      │
└──────────────┘                    └──────────────┘
```

## 配置

### 1. 复制配置文件

```bash
cp .joe/settings.example.json .joe/settings.json
```

### 2. 配置 MCP Servers

在 `.joe/settings.json` 中：

```json
{
  "mcpServers": {
    "claude-code": {
      "command": "claude",
      "args": ["--mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      },
      "requestTimeout": 300000
    },
    "codex": {
      "command": "codex",
      "args": ["--mcp"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  },
  "workflow": {
    "architect": {
      "coderToolName": "claude-code/write_code",
      "reviewerToolName": "codex/review_code"
    }
  }
}
```

### 3. 配置环境变量

```bash
# Architect (Qwen)
export APP_CHAT_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
export APP_CHAT_API_KEY="<your-qwen-api-key>"

# Coder (Claude)
export ANTHROPIC_API_KEY="<your-anthropic-api-key>"

# Reviewer (Codex)
export OPENAI_API_KEY="<your-openai-api-key>"
```

## 工具名称配置

MCP 工具名称支持两种格式：

1. **带服务器前缀**: `claude-code/write_code` - 明确指定服务器和工具
2. **无前缀**: `write_code` - 自动查找（如果无冲突）

在 `workflow.architect` 配置中：

```json
{
  "workflow": {
    "architect": {
      "coderToolName": "claude-code/write_code",
      "reviewerToolName": "codex/review_code",
      "maxIterations": 5,
      "phaseTimeout": 300000
    }
  }
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `coderToolName` | Coder 工具名称 | `coder` |
| `reviewerToolName` | Reviewer 工具名称 | `reviewer` |
| `maxIterations` | 最大迭代次数 | `5` |
| `phaseTimeout` | 阶段超时（毫秒） | `300000` |

## 使用方式

### 方式一：使用 CLI

```bash
# 使用 Architect 角色启动
joe chat --role architect --message "实现用户登录功能"
```

### 方式二：使用 MCP API

```typescript
import { createMCPRegistry } from "./tools/mcp-registry.js";

// 创建 MCP 注册表
const mcpRegistry = await createMCPRegistry({
  "claude-code": {
    command: "claude",
    args: ["--mcp"],
  },
  "codex": {
    command: "codex",
    args: ["--mcp"],
  },
});

// 列出所有工具
const tools = mcpRegistry.getAllTools();
console.log("Available tools:", tools.map(t => `${t.serverName}/${t.tool.name}`));

// 调用工具
const result = await mcpRegistry.callTool("claude-code", "write_code", {
  task: "实现用户登录功能",
  files: ["src/auth/login.ts"],
});

// 停止所有 MCP servers
await mcpRegistry.stopAll();
```

### 方式三：使用 Architect 工作流 API

```typescript
import { createArchitectWorkflow } from "./runtime/architect-workflow.js";
import { createDefaultToolRegistry } from "./tools/default-registry.js";

// 创建工具注册表（包含 MCP）
const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry({
  "claude-code": { command: "claude", args: ["--mcp"] },
  "codex": { command: "codex", args: ["--mcp"] },
});

// 启动 MCP 服务器
await startMCP();

// 创建工作流
const workflow = createArchitectWorkflow({
  provider: architectProvider,
  toolRegistry,
  permissionGate,
  sessionManager,
  cwd: process.cwd(),
  maxIterations: 5,
  // 指定 MCP 工具名称
  coderToolName: "claude-code/write_code",
  reviewerToolName: "codex/review_code",
});

// 执行工作流
const result = await workflow.execute({
  task: "实现用户登录功能",
  context: "项目使用 TypeScript 和 Express",
});

console.log("成功:", result.success);
console.log("迭代次数:", result.totalIterations);

// 停止 MCP 服务器
await stopMCP();
```

## 完整架构

```
用户请求: "实现用户登录功能"
    ↓
┌─────────────────────────────────────────────────────────────────┐
│  joe CLI (src/commands/chat.ts)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. loadRxcSettings({ cwd, env })                               │
│     └─ 读取 .joe/settings.json                                  │
│     └─ 返回 { mcpServers: { "claude-code": {...}, "codex": {...} } }
│                                                                 │
│  2. createDefaultToolRegistry(mcpServers)                       │
│     ├─ 创建内置工具:                                             │
│     │   ├─ read-file, glob, grep, list-directory               │
│     │   ├─ web-fetch, bash, edit-file, write-file              │
│     │   └─ spawn_agent (占位符)                                 │
│     │                                                           │
│     ├─ 创建 MCPToolRegistry:                                    │
│     │   └─ 注册 MCP Server 配置 (未启动)                        │
│     │                                                           │
│     └─ 返回 { toolRegistry, startMCP, stopMCP }                │
│                                                                 │
│  3. startMCP() ───────────────────────────────────────────────  │
│     │                                                           │
│     │  对每个 MCP Server:                                       │
│     │  ┌─────────────────────────────────────────────────────┐ │
│     │  │  MCPClient.start()                                   │ │
│     │  │  ├─ spawn("claude --mcp")  ← 启动子进程              │ │
│     │  │  │                                                   │ │
│     │  │  ├─ JSON-RPC Request: initialize                    │ │
│     │  │  │  { jsonrpc: "2.0", method: "initialize", ... }   │ │
│     │  │  │                                                   │ │
│     │  │  ├─ JSON-RPC Response:                              │ │
│     │  │  │  { capabilities: { tools: {} }, serverInfo }     │ │
│     │  │  │                                                   │ │
│     │  │  ├─ JSON-RPC Request: tools/list                    │ │
│     │  │  │  { method: "tools/list" }                        │ │
│     │  │  │                                                   │ │
│     │  │  ├─ JSON-RPC Response:                              │ │
│     │  │  │  { tools: [                                       │ │
│     │  │  │      { name: "write_code", inputSchema: {...} }, │ │
│     │  │  │      { name: "read_file", inputSchema: {...} },  │ │
│     │  │  │      ...                                          │ │
│     │  │  │  ] }                                              │ │
│     │  │  │                                                   │ │
│     │  │  └─ 注册工具到 ToolRegistry:                         │ │
│     │  │      toolRegistry.register("claude-code/write_code") │ │
│     │  │      toolRegistry.register("claude-code/read_file")  │ │
│     │  │      toolRegistry.register("write_code") // 无前缀   │ │
│     │  └─────────────────────────────────────────────────────┘ │
│     │                                                           │
│     └─ 所有 MCP Server 启动完成                                 │
│                                                                 │
│  4. runAgentLoop({ toolRegistry, provider, ... })               │
│     │                                                           │
│     │  Provider 可以调用所有工具:                               │
│     │  ├─ 内置工具: read-file, bash, edit-file, ...           │
│     │  └─ MCP 工具: claude-code/write_code, codex/review_code  │
│     │                                                           │
│     └─ Architect 工作流执行:                                    │
│         ├─ PLAN: 分析需求，制定计划                             │
│         ├─ CODE: toolRegistry.get("claude-code/write_code")    │
│         │        └─ MCPClient.callTool("write_code", args)     │
│         │            └─ JSON-RPC: tools/call                   │
│         ├─ VERIFY: 验证编码结果                                 │
│         ├─ REVIEW: toolRegistry.get("codex/review_code")       │
│         │          └─ MCPClient.callTool("review_code", args)  │
│         └─ DECIDE: 通过则完成，不通过则继续迭代                  │
│                                                                 │
│  5. stopMCP()                                                   │
│     ├─ JSON-RPC: shutdown                                       │
│     ├─ JSON-RPC: exit (notification)                           │
│     └─ process.kill("SIGTERM")                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## MCP 工具注册流程

### 1. 配置定义

在 `.joe/settings.json` 中定义 MCP Servers：

```json
{
  "mcpServers": {
    "claude-code": {
      "command": "claude",
      "args": ["--mcp"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" },
      "requestTimeout": 300000
    }
  }
}
```

### 2. 注册入口

**文件**: `src/tools/default-registry.ts`

```typescript
export function createDefaultToolRegistry(mcpServers?: MCPServersConfig): CreateToolRegistryResult {
  // 1. 创建内置工具
  const builtinTools = [
    createReadFileTool(),
    createGlobTool(),
    createBashTool(),
    // ...
  ];

  // 2. 创建 MCP 注册表
  let mcpRegistry: MCPToolRegistry | undefined;
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    mcpRegistry = new MCPToolRegistry();
    mcpRegistry.registerServersConfigs(mcpServers);  // ← 注册配置
  }

  // 3. 返回控制接口
  return {
    toolRegistry,
    mcpRegistry,
    startMCP: async () => {
      await mcpRegistry.startAll();  // ← 启动并注册工具
      // 将 MCP 工具动态注册到 ToolRegistry
      const mcpTools = mcpRegistry.toAgentTools();
      for (const tool of mcpTools) {
        toolRegistry.register(tool);  // ← 注册到统一 ToolRegistry
      }
    },
    stopMCP: async () => {
      await mcpRegistry.stopAll();
    },
  };
}
```

### 3. MCP 注册表

**文件**: `src/tools/mcp-registry.ts`

```typescript
export class MCPToolRegistry {
  private servers: Map<string, RegisteredServer> = new Map();
  private toolIndex: Map<string, ToolLookup> = new Map();

  // 注册 MCP Server 配置
  registerServersConfigs(configs: MCPServersConfig): void {
    for (const [name, config] of Object.entries(configs)) {
      this.registerServerConfig(name, config);
    }
  }

  // 启动所有 MCP Server 并发现工具
  async startAll(): Promise<void> {
    for (const [name] of this.servers) {
      await this.startServer(name);
    }
  }

  // 启动单个 Server
  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    
    // 1. 启动 MCP 客户端
    const initResult = await server.client.start();
    
    // 2. 获取工具列表
    const tools = await server.client.listTools();
    server.tools = tools;

    // 3. 索引工具（两种格式）
    for (const tool of tools) {
      // 带前缀: "claude-code/write_code"
      this.toolIndex.set(`${name}/${tool.name}`, { serverName: name, tool });
      
      // 无前缀: "write_code"（如果无冲突）
      if (!this.toolIndex.has(tool.name)) {
        this.toolIndex.set(tool.name, { serverName: name, tool });
      }
    }
  }

  // 转换为 AgentTool 接口
  toAgentTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const [fullName, lookup] of this.toolIndex) {
      tools.push({
        name: fullName,
        riskLevel: "execute",
        async execute(input, context) {
          return server.client.callTool(lookup.tool.name, input);
        },
      });
    }
    return tools;
  }
}
```

### 4. MCP 客户端

**文件**: `src/tools/mcp-client.ts`

```typescript
export class MCPClient extends EventEmitter {
  // 启动 MCP Server 并完成初始化
  async start(): Promise<MCPInitializeResult> {
    // 1. 启动子进程
    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 2. 初始化握手
    const initResult = await this.sendRequest<MCPInitializeResult>(
      "initialize",
      { protocolVersion: "2024-11-05", ... }
    );

    // 3. 发送 initialized 通知
    this.sendNotification("notifications/initialized");

    return initResult;
  }

  // 列出工具
  async listTools(): Promise<MCPToolDefinition[]> {
    const response = await this.sendRequest<{ tools: MCPToolDefinition[] }>(
      "tools/list",
      {}
    );
    return response.tools;
  }

  // 调用工具
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    return this.sendRequest<MCPToolResult>("tools/call", {
      name,
      arguments: args,
    });
  }
}
```

### 5. 调用链

```
用户输入
    ↓
chat.ts: runChatSession()
    ↓
createDefaultToolRegistry(mcpServers)
    ↓
startMCP()
    ├─ MCPClient.start() → JSON-RPC initialize
    ├─ MCPClient.listTools() → JSON-RPC tools/list
    └─ toolRegistry.register(mcpTools)
    ↓
runAgentLoop({ toolRegistry })
    ↓
Provider 发出 tool_call: { name: "claude-code/write_code", arguments: {...} }
    ↓
dispatchToolCall()
    ↓
toolRegistry.get("claude-code/write_code")
    ↓
tool.execute(input, context)
    ↓
MCPClient.callTool("write_code", input)
    ↓
JSON-RPC: { method: "tools/call", params: { name: "write_code", arguments: {...} } }
    ↓
MCP Server 返回结果
```

## 工具名称解析

| 格式 | 示例 | 说明 |
|------|------|------|
| 带前缀 | `claude-code/write_code` | 明确指定 Server 和工具 |
| 无前缀 | `write_code` | 自动查找，如果无冲突 |
| 冲突时 | - | 无前缀格式只注册第一个 |

```typescript
// 注册时
this.toolIndex.set("claude-code/write_code", { serverName: "claude-code", tool });
this.toolIndex.set("write_code", { serverName: "claude-code", tool }); // 如果无冲突

// 查找时
toolRegistry.get("claude-code/write_code"); // 明确
toolRegistry.get("write_code"); // 自动
```

## 注意事项

1. **MCP Server 支持**: 外部 Agent 需要支持 MCP 协议（`--mcp` 参数）
2. **进程管理**: MCP 客户端会管理子进程的生命周期
3. **超时设置**: 默认请求超时 5 分钟，可根据需要调整
4. **环境变量**: 支持 `${VAR}` 语法引用环境变量
5. **工具名称**: 使用 `serverName/toolName` 格式确保唯一性
