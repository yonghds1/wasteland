# 文档旧路径清扫

## Goal

README / user-guide / 架构文档 / 源码注释里残留的 `.wasteland/logs`、`.wasteland/sessions`、
`.wasteland/exports` 旧路径表述全部更新到中央数据根，与已落地的 configuration.md 存储节一致，
终结“按文档找不到文件”。

## Requirements

- R1：`README.md`（L243-244、L291、L354、L358、L371-372）、`docs/user-guide/multi-agent.md`、
  `docs/architecture/runtime-boundaries.md`、`docs/architecture/multi-agent-architecture.md` 的旧路径段落更新。
- R2：源码注释：`file-sink.ts`、`file-log-loader.ts`、`rotation.ts`、`spawn-agent/index.ts`、
  `settings-types.ts` 里的旧路径字样更新（只改注释，不改行为）。
- R3：全文 grep `\.wasteland/logs`、`\.wasteland/sessions`、`\.wasteland/exports` 收敛到零（测试 fixture 与
  刻意保留的“旧目录废弃声明”除外，逐条确认）。

## Acceptance Criteria

- [x] AC1：`grep -rn "\.wasteland/\(logs\|sessions\|exports\)" README.md docs/ src/` 收敛 **5 → 4**，
      余下 4 处均为 R3 允许的例外，逐条确认如下：
      - `docs/implementation/phase-3-multi-step-agent-loop.md:338` —— 该文档头部自述「本文档保留为实现记录」，
        改写等于篡改历史记录，保留。**属"实现记录"类例外**。
      - `docs/implementation/phase-1-agent-runtime.md:51` —— 同为已完成阶段的实施方案（历史记录），保留。
      - `src/config/settings-types.ts:258`（注释）与 `:398`（默认值） —— 注释明写「历史默认…本字段仅保留作
        配置面兼容，改它不影响落盘位置」，**属"旧目录废弃声明"类例外**。
      - **本次实修 1 处**：`docs/architecture/configuration.md:204` 原让用户「把 `.rx-cli/sessions/` 合并到
        `.wasteland/sessions/`」，与同文件 L42「旧 `.wasteland/{logs,sessions}` 原地保留但不再读写」
        直接矛盾，且会把用户数据迁进已废弃目录 —— 已改为迁入中央数据根 `sessions/<projectId>/`。
- [x] AC2：`npm run check:fast` 绿（exit 0）；纯文档/注释改动，测试不受影响。

> 注：AC1 原命令串含 `--include=*.ts`，会漏掉 `.md`，与实际 grep 范围不符（R3 明确覆盖全文）；
> 且 R3 允许的例外未在命令中排除。上表按 R3 的真实意图逐条判定，而非按原命令串字面。

## Out of Scope

- 行为代码；`.trellis/spec`（真源，已是新语义，无需改）。
