# Design：日志存储中央化（绿地）

## 架构与边界

- 只动**数据**路径层与读聚合层，不动配置层（settings/skills/roles/auth）、不动单条 JSONL schema、不动 core 事件结构。
- 唯一路径来源：`src/config/paths.ts`（新增 `resolveDefaultDataDir` / `resolveProjectId` / `dataDirFor(projectID)`）；
  新增薄封装 `src/core/logger/data-store.ts`（`logDirFor(projectID?)`、`listProjectIds()`、`locateSession(sessionId)`：
  索引优先→全根扫描回退，吸取 OpenCode #8538 教训）。

## 数据流与关键决策

- projectID：`git rev-list --max-parents=0 --all` 排序取首（与 OpenCode 一致，目录改名稳定）；
  非 git/失败回退 `sha1(resolve(cwd))[:16]` + `project.json {id, vcs, worktree, created}`；
  纯函数 `deriveProjectId({gitRootHash?, cwd})` 可单测（git 调用留在外层）。
- 写：FileSink dir → `data/logs/<projectID>/`；transcript → `data/sessions/<projectID>/`；
  session 日志 `data/logs/<projectID>/sessions/<id>.jsonl`（复用 FileSink 现有 sessions 子目录约定）。
- 读：`listSessions({dir})` 扩展 `listAllSessions({root})`（扫全部 projectID，附 project 标签；沿用现有文件指纹缓存）；
  LogsPage 左栏本项目置顶 + 其他项目分组；`locateSession` 供 resume/export 跨目录定位。
- `sessions/resume/logs/export` 命令的目录参数全部改经 data-store（删 `DEFAULT_EXPORT_DIR` 硬编码，导出默认 `data/exports/`）。
- env：`WASTELAND_DATA_DIR` 覆盖数据根；`WASTELAND_HOME` 语义不变（数据根默认在其下）；
  `WASTELAND_LOG_DIR` 保留为单目录调试覆盖（高于一切，便于排障）。

## 兼容与 trade-off

- 旧 `.wasteland/{logs,sessions}`：一行不删、一行不读（用户决策）；`docs/architecture/configuration.md` 存储节重写，
  注明旧目录废弃、M2 清理另起任务。
- 他人 WIP（`paths.ts` 的 resolveDefaultLogDir/TraceDir 改动、`agent-loop.ts`）正在树上：
  落地前必须先 `git diff` 对齐，冲突面是 paths.ts——实现时以对方已合入版为基。
- 不引入 SQLite（保持 JSONL，data-store 已抽象，未来可换）。

## 回滚点

- 每个命令（logs/sessions/resume/export）独立 commit；paths.ts 改动单独一 commit；
  任一回滚只影响新数据可见性，不伤旧数据（旧目录原封不动）。
