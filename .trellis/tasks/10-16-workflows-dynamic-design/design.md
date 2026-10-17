# /workflows 动态工作流系统设计（design.md）

> 任务：10-16-workflows-dynamic-design。对标 Claude Code 官方动态工作流
> （Workflow 本地工具 + 受限 JS DSL + 后台 runtime + journal + resume）。
> 方法：4 agent 分层设计（A入口工具 / B本地runtime / C DSL语义 / D门禁可观测）
> + 环形交叉拷问（A→B→C→D→A，共 29 问）+ 各层修订。本稿为修订综合版。

## 0. 一句话架构

主 loop 不动；新增 `Workflow` 工具（riskLevel=execute），调用后本地 runtime
以后台任务执行 JS DSL（agent/pipeline/parallel/phase/log/workflow/args/budget），
每 `agent()` 即一 spawn_agent 子会话（带 schema 则强制 JSON 返回 + zod 校验），
完成以 `<task-notification>` 回灌主会话。确定性只放在“门与预算”上，
步内做法仍是 LLM 自适应。

## 1. A层：入口与工具

- 命令：`/workflows`（无参：running/done/interrupted/failed 列表，interrupted 附 resume 提示）；
  `/workflows <name> <目标>`；`/workflows run <自然语言>`（强制 plan 预览，此链路 `--yes` 无效）；
  `--pattern` 仅列表过滤；`--yes` 仅跳 TUI 二次确认，永不跳过 ask-user。
- `$ARGUMENTS` 原串透传至 B，不预解析。
- Workflow 工具 schema（zod）：`name`（`^[a-z0-9-]{1,64}$`）；
  `script|scriptPath` 二选一（内联 ≤8KB；用户直传路径禁 `..` 且禁跳出 cwd；
  `name` 引用走 B-loader 信任路径不做 `..` 校验——双通道）；
  `args ≤ 20 项`；`resumeFromRunId?: uuid`。
- opt-in 原话：仅用户明说 workflow/点名/skill 指示才可调用，否则主会话内常规完成。
- 调用立即返回 `{taskId, runId}`（taskId 对外跟踪，runId 对内落盘，workflow.json 双写映射，
  list/query 双键可查）；完成回灌 `<task-notification>` 必含
  `workflowId/runId/agentId/tokens/toolCalls/elapsedMs`。
- riskLevel=execute，默认 ask；内联 script 无 plan 拒绝执行（不锁死放行）。
- 落点：新建 `src/skills/workflows/` 下 Skill（复用 SkillExecutor/registry/discovery），
  无别名（`wf` 删，避冲突）；`src/cli.ts` 不动（CLI 走 `chat --message` 透传）。
- 并发超限直接失败 `E_WORKFLOW_QUOTA_EXCEEDED`（不排队）；首版无 `mode` 字段，固定 background。

## 2. B层：本地 runtime（src/workflows/）

- loader：扫全局 `~/.wasteland/workflows/` + 项目 `.wasteland/workflows/`，
  仅读文件头生成 manifest（name/version），**执行时才 ESM import**（纳入 ask 链）；
  `sha256` 为 codeVersion；watch 热加载只刷 manifest；同名项目覆盖全局；
  失败发 `workflow/load-error`。
- scheduler：detached promise + workflow 级 AbortController 向下透传 per-agent signal；
  全局并发上限 2，超限直接失败；spawn 嵌套深度 ≤3；**只许一层 workflow 嵌套**；
  默认 timeout 10min（workflow 级），journal 记 timeout/cancelled 并清理残留；
  同 session 允许 1 前台 + N 后台。
- 落盘 `<sessionDir>/workflows/<runId>/`：workflow.json（含 taskId↔runId 映射）、
  journal.jsonl、final-state.json、agents/。
- resume 键 = `hash(normalizedPrompt + schema + codeVersion)`（**去 modelId**，
  fallback 换模型不失效）；命中返 `cached:true`；`itemError` 占位永不缓存；
  崩溃标 `interrupted`，不自动重跑，进列表提示手动 resume。
- pipeline 首版为**分批 barrier**（batchSize=并发上限），真流式记 P2。
- 错误单源 `src/workflows/errors.ts`：E_WORKFLOW_NOT_FOUND / E_WORKFLOW_NESTED /
  E_WORKFLOW_QUOTA_EXCEEDED / E_WORKFLOW_ABORT_TIMEOUT / E_PIPELINE_ALL_FAILED /
  E_PARALLEL_FAIL_FAST / E_SCHEMA_VALIDATE / E_BUDGET_EXHAUSTED / E_CONCURRENCY /
  E_SPAWN_DEPTH。

