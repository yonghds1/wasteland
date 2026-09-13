# A2A 协作迁移至 ACP

## 背景（现状，勿重新推导）

wasteland 当前的"远程 Agent 协作"基于 **Google A2A 协议**（HTTP + SSE），代码集中在 `src/acp/a2a-*.ts`，非测试文件 23 个、约 312 处 `a2a` 引用。两条链路：

- **出站**：`A2AClient`（`src/acp/a2a-client.ts`）对每个配置 agent 走 `POST /tasks/send` + 轮询 `GET /tasks/{id}` + SSE 订阅；每个 agent 注册为直接工具 `a2a_<name>`（`src/tools/agent/a2a-agent-tool.ts`，工厂 `createA2AAgentTool`，`riskLevel: 'execute'`）。
- **本机托管**：`a2a-claude-code-adapter.ts` 的 `createClaudeCodeA2AServer` 起 HTTP server（默认端口 9041），由 `initialize-runtime.ts` 拉起进程，供上面的出站 client 回环调用。

配置块 `settings.a2a`（`~/.wasteland/settings.json`）：`agents: [{name,url,token?,description?}]` + `servers: {name:{enabled,port,command}}`。周边：`a2a-presets.ts`（claude_code / codex / antigravity，端口 9041-9043）、`a2a-webhook.ts`、`a2a-registry.ts`。

目标协议 **ACP（Agent Client Protocol，agentclientprotocol.com，Zed 主导）**：stdio 上的 **newline-delimited JSON-RPC 2.0**，无 HTTP / 端口 / webhook / Agent Card 发现。核心方法 `initialize → session/new → session/prompt`（流式回 `session/update` 通知，`stopReason` 即终态）+ 反向 `session/request_permission` + `session/cancel`。本机 `~/hermes-src/acp_adapter/` 是现成 ACP agent 端参考实现（Nous Hermes，stdio-only）。

## Goal

把出站协作链路从 A2A 换为 ACP：wasteland 作为 **ACP client**，把 `claude-code-acp` 等适配器作为**子进程 spawn**，经 stdio JSON-RPC 调用；工具形态（每个远程 agent = 一个 `acp_<name>` 工具）、权限闸门、子 agent 继承、TUI 展示均保持等价。**彻底删除 HTTP server 托管链路**（ACP 下无必要）。

## Requirements

### R-1 协议客户端

- 新增 `src/acp/acp-client.ts`：spawn 子进程（`command` / `args` / `env` / `cwd`）、stdio ndjson JSON-RPC 收发、`initialize` 握手、session 生命周期（new / prompt / cancel）、`session/update` 通知 → 桥接为现有 RxJS `Observable`。
- **优先评估官方 TS SDK**（npm `@zed-industries/agent-client-protocol`）：能覆盖协议层则依赖之，仅薄封装进程生命周期与 Observable 适配；SDK 不满足才手写。**P0 必须先做 SDK 可行性研究并落 `research/`**。
- 进程退出 / stderr 需捕获并转为错误结果，工具契约不抛异常（对齐现 `a2a-agent-tool` 的 try/catch 语义）。

### R-2 工具层等价迁移

- `a2a-agent-tool.ts` → `acp-agent-tool.ts`，工具名 `acp_<name>`，前缀常量 `ACP_TOOL_PREFIX = 'acp_'`。
- 入参仍为 `{ task }`；执行改为 `session/prompt` 一次调用，`stopReason` 映射到 `ToolExecutionResult`：`end_turn` → success（取 agent 文本 chunk 聚合），`refusal` / `cancelled` / 错误 → error。删除 `sendTaskAsync` + `waitForTask` 轮询。
- `default-registry.ts` 换注册工厂与放行前缀（`filterToolRegistry`）。

### R-3 配置块迁移

- `settings-types.ts` 新增 `ACPSettings = { agents: AcpAgentConfig[] }`，`AcpAgentConfig = { name, command, args?, env?, cwd?, description? }`（stdio 本地信任，**去掉 url / token / Bearer**）。
- `LoadedSettings.a2a` → `acp`，默认 `{ agents: [] }`；`validate-settings` / `settings-merge` / `settings-env-auth` / `config-writer` / `load-settings` 同步改。
- `a2a-presets.ts` → ACP 版：claude_code → `npx @zed-industries/claude-code-acp`；codex → 社区 ACP 适配器（**P0 查证存在性**，无则降级为自定义 command 并从 preset 移除）；antigravity → 同查证。
- **旧配置兼容**：`load-settings` 读到残留 `a2a` 块时打印一次性迁移提示（url 无法自动转 command，需人工改 command），不静默丢弃、不静默报错。

### R-4 旧链路下线

删除：`a2a-claude-code-adapter.ts`、`a2a-webhook.ts`、`a2a-registry.ts`、`a2a-client.ts`、`a2a-types.ts`；`initialize-runtime.ts` 删 server 托管段（含 `a2aManager` / `stopA2AServers` 及起进程逻辑）与相关 import。

### R-5 测试防线

- 现有 `a2a-*.test.ts`（约 9 个）按新边界重写为 `acp-*`；client 用假子进程（脚本化 ndjson 应答）或 SDK mock。参考 `~/hermes-src/tests/acp_adapter/` 测法。
- 覆盖：initialize 握手、prompt → update 流聚合、stopReason 各分支、子进程异常退出、配置校验、旧 a2a 块迁移提示。
- `npm test` / `npm run typecheck` / eslint 全绿。

### R-6 端到端验证（用户环境实测）

配置一个 claude-code ACP agent，TUI 内通过 `acp_claude-code` 工具下发任务、流式渲染、正常返回结果。**此项由用户实测确认**。

## Acceptance Criteria

- [ ] 一个 ACP agent 经 `acp_<name>` 工具可下发任务并拿到结果（用户实测 R-6）。
- [ ] `session/update` 通知在 TUI 实时流式展示，与旧 SSE 展示等价。
- [ ] 子进程异常退出 / 超时 → 工具返回 error，不抛异常、不卡死。
- [ ] 全库 `grep -i a2a`（除 archive、本 task 文档、迁移提示文案）零命中。
- [ ] 旧 `settings.json` 的 `a2a` 块 → 加载时打印可读迁移提示，不静默生效也不静默报错。
- [ ] `npm test` / `typecheck` / eslint 全绿。

## Non-goals

- **wasteland 自身作为 ACP agent 供 Zed 等编辑器反向调用（入站 agent 端）** —— 独立 feature，本次不做（现 `a2a.servers` 仅是自托管回环，非真入站）。
- 多模态 MessagePart（file / data）富传输：A2A 里本就未实际用到，ACP 首版仅 text prompt。
- `session/request_permission` 反向授权深度集成：首版工具级闸门仍由 wasteland 侧 `riskLevel` 把控，agent 反向请求先透传 / 自动批准（记 design 待办）。

## 三步走策略（回退优先）

采用**并存 → 切换 → 清理**，而非一次性删除，避免 ACP 适配器或 codex / antigravity 支持踩坑时协作功能整体瘫痪：

1. **并存**：ACP 链路完整落地并跑通，A2A 代码暂留但不再注册工具。
2. **切换**：默认工具 / 配置切到 ACP，验证端到端。
3. **清理**：删除 R-4 列出的旧文件与旧配置读写。

> 回退点：阶段 3 之前任一环节出问题可回退到上一阶段（旧 A2A 代码始终在树里直到清理步）。
