# Research: RuntimeEvent System and Session Logging

- **Query**: Explore RuntimeEvent system and session logging mechanism in wasteland project
- **Scope**: Internal
- **Date**: 2026-08-02

## 1. RuntimeEvent Complete Type Definition

**File**: `src/core/runtime/event-types.ts`

### All Event Types (17 total):

| Event Type | Description | Key Fields |
|------------|-------------|------------|
| `session_started` | Session initialization | sessionId, sessionPath, mode |
| `session_ended` | Session termination | sessionId |
| `user_turn` | User input received | sessionId, turn, content, source |
| `assistant_chunk` | Streaming AI response fragment | sessionId, turn, chunk |
| `assistant_message` | Complete AI response | sessionId, turn, content |
| `tool_call_requested` | Tool invocation requested | sessionId, turn, callId, toolName, input |
| `permission_decision` | Permission gate decision | sessionId, turn, callId, toolName, decision, mode, reason |
| `tool_started` | Tool execution started | sessionId, turn, callId, toolName |
| `tool_result` | Tool execution success | sessionId, turn, callId, toolName, status='success', output |
| `tool_failed` | Tool execution failure | sessionId, turn, callId, toolName, status='error'/'blocked', error |
| `agent_spawned` | Child agent created | parentId, childId, childSessionPath, name, task |
| `agent_completed` | Child agent finished | childId, status, result?, error?, sessionPath |
| `skill_started` | Skill command execution started | sessionId, turn, skillName, args |
| `skill_result` | Skill execution completed | sessionId, turn, skillName, result |
| `user_input_requested` | Ask-user tool triggered | sessionId, turn, callId, question, options? |
| `user_input_received` | User answered question | sessionId, turn, callId, answer |
| `agent_progress` | Child agent progress update | childId, childName, status, message? |
| `agent_thinking` | Child agent thinking | childId, childName, content |
| `agent_tool_use` | Child agent tool call | childId, childName, toolName, input? |

### Supporting Types:

- `InputSource`: `'message' | 'stdin' | 'interactive'`
- `RuntimeMode`: `'single' | 'interactive'`
- `ChatInputTurn`: User input with turn number, content, and source
- `SessionRecord`: Union type for all session persistence records (6 types)

---

## 2. Session Log Writing (JSONL Format)

### Session Directory Location

**File**: `src/config/paths.ts`

Default location: `{cwd}/.wasteland/sessions/`

Override via environment variables:
- `WASTELAND_SESSION_DIR`
- `JOE_SESSION_DIR` (legacy)
- `RX_CLI_SESSION_DIR` (legacy)

### Session ID Format

Format: `YYYY-MM-DD_HHMMSS_<6-char-uuid>`
Example: `2026-05-23_143000_abc123`

### SessionManager Implementation

**File**: `src/core/runtime/session-manager.ts`

**Key Methods**:
- `startSession(params)`: Creates new session with metadata
- `createChildSession(parent, name)`: Creates child agent session with ID `{parentId}-child-{name}`
- `appendRecord(session, record)`: Adds record to buffer, auto-flushes

**Buffering Strategy**:
- `FLUSH_THRESHOLD = 10`: Flush after 10 records
- `FLUSH_INTERVAL_MS = 5000`: Force flush every 5 seconds
- Immediate flush on `session_end` record

**JSONL Format**:
```jsonl
{"type":"session","sessionId":"2026-05-23_143000_abc123","mode":"interactive","cwd":"/path","provider":"openai","timestamp":"2026-05-23T14:30:00.000Z"}
{"type":"message","role":"user","turn":1,"content":"Hello","timestamp":"2026-05-23T14:30:01.000Z","source":"interactive"}
{"type":"tool_call","sessionId":"...","turn":1,"callId":"call_123","toolName":"bash","input":{"command":"ls"},"timestamp":"..."}
{"type":"tool_result","sessionId":"...","turn":1,"callId":"call_123","toolName":"bash","status":"success","output":"file1.txt\nfile2.txt","timestamp":"..."}
{"type":"message","role":"assistant","turn":1,"content":"I found the files...","timestamp":"..."}
{"type":"session_end","sessionId":"2026-05-23_143000_abc123","timestamp":"..."}
```

### SessionRecord Types (6 total):

| Type | Purpose | Key Fields |
|------|---------|------------|
| `session` | Session start metadata | sessionId, mode, cwd, provider, timestamp, parentId?, childName? |
| `message` | User/assistant message | role, turn, content, timestamp, source? |
| `tool_call` | Tool invocation record | sessionId, turn, callId, toolName, input, timestamp |
| `permission` | Permission decision | sessionId, turn, callId, toolName, decision, mode, reason, timestamp |
| `tool_result` | Tool execution result | sessionId, turn, callId, toolName, status, output?, error?, timestamp |
| `session_end` | Session termination | sessionId, timestamp |

