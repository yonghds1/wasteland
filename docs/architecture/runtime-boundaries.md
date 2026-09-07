# 运行时分层与契约

## 目的

本文档描述当前已经落地的 runtime、config 与 provider/tool/session 骨架在架构上的分层方式，并给出下一阶段的推荐演进方向。

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
  -> loadRxcSettings(...)
  -> resolveChatRuntime(...)
  -> ChatInputTurn 流
  -> runAgentLoop(...).events$
  -> AgentProvider.runStep(...)
  -> RuntimeEvent 流
  -> renderRuntimeEvents(...)
  -> runAgentLoop(...).debug$
  -> renderDebugTrace(...)
  -> SessionManager JSONL transcript
```

对应到当前代码文件：

- 配置入口：`src/config/load-settings.ts`
- 配置路径：`src/config/paths.ts`
- 配置类型：`src/config/settings-types.ts`
- 运行时配置解析：`src/config/resolve-chat-runtime.ts`
- 命令入口：`src/commands/chat.ts`
- 配置查看命令：`src/commands/config.ts`
- 输入边界：`src/ui/readline-input.ts`
- 运行时入口：`src/runtime/agent-loop.ts`
- 调试追踪类型：`src/runtime/debug-events.ts`
- 共享事件：`src/runtime/event-types.ts`
- 单轮运行态：`src/runtime/turn-state.ts`
- provider 契约：`src/providers/provider-types.ts`
- provider 注册表：`src/providers/provider-registry.ts`
- 共享 assistant 输出：`src/providers/assistant-events.ts`
- 当前 provider：`src/providers/local.ts`、`src/providers/qwen.ts`
- 终端渲染：`src/ui/terminal-renderer.ts`
- 调试渲染：`src/ui/debug-renderer.ts`
- session 持久化：`src/runtime/session-manager.ts`

Phase 2 还额外落下了一组独立工具运行时骨架：

- 权限闸门：`src/runtime/permission-gate.ts`
- 工具生命周期分发：`src/runtime/tool-dispatch.ts`
- 工具合同与 registry/runner：`src/tools/`
- 默认工具注册：`src/tools/default-registry.ts`

这组骨架现在已经通过 `local` provider 的 `/read <path>` 与 `/bash <command>` 路径接入 `chat` 主链，但仍然只是最小演示路径。

---

## 当前层级职责

### 1. `config/`

职责：

- 定位项目级 `.wasteland/` 和用户级 `~/.wasteland/` 配置目录
- 合并 `settings.json`、`auth.json`、个人配置、全局配置和环境变量
- 为命令层提供 provider/runtime/session 的默认值

当前配置入口包括：

- `loadRxcSettings(...)`
- `resolveChatRuntime(...)`
- `resolveDefaultSessionDir(...)`

当前结构配置优先级固定为：

1. CLI 参数
2. `WASTELAND_*` 环境变量
3. `.wasteland/settings.json`
4. `~/.wasteland/settings.json`
5. 内置默认值

当前 auth 引用优先级固定为：

1. 进程环境变量同名 key
2. `.wasteland/auth.json`
3. `~/.wasteland/auth.json`

当前已在配置层落地的多角色基线：

- `models`
- `roles`
- `runtime.defaultRole`
- `chat --role`
- `config current`

### 2. `commands/`

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

### 3. `runtime/`

职责：

- 定义 runtime 事件模型
- 协调一个 session 内的 turn 生命周期
- 串联输入 turn、provider 输出、session 持久化

当前 runtime 公开的最小入口是：

- `runAgentLoop(...)`
- 它接收输入流、provider、session manager、tool registry、permission gate、cwd 和 mode
- 它返回两条并行输出：
  - `events$`: 统一的 `RuntimeEvent` 流
  - `debug$`: 独立的 `DebugTraceEvent` 流

### 4. `providers/`

职责：

- 把模型或本地回复逻辑适配成统一的 provider 输出流

当前 provider 对外只需要满足两个核心点：

- 暴露稳定的 provider id
- 提供 `runStep({ context, state })`，把单步推理过程适配成统一事件流

当前 `ProviderStreamEvent` 已经至少有三类：

- `assistant_chunk`
- `tool_call`
- `assistant_message`

这意味着 provider 现在既可以流式吐 chunk，也可以发起工具调用；而 assistant 最终消息仍然通过统一事件流进入 runtime。与 Phase 1 不同的是，provider 不再负责“一整轮”回复，而是每次只负责“当前 turn state 下的一步”。

当前实际 provider 状态：

- `local`：用于本地工具演示与 runtime 验证
- `qwen`：通过 DashScope OpenAI-compatible Chat Completions 跑真实一轮对话
- 当前 `qwen` 版本只支持普通文本回复，不产出 `tool_call`

### 5. `ui/`

职责：

- 把终端输入适配为 `ChatInputTurn` 流
- 消费 `RuntimeEvent` 并渲染到终端

当前 UI 层不应：

- 直接调用 provider
- 直接操作 session 文件
- 引入命令参数解析逻辑

当前 UI 层还额外消费一条独立 debug trace 流：

- 普通回复继续由 `terminal-renderer.ts` 处理
- `--debug` 打开后，调试追踪由 `debug-renderer.ts` 输出到 `stderr`

### 6. `session`

当前 Phase 1 仍放在 `runtime/` 下，由 `SessionManager` 承担。

职责：

- 创建 session id
- 决定 transcript 路径
- 以 JSONL 追加写入 `SessionRecord`

当前环境变量合同：

- `WASTELAND_SESSION_DIR`：主推荐值；覆盖默认中央 transcript 目录（`~/.wasteland/data/sessions/<projectId>/`）
- `RX_CLI_SESSION_DIR`：旧兼容别名；仅用于过渡期覆盖 session 输出目录

---

## 依赖方向

当前推荐依赖方向如下：

```text
commands -> config
commands -> runtime
commands -> providers
commands -> ui

runtime -> providers (contract only)
runtime -> session manager
runtime -> config (path helpers only)

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

### debug 输出合同

- `runAgentLoop(...).debug$` 输出 `DebugTraceEvent`
- 它是独立于 `RuntimeEvent` 的调试/排障流
- 默认不参与普通 stdout 渲染

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

### 1. 真实 provider + provider 配置

多步 `agent-loop` 和 `debug trace` 已经落地；下一步应把重点转向真实 provider 接入与 provider 级配置收口。

推荐文件：

```text
src/providers/
  provider-registry.ts
  anthropic.ts
  openai.ts

src/config/
  load-settings.ts
  settings-types.ts
```

职责建议：

- `provider-registry.ts`：按 provider id 返回 adapter，并透传 provider config
- `anthropic.ts` / `openai.ts`：各厂商 SDK 适配层
- `config/`：继续收口 provider 相关配置验证与默认值

### 2. session index + resume

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

### 3. trace 持久化

当前 `--debug` 已支持向 `stderr` 输出 trace，但还没有独立的 trace 文件落盘能力。

推荐文件：

```text
src/runtime/
  debug-events.ts
  session-manager.ts

src/commands/
  chat.ts
```

职责建议：

- 为 trace 增加可选 JSONL 持久化
- 保持 trace 和 transcript 分目录、分用途管理
- 不让调试日志重新退化成 runtime 内散落的 `console.log`

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

1. 先做真实 provider 和 provider 配置收口
2. 再补 session index / resume
3. 然后补 trace 持久化与调试格式
4. 再扩更多写入类工具
5. 最后再接 MCP

这样可以避免一开始就把外部集成、恢复逻辑、复杂工具面和多种 provider 一起摊开，导致边界混乱。
