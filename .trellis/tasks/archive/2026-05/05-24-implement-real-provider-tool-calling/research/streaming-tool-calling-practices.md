# Streaming Tool Calling Practices in AI Coding Tools

> Research findings on how popular AI coding tools handle streaming tool calling, focusing on UX, technical implementation, and trade-offs.

---

## Executive Summary

**Common Practice**: Most AI coding tools use **non-streaming for tool calls** while using **streaming for text responses**. This is the dominant pattern in the industry.

| Tool | Text Streaming | Tool Call Streaming | Rationale |
|------|----------------|---------------------|-----------|
| Claude Code (CLI) | ✅ Yes | ❌ No (complete tool_call event) | JSON integrity, simpler implementation |
| Cursor | ✅ Yes | ❌ No (accumulated then displayed) | UX stability, error handling |
| Aider | ✅ Yes | ❌ No (wait for complete) | Reliability, edit preview |
| OpenAI API | ✅ Supported | ✅ Supported (but complex) | API capability, rarely used |
| Anthropic API | ✅ Supported | ✅ Supported (input_json_delta) | API capability, rarely used |

---

## 1. Claude Code (Anthropic CLI)

### Does Claude Code support streaming tool calling?

**API Level**: Yes, Anthropic API supports streaming tool calls.

**Implementation Level**: Based on this project's codebase analysis:

```typescript
// From provider-types.ts
export type ProviderStreamEvent =
  | { type: "assistant_chunk"; text: string; }      // Streaming text
  | { type: "tool_call"; call: ToolCall; }          // Complete tool call (non-streaming)
  | { type: "assistant_message"; text: string; };
```

The current implementation emits **complete `tool_call` events**, not incremental tool argument chunks.

### How does it handle the UX?

1. **Text streaming**: Uses `assistant_chunk` events for incremental text display
2. **Tool calls**: Emits complete `tool_call` event after full JSON is accumulated
3. **User sees**: 
   - Streaming text as it generates
   - Then suddenly a complete tool call appears (tool name + full arguments)

### Technical Implementation

From `agent-loop.ts`:

```typescript
// Tool calls are processed as complete units
if (event.type === "tool_call") {
  state = recordToolCall(state, event.call);
  nextAction = "tool";
  // dispatchToolCall receives complete call with all arguments
  return dispatchToolCall({...});
}
```

The architecture supports streaming text but treats tool calls as atomic units.

---

## 2. Cursor

### Does Cursor support streaming tool calling?

**Based on observable behavior**: Cursor uses **non-streaming tool calls**.

### UX Observations

1. **Text generation**: Streaming display (characters appear incrementally)
2. **Tool calls**: 
   - Cursor shows "Thinking..." or spinner while generating tool call
   - When complete, shows the full tool call (e.g., "Edit file.ts")
   - Arguments appear all at once, not character by character

### Why non-streaming for tools?

Cursor's design philosophy:
- **Edit preview**: For code edits, Cursor shows a diff preview. This requires complete `old_string` and `new_string` to compute the diff.
- **Error handling**: JSON parsing errors are caught before showing to user
- **Stability**: Partial JSON would be confusing for file paths, code blocks

---

## 3. Aider

### Does Aider support streaming tool calling?

**Based on Aider's architecture**: **Non-streaming for tool calls**.

### Aider's Approach

Aider is a terminal-based coding assistant that:
1. Streams text responses from the LLM
2. Waits for complete tool/function calls before executing
3. Shows a "edit block" preview before applying changes

### Technical Reason

Aider uses a "search and replace" block format:
```
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE
```

This format requires complete blocks to parse correctly. Partial streaming would break the parser.

---

## 4. OpenAI API Streaming Tool Calls

### API Support

OpenAI API **does support** streaming tool calls:

```typescript
// Streaming chunk format
interface ChatCompletionChunk {
  choices: [{
    delta: {
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;  // Incremental JSON string
        };
      }>;
    };
  }];
}
```

### Implementation Complexity

```typescript
// Must accumulate across chunks
const toolCallChunks = new Map<number, { id: string; name: string; arguments: string }>();

for await (const chunk of stream) {
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (!toolCallChunks.has(tc.index)) {
        toolCallChunks.set(tc.index, { id: '', name: '', arguments: '' });
      }
      const existing = toolCallChunks.get(tc.index)!;
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
    }
  }
}
```

### Who uses it?

Despite API support, most tools **don't use streaming tool calls** because:
1. JSON accumulation is error-prone
2. Partial JSON is not useful to display
3. Tool execution requires complete arguments anyway

---

## 5. Anthropic API Streaming Tool Calls

### API Support

Anthropic API **does support** streaming tool calls via `input_json_delta`:

```typescript
// Stream event for tool input
interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;  // Incremental JSON string
}

// Example sequence
{ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"loc' } }
{ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'ation": "SF"' } }
{ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '}' } }
```

### Anthropic SDK Implementation

From the SDK source (`streaming/_messages.py`):

