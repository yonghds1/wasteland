# Token Usage 追踪与显示

## Goal

在 TUI 底部状态栏显示 token 使用量、输出速度、首 token 延迟等信息，并在 session 日志中记录每次请求的 usage 数据。

## Requirements

### P0: Token 使用量 (ctx)
- Provider 捕获 API 响应中的 `usage` 字段
- RuntimeEvent 增加 `usage_update` 事件类型
- Session 日志记录每次请求的 usage
- TUI state 累积 token 使用量
- ChatInputBar 显示 `ctx: 已用/总量`

### P1: 输出速度 (speed)
- 计算 `completion_tokens / 响应时间`
- 显示 `▲ 42 t/s`

### P2: 首 token 延迟 (TTFT)
- 记录请求发送时间
- 记录首个 chunk 到达时间
- 显示 `⚡ 1.2s`

### P3: 缓存命中率 (cache)
- 从 `usage.prompt_tokens_details.cached_tokens` 获取
- 显示 `⊘ 68%`

## 数据流

```
OpenAI API Response
  ↓ usage 字段
Provider (openai.ts)
  ↓ ProviderStreamEvent { type: 'usage', data: {...} }
Agent Loop (agent-loop.ts)
  ↓ RuntimeEvent { type: 'usage_update', ... }
Session Manager (session-manager.ts)
  ↓ 写入 JSONL
Output Adapter (output-adapter.ts)
  ↓ DisplayEvent
TUI Hook (useRuntimeEvents.ts)
  ↓ 更新 AppState
ChatInputBar
  ↓ 显示 ctx / speed / TTFT
```

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/providers/openai.ts` | 捕获 usage，发送 stream_options |
| `src/providers/provider-types.ts` | 增加 usage ProviderStreamEvent |
| `src/core/runtime/event-types.ts` | 增加 usage_update RuntimeEvent |
| `src/core/runtime/agent-loop.ts` | 转换 ProviderStreamEvent → RuntimeEvent |
| `src/core/runtime/session-manager.ts` | 记录 usage 到 JSONL |
| `src/tui/context/AppContext.tsx` | state 增加 usage 字段 |
| `src/tui/hooks/useRuntimeEvents.ts` | 处理 usage_update 事件 |
| `src/tui/components/ChatInputBar.tsx` | 显示 usage 信息 |
| `src/tui/components/ChatArea.tsx` | 传递 usage 数据 |

## 技术方案

### 1. Provider 层：捕获 usage

```typescript
// openai.ts - 请求增加 stream_options
body: {
  stream: true,
  stream_options: { include_usage: true },
  ...
}

// openai.ts - 解析最后一个 chunk 的 usage
if (chunk.usage) {
  subscriber.next({
    type: 'usage',
    usage: {
      promptTokens: chunk.usage.prompt_tokens,
      completionTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
      cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
    },
  });
}
```

### 2. Event 层：增加 usage_update

```typescript
// event-types.ts
| {
    type: 'usage_update';
    sessionId: string;
    turn: number;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedTokens?: number;
    };
    timing?: {
      ttftMs: number;      // 首 token 延迟
      totalMs: number;     // 总响应时间
      tokensPerSec: number; // 输出速度
    };
  }
```

### 3. State 层：累积 usage

```typescript
// AppContext.tsx
usage: {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  lastTurnUsage?: { ... };
  lastTiming?: { ... };
}
```

### 4. 显示层：底部状态栏

```
 ctx: 1.2k/128k  ·  ▲ 42 t/s  ·  ⚡ 1.2s  ·  turns: 3/20
```

## Acceptance Criteria

- [ ] Provider 正确捕获 usage 字段
- [ ] usage_update 事件正确发射
- [ ] Session 日志记录 usage 数据
- [ ] TUI state 正确累积 usage
- [ ] ChatInputBar 显示 ctx 值
- [ ] 显示输出速度 (t/s)
- [ ] 显示首 token 延迟 (TTFT)
- [ ] Context window 从模型配置获取

## Out of Scope

- 成本计算（需要价格表，后续实现）
- 多模型 context window 自动检测
- Usage 历史图表

## Technical Notes

- OpenAI API 需要 `stream_options: { include_usage: true }` 才能在流式响应中返回 usage
- MiniMax API 兼容 OpenAI 格式，应该也支持 usage
- Context window 需要从模型配置或硬编码获取
- Session 日志已经是 JSONL 格式，追加 usage 记录即可
