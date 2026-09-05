# chore: 清理 zombie active tasks

## Goal

清理 `.trellis/tasks/` 中实际已"自然完成"或"长期未推进"的 5 个 zombie 任务：
- 移到 `tasks/archive/2026-07/` 保持历史记录
- 让 active 列表诚实反映"当前在做什么"

补 1 个真正有未来价值的方向任务（多 Agent 协作推进）。

## What I already know

**当前 active tasks（9 个），分类**：

| 任务 | 状态 | 实际进展 | 决策 |
|---|---|---|---|
| 05-30-implement-missing-tools | planning | 无 prd.md；`src/tools/git.ts` + `src/tools/web-search.ts` 已实现 | 🧟 ARCHIVE（自然完成） |
| 05-30-unify-test-framework | planning | 无 prd.md；`npm test` 已是 `vitest run` | 🧟 ARCHIVE（自然完成） |
| 06-15-next-steps | planning | "下一步功能规划"——meta 占位，无具体动作 | 🧟 ARCHIVE（meta 任务） |
| 06-16-brainstorm | planning | "spawn_agent 并行执行"——已被 commit `bf5aeea` / `dfdd0d9` 实现（`parallel-spawn-agent.test.ts` + agent_loop 重构） | 🧟 ARCHIVE |
| 06-17-brainstorm-next | planning | PRD 详细：MCP SSE/Resources/Prompts 完善；现状可能未完整实现 | 🟢 **保留**（真活）|
| 06-21-brainstorm-next2 | planning | PRD 详细：cheerio + LRU 缓存；现状 web-search 未用 cheerio，未有 LRU | 🟢 **保留**（真活）|
| 06-21-brainstorm-next3 | planning | PRD 详细：A2A SSE 流推送；未实现 | 🟢 **保留**（真活）|
| 07-19-first-run-config-init-command | in_progress @Palen | @Palen 在做 | 🔧 保留 |
| 07-19-fix-alias-link | in_progress @Palen | @Palen 在做 | 🔧 保留 |

**Archive 后**：active tasks = 4（@Palen 两 + 上一步的清理 + next3 推进中）。

## Requirements

- archive 4 个 zombie: 05-30-implement-missing-tools / 05-30-unify-test-framework / 06-15-next-steps / 06-16-brainstorm
- 保留 06-17-brainstorm-next / 06-21-brainstorm-next2 / 06-21-brainstorm-next3（真活，有完整 PRD）
- 保留 07-19-first-run-config-init-command / 07-19-fix-alias-link（@Palen 在做）
- archive 全部用 `task.py archive`（自动 commit + 目录移动）
- 全部 archive 后 git 树无破损

## Acceptance Criteria

- [ ] 4 个 zombie 任务移到 `archive/2026-07/`
- [ ] 每个 archive 自动 commit `chore(task): archive <task-name>`
- [ ] active tasks 列表瘦到 5（含 @Palen 两 + 三个真活）
- [ ] 全部 git 操作后 working tree clean

## Definition of Done

- 全 zombie 归档完成
- 最终 active tasks 列表诚实

## Out of Scope (explicit)

- 07-19-* @Palen 在做（不动）
- 改任何业务代码
- 不引入新功能（除非 next3 推进）

## Technical Notes

- 工具：`python3 ./.trellis/scripts/task.py archive <name>`（每个归档自带 commit）
- 不要乱删 prd.md：archive 自动移到 archive/ 目录保留历史
- 06-17 / 06-21 的 zombie 判定需要读 prd.md 内容确认
