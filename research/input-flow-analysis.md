# Input Flow Analysis: CLI vs TUI in rx-cli

## Overview

This analysis examines the input processing pipelines in rx-cli for both CLI (interactive readline) and TUI (Ink/React) modes, focusing on how user input flows from capture to agent-loop execution.

---

## 1. CLI Input Flow

### Entry Point

**File**: `src/commands/chat.ts`

The CLI mode is initiated via the `chat` command. The flow has three input modes:

```
1. --message flag → createSingleTurnInput(message, 'message')
2. Piped stdin → createSingleTurnInput(pipedContent, 'stdin')
3. Interactive TTY → createInteractiveTurnStream()
```

### Input Creation Functions

**File**: `src/ui/readline-input.ts`

#### `createSingleTurnInput()` (Lines 161-174)
- Creates a single `ChatInputTurn` with `turn: 1`
- Used for `--message` and piped stdin modes
- Returns `from([{ turn: 1, content: message.trim(), source }])`

#### `createInteractiveTurnStream()` (Lines 267-402)
- Creates a readline interface on `process.stdin`
- Returns `InteractiveTurnStream` with:
  - `turns$: Observable<ChatInputTurn>` - the input stream
  - `prompt: () => void` - function to display prompt
  - `close: () => void` - function to close readline
  - `done: Promise<void>` - resolves when readline closes

**Data Flow in Interactive Mode**:
```
readline "line" event
    ↓
fromEvent<string>(rl, 'line')
    ↓
map((line) => line.trim())           // Remove whitespace
    ↓
tap((line) => { ... })               // Handle local commands (/help, /tools, /clear, /exit, /skills)
    ↓
takeUntil(close$)                    // End stream on rl.close()
    ↓
filter((line) => ...)                // Filter empty lines and local commands
    ↓
scan<string, ChatInputTurn>(...)     // Accumulate turn counter
    ↓
Observable<ChatInputTurn>
```

**Local Commands Handled** (Lines 319-361):
- `/exit`, `/quit` → closes readline
- `/help` → displays help text
- `/tools` → displays tool syntax
- `/clear` → clears screen
- `/skills` → displays available skills (if skillExecutor provided)

### Connection to Agent Loop

**File**: `src/commands/chat.ts` (Lines 105-121)

```typescript
const run = runAgentLoop({
  input$: params.input$,  // ← Observable<ChatInputTurn>
  provider: params.provider,
  sessionManager: params.sessionManager,
  // ... other params
});
```

---

## 2. TUI Input Flow

### Entry Point

**File**: `src/tui/index.tsx`

The TUI mode is initiated via the `tui` command, which calls `createTuiRuntime()`.

### Runtime Initialization

**File**: `src/tui/hooks/useRuntime.ts` (Lines 48-169)

Key differences from CLI:
1. Creates a `Subject<ChatInputTurn>` (line 99) instead of using readline
2. Pre-creates a session before starting agent-loop (line 102)
3. Passes `existingSession` to `runAgentLoop` (line 118)

```typescript
// Line 99
const input$ = new Subject<ChatInputTurn>();

// Line 102-106
const session = await sessionManager.startSession({
  cwd,
  mode: 'interactive',
  providerId: provider.id,
});

// Line 109-123
const run = runAgentLoop({
  input$,
  existingSession: session,  // ← Pre-created session
  // ... other params
});
```

### User Input Capture

**File**: `src/tui/hooks/useUserInput.ts` (Lines 17-48)

```typescript
export function useUserInput(input$: Subject<ChatInputTurn> | null): {
  sendMessage: (content: string) => void;
} {
  const turnRef = useRef(1);

  const sendMessage = useCallback(
    (content: string) => {
      if (!input$) {
        console.error('Runtime not initialized, cannot send message');
        return;
      }

      if (!content.trim()) {
        return;
      }

      const turn: ChatInputTurn = {
        turn: turnRef.current,
        content: content.trim(),
        source: 'interactive',
      };

      input$.next(turn);  // ← Push to Subject
      turnRef.current += 1;
    },
    [input$]
  );

  return { sendMessage };
}
```

### InputBar Component

**File**: `src/tui/components/session/InputBar.tsx` (Lines 19-89)

