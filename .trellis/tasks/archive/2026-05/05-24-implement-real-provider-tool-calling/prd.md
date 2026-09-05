# implement real provider tool calling

## Goal

让 `qwen` provider 能真正发起 tool calling，支持 `read-file`、`bash`、`edit-file`、`write-file` 工具调用，使 CLI 成为真正的编码助手。

## What I already know

* 当前 `qwen` provider 只支持纯文本对话，不支持 tool calling
* `local` provider 通过硬编码的 `/read`、`/bash` 语法模拟 tool calling
* OpenAI/Qwen API 使用 `tools` 数组定义工具，响应中 `tool_calls[]` 包含工具调用
* 工具参数是 JSON 字符串，需要解析
* 工具结果以 `role: 'tool'` 消息形式返回
* Qwen API 兼容 OpenAI 格式

## Assumptions (temporary)

* 只支持非流式 tool calling（符合行业主流做法）
* 只支持 Qwen provider，OpenAI/Anthropic 作为未来扩展
* 工具定义转换在 provider 中实现
* 文本生成保持流式，工具调用使用非流式

## Open Questions

（已全部解决）

## Requirements (evolving)

* [x] 抽离 OpenAI 兼容模块供多个 provider 复用
* [x] 扩展 qwen provider 支持 tool calling
* [x] 实现工具定义转换：ToolRegistry → OpenAI tools 格式
* [x] 实现工具调用解析：OpenAI tool_calls → ToolCall
* [x] 实现工具结果转换：ToolExecutionResult → OpenAI tool messages（批量返回）
* [x] 支持多轮工具调用循环
* [x] 文本生成保持流式，工具调用使用非流式
* [x] 工具参数解析失败时返回错误给模型，让模型有机会修正

## Acceptance Criteria (evolving)

* [x] qwen provider 能正确发送 tools 定义到 API
* [x] qwen provider 能正确解析 tool_calls 响应并发送 ProviderStreamEvent
* [x] qwen provider 能正确构建包含工具结果的 messages
* [x] 多轮工具调用能正确循环（tool_call → execute → result → next step）
* [x] 工具参数解析失败时返回错误给模型
* [x] `npm run check` 通过

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 流式 tool calling
* OpenAI/Anthropic provider
* MCP 集成
* 新增工具

## Technical Notes

* 相关文件：
  * `src/providers/qwen.ts` — 已扩展支持 tool calling
  * `src/providers/openai-compatible/` — 新增模块，包含类型定义、工具转换、消息构建
  * `src/providers/provider-types.ts` — 无需修改
  * `src/tools/tool-registry.ts` — 新增 `list()` 方法
  * `src/runtime/turn-context.ts` — 新增 `toolRegistry` 字段
  * `src/runtime/turn-state.ts` — TurnToolResult 新增 `input` 字段
  * `src/runtime/agent-loop.ts` — 更新以传递 toolRegistry 到 context
* 研究文档：`research/tool-calling-api-patterns.md`

## Research References

* [`research/tool-calling-api-patterns.md`](research/tool-calling-api-patterns.md) — OpenAI vs Anthropic tool calling API 格式对比
* [`research/streaming-tool-calling-practices.md`](research/streaming-tool-calling-practices.md) — 行业流式 tool calling 实践

## Technical Approach

### 核心改动

1. **抽离 `openai-compatible` 模块**：供 Qwen、DeepSeek、智谱 GLM 等 OpenAI 兼容 provider 复用

2. **扩展 `qwen.ts` 支持完整的 tool calling 流程**：

```
runStep() 被调用
     ↓
构建 messages（包含历史 + 工具结果）
     ↓
发送请求（带 tools 定义）
     ↓
收到响应
     ├─ finish_reason: "stop" → 文本响应 → 流式事件
     └─ finish_reason: "tool_calls" → tool_call 事件
```

### 关键文件

#### `src/providers/openai-compatible/types.ts`
OpenAI API 类型定义：
- `OpenAIFunctionTool`: 工具定义格式
- `OpenAIToolCall`: 工具调用响应格式
- `OpenAIToolMessage`: 工具结果消息格式
- `OpenAIChatCompletionResponse`: API 响应格式

#### `src/providers/openai-compatible/tool-adapter.ts`
工具转换函数：
- `buildOpenAITools(registry)`: ToolRegistry → OpenAI tools 数组
- `parseToolCalls(toolCalls)`: OpenAI tool_calls → ToolCall[]
- `hasParseError(call)` / `getParseErrorMessage(call)`: 解析错误处理

#### `src/providers/openai-compatible/message-builder.ts`
消息构建函数：
- `buildMessages({ history, input, toolResults })`: 构建完整消息数组
- `buildToolResultMessages(results)`: 批量转换工具结果
- `needsToolLoop(messages)`: 检查是否需要继续工具循环

#### `src/providers/qwen.ts`
Provider 实现：
- 使用 `buildMessages` 构建请求消息
- 使用 `buildOpenAITools` 构建工具定义
- 使用 `handleQwenResponse` 处理响应并分发事件

### 数据流

```
ProviderStepInput
  ├─ context.history (SessionMessageRecord[])
  ├─ context.input (用户输入)
  ├─ context.toolRegistry (工具注册表)
  └─ state.toolResults (工具执行结果)
         ↓
    buildMessages()
         ↓
    OpenAI messages format
         ↓
    API request with tools
         ↓
    Response
         ├─ assistant_message → createAssistantTextEvents()
         └─ tool_calls → from(toolCalls.map(...))
```

### 与现有架构的集成

- `agent-loop.ts` 已支持 `tool_call` 事件处理
- `TurnState.toolResults` 已累积工具结果
- `runTurnLoop` 已实现多步循环
- `TurnContext` 现在包含 `toolRegistry` 供 Provider 使用
- 所有 OpenAI 兼容 provider 可复用 `openai-compatible` 模块
