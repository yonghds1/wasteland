# fix: 子 agent session 完整性 + Thinking 块皮肤颜色

## Goal

修复子 agent session 完整性问题 + Thinking 块使用皮肤颜色。两个独立的低风险改动合并。

## Problems

### 1. 子 agent session 不完整

`src/tools/spawn-agent.ts` 用 `take(1)` 退订 `events$`，导致 `runAgentLoop` 的 `end$` 不执行，子 session.jsonl 缺少 `session_end` 记录。后续 resume 会遇到时间线不完整。

### 2. Thinking 块颜色

`src/tui/components/ChatMessageList.tsx` 的 `ThinkingBlock` 用 `wastelandTheme.colors.muted` 写死，没有用 `skin.colors.thinking`。每个皮肤应该有自己的 thinking 颜色。

## Requirements

### R1: 子 agent session 完整性

- `spawn-agent.ts` 在 `take(1)` 之前**先 closeSession**（append `session_end` 记录）
- 即使 `take(1)` 退订了，`session_end` 已经持久化
- 不阻塞 retry 流程（重试场景下也写 `session_end`，但子 session 会重新创建）

### R2: Thinking 块颜色

- `ChatMessageList.tsx` 的 `ThinkingBlock`：`color = skin?.colors?.thinking ?? wastelandTheme.colors.muted`
- 同步 client/list 状态文件中所有 `MUTED` thinking 引用

## Acceptance Criteria

- [ ] 子 agent 完成后 `.wasteland/sessions/*.jsonl` 包含 `session_end` 记录
- [ ] 现有 451 测试通过
- [ ] dirty 文件 ≤ 5 个
- [ ] session 完整性 + thinking 颜色都验证

## Out of Scope

- SessionIndexPage 恢复会话（独立工单）
- 消息折叠 / `/export` 命令

## Tasks

- Task 1: 子 agent session 完整性
- Task 2: Thinking 块颜色

## Implementation Plan

### Task 1: 子 agent session_end

```ts
// src/tools/spawn-agent.ts
const result$ = events$.pipe(
  filter(isAssistantMessage),
  take(1),
  timeout(...),
  // 任务 1 改动：先 close 再 take
  // 实际：sub agent 从 sessionManager 拿，session 关闭通过 sessionManager
);
```

让 `spawn-agent` 在 `runAgentLoop` 执行前记录 `subAgentSession = sessionManager.createChildSession(...)`。subscribed 到 events$ 时收到 `session_started` 立即即拿 sub session，子 agent 完成后写 `session_end`。

### Task 2: Thinking 颜色

```ts
// src/tui/components/ChatMessageList.tsx
<Text color={skin?.colors?.thinking ?? wastelandTheme.colors.muted} dimColor>
  {streaming ? ' ⏳ Thinking...' : ' 💭 Thinking'}
</Text>
```

## Technical Notes

- `sessionManager.createChildSession` 已存在（之前 #4 重构）
- `sessionManager.appendRecord` 接受 `session_end` 类型
- skin 已有 `colors.thinking` 字段（之前 PR #21b2b9c 加的）
- 451 既有测试 + 2-3 个新测试
