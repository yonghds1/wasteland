# Design：A2A → ACP 迁移

> 依据：`prd.md`（需求与三步走）、`research/acp-sdk-feasibility.md`（SDK 结论，先读）。

## 总体形态

```
主/子 Agent ──调用工具 acp_<name>──► AcpAgentTool (tools/agent/acp-agent-tool.ts)
                                          │ createSession → prompt(task)
                                          ▼
                             AcpClient (src/acp/acp-client.ts, 薄封装)
                                          │ @zed-industries/agent-client-protocol
                                          │ ClientSideConnection + ndJsonStream
                                          ▼
                             child_process.spawn(command, args, {env, cwd})
                             （claude-code-acp / codex-acp / 自定义 stdio agent）
```

与 A2A 的结构性差异：无端口、无 URL、无 token/Bearer、无轮询、无 webhook、无 Agent Card。一次 `prompt()` 调用即完整生命周期，`stopReason` 即终态。

## 边界与不变量

- **不动**：ToolRegistry 机制、`riskLevel:'execute'` 权限闸门、`filterToolRegistry` 前缀放行逻辑（只换前缀字符串）、spawn_agent 子 agent 继承、TUI 组件层。
- **acp 模块内部**（并存阶段两协议共存，互不 import）：
  - `src/acp/acp-types.ts` — `AcpAgentConfig` 之外的内部类型极少：SDK 的 `schema.*` 直接 re-export 使用，不自定义重复协议类型（这是与 A2A 手写 `a2a-types.ts` 最大的不同——协议类型交给 SDK）。
  - `src/acp/acp-client.ts` — `AcpClient`：拥有子进程 + 连接 + 一个 session。API 收敛为三个方法：
    - `static spawn(cfg: AcpAgentLaunchConfig): Promise<AcpClient>`（spawn → `initialize` 握手，失败即 throw，含 stderr 尾部诊断）
    - `prompt(text, onUpdate?): Promise<{stopReason, text}>`（内部 `newSession`；`onUpdate` 收到聚合文本增量，供 TUI 流式）
    - `dispose()`（`session/cancel` + kill 子进程，幂等）
  - **生命周期 = 每次工具调用**：spawn → prompt → dispose。不做进程池/常驻（旧 A2A server 常驻是因 HTTP 语义；stdio 子进程按任务起停更简单且无孤儿进程风险）。超时用 `AbortController`/deadline 包裹 `prompt()`，超时即 dispose。
- **Client 回调策略**（首版，见 prd Non-goal）：
  - `sessionUpdate`：只处理 `agent_message_chunk`（文本累加 + onUpdate 转发）；`agent_thought_chunk` 累加为可选 `thought` 不进 output；其余（plan/tool_call）仅 Logger.debug。
  - `requestPermission`：自动选 `allow_once` 并 Logger.warn 记录（工具级闸门已在 wasteland 侧把过）。
  - fs/terminal 可选方法：不实现（SDK 将返回 method-not-found，agent 自行降级）。
- **Observable 桥**：`prompt` 本身是 Promise，流式经 `onUpdate` 回调透出；`useRuntime` / logs 页现有 SSEEvent 消费点改接 `AcpStreamEvent = {kind:'chunk'|'done'|'error', text?, stopReason?}`（定义在 acp-client.ts，替代旧 SSEEvent 用途）。

## 配置 schema（settings.json）

```jsonc
"acp": {
  "agents": [
    { "name": "claude_code",          // 工具名后缀 acp_<name>
      "command": "npx",                // 必填：stdio agent 启动命令
      "args": ["-y", "@zed-industries/claude-code-acp"],
      "env": {},                       // 可选,追加到 process.env
      "cwd": "~/code/x",               // 可选,默认 process.cwd()
      "description": "…" }             // 供 LLM 发现工具用途
  ],
  "defaults": { "timeoutMs": 300000 }  // 可选;工具级超时,默认 5 分钟(编码任务长)
}
```

