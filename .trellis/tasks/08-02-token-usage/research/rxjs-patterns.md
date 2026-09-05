# Research: RxJS Usage Patterns in Wasteland

- **Query**: Explore RxJS usage patterns and best practices in the wasteland project
- **Scope**: Internal
- **Date**: 2026-08-02

## 1. RxJS Version and Dependencies

- **Version**: `rxjs ^7.8.2` (from `package.json` line 52)
- **34 files** import from rxjs across the codebase

## 2. Main Usage Scenarios

### 2.1 Agent Loop Core (agent-loop.ts)
The central orchestrator of the entire system. Uses RxJS as the backbone for:
- User input stream processing
- Provider response streaming
- Tool call dispatching and result collection
- Recursive turn loop via `defer + concat` pattern

### 2.2 Provider Streaming (openai.ts, claude.ts, sse-parser.ts)
All AI providers return `Observable<ProviderStreamEvent>` for streaming responses:
- SSE (Server-Sent Events) parsing via `parseSSEStream()` returns `Observable<SSEEvent>`
- Providers use `new Observable(subscriber => { ... })` constructor pattern
- Tool call deltas are accumulated in-memory, then emitted at stream completion

### 2.3 Tool Dispatch (tool-dispatch.ts)
Tool execution pipeline is entirely Observable-based:
- `requested$` -> `permission$` -> `started$` -> `result$` chain via `concat`
- Each stage is a separate Observable composed with `concat`

### 2.4 Spawn Agent (spawn-agent/)
Sub-agent lifecycle is managed via Observable composition:
- Event forwarding from child to parent agent
- Timeout management
- Retry with exponential backoff via RxJS `retry` operator

### 2.5 TUI Event Subscription (useRuntimeEvents.ts)
React hooks subscribe to Observable streams:
- `Subscription` type from rxjs used for cleanup
- `useEffect` + `subscribe` + cleanup pattern

### 2.6 Log Bus (log-bus.ts)
Publish-subscribe logging system using `Subject<LogEntry>`

## 3. Observable/Subject/BehaviorSubject Usage Patterns

### Observable (dominant pattern)
Used in **every layer** of the system. The project is fundamentally Observable-first.

**Constructor pattern** (`new Observable(subscriber => { ... })`):
```typescript
// src/providers/openai.ts:145
return new Observable<ProviderStreamEvent>((subscriber) => {
  // async work, subscriber.next(), subscriber.error(), subscriber.complete()
  return () => { /* cleanup */ };
});
```

Used in: `sse-parser.ts:32`, `openai.ts:145`, `claude.ts:209`, `a2a-client.ts:284,324`, `skill-executor.ts:178`, `event-forwarder.ts:275`

**Cold Observable pattern**: All Observable creators are cold (factory functions), subscriptions only execute when subscribed. This is explicitly noted in `spawn-agent/index.ts:103`:
```
Single subscription guarantee: events$ is cold Observable, internal only subscribes once
```

### Subject
Used for imperative event injection:
- `UserInputBridge.responseSubject` (`src/core/runtime/user-input-bridge.ts:21`): Bridges ask-user tool with UI layer
- `TuiRuntimeContext.input$` (`src/tui/types.ts:31`): User input injection point, typed as `Subject<ChatInputTurn>`
- `LogBus.subject` (`src/core/logger/log-bus.ts:71`): Internal log event bus

### ReplaySubject
- `agent-loop.ts:1062`: `new ReplaySubject<DebugTraceEvent>(200)` - Buffers debug events for late subscribers, capped at 200 to avoid memory growth in long sessions

### BehaviorSubject
- **Not used** in the codebase. The project prefers `Subject` + manual state management or cold Observable patterns.

### asObservable()
Used to prevent external callers from calling `.next()`:
- `agent-loop.ts:1304`: `debugSubject.asObservable()` - Exposes debug stream read-only
- `log-bus.ts:126`: `this.subject.asObservable()` - LogBus public API

## 4. Operator Usage Patterns

### 4.1 Composition Operators (heavily used)

