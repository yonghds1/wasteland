# Research: spawn_agent Parallel Execution Analysis

- **Query**: How does spawn_agent work currently, and where could parallelism be added?
- **Scope**: internal
- **Date**: 2026-06-16

## Findings

### Files Analyzed

| File Path | Description |
|---|---|
| `src/tools/spawn-agent.ts` | spawn_agent tool implementation + deprecated handleParallelSpawns |
| `src/core/runtime/agent-loop.ts` | Core agent loop with defer+concat+recursive pattern |
| `src/core/runtime/event-types.ts` | All RuntimeEvent and SessionRecord types |
| `src/core/runtime/tool-dispatch.ts` | Tool dispatch with special handlers for spawn_agent and ask-user |
| `src/tools/tool-runner.ts` | Simple async tool execution wrapper |
| `src/core/runtime/turn-state.ts` | Immutable turn state with step/toolCalls/toolResults |
| `src/tools/tool-registry.ts` | Simple Map-based tool registry |
| `src/providers/provider-types.ts` | ProviderStreamEvent type (assistant_chunk, tool_call, assistant_message) |
| `src/providers/openai.ts` | OpenAI provider - emits multiple tool_call events sequentially |
| `src/acp/a2a-client.ts` | A2A client with sendTaskAsync (non-blocking) + waitForTask (polling) |

### Current spawn_agent Flow (Step by Step)

1. **Provider emits `tool_call`** with `toolName: "spawn_agent"` and input `{name, task, model?, tools?, inheritHistory?}`
2. **agent-loop.ts:runTurnLoop** catches the `tool_call` event (line 518), calls `dispatchToolCall()`
3. **tool-dispatch.ts:dispatchToolCall** checks `specialToolHandlers` map (line 516), finds `handleSpawnAgent`
4. **handleSpawnAgent** (line 114-290):
   - Creates `createSpawnAgentTool(context)` with full context
   - Runs permission check via `permissionGate.evaluate()`
   - Emits `tool_call_requested` + `permission_decision` + `tool_started` events
   - Calls `spawnTool.execute()` which is **await lastValueFrom()** (line 241)
   - Inside `execute()`:
     a. Creates child session via `sessionManager.createChildSession()`
     b. Prepares child input as `of({turn: 1, content: taskContent})`
     c. Optionally creates restricted ToolRegistry and/or new Provider
     d. Calls `runAgentLoop({input$, provider, ..., mode: 'single'})`
     e. Pipes `events$` through `filter(assistant_message) + take(1) + timeout(120s)`
     f. Uses `lastValueFrom()` to **block until child agent completes**
   - Returns result to dispatch, which emits `tool_result`/`tool_failed` + `agent_spawned`/`agent_completed` events
5. **agent-loop.ts:runTurnLoop** receives tool_result via `tap()` (line 585), accumulates into `state.toolResults`
6. **continuation$** (line 691) sees `nextAction === 'tool'`, advances step, **recursively calls runTurnLoop**
7. Provider receives all toolResults in next step, decides whether to call more tools or emit `assistant_message`

### Where Parallelism is Blocked

#### 1. Sequential tool_call processing in agent-loop.ts (PRIMARY BLOCKER)

In `runTurnLoop` (line 449), the provider events are processed via `concatMap`:

```typescript
const provider$ = params.provider.runStep({context, state}).pipe(
  concatMap((event) => {
    if (event.type === 'assistant_chunk') { ... }
    if (event.type === 'assistant_message') { ... }
    if (event.type === 'tool_call') {
      return dispatchToolCall({...}).pipe(tap(...));
    }
  })
);
```

**The problem**: When a provider emits multiple `tool_call` events (e.g., OpenAI with `finish_reason: "tool_calls"` and 3 tool calls), they are processed **sequentially** by `concatMap`. Each tool_call Observable must complete before the next one starts.

In `openai.ts` (line 296-298):
```typescript
for (const call of toolCalls) {
  subscriber.next({ type: 'tool_call', call });
}
```

Multiple tool_calls are emitted as separate events, and `concatMap` processes them one at a time.

#### 2. Synchronous blocking in spawn_agent execute()

`spawn-agent.ts` line 241:
```typescript
const finalEvent = await lastValueFrom(events$.pipe(filter(...), take(1), timeout(...)));
```

The `execute()` method is `async` and uses `await lastValueFrom()`. This means the tool blocks the entire dispatch pipeline until the child agent completes. Even if multiple spawn_agent calls existed, they would be blocked by `concatMap`.

#### 3. State accumulation requires ordering

`turn-state.ts` uses immutable state updates:
```typescript
state = recordToolCall(state, event.call);
state = recordToolResult(state, {...});
```

These state mutations happen inside `tap()` operators. If tools ran in parallel, the state updates could interleave unpredictably. The `toolCalls` and `toolResults` arrays are accumulated in order.

#### 4. Event ordering matters for UI

