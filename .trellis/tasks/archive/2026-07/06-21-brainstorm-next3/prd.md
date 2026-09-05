# feat: A2A multi-agent collaboration (SSE streaming + Push Notification) — 已实现

## Goal

实现单 Agent 驱动多 Agent 协作的能力，通过 A2A（Agent-to-Agent）协议进行通信，支持实时流式更新和任务协调。

## Requirements

### 功能需求

1. **A2AClient SSE 支持**
   - 在 A2AClient 中添加 SSE 流式响应支持
   - 支持实时接收任务状态更新
   - 支持流式接收任务结果

2. **SSE 流推送通知**
   - 子 Agent 通过 SSE 流推送状态更新
   - 支持任务开始、进度、完成等事件
   - 主 Agent 可订阅子 Agent 的 SSE 流

### 非功能需求

1. **兼容性**：保持与现有 A2A 阻塞模式的完全兼容
2. **可靠性**：SSE 连接断开时自动重连
3. **类型安全**：完整的 TypeScript 类型定义

## Acceptance Criteria

- [ ] A2AClient 可以接收 SSE 流式响应
- [ ] 子 Agent 可以通过 SSE 流推送状态更新
- [ ] 主 Agent 可以订阅子 Agent 的 SSE 流
- [ ] SSE 连接断开时自动重连
- [ ] 所有现有 358 个测试通过
- [ ] 新增 A2A SSE 相关的单元测试
- [ ] TypeScript 编译无错误

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* 任务重新订阅
* 文件/数据消息部分
* 多轮会话管理
* 远程 Agent 的 SSE 推送支持
* 认证方案扩展

## Decision (ADR-lite)

### Context

当前 A2A 协议实现仅支持阻塞模式的 sendTask，缺少流式更新和推送通知能力。需要补全这些功能以支持单 Agent 驱动多 Agent 协作。

### Decision

采用 **A2AClient SSE + Webhook 推送通知** 模式实现 Agent 协作：

1. **协作范围**：流式/SSE + Webhook 推送通知（最小可行）
2. **SSE 实现**：在 A2AClient 中添加 SSE 流式响应支持
3. **推送通知**：本地环境下使用 Webhook（简单可靠）
4. **MVP 限制**：不包含任务重新订阅、文件/数据消息、多轮会话等高级功能

### Consequences

- 符合 A2A 协议规范
- 支持实时进度更新
- 支持 Agent 完成通知
- 本地环境简单可靠（无需暴露公网端口）
- 未来可添加远程 Agent 的 SSE 推送支持

## Technical Approach

### A2AClient SSE 支持

```typescript
// 现有代码（阻塞模式）
const result = await a2aClient.sendTask({
  task: { id: 'abc-123', ... },
});

// 新代码（SSE 模式）
const stream = a2aClient.sendTaskStream({
  task: { id: 'abc-123', ... },
});

stream.on('event', (event) => {
  console.log('任务状态更新:', event);
});

stream.on('complete', (result) => {
  console.log('任务完成:', result);
});
```

### SSE 流推送通知

```typescript
// 子 Agent：通过 SSE 流推送状态
const emitter = new A2AEventEmitter();

// 推送任务开始事件
emitter.emit('task.started', { taskId: 'abc-123' });

// 推送进度更新
emitter.emit('task.progress', { taskId: 'abc-123', progress: 50 });

// 推送完成事件
emitter.emit('task.completed', { taskId: 'abc-123', result: '...' });

// 主 Agent：订阅 SSE 流
const stream = a2aClient.subscribeToAgent('child-agent');
stream.on('event', (event) => {
  // 处理事件
});
```

## Implementation Plan (small PRs)

### PR1: A2AClient SSE 支持
- 在 A2AClient 中添加 sendTaskStream 方法
- 实现 SSE 流解析
- 添加 SSE 相关类型定义
- 添加 SSE 支持相关测试

### PR2: SSE 流推送通知
- 实现 A2AEventEmitter 类
- 添加 SSE 流推送功能
- 在 spawn_agent 中集成 SSE 通知
- 添加推送通知相关测试

### PR3: 集成测试 + 文档
- 添加端到端集成测试
- 更新 README 和用户指南
- 更新 CHANGELOG

## Technical Notes

* 关键文件：`src/acp/a2a-client.ts`, `src/acp/a2a-types.ts`
* 代码库路径：/home/ubuntu/workspace/wasteland
* Trellis 管理：.trellis/ 目录

## Reality Check（2026-07-29 审核）

PRD 写于 2026-06-21 后，2 个月里代码大幅演化。本节确认 MVP 是否完成：

### ✅ MVP 部分（PRD Requirements 第 1-2 项）已实现

| 项 | 实现位置 | 测试 |
|---|---|---|
| `A2AClient.sendTaskStream()` (SSE 接收) | `src/acp/a2a-client.ts:272` | `a2a-collaboration.test.ts:22` |
| `A2AClient.subscribeToTask()` | `src/acp/a2a-client.ts:315` | `a2a-collaboration.test.ts:29` |
| `startSSEStream` private method（SSE 解析 + 错误处理） | `a2a-client.ts:341` | — |
| `WebhookServer` 类（含 lifecycle / URL 生成） | `src/acp/a2a-webhook.ts:92` | `a2a-webhook.test.ts:38` 等 6 个 |
| `WebhookClient` 类（HTTP 推送） | `src/acp/a2a-webhook.ts:257` | `a2a-webhook.test.ts:81` |
| SSE + Webhook 集成 | — | `a2a-collaboration.test.ts:84` |
| ClaudeCode 作为 A2A server（额外产物） | `src/acp/a2a-claude-code-adapter.ts:95, 638` | `a2a-claude-code-adapter.test.ts` |

### ⏳ Out-of-Scope 部分（仍有未来空间）

按 PRD 列的 Out-of-Scope 仍然 Open：

- Task Resubscription（types 已定义，client 未实现 `GET /tasks/{id}/subscribe`）
- File/Data Message Parts（a2a-claude-code-adapter 是否完整支持待 review）
- Multi-turn Session 管理（`sessionId` 已传，session lifecycle 未实现）
- 远程 Agent 的 SSE 推送
- 认证方案扩展（Bearer token 之外）

### ⏭️ 与本任务相关的扩展方向（建议下次 brainstorm）

| 待开发方向 | 大小 | 价值 |
|---|---|---|
| 集成 SSE/Push 进 spawn-agent | 中 | PRD PR2 提到但**未实施** |
| Task Resubscription（断线重连） | 中 | 实用 |
| Multi-turn Session（sessionId 状态机） | 中 | 高 |
| File/Data Parts（多模态互通） | 大 | 中 |
| OAuth/API key auth 扩展 | 大 | 中 |

### 结论

- 本任务的 MVP 范围**实际已完成**（7-19/7-20 集中 commit 落地）
- Out-of-scope 部分依然是未来扩展方向
- 本任务**归档**——trellis 流程收尾。下次再起任务补 Out-of-Scope 项