- 校验（validate-settings）：name 匹配 `^[A-Za-z0-9_-]+$` 且非空、command 非空字符串、args 字符串数组、name 全表唯一。
- **迁移检测**：load-settings 若发现顶层 `a2a` 块 → stderr 打印一次提示（列出旧 agents → 建议的 acp.agents 等价 command 写法，claude-code 命中 preset 时直接给出可粘贴 JSON），旧块**不生效**；不自动写入用户文件。
- presets（`acp-presets.ts` 替代 `a2a-presets.ts`）：claude_code → `npx -y @agentclientprotocol/claude-agent-acp`（旧 `@zed-industries/claude-code-acp` 已 deprecated，P0 实测确认新名 0.76.0 活跃）；codex → `npx -y @zed-industries/codex-acp`（**已查证存在于本 registry，0.16.0**）；antigravity → 无已证实适配器，**从 presets 移除**，向导里留"自定义 command"入口。
- **子进程 env 净化（P0 实测新增）**：claude-code-acp 检测到 `CLAUDECODE`/`CLAUDE_CODE_*` 即拒绝启动（"cannot be launched inside another Claude Code session"，session/new 返 -32603）。`AcpClient.spawn` 从继承 env 中**剔除** `CLAUDECODE` 与 `CLAUDE_CODE_*`（保留 `ANTHROPIC_*`），避免用户从 Claude Code 终端里跑 wasteland 时子 agent 崩。见 `research/p0-smoke-result.md`。

## 依赖决策

- `@zed-industries/agent-client-protocol@^0.4.5` 进 `dependencies`。
- 冲突预研：该包 deps `zod@^3`，项目锁 `zod@^4.4.3` → npm 会嵌套安装 SDK 自己的 zod3（非 peer，不冲突）；`typecheck` 时验证两套 zod 类型不互相泄漏到公共签名（SDK 导出的 schema 类型只在 acp-client.ts 内部消化，工具层只看到 `stopReason`/`text` 原始类型）。
- `tsconfig moduleResolution: NodeNext` + 该包无 `exports` 字段 → 包根 import 可行（main/types 齐全），无需改 tsconfig。

## 并存 → 切换 → 清理（对应三个阶段 commit 边界）

| 阶段 | 树内状态 | 回滚方式 |
|---|---|---|
| P1 并存 | 新增 acp-client/tool/settings 分支；registry 默认仍注册 a2a 工具（acp 工具仅在 `settings.acp` 非空时注册——两协议可同开，但配置面互不重叠） | revert acp 新增 commit |
| P2 切换 | 用户配置迁移（文档 + 向导默认 ACP）；`a2a.servers` 托管段删除（HTTP server 链路唯一不可逆点，但删除即恢复 revert） | revert 切换 commit，A2A 工具重新可见 |
| P3 清理 | 删全部 `a2a-*` 文件/类型/文案/测试，locale 清理，README/CHANGELOG | 一般无需回滚；git 历史可寻 |

- TUI：向导（`src/tui/wizard/`）A2A 页改为 ACP 页（P2 改，P3 删旧文案 key）；logs 页 scope `'a2a'` → `'acp'`。
- 单文件 500 行红线：acp-client.ts 预估 ~260 行（协议逻辑在 SDK），无拆分压力。

## 风险清单

1. **npx 首拉延迟**：`npx -y` 首次下载适配器可达数十秒 → spawn 后 `initialize` 握手的 startup 超时独立于 prompt 超时（默认 90s），文档提示可预先 `npm i -g`。
2. **子进程僵尸**：dispose 必须挂 `exit`/`error` 双事件清理；工具超时路径强制 kill（`child.kill('SIGKILL')` 兜底）。TUI 退出时 runtime shutdown 不再需要 a2aManager（无常驻进程）。
3. **stderr 噪音**：claude-code-acp 可能向 stderr 打日志 → 累积尾部 4KB 进错误消息，不丢弃也不刷屏。
4. **SDK zod3 类型渗漏**：若 typecheck 出现双 zod 版本类型互不兼容 → 兜底方案是 acp-client.ts 边界处全部转原始类型（已按此设计），不对外暴露 schema 类型。
