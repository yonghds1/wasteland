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

- [ ] AC1：`grep -rn "\.wasteland/\(logs\|sessions\|exports\)" README.md docs/ src/ --include=*.ts | grep -v test | grep -v 废弃` 为空。
- [ ] AC2：`npm run check:fast` 绿（纯文档/注释改动，测试不受影响）。

## Out of Scope

- 行为代码；`.trellis/spec`（真源，已是新语义，无需改）。
