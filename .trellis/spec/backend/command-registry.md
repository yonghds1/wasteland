# CommandRegistry 模式

> 状态: Established (07-30-command-registry)

## 1. Scope / Trigger

**When**: Adding a new slash command (any `/xxx` that the user types in the TUI/CLI input).

**Why this rule exists**: Before 07-30, wasteland's command handling was fragmented across 5 hard-coded sites (see Anti-patterns below). `/help` output drifted from the actual command set; `/sessions` was missing from one site's `LOCAL_COMMANDS`; `/clear` and `/exit` were listed twice with contradictory descriptions. This file documents the single-source-of-truth pattern that fixes it.

## 2. Architecture: Three-Layer Separation

```
┌───────────────────────────────────────────────────────────┐
│ Layer 1: Registry ("what commands exist")                  │
│ - src/core/shared/command-registry.ts                     │
│ - CommandEntry: name / aliases / category / description   │
│ - CommandRegistry: register / get / isCommand / etc.     │
└───────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────┐
│ Layer 2: Handlers ("how to execute")                       │
│ - src/core/shared/command-handlers.ts                     │
│ - commandHandlers: Record<CommandHandlerType, HandlerFn>  │
│ - Each handler returns LocalCommandResult                 │
└───────────────────────────────────────────────────────────┘
                              ↓
┌───────────────────────────────────────────────────────────┐
│ Layer 3: UI ("how to display")                             │
│ - src/skills/skills/help-skill.ts reads registry          │
│ - src/tui/App.tsx dispatches via registry                │
│ - No command string is hard-coded in UI                   │
└───────────────────────────────────────────────────────────┘
```

**Why three layers**:
- Registry: pure data + lookup, no side effects
- Handlers: side effects, no UI concerns
- UI: consumes registry output, never duplicates the source

## 3. Files

| File | Role |
|------|------|
| `src/core/shared/command-types.ts` | Pure type definitions: `CommandCategory`, `CommandHandlerType`, `CommandEntry`, `HelpEntry`, `CommandRegistry` interface |
| `src/core/shared/command-registry.ts` | `CommandRegistryImpl` class + singleton (`getCommandRegistry` / `setCommandRegistry` / `resetCommandRegistry`) + `bootstrapCommandRegistry(reg, skillReg)` |
| `src/core/shared/command-registry-builtin.ts` | `registerBuiltinCommands(reg)` for non-skill commands (`/clear`, `/sessions`, `/logs`, `/exit`, etc.) |
| `src/core/shared/command-handlers.ts` | `commandHandlers` dict + `createHelpText` / `createToolsText` / `createSkillsText` text generators |
| `src/core/shared/command-registry.test.ts` | Unit tests for all registry APIs + bootstrap + singleton injection |
| `src/core/shared/local-commands.ts` | Router facade (`executeLocalCommand` / `isLocalCommand` / `isExitCommand`) — delegates to registry + handlers |

## 4. Signatures

```ts
// src/core/shared/command-types.ts
export type CommandCategory = 'skill' | 'local' | 'session' | 'exit';

export type CommandHandlerType =
  | 'skill-executor'        // dispatched by SkillExecutor
  | 'route-logs-command'    // dispatched by App.tsx dispatchLogsRoute
  | 'execute-local'         // delegated to commandHandlers['execute-local']
  | 'clear-screen'          // returns { action: 'clear' }
  | 'exit-session'          // returns { action: 'exit' }
  | 'session-list';         // returns { action: 'sessions' }

export interface CommandEntry {
  readonly name: string;               // primary name, must start with '/'
  readonly aliases: readonly string[]; // each must start with '/'
  readonly category: CommandCategory;
  readonly descriptionKey: string;     // i18n key
  readonly handlerType: CommandHandlerType;
  readonly label?: string;             // optional short label
}

export interface CommandRegistry {
  register(entry: CommandEntry): void;
  registerMany(entries: readonly CommandEntry[]): void;
  unregister(name: string): boolean;
  isCommand(input: string): boolean;
  get(nameOrAlias: string): CommandEntry | undefined;
  getAll(): readonly CommandEntry[];
  getByCategory(cat: CommandCategory): readonly CommandEntry[];
  getByHandlerType(ht: CommandHandlerType): readonly CommandEntry[];
  getHelpEntries(): readonly HelpEntry[];
}
```

## 5. Contracts

### Singleton lifecycle

- `getCommandRegistry()` lazily creates the singleton and auto-registers builtins
- `setCommandRegistry(reg)` replaces it (for test injection)
- `resetCommandRegistry()` clears it (for test isolation)
- `bootstrapCommandRegistry(reg, skillReg)` is **idempotent** — skips already-registered names so it can be called multiple times safely

