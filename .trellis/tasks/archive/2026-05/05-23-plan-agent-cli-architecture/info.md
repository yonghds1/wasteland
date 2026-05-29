# Agent CLI Architecture Plan

## Intent

Turn the current CLI prototype into an intelligent-agent CLI by evolving the shell, runtime, provider, tool, and session layers separately instead of growing everything inside `src/commands/chat.ts`.

## Current State

The repository currently has:

- a TypeScript CLI shell in `src/cli.ts`
- command handlers in `src/commands/`
- an RxJS-based input/reply prototype in `src/chat/`
- a thin executable wrapper in `bin/`
- process-level smoke tests in `test/`

This is a valid starting point for a CLI, but it is still far from a true agent runtime.

## Target Shape

The next architecture should separate these layers:

1. CLI shell
2. terminal UI and input streams
3. agent runtime loop
4. provider adapters
5. tool execution and permission gating
6. session persistence / resume
7. optional MCP integration

## Proposed Directory Structure

```text
bin/
  rx-cli.js

src/
  cli.ts
  commands/
    chat.ts
    run.ts
    resume.ts
    sessions.ts
    config.ts
    mcp.ts
  runtime/
    agent-loop.ts
    event-types.ts
    permission-gate.ts
    session-manager.ts
    turn-context.ts
  providers/
    anthropic.ts
    openai.ts
    provider-types.ts
  tools/
    bash.ts
    read-file.ts
    edit-file.ts
    git.ts
    tool-types.ts
  mcp/
    client.ts
    registry.ts
  ui/
    terminal-renderer.ts
    readline-input.ts
  chat/
    reply-pipeline.ts

test/
  cli.test.js
  runtime/
  providers/
  tools/
```

## How To Read This Structure

- `commands/` stays thin: parse args, call runtime, render top-level outcomes.
- `runtime/` owns the turn loop and orchestration.
- `providers/` hides model-specific APIs.
- `tools/` owns execution and permission-aware wrappers.
- `ui/` owns terminal-facing streams and rendering.
- `mcp/` is an integration boundary, not mixed into provider code.
- `chat/` can survive as a transitional area, but more of its logic should eventually move into `runtime/` and `ui/`.

## RxJS-First Rule For This Project

Use RxJS by default when the workflow is naturally stream-shaped:

- terminal input
- streamed model tokens
- tool call / tool result events
- renderer update events
- cancellation, timeout, and interrupt coordination

Do not use RxJS just to wrap simple pure business logic that is clearer as plain functions.

## Phased Implementation Plan

### Phase 1: Real Agent Turn MVP

- keep the current CLI shell
- add a provider abstraction
- turn `chat` into a real provider-backed turn
- support:
  - interactive mode
  - one-shot prompt mode
  - stdin pipe mode
- start a local session transcript format

### Phase 2: Tool Runtime

- add tool event types
- add file read/write tools
- add shell execution
- add git inspection
- add permission modes such as `ask`, `auto`, `deny`

### Phase 3: Session and Resume

- persist sessions locally
- add `resume` and `sessions` commands
- add summary/compaction support for long sessions

### Phase 4: MCP and Extension Boundaries

- add MCP client/registry
- separate built-in tools from external tools
- allow project-level configuration for provider/tool defaults

## Immediate Refactor Direction

The next implementation task should not directly add more logic to `src/commands/chat.ts`.

Instead:

1. keep `chat.ts` as the command entry
2. extract a runtime entry such as `src/runtime/agent-loop.ts`
3. define shared event types
4. move CLI input/output coordination toward `src/ui/`

That path preserves the current scaffold while steering it toward a real agent runtime.
