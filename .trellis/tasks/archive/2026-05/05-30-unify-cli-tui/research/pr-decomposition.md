# Research: CLI/TUI Unification PR Decomposition

- **Query**: Plan PR decomposition for CLI/TUI unified pipeline
- **Scope**: internal
- **Date**: 2026-05-30

## Findings

### Current Architecture Analysis

#### Duplication Map

| Concern | CLI Implementation | TUI Implementation | Gap |
|---------|-------------------|-------------------|-----|
| Config loading | `src/commands/chat.ts:167` `loadWastelandSettings()` | `src/tui/hooks/useRuntime.ts:50` `loadWastelandSettings()` | Identical |
| Runtime resolution | `src/commands/chat.ts:171` `resolveChatRuntime()` | `src/tui/hooks/useRuntime.ts:60` `resolveChatRuntime()` | Identical |
| Provider creation | `src/commands/chat.ts:177` `providerRegistry.resolve()` | `src/tui/hooks/useRuntime.ts:68-70` `providerRegistry.resolve()` | Identical |
| SessionManager creation | `src/commands/chat.ts:181` `new SessionManager()` | `src/tui/hooks/useRuntime.ts:74-80` `new SessionManager()` | Identical |
| ToolRegistry creation | `src/commands/chat.ts:86` `createDefaultToolRegistry()` | `src/tui/hooks/useRuntime.ts:88-89` `createDefaultToolRegistry()` | Identical |
| PermissionGate creation | `src/commands/chat.ts:110` `createPermissionGate()` | `src/tui/hooks/useRuntime.ts:83-85` `createPermissionGate()` | Identical |
| MCP startup | `src/commands/chat.ts:98-101` `startMCP()` | `src/tui/hooks/useRuntime.ts:92-96` `startMCP()` | Identical |
| runAgentLoop call | `src/commands/chat.ts:105` `runAgentLoop()` | `src/tui/hooks/useRuntime.ts:109-123` `runAgentLoop()` | TUI creates session separately |
| Local command handling | `src/ui/readline-input.ts:319-361` (inline in tap) | N/A (TUI has no local commands) | TUI missing /skills support |
| Event rendering | `src/ui/terminal-renderer.ts:299` `renderRuntimeEvents()` | `src/tui/hooks/useRuntimeEvents.ts:279` `useRuntimeEvents()` | Completely different implementations |
| Input handling | `src/ui/readline-input.ts` readline-based | `src/tui/hooks/useUserInput.ts` Subject-based | Different mechanisms, same output type |
| Cleanup | `src/commands/chat.ts:144-147` MCP cleanup | `src/tui/hooks/useRuntime.ts:176-190` `cleanupTuiRuntime()` | Different cleanup patterns |

#### Key Architectural Differences

1. **Session creation timing**: TUI calls `sessionManager.startSession()` explicitly in `useRuntime.ts:102` and passes `existingSession` to `runAgentLoop()`. CLI lets `runAgentLoop()` create the session internally at `agent-loop.ts:871`.

2. **Input mechanism**: CLI uses `readline` EventEmitter -> Observable pipeline with local command interception. TUI uses `Subject<ChatInputTurn>` directly.

3. **Output mechanism**: CLI subscribes to `events$` and writes to stdout imperatively. TUI subscribes to `events$` and updates React state via `setState`.

4. **Local commands**: CLI handles `/help`, `/tools`, `/clear`, `/exit`, `/skills` in `readline-input.ts`. TUI has no equivalent (help is via keyboard shortcut `h`, exit via `Ctrl+C` or `q`).

5. **SkillExecutor**: CLI creates it in `chat.ts:89-95` and passes to `runAgentLoop()`. TUI does NOT create SkillExecutor at all.

6. **Role support**: CLI supports `--role` via `resolveChatRuntime()`. TUI hardcodes `roleName: undefined` at `useRuntime.ts:63`.

7. **i18n**: TUI initializes i18n separately in `useRuntime.ts:56`. CLI relies on locale being loaded at import time.

#### Existing Spec Contracts

File: `.trellis/spec/backend/cli-tui-contracts.md`

