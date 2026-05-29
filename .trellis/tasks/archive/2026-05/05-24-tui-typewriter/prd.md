# TUI 打字机效果 - 流式消息实时显示

## Goal

让 TUI 消息列表实时显示流式输出的 chunk，实现打字机效果，而非等待完整消息后才显示。

## What I already know

**问题根因**：
- Provider 层正确发送 `assistant_chunk` 事件（逐字符）
- Runtime 层正确转发 chunk 到 TUI
- TUI 层 `useRuntimeEvents` 只累积 chunk 到 `chunkAccumulator`，不触发 UI 更新
- 只有 `assistant_message` 事件才创建消息并显示

**数据流现状**：
```
Provider → assistant_chunk (单字符)
    ↓
Runtime → RuntimeEvent { type: "assistant_chunk", chunk: "H" }
    ↓
TUI useRuntimeEvents → chunkAccumulator.current += event.chunk  (只累积，不渲染)
    ↓
Provider → assistant_message (完整文本)
    ↓
TUI → 创建消息，一次性显示完整内容
```

**相关文件**：
- `src/tui/hooks/useRuntimeEvents.ts` - 事件订阅，chunk 累积逻辑
- `src/tui/components/session/MessageList.tsx` - 消息列表显示
- `src/tui/context/AppContext.tsx` - 状态定义
- `src/providers/assistant-events.ts` - chunk 事件生成
- `src/runtime/agent-loop.ts` - chunk 事件转发

## Assumptions (temporary)

- 打字机效果仅用于 assistant 消息
- chunk 速率足够快，不需要额外动画延迟
- 保持 Hermes 风格显示（流式光标 ▌）

## Open Questions

* ~~如何触发 UI 更新？直接修改 messages 还是新增 streamingContent 状态？~~
* **已决定**：采用方式 A，新增 streamingContent 状态

## Requirements (evolving)

* TUI 实时显示流式输出的 chunk
* 保持 Hermes 风格的流式光标 ▌
* 流式结束后显示完整消息
* 在 AppContext 新增 `session.streamingContent` 状态
* useRuntimeEvents 每收到 chunk 更新 streamingContent
* MessageList 读取 streamingContent 显示流式内容

## Acceptance Criteria (evolving)

* [x] 发送消息后，TUI 逐字符显示 assistant 回复
* [x] 流式过程中显示 ▌ 光标
* [x] 流式结束后光标消失，显示完整消息
* [x] 滚动自动跟随流式内容

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* CLI 打字机效果（已有不同实现）
* 工具消息的流式显示
* 用户消息的流式显示

## Decision (ADR-lite)

**Context**: TUI 流式消息需要实时显示，但当前 chunk 只累积不渲染
**Decision**: 在 AppContext 新增 `session.streamingContent` 状态，useRuntimeEvents 更新它，MessageList 显示它
**Consequences**: 状态分离清晰，streamingContent 是临时状态，messages 是持久状态

## Technical Notes

* ink 使用 React 状态驱动渲染
* 需要确保 chunk 累积触发 React 重新渲染
* MessageList 已有 streamingContent 状态，但未正确连接