**`concat`** - Sequential composition (dominant pattern):
```typescript
// src/core/runtime/agent-loop.ts:952
return concat(provider$, continuation$);
```
```typescript
// src/core/runtime/tool-dispatch.ts:337
return concat(requested$, confirmation$.pipe(...));
```
Used in: `agent-loop.ts` (6+ places), `tool-dispatch.ts` (5+ places), `dispatch-handler.ts`, `assistant-events.ts`

**`defer`** - Lazy evaluation (second most used):
```typescript
// src/core/runtime/agent-loop.ts:391
return defer(() => { /* evaluated on subscribe */ });
```
Used to: delay async execution, enable recursive loops, defer Promise creation

**`concatMap`** - Sequential mapping (preferred over mergeMap):
```typescript
// src/core/runtime/agent-loop.ts:1159
concatMap((turn) => { /* process each turn sequentially */ })
```
```typescript
// src/providers/openai.ts:332
.pipe(concatMap((obs) => obs));
```
Comment in `agent-loop.ts:1102-1103`:
> concatMap: Convert Promise result to Observable, process sequentially. Unlike switchMap, concatMap does not cancel the previous one.

**`mergeMap`** - Parallel execution (used sparingly):
```typescript
// src/tools/spawn-agent/index.ts:280
mergeMap(({ childSession, events$, ... }) => { ... })
```
```typescript
// src/core/runtime/agent-loop.ts:670
}).pipe(mergeMap((obs) => obs));
```
Used for: parallel tool dispatch (spawn_agent), flattening inner Observables

### 4.2 Transformation Operators

**`map`** - Value transformation (ubiquitous):
```typescript
// src/core/runtime/tool-dispatch.ts:276
map((): RuntimeEvent => ({ type: 'tool_call_requested', ... }))
```

**`tap`** - Side effects (heavily used for state mutation and tracing):
```typescript
// src/core/runtime/agent-loop.ts:264
tap(() => { params.history.push(assistantRecord); })
```
Used for: debug tracing, state updates, logging

**`from`** - Promise/Iterable to Observable:
```typescript
// src/core/runtime/agent-loop.ts:263
from(params.sessionManager.appendRecord(...))
```

**`of`** - Single value Observable:
```typescript
of<RuntimeEvent>({ type: 'tool_started', ... })
```

### 4.3 Filtering/Control Operators

**`takeWhile`** - Conditional stream termination:
```typescript
// src/core/runtime/agent-loop.ts:1158
takeWhile(() => turnCount <= maxTurns)
```

**`concatWith`** - Append after completion:
```typescript
// src/core/runtime/agent-loop.ts:722
concatWith(defer(() => processProviderTail()))
```

**`toArray`** - Collect all values into array:
```typescript
// src/core/runtime/agent-loop.ts:802
toArray()
```

**`firstValueFrom`** - Extract first value as Promise:
```typescript
// src/core/runtime/user-input-bridge.ts:29
const answer = await firstValueFrom(this.responseSubject);
```
```typescript
// src/core/runtime/agent-loop.ts:628
await lastValueFrom(forkJoin(...))
```

**`lastValueFrom`** - Extract last value as Promise (used at Observable/Promise boundary):
```typescript
// src/core/runtime/agent-loop.ts:628
await lastValueFrom(forkJoin(spawnEvents.map(...)))
```

### 4.4 Error Handling Operators

**`catchError`** - Error recovery:
```typescript
// src/core/runtime/agent-loop.ts:692
catchError((err): Observable<RuntimeEvent> => {
  const errMsg = err instanceof Error ? err.message : String(err);
  // Convert error to assistant_message event
  return from(...).pipe(map(() => ({ type: 'assistant_message', content: errorContent })));
})
```
```typescript
// src/tools/spawn-agent/index.ts:322
catchError((err) =>
  of<RuntimeEvent>({ type: 'tool_failed', ... error: err.message })
)
```

**`retry`** - Automatic retry with configuration:
```typescript
// src/tools/spawn-agent/index.ts:302
retry({
  count: resolved.maxRetries,
  delay: (err, count) => {
    return timer(resolved.retryDelayMs * Math.pow(2, count - 1));
  },
})
```

