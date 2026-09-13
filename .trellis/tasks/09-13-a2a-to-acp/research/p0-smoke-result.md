# Research：P0 真实 stdio 冒烟结果（2026-09-13）

## 结论：设计前提全部成立，可进 P1

脚本 `~/temp/acp-smoke/smoke.mjs`（link 到 wasteland node_modules）实测 `npx -y @zed-industries/claude-code-acp`：

```
initialize ok   proto=1  caps={promptCapabilities:{image,embeddedContext}, mcpCapabilities:{http,sse}, loadSession:true}
newSession ok   sessionId=<uuid>
update: available_commands_update   ← 首个通知,非文本
update: agent_thought_chunk ×N       ← 思考流,含 {content:{text,type:"text"}, sessionUpdate:"agent_thought_chunk"}
prompt ok       stopReason=end_turn  | updates received=11
SMOKE PASS      (+14.7s,含 npx 下载)
```

SDK 运行时导出确认：`ClientSideConnection` / `AgentSideConnection` / `ndJsonStream` / `agentClientProtocolSchema`。

## 对 design.md 的三处修正（据此更新实现）

1. **嵌套会话防护（新风险）**：claude-code-acp 检测到 `CLAUDECODE` 环境变量即拒绝启动并崩（`Error: Claude Code cannot be launched inside another Claude Code session`），`session/new` 返回 `-32603`。
   - wasteland 从普通 shell 启动时本无 `CLAUDECODE`,不受影响；但**若用户从 Claude Code 终端里跑 wasteland**,子 agent 会挂。
   - 对策：`AcpClient.spawn` 对子进程 env **主动剔除** `CLAUDECODE` / `CLAUDE_CODE_*` 一族（claude/agent 类适配器专用），并在 preset `claude_code` 的 spawn 文档注明。codex-acp 无此约束,通用剔除即可。

2. **包改名（preset 用新名）**：`@zed-industries/claude-code-acp` 已 deprecated → **`@agentclientprotocol/claude-agent-acp`（0.76.0,活跃维护)**。
   - preset `claude_code` 的 command 定为 `npx -y @agentclientprotocol/claude-agent-acp`。
   - SDK 本体包名 `@zed-industries/agent-client-protocol@0.4.5` 未见改名,沿用。

3. **通知类型比 design 预期丰富**：实见 `available_commands_update`、`agent_thought_chunk`（本次简单应答未出现 `agent_message_chunk`,但正式文本回复走该类型）。
   - `sessionUpdate` 处理需按 `update.sessionUpdate` 判别:`agent_message_chunk`→累加进 output;`agent_thought_chunk`→可选 thought,不进 output;其余(`available_commands_update`/`plan`/`tool_call*`)→仅 Logger.debug。

## 待 P1/P2 内验证

- startup 超时阈值:含 `npx -y` 冷拉 +~13s,design 定的 90s 足够;预热后可提示 `npm i -g`。
- ~~`agent_message_chunk` 的确切嵌套形状~~ **已锁定**（读 `schema.d.ts:1432-1440` + `252`）：`update: { content: ContentBlock, sessionUpdate: "agent_message_chunk" }`，`ContentBlock` 文本分支 = `{ type:"text", text: string, annotations?, _meta? }`。提取文本 = `content.type === "text" ? content.text : skip`。`agent_thought_chunk` 同形状。判别值全集：`user_message_chunk | agent_message_chunk | agent_thought_chunk | tool_call | tool_call_update | plan | available_commands_update | current_mode_update`。
