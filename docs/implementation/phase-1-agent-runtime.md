# Phase 1 实施方案：真实 Agent Turn MVP

## 目标

在保留现有 CLI shell 的前提下，把当前本地 demo 风格的 `chat` 行为替换为真正的 agent-turn runtime 骨架。

---

## 范围

Phase 1 应引入：

- 运行时事件模型
- runtime 入口
- provider 抽象层
- 终端输入/输出边界
- 单次提示词模式
- stdin 管道模式
- 初始 session transcript 持久化

Phase 1 **暂不**引入：

- 完整工具执行体系
- MCP 集成
- 后台任务
- 多智能体编排

---

## 计划交付物

### Runtime

- `src/runtime/event-types.ts`
- `src/runtime/agent-loop.ts`
- `src/runtime/turn-context.ts`

### UI

- `src/ui/readline-input.ts`
- `src/ui/terminal-renderer.ts`

### Providers

- `src/providers/provider-types.ts`
- 一个初始 provider 适配器（当前为 `src/providers/local.ts`）

### Sessions

- `src/runtime/session-manager.ts`
- 位于项目自有数据目录下的本地 transcript 格式（当前默认目录为 `.rxc/sessions/`）

---

## 推荐顺序

1. 定义共享事件类型。
2. 把当前 `chat` 流程抽到 runtime 入口。
3. 拆分终端输入与终端渲染。
4. 在接具体 provider 前先建立 provider interface。
5. 加入单次提示词和 stdin 入口路径。
6. 加入最小 session 持久化。
7. 补围绕进程级行为的集成测试。

---

## 验收标准

- `chat` 不再自己持有完整对话流程。
- 存在一个可复用的 runtime 入口。
- 即使最初只接一个 provider，也已经有 provider interface。
- 交互模式和非交互模式共用同一条 runtime 路径。
- session 事件可以持久化为最小本地格式。

## 当前实现状态

本阶段已经落地：

- `src/runtime/event-types.ts`
- `src/runtime/turn-context.ts`
- `src/runtime/session-manager.ts`
- `src/runtime/agent-loop.ts`
- `src/ui/readline-input.ts`
- `src/ui/terminal-renderer.ts`
- `src/providers/provider-types.ts`
- `src/providers/local.ts`

当前仍未落地：

- 真实模型 provider
- tool runtime
- MCP client
- resume / sessions 命令

## 已验证命令

- `npm run check`
- `npm run dev -- chat --message "你好"`
- `printf 'hello' | npm run dev -- chat`
- `python3 ./.trellis/scripts/task.py validate 05-23-implement-phase-1-agent-runtime`

---

## 实施说明

- 对天然流式的链路，用 RxJS 来建模事件管线。
- 不要把厂商专有 API 塞进 command handler。
- 面向用户的终端输出应通过 renderer 边界统一处理。
- 优先使用小而命名清晰的事件阶段，而不是一条巨大且不透明的流式链。
