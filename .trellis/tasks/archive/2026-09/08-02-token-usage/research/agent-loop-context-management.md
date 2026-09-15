# Research: Agent-Loop and Context Management Mechanism

- **Query**: Explore agent-loop and context management mechanism in wasteland project
- **Scope**: internal
- **Date**: 2026-08-02

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/core/runtime/agent-loop.ts` | Core agent loop implementation with RxJS reactive patterns |
| `src/core/runtime/turn-state.ts` | Turn state management for single turn lifecycle |
| `src/core/runtime/turn-context.ts` | Turn context definition for provider communication |
| `src/core/runtime/event-types.ts` | All runtime event and record type definitions |
| `src/core/runtime/session-manager.ts` | Session persistence with buffered writes |
| `src/providers/provider-types.ts` | Provider interface and usage types |
| `src/providers/openai.ts` | OpenAI-compatible provider with SSE streaming |
| `src/providers/claude.ts` | Claude API provider with SSE streaming |
| `src/providers/openai-compatible/message-builder.ts` | Message construction for OpenAI format |
| `src/tui/hooks/useRuntimeEvents.ts` | TUI event handling and usage accumulation |

### 1. Agent-Loop Core Structure

#### Overall Architecture

The agent loop uses RxJS reactive patterns with a three-phase design:

```
input$ (user input stream)
   ↓
runAgentLoop
   ↓
