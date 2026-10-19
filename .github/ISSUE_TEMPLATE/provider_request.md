---
name: Provider 接入提案 (Provider Request)
about: 提议接入新的大语言模型服务商（本地引擎或云端 API）
title: '[Provider]: 支持 '
labels: ['provider', 'enhancement']
assignees: ''
---

### Provider 基本信息

- **提供商/引擎名称**: [例如 Ollama, vLLM, DeepSeek, LocalAI, AWS Bedrock, 硅基流动]
- **官网/开源仓库地址**:
- **API 文档链接**:

### 协议与能力支持

- **API 兼容协议**:
  - [ ] 完全兼容 OpenAI Chat Completions 规范
  - [ ] 兼容 Anthropic Messages 规范
  - [ ] 自定义协议 / 专有 SDK
- **核心能力支持**:
  - [ ] 流式输出 (Streaming / SSE)
  - [ ] 工具调用 / 函数调用 (Tool Calling / Function Calling)
  - [ ] 推理思考过程输出 (Thinking / Reasoning Stream)
  - [ ] 视觉与多模态 (Vision / Multimodal)

### 认证与配置规范

- **默认 Endpoint / Base URL**: `https://...`
- **所需认证凭据**: [例如 API Key, Access Token, Bearer Header, 本地免认证]
- **推荐默认模型标识**: [例如 `deepseek-chat`, `llama3:8b`]

### 预期使用场景与价值

<!-- 为什么接入该 Provider 对 Wasteland 用户有价值？例如本地离线部署、更高吞吐、更低成本或特殊推理模型支持。 -->

### 示例请求与响应 Payload

<!-- 如该 Provider 存在特殊协议头或非标准返回格式，请提供最小 CURL 示例或响应片段。 -->

```bash
curl -X POST ...
```