Defines the target architecture:
- **RuntimeEnvironment**: `{ session, skillExecutor, mcpManager, providerRegistry, roleConfig }` + `initializeRuntime()`
- **LocalCommandResult**: `{ handled, output?, action? }` + `executeLocalCommand()`
- **InputAdapter**: `{ input$, destroy() }` with `CliInputAdapter` and `TuiInputAdapter`
- **OutputAdapter**: `{ processEvent(event) }` converting `RuntimeEvent -> DisplayEvent`
- **UIRenderer**: `{ renderEvent(), flush(), destroy() }` with `CliRenderer` and TUI hook

#### Files in Scope

**Shared business logic (to be created/modified):**
- `src/runtime/initialize-runtime.ts` (NEW) - RuntimeEnvironment creation
- `src/runtime/local-commands.ts` (NEW) - executeLocalCommand()
- `src/runtime/role-resolver.ts` (NEW) - RoleResolver (extracted from resolve-chat-runtime.ts)

**Adapter layer (to be created):**
- `src/adapters/input-adapter.ts` (NEW) - InputAdapter interface
- `src/adapters/cli-input-adapter.ts` (NEW) - CliInputAdapter
- `src/adapters/tui-input-adapter.ts` (NEW) - TuiInputAdapter
- `src/adapters/output-adapter.ts` (NEW) - OutputAdapter interface + DisplayEvent type
- `src/adapters/cli-output-adapter.ts` (NEW) - CliOutputAdapter (wraps terminal-renderer)
- `src/adapters/tui-output-adapter.ts` (NEW) - TuiOutputAdapter (wraps useRuntimeEvents logic)

**CLI migration (to be modified):**
- `src/commands/chat.ts` - Use RuntimeEnvironment + adapters
- `src/ui/readline-input.ts` - Extract to CliInputAdapter
- `src/ui/terminal-renderer.ts` - Extract to CliOutputAdapter

**TUI migration (to be modified):**
- `src/tui/hooks/useRuntime.ts` - Use RuntimeEnvironment
- `src/tui/hooks/useRuntimeEvents.ts` - Use TuiOutputAdapter
- `src/tui/hooks/useUserInput.ts` - Use TuiInputAdapter
- `src/tui/types.ts` - Update TuiRuntimeEnvironment

---

## PR Decomposition

### PR 1: Extract RuntimeEnvironment (Shared Business Logic Foundation)

**Goal**: Create `RuntimeEnvironment` and `initializeRuntime()` to centralize session/provider/tool/skill initialization that is currently duplicated between CLI and TUI.

**Files to create:**
- `src/runtime/initialize-runtime.ts` - RuntimeEnvironment type + initializeRuntime()
- `src/runtime/initialize-runtime.test.ts` - Unit tests

**Files to modify:**
- None (pure addition, no migration yet)

**Changes:**
```
src/runtime/initialize-runtime.ts (NEW):
  - type RuntimeEnvironment = {
      sessionManager: SessionManager;
      skillExecutor: SkillExecutor;
      provider: AgentProvider;
      providerRegistry: ProviderRegistry;
      toolRegistry: ToolRegistry;
      permissionGate: PermissionGate;
      resolvedRuntime: ResolvedChatRuntime;
      mcpManager: { startMCP: () => Promise<void>; stopMCP: () => Promise<void> };
    }
  - async function initializeRuntime(params: {
      settings: ResolvedWastelandSettings;
      projectConfigDir: string | null;
      roleName?: string;
      providerName?: string;
      cwd: string;
    }): Promise<RuntimeEnvironment>
```

**What it consolidates:**
- Config loading (from `chat.ts:167-176` and `useRuntime.ts:50-65`)
- Provider resolution (from `chat.ts:177-179` and `useRuntime.ts:68-70`)
- SessionManager creation (from `chat.ts:181-187` and `useRuntime.ts:74-80`)
- ToolRegistry + MCP creation (from `chat.ts:86` and `useRuntime.ts:88-89`)
- PermissionGate creation (from `chat.ts:110` and `useRuntime.ts:83-85`)
- SkillExecutor creation (from `chat.ts:89-95` -- missing in TUI!)
- Role resolution (from `chat.ts:171-176` and `useRuntime.ts:60-65`)

