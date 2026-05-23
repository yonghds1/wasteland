# Runtime 层

本目录当前已经承载 Phase 1 的最小 agent runtime：

- `event-types.ts`：运行时事件与 transcript 记录类型
- `debug-events.ts`：调试追踪事件类型
- `turn-context.ts`：provider 调用所需 turn 上下文
- `turn-state.ts`：单轮运行态与状态推进辅助
- `session-manager.ts`：本地 session transcript 管理
- `agent-loop.ts`：turn 编排入口
- `permission-gate.ts`：工具权限判断
- `tool-dispatch.ts`：工具调用生命周期分发

后续建议继续放在这里的能力：

- `session-index.ts`