### Normalization

- `get(input)` normalizes: trim → lowercase → strip leading `/`
- `register(entry)` asserts `entry.name.startsWith('/')` and all aliases do too
- `register(entry)` throws on duplicate name OR duplicate alias OR alias-conflicts-with-existing-name

### i18n dependency

- `getHelpEntries()` resolves `entry.descriptionKey` via `t()` — requires `initI18n` to have been called first
- `bootstrapCommandRegistry` must run after `initI18n` (otherwise the registry's help entries are untranslated)

### Handler dispatch

- `executeLocalCommand(params)` looks up the entry, checks its `handlerType`, delegates to `commandHandlers[handlerType]` if applicable
- Returns `{ handled: false }` for `handlerType` ∈ {`'skill-executor'`, `'route-logs-command'`} (these are dispatched elsewhere)
- Returns the handler's result for other `handlerType` values

## 6. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| `register` with `name` not starting with `/` | throws `Command name must start with '/': got '...'` |
| `register` with `name` already registered | throws `Command '...' already registered` |
| `register` with `alias` already used as another alias | throws `Alias '...' already registered to '...'` |
| `register` with `alias` colliding with existing command name | throws `Alias '...' conflicts with existing command name '...'` |
| `isCommand('/foo')` where `/foo` not registered | returns `false` |
| `isCommand('foo')` (no leading slash) | normalizes to `/foo` and looks up |
| `getCommandRegistry()` first call | creates singleton + auto-registers builtins |
| `setCommandRegistry(reg)` then call `getCommandRegistry()` | returns `reg` |
| `resetCommandRegistry()` then call `getCommandRegistry()` | creates fresh singleton + auto-registers builtins |

## 7. Adding a New Command

**Step-by-step**:

1. **Decide the `handlerType`**:
   - Existing command? → reuse its `handlerType`
   - Pure output (text/help/list)? → `'execute-local'` with text generator in `command-handlers.ts`
   - TUI page navigation? → add to `command-handlers.ts` as new `handlerType`
   - Complex routing? → keep as separate handler file, set `handlerType` to its own key

2. **Register** in `src/core/shared/command-registry-builtin.ts`:
   ```ts
   reg.register({
     name: '/mycmd',
     aliases: ['/mc'],
     category: 'local',
     descriptionKey: 'skills.help.localCommands.mycmd',  // add i18n key in en.json + zh.json
     handlerType: 'clear-screen',  // or whatever you chose
   });
   ```

3. **If new `handlerType`**: add to `commandHandlers` in `src/core/shared/command-handlers.ts`:
   ```ts
   'my-handler-type': (params) => ({ handled: true, action: 'whatever' }),
   ```

4. **i18n**: add `descriptionKey` to both `src/locales/en.json` and `src/locales/zh.json`

5. **Test**: add to `command-registry.test.ts` (registration + lookup) and any UI test (e.g., `help-skill.test.ts` for /help output)

## 8. Bootstrap from SkillRegistry

**Single-source-of-truth rule**: Skill commands are NOT hard-coded in `command-registry-builtin.ts`. Instead:

```ts
// src/tui/hooks/useRuntime.ts
initI18n(language);                            // 1. i18n first
const cmdReg = getCommandRegistry();            // 2. singleton (auto-registers builtins)
bootstrapCommandRegistry(cmdReg, skillReg);     // 3. derive skill commands
```

`bootstrapCommandRegistry` iterates `skillReg.list()` and registers each as:
```ts
{
  name: `/${skill.name}`,
  aliases: (skill.aliases ?? []).map(a => `/${a}`),
  category: 'skill',
  descriptionKey: skill.description,
  handlerType: 'skill-executor',
}
```

**Consequence**: adding a new skill to `default-skills.ts` automatically appears in `/help`, dispatch tables, and tests. No second source to update.

**Idempotency**: `bootstrapCommandRegistry` checks `isCommand` before each register, so it's safe to call multiple times. CLI/TUI both call it; the second call is a no-op.

## 9. UI Integration

### /help output (help-skill.ts)

```ts
const reg = getCommandRegistry();
for (const cat of ['skill', 'session', 'local', 'exit'] as const) {
  lines.push(`### ${t(`skills.help.categories.${cat}`)}`);
  for (const entry of reg.getByCategory(cat)) {
    const aliases = entry.aliases.length > 0
      ? `, ${entry.aliases.map(a => `\`${a}\``).join(', ')}`
      : '';
    lines.push(`- \`${entry.name}\`${aliases} - ${t(entry.descriptionKey)}`);
  }
}
```

### /logs dispatch (App.tsx)

```ts
const entry = getCommandRegistry().get(cmd);
if (entry?.handlerType === 'route-logs-command') {
  // delegate to dispatchLogsRoute
}
```

## 10. Tests Required

- `command-registry.test.ts`:
  - `register` / `registerMany` / `unregister`
  - duplicate name / duplicate alias / alias-vs-name collision (each throws)
  - invalid name (no `/` prefix) throws
  - `get` by name / alias / normalize (`/foo` and `foo` and `FOO` all work)
  - `getByCategory` / `getByHandlerType` filtering
  - `getHelpEntries` resolves i18n
  - `setCommandRegistry` / `resetCommandRegistry` for test isolation
  - `bootstrapCommandRegistry` from `SkillRegistry` is idempotent
- `local-commands.test.ts`:
  - `isLocalCommand` / `isExitCommand` use registry (not hard-coded Sets)
  - `executeLocalCommand` returns correct `action` for each `handlerType`
  - `/sessions` is recognized (was missing pre-refactor)
- `help-skill.test.ts`:
  - `/help` output contains all registered commands
  - Adding a new skill via `bootstrapCommandRegistry` makes it appear in `/help` automatically

## 11. Anti-patterns

### Don't: Hard-code command names outside the registry

```ts
// Bad in src/tui/App.tsx
if (cmd === '/clear' || cmd === '/exit') { ... }

