# PRD: 单/多 agent 模式切换 + A2A 配置重设计

## 背景

Wasteland 的 `runtime.mode: 'single'|'multi'` 当前几乎是"装饰位"——全项目只有 `src/core/shared/initialize-runtime.ts:127-132` 消费它一次（仅选主 skin），不影响工具白名单/提示词/provider；`spawn_agent` 无论 single/multi 永远可用。A2A 则寄生在 `multiAgent[x].mode:'a2a'/a2aServer` 里，通过一条**已被 pre-dispatch hook 截胡、永不可达**的 spawn 路由实现（孤儿代码）。更严重：`parseSettings` 根本不解析 `a2aAgents/a2aServers/mcpServers`，A2A 配置从未生效。

本任务让 single/multi 成为真实可感的开关，并把 A2A 重设计为"主/单 agent 直接调用的工具 + 独立顶层配置"。

## 已确认的设计决策

1. **切换方式**：`/mode` 斜杠命令（写回配置，**重启生效**）+ `--mode <single|multi>` 启动参数（启动时覆盖）。**不做** turn 中途热切换（loop 闭包固化）。
2. **single 语义** = 完整取 `singleAgent` 配置（`skin` + `model` + `promptTemplate`）+ 去掉多角色提示词；**不**禁用 spawn_agent。
3. **A2A** = 直接工具（`a2a_<name>`），single/multi **统一机制**，**子 agent 经继承默认也能调**。
4. **A2A 配置** = 合并为顶层 `a2a` 块（`agents` + `servers`），与 `multiAgent` 同级；删除嵌套 `multiAgent[x].mode/a2aServer`。

## 关键代码事实（已核实）

- `parseSettings`（`src/config/load-settings.ts:197-443`）只有 7 个 key 分支（defaultProvider/providers/models/multiAgent/singleAgent/runtime/parallel），**`a2aAgents/a2aServers/mcpServers` 被静默丢弃**。
- `mergeSettings`（load-settings.ts:560-592）return 漏 `singleAgent` → single skin 永不生效。
- 主 agent 工具被 `filterToolRegistry`（`src/core/runtime/agent-loop.ts:98/111`）过滤成 `{spawn_agent,read-file,bash}`；**子 agent 继承的是过滤后 registry**（`src/tools/spawn-agent/dispatch-handler.ts:144`）。故 `a2a_*` 工具须穿过过滤白名单，子 agent 才能经继承拿到。
- `src/tools/a2a-spawn-agent.ts` 是孤儿死代码（被 hook 截胡），删除。
- 四个同名 `mode`：配置 `single|multi`、`RuntimeMode='single'|'interactive'`（event-types.ts:21）、per-agent `llm|a2a`、`PermissionMode`。**新代码一律用 `agentMode`**。
- 迁移负担≈0（A2A 配置从未生效）：只需迁 `.wasteland/settings.json` + `examples/a2a-test-server.ts` 注释。

## 目标 A2A schema（与 multiAgent 同级）

```jsonc
"a2a": {
  "agents":  [ { "name": "codex", "url": "http://localhost:9200", "description": "...", "token": "$auth:..." } ],
  "servers": { "claude-code": { "enabled": true, "port": 9200, "command": "claude", "description": "..." } }
}
```
- `agents` = 出站调用的远程 agent → 每个成为工具 `a2a_<name>`（description 供 LLM 发现）。
- `servers` = 本机启动托管的 A2A server（`createClaudeCodeA2AServer`），与工具无关。

## 实施阶段（依赖顺序）

### Phase 0 — 前置 bug 修复（阻塞后续）
- **P0-1** `parseSettings` 补 `a2a`（新 schema）parse 分支 + 校验；核实并补 `mcpServers` parse 分支（若缺）。
- **P0-2** `mergeSettings` return 块（L564/565 间）补 `singleAgent` 字段级浅合并；统一 `a2a` merge 语义（servers 按名浅合并、agents 按 name 去重）。

### Phase 1 — A2A schema 重设计
- `src/config/settings-types.ts`：新增 `A2ASettings={agents,servers}`；`A2AAgentConfig` 加 `description?`；顶层用 `a2a?: A2ASettings` 替换 `a2aAgents/a2aServers`；`SubAgentSettings` 删除 `mode/a2aServer`；`DEFAULT_WASTELAND_SETTINGS` 同步。
- `src/config/load-settings.ts`：parse/merge/auth-resolve（L722-727）/env-copy（L766-767）改 `a2a` 结构；`validateRoleSettings`（L140-152）删 mode/a2aServer 校验。
- 迁移 `.wasteland/settings.json` + `examples/a2a-test-server.ts:16-25`。

