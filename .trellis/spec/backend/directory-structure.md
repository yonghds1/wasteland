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
- Repository-level architecture and implementation docs live under `docs/`.
- The executable wrapper lives under `bin/`.
- Smoke tests live under `test/`.
- Session transcripts are persisted under `.rxc/sessions/` by default.
- Compiled output is emitted to `dist/` and should be treated as generated files.

## Directory Layout / 目录结构

```text
bin/            Executable wrapper
docs/           Architecture and implementation docs
src/            TypeScript CLI source
src/cli.ts      CLI entry point
src/commands/   Subcommands
src/core/       Core layer (all core logic)
  runtime/      Agent runtime core
  shared/       Shared business logic
  adapters/     Adapter interfaces
src/config/     Config loading and path rules
src/providers/  Provider layer
src/tools/      Built-in tools layer
src/ui/         Terminal UI layer
src/tui/        TUI (React/Ink)
src/skills/     Skills system
src/locales/    i18n
src/prompts/    Prompt system
src/skins/      Skin system
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