// Good
const entry = getCommandRegistry().get(cmd);
if (entry?.category === 'local') { ... }
```

### Don't: Duplicate `LOCAL_COMMANDS` / `EXIT_COMMANDS` Sets

```ts
// Bad (pre-refactor, found in src/ui/readline-input.ts:55,58)
const EXIT_COMMANDS = new Set(['/exit', '/quit']);
const LOCAL_COMMANDS = new Set(['/help', '/tools', '/clear', '/skills']);
//                  ^^^^^^^^^^ missing '/sessions' — silently broken

// Good
import { isExitCommand, isLocalCommand } from '@core/shared/local-commands.js';
```

### Don't: Hard-code command lists in UI / help output

```ts
// Bad in help-skill.ts (pre-refactor)
lines.push(`- \`/clear\` - ${t('skills.help.clearHistory')}`);
lines.push(`- \`/exit\` - ${t('skills.help.exitSession')}`);

// Good
for (const entry of reg.getByCategory('local')) {
  lines.push(`- \`${entry.name}\` - ${t(entry.descriptionKey)}`);
}
```

### Don't: Skip i18n init before `bootstrapCommandRegistry`

```ts
// Bad
const cmdReg = getCommandRegistry();
bootstrapCommandRegistry(cmdReg, skillReg);  // help entries won't be translated
await initI18n(language);  // too late

// Good
await initI18n(language);  // first
const cmdReg = getCommandRegistry();
bootstrapCommandRegistry(cmdReg, skillReg);  // now safe
```

## 12. Common Mistakes

### Symptom: `/help` doesn't list a command
- **Cause**: command was added to `default-skills.ts` but not `bootstrapCommandRegistry`-ed (or skill-registry not bootstrapped)
- **Fix**: verify `useRuntime.ts` calls `bootstrapCommandRegistry` after `initI18n`

### Symptom: `/help` lists a command but pressing it errors
- **Cause**: command's `handlerType` not in `commandHandlers` dict
- **Fix**: add handler in `command-handlers.ts`

### Symptom: Test passes alone but fails in suite
- **Cause**: singleton state leak between tests
- **Fix**: call `resetCommandRegistry()` in `beforeEach`

### Symptom: `register` throws "Alias '...' conflicts with existing command name"
- **Cause**: tried to register a command with an alias that matches another command's name
- **Fix**: choose a different alias, or rename the conflicting command

## 13. Gotchas

> **Warning**: `bootstrapCommandRegistry` must run **after** `initI18n`. Otherwise `getHelpEntries()` returns raw i18n keys instead of translated strings.

> **Warning**: CLI (`src/commands/chat.ts`) does **not** call `bootstrapCommandRegistry` — it uses `SkillExecutor` directly for skill commands and the legacy `createHelpText()` for the CLI `/help`. This is correct: the registry is for TUI input routing + TUI `/help` output. CLI is a separate path.

> **Warning**: `get` normalizes input — `get('CLEAR')` finds `/clear` if registered. This is intentional but means tests should use exact-case names when checking identity.

## 14. Related

- `runtime-contracts.md` — SkillExecutor / RuntimeEvent contracts (upstream of command dispatch)
- `cli-tui-contracts.md` — InputAdapter / OutputAdapter / TUI contracts
- `quality-guidelines.md` — TypeScript / RxJS code-style rules
- `directory-structure.md` — `src/core/shared/` ownership
