# Backend Development Guidelines

> Current backend-spec status for this repository. / 当前仓库的后端规范状态说明。

---

## Overview

This repository now contains a small Node-based agent-CLI skeleton. In this project, the backend layer currently means non-UI runtime code for the CLI: command registration, configuration loading, runtime orchestration, provider boundaries, RxJS-based input/reply pipelines, minimal session persistence, build output, and smoke tests.

当前仓库现在已经包含一个小型的 Node 智能体 CLI 骨架。在本项目里，backend 层当前指 CLI 的非 UI 运行时代码：命令注册、配置加载、runtime 编排、provider 边界、基于 RxJS 的输入/回复链路、最小 session 持久化、可执行入口、构建产物和冒烟测试。

---

## Project-Wide Policies / 项目通用规则

- Read [Communication and Language Policy](../guides/communication-language-policy.md) before writing user-facing backend rules or notes.
- Keep backend rules reality-based: only document conventions that can be traced to the current repository.
- Prefer RxJS when a backend/CLI workflow is naturally stream-shaped, such as terminal input, streamed model output, tool-call events, tool-result events, render/update events, cancellation, or timeout orchestration.
- Do not force RxJS into simple synchronous transforms where plain functions or plain objects are clearer.
- Architecture and runtime-boundary changes must be documented in repository docs, not only in task-local notes.
- `.trellis/spec/` is the normative source for executable backend rules; `docs/` explains architecture and design intent.

- 在编写面向用户的后端规则或说明前，先阅读 [Communication and Language Policy](../guides/communication-language-policy.md)。
- 后端规范必须以仓库现实为准：只能记录当前仓库中可追溯的约定。
- 如果某条 backend/CLI 工作流天然就是流式的，例如终端输入、模型流式输出、工具调用事件、工具结果事件、渲染/更新事件、取消和超时编排，默认优先用 RxJS 建模。
- 但不要为了“全都 Observable 化”而牺牲清晰度；对于简单同步转换，优先保留普通函数或普通对象模型。
- 架构和运行时边界的变更必须同步写入仓库级文档，不能只记录在 task 局部笔记里。
- `.trellis/spec/` 是后端可执行规范的真源；`docs/` 负责解释架构和设计意图。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Architecture Rules](./architecture-rules.md) | Agent Memory & Domain Boundary constraints | **New** (09-06) |
| [Memory Contracts](./memory-contracts.md) | Interfaces for IAgentMemory & multi-tenant storage | **New** (09-06) |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | **DEPRECATED** |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | Not established yet |
| [Error Handling](./error-handling.md) | Error types, handling strategies; provider HTTP 重试分类契约 | Established baseline (provider retry classification 09-15) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Established baseline |
| [Runtime Contracts](./runtime-contracts.md) | Cross-layer contracts for chat/runtime/provider/session flow; OpenAI-compatible reasoning round-trip; UserInputBridge FIFO 认领语义 | Established baseline (reasoning round-trip 09-13; bridge waiter-never-hangs 09-14) |
| [Tool Runtime Contracts](./tool-runtime-contracts.md) | Contracts for tools, permission gate, and tool lifecycle events; 确认后决策映射 (ask→allow) | Established baseline (permission decision mapping added 09-13) |
| [CLI/TUI Contracts](./cli-tui-contracts.md) | Contracts for CLI/TUI unification (InputAdapter, OutputAdapter, RuntimeContext) | Established baseline |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | Not established yet |
| [CommandRegistry](./command-registry.md) | Single-source-of-truth for slash commands; registry / handlers / UI three-layer pattern | **Established** (07-30) |

---

## How to Update These Guidelines / 后续如何更新

When backend code changes:

1. Replace "not established yet" text only after a convention is visible in real code or config.
2. Cite 2-3 representative files or commands when possible.
3. Record actual module layout, libraries, tests, and operational patterns.
4. Keep key agent-facing policy text bilingual when it changes user-facing behavior.
5. If a repository doc and a backend spec drift apart, treat the spec as authoritative and fix the doc in the same task.

当后端代码继续演进时：

1. 只有在真实代码或配置里已经出现某种约定时，才替换本目录里的“尚未建立”说明。
2. 尽量引用 2-3 个代表性文件或命令。
3. 记录真实的模块结构、库选择、测试方式和运行约定。
4. 如果规则会影响面向用户的行为，关键表述保持双语。
5. 如果仓库文档与 backend spec 出现漂移，以 spec 为准，并在同一任务里修正文档。

这些文件的目标，是帮助 AI agent 和后续维护者理解“这个仓库当前真实存在什么规范”。

---

## Evidence Used For This Baseline / 当前基线依据

- `.trellis/workflow.md`
- `.claude/settings.json`
- `.cursor/hooks.json`
- `package.json`
- `tsconfig.json`
- `bin/rxc.js`
- `src/cli.ts`
- `src/commands/config.ts`
- `src/commands/hello.ts`
- `src/commands/chat.ts`
- `src/chat/reply-pipeline.ts`
- `src/config/load-settings.ts`
- `src/config/paths.ts`
- `src/config/resolve-chat-runtime.ts`
- `src/config/settings-types.ts`
- `src/runtime/event-types.ts`
- `src/runtime/turn-context.ts`
- `src/runtime/turn-state.ts`
- `src/runtime/session-manager.ts`
- `src/runtime/agent-loop.ts`
- `src/runtime/permission-gate.ts`
- `src/runtime/tool-dispatch.ts`
- `src/providers/provider-types.ts`
- `src/providers/provider-registry.ts`
- `src/providers/local.ts`
- `src/providers/qwen.ts`
- `src/providers/assistant-events.ts`
- `src/providers/openai-compatible/index.ts`
- `src/providers/openai-compatible/types.ts`
- `src/providers/openai-compatible/tool-adapter.ts`
- `src/providers/openai-compatible/message-builder.ts`
- `src/tools/bash.ts`
- `src/tools/default-registry.ts`
- `src/tools/read-file.ts`
- `src/tools/edit-file.ts`
- `src/tools/write-file.ts`
- `src/tools/tool-types.ts`
- `src/tools/tool-registry.ts`
- `src/tools/tool-runner.ts`
- `src/ui/readline-input.ts`
- `src/ui/terminal-renderer.ts`
- `src/ui/terminal-theme.ts`
- `docs/architecture/agent-cli.md`
- `docs/architecture/runtime-boundaries.md`
- `docs/project-structure.md`
- `docs/implementation/phase-1-agent-runtime.md`
- `docs/implementation/phase-2-agent-tool-runtime.md`
- `test/cli.test.js`
- `test/tool-runtime.test.js`
