# Implement：A2A → ACP 迁移执行清单

> 前置：`prd.md` + `design.md` + `research/acp-sdk-feasibility.md` 已评审。阶段纪律 = 并存(P1) → 切换(P2) → 清理(P3)，每阶段收口后独立 commit。
> ⚠️ 本分支 `fix/logs-overflow-tail` 树上另有 5 个未提交改动（dispatch-utils/tool-dispatch/permission 测试/spawn-agent dispatch-handler，属上一任务 reasoning 的遗留 WIP）——**动手前先与用户确认其去留**，git add 时严禁裹挟。

## P0 冒烟（不 commit，验证前提）✅ 已完成 2026-09-13

- [x] 0.1 `npm i @zed-industries/agent-client-protocol@^0.4.5`；`npm run typecheck` 过（zod3/zod4 共存验证，design 风险 4）。**结果：typecheck 全绿**。
- [x] 0.2 真实 spawn 冒烟：claude-code-acp **SMOKE PASS**（initialize→newSession→prompt end_turn，11 个 update；脚本 `~/temp/acp-smoke/smoke.mjs`，结论落 `research/p0-smoke-result.md`）。三条修正已回写 design.md：① 子进程 env 剔除 `CLAUDECODE`/`CLAUDE_CODE_*`；② preset 改用新包名 `@agentclientprotocol/claude-agent-acp@0.76.0`；③ sessionUpdate 判别面加宽。
- [ ] 0.3 `@zed-industries/codex-acp` 同法冒烟（可选，失败仅影响 preset 文案不影响主链；包存在性已证实 0.16.0）——**顺延到 P3 preset 文档定稿前做**。

## P1 并存：ACP 链路落地（A2A 原样保留）✅ 已完成 2026-09-13（commit c40afd1）

- [x] 1.1 `src/acp/acp-client.ts`：`AcpClient.spawn/prompt/dispose` + `AcpStreamEvent`（per design.md 契约；stderr 尾部 4KB；startup/prompt 双超时；exit/error 清理）。
- [x] 1.2 `src/acp/__tests__/acp-client.test.ts`（新文件按规范放 `__tests__/`）：假子进程（`fake-acp-agent.mjs` 脚本化 ndjson 应答）覆盖握手、chunk 聚合、stopReason、子进程异常、prompt 超时 kill、requestPermission 自动 allow_once。7 例全绿。
- [x] 1.3 `src/tools/agent/acp-agent-tool.ts`：`ACP_TOOL_PREFIX='acp_'` / `acpToolName()` / `createAcpAgentTool(cfg)`；`toToolResult` 按 design 映射 stopReason；`src/tools/__tests__/acp-agent-tool.test.ts`（mock AcpClient）12 例全绿。
- [x] 1.4 配置层并存：`settings-types.ts` 加 `ACPSettings`/`AcpAgentConfig` + `LoadedSettings.acp` 默认 `{agents:[]}`；`validate-settings.ts` 校验；`settings-merge.ts` 深合并；`settings-env-auth.ts` 透传+`$auth` env；`acp-presets.ts`（claude_code + codex 两 preset，antigravity 移除）。
- [x] 1.5 `default-registry.ts`：注册 `acp_<name>`（与 a2a 并存）；`filterToolRegistry` 放行 `acp_` 前缀；`initialize-runtime.ts` 传 `settings.acp`。
- [x] 1.6 P1 收口：`npm test` 1557 全绿 + typecheck/eslint 干净 → commit `c40afd1`。

## P2 切换：默认走 ACP（进行中）

- [x] 2.1 `load-settings.ts` 迁移检测：`warnA2ALegacyOnce` + 纯函数 `buildA2AMigrationNotice`（可粘贴 acp 示例，进程内一次）；`config-writer.ts` 支持写 `acp` 块（`buildAcpBlock`/`WizardACPSelection`）。
- [x] 2.2 TUI 向导：`A2AStep` → `AcpStep`（ACP_PRESETS 勾选，展示 command）；types 步骤 `'acp'`；logs 页 scope 增 `acp`；locale zh/en 增 acp key（parity 过）。旧 a2a locale key 暂留（P3 删）。→ commit `a175be1`
- [x] 2.3 `initialize-runtime.ts` 删 a2a servers 托管段（createClaudeCodeA2AServer import、起进程循环、`a2aManager`/`stopA2AServers` 与 useRuntime/run-agent-helpers 调用链）；3 个测试 mock 同步。全量 1565 绿 → commit `10d7a11`
- [ ] 2.4 迁移 `~/.wasteland/settings.json`（经用户确认后：a2a 块 → acp 等价块，保留文件备份）；用户实测 R-6：TUI 里 `acp_claude_code` 下发任务，流式渲染 + 正常返回。**← 当前卡点：待用户点头改配置 + 实测**
- [ ] 2.5 P2 收口：全量门禁 + 用户实测通过。

## P3 清理：删净 A2A

- [ ] 3.1 删文件：`src/acp/a2a-{client,types,webhook,registry,claude-code-adapter}.ts` 及其 4 个同级 `.test.ts`；`a2a-integration.test.ts`/`a2a-collaboration.test.ts`；`src/tools/agent/a2a-agent-tool.ts` + `src/tools/__tests__/a2a-agent-tool.test.ts`；`src/tools/agent/spawn-agent/__tests__/a2a-inheritance.test.ts` 改写为 acp 继承测试；`examples/a2a-test-server.ts` 删除。
- [ ] 3.2 删配置面：`settings-types` a2a 块、merge/validate/env-auth/config-writer 的 a2a 分支、locale a2a key；**保留** load-settings 里读取旧块的迁移检测（改为"检测到已废弃 a2a 块"文案）。
- [ ] 3.3 文档：README.md「A2A 协作」→「ACP 协作」（含配置示例、npx 首拉提示、第三方适配器链接）；`docs/` 涉 a2a 段落、`src/tools/README.md`、CHANGELOG 新条目。
- [ ] 3.4 终检：`grep -ri a2a src/ examples/ docs/ README.md` 仅剩 load-settings 迁移检测与 CHANGELOG 历史；全量门禁（typecheck/lint/test/validate:i18n/check:locale-parity）→ commit ④`refactor(acp)!: 移除 A2A 协议栈,协作统一为 ACP`。

## Validation（每阶段末必跑）

```bash
npm run check:fast
npm test
node --import tsx scripts/check-locale-parity.ts   # P2/P3
npx vitest run src/acp/__tests__ src/tools/__tests__/default-registry.test.ts
```

## 风险与回滚

- 每阶段 1-3 个独立 commit；P3 前任意阶段 `git revert` 即回到旧行为（A2A 工具重新可见）。
- P0.2 冒烟失败 = 设计前提失效 → 停线回报，不带病进 P1。
- 与树上遗留 WIP（reasoning 相关 5 文件）零文件交集；提交时逐文件 `git add`，禁 `-A`。
