# 日志存储中央化重规划（按 OpenCode 模式）

## Goal

终结“换目录启动就看不到日志”：把日志/会话 transcript 等**数据**收敛到单一中央数据根，按 projectID 命名空间隔离，LogsPage 与 `logs/sessions/resume/export` 默认跨项目可读；**配置**（settings/skills/roles）保持项目本地不动。

## Background（已考证事实）

OpenCode 现行实现（`packages/opencode/src/storage/storage.ts` + 2026-02 issue #11560 确认）：

- 单一数据根 `~/.local/share/opencode/`（XDG data dir），`storage/` 下按 key 存 JSON：
  `session/<projectID>/<sessionID>.json`、`message/<sessionID>/<msgID>.json`、
  `part/<msgID>/<partID>.json`、`project/<projectID>.json`，另有 `log/` 应用日志与 `migration` 版本计数；
- projectID：git 仓库取 root commit hash（目录改名不丢），非 git 目录取 `"global"`；
- 读写经 Storage 抽象（read/write/update/remove/list by key path），启动时跑版本化 MIGRATIONS；
- 已知教训（issue #8538 及后续）：按 cwd 解析 project 后直接拼路径查找，跨目录即 `NotFoundError`；
  需要 session→project 索引或跨目录回退搜索；`global` 迁移用 `directory == worktree` 精确匹配会 orphan（git init 中途、目录改名场景）。

wasteland 现状：

- 写：`resolveDefaultLogDir` → `WASTELAND_LOG_DIR` / `<project>/.wasteland/logs` / `~/.wasteland/logs`；
  transcript 在 `.wasteland/sessions/`；读：LogsPage 三处 `projectConfigDir ?? userConfigDir`；
- 读写规则一致但**作用域恒为单目录**，无跨项目视图；`WASTELAND_HOME` 已是全局覆盖旋钮；
- 路径硬编码点：`DEFAULT_EXPORT_DIR`（LogsPage:83）、部分文档与脚本引用 `.wasteland/logs`。

## Requirements

- R1（数据根）：中央数据根默认 `~/.wasteland/data/`（沿用 `WASTELAND_HOME` 覆盖语义，不另起 XDG 新根，减少迁移面）；
  新增 `WASTELAND_DATA_DIR` 允许显式覆盖；布局 `data/{logs,sessions,transcripts}/<projectID>/` + `data/project/<projectID>.json` + `data/migration`。
- R2（projectID）：git 仓库取 root commit hash（`git rev-list --max-parents=0` 首个并排序取首，与 OpenCode 一致），
  非 git/无 git 二进制时回退路径 slug（`resolve` 后 sha1 短 hash，人可读性让位于稳定性）；`project.json` 存 `{id, vcs, worktree, created}`。
- R3（读写抽象）：`src/config/paths.ts` 为唯一路径来源；新增 `src/core/logger/data-store.ts`
 （`read/write/list(projectID?)` 薄封装，沿用现有 JSONL 文件格式，**不改单条 schema**）；
  FileSink、file-log-loader、session-index、transcript 读写全部经它拿目录。
- R4（读聚合）：LogsPage 左栏默认 union（本项目置顶 + 其他项目分组，带 worktree 标签）；
  `wasteland logs/sessions` 默认同样聚合，加 `--project <id|path>` 收窄；`resume/export` 跨目录时自动定位（session→project 索引优先，索引缺失回退全根扫描——吸取 #8538 教训）。
- R5（迁移，用户 2026-09-06 决策：绿地新做）：M1 **不迁移旧数据、不做双读**；
  新数据直接写中央，老 `.wasteland/{logs,sessions}` 原地保留、读写路径彻底切换；
  仍保留 `data/migration` 版本文件（从 1 起，为未来 M2 预留）。
- R6（兼容）：配置层（settings/skills/roles/auth）不动；现有测试用 `WASTELAND_HOME` 隔离的继续有效；
  全量测试 + 文档更新（`docs/architecture/configuration.md` 存储节）。

## Acceptance Criteria

- [ ] AC1：A 项目发的消息，在 B 项目目录启动 TUI 的 `/logs` 左栏可见（带 A 项目标签），可打开、可导出。
- [ ] AC2：项目目录改名后，历史 session 仍可列出、resume 可用（git-hash ID 不变）。
- [ ] AC3：非 git 目录的 session 落 `global` 桶且可见；后续 `git init` 后旧 session 不 orphan（前缀认领或回退扫描命中）。
- [ ] AC4：`WASTELAND_DATA_DIR` 覆盖生效；`WASTELAND_HOME` 旧语义不变。
- [ ] AC5：无迁移脚本、无双读分支；老目录原地保留且不再被读写；`data/migration==1`。
  注：历史 session 在新方案下不可见（用户已接受，用完即走）。
- [ ] AC6：`npm run typecheck && npm run lint && npm test` 全绿（仅允许此前已知的 3 个他人 WIP 失败）；
  无新增硬编码路径字符串（全部走 paths.ts）。

## Out of Scope

- 设置/技能/角色配置的中央化；SQLite 化（OpenCode 新版方向，本次保持 JSONL，读路径已抽象，未来可换）；
- 跨机器同步/加密；`message/part` 级细拆（wasteland transcript 已是整轮 JSONL，保持现状）；
- 删除 legacy 数据（留待 M2，由用户显式触发）。

## Open Questions

- 无阻塞问题。迁移策略已由用户决策为绿地新做（不迁旧数据）。

## 收口记录（2026-09-15）

中央数据根已落地并成为既有事实：docs/architecture/configuration.md 的「中央数据根」节即其产物，日志/transcript/导出物统一按 projectID 收纳。
