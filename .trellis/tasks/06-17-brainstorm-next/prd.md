# brainstorm: MCP 协议完善

## Goal

完善 wasteland 的 MCP（Model Context Protocol）协议实现，补全 SSE 传输、Resources 和 Prompts 功能，提升与 MCP 服务器的兼容性和功能性。

## Requirements

### 功能需求

1. **SSE 传输支持**
   - 创建 `Transport` 接口，抽象传输层
   - 实现 `StdioTransport`（现有功能封装）
   - 实现 `SseTransport`（新的 HTTP SSE 传输）
   - 支持配置：`{ "url": "https://..." }` 格式

2. **Resources 功能**
   - 实现 `resources/list` 方法：获取服务器暴露的资源列表
   - 实现 `resources/read` 方法：读取资源内容
   - 将 Resources 包装为 `AgentTool`：`mcp-resource-list` 和 `mcp-resource-read`

3. **Prompts 功能**
   - 实现 `prompts/list` 方法：获取服务器提供的提示词模板
   - 实现 `prompts/get` 方法：获取提示词模板内容
   - 将 Prompts 包装为 `AgentTool`：`mcp-prompt-list` 和 `mcp-prompt-get`

### 非功能需求

1. **兼容性**：保持与现有 stdio 传输的完全兼容
2. **错误处理**：SSE 连接失败不阻塞其他 MCP 服务器
3. **类型安全**：完整的 TypeScript 类型定义

## Acceptance Criteria

- [ ] SSE 传输可以连接远程 MCP 服务器
- [ ] Resources/list 返回正确的资源列表
- [ ] Resources/read 返回正确的资源内容
- [ ] Prompts/list 返回正确的提示词模板列表
- [ ] Prompts/get 返回正确的提示词模板内容
- [ ] 所有现有 315 个测试通过
- [ ] 新增 MCP 功能相关的单元测试和集成测试
- [ ] TypeScript 编译无错误

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* SSE 认证（API Key、OAuth）
* Resources 缓存
* Sampling 功能
* Progress Reporting
* Cancellation 支持
* Roots 支持

## Technical Approach

### 传输抽象层

```typescript
// 传输接口
interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  onError(handler: (error: Error) => void): void;
}

// stdio 传输（现有功能封装）
class StdioTransport implements Transport { ... }

// SSE 传输（新实现）
class SseTransport implements Transport { ... }
```

### Resources 工具

```typescript
// mcp-resource-list: 获取资源列表
class McpResourceListTool implements AgentTool {
  name = 'mcp-resource-list';
  execute(input: { server?: string }): Promise<ToolResult> { ... }
}

// mcp-resource-read: 读取资源内容
class McpResourceReadTool implements AgentTool {
  name = 'mcp-resource-read';
  execute(input: { uri: string; server?: string }): Promise<ToolResult> { ... }
}
```

### Prompts 工具

```typescript
// mcp-prompt-list: 获取提示词模板列表
class McpPromptListTool implements AgentTool {
  name = 'mcp-prompt-list';
  execute(input: { server?: string }): Promise<ToolResult> { ... }
}

// mcp-prompt-get: 获取提示词模板内容
class McpPromptGetTool implements AgentTool {
  name = 'mcp-prompt-get';
  execute(input: { name: string; arguments?: Record<string, unknown>; server?: string }): Promise<ToolResult> { ... }
}
```

## Implementation Plan (small PRs)

### PR1: 传输抽象层
- 创建 `Transport` 接口
- 封装现有 stdio 传输为 `StdioTransport`
- 实现 `SseTransport`
- 修改 `MCPClient` 使用 `Transport` 接口
- 添加传输层单元测试

### PR2: Resources 功能
- 实现 `resources/list` 方法
- 实现 `resources/read` 方法
- 创建 `McpResourceListTool` 和 `McpResourceReadTool`
- 在 `MCPToolRegistry` 中注册 Resources 工具
- 添加 Resources 相关测试

### PR3: Prompts 功能
- 实现 `prompts/list` 方法
- 实现 `prompts/get` 方法
- 创建 `McpPromptListTool` 和 `McpPromptGetTool`
- 在 `MCPToolRegistry` 中注册 Prompts 工具
- 添加 Prompts 相关测试

### PR4: 集成测试 + 文档
- 添加端到端集成测试
- 更新 README 和用户指南
- 更新 CHANGELOG

## Technical Notes

* 关键文件：`src/tools/mcp-client.ts`, `src/tools/mcp-registry.ts`
* 协议版本：`2024-11-05`
* 代码库路径：/home/ubuntu/workspace/rx-cli
* Trellis 管理：.trellis/ 目录
