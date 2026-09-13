# Research：ACP 官方 TS SDK 可行性（P0 前置结论）

## 结论先行

**官方 SDK 完全可用，R-1 建议采纳 SDK、仅薄封装进程生命周期。** 协议层（JSON-RPC 编解码、握手、session 方法、类型校验）全部现成，wasteland 只需：① spawn 子进程并把 stdio 接到 SDK 的 `Stream`；② 实现 `Client` 接口回调；③ 把 `sessionUpdate` 桥进 RxJS。

## 包与依赖

- 包名：`@zed-industries/agent-client-protocol`（旧名；`agent-client-protocol` 未发布，本环境 registry 404）。
- 版本：`0.4.5`（本机 npm 可装，镜像 `mirrors.tencent.com`）。
- 运行时依赖：仅 `zod@^3`。
- 入口：`main: dist/acp.js`、`types: dist/acp.d.ts`；**无 `exports` 字段、无 `engines` 约束** → 从包根 import 即可（`@zed-industries/agent-client-protocol`），子路径 `dist/...` 也可 import。

## 核心 API（wasteland 作为 Client 侧）

```
ClientSideConnection(toClient: (agent: Agent) => Client, stream: Stream)
  .initialize(params) → InitializeResponse      // 握手，声明 clientCapabilities
  .newSession(params) → NewSessionResponse       // cwd + mcpServers，返回 sessionId
  .prompt(params)     → PromptResponse{stopReason}  // 一次调用得终态，无需轮询
  .cancel(params)     → void                     // session/cancel 通知
  .loadSession(...)   // 续会话（多轮）
```

- `Stream` 构造：`ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>)` —— 正是 stdio ndjson 帧。Node 侧用 `Writable.toWeb(child.stdin)` / `Readable.toWeb(child.stdout)` 适配（Node 18+ 内置，wasteland 要求 Node 20+，满足）。

## wasteland 必须实现的 `Client` 接口（agent → client 反向调用）

| 方法 | 必选 | 首版策略 |
|---|---|---|
| `requestPermission(req)` | 必选 | 见 Non-goal：首版自动批准并透传给 TUI 日志，暂不接权限闸门 |
| `sessionUpdate(note)` | 必选 | **核心**：`agent_message_chunk` 文本增量 → 聚合为结果 + 桥 Observable 供 TUI 流式 |
| `readTextFile` / `writeTextFile` | 可选 | 首版可不实现（agent 自带 fs 工具），省略即声明不支持 |
| `createTerminal` 等 terminal* | 可选 | 首版省略 |
| `extMethod` | 可选 | 省略 |

## 关键类型

- `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`（`schema.d.ts:1391`）。映射 `ToolExecutionResult`：`end_turn`→success；`refusal`/`cancelled`→error；`max_tokens`/`max_turn_requests`→success 但标注截断。
- `SessionNotification.update`：判别联合，`sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "tool_call" | ...`；文本从 `agent_message_chunk.content`（`ContentBlock`，取 `type:"text"`）累加。
- `PromptRequest.prompt: ContentBlock[]`（`{type:"text",text}` 即可，对齐旧 `createUserMessage`）。

## 参考实现（本机现成，agent 端）

`~/hermes-src/acp_adapter/`（Nous Hermes，Python，stdio-only）—— 可作行为对照：
- `server.py` `initialize` / `session/update` 通知时序（agent 在响应 prompt 前先推 update，见 server.py:1100 注释）。
- `tests/acp_adapter/` 的测法（脚本化 stdio 往返）→ 迁移到 wasteland R-5 假子进程测试。

## 风险 / 待办

1. **claude-code-acp 适配器进程契约**：`@zed-industries/claude-code-acp@0.16.2`（本机可装）。需确认其启动方式（是否 `npx @zed-industries/claude-code-acp` 即 stdio server）与是否需要 `ANTHROPIC_API_KEY` 环境透传 → implement P1 前用一次真实 spawn 冒烟验证。
2. **codex / antigravity ACP 适配器存在性**：R-3 preset 依赖。未证实前，preset 先只保留 claude_code，其余降级为"自定义 command"槽位。
3. SDK 无 `exports` 字段：确认 tsconfig `moduleResolution` 能解析包根 import（wasteland 现用 `Bundler`/`NodeNext`？implement 首步核对 tsconfig）。
4. `zod` 进 dependencies：wasteland 目前是否已有 zod？无则新增一条运行时依赖（体积评估）。
