# Implement Phase 1 Agent Runtime

## Goal

Implement the Phase 1 runtime skeleton described in the repository docs so the current `chat` command stops owning the full flow itself and instead runs through explicit runtime, provider, UI, and session boundaries.

## What I already know

* The repository already has a working CLI shell in `src/cli.ts`.
* The current `chat` behavior is still a local demo built around `src/chat/reply-pipeline.ts`.
* Repository-level architecture and implementation docs now exist under `docs/`.
* The project rule is RxJS-first for naturally stream-shaped workflows.
* Backend spec now requires architecture/runtime-boundary changes to be reflected in repository docs.

## Assumptions (temporary)

* Phase 1 should preserve the current runnable behavior while moving it behind better boundaries.
* Because no external model provider is configured yet, the first provider adapter should be a local/demo provider that still uses the provider interface.
* Session persistence can start as a local JSONL transcript store with minimal metadata.

## Open Questions

* None for this implementation pass.

## Requirements

* Add a runtime event model.
* Add a runtime entrypoint for the chat flow.
* Add a provider abstraction and one initial provider adapter.
* Add UI boundaries for interactive input and terminal rendering.
* Support one-shot input, stdin pipe input, and interactive input through the same runtime path.
* Add minimal local session transcript persistence.
* Keep `src/commands/chat.ts` thin.
* Keep event-driven paths modeled with RxJS.
* Update docs/spec if actual file ownership or implementation details move.

## Acceptance Criteria

* [x] `chat` no longer owns the full conversation flow.
* [x] `src/runtime/event-types.ts` and a runtime entrypoint exist.
* [x] `src/providers/provider-types.ts` exists and is used by the chat flow.
* [x] Interactive mode and non-interactive mode share the same runtime path.
* [x] Session events are persisted locally in a minimal transcript format.
* [x] Existing CLI checks still pass after the refactor.

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope

* Real Anthropic/OpenAI provider integration
* Tool execution runtime
* MCP client integration
* Resume command or session browser

## Technical Approach

* Introduce:
  * `src/runtime/event-types.ts`
  * `src/runtime/turn-context.ts`
  * `src/runtime/session-manager.ts`
  * `src/runtime/agent-loop.ts`
  * `src/ui/readline-input.ts`
  * `src/ui/terminal-renderer.ts`
  * `src/providers/provider-types.ts`
  * one local provider adapter
* Refactor `src/commands/chat.ts` into a thin command entry.
* Preserve RxJS-based orchestration for input/event/output flow.
* Add transcript persistence under a project-owned hidden directory.

## Technical Notes

* Primary design docs:
  * `docs/architecture/agent-cli.md`
  * `docs/architecture/runtime-boundaries.md`
  * `docs/project-structure.md`
  * `docs/implementation/phase-1-agent-runtime.md`
* Current implementation inputs:
  * `src/cli.ts`
  * `src/commands/chat.ts`
  * `src/chat/reply-pipeline.ts`
  * `test/cli.test.js`

## Implementation Outcome

Phase 1 已经按计划落地，当前实际交付包括：

* `src/runtime/event-types.ts`
* `src/runtime/turn-context.ts`
* `src/runtime/session-manager.ts`
* `src/runtime/agent-loop.ts`
* `src/providers/provider-types.ts`
* `src/providers/local.ts`
* `src/ui/readline-input.ts`
* `src/ui/terminal-renderer.ts`
* `src/commands/chat.ts` 的薄命令重构
* `test/cli.test.js` 的 one-shot / stdin / transcript 测试扩展

当前 Phase 1 的边界结果：

* `chat` 命令只负责输入模式判断、provider 选择和 runtime 装配。
* 真正的 turn 编排已经收敛到 `runAgentLoop(...)`。
* provider 输出通过 `AgentProvider` 抽象进入 runtime。
* 终端输入和终端渲染已经拆分到 `src/ui/`。
* session transcript 以 JSONL 形式落盘到 `.rx-cli/sessions/`，并支持 `RX_CLI_SESSION_DIR` 覆盖。

## Verification

已执行并通过：

* `npm run check`
* `npm run dev -- chat --message "你好"`
* `printf 'hello' | npm run dev -- chat`
* `python3 ./.trellis/scripts/task.py validate 05-23-implement-phase-1-agent-runtime`
