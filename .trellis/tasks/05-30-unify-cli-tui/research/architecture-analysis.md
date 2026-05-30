# Research: CLI/TUI Architecture Analysis

- **Query**: Analyze the architectural differences between CLI and TUI paths in rx-cli
- **Scope**: Internal
- **Date**: 2026-05-30

## Executive Summary

The rx-cli project has two distinct user interface paths: CLI (command-line) and TUI (terminal UI). Both paths share the same core runtime, providers, tools, and configuration systems, but differ significantly in their input/output handling and state management approaches.

---

## 1. CLI Path Architecture

### Entry Flow
```
src/cli.ts
  └─ createProgram()
       └─ createChatCommand() [src/commands/chat.ts]
            └─ action handler
                 ├─ loadWastelandSettings()
                 ├─ resolveChatRuntime()
                 ├─ createDefaultProviderRegistry()
                 ├─ SessionManager
                 ├─ Input source (message/stdin/interactive)
                 ├─ runAgentLoop() → { events$, debug$ }
                 └─ renderRuntimeEvents()
```

### Input Sources
1. **Single Turn (message)**: `createSingleTurnInput()` - for `--message` flag
2. **Piped Input (stdin)**: `readPipedInput()` - for pipe operations
3. **Interactive (REPL)**: `createInteractiveTurnStream()` - readline-based

### Output Rendering
- **File**: `src/ui/terminal-renderer.ts`
- **Function**: `renderRuntimeEvents(events$, params)`
- **Style**: ANSI-based streaming with two modes:
  - `classic`: Simple text output
  - `interactive`: Rich formatted output with icons, colors, panels

### Key Files
| File | Purpose |
|------|---------|
| `src/cli.ts` | Program entry, command registration |
| `src/commands/chat.ts` | Chat command implementation |
| `src/ui/readline-input.ts` | Interactive input stream (readline) |
| `src/ui/terminal-renderer.ts` | Runtime event rendering |
| `src/ui/terminal-theme.ts` | ANSI styling utilities |

---

## 2. TUI Path Architecture

### Entry Flow
```
src/cli.ts
  └─ createProgram()
       └─ createTuiCommand() [src/commands/tui.ts]
            └─ action handler
                 ├─ detectTTY()
                 ├─ createTuiRuntime() [src/tui/hooks/useRuntime.ts]
                 │    ├─ loadWastelandSettings()
                 │    ├─ resolveChatRuntime()
                 │    ├─ createDefaultProviderRegistry()
                 │    ├─ SessionManager
                 │    ├─ Subject<ChatInputTurn> (input$)
                 │    ├─ runAgentLoop() → { events$, debug$ }
                 │    └─ Return TuiRuntimeContext
                 └─ runTUI(runtime) [src/tui/index.tsx]
                      └─ render(<App runtime={runtime} />)
```

### Input Handling
- **File**: `src/tui/hooks/useUserInput.ts`
- **Component**: `src/tui/components/session/InputBar.tsx`
- **Mechanism**: React state + RxJS Subject
  - User types in InputBar component
  - Press Enter/Ctrl+Enter → `sendMessage(content)`
  - `sendMessage` → `input$.next({ turn, content, source: 'interactive' })`

### Output Rendering
- **Framework**: React/Ink (React for CLI)
- **Main Component**: `src/tui/App.tsx`
- **State Management**: `src/tui/context/AppContext.tsx`
- **Event Processing**: `src/tui/hooks/useRuntimeEvents.ts`

### Key Files
| File | Purpose |
|------|---------|
| `src/commands/tui.ts` | TUI command registration |
| `src/tui/index.tsx` | Ink app entry point |
| `src/tui/App.tsx` | Main React component |
| `src/tui/types.ts` | TUI type definitions |
| `src/tui/hooks/useRuntime.ts` | Runtime context creation |
| `src/tui/hooks/useRuntimeEvents.ts` | Event subscription & state update |
| `src/tui/hooks/useUserInput.ts` | User input handling |
| `src/tui/context/AppContext.tsx` | React context for app state |
| `src/tui/components/session/SessionPage.tsx` | Session page layout |
| `src/tui/components/session/MessageList.tsx` | Message display |
| `src/tui/components/session/InputBar.tsx` | Input component |

