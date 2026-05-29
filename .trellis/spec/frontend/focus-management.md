# TUI Focus Management System

## 1. Scope / Trigger
- **Trigger**: Implemented a flat focus management model for the TUI to resolve keyboard event contention between input modes and content interaction (e.g., scrolling while in "input mode").

## 2. Signatures (State & Types)

### FocusArea Type
```typescript
export type FocusArea =
  | "header"       // Top Tab cards
  | "agentTree"    // Left Agent tree
  | "messageList"  // Right Message list
  | "inputBar"     // Bottom Input bar
  | "traceLog"     // Debug page log list
  | "configList"   // Config page settings list
  | null;          // No active focus
```

### AppState Integration
```typescript
export interface AppState {
  currentPage: PageName;
  focusArea: FocusArea;
  inputMode: boolean;
  // ... rest of state
}
```

## 3. Contracts (Behaviors)

### Focus Order by Page
| Page | Focus Cycle (Tab / Shift+Tab) |
|------|-------------------------------|
| `session` | `header` -> `agentTree` -> `messageList` -> `inputBar` |
| `debug` | `header` -> `traceLog` |
| `config` | `header` -> `configList` |

### Key Bindings Contract
| Key | Context | Behavior |
|-----|---------|----------|
| `Tab` | Global | Move to next `FocusArea` in current page order |
| `Shift+Tab` | Global | Move to previous `FocusArea` |
| `Esc` | Focused | Clear focus (`focusArea: null`) |
| `Esc` | `inputMode` | Exit input mode |
| `←`/`→` | `focusArea: "header"` | Switch `currentPage` |
| `↑`/`↓` | `focusArea: "messageList"` | Scroll messages |
| `↑`/`↓` | `focusArea: "traceLog"` | Scroll logs |
| `↑`/`↓` | `focusArea: "configList"` | Switch active config section |
| `Ctrl+Enter` | Session Page | Set `focusArea: "inputBar"` AND `inputMode: true` |
| `Enter` | `focusArea: "inputBar"` | Set `inputMode: true` |

## 4. Validation & Error Matrix
| Scenario | Condition | Behavior |
|----------|-----------|----------|
| **Focus Shift** | Switching `focusArea` away from `inputBar` | Automatically set `inputMode: false` |
| **Page Change** | Switching `currentPage` | Automatically reset `focusArea` to `"header"` |
| **No Focus** | `focusArea: null` | `Tab` sets focus to `"header"` |

## 5. Visual Standards (Aesthetics)
- **Focused Area**: Border color MUST be `cyan`.
- **Unfocused Area**: Border color MUST be `gray`.
- **Hints**: When `inputBar` is focused but NOT in `inputMode`, display "Ctrl+Enter to type" hint.

## 6. Implementation Pattern (Example)

### Controlled Interaction
Components MUST check `focusArea` before responding to local keyboard events.

```typescript
// Good: Gated by focusArea
useInput((input, key) => {
  if (state.focusArea !== "traceLog") return;
  
  if (key.upArrow) scrollUp();
  if (key.downArrow) scrollDown();
});
```

### Consistent Bordering
```typescript
<Box
  borderStyle="round"
  borderColor={state.focusArea === "agentTree" ? "cyan" : "gray"}
>
  {/* Content */}
</Box>
```

## 7. Wrong vs Correct

### Wrong
Directly toggling global mode based on a single key without considering the currently interacted area.
```typescript
useInput((input, key) => {
  if (input === 'i') setInputMode(true); // Ambiguous: which area are we focusing?
});
```

### Correct
Using `focusArea` as the source of truth for interaction intent.
```typescript
useInput((input, key) => {
  if (state.focusArea === 'inputBar' && key.return) {
    setInputMode(true);
  }
});
```
