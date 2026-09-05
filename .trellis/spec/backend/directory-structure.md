# Directory Structure

> Current status / 当前状态: a minimal Node CLI directory structure is now established in this workspace.

---

## Observed State / 已观察到的状态

- Source entrypoint lives at `src/cli.ts`.
- Subcommands live under `src/commands/`.
- Reusable input/reply stream logic lives under `src/chat/`.
- Configuration loading and `.rxc` path rules live under `src/config/`.
- Runtime target resolution for provider/model/role also lives under `src/config/`.
- Runtime, provider, tool, UI, and MCP boundaries now have dedicated top-level folders under `src/`.
- Phase 1 runtime code currently lives in `src/runtime/`, `src/providers/`, and `src/ui/`.
- Provider resolution now has a dedicated registry file at `src/providers/provider-registry.ts`.
- Phase 2 tool runtime skeleton now lives in `src/tools/` and `src/runtime/permission-gate.ts` / `src/runtime/tool-dispatch.ts`.
- Logger subsystem lives in `src/core/logger/` (types, log-bus, sinks, redactor, rotation). Contract: `.trellis/spec/backend/logging-guidelines.md`.
- CommandRegistry lives in `src/core/shared/command-{types,registry,registry-builtin,handlers}.ts`. Single source of truth for `/xxx` slash commands. Contract: `.trellis/spec/backend/command-registry.md`.
- Agent loop entry points share assembly in `src/core/shared/run-agent-helpers.ts` (`startAgentLoop` / `attachDebugTrace` / `stopRuntimeAgents`). Contract: `runtime-contracts.md` §runAgentLoop 调用收敛. Do not hand-assemble the 13 `runAgentLoop` params at call sites.
- Settings loading is split by concern (all pure functions, `load-settings.ts` keeps only `parseSettings` + `loadWastelandSettings` facade):
  - `src/config/validate-settings.ts` — 7 `validate*` schema validators + `isRecord` guard, no IO.
  - `src/config/settings-merge.ts` — `expandRoleReferences` + `mergeSettings` (user/project/env priority merge).
  - `src/config/settings-env-auth.ts` — `WASTELAND_*` env overrides + `{ $auth }` ref resolution.
- Repository-level architecture and implementation docs live under `docs/`.
- The executable wrapper lives under `bin/`.
- Smoke tests live under `test/`.
- Session transcripts are persisted under `.wasteland/sessions/` by default.
- Runtime logs are persisted under `.wasteland/logs/` (sink: `src/core/logger/file-sink.ts`). Cross-artifact join contract with session transcripts: see `logging-guidelines.md §14`.
- Compiled output is emitted to `dist/` and should be treated as generated files.

## Directory Layout / 目录结构

```text
bin/            Executable wrapper
docs/           Architecture and implementation docs
examples/       Manual/debug scripts (moved out of scripts/: multi-agent, streaming, verify-init demos)
src/            TypeScript CLI source
src/cli.ts      CLI entry point
src/commands/   Subcommands
src/core/       Core layer (all core logic)
  runtime/      Agent runtime core
  shared/       Shared business logic (incl. run-agent-helpers.ts: shared loop assembly)
  adapters/     Adapter interfaces
src/config/     Config loading and path rules (load-settings.ts facade + validate/merge/env-auth modules)
src/providers/  Provider layer
src/tools/      Built-in tools layer
src/ui/         Terminal UI layer
src/tui/        TUI (React/Ink, incl. hooks/runtime-reducers/: 4-domain event reducers)
src/skills/     Skills system
src/locales/    i18n
src/prompts/    Prompt system
src/skins/      Skin system
scripts/        Build/check/completion scripts only (no manual demos)
test/           Smoke tests
dist/           Generated build output
```

---

## Conventions / 当前约定

- Keep the root Commander program in `src/cli.ts`.
- Add each subcommand as its own module under `src/commands/`.
- Keep reusable chat/runtime stream logic out of command modules; place it under a focused support folder such as `src/chat/`.
- If a concern is fundamentally stream-based, give it a dedicated runtime/support folder instead of embedding the full flow inside a command handler.
- Keep architecture and implementation guidance in `docs/`, not only in scattered README fragments or task notes.
- Keep `bin/` thin: it should only bootstrap the built CLI.
- Do not edit `dist/` manually; regenerate it through the build script.

---

## Naming Conventions / 命名约定

- Use lowercase filenames for command modules, matching the command name when practical.
- Reserve `cli.ts` for the root program entry.
- Name the executable wrapper after the published CLI command.
- For RxJS-heavy runtime areas, prefer folder names that describe the domain boundary (`chat/`, `runtime/`, `providers/`, `tools/`) rather than generic names like `utils/`.

---

## Examples / 例子

- `src/cli.ts`
- `src/commands/hello.ts`
- `src/commands/chat.ts`
- `src/chat/reply-pipeline.ts`
- `src/config/load-settings.ts`
- `src/config/resolve-chat-runtime.ts`
- `src/runtime/agent-loop.ts`
- `src/runtime/tool-dispatch.ts`
- `src/providers/local.ts`
- `src/providers/provider-registry.ts`
- `src/tools/tool-types.ts`
- `src/ui/terminal-renderer.ts`
- `docs/architecture/agent-cli.md`
- `docs/project-structure.md`
- `bin/rxc.js`