- Uses `useInput` hook from Ink to capture keystrokes
- Maintains local `input` state
- Calls `sendMessage` on Enter/Ctrl+Enter
- Clears input after sending

```typescript
// Lines 28-46
if (key.return) {
  if (input.trim() && sendMessage) {
    sendMessage(input.trim());
    setInput('');
  }
  return;
}
```

### Data Flow in TUI Mode

```
User keystrokes (Ink useInput)
    ↓
InputBar local state (input)
    ↓
sendMessage(content) on Enter
    ↓
useUserInput hook
    ↓
input$.next(ChatInputTurn)  // Subject push
    ↓
runAgentLoop input$ subscription
    ↓
Agent processing
```

---

## 3. Input Data Format Comparison

### ChatInputTurn Type

**File**: `src/runtime/event-types.ts` (Lines 32-36)

```typescript
export type ChatInputTurn = {
  turn: number;      // Turn counter (1-based)
  content: string;   // User input text (trimmed)
  source: InputSource;  // 'message' | 'stdin' | 'interactive'
};
```

### Format Consistency

| Aspect | CLI | TUI | Consistent? |
|--------|-----|-----|-------------|
| Type | `ChatInputTurn` | `ChatInputTurn` | Yes |
| turn field | Auto-incremented via `scan` | Auto-incremented via `useRef` | Yes |
| content field | `line.trim()` | `content.trim()` | Yes |
| source field | `'interactive'` / `'message'` / `'stdin'` | Always `'interactive'` | Yes |

**Conclusion**: The input format is **unified**. Both paths produce identical `ChatInputTurn` objects.

---

## 4. Session Management Comparison

### CLI Path

**File**: `src/commands/chat.ts`

1. Session created **inside** `runAgentLoop` (line 105-121)
2. `sessionManager` passed to `runAgentLoop`
3. Session lifecycle managed by agent-loop:
   - `sessionManager.startSession()` at start
   - `sessionManager.appendRecord()` for each message
   - Session ends when input$ completes

**Timing**:
```
createChatCommand() → runChatSession() → runAgentLoop() → sessionManager.startSession()
```

### TUI Path

**File**: `src/tui/hooks/useRuntime.ts`

1. Session created **before** `runAgentLoop` (lines 102-106)
2. `existingSession` passed to `runAgentLoop` (line 118)
3. Session lifecycle:
   - Pre-created in `createTuiRuntime()`
   - `runAgentLoop` receives it as `existingSession`
   - Cleanup in `cleanupTuiRuntime()` (line 176-190)

**Timing**:
```
createTuiRuntime() → sessionManager.startSession() → runAgentLoop({existingSession: session})
```

### Key Difference

| Aspect | CLI | TUI |
|--------|-----|-----|
| Session creation | Inside `runAgentLoop` | Before `runAgentLoop` |
| Pass to agent-loop | Implicit (creates new) | Explicit (`existingSession`) |
| Cleanup | Automatic (stream ends) | Manual (`cleanupTuiRuntime`) |

---

## 5. Skills/Tools Lifecycle Management

### Tool Registry Creation

**CLI** (`src/commands/chat.ts`, lines 86-87):
```typescript
const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(params.mcpServers);
```

**TUI** (`src/tui/hooks/useRuntime.ts`, lines 88-89):
```typescript
const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(mcpServers);
```

Both paths create tool registry identically.

### Skill Registry Creation

**CLI** (`src/commands/chat.ts`, lines 89-95):
```typescript
const skillRegistry = await createSkillRegistry({
  projectSkillsDir: params.projectConfigDir ? `${params.projectConfigDir}/skills` : undefined,
  userSkillsDir: `${homedir()}/.wasteland/skills`,
});
const skillExecutor = new SkillExecutor(skillRegistry);
```

**TUI** (`src/tui/hooks/useRuntime.ts`):
- **NOT implemented** - no skill registry creation visible
- The TUI path does not create `skillExecutor`

### MCP Server Lifecycle

| Aspect | CLI | TUI |
|--------|-----|-----|
| Start | `startMCP()` in `runChatSession` | `startMCP()` in `createTuiRuntime` |
| Stop | `stopMCP()` in finally block | `stopMCP()` in `cleanupTuiRuntime` |

### Skill Execution

