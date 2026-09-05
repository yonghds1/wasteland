# nightowl init 自动申请权限

## Goal

`nightowl.py init` 目前只创建 `.nightowl/` 下的 yaml 文件,不申请权限,导致初始化后仍需单独跑 `setup-permissions` 才能免弹窗。目标:初始化时自动申请全部权限,一步到位。

## What I already know

* `cmd_init`(nightowl.py:145)只在 `POOL_FILE` 不存在时创建 task-pool.yaml / task-state.yaml / progress.log;已存在则直接跳过。
* `cmd_setup_permissions`(nightowl.py:576)把 `PERMISSION_RULES`(35 条命令前缀,line 532)合并写入 `.claude/settings.json`(默认 project,可提交)或 `settings.local.json`(`--scope local`)。
* 权限写入逻辑是幂等的:只新增缺失规则,不删除/覆盖已有规则。
* `.claude/settings.json` 已包含全部 nightowl 权限规则(用户此前跑过 setup-permissions)。

## Assumptions (temporary)

* init 自动申请权限 = 复用 PERMISSION_RULES 写入逻辑,不重复实现。
* 默认 scope 与 setup-permissions 保持一致(project)。

## Open Questions

* ✅ 已解决:始终写权限(无论任务池是否已存在)
* ✅ 已解决:透传 --scope,提供 --skip-permissions 逃生舱

## Requirements (evolving)

* [ ] `nightowl.py init` 在初始化任务池的同时写入全部权限规则
* [ ] init 始终尝试写权限:任务池已存在时跳过创建但仍写权限(幂等对齐)
* [ ] init 支持 `--scope project|local`(默认 project,与 setup-permissions 对齐)
* [ ] init 支持 `--skip-permissions`(只建任务池,不碰权限)
* [ ] 权限写入幂等,不破坏已有 settings.json 内容
* [ ] 现有 setup-permissions 命令保持可用,行为不变

## Acceptance Criteria (evolving)

* [ ] 全新目录下跑 `init` 后,.claude/settings.json 包含全部 PERMISSION_RULES,且创建任务池
* [ ] 任务池已存在时跑 `init`:跳过创建,仍写入权限
* [ ] `init --skip-permissions`:只建任务池,settings.json 不被改动
* [ ] `init --scope local`:写入 settings.local.json
* [ ] `setup-permissions` 原有行为不变

## Definition of Done (team quality bar)

* 测试:手测 4 种场景(全新/已存在/--skip-permissions/--scope local)步骤明确
* 文档:SKILL.md / nightowl-plan / USER_GUIDE 同步更新 init 用法
* 现有 `setup-permissions` 不被破坏

## Out of Scope (explicit)

* 不改 PERMISSION_RULES 内容(35 条规则不变)
* 不改变调度、任务池等现有逻辑
* 不为 init 增加其他环境初始化职责(如建 .wasteland、装 hooks)

## Technical Notes

* `cmd_init`(nightowl.py:145-171)
* `cmd_setup_permissions`(nightowl.py:576-618)
* `PERMISSION_RULES`(nightowl.py:532-573)
* 共用函数抽取:如 `apply_permissions(scope)`,init 与 setup-permissions 复用

## Implementation Record

完成时间 2026-08-11。改动(全部验证通过):

* `apply_permissions(scope)` — 从 cmd_setup_permissions 抽取共用写入逻辑,返回 (added, target)
* `print_permissions_result(added, target)` — 权限结果打印,init 与 setup-permissions 复用
* `cmd_init` — 新增 `--scope project|local`(默认 project)与 `--skip-permissions`;初始化任务池后默认调 apply_permissions;池已存在仍写权限(幂等)
* argparse — init 子命令增加参数定义
* 文档 — nightowl/SKILL.md、nightowl-plan/SKILL.md、memory/patterns.md 同步 init 用法

验证场景(手测):
* [x] 全新目录 init → 建池 + 写入全部 34 条权限
* [x] 池已存在 init → 跳过创建仍写权限(幂等)
* [x] `--skip-permissions` → 不碰 settings.json
* [x] `--scope local` → 写 settings.local.json
* [x] `setup-permissions` 重构后行为不变(exit 0)