**Test strategy:**
- Unit test: `initializeRuntime()` initializes all fields (no partial context)
- Unit test: SkillExecutor is created and functional
- Unit test: MCP startup/shutdown lifecycle
- Integration test: Context can feed into `runAgentLoop()` successfully

**Risk**: Low. Pure extraction, no behavior change. Both CLI and TUI can opt-in independently.

**Rollback**: Delete `initialize-runtime.ts`, revert to inline initialization.

---

### PR 2: Extract executeLocalCommand (Shared Local Commands)

**Goal**: Extract the local command handling logic from `readline-input.ts` into a shared module, so TUI can also handle `/help`, `/skills` etc.

**Files to create:**
- `src/runtime/local-commands.ts` - executeLocalCommand()
- `src/runtime/local-commands.test.ts` - Unit tests

**Files to modify:**
- None (pure addition)

**Changes:**
```
src/runtime/local-commands.ts (NEW):
  - type LocalCommandResult = {
      handled: boolean;
      output?: string;
      action?: 'clear' | 'exit' | 'help';
    }
  - function executeLocalCommand(params: {
      command: string;
      skillExecutor?: SkillExecutor;
    }): LocalCommandResult
```

**What it consolidates:**
- Local command logic from `readline-input.ts:319-361` (the `tap` handler)
- Currently `/help`, `/tools`, `/clear`, `/exit`, `/quit`, `/skills` are handled inline

**Test strategy:**
- Unit test: Each command type returns correct `LocalCommandResult`
- Unit test: Unknown command returns `{ handled: false }`
- Unit test: `/skills` with and without SkillExecutor
- Unit test: `/exit` returns action 'exit'

**Risk**: Low. Pure extraction. CLI adapter will call this function; TUI can start using it later.

**Rollback**: Delete `local-commands.ts`.

---

### PR 3: Define InputAdapter Interface

**Goal**: Define the `InputAdapter` interface and create CLI/TUI implementations.

**Files to create:**
- `src/adapters/input-adapter.ts` - InputAdapter interface
- `src/adapters/cli-input-adapter.ts` - CliInputAdapter (wraps readline logic)
- `src/adapters/tui-input-adapter.ts` - TuiInputAdapter (wraps Subject)
- `src/adapters/cli-input-adapter.test.ts` - Unit tests
- `src/adapters/tui-input-adapter.test.ts` - Unit tests

**Files to modify:**
- None (pure addition)

**Changes:**
```
src/adapters/input-adapter.ts (NEW):
  - interface InputAdapter {
      readonly input$: Observable<ChatInputTurn>;
      destroy(): void;
    }

src/adapters/cli-input-adapter.ts (NEW):
  - class CliInputAdapter implements InputAdapter {
      constructor(params: {
        input?: Readable;
        output?: Writable;
        intro?: string;
        promptText?: string;
        skillExecutor?: SkillExecutor;
        commandHandler?: (command: string) => LocalCommandResult;
      });
      readonly input$: Observable<ChatInputTurn>;
      prompt(): void;
      destroy(): void;
      readonly done: Promise<void>;
    }
    // Wraps existing readline-input.ts logic

src/adapters/tui-input-adapter.ts (NEW):
  - class TuiInputAdapter implements InputAdapter {
      constructor(params: {
        commandHandler?: (command: string) => LocalCommandResult;
      });
      readonly input$: Observable<ChatInputTurn>;
      send(content: string): void;  // replaces useUserInput hook
      destroy(): void;
    }
    // Wraps Subject-based input
```

**What it consolidates:**
- `createInteractiveTurnStream()` from `readline-input.ts` -> CliInputAdapter
- `useUserInput` hook logic from `useUserInput.ts` -> TuiInputAdapter