The event sequence `tool_call_requested -> permission_decision -> tool_started -> tool_result` is relied upon by the UI layer (TUI components in `src/tui/`). Parallel execution would emit these out of order.

#### 5. The deprecated handleParallelSpawns function

`spawn-agent.ts` lines 310-351 contain a deprecated `handleParallelSpawns` function:
```typescript
/** @deprecated 此函数当前未被使用。并行 spawn 支持需要在 tool-dispatch.ts 中
 * 通过 RxJS merge 操作符实现，而不是在此处处理。
 * TODO: 实现真正的并行 spawn 支持，或删除此函数。 */
export function handleParallelSpawns(...) {
  const childRuns = calls.map((call) => { ... });
  return forkJoin(childRuns);
}
```

This is the only existing `forkJoin` usage in the codebase (besides imports). It was an attempt at parallel spawns but was never integrated. The TODO notes that parallel spawn should be implemented in `tool-dispatch.ts` via `merge`.

### Existing RxJS Patterns in the Codebase

| Pattern | Where Used | Purpose |
|---|---|---|
| `concat` | agent-loop.ts line 767, 1027, 1057 | Sequential execution: provider$ then continuation$; user$ then assistant$ |
| `concatMap` | agent-loop.ts line 449, 894, 949 | Process events/turns one at a time |
| `defer` | agent-loop.ts line 318, 691, 882, 900, 1033 | Lazy evaluation for recursive loops |
| `forkJoin` | spawn-agent.ts line 350 (deprecated) | Wait for all child agents to complete |
| `filter + take` | spawn-agent.ts line 244-248 | Extract first matching event from stream |
| `timeout` | spawn-agent.ts line 256 | Child agent execution timeout |
| `tap` | Throughout | Side effects: state updates, tracing |
| `from` | Throughout | Convert Promises to Observables |
| `of` | Throughout | Create single-value Observables |
| `defaultIfEmpty` | spawn-agent.ts line 258 | Handle empty stream case |

**No usage found**: `merge`, `combineLatest`, `mergeMap`, `switchMap`, `exhaustMap`, `forkJoin` (outside deprecated function).

### What RxJS Patterns Could Enable Parallel Execution

#### Pattern 1: `merge` for parallel tool dispatch (in tool-dispatch.ts)

Replace `concatMap` in agent-loop.ts line 449 with a pattern that collects all tool_calls from a provider step, then dispatches them in parallel:

```typescript
// Current: sequential via concatMap
concatMap((event) => {
  if (event.type === 'tool_call') {
    return dispatchToolCall({...});
  }
})

// Potential: collect tool_calls, then merge
// Would need to buffer provider events, separate tool_calls from chunks,
// then use merge() on all tool_call dispatches
```

#### Pattern 2: `merge` for parallel spawn_agent calls

In `tool-dispatch.ts`, when multiple spawn_agent calls arrive in the same provider step, they could be dispatched via `merge()` instead of sequential `concat`.

#### Pattern 3: `forkJoin` for collecting parallel results

The deprecated `handleParallelSpawns` already uses this pattern. After parallel execution via `merge`, `forkJoin` could wait for all results before returning to the provider.

#### Pattern 4: `shareReplay` for shared child agent streams

If child agents emit events that multiple consumers need (UI + state), `shareReplay(1)` could prevent duplicate subscriptions.

### A2A Client Parallel Patterns

The A2A client (`src/acp/a2a-client.ts`) has two relevant patterns:

1. **`sendTaskAsync()`** (line 164): Non-blocking task submission that returns a task ID immediately
2. **`waitForTask()`** (line 216): Polling-based wait for task completion

This is a different parallelism model (async + poll) compared to the RxJS Observable approach used internally. The A2A client could potentially be used for remote agent parallelism, but it's not integrated into the spawn_agent flow.

### Related Specs

- `.trellis/spec/backend/tool-runtime-contracts.md` - Tool lifecycle contracts, event ordering
- `.trellis/spec/backend/runtime-contracts.md` - Runtime entry points, provider contract

## Caveats / Not Found

1. **No existing parallel tool dispatch**: The codebase has zero parallel tool execution. All tools run sequentially via `concatMap`.
2. **The deprecated `handleParallelSpawns` was never connected**: It exists but is not called anywhere.
3. **Provider limitation**: OpenAI providers emit multiple `tool_call` events as separate Observable emissions (not as a batch). This means the runtime sees them as individual events, not as a "batch of tool calls to run in parallel."
4. **State management is not thread-safe for parallel**: The `TurnState` uses immutable updates via spread operators, which is safe for concurrent reads but the `tap()` accumulation pattern assumes sequential processing.
5. **No test coverage for spawn_agent**: No test files were found that test spawn_agent behavior or parallel execution.
6. **The `mode: 'single'` child agent loop**: Child agents run with `mode: 'single'`, meaning they process exactly one turn and exit. This simplifies parallelism (no interactive loops to manage).