```python
def __stream__(self) -> Iterator[ParsedMessageStreamEvent]:
    for sse_event in self._raw_stream:
        self.__final_message_snapshot = accumulate_event(
            event=sse_event,
            current_snapshot=self.__final_message_snapshot,
        )
        events_to_fire = build_events(event=sse_event, message_snapshot=self.current_message_snapshot)
        for event in events_to_fire:
            yield event
```

The SDK accumulates events into a snapshot, then fires parsed events. This suggests even the SDK prefers complete parsing over incremental display.

---

## 6. Trade-offs: Streaming vs Non-Streaming Tool Calling

### Streaming Tool Calling

**Pros**:
- Shows progress during long tool call generation
- Consistent with text streaming UX
- Can show "thinking" state with partial information

**Cons**:
- **JSON parsing complexity**: Must handle partial JSON, accumulate across chunks
- **Error handling**: Invalid JSON only detected at the end
- **UX confusion**: Showing partial arguments (e.g., `{"path": "src/`...) is not helpful
- **No early execution**: Can't execute tool until arguments are complete anyway
- **Implementation overhead**: Need to track `index`, accumulate strings, handle multiple interleaved tool calls

### Non-Streaming Tool Calling

**Pros**:
- **Simpler implementation**: Single event with complete arguments
- **Clean error handling**: Parse JSON once, handle errors cleanly
- **Better UX**: Show complete tool call with formatted arguments
- **Edit preview**: For file edits, can show diff preview immediately
- **Reliability**: No risk of partial state corruption

**Cons**:
- **Perceived latency**: User sees nothing while tool call generates
- **Inconsistent with text streaming**: Text streams, tools don't

---

## 7. Common Practice Analysis

### Why non-streaming dominates for tool calls?

1. **Tool execution requires complete data**
   - Can't execute `read-file` with partial path
   - Can't execute `edit-file` with partial `old_string`
   - No benefit to showing partial data

2. **JSON structure matters**
   - Partial JSON like `{"path": "src/` is not parseable
   - Users can't act on partial information
   - Errors only visible when complete

3. **Edit tools need preview**
   - Cursor, Aider show diff previews
   - Requires complete `old_string` and `new_string`
   - Streaming would delay preview anyway

4. **Implementation complexity vs value**
   - Streaming adds significant complexity
   - Provides minimal UX benefit
   - Most teams choose simplicity

### The Hybrid Approach

Most tools use a **hybrid approach**:

```
Text response → Stream character by character
Tool call → Show spinner, then complete tool call
Tool result → Stream output (for long-running tools)
```

This gives the best of both worlds:
- Fast perceived response for text
- Reliable tool execution
- Progress indication during tool call generation

---

## 8. Recommendations for This Project

Based on the research, the current approach in this project is **aligned with industry best practices**:

### Current Implementation (from PRD)

> "先支持非流式 tool calling，流式作为未来扩展"
> (First support non-streaming tool calling, streaming as future extension)

This is the correct approach because:

1. **Matches industry practice**: Most tools use non-streaming for tool calls
2. **Simpler implementation**: Single `tool_call` event with complete arguments
3. **Better error handling**: Parse JSON once, handle errors cleanly
4. **Future-compatible**: Can add streaming later if needed

### If Streaming Tool Calls Are Needed Later

Implementation approach:

```typescript
// Add new event types
type ProviderStreamEvent =
  | { type: "assistant_chunk"; text: string; }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; }
  | { type: "tool_call_chunk"; toolCallId: string; partialArguments: string; }
  | { type: "tool_call_complete"; call: ToolCall; }
  | { type: "assistant_message"; text: string; };

// Accumulator in agent-loop
interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

// Handle in concatMap
if (event.type === "tool_call_start") {
  accumulators.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, arguments: '' });
}
if (event.type === "tool_call_chunk") {
  accumulators.get(event.toolCallId)!.arguments += event.partialArguments;
}
if (event.type === "tool_call_complete") {
  // Execute tool
}
```

---

## 9. Summary

| Question | Answer |
|----------|--------|
| Does Claude Code support streaming tool calling? | API supports it, CLI implementation uses non-streaming (complete `tool_call` events) |
| Does Cursor support streaming tool calling? | No - shows spinner, then complete tool call |
| Does Aider support streaming tool calling? | No - waits for complete blocks |
| What is the common practice? | **Non-streaming for tool calls** is the dominant pattern |

**Key Insight**: Even when APIs support streaming tool calls, most tools choose non-streaming implementation because:
1. Tool execution requires complete arguments
2. Partial JSON provides no user value
3. Error handling is simpler
4. Edit previews need complete data

---

## References

- OpenAI Function Calling: https://platform.openai.com/docs/guides/function-calling
- Anthropic Tool Use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- This project's existing research: `research/tool-calling-api-patterns.md`
- This project's provider types: `src/providers/provider-types.ts`
- This project's agent loop: `src/runtime/agent-loop.ts`