**Test strategy:**
- Unit test: CliInputAdapter emits ChatInputTurn for valid input
- Unit test: CliInputAdapter handles /exit, /help, /clear locally
- Unit test: CliInputAdapter filters empty lines
- Unit test: TuiInputAdapter sends messages via Subject
- Unit test: Both adapters clean up on destroy()

**Risk**: Low. Pure additions. Neither CLI nor TUI uses them yet.

**Rollback**: Delete adapter files.

---

### PR 4: Define OutputAdapter + DisplayEvent Interface

**Goal**: Define the `DisplayEvent` type, `OutputAdapter` interface, and create CLI/TUI implementations.

**Files to create:**
- `src/adapters/output-adapter.ts` - DisplayEvent type + OutputAdapter interface
- `src/adapters/cli-output-adapter.ts` - CliOutputAdapter
- `src/adapters/tui-output-adapter.ts` - TuiOutputAdapter
- `src/adapters/cli-output-adapter.test.ts` - Unit tests
- `src/adapters/tui-output-adapter.test.ts` - Unit tests

**Files to modify:**
- None (pure addition)

**Changes:**
```
src/adapters/output-adapter.ts (NEW):
  - type DisplayEvent = { ... }  (1:1 mapping of RuntimeEvent, from spec)
  - interface OutputAdapter {
      processEvent(event: RuntimeEvent): DisplayEvent;
    }

src/adapters/cli-output-adapter.ts (NEW):
  - class CliOutputAdapter implements OutputAdapter {
      constructor(params: { style?: 'classic' | 'interactive' });
      processEvent(event: RuntimeEvent): DisplayEvent;
    }
    // Pure transformation, no side effects

src/adapters/tui-output-adapter.ts (NEW):
  - class TuiOutputAdapter implements OutputAdapter {
      processEvent(event: RuntimeEvent): DisplayEvent;
    }
    // Pure transformation, no side effects
```

**What it consolidates:**
- Event rendering logic from `terminal-renderer.ts` (CLI side)
- Event processing logic from `useRuntimeEvents.ts` (TUI side)
- Both implement the same RuntimeEvent -> DisplayEvent transformation

**Test strategy:**
- Unit test: Each RuntimeEvent type maps to correct DisplayEvent
- Unit test: processEvent() is pure (no side effects)
- Unit test: All RuntimeEvent types are handled (exhaustive switch)
- Unit test: Unknown event type throws error

**Risk**: Medium. DisplayEvent type needs careful design to cover all cases while remaining adapter-friendly.

**Rollback**: Delete adapter files.

---

### PR 5: Migrate CLI to Use Shared Components

**Goal**: Refactor `src/commands/chat.ts` to use RuntimeEnvironment, InputAdapter, and OutputAdapter, replacing inline initialization and event rendering.

**Files to modify:**
- `src/commands/chat.ts` - Use RuntimeEnvironment + adapters
- `src/ui/readline-input.ts` - Refactor to delegate to CliInputAdapter (or deprecate)
- `src/ui/terminal-renderer.ts` - Refactor to delegate to CliOutputAdapter (or keep as rendering layer)

**Files to create:**
- `test/commands/chat-unified.test.ts` - Integration tests

**Changes:**
```
src/commands/chat.ts:
  - Import and use initializeRuntime()
  - Import and use CliInputAdapter
  - Import and use CliOutputAdapter
  - Remove inline provider/session/tool/skill initialization
  - Simplify runChatSession() to:
      1. initializeRuntime(settings)
      2. new CliInputAdapter(...)
      3. new CliOutputAdapter(...)
      4. runAgentLoop({ input$: adapter.input$, ... })
      5. Subscribe to events$, pipe through outputAdapter
  - Maintain backward compatibility: all existing CLI flags still work
```

**What it simplifies:**
- `chat.ts` reduces from ~285 lines to ~150 lines
- Removes duplicate initialization code
- `runChatSession()` becomes a clean composition of adapters + runAgentLoop

**Test strategy:**
- Integration test: `chat --message "hello"` still works end-to-end
- Integration test: Interactive mode still works
- Integration test: Stdin pipe mode still works
- Integration test: `--role`, `--provider`, `--debug` flags still work
- Integration test: Local commands (/help, /tools, /clear, /exit, /skills) still work
- Regression test: Existing CLI test suite passes unchanged