### Phase 2 — A2A 作为直接工具
- 新建 `src/tools/a2a-agent-tool.ts`：`createA2AAgentTool(agent)`，name=`a2a_<name>`，execute=`A2AClient.sendTaskAsync + waitForTask` → 提取 artifacts/status（可抽 a2a-spawn-agent.ts:88-131）。
- `src/tools/default-registry.ts`：`createDefaultToolRegistry` 改选项对象签名；注册 `a2a.agents` 工具；删除 `createA2ASpawnAgentTool` 覆盖段（L168-179）+ 旧 A2AAgentRegistry 注册（L129-166）。
- 删除 `src/tools/a2a-spawn-agent.ts`。
- `filterToolRegistry`（agent-loop.ts:111-121）放行 `a2a_` 前缀（或三入口并白名单）。
- 子 agent 继承零改动（context-builder.ts:163-167 自动带上）。
- `initialize-runtime.ts`：`a2a.servers` 启动逻辑保留；修 `stopA2AServers` 零调用方泄漏（useRuntime.ts:150/180 接上）。

### Phase 3 — `--mode` 启动参数 + mode 感知
- `InitializeRuntimeParams`（initialize-runtime.ts:72-81）加 `mode?`；L127 `const agentMode = params.mode ?? settings.runtime.mode ?? 'single'`。
- chat.ts L159 / tui.ts L20 / resume.ts L82 加 `.option('--mode <mode>', ...)`；透传 `initializeRuntime`；TUI 经 `createTuiRuntime`（useRuntime.ts:44-53）。
- 类型护栏：`'single'|'multi'` ≠ `RuntimeMode`；不碰 `runChatSession({mode})`。

### Phase 4 — single 语义生效
- 换主 skin：P0-2 后 initialize-runtime:128-132 分支生效。
- `singleAgent.model/promptTemplate`（`src/config/resolve-chat-runtime.ts`，net-new）：mode-aware 接线。
- `injectOrchestratorAgents`（resolve-chat-runtime.ts:86-108）mode-aware：single 不注入多角色清单。需把 `agentMode` 透传进 resolveChatRuntime。

### Phase 5 — `/mode` 命令
handler 只返回 action，异步落地放 App.tsx 拦截层（同 /logs）：
1. command-registry-builtin.ts entry（handlerType `mode-switch`）
2. command-types.ts 加 `'mode-switch'`
3. command-handlers.ts `'mode-switch': ()=>({handled:true,action:'mode'})`
4. local-commands.ts action 联合加 `'mode'`
5. config-writer.ts 加 `updateRuntimeMode(mode)`（仿 updateRuntimeSkinId L237-254）
6. App.tsx sendMessage（L196-256）`action==='mode'` 异步写 + echo "重启后生效"
7. locales en/zh 加 `skills.help.localCommands.mode` + `commands.chat.options.mode`
8.（建议）cli-input-adapter.ts（L140-190）补 `mode` 分支

### Phase 6 — 文档 + 验证
- 更新 `docs/user-guide/multi-agent.md:128-147`（过期 `subAgents` key）；补 A2A 配置说明。
- 测试：parse/merge（a2a+singleAgent）、updateRuntimeMode、/mode 命令、--mode 覆盖、injectOrchestratorAgents mode 分支、createA2AAgentTool、过滤放行 + 子 agent 继承。
- `npm test` / `npm run check:locale-parity` / `npm run typecheck`。

## 范围外的既有缺陷（记录在案，本期不修）

- 子 agent `multiAgent[name].tools` 白名单查找范围是父过滤 registry → 配 edit-file/grep 命不中。
- `A2AAgentRegistry.discoverAndRegister/discoverByCapability` 零调用方；`startA2A` 空壳。
- `A2AServerConfig.host/defaultTimeoutMs` 配置层未暴露。

## 验收

- single 模式（`--mode single` 或 `/mode single` 重启后）：取 singleAgent.skin/model/promptTemplate，orchestrator 不注入多角色清单。
- 配置 `a2a.agents` 后，主 agent 与子 agent 都能调 `a2a_<name>` 工具；`a2a.servers` enabled 时本机起进程。
- `multiAgent[x].mode/a2aServer` 已移除；`a2a-spawn-agent.ts` 已删。
- 全量测试 + locale parity + typecheck 通过。