---

## 3. Shared Core Modules

### Already Shared (Both Paths Use Identical Code)

| Module | File(s) | Purpose |
|--------|---------|---------|
| **Agent Loop** | `src/runtime/agent-loop.ts` | Core orchestration (input → provider → tools → output) |
| **Event Types** | `src/runtime/event-types.ts` | `RuntimeEvent`, `ChatInputTurn`, `SessionRecord` |
| **Provider System** | `src/providers/provider-registry.ts`, `src/providers/provider-types.ts` | Provider registration and interface |
| **Provider Implementations** | `src/providers/claude.ts`, `src/providers/openai.ts`, `src/providers/local.ts`, `src/providers/openai-compatible/` | AI provider implementations |
| **Tool System** | `src/tools/tool-registry.ts`, `src/tools/default-registry.ts` | Tool registration and default tools |
| **Tool Implementations** | `src/tools/bash.ts`, `src/tools/read-file.ts`, `src/tools/edit-file.ts`, etc. | Individual tool implementations |
| **Permission Gate** | `src/runtime/permission-gate.ts` | Permission checking |
| **Session Manager** | `src/runtime/session-manager.ts` | Session persistence |
| **Tool Dispatch** | `src/runtime/tool-dispatch.ts` | Tool execution coordination |
| **Turn Context** | `src/runtime/turn-context.ts` | Turn context creation |
| **Turn State** | `src/runtime/turn-state.ts` | Turn state management |
| **Configuration** | `src/config/load-settings.ts`, `src/config/resolve-chat-runtime.ts`, `src/config/settings-types.ts` | Settings loading and runtime resolution |
| **Skills System** | `src/skills/skill-discovery.ts`, `src/skills/skill-executor.ts`, `src/skills/skill-registry.ts` | Skill discovery and execution |

---

## 4. Key Differences

### 4.1 Input Handling

| Aspect | CLI | TUI |
|--------|-----|-----|
| **Framework** | Node.js readline | React/Ink components |
| **State** | Imperative (Observable chain) | Declarative (React state) |
| **Input Component** | `createInteractiveTurnStream()` | `InputBar.tsx` + `useUserInput()` |
| **Event Flow** | `readline "line"` → `fromEvent` → `pipe operators` | `useInput` → `setState` → `sendMessage` → `input$.next()` |
| **Local Commands** | Handled in `tap()` operator (`/help`, `/tools`, `/clear`, `/exit`) | Not yet implemented in TUI |

### 4.2 Output Rendering

| Aspect | CLI | TUI |
|--------|-----|-----|
| **Framework** | Direct ANSI output | React/Ink components |
| **Streaming** | `process.stdout.write(chunk)` | React state updates trigger re-renders |
| **Formatting** | `terminal-renderer.ts` with ANSI codes | Ink `<Text>`, `<Box>` components |
| **Layout** | Single stream output | Multi-panel layout (Header, Content, Footer) |
| **Pages** | None (linear output) | Session, Debug, Config pages |

### 4.3 State Management

| Aspect | CLI | TUI |
|--------|-----|-----|
| **Approach** | Imperative (Observable subscriptions) | Declarative (React useState/useReducer) |
| **State Location** | Local variables in `runChatSession()` | `AppContext` (React Context) |
| **Updates** | Direct mutation in Observable callbacks | `setState()` triggers re-renders |
| **Debug State** | `renderDebugTrace()` subscription | `useRuntimeEvents()` hook |

### 4.4 Session Management

| Aspect | CLI | TUI |
|--------|-----|-----|
| **Session Start** | Inside `runAgentLoop()` | Inside `createTuiRuntime()` |
| **Session Reference** | Local variable in closure | `TuiRuntimeContext.session` |
| **Cleanup** | Automatic (Promise completion) | Explicit `cleanupTuiRuntime()` |

### 4.5 Feature Parity