**Risk**: Medium. This is the first migration PR. If adapters have bugs, CLI breaks.

**Rollback**: Revert `chat.ts` changes. Adapter files remain (no harm).

---

### PR 6: Migrate TUI to Use Shared Components

**Goal**: Refactor TUI hooks to use RuntimeEnvironment, InputAdapter, and OutputAdapter.

**Files to modify:**
- `src/tui/hooks/useRuntime.ts` - Use RuntimeEnvironment
- `src/tui/hooks/useRuntimeEvents.ts` - Use TuiOutputAdapter
- `src/tui/hooks/useUserInput.ts` - Use TuiInputAdapter (or replace with adapter)
- `src/tui/types.ts` - Update TuiRuntimeEnvironment to use adapters

**Files to create:**
- `src/tui/hooks/useRuntime.test.tsx` - Hook tests

**Changes:**
```
src/tui/hooks/useRuntime.ts:
  - Import and use initializeRuntime()
  - Remove duplicated initialization code
  - Keep session creation (TUI needs explicit session control)
  - Return adapter instances in TuiRuntimeEnvironment

src/tui/hooks/useRuntimeEvents.ts:
  - Import and use TuiOutputAdapter
  - processRuntimeEvent() delegates to adapter.processEvent()
  - Simplify event processing logic

src/tui/hooks/useUserInput.ts:
  - Import and use TuiInputAdapter
  - sendMessage() calls adapter.send()
  - Or: replace with adapter directly in App.tsx

src/tui/types.ts:
  - Update TuiRuntimeEnvironment to include adapters
```

**What it fixes:**
- TUI gets SkillExecutor support (currently missing)
- TUI gets role support (currently hardcoded to undefined)
- TUI initializes i18n consistently with CLI
- TUI and CLI share the same initialization path

**Test strategy:**
- Unit test: TUI runtime context initializes all fields
- Unit test: TuiInputAdapter sends messages correctly
- Unit test: TuiOutputAdapter processes events correctly
- Integration test: TUI startup still works end-to-end
- Regression test: TUI pages (session, debug, config) render correctly

**Risk**: Medium. TUI uses React/Ink which is harder to test. Need to verify hooks still work correctly with adapter pattern.

**Rollback**: Revert hook changes. Adapter files remain.

---

### PR 7: Add /skills to TUI + Unify Local Command UX

**Goal**: TUI gets /skills command support (currently CLI-only), and both surfaces handle local commands uniformly.

**Files to modify:**
- `src/tui/hooks/useRuntime.ts` - Pass skillExecutor to TuiInputAdapter
- `src/tui/hooks/useUserInput.ts` - Handle /skills, /help via executeLocalCommand()
- `src/tui/components/session/InputBar.tsx` - Show skills help output

**Files to create:**
- `src/tui/hooks/useLocalCommands.ts` (NEW) - TUI local command handling hook

**Changes:**
```
src/tui/hooks/useLocalCommands.ts (NEW):
  - Hook that provides executeLocalCommand() for TUI
  - Routes command output to TUI display area

src/tui/hooks/useUserInput.ts:
  - Before sending to input$, check executeLocalCommand()
  - If handled, display output in message list
  - If not handled, send to runtime as ChatInputTurn

src/tui/components/session/InputBar.tsx:
  - Add /skills autocomplete or hint
```

**What it adds:**
- TUI `/skills` command support
- TUI `/help` command (currently only keyboard shortcut `h`)
- Uniform local command handling via shared `executeLocalCommand()`

**Test strategy:**
- Unit test: /skills command works in TUI
- Unit test: /help command works in TUI
- Unit test: Local commands don't leak to runtime
- Manual test: TUI shows skills list correctly

**Risk**: Low. Additive feature, no breaking changes.

**Rollback**: Remove useLocalCommands hook, revert useUserInput changes.

---

## Implementation Order and Dependencies

