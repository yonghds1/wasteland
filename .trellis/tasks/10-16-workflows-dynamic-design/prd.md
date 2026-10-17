# PRD：/workflows 动态工作流系统

## 背景

wasteland 已有单 ReAct loop（agent-loop）、Skill/Tool 体系与 spawn_agent 并行能力，
但缺少确定性多智能体编排层：关键多步流程只能靠 prompt 临场发挥，不可靠。
对标 Claude Code 官方动态工作流（Workflow 本地工具 + 受限 JS DSL + 后台 runtime），
在 wasteland 内新增 `/workflows` 系统。详见同目录 `design.md`（4 层设计 + 29 问拷问修订 + 5 项裁决）。

## 范围

- P1（本期）：`/workflows` 入口 Skill + `Workflow` 工具（zod schema + opt-in）+
  `src/workflows/` 最小 runtime（loader manifest / vm 沙箱 / scheduler后台+并发2 /
  journal + 列表查询）+ 只读 `review` 内置剧本 + `agent/parallel` 两原语。
- P2：pipeline（分批 barrier + 占位）/phase/log/args/budget 三档/resume/回灌归因。
- P3：三内置剧本 + examples + i18n + 用量视图 + TTL 清理。
- 不做：定时调度、跨机器、step-by-step 单步确认、货币换算、排队调度（超限直接失败）。

## 验收标准（P1）

1. `/workflows` 无参列出运行中/已完成/中断任务；`/workflows review <path>` 端到端跑通只读评审。
2. Workflow 工具调用立即返回 `{taskId, runId}`，主会话不阻塞；完成以 `<task-notification>`
   （六字段齐全）回灌。
3. opt-in 生效：无用户明示不调用；`/workflows run` + `--yes` 强制先出 plan 预览。
4. `--yes` 只跳 TUI 二次确认，不跳 ask-user；deny 不可跳过。
5. 沙箱逃逸测试：workflow 脚本内无 require/fs/process/network 访问（单测覆盖）。
6. 超并发（上限 2）直接失败 `E_WORKFLOW_QUOTA_EXCEEDED`；错误码与 `errors.ts` 单源一致。
7. `npm run check:fast` + `validate:i18n` 通过；新文件单文件 ≤500 行、测试在同级 `__tests__/`。

## 非目标

- 不改主 loop（agent-loop/tool-dispatch）任何一行；回滚 = 删 Skill 与工具注册各一行。
- 首版无 mode（固定 background）、无流式 pipeline、无 resume 缓存复用（仅中断可见+手动 resume）。
