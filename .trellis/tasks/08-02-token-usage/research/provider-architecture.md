# Research: Provider Architecture and OpenAI Compatible API Response Handling

- **Query**: Explore Provider architecture and OpenAI compatible API response handling for usage field extraction
- **Scope**: Internal (codebase analysis)
- **Date**: 2026-08-02

## Findings

### 1. Provider Architecture Overview

The provider system follows a clean architecture pattern with three registered provider types:

| Provider Type | Factory Function | File |
|---|---|---|
| `local` | `createLocalProvider()` | `src/providers/local.ts` |
| `openai-compatible` | `createOpenAIProvider()` | `src/providers/openai.ts` |
| `anthropic` | `createClaudeProvider()` | `src/providers/claude.ts` |

Registration happens in `src/providers/provider-registry.ts` (lines 91-100).

### 2. OpenAI Provider SSE Streaming Flow

**Entry point**: `src/providers/openai.ts` - `requestOpenAIStreaming()` (line 132)

**Flow**:
1. Build request body with `model`, `messages`, `stream: true`, optional `tools`
2. POST to `{baseUrl}/chat/completions` via `fetchWithRetry()`
3. Parse response body as SSE stream via `parseSSEStream(reader)` (line 185)
4. Subscribe to SSE events, parse JSON chunks as `OpenAIStreamChunk`
5. Emit `ProviderStreamEvent` based on chunk content

**Key processing in `sse$.subscribe()` (lines 191-263)**:
- Text content: `choice.delta?.content` → emits `{ type: 'assistant_chunk', text }`
- Tool calls: `choice.delta?.tool_calls` → accumulates in `toolCallMap`
- Finish reason `tool_calls`: flushes accumulated tool calls as `{ type: 'tool_call', call }`
- Finish reason `stop`: sets `finished = true`
- Stream complete: emits `{ type: 'assistant_message', text: '' }` if no tool calls

### 3. OpenAI Stream Chunk Type Definition

**File**: `src/providers/openai.ts` (lines 59-79)

```typescript
type OpenAIStreamChunk = {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'tool_calls' | null;
  }>;
  error?: {
    message?: string;
  };
};
```

**CRITICAL**: The `OpenAIStreamChunk` type does NOT include `usage` field. OpenAI's streaming API can return usage information, but it's not captured.

### 4. Usage Field Status

**NOT currently parsed or used** in the OpenAI provider.

The only reference to `usage` in the codebase is in the non-streaming response type:

**File**: `src/providers/openai-compatible/types.ts` (lines 174-178)
```typescript
export type OpenAIChatCompletionResponse = {
  // ...
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};
```

This type is defined but never imported or used in the streaming code path.

### 5. Claude Provider Comparison

**File**: `src/providers/claude.ts`

The Claude provider has a similar issue. The `ClaudeSSEEvent` type (line 80) includes `usage?: object` for `message_delta` events, but the actual usage data is NOT extracted or emitted.

### 6. Provider Stream Event Types

**File**: `src/providers/provider-types.ts` (lines 37-55)

Current `ProviderStreamEvent` discriminated union:
```typescript
export type ProviderStreamEvent =
  | { type: 'assistant_chunk'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'assistant_message'; text: string };
```

**No usage/event type exists** for token usage information.

### 7. Runtime Event Flow

**File**: `src/core/runtime/event-types.ts`

`RuntimeEvent` is a larger discriminated union that includes UI-facing events. Currently no usage-related event type exists.

**File**: `src/core/runtime/agent-loop.ts` (lines 486-550)

The agent loop processes `ProviderStreamEvent` and converts to `RuntimeEvent`:
- `assistant_chunk` → `RuntimeEvent { type: 'assistant_chunk' }`
- `assistant_message` → `RuntimeEvent { type: 'assistant_message' }`
- `tool_call` → buffered, processed after stream completes

### 8. How to Extend for Usage Capture

**Option A: New ProviderStreamEvent type**

Add to `src/providers/provider-types.ts`:
```typescript
| {
    type: 'usage';
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }
```

**Option B: OpenAI API stream_options parameter**

OpenAI API supports `stream_options: { include_usage: true }` to get usage in the final chunk. Modify:
1. `src/providers/openai.ts` line 141: Add `stream_options: { include_usage: true }` to request body
2. `src/providers/openai.ts` line 59: Extend `OpenAIStreamChunk` type to include `usage` field
3. Parse the usage chunk and emit via new event type

**Option C: Track usage in turn state**

Add usage tracking to `TurnState` in `src/core/runtime/turn-state.ts`.

## Files Found

| File Path | Description |
|---|---|
| `src/providers/openai.ts` | OpenAI-compatible SSE streaming provider |
| `src/providers/claude.ts` | Claude Anthropic SSE streaming provider |
| `src/providers/provider-types.ts` | ProviderStreamEvent type definition |
| `src/providers/provider-registry.ts` | Provider factory registration |
| `src/providers/sse-parser.ts` | SSE stream parser utility |
| `src/providers/shared/retry.ts` | fetchWithRetry and parseToolArguments |
| `src/providers/openai-compatible/types.ts` | OpenAI API type definitions (includes usage type) |
| `src/providers/openai-compatible/index.ts` | OpenAI-compatible module exports |
| `src/providers/openai-compatible/tool-adapter.ts` | Tool definition conversion |
| `src/providers/openai-compatible/message-builder.ts` | Message array construction |
| `src/providers/assistant-events.ts` | Helper for creating assistant text events |
| `src/providers/local.ts` | Local command provider |
| `src/core/runtime/agent-loop.ts` | Agent loop consuming provider events |
| `src/core/runtime/event-types.ts` | RuntimeEvent type definition |

## Related Specs

- `.trellis/spec/backend/tool-runtime-contracts.md` - Phase 5 OpenAI-compatible provider tool calling
- `.trellis/spec/backend/cli-tui-contracts.md` - CLI/TUI contracts including provider registry

## Caveats / Not Found

1. **No existing usage tracking**: The codebase has zero infrastructure for token usage tracking
2. **OpenAI stream_options not used**: The `stream_options: { include_usage: true }` parameter is not sent in requests
3. **Claude usage field ignored**: Even though the type includes `usage?: object`, it's not extracted
4. **No cost calculation**: No pricing/cost calculation infrastructure exists
5. **TurnState has no usage field**: `src/core/runtime/turn-state.ts` doesn't track usage
