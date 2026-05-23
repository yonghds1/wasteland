# 智能体 CLI 架构

## 目的

本文档描述 `rx-cli` 如何从一个 CLI 原型演进为智能体 CLI 的目标架构。

---

## 当前基线

当前仓库已经具备：

- 基于 Commander 的 CLI 外壳，入口在 `src/cli.ts`
- 命令处理层位于 `src/commands/`
- 基于 RxJS 的输入/回复原型位于 `src/chat/`
- `src/runtime/` 下的 Phase 1 runtime 骨架
- `src/providers/` 下的 provider interface 和本地 provider 适配器
- `src/tools/` 下的 Phase 2 工具合同、registry/runner 骨架
- `src/tools/read-file.ts` 和 `src/tools/bash.ts` 的真实内建工具
- `src/runtime/` 下的 permission gate 和 tool dispatch
- `src/ui/` 下的终端输入/渲染边界
- 位于 `bin/` 的轻量可执行包装层
- 位于 `test/` 的进程级冒烟测试
- 位于 `.rx-cli/sessions/` 的最小本地 transcript 持久化

但它**还没有**：

- 通用的多工具对话循环
- 跨进程 resume 能力
- 真实外部模型 provider
- MCP 集成层

---

## 架构原则

### 1. 命令层保持薄

`src/commands/` 负责解析参数并做分发。命令文件不应成为堆积 agent runtime、provider 逻辑或工具编排的地方。

### 2. 对天然流式链路优先使用 RxJS

当工作流天然就是流时，默认优先使用 RxJS：

- 终端输入
- 模型流式输出
- 工具调用与工具结果事件
- 渲染/更新事件流
- 取消、中断和超时编排

但不要为了 Observable 化而牺牲清晰度。对于简单同步的领域逻辑，如果普通函数更清楚，就不要强行包成 RxJS。

### 3. 运行时边界要显式

系统应明确拆分这些层：

- CLI 外壳
- 运行时循环
- provider 适配层
- 工具执行层
- 终端 UI
- session 存储
- MCP 集成

### 4. 核心层保持 provider-neutral

runtime 应依赖 provider interface，而不是直接耦合 Anthropic/OpenAI SDK 的细节。

### 5. 工具必须经过权限边界

文件编辑、shell 命令、git 操作和外部集成都应经过显式工具边界，并支持权限策略。

### 6. 架构演进必须有文档支撑

当架构发生变化时，必须同步更新 `docs/` 下的仓库文档和 Trellis backend spec。

---

## 目标分层

### CLI 外壳层

职责：

- 解析命令行参数
- 选择执行模式
- 调用 runtime 入口

### UI 层

职责：

- 终端输入流
- 流式渲染
- 面向用户的输出格式化

### Runtime 层

职责：

- turn 编排
- 事件流组织
- 取消与超时策略
- session 协调

### Provider 层

职责：

- 模型 API 调用
- 流式 token/event 适配
- usage 上报

### Tool 层

职责：

- 内建工具
- 权限闸门
- tool-call / tool-result 标准化

### Session 层

职责：

- transcript 持久化
- resume 元数据
- 后续支持 compaction / summary

### MCP 层

职责：

- 外部工具发现
- 外部工具调用边界
- MCP server 配置

---

## 规范事件流

runtime 应围绕如下事件管线建模：

```text
用户输入
  -> turn context
  -> provider request
  -> 模型流式事件
  -> 工具调用请求
  -> 工具执行/结果
  -> 渲染事件
  -> 最终回答
  -> session 持久化
```

在这个仓库里，只要这些转换本质上是事件驱动的，默认实现偏好就是用 RxJS 管线来表达。

当前仓库已经把 `chat` 的输入、provider 输出和终端渲染通过显式边界串起来，并通过 `local` provider 的 `/read <path>` 与 `/bash <command>` 路径打通了最小工具调用链；但还没有接入真实模型 provider、通用多工具循环和 MCP。

更具体的当前运行时边界、依赖方向和下一阶段模块契约，见 [运行时分层与契约](./runtime-boundaries.md)。

---

## 参考资料

- Anthropic Claude Code Overview: https://code.claude.com/docs/en/overview
- Anthropic CLI Usage: https://code.claude.com/docs/en/cli-usage
- Anthropic Agent SDK Overview: https://code.claude.com/docs/en/agent-sdk/overview
- OpenAI Tools Guide: https://platform.openai.com/docs/guides/tools
- Model Context Protocol Introduction: https://modelcontextprotocol.io/docs/getting-started/intro
