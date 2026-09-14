# .trellis 目录从 git 版控移除并加入 gitignore

## Goal

`.trellis/` 是本地 Trellis 工作流目录(任务记录、运行时状态、个人规范),含有大量与本机任务历史耦合的内容,不应进入开源仓库。将其加入 `.gitignore`,并从 git 索引移除(工作区文件保留)。

## What I already know

- 当前被 git 跟踪 346 个文件:tasks/ 288、scripts/ 28、spec/ 24、workspace/ 1、workflow.md、.version、.template-hashes.json、.gitignore、config.yaml
- `.gitignore` 已有 "# Trellis local data" 块(仅忽略运行时子路径),用户希望整体脱管
- 目录内还有一个被跟踪的嵌套 `.trellis/.gitignore`

## Assumptions (temporary)

- "移除 git 管理" = `git rm -r --cached .trellis`(untrack),保留本地文件
- 整体 `.trellis/` 进入 `.gitignore`,包括 spec/scripts/tasks

## Open Questions

- 脱管范围:整体(含 spec/scripts/规范文档)还是只运行时?用户倾向整体

## Requirements (evolving)

- [ ] `.gitignore` 中使 `.trellis/` 整体被忽略(可合并替换现有 Trellis local data 块)
- [ ] `git rm -r --cached .trellis` 从索引移除,工作区文件不动

## Acceptance Criteria (evolving)

- [ ] `git status` 显示 `.trellis/` 不再有任何 tracked 文件
- [ ] 本地 `.trellis/**` 文件完好,`task.py` 等脚本仍可用
- [ ] `git check-ignore .trellis/tasks` 返回命中(已被忽略)

## Definition of Done

- 提交一个干净的 untrack commit;本地 Trellis 工作流不受影响

## Out of Scope

- 不删除工作区 `.trellis/` 文件
- 不改 Trellis 脚本/规范内容

## Technical Notes

- 嵌套 `.trellis/.gitignore` 在外层整目录忽略后不再生效,无需处理
- `.gitignore` 已有 Trellis data 条目可简化为一行 `.trellis/`
---

## 废弃说明（2026-09-14，未实施即关闭）

**结论：不实施。目标已被仓库后续实践取代，且与当前设计冲突。**

动工前的实测核实：

| AC | 实测 |
|---|---|
| `.trellis/` 下无 tracked 文件 | ✗ 仍 **413** 个 tracked |
| `git check-ignore .trellis/tasks` 命中 | ✗ 未命中 |

也就是说本任务确实**一项都没做**。但复查后认为**不该做**，理由是它与仓库后来的方向相反：

1. **`.trellis/spec/` 是规范真源**。项目根 `CLAUDE.md` 明确写「你所需的真实、最新的项目
   规范全部存放在 `.trellis/` 目录中」，并把它作为 AI 助手的路由入口。若把 `.trellis/`
   整体脱管，**新克隆仓库的人/agent 将拿不到任何规范**——这直接破坏现有设计。
2. **`.trellis/tasks/` 的工件一直在被提交**（含归档任务）。2026-09-14 这一天就有多个
   `chore(task): archive …` 与规划工件提交进入版本控制，说明"工件入库"已是既定实践。
3. **本任务真正想解决的痛点（本地运行时状态污染工作区）已经被解决**：
   `.gitignore` 第 13–23 行已有「Trellis local data」块，覆盖
   `.trellis/workspace/*/`、`.trellis/.runtime/`、`.trellis/.current-task`、
   `.trellis/.session-id`、`.trellis/.backup-*` 等全部运行时产物。
   实测 `.trellis/workspace/` 下文件确实未被跟踪 ✅。

故按"意图已过期"关闭。**若将来仍要去掉 `spec/` 与 `tasks/` 的跟踪，那是一个需要先改
`CLAUDE.md` 与全体 agent 入口的架构决策**，不应作为一次 `git rm --cached` 的收尾动作。

顺带：本任务目录此前一直是 untracked，本次归档会把 PRD（含本说明）纳入版本控制，
以保留"为什么不做"的记录。