```
PR 1: RuntimeEnvironment (foundation)
  |
  +-- PR 2: executeLocalCommand (can parallel with PR 1)
  |
  +-- PR 3: InputAdapter interface (depends on PR 2 for LocalCommandResult)
  |
  +-- PR 4: OutputAdapter + DisplayEvent (independent)
  |
  +--- PR 5: Migrate CLI (depends on PR 1, 3, 4)
  |
  +--- PR 6: Migrate TUI (depends on PR 1, 3, 4)
  |
  +--- PR 7: TUI local commands (depends on PR 2, 6)
```

**Parallelization opportunities:**
- PR 1, PR 2, PR 4 can be developed in parallel (no dependencies on each other)
- PR 3 depends on PR 2 (LocalCommandResult type)
- PR 5 and PR 6 can be developed in parallel after PR 1, 3, 4 are done
- PR 7 depends on PR 2 and PR 6

**Estimated PR sizes:**
| PR | Files Changed | Lines +/- | Risk |
|----|--------------|-----------|------|
| PR 1 | +2 files | ~150 lines | Low |
| PR 2 | +2 files | ~100 lines | Low |
| PR 3 | +5 files | ~300 lines | Low |
| PR 4 | +5 files | ~250 lines | Medium |
| PR 5 | ~3 files modified | ~-200 lines net | Medium |
| PR 6 | ~4 files modified | ~-150 lines net | Medium |
| PR 7 | +1 file, ~3 modified | ~150 lines | Low |

---

## Risk Points and Rollback Strategy

### Risk 1: Adapter Interface Design Mismatch
**Risk**: The `InputAdapter` / `OutputAdapter` interfaces might not cover all edge cases discovered during migration.
**Mitigation**: PR 3 and PR 4 are pure additions. If interfaces need refinement, only adapter implementations change, not the consumers.
**Rollback**: Revert adapter files, both CLI and TUI revert to current inline code.

### Risk 2: Session Creation Timing
**Risk**: TUI creates session explicitly before `runAgentLoop()`, while CLI lets `runAgentLoop()` create it. `initializeRuntime()` needs to handle both patterns.
**Mitigation**: `initializeRuntime()` does NOT create sessions -- it only initializes infrastructure. Session creation remains caller responsibility.
**Rollback**: N/A (design decision, not a code risk).

### Risk 3: React/Ink Compatibility
**Risk**: TUI uses React hooks. Adapters designed for imperative code might not integrate cleanly with React's declarative model.
**Mitigation**: TuiOutputAdapter is a pure function (`processEvent -> DisplayEvent`). The React hook still calls `setState()` -- the adapter just transforms the data.
**Rollback**: Revert TUI adapter usage, keep CLI migration.

### Risk 4: Breaking Existing Test Suite
**Risk**: No existing unit tests were found (test directory has integration/process-level tests only). Changes to chat.ts or TUI hooks might break process-level smoke tests.
**Mitigation**: Each migration PR includes regression tests. Run full test suite before merging.
**Rollback**: Revert the specific migration PR.

### Risk 5: SkillExecutor Gap
**Risk**: TUI currently does NOT create SkillExecutor. Adding it in PR 1/6 might surface bugs if TUI wasn't designed to handle skill commands.
**Mitigation**: PR 7 explicitly adds /skills support to TUI. Before PR 7, SkillExecutor exists but is not exposed to TUI users.
**Rollback**: Remove SkillExecutor from TUI RuntimeEnvironment.

---

## Rollback Strategy Summary

| Scenario | Action |
|----------|--------|
| Any PR breaks functionality | Revert that specific PR (all are independent additions or incremental migrations) |
| Adapter interface needs redesign | Revert PR 3/4, redesign, re-create |
| Migration breaks CLI | Revert PR 5 (CLI goes back to inline code) |
| Migration breaks TUI | Revert PR 6 (TUI goes back to inline code) |
| Full rollback needed | Revert PRs 5, 6, 7 in reverse order (migrations first, then interfaces, then shared logic) |

**Key safety property**: PRs 1-4 are pure additions (new files only). They cannot break existing code. Only PRs 5-7 modify existing files and carry migration risk.
