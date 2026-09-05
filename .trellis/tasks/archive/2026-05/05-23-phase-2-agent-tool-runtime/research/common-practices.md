# Phase 2 通用做法研究

## 目的

确认一个“类似 Claude Code / 智能体 CLI”的 Phase 2，为什么应先实现 tools + permissions，而不是优先接真实 provider 或 MCP。

## 资料来源

### Anthropic Claude Code

* Claude Code Permissions:
  * https://code.claude.com/docs/en/permissions
* Claude Code Permission Modes:
  * https://code.claude.com/docs/en/permission-modes
* Claude Agent SDK Permissions:
  * https://code.claude.com/docs/en/agent-sdk/permissions

### OpenAI

* Using tools:
  * https://platform.openai.com/docs/guides/tools?api-mode=responses
* Function calling:
  * https://platform.openai.com/docs/guides/function-calling?api-mode=chat&lang=curl

### MCP

* MCP Server Concepts:
  * https://modelcontextprotocol.io/docs/learn/server-concepts
* MCP Tools:
  * https://modelcontextprotocol.io/specification/2025-06-18/server/tools
* MCP Resources:
  * https://modelcontextprotocol.io/specification/2025-03-26/server/resources

## 结论摘要

### 1. 工具调用本质上是一个多步循环

OpenAI 官方 tools / function calling 文档都把 tool calling 描述成多步链路：

1. 模型先产出 tool call
2. 应用执行工具
3. 应用把工具结果返回给模型
4. 模型再继续输出最终回复，或继续请求更多工具

这直接支持本项目的 Phase 2 方向：

* runtime 不能只支持 `assistant_chunk` 和 `assistant_message`
* 必须显式支持 tool lifecycle event
* 工具执行层必须在 provider 和 renderer 之间成为独立边界

### 2. 权限控制必须独立于工具实现

Claude Code 官方权限文档明确把权限做成独立机制：

* 有不同 permission mode
* 有 allow / deny / bypass / auto 之类的策略差异
* 工具权限规则可以叠加在模式上
* 某些危险路径即使在更宽松模式下也仍受保护

这说明 Phase 2 不应把权限判断内联进单个工具实现里，而应单独做成：

* permission gate
* permission decision event
* 可扩展的 mode / rule 模型

### 3. MCP 不是第一步，而是后接能力

MCP 官方文档把 server capability 分成三类：

* Tools：模型可主动调用的动作
* Resources：应用侧提供的上下文资源
* Prompts：用户触发的模板化提示

这说明：

* 本地 tool contract 必须先稳定
* resource / prompt 与 tool 不是一回事
* 在本地 tools、permission、transcript 事件还没稳定前，不适合直接把 MCP 提前塞进 runtime

### 4. Transcript 不能只记 user / assistant

从通用智能体 CLI 行为看，如果系统开始执行工具，但 transcript 仍只记录 user / assistant：

* 无法追踪 agent 为什么这么做
* 无法重放/调试 permission decision
* 未来 resume 会缺少必要上下文

因此 Phase 2 应把以下事件视为 transcript 一等公民：

* tool call request
* permission decision
* tool execution start
* tool result
* tool failure

## 对本仓库的直接落地建议

### MVP 顺序

1. 先定义 `src/tools/tool-types.ts`
2. 再定义 `src/runtime/permission-gate.ts`
3. 再扩展 `src/runtime/event-types.ts`
4. 再接一个最小 tool runner / registry
5. 最后才决定如何让 provider 产出 tool call

### 本阶段不做

* 不先接 MCP
* 不先接真实 provider
* 不先做 resume
* 不先做多智能体

### 原因

如果 Phase 2 跳过 tools + permissions，直接去接 provider：

* runtime 会继续停留在“聊天 CLI”
* 后面补工具执行时，会被迫推翻 event model 和 transcript model
* 架构会变成 provider 反向主导 runtime，而不是 runtime 驱动 provider / tools