| Feature | CLI | TUI |
|---------|-----|-----|
| `--role` parameter | Supported | Not yet (hardcoded to undefined) |
| `/skills` command | Supported (readline) | Not yet |
| `/help` command | Supported | Help modal (different UX) |
| `/tools` command | Supported | Not yet |
| `/clear` command | Supported | Not yet |
| Debug page | `--debug` flag | Dedicated debug page |
| Config page | `config current` command | Dedicated config page |
| Agent tree view | Linear output | Visual agent hierarchy |
| Skin/theme | Not applicable | `loadSkin()` in useRuntime.ts |

---

## 5. Unified Architecture Opportunities

### 5.1 Runtime Layer (Already Unified)

The runtime layer is already well-unified:
- `runAgentLoop()` is the single entry point for both paths
- `RuntimeEvent` is the common event contract
- All providers, tools, and permissions work identically

### 5.2 Configuration Layer (Already Unified)

Configuration is fully shared:
- `loadWastelandSettings()` → same settings for both paths
- `resolveChatRuntime()` → same runtime resolution
- `ProviderRegistry` → same provider instantiation

### 5.3 Input Layer (Potential Unification)

**Current State**: Different approaches (readline vs React)

**Opportunity**: Create a unified input adapter pattern:
```
InputAdapter interface {
  turns$: Observable<ChatInputTurn>
  prompt(): void
  close(): void
}
```

Both paths could implement this interface:
- CLI: `ReadlineInputAdapter` (existing `createInteractiveTurnStream`)
- TUI: `ReactInputAdapter` (wrapping `input$` Subject)

### 5.4 Output Layer (Significant Divergence)

**Current State**: Completely different rendering approaches

**Challenge**: The output layer is the most divergent:
- CLI: Streaming ANSI output (imperative)
- TUI: React component tree (declarative)

**Possible Approaches**:
1. **Keep separate**: Accept that CLI and TUI have different rendering
2. **Shared renderer**: Create a `RuntimeEventRenderer` interface that both implement
3. **Event-only**: Both paths consume `RuntimeEvent` stream, but render differently

### 5.5 Local Commands (Missing in TUI)

**Current State**: CLI has `/help`, `/tools`, `/clear`, `/exit`, `/skills`

**Opportunity**: Implement equivalent commands in TUI:
- Could be keyboard shortcuts (already some exist)
- Could be command palette (future feature)

---

## 6. Main Challenges for Unification

### 6.1 Input/Output Framework Mismatch

**Challenge**: readline (imperative) vs React/Ink (declarative)

**Impact**: High - affects all input/output handling

**Possible Solution**: Abstract input/output behind interfaces, allow different implementations

### 6.2 State Management Philosophy

**Challenge**: Imperative (CLI) vs Declarative (TUI)

**Impact**: Medium - affects how state is tracked and updated

**Possible Solution**: Use a shared state container (e.g., RxJS BehaviorSubject) that both paths can subscribe to

### 6.3 Feature Parity Gap

**Challenge**: TUI missing several CLI features

**Impact**: Medium - users may expect feature parity

**Features to add to TUI**:
- `/skills` command or keyboard shortcut
- `/tools` command or info panel
- Role selection UI
- Better help system

### 6.4 Session Lifecycle Differences

**Challenge**: Session created at different points

**Impact**: Low - both paths work correctly, just different timing

**CLI**: Session created inside `runAgentLoop()`
**TUI**: Session created in `createTuiRuntime()`, passed to `runAgentLoop()`

### 6.5 Debug/Trace Handling

**Challenge**: Different debug output mechanisms

**Impact**: Low - both work, just different approaches

**CLI**: `renderDebugTrace()` → stderr
**TUI**: `useRuntimeEvents()` → debug page state

---

## 7. Recommended Unification Strategy

### Phase 1: Extract Shared Runtime Initialization

Create a `createRuntimeContext()` function that both paths can use:

```typescript
// src/runtime/create-runtime-context.ts
export async function createRuntimeContext(params: {
  cwd: string;
  roleName?: string;
  providerName?: string;
}): Promise<{
  provider: AgentProvider;
  sessionManager: SessionManager;
  permissionGate: PermissionGate;
  toolRegistry: ToolRegistry;
  skillExecutor: SkillExecutor;
  config: ResolvedChatRuntime;
  mcpControl: { startMCP: () => Promise<void>; stopMCP: () => Promise<void> };
}>
```

