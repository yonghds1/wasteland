# TUI Focus Management System

## 1. Scope / Trigger
- **Trigger**: Flat focus management model for the TUI that resolves keyboard event contention between input modes and content interaction (e.g., scrolling while in "input mode"). Source-of-truth for what each `FocusArea` means and how the cycle is composed.

## 2. Signatures (State & Types)

### FocusArea Type (current)

```typescript
// src/tui/context/AppContext.tsx:14-21
export type FocusArea =
  | 'messageList'   // DEPRECATED — kept for type compatibility only
  | 'header'
  | 'agentTree'     // DEPRECATED — never implemented
  | 'inputBar'      // Bottom input bar (live, primary)
  | 'traceLog'
  | 'configList'
  | 'agentTabs'     // Top AgentTabs row (live, primary)
  | null;
```

> **Note**: Some FocusArea members are reserved types that no current component claims. They exist for legacy compatibility. Work Item E (cleanup) will prune them. Do not add new components that claim `agentTree` / `messageList` / `traceLog` / `configList` — these are dead-state traps.

### AppState Integration

```typescript
// src/tui/context/AppContext.tsx:77-128
export interface AppState {
  currentPage: PageName;
  focusArea: FocusArea;
  inputMode: boolean;
  viewFilter?: string;  // NEW (07-30): agentId, undefined = show all
  showHelp: HelpView | null;  // NEW (07-30-help-dialog-mode)
  // ...
}

// NEW (07-30-help-dialog-mode)
export type HelpView = 'shortcuts' | 'commands';
```

## 3. Contracts (Behaviors)

### Focus Order by Page (current, verified)

| Page | Focus Cycle (Tab / Shift+Tab) | File |
|------|-------------------------------|------|
| `session` | `inputBar` ↔ `agentTabs` (2 elements) | `src/tui/App.tsx:336` |
| `debug` | (no interactive focus — page not implemented) | — |
| `config` | (no interactive focus — page not implemented) | — |
| `sessions` | (no interactive focus — only SessionIndexPage) | — |
| `logs` | (no interactive focus — only LogsPage) | — |

### Convention: Tab cycle members MUST handle keyboard input

> **Why**: `focusArea` exists to gate `useInput` on a per-component basis. A member that has no `useInput` is a dead state — focus lands there and the user can do nothing.

**Rules**:
1. Every element in a page's `focusCycle` MUST correspond to a component that calls `useInput` and short-circuits when `focusArea !== <self>`.
2. Pure display components (e.g. `ChatMessageList`) MUST NOT appear in any `focusCycle`. The previous design put `messageList` in `session` cycle and the focus landed on a no-op — removed in 07-30.

### Convention: Help dialog state (07-30-help-dialog-mode)

`state.showHelp: HelpView | null` controls which help dialog is open. The two triggers MUST converge to the same close logic.

**Rules**:
- `?` key → `setShowHelp('shortcuts')` — `src/tui/App.tsx:308`
- `/help` command → `setShowHelp('commands')` (via `action === 'help'` from `executeLocalCommand`) — `src/tui/App.tsx:222`
- Both `Esc` and `h` → `setShowHelp(null)` (close) — `src/tui/App.tsx:284-289`
- `setShowHelp` accepts `'shortcuts' | 'commands' | null` (no boolean — preserves the view type)
- `ChatArea.tsx` renders the correct dialog component based on `state.showHelp` value, hiding the message list and input bar while a dialog is open
- The `/help` handler returns **only** `{ action: 'help' }` (no `output`) — the dialog component renders content. CLI adapter must render the help text to stdout when it sees `action === 'help'` (see `cli-tui-contracts.md`).

**Why a typed union over a boolean**: a boolean cannot distinguish "which dialog is open". A typed union enforces at compile time that callers handle each view explicitly.

### Key Bindings Contract (current)

| Key | Context | Behavior | File |
|-----|---------|----------|------|
| `Tab` / `Shift+Tab` | Global | Cycle `focusArea` through `focusCycle[currentPage]` | `App.tsx:317-345` |
| `Esc` | `focusArea === 'inputBar'` (inputMode=true) | → `focusArea: 'agentTabs'`, `inputMode: false` (bidirectional toggle) | `App.tsx:286-295` |
| `Esc` | `focusArea === 'agentTabs'` | → `focusArea: 'inputBar'`, `inputMode: true` (bidirectional toggle) | `App.tsx:286-295` |
| `Esc` | Other | Pass-through (page-local logic) | per-page |
| `←` / `→` | `focusArea: 'agentTabs'` | Cycle selected tab; viewport auto-scrolls to keep selection visible | `AgentTabs.tsx` useInput |
| `Enter` | `focusArea: 'agentTabs'` | Select current tab → `setViewFilter(tab.isMain ? undefined : tab.id)` | `AgentTabs.tsx` useInput |
| `Enter` | `inputMode: false` (any focusArea) | → `focusArea: 'inputBar'`, `inputMode: true` | `App.tsx:323-327` |
| `T` | Global | Cycle `currentPage` through `['session', 'sessions', 'logs']` | `App.tsx:298-306` |
| `?` | any | Set `showHelp: 'shortcuts'` (open shortcuts dialog) | `src/tui/App.tsx:308` |
| `/help` action | `action === 'help'` from `executeLocalCommand` | Set `showHelp: 'commands'` (open commands dialog) | `src/tui/App.tsx:222` |
| `Esc` / `h` | `state.showHelp !== null` | Set `showHelp: null` (close dialog) | `src/tui/App.tsx:284-289` |

