# Plan Agent CLI Architecture

## Goal

Evolve the current CLI prototype toward an intelligent-agent CLI in the style of modern coding assistants, while keeping the implementation grounded in general industry practice and the project's explicit preference for RxJS-based stream processing wherever the problem is naturally stream-shaped.

## What I already know

* The repository already has a runnable Node + TypeScript CLI scaffold with Commander.
* Git is initialized and the current branch is `main`.
* `rxjs` is already installed and used in the current `chat` prototype.
* Current code layout:
  * `src/cli.ts`
  * `src/commands/`
  * `src/chat/`
  * `bin/`
  * `test/`
* The current `chat` command only implements a local RxJS input → reply demo; it is not yet a real agent runtime.
* The user wants a CLI closer to tools like Claude Code / agent CLIs.
* The user explicitly wants a project rule: if a workflow can naturally be modeled as an RxJS stream, prefer RxJS.

## Assumptions (temporary)

* The next step should prioritize architecture and conventions, not a full provider integration yet.
* The CLI should remain TypeScript-first and terminal-first.
* RxJS should be a default abstraction for event streams, turn streams, tool-result streams, and UI render streams, but not a reason to force every pure function into an Observable.

## Open Questions

* None for this planning pass; proceed with a baseline architecture proposal and spec update.

## Requirements

* Analyze the current prototype against a real agent-CLI target shape.
* Record an explicit RxJS-first stream-processing rule in Trellis backend spec.
* Produce a practical project-structure plan for evolving the current CLI into an agent CLI.
* Keep the plan aligned with general common practice for agent CLIs:
  * CLI shell
  * agent runtime loop
  * provider abstraction
  * tool layer
  * session/memory layer
  * optional MCP integration layer
* Keep the proposal incremental so implementation can proceed in phases.

## Acceptance Criteria

* [x] Trellis backend spec explicitly states the RxJS-first rule for natural stream workflows.
* [x] The current repo state and the target agent-CLI state are both documented.
* [x] A proposed directory structure exists for the next phase of implementation.
* [x] The proposal includes phased implementation priorities instead of only a final-state diagram.

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope

* Full provider integration in this planning task
* Building tool execution, MCP clients, or session persistence in this task
* Replacing the existing CLI scaffold

## Research Notes

### Common-practice shape for agent CLIs

Modern agent CLIs usually separate:

* terminal command parsing and rendering
* the agent loop / runtime state machine
* provider-specific model calls
* tool execution and permission gating
* session storage and resume
* extension or MCP boundaries

### Why RxJS fits this repo

RxJS is a good fit for:

* user input streams
* streamed model output
* tool-call event streams
* UI render streams
* cancellation / timeout / backpressure boundaries

RxJS is a poor fit when:

* the logic is just a simple deterministic pure transform with no asynchronous or event-stream value
* using Observables would obscure a simpler domain model

## Technical Approach

* Update Trellis backend spec to encode the RxJS-first rule and the expected separation between command modules and stream-processing/runtime modules.
* Produce a planning artifact that maps:
  * current structure
  * target structure
  * phased migration path

## Deliverables

* `.trellis/spec/backend/index.md`
* `.trellis/spec/backend/directory-structure.md`
* `.trellis/spec/backend/quality-guidelines.md`
* `.trellis/tasks/05-23-plan-agent-cli-architecture/research/agent-cli-common-practice.md`
* `.trellis/tasks/05-23-plan-agent-cli-architecture/info.md`
* `docs/README.md`
* `docs/architecture/agent-cli.md`
* `docs/project-structure.md`
* `docs/implementation/phase-1-agent-runtime.md`
* `src/runtime/README.md`
* `src/providers/README.md`
* `src/tools/README.md`
* `src/ui/README.md`
* `src/mcp/README.md`
* `README.md`

## Technical Notes

* Official references to use for planning:
  * Anthropic Claude Code overview: `https://code.claude.com/docs/en/overview`
  * Anthropic CLI usage: `https://code.claude.com/docs/en/cli-usage`
  * Anthropic Agent SDK overview: `https://code.claude.com/docs/en/agent-sdk/overview`
  * OpenAI tools guide: `https://platform.openai.com/docs/guides/tools`
  * MCP introduction: `https://modelcontextprotocol.io/docs/getting-started/intro`
* Local files inspected for current-state analysis:
  * `package.json`
  * `README.md`
  * `src/cli.ts`
  * `src/commands/chat.ts`
  * `src/chat/reply-pipeline.ts`
  * `test/cli.test.js`

## Verification

* `python3 ./.trellis/scripts/task.py validate 05-23-plan-agent-cli-architecture`
* `rg -n "RxJS|stream-shaped|Observable|agent runtime|provider abstraction|MCP" .trellis/spec/backend .trellis/tasks/05-23-plan-agent-cli-architecture`
* `npm run check`
* `rg -n "Architecture|Project Structure|Phase 1|RxJS|docs/" README.md docs .trellis/spec/backend`

## Notes

* This task intentionally updates spec, repository docs, and directory scaffolding only; it does not yet introduce provider code, tool runtime code, or session persistence code.
* Placeholder `README.md` files under `src/runtime/`, `src/providers/`, `src/tools/`, `src/ui/`, and `src/mcp/` are deliberate ownership markers for the next implementation phase.
