# Provider 层

本目录当前已经承载最小 provider 抽象：

- `provider-types.ts`：`AgentProvider` 契约与 provider 流式事件
- `provider-registry.ts`：provider 注册与解析入口
- `local.ts`：本地 provider，占位用于验证 runtime 边界
- `qwen.ts`：DashScope OpenAI-compatible Chat Completions 适配器
- `assistant-events.ts`：把最终文本拆成 chunk + final message 的共享输出辅助

后续真实模型接入建议继续放在这里，例如：

- `anthropic.ts`
- `openai.ts`