## 3. C层：DSL 语义

- 原语：`agent(prompt, {schema?, model?, fallbackModel?, tools?, timeoutMs?})`；
  `pipeline(items, ...stages, {batchSize, totalTimeoutMs})` 分批 barrier，
  单 item 失败记 `itemError` 占位继续，全失败抛 E_PIPELINE_ALL_FAILED；
  `parallel(thunks, {fail-fast:true})` 任一失败抛 E_PARALLEL_FAIL_FAST（abort 由 B 执行，
  C 只声明）；`phase(name)` / `log(msg)` 只记 journal；`workflow()` 嵌套 depth>1 抛
  E_WORKFLOW_NESTED（AsyncLocalStorage 计数）；全局 `args` / `budget{target,spent,remaining}`。
- `agent()` → spawn_agent 子会话；有 schema 则 system 追加 JSON-only 指令，
  文本→JSON.parse→zod safeParse，失败换 fallbackModel 重试 1 次（计**双倍** spent，
  视为新分支**重走 L3**，fallbackModel 进 L1 名单）；无 schema 返回原文。
- depth 仅计 workflow 嵌套；fanout 受 B 并发排队（fan-out 8 合法）。
- budget：C 维护静态模型定价表做执行前估算预扣；`spent≥90%` 后**禁一切自动降级**，
  先 ask-user 获批，降级先发 budget_warn；取消意图进 budget 单例 hardStop 前置，
  重试循环每迭代查 cancel；优先级 timeout > budget > fail-fast。
- workflow 嵌套展开 / parallel abort 改 plan → 无条件触发 D 层 L2 复评。

## 4. D层：门禁 · 预算 · 可观测

- L1 提交整单预检（plan 估价 + 回执，无回执不执行）；L2 条件复评
  （prompt 增量 >500 token 或 tools 变化即复评；嵌套展开/abort 改 plan 无条件复评）；
  L3 tool 调用强制门，deny 不可跳。
- `--yes` 仅本次 run 跳 TUI 确认；ask 仅限 budget-confirm90 与 L3-deny 两类，
  其余预批量裁决；confirm90 不可跳，hard100 执行侧硬 kill。
- budget 三档：warn 70% / confirm 90%（ask-user）/ hardStop 100%（cancel 写 final-state）；
  中断展示 estimated/actual/明细。
- 事件 SSOT 归 journal，D 只做投影映射：
  agent_start→started+agent_update；agent_end→finished+agent_update；
  phase→progress（必发）；log→budget/blocked 载体。
- TUI 面板：taskId/name/进度条/agent 状态/预算条/取消按钮（只发意图，1s 节流）。
- 脱敏：redactor 过密钥/token/Bearer，final-state 只存摘要；run 目录 TTL 7d，
  journal 超 5MB 截断留尾。
- 归因两级：agent + workflow overhead（失败 item 占位单列 failed shard，不计 agent 成功率）。
- 不做：定时调度、跨机器、step-by-step 单步确认、货币换算。

## 5. 分期

- P0：本任务 spec（prd/design/implement.jsonl、check.jsonl 治理）。
- P1：Workflow 工具 + agent/parallel + vm 沙箱 + `/workflows` 列表 + 只读 `review` 剧本端到端。
- P2：pipeline/totalTimeoutMs/log/phase/args/budget + resume + journal 查看。
- P3：内置 feature-development/tdd-cycle/incident-response + examples/ + i18n +
  用量归因视图。

## 6. 仍未决（进 implement 前定）

1. sessionDir 走 SessionManager 还是独立 `~/.wasteland/runs/`？（B）
2. pipeline 占位 vs 过滤的默认值放 DSL 参数还是 B mode？（C）
3. budget 估计器按 token 还是次数、放哪层？（C；现定 C 侧静态表）
4. bypass_permissions 在 CI 非交互环境默认开否？（D）
5. 预算三档是否按模型分档？（D）

## 7. 裁决记录（2026-10-16，用户逐项确认）

1. run落盘跟会话走：`<sessionDir>/workflows/<runId>/`，跨会话 resume 显式传 runId。
2. pipeline失败项保留占位（等长可对账），由调用方过滤。
3. budget按 token 估：C 层静态模型定价表，执行前预扣。
4. bypass_permissions 默认不开，CI 须显式 `--mode` 开启。
5. 预算三档统一一档（70/90/100），不按模型分档。