**`EMPTY`** - Immediate completion (no values):
```typescript
// src/core/runtime/agent-loop.ts:879
return EMPTY;
```

### 4.5 Utility Operators

**`forkJoin`** - Wait for all parallel Observables:
```typescript
// src/core/runtime/agent-loop.ts:629
forkJoin(
  spawnEvents.map(({ event, index }) =>
    dispatchSingleToolCall(event.call, state, index).pipe(tap(...))
  )
)
```

**`timer`** - Delay for retry backoff:
```typescript
// src/tools/spawn-agent/index.ts:318
return timer(resolved.retryDelayMs * Math.pow(2, count - 1));
```

## 5. Key Architectural Patterns

### Pattern 1: `defer + concat + 递归` (Recursive Loop)
The core agent loop pattern (`agent-loop.ts:324-954`):
```
defer(() => {
  检查条件 → Provider执行 → 处理结果 → continuation$ (递归或结束)
})
```
- `defer` delays execution until subscription
- `concat` ensures sequential execution
- Recursion implements the loop (tool call -> re-invoke provider)

### Pattern 2: Pipeline Composition (Tool Dispatch)
`tool-dispatch.ts` uses a 4-stage Observable pipeline:
```
requested$ -> permission$ -> started$ -> result$
```
Each stage is an Observable, composed with `concat`.

### Pattern 3: Cold Observable + Single Subscription
All Observables are cold. The spawn-agent system explicitly enforces single subscription (`event-forwarder.ts:274`):
```typescript
// 单订阅 events$，手动管理转发累积与最终结果
return new Observable<RuntimeEvent>((subscriber) => {
  const sub = events$.subscribe({ ... });
  return () => { sub.unsubscribe(); ... };
});
```

### Pattern 4: Imperative Bridge (Subject)
`UserInputBridge` uses `Subject<string>` to bridge imperative user input with the Observable pipeline:
```typescript
async requestInput(): Promise<string> {
  return await firstValueFrom(this.responseSubject);
}
provideInput(answer: string): void {
  this.responseSubject.next(answer);
}
```

### Pattern 5: Error-to-Event Conversion
Provider errors are converted to `assistant_message` events rather than propagating errors:
```typescript
catchError((err) => {
  return from(sessionManager.appendRecord(...)).pipe(
    map(() => ({ type: 'assistant_message', content: `[Error] ${errMsg}` }))
  );
})
```

### Pattern 6: Subscription Cleanup in React
`useRuntimeEvents.ts` follows strict cleanup:
```typescript
useEffect(() => {
  subscriptionRef.current = events$.subscribe({ ... });
  return () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
  };
}, [events$, setState, multiAgent]);
```

## 6. Error Handling and Retry Patterns

### HTTP-Level Retry (fetchWithRetry)
- `src/providers/shared/retry.ts`: Async function (not RxJS)
- Handles 429 (Rate Limit), 503 (Service Unavailable), network errors
- Exponential backoff: `BASE_RETRY_DELAY * 2^(attempt-1)`
- Max 3 retries

### Observable-Level Retry (RxJS retry)
- `src/tools/spawn-agent/index.ts:302`: Configurable via `multiAgent.maxRetries`
- Uses `timer()` for delay with exponential backoff
- Falls back to `catchError` after all retries exhausted

### Error Propagation Strategy
- Provider errors -> `assistant_message` event (user-visible, not fatal)
- Tool errors -> `tool_failed` event (recorded in session)
- Spawn failures -> `subscriber.error()` -> outer `retry` -> `catchError` -> `tool_failed`

## 7. Files with RxJS Usage (Complete List)