### Convention: Esc is bidirectional toggle between active areas, not "exit to dead state"

> **Why**: The legacy behavior was `Esc from inputBar → focusArea: null`, which left the user stranded. The user had to press `Tab` or `Enter` to recover. The 07-30 redesign makes Esc ping-pong between the two active focus areas.

**Rules**:
1. If there are exactly 2 interactive focus areas on the current page, Esc MUST toggle between them.
2. Esc MUST NOT set `focusArea: null` unless no other interactive area exists on the page.
3. Esc MUST NOT clear filter state (e.g. `viewFilter`) — see `state-management.md` §viewFilter.

## 4. Validation & Error Matrix

| Scenario | Condition | Behavior |
|----------|-----------|----------|
| **Focus Shift** | Switching `focusArea` away from `inputBar` | Automatically set `inputMode: false` (`App.tsx:338-342`) |
| **Focus Shift to inputBar** | Switching `focusArea` to `'inputBar'` | Automatically set `inputMode: true` (`App.tsx:338-342`) |
| **Page Change** | Switching `currentPage` | Reset `focusArea` to first element of new page's cycle |
| **No active interactive area** | All cycle elements are dead types | Esc MUST route to a known-good area, not null |

## 5. Design Decisions

### Decision: Two-element Tab cycle over three-plus (07-30)

**Context**: Original design had `session` cycle = `['messageList', 'agentTree', 'inputBar']` (4 elements). Implementation reality was 2 (`['messageList', 'inputBar']`). `messageList` was a dead state — no `useInput` consumed focus on it.

**Options considered**:
1. Keep 4 elements, add `useInput` to `ChatMessageList` (e.g. for selection/scroll) — over-engineering for a passive display.
2. Remove dead members, expand live components — `agentTabs` was already designed as an interactive top-bar component.
3. (Chosen) Two-element cycle: `['inputBar', 'agentTabs']` — both are genuinely interactive, Esc toggles between them.

**Decision**: Option 3. Two-element cycle with Esc bidirectional toggle. Dead-state members removed from cycle (but kept in type union for compatibility — Work Item E cleans up).

**Extensibility**: Adding a third interactive area in the future means composing a 3-element cycle. Until then, resist the temptation to add `messageList` or similar — it will rot.

### Decision: Esc bidirectional toggle (07-30)

**Context**: Original Esc semantics `inputBar → Esc → focusArea: null` stranded users.

**Decision**: Esc toggles between the two interactive areas in current page's cycle. Input mode and focus area become two facets of the same state machine.

**Why**: Single-key recovery from any state. Matches vim/less expectations.

## 6. Implementation Pattern (Example)

### Controlled Interaction (useInput gating)

```typescript
// Good: Gated by focusArea (see AgentTabs.tsx useInput)
useInput((input, key) => {
  if (state.focusArea !== 'agentTabs') return;
  if (key.leftArrow) setSelectedIdx(i => Math.max(0, i - 1));
  if (key.rightArrow) setSelectedIdx(i => Math.min(tabs.length - 1, i + 1));
  if (key.return) setViewFilter(selectTabViewFilter(tabs[selectedIdx]));
  if (key.escape) {
    setFocusArea('inputBar');
    setInputMode(true);
  }
});
```

### Extracting pure functions for testability

```typescript
// Good: Pure helpers exported from component module, unit-tested independently
// (see AgentTabs.tsx)
export function buildTabs(agents: ReadonlyArray<AgentNode>): AgentTab[] {
  return [
    { id: 'main', name: 'Main', status: 'running', isMain: true },
    ...agents.filter(a => a.depth >= 0).map(a => ({ id: a.id, ... })),
  ];
}

export function selectTabViewFilter(tab: AgentTab): string | undefined {
  return tab.isMain ? undefined : tab.id;
}
```

> **Why**: useInput bodies are not directly testable in vitest (require Ink test renderer). Extracting the decision logic as pure functions lets the test suite verify all branches without rendering. See `quality-guidelines.md` §Pure-function extraction.

## 7. Wrong vs Correct

### Wrong: Dead state in Tab cycle

```typescript
// Don't: focusCycle has 'messageList' but ChatMessageList has no useInput
const focusCycle = { session: ['messageList', 'inputBar'] };
// User Tab → messageList → can't do anything → confusion
```

### Correct: All cycle members are interactive

```typescript
// Do: Every element has a useInput that handles its own keys
const focusCycle = { session: ['inputBar', 'agentTabs'] };
// Tab → agentTabs (handles ←/→/Enter/Esc)
// Tab → inputBar (ChatInputBar handles text input + Enter/Esc)
```

### Wrong: Esc exits to null

```typescript
// Don't: Esc from inputBar leaves focusArea null with no recovery hint
if (key.escape && state.inputMode) {
  setInputMode(false);
  setFocusArea(null);  // User is stranded
}
```

### Correct: Esc bidirectional toggle

```typescript
// Do: Esc ping-pongs between the two interactive areas
if (key.escape) {
  if (state.focusArea === 'inputBar') {
    setFocusArea('agentTabs');
    setInputMode(false);
  } else if (state.focusArea === 'agentTabs') {
    setFocusArea('inputBar');
    setInputMode(true);
  }
}
```