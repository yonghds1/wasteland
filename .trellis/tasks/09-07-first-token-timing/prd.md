# 首token计时trace

## Goal

让“3 秒等什么”可观测：记录 provider.start → 首个 assistant_chunk 的耗时，进 `Logger.info`（FileSink 落盘，`/logs` 可见），用户下次问“慢”直接看日志而不再猜。

## Requirements

- R1：`TurnExecutor` 在 `provider.start` trace 处记录高精度起点（`performance.now()` 或 Date.now，一处）；
  首个流经 `processStreamedNonToolEvent` 的 `assistant_chunk`（或 assistant_message 非流式直达）发一条
  `scope:'provider', phase:'provider.first_chunk'` trace，data 带 `elapsedMs` + provider id。
- R2：只记首个（flag 复位 per turn/step？按 turn 计一次即可，避免工具多 step 刷屏）。
- R3：单测：调 reducer？不——trace 在 TurnExecutor 内；测 `processStreamedNonToolEvent` 首 chunk 触发一次、次 chunk 不触发。
  若该函数不可单测拆分，退为集成断言：跑 local provider 一轮，debug$ 含 first_chunk（local provider 是否走同一路径需先验，不走则换 qwen mock）。

## Acceptance Criteria

- [ ] AC1：真实一轮对话后，`/logs`（或 `wasteland logs show <sid>`）可见 `provider.first_chunk ... elapsedMs`。
- [ ] AC2：多 chunk 只记一条；工具多 step 不重复刷。
- [ ] AC3：相关单测绿；typecheck/lint 绿。

## Out of Scope

- 降延迟本身（模型/参数调优另议）；UI 倒计时展示（已有 elapsed 秒数）。