---

## 3. Event Data Flow: Provider → TUI

### Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Provider Layer                              │
│  (claude.ts, openai.ts, openai-compatible/)                    │
│                                                                 │
│  Provider.runStep() → Observable<ProviderStreamEvent>           │
│  Events: assistant_chunk, tool_call, assistant_message          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Loop Layer                            │
│  src/core/runtime/agent-loop.ts                                │
│                                                                 │
│  runTurnLoop() transforms ProviderStreamEvent → RuntimeEvent   │
│  - assistant_chunk → assistant_chunk (with sessionId, turn)     │
│  - tool_call → tool_call_requested → permission_decision →     │
│    tool_started → tool_result/tool_failed                       │
│  - assistant_message → assistant_message (persisted to JSONL)  │
│                                                                 │
│  Also emits: session_started, user_turn, session_ended          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Session Manager Layer                       │
│  src/core/runtime/session-manager.ts                           │
│                                                                 │
│  appendRecord() → Buffer → JSONL File                          │
│  - Persists: session, message, tool_call, permission,           │
│    tool_result, session_end records                             │
│  - Buffering: 10 records or 5s timeout                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Output Adapter Layer                        │
│  src/core/adapters/output-adapter.ts                           │
│                                                                 │
│  DefaultOutputAdapter.processEvent(event) → DisplayEvent       │
│  - 1:1 mapping from RuntimeEvent to DisplayEvent               │
│  - Used by CLI (CliOutputAdapter) and TUI                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TUI Layer                                   │
│  src/tui/hooks/useRuntimeEvents.ts                             │
│                                                                 │
│  useRuntimeEvents(events$, debug$, setState)                   │
│  - Subscribes to Observable<RuntimeEvent>                      │
│  - Calls processRuntimeEvent() to transform events → AppState  │
│  - Updates React state via setState()                          │
│                                                                 │
│  Processed Events:                                              │
│  - session_started → creates main AgentNode                    │
│  - user_turn → adds user Message                               │
│  - assistant_chunk → accumulates streaming content              │
│  - assistant_message → adds assistant Message                  │
│  - tool_call_requested → adds pending ToolCall                 │
│  - tool_started → updates ToolCall status                      │
│  - tool_result/tool_failed → updates ToolCall, adds Message    │
│  - agent_spawned/completed/progress/thinking → manages AgentNode│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     App State                                   │
│  src/tui/context/AppContext.tsx                                 │
│                                                                 │
│  AppState.session: {                                            │
│    agents: AgentNode[],      // Multi-agent tree               │
│    messages: Message[],      // Chat history                   │
│    tools: ToolCall[],        // Active tool calls              │
│    isThinking: boolean,      // Waiting for first chunk        │
│    isStreaming: boolean,     // Receiving chunks               │
│    streamingContent: string, // Accumulated stream content     │
│    streamingMessageId: string | null  // Current stream ID     │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files in Data Flow:

1. **Provider** (`src/providers/*.ts`): Emits `ProviderStreamEvent`
2. **Agent Loop** (`src/core/runtime/agent-loop.ts`): Transforms to `RuntimeEvent`
3. **Tool Dispatch** (`src/core/runtime/tool-dispatch.ts`): Handles tool lifecycle events
4. **Session Manager** (`src/core/runtime/session-manager.ts`): Persists to JSONL
5. **Output Adapter** (`src/core/adapters/output-adapter.ts`): Converts to `DisplayEvent`
6. **TUI Hook** (`src/tui/hooks/useRuntimeEvents.ts`): Updates React state
7. **App Context** (`src/tui/context/AppContext.tsx`): Holds `AppState`

---

## 4. Current State Fields and Usage/Token Tracking

### Current AppState Fields

**File**: `src/tui/context/AppContext.tsx`

```typescript
interface AppState {
  currentPage: PageName;
  focusArea: FocusArea;
  inputMode: boolean;
  exitConfirmPending: boolean;
  showHelp: HelpView;
  filterMode: boolean;
  editMode: boolean;
  logPageFilter: LogPageFilter;
  viewFilter?: string;

  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isThinking: boolean;
    isStreaming: boolean;
    streamingContent: string;
    streamingMessageId: string | null;
  };

  debug: {
    traces: TraceEvent[];
    filter: TraceFilter;
  };

  config: {
    provider: string;
    model: string;
    permissionMode: string;
    maxTurns: number;
    maxSteps: number;
    defaultRole: string;
    childAgentTimeout: number;
    debug: boolean;
  };

  fullConfig: TuiFullConfig;
  configEdit: ConfigEdit;
  configHasChanges: boolean;
  sessionMetadata: {
    id: string;
    providerId: string;
  };
}
```

### Usage/Token Tracking Status

**Current State**: NO usage/token tracking exists in the core runtime

**Findings**:

1. **Provider Layer** (`src/providers/openai-compatible/types.ts`):
   - `OpenAIChatCompletionResponse` includes optional `usage` field:
     ```typescript
     usage?: {
       prompt_tokens: number;
       completion_tokens: number;
       total_tokens: number;
     };
     ```
   - **NOT currently captured or propagated**

2. **Claude Provider** (`src/providers/claude.ts`):
   - SSE event `message_delta` includes optional `usage?: object`
   - **NOT currently captured or propagated**

3. **RuntimeEvent Type**: No `usage` field in any event type

4. **SessionRecord Type**: No `usage` field in any record type

5. **TurnState**: No usage tracking fields

6. **AppState**: No usage/token fields in session state

### Related Files Checked:

- `src/core/runtime/event-types.ts` - No usage fields
- `src/core/runtime/turn-state.ts` - No usage fields
- `src/core/runtime/session-manager.ts` - No usage persistence
- `src/tui/context/AppContext.tsx` - No usage display fields
- `src/providers/provider-types.ts` - No usage in ProviderStreamEvent
- `src/providers/openai-compatible/types.ts` - Usage in response, not captured
- `src/providers/claude.ts` - Usage in SSE, not captured

---

## 5. Related Spec Documents

- `.trellis/spec/backend/runtime-contracts.md` - Runtime entry signatures and contracts
- `.trellis/spec/backend/tool-runtime-contracts.md` - Tool lifecycle contracts
- `.trellis/spec/backend/cli-tui-contracts.md` - CLI/TUI unification contracts
- `.trellis/spec/frontend/state-management.md` - Frontend state management
- `.trellis/spec/backend/logging-guidelines.md` - Logging guidelines

---

## 6. Key Implementation Patterns

### Event Emission Pattern (Agent Loop)

```typescript
// From agent-loop.ts
const user$ = from(sessionManager.appendRecord(session, userRecord)).pipe(
  tap(() => { history.push(userRecord); }),
  map((): RuntimeEvent => ({
    type: 'user_turn',
    sessionId: session.id,
    turn: turn.turn,
    content: turn.content,
    source: turn.source,
  }))
);
```

### Tool Dispatch Pattern

```typescript
// From tool-dispatch.ts
const requested$ = from(
  sessionManager.appendRecord(session, createToolCallRecord(...))
).pipe(
  map((): RuntimeEvent => ({
    type: 'tool_call_requested',
    sessionId: session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
    input: params.call.input,
  }))
);
```

### TUI Event Processing Pattern

```typescript
// From useRuntimeEvents.ts
function processRuntimeEvent(event: Event, currentState: AppState): EventProcessResult {
  switch (event.type) {
    case 'user_turn':
      messages.push({ id: `msg-user-${event.turn}`, type: 'user', content: event.content });
      isThinking = true;
      break;
    case 'assistant_chunk':
      chunkAccumulator.current += event.chunk;
      streamingContent = chunkAccumulator.current;
      break;
    // ... other cases
  }
  return { agents, messages, tools, isThinking, isStreaming, streamingContent, streamingMessageId };
}
```

---

## 7. Caveats / Not Found

### Not Found:

1. **Usage/Token Tracking**: No implementation exists for tracking API usage (prompt_tokens, completion_tokens, total_tokens)
2. **Cost Calculation**: No cost calculation or billing logic
3. **Usage Persistence**: No usage data written to session JSONL files
4. **Usage Display**: No usage metrics in TUI state or UI

### Caveats:

1. **Provider Response Data Ignored**: Both Claude and OpenAI-compatible providers return usage data in responses, but it is currently ignored
2. **Session Records Limited**: Current SessionRecord types do not include usage/cost records
3. **TurnState Incomplete**: TurnState tracks tool calls and results but not token usage per step

### Potential Extension Points:

1. Add `usage` field to `RuntimeEvent` (new event type or extend existing)
2. Add `SessionUsageRecord` type to `SessionRecord` union
3. Capture usage from provider responses in `agent-loop.ts`
4. Add usage fields to `AppState.session` for TUI display
5. Persist usage to JSONL via new `SessionUsageRecord`