┌─────────────────────────────────────┐
│  1. start$: session_started event   │
│     ↓                               │
│  2. turns$: process each user input│
│     ├─ user$: user_turn event       │
│     └─ assistant$: runTurnLoop      │
│     ↓                               │
│  3. end$: session_ended event       │
└─────────────────────────────────────┘
```

#### Key Design Pattern: defer + concat + recursion

The `runTurnLoop` function (lines 363-954 in agent-loop.ts) implements a recursive turn loop using:

1. **defer**: Delays execution until Observable is subscribed, enabling re-evaluation of conditions on each recursion
2. **concat**: Ensures provider$ completes before continuation$ starts
3. **Recursion**: Calls itself when tool calls need to be processed

```typescript
// agent-loop.ts:952
return concat(provider$, continuation$);
```

### 2. Message History Construction

#### History Storage

- **In-memory**: `history: SessionMessageRecord[]` array maintained in `runAgentLoop` closure (line 1106)
- **Persistence**: Each record appended to JSONL file via `SessionManager.appendRecord()`

#### History Flow

1. **User message added**: `history.push(userRecord)` after persistence (line 1182)
2. **Assistant message added**: `history.push(assistantRecord)` after persistence (line 265)
3. **History snapshot**: Copied before each turn for provider context (line 1161):
   ```typescript
   const historySnapshot = [...history];
   ```

#### Message Building for Provider

The `buildMessages()` function in `src/providers/openai-compatible/message-builder.ts` constructs the API message array:

```typescript
// message-builder.ts:56-122
export function buildMessages(params: {
  history: readonly SessionMessageRecord[];
  input: string;
  toolResults: readonly TurnToolResult[];
  prompt?: string;
}): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  
  // 0. System message (if prompt provided)
  if (params.prompt) {
    messages.push({ role: 'system', content: params.prompt });
  }
  
  // 1. Historical messages (user/assistant only, skip tool records)
  for (const record of params.history) {
    if (record.type !== 'message') continue;
    messages.push({ role: record.role, content: record.content });
  }
  
  // 2. Current user input
  messages.push({ role: 'user', content: params.input });
  
  // 3. Tool results (if any)
  if (params.toolResults.length > 0) {
    // Add assistant message with tool_calls
    messages.push({ role: 'assistant', content: null, toolCalls });
    // Add tool result messages
    for (const result of params.toolResults) {
      messages.push({ role: 'tool', tool_call_id, content });
    }
  }
  
  return messages;
}
```

### 3. TurnState Structure and Purpose

#### Type Definition (turn-state.ts:15-27)

```typescript
export type TurnState = {
  sessionId: string;
  turn: number;
  cwd: string;
  input: ChatInputTurn;
  history: readonly SessionMessageRecord[];
  step: number;                    // Current step within turn (for tool loops)
  status: TurnStatus;              // 'running' | 'completed' | 'failed'
  assistantChunks: readonly string[]; // Accumulated streaming chunks
  finalMessage?: string;           // Completed assistant message
  toolCalls: readonly ToolCall[];  // Tool calls made this turn
  toolResults: readonly TurnToolResult[]; // Tool execution results
};
```

#### State Management Functions

| Function | Purpose | Location |
|---|---|---|
| `createInitialTurnState()` | Creates initial state for new turn | turn-state.ts:29-47 |
| `advanceTurnState()` | Increments step counter for tool loops | turn-state.ts:49-54 |
| `appendAssistantChunk()` | Adds streaming text chunk | turn-state.ts:56-61 |
| `completeTurnState()` | Marks turn completed with final message | turn-state.ts:63-69 |
| `recordToolCall()` | Records a tool call request | turn-state.ts:78-83 |
| `recordToolResult()` | Records tool execution result | turn-state.ts:85-90 |

### 4. How Messages Pass to Provider

#### Provider Interface (provider-types.ts:85-88)

```typescript
export type ProviderStepInput = {
  context: TurnContext;  // Session context + history + toolRegistry
  state: TurnState;      // Current turn state with toolResults
};
```

#### Provider Implementation Pattern

Both OpenAI and Claude providers follow the same pattern:

```typescript
// openai.ts:320-333
runStep({ context, state }: ProviderStepInput) {
  return defer(async () => {
    const messages = buildMessages({
      history: context.history,
      input: context.input.content,
      toolResults: state.toolResults,
      prompt: context.prompt,
    });
    
    const tools = context.toolRegistry ? buildOpenAITools(context.toolRegistry) : undefined;
    
    return requestOpenAIStreaming(config, messages, tools);
  }).pipe(concatMap((obs) => obs));
}
```

### 5. Token Usage Accumulation

#### Provider Level

Providers emit `usage` events with token counts (openai.ts:278-288):

```typescript
if (lastUsage) {
  subscriber.next({
    type: 'usage',
    usage: {
      promptTokens: lastUsage.prompt_tokens,
      completionTokens: lastUsage.completion_tokens,
      totalTokens: lastUsage.total_tokens,
      cachedTokens: lastUsage.prompt_tokens_details?.cached_tokens,
    },
  });
}
```

#### Runtime Level

The agent-loop processes usage events (agent-loop.ts:578-596):

```typescript
if (event.type === 'usage' && event.usage) {
  const usage = event.usage;
  return from(
    params.sessionManager.appendRecord(
      params.session,
      createUsageRecord(params.session.id, state.turn, usage)
    )
  ).pipe(
    map((): RuntimeEvent => ({
      type: 'usage_update',
      sessionId: params.session.id,
      turn: state.turn,
      usage,
    }))
  );
}
```

#### UI Level Accumulation

TUI accumulates usage across turns (useRuntimeEvents.ts:391-408):

```typescript
case 'usage_update': {
  return {
    // ... other state
    usage: {
      promptTokens: currentState.usage.promptTokens + event.usage.promptTokens,
      completionTokens: currentState.usage.completionTokens + event.usage.completionTokens,
      totalTokens: currentState.usage.totalTokens + event.usage.totalTokens,
      cachedTokens: currentState.usage.cachedTokens + (event.usage.cachedTokens ?? 0),
    },
  };
}
```

### 6. Context Truncation/Compression Logic

**Current Status: NO context truncation or compression exists.**

The search found:
- No `truncat` or `compress` logic in agent-loop or turn-state
- No `context window` or `token limit` management
- No `sliding window` or `prune` mechanisms
- Only output truncation in UI display (terminal-renderer.ts) and tool output limits (web-fetch.ts, git.ts)

The history array grows unbounded within a session. The only limits are:
- `maxStepsPerTurn` (default: 8) - limits tool call recursion within a single turn
- `maxTurns` (default: 20) - limits total user turns per session

### 7. RxJS Usage Patterns in Agent-Loop

#### Key Operators Used

| Operator | Purpose | Location |
|---|---|---|
| `defer` | Lazy evaluation, re-evaluate on each recursion | agent-loop.ts:391, 518, 876, 1092 |
| `concat` | Sequential execution (provider then continuation) | agent-loop.ts:952, 1234, 1266 |
| `concatMap` | Process each input sequentially | agent-loop.ts:1104, 1159 |
| `mergeMap` | Process streamed events | agent-loop.ts:690 |
| `tap` | Side effects (logging, state updates) | Throughout |
| `map` | Transform values | Throughout |
| `from` | Convert Promise to Observable | agent-loop.ts:263, 562, etc. |
| `of` | Create single-value Observable | agent-loop.ts:542, 758 |
| `toArray` | Collect all tool events | agent-loop.ts:803 |
| `catchError` | Handle provider errors | agent-loop.ts:692 |
| `concatWith` | Append continuation after provider | agent-loop.ts:722 |

#### Streaming Pattern

```typescript
// agent-loop.ts:673-723
return params.provider
  .runStep({ context: params.context, state })
  .pipe(
    // Buffer tool calls, emit non-tool events immediately
    tap((e) => { if (tool_call) toolCallBuffer.push(e); }),
    mergeMap((e) => processStreamedNonToolEvent(e)),
    catchError((err) => /* error to assistant_message */),
    concatWith(defer(() => processProviderTail()))
  );
```

### Related Specs

- `.trellis/spec/backend/runtime-contracts.md` - Runtime contracts and signatures
- `.trellis/spec/backend/tool-runtime-contracts.md` - Tool lifecycle contracts

## Caveats / Not Found

1. **No context window management**: History grows unbounded. Long sessions will eventually exceed provider context limits.
2. **No token counting in agent-loop**: Token usage is only tracked via provider responses, not calculated before sending.
3. **No message pruning**: Old messages are never removed from history array.
4. **TurnState is immutable-style**: Uses spread operator for updates, but `state` variable in agent-loop is reassigned (mutable reference).
5. **History snapshot timing**: History is snapshotted at turn start, so tool results from current turn are passed via `state.toolResults`, not `context.history`.

## Critical Observations for Token Usage Task

1. **Usage tracking exists but is passive**: Only records what providers report, no proactive management.
2. **No pre-flight token estimation**: Cannot predict if request will exceed context window.
3. **Unbounded history accumulation**: Primary risk for context overflow in long sessions.
4. **Tool results in state.toolResults**: These are per-turn and reset each turn, but still included in API messages.
5. **System prompt not counted**: No local calculation of system prompt token cost.
