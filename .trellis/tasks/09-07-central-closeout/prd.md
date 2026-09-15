# 中央存储收尾三件套

## Goal

09-06 中央日志存储落地后的三项收尾：sidecar 改道中央根、首 token 计时 trace、文档旧路径清扫。

## Requirements

三件套拆为三个可独立验证的子任务，各自独立规划/实现/验收：

| 子任务 | 交付 | 结果 |
|---|---|---|
| `09-07-sidecar-reroute` | spawn 子会话 sidecar 从硬编码 `<cwd>/.wasteland/logs/transcript` 改走中央数据根 | 已实现并归档（2026-09-15） |
| `09-07-first-token-timing` | `provider.start` → 首个 assistant_chunk 耗时落 trace，`/logs` 可见 | 已实现并归档（2026-09-15） |
| `09-07-docs-sweep` | README / 架构文档 / 源码注释的旧路径表述收敛到中央数据根 | 已收口并归档（2026-09-15） |

## Acceptance Criteria

- [x] 三个子任务各自归档，其 PRD 的 AC 均已勾对并附实证。
- [x] 代码侧无遗留：`writeSubagentSidecar` 走中央根（`spawn-agent/index.ts:376-386`）；首 token trace
      在 `turn-executor.ts:99,162,302-314` 与 `turn-helpers.ts:145-171`。
- [x] 文档侧残留收敛 5 → 4，余下 4 处为实现记录与配置面兼容声明，已在 `09-07-docs-sweep` PRD 逐条确认；
      实修 1 处内部矛盾（`configuration.md` 的迁移目标指向已废弃目录）。

## Notes

- **一件需要留痕的取证局限**：`09-07-first-token-timing` 的 AC1（真实一轮对话后 `/logs` 可见
  `provider.first_chunk`）**未做端到端跑验**，是按「代码路径 + 单测」证据接受的。若后续 `/logs`
  里见不到该 trace，先回到该任务的 PRD 看记录，而非重新排查整条链路。
- 父任务自身无直接实现工作，其产出即三个子任务的验收结论。