**CLI** (`src/runtime/agent-loop.ts`, lines 317-382):
- Skills checked in `runTurnLoop` via `params.skillExecutor.isSkillCommand()`
- If skill command detected, routed to `skillExecutor.execute()`
- Returns `Observable<RuntimeEvent>` with `skill_started` and `skill_result` events

**TUI**:
- No skill executor created
- Skills are **not available** in TUI mode currently

---

## 6. Summary of Key Files

| File | Purpose |
|------|---------|
| `src/runtime/event-types.ts` | Defines `ChatInputTurn`, `RuntimeEvent` types |
| `src/runtime/agent-loop.ts` | Core agent loop, processes `input$` Observable |
| `src/runtime/turn-context.ts` | Creates context for each turn from `ChatInputTurn` |
| `src/runtime/turn-state.ts` | Manages turn state including input reference |
| `src/runtime/session-manager.ts` | Session persistence and lifecycle |
| `src/ui/readline-input.ts` | CLI input creation (readline-based) |
| `src/commands/chat.ts` | CLI command entry point |
| `src/tui/hooks/useUserInput.ts` | TUI input hook (Subject-based) |
| `src/tui/hooks/useRuntime.ts` | TUI runtime initialization |
| `src/tui/components/session/InputBar.tsx` | TUI input component |
| `src/skills/skill-executor.ts` | Skill execution coordination |

---

## 7. Critical Observations

### 1. Input Mechanism Difference
- **CLI**: Uses Node.js `readline` + RxJS `fromEvent` to create Observable
- **TUI**: Uses RxJS `Subject` with manual `.next()` calls

Both produce identical `ChatInputTurn` objects, making the downstream processing **completely unified**.

### 2. Session Creation Timing
- **CLI**: Session created lazily inside `runAgentLoop`
- **TUI**: Session created eagerly before `runAgentLoop`, passed as `existingSession`

This is a **significant architectural difference** that affects:
- Error handling (TUI can fail before agent-loop starts)
- Resource cleanup (TUI requires explicit cleanup)

### 3. Skill Availability Gap
- **CLI**: Full skill support via `SkillExecutor`
- **TUI**: No skill executor created, skills **unavailable**

This is a **feature gap** that needs addressing for TUI parity.

### 4. Local Command Handling
- **CLI**: Handled in `readline-input.ts` via `tap` operator (lines 319-361)
- **TUI**: Handled via React component state and `useInput` hook

Both handle commands differently but achieve similar results.

### 5. Input Source Tracking
- **CLI**: Can be `'message'`, `'stdin'`, or `'interactive'`
- **TUI**: Always `'interactive'`

This is consistent with the design (TUI is always interactive).

---

## 8. Data Flow Diagrams

### CLI Flow
```
┌─────────────────────────────────────────────────────────────┐
│                    CLI Input Flow                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  process.stdin ──→ readline ──→ fromEvent ──→ map/trim      │
│                                         ↓                   │
│                                    tap (local commands)     │
│                                         ↓                   │
│                                    filter/scan              │
│                                         ↓                   │
│                              Observable<ChatInputTurn>      │
│                                         ↓                   │
│                              runAgentLoop({input$})         │
│                                         ↓                   │
│                              sessionManager.startSession()  │
│                                         ↓                   │
│                              Agent Processing               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### TUI Flow
```
┌─────────────────────────────────────────────────────────────┐
│                    TUI Input Flow                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  createTuiRuntime()                                         │
│       ↓                                                     │
│  sessionManager.startSession() ──→ session (pre-created)    │
│       ↓                                                     │
│  input$ = new Subject<ChatInputTurn>()                      │
│       ↓                                                     │
│  runAgentLoop({input$, existingSession: session})           │
│       ↓                                                     │
│  User keystrokes (Ink useInput)                             │
│       ↓                                                     │
│  InputBar → sendMessage() → input$.next(turn)               │
│       ↓                                                     │
│  Agent Processing                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Recommendations for Investigation

1. **TUI Skill Support**: Investigate adding `skillExecutor` creation in `useRuntime.ts`
2. **Session Error Handling**: Review how TUI handles pre-created session failures
3. **Input Validation**: Both paths use `trim()`, but no length/content validation
4. **Turn Counter Edge Cases**: TUI uses `useRef` which resets on component remount
