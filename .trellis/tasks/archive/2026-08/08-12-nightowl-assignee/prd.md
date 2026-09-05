# nightowl identity:默认用户 + assignee 接入

## Goal

让 `.developer`(init -u 写入的身份)有实际用途:任务加负责人(assignee)。`.developer` 不存在时回落默认用户 `nightowl-user`。对齐 trellis 的任务归属语义。

## What I already know

- `.developer` 现状:`src/commands/init.ts` ensureDeveloper() 只写不读;文件是裸名字一行;`-u` 可选,不传则不写
- 用户已决策:`.developer` 不存在 → 默认用户 **`nightowl-user`**
- Task 接口(`src/state.ts:20`)无 `assignee` 字段,需新增
- add.ts 选项:`--priority --desc --acceptance --depends-on --verify --slug`,无负责人
- trellis 参照:`--assignee/-a` 指派 + `--mine` 过滤 + `.developer` gitignored
- nightowl 是独立仓库 /home/ubuntu/workspace/nightowl(代码),任务在 wasteland 跟踪

## Requirements

- identity 读取:`.developer` 有则读名字;无则返回 `nightowl-user`(默认用户,已确认)
- `add` 支持 `--assignee <名>`,不传则默认取 identity
- Task 结构新增 `assignee` 字段并落盘(pool YAML)
- `status` 任务行显示负责人
- `report` 显示负责人(任务归属)

## Acceptance Criteria

- [x] `nightowl add` 不传 --assignee 且无 .developer → 任务 assignee = nightowl-user(冒烟验证)
- [x] `nightowl add --assignee 张三` → assignee = 张三(冒烟验证)
- [x] `nightowl init -u 李四` 后 add → assignee = 李四(冒烟验证)
- [x] `status` 任务行显示负责人(中英文冒烟)
- [x] `report` 表格负责人列(冒烟)
- [x] 全部 vitest 通过(38 tests);typecheck 绿;zh/en 键对称

## Definition of Done (team quality bar)

- Tests added/updated
- Typecheck / vitest green
- Docs/README updated if behavior changes

## Out of Scope (explicit)

- `--mine` 过滤 / 按人筛选(status 分页过滤) —— 除非用户要求
- 多开发者协作工作区(workspace 目录) —— trellis 独有,不搬

## Technical Notes

- 目标仓库:`/home/ubuntu/workspace/nightowl`
- 关键文件:`src/state.ts`(Task 类型)、`src/commands/add.ts`(选项+构造)、identity 读取函数(新 or init.ts 导出)
- 现有测试:`test/init-templates.test.ts` 已测 installFile;add 相关在 `test/prd.test.ts`