This would:
- Reduce code duplication between `commands/chat.ts` and `tui/hooks/useRuntime.ts`
- Ensure consistent initialization
- Make it easier to add new features to both paths

### Phase 2: Standardize Input Adapter

Create a common input interface:

```typescript
// src/runtime/input-adapter.ts
export interface InputAdapter {
  turns$: Observable<ChatInputTurn>;
  prompt?(): void;
  close?(): void;
  done?: Promise<void>;
}
```

Both paths would implement this, making the runtime layer truly input-agnostic.

### Phase 3: Feature Parity for TUI

Add missing features to TUI:
1. `/skills` command (keyboard shortcut or command palette)
2. `/tools` info panel
3. Role selection in config page
4. Help system improvements

### Phase 4: Shared Event Processing

Extract the event processing logic from `useRuntimeEvents.ts` into a shared module that both CLI and TUI can use (or adapt).

---

## 8. Files Summary

### Core Runtime (Shared)
- `/home/ubuntu/workspace/rx-cli/src/runtime/agent-loop.ts` - Core agent loop
- `/home/ubuntu/workspace/rx-cli/src/runtime/event-types.ts` - Event type definitions
- `/home/ubuntu/workspace/rx-cli/src/runtime/permission-gate.ts` - Permission system
- `/home/ubuntu/workspace/rx-cli/src/runtime/session-manager.ts` - Session management
- `/home/ubuntu/workspace/rx-cli/src/runtime/tool-dispatch.ts` - Tool execution
- `/home/ubuntu/workspace/rx-cli/src/runtime/turn-context.ts` - Turn context
- `/home/ubuntu/workspace/rx-cli/src/runtime/turn-state.ts` - Turn state

### CLI-Specific
- `/home/ubuntu/workspace/rx-cli/src/cli.ts` - Program entry
- `/home/ubuntu/workspace/rx-cli/src/commands/chat.ts` - Chat command
- `/home/ubuntu/workspace/rx-cli/src/ui/readline-input.ts` - Readline input
- `/home/ubuntu/workspace/rx-cli/src/ui/terminal-renderer.ts` - ANSI rendering
- `/home/ubuntu/workspace/rx-cli/src/ui/terminal-theme.ts` - ANSI styling

### TUI-Specific
- `/home/ubuntu/workspace/rx-cli/src/commands/tui.ts` - TUI command
- `/home/ubuntu/workspace/rx-cli/src/tui/index.tsx` - Ink entry
- `/home/ubuntu/workspace/rx-cli/src/tui/App.tsx` - Main React component
- `/home/ubuntu/workspace/rx-cli/src/tui/types.ts` - TUI types
- `/home/ubuntu/workspace/rx-cli/src/tui/hooks/useRuntime.ts` - Runtime context
- `/home/ubuntu/workspace/rx-cli/src/tui/hooks/useRuntimeEvents.ts` - Event processing
- `/home/ubuntu/workspace/rx-cli/src/tui/hooks/useUserInput.ts` - Input handling
- `/home/ubuntu/workspace/rx-cli/src/tui/context/AppContext.tsx` - React context

### Spec Documents
- `/home/ubuntu/workspace/rx-cli/.trellis/spec/backend/runtime-contracts.md` - Runtime contracts
- `/home/ubuntu/workspace/rx-cli/.trellis/spec/backend/tool-runtime-contracts.md` - Tool contracts

---

## Caveats / Not Found

1. **No formal interface for input adapters**: The project doesn't have a formal `InputAdapter` interface; this is a proposed improvement.

2. **TUI skill support incomplete**: The TUI path doesn't create a `SkillExecutor` in `useRuntime.ts`, meaning `/skills` commands won't work in TUI.

3. **TUI role support missing**: The TUI path hardcodes `roleName: undefined` in `resolveChatRuntime()`, while CLI supports `--role` parameter.

4. **MCP lifecycle differs**: Both paths manage MCP servers, but the lifecycle management is duplicated (not shared).

5. **Debug output differs significantly**: CLI outputs to stderr, TUI stores in React state for debug page display.
