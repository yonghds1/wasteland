# nightowl npm 包 README

## Goal

为 npm 包 `@yonghds1/nightowl` 补齐缺失的 `README.md`（`package.json` 的 `files` 已声明该文件但不存在）。发布后包主页能直接展示安装、用法、命令清单。

## What I already know

- 包名 `@yonghds1/nightowl`，命令 `nightowl`，17 个子命令
- 三阶段工作流：plan（白天拆任务）/ run（晚上静默执行）/ report（收尾汇总）
- 状态文件全部在 `.nightowl/` 下（tasks.yaml / state.yaml / checkpoint.yaml / context.md / report.md / tasks/<MM-DD-slug>/prd.md）
- 安装技能：`nightowl install-skill` 复制到 `~/.claude/skills/`
- 开发脚本：`npm run build` / `npm test` / `npm run dev`
- 受众是中文用户（技能文档均为中文），README 用中文
- 目标文件：`/home/ubuntu/workspace/nightowl/README.md`（不在 wasteland 仓库内，跨项目）

## Assumptions (temporary)

- README 用中文，覆盖安装、快速开始、命令速查、三阶段工作流、状态文件、开发
- 不做英文版（当前无需求）

## Requirements (evolving)

- 安装方式（全局 npm 安装 + install-skill）
- 快速开始（init → add → status）
- 三阶段工作流说明（plan / run / report）
- 17 个命令速查表
- `.nightowl/` 状态文件说明
- 开发脚本（build / test / dev）

## Acceptance Criteria (evolving)

- [ ] `nightowl/README.md` 存在
- [ ] 覆盖安装、快速开始、命令速查、工作流、状态文件、开发
- [ ] 命令清单与 `nightowl --help` 一致（17 个）
- [ ] `npm pack --dry-run` 确认 README 进包

## Definition of Done

- README 内容准确（命令、文件、流程与代码一致）
- 不涉及代码改动

## Out of Scope (explicit)

- 英文 README
- 代码改动
- 实际 `npm publish`（用户另行决定）

## Technical Notes

- 命令清单来自 `src/cli.ts`（17 个 createXxxCommand 注册）
- 状态文件来自 `src/paths.ts`（POOL_FILE/STATE_FILE/LOG_FILE/CHECKPOINT/REPORT/CONTEXT/TASKS_DIR）
- 工作流语义来自 3 个 SKILL.md（nightowl-plan / nightowl-run / nightowl-report）

## 收口记录（2026-09-15）

nightowl 仓库已有 README.md（~/workspace/nightowl/README.md），包主页内容齐备。