| File | Primary Pattern |
|------|----------------|
| `src/core/runtime/agent-loop.ts` | Core orchestrator, defer+concat+recurse |
| `src/core/runtime/tool-dispatch.ts` | Pipeline composition |
| `src/core/runtime/user-input-bridge.ts` | Subject bridge |
| `src/core/runtime/pre-dispatch-hook.ts` | Observable type export |
| `src/core/runtime/dispatch-utils.ts` | Observable composition |
| `src/core/logger/log-bus.ts` | Subject pub-sub |
| `src/providers/provider-types.ts` | Observable interface definition |
| `src/providers/openai.ts` | Observable constructor |
| `src/providers/claude.ts` | Observable constructor |
| `src/providers/sse-parser.ts` | Observable from stream |
| `src/providers/assistant-events.ts` | concat + from + map |
| `src/providers/local.ts` | of() |
| `src/tools/spawn-agent/index.ts` | defer + mergeMap + retry |
| `src/tools/spawn-agent/event-forwarder.ts` | Observable constructor + manual subscribe |
| `src/tools/spawn-agent/dispatch-handler.ts` | concat + concatMap |
| `src/skills/skill-executor.ts` | Observable constructor |
| `src/acp/a2a-client.ts` | Observable constructor for SSE |
| `src/ui/cli-input-adapter.ts` | fromEvent + pipe operators |
| `src/ui/readline-input.ts` | fromEvent + scan + takeUntil |
| `src/tui/hooks/useRuntime.ts` | Subject for input |
| `src/tui/hooks/useRuntimeEvents.ts` | Subscription management |
| `src/tui/hooks/useLogStream.ts` | Subscription management |
| `src/tui/types.ts` | Observable/Subject type definitions |
| `src/tui/components/ChatMessageList.tsx` | interval + scan (animation) |
| `src/ui/cli-output-adapter.ts` | Observable consumption |
| `src/ui/terminal-renderer.ts` | Observable consumption |
| `src/ui/debug-renderer.ts` | Observable consumption |

## 8. RxJS Conventions in This Project

1. **Observable-first API design**: All streaming data flows use `Observable<T>` as return types
2. **Cold Observables**: No hot Observables; all created via factory functions
3. **concat preferred over merge**: Sequential execution is the default; parallel only when explicitly needed (spawn_agent)
4. **defer for lazy evaluation**: Used extensively to defer async work until subscription
5. **tap for side effects**: State mutations and tracing done via tap, not map
6. **Subject for imperative bridges**: When Observable meets imperative code (UserInputBridge, LogBus)
7. **asObservable() for read-only exposure**: Prevents external mutation of Subject
8. **firstValueFrom/lastValueFrom at boundaries**: When converting Observable to Promise for non-reactive code
9. **Error-to-event conversion**: Errors become events rather than propagating exceptions
10. **Subscription cleanup in React**: Strict cleanup in useEffect return functions

## 9. Recommended RxJS Patterns for Context Management

Based on the existing patterns in the codebase:

### For State Management
- Use `Subject<T>` for imperative state injection (like `UserInputBridge`)
- Use `ReplaySubject(n)` for state that late subscribers need (like `debugSubject`)
- Avoid BehaviorSubject; use Subject + manual state or cold Observable patterns

### For Event Routing
- Use `concat` for sequential event pipelines
- Use `concatMap` for processing items one-at-a-time
- Use `mergeMap` only for true parallelism (spawn_agent)

### For Async/Promise Integration
- Use `from(promise)` to convert Promises to Observables
- Use `defer(() => asyncWork())` to lazy-create Observables
- Use `concatMap((x) => from(asyncWork(x)))` for sequential async

### For Error Handling
- Use `catchError` to convert errors to events (not throw)
- Use `retry` with configurable count and exponential backoff
- Use `EMPTY` for clean stream termination

### For Cleanup
- Return cleanup functions from Observable constructors
- Store Subscription references and call `.unsubscribe()` on cleanup
- Use `asObservable()` to prevent external mutation

## Caveats / Not Found

- **BehaviorSubject is not used anywhere** in the codebase. The project avoids it entirely.
- **switchMap is not used**. The project explicitly prefers `concatMap` (noted in comments).
- **No use of combineLatest or withLatestFrom**. The project relies on `concat` for sequencing.
- **No use of Subject multicast patterns**. All Subjects are used for simple imperative bridges.
- The `interval` operator is only used in `ChatMessageList.tsx` for spinner animation, not for any core logic.
