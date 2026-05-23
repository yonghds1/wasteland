# 运行时分层与契约

## 目的

本文档描述当前已经落地的 Phase 1 runtime 骨架在架构上的分层方式，并给出下一阶段的推荐演进方向。

边界说明：

- 本文档是项目级设计说明，面向人理解整体结构。
- 精确的 TypeScript 签名、字段合同、校验矩阵，以 `.trellis/spec/backend/runtime-contracts.md` 为准。

它回答三个问题：

- 现在 `chat` 命令到底是怎么穿过各层的
- 哪些类型和模块构成了当前最小合同
- 下一阶段应该把哪些能力放到哪里

---

## 当前实际链路

当前 `chat` 命令的执行链路已经固定为：

```text
命令参数 / stdin / 交互输入
  -> ChatInputTurn 流
  -> runAgentLoop(...)
  -> AgentProvider.streamReply(...)
  -> RuntimeEvent 流
  -> renderRuntimeEvents(...)
  -> SessionManager JSONL transcript
```

对应到当前代码文件：

- 命令入口：`src/commands/chat.ts`
- 输入边界：`src/ui/readline-input.ts`
- 运行时入口：`src/runtime/agent-loop.ts`
- 共享事件：`src/runtime/event-types.ts`
- provider 契约：`src/providers/provider-types.ts`
- 初始 provider：`src/providers/local.ts`
- 终端渲染：`src/ui/terminal-renderer.ts`
- session 持久化：`src/runtime/session-manager.ts`

Phase 2 还额外落下了一组独立工具运行时骨架：

- 权限闸门：`src/runtime/permission-gate.ts`
- 工具生命周期分发：`src/runtime/tool-dispatch.ts`
- 工具合同与 registry/runner：`src/tools/`
- 默认工具注册：`src/tools/default-registry.ts`

这组骨架现在已经通过 `local` provider 的 `/read <path>` 与 `/bash <command>` 路径接入 `chat` 主链，但仍然只是最小演示路径。

---

## 当前层级职责

### 1. `commands/`

职责：

- 解析 CLI 参数
- 选择输入模式
- 选择 provider
- 装配 runtime 所需依赖

不负责：

- 直接编排 turn loop
- 直接写 session transcript
- 直接渲染 provider chunk
- 直接耦合具体模型 SDK

### 2. `runtime/`

职责：

- 定义 runtime 事件模型
- 协调一个 session 内的 turn 生命周期
- 串联输入 turn、provider 输出、session 持久化

当前 runtime 公开的最小入口是：

- `runAgentLoop(...)`
- 它接收输入流、provider、session manager、cwd 和 mode
- 它输出统一的 `RuntimeEvent` 流

### 3. `providers/`

职责：

- 把模型或本地回复逻辑适配成统一的 provider 输出流

当前 provider 对外只需要满足两个核心点：

- 暴露稳定的 provider id
- 提供 `streamReply(context)`，把回复过程适配成统一事件流

当前 `ProviderStreamEvent` 已经至少有三类：

- `assistant_chunk`
- `tool_call`
- `assistant_message`

这意味着 provider 现在既可以流式吐 chunk，也可以发起工具调用；而 assistant 最终消息仍然通过统一事件流进入 runtime。

### 4. `ui/`

职责：

- 把终端输入适配为 `ChatInputTurn` 流
- 消费 `RuntimeEvent` 并渲染到终端

当前 UI 层不应：

- 直接调用 provider
- 直接操作 session 文件
- 引入命令参数解析逻辑

### 5. `session`

当前 Phase 1 仍放在 `runtime/` 下，由 `SessionManager` 承担。

职责：

- 创建 session id
- 决定 transcript 路径
- 以 JSONL 追加写入 `SessionRecord`

当前环境变量合同：

- `RX_CLI_SESSION_DIR`：可选；覆盖默认 `.rx-cli/sessions/` 目录

---

## 依赖方向

当前推荐依赖方向如下：

```text
commands -> runtime
commands -> providers
commands -> ui

runtime -> providers (contract only)
runtime -> session manager

ui -> runtime event types
providers -> runtime turn context

tools -> runtime / provider-neutral contracts
mcp -> tools / runtime contracts
```

约束规则：

- `runtime/` 不反向依赖 `commands/`
- `providers/` 不直接写终端
- `ui/` 不直接知道 provider 的实现细节
- `tools/` 未来应依赖 runtime/tool contract，而不是反向依赖 `commands/`

---

## 当前最小合同概览

这一层只保留“设计上有哪些合同”的概览，不重复维护精确签名。精确字段和校验规则请看 `.trellis/spec/backend/runtime-contracts.md`。

### 输入合同

- 输入单元是 `ChatInputTurn`
- 它至少包含：
  - turn 序号
  - 文本内容
  - 输入来源：`message` / `stdin` / `interactive`

### runtime 输出合同

- runtime 会发出一组显式事件，当前最小集合包括：
  - `session_started`
  - `user_turn`
  - `assistant_chunk`
  - `assistant_message`
  - `session_ended`

### session transcript 合同

- transcript 是独立于 runtime event 的持久化记录模型
- 当前最小记录集合包括：
  - `session`
  - `message`
  - `session_end`

这个合同意味着：

- runtime 事件和 transcript 记录是两套相邻但不同的模型
- transcript 更偏持久化记录
- runtime event 更偏渲染与编排

不要把它们合成一个“万能事件对象”，否则后面接工具调用、权限事件和恢复元数据时会变得不清晰。

---

## 下一阶段推荐落位

### 1. tools + permission gate

建议先补这一层，因为智能体 CLI 的核心差异不只是“能聊天”，而是“能安全执行动作”。

推荐文件：

```text
src/tools/
  tool-types.ts
  tool-registry.ts
  bash.ts
  read-file.ts
  edit-file.ts
  git.ts

src/runtime/
  permission-gate.ts
  tool-dispatch.ts
```

职责建议：

- `tool-types.ts`：定义 tool call / tool result 合同
- `tool-registry.ts`：注册可用工具
- `permission-gate.ts`：权限确认与策略
- `tool-dispatch.ts`：把 provider 发出的工具调用路由到工具执行层

### 2. provider registry + config

当前 `chat.ts` 里只有一个 `resolveProvider(...)`，后续应该抽成 registry。

推荐文件：

```text
src/providers/
  provider-registry.ts
  anthropic.ts
  openai.ts
```

职责建议：

- `provider-registry.ts`：按 provider id 返回 adapter
- `anthropic.ts` / `openai.ts`：各厂商 SDK 适配层

### 3. session index + resume

当前只有 transcript 追加写，没有检索和恢复元数据。

推荐文件：

```text
src/runtime/
  session-index.ts
  resume-store.ts

src/commands/
  resume.ts
  sessions.ts
```

职责建议：

- `session-index.ts`：列出和定位 session
- `resume-store.ts`：保管 resume 所需元数据
- `resume.ts`：恢复会话入口
- `sessions.ts`：列出本地 session

### 4. MCP

MCP 建议最后接入，因为它依赖工具契约已经稳定。

推荐文件：

```text
src/mcp/
  client.ts
  registry.ts
```

---

## 实施顺序建议

为了保持可运行和可测试，建议下一阶段按这个顺序推进：

1. 先补 `tools/` 契约和 `permission-gate.ts`
2. 再扩 `RuntimeEvent`，让 runtime 能表达 tool call / tool result
3. 再做 provider registry 和真实 provider
4. 然后补 session index / resume
5. 最后再接 MCP

这样可以避免一开始就把外部集成、权限、恢复逻辑和多种 provider 一起摊开，导致边界混乱。
