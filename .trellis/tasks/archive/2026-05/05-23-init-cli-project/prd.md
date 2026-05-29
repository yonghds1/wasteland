# Initialize CLI Project Scaffold

## Goal

Initialize this repository as a general-purpose CLI project using a mainstream, low-friction stack, then extend that scaffold into a Git-backed CLI prototype whose user-input to reply path is processed through an RxJS stream pipeline. The result should be runnable end-to-end, not just documented.

## What I already know

* The repository currently contains Trellis and agent configuration only; there is no application code yet.
* Local toolchains available in this workspace include:
  * `Python 3.12.8`
  * `Node v22.22.2`
  * `npm 10.9.7`
  * `pnpm 9.15.9`
  * `uv 0.7.19`
  * `cargo 1.94.1`
* `go` is not installed in the current environment.
* The user asked to analyze first and then execute the initialization.
* Project-level Trellis spec now requires user-facing communication in Chinese, with key agent-facing policy text kept bilingual where relevant.
* The user now wants two additional concrete steps:
  * initialize Git for the repository
  * install `rxjs` and implement the CLI input → reply path as a stream pipeline

## Assumptions (temporary)

* A "general-practice" CLI scaffold should optimize for common packaging, easy local development, and low setup cost.
* Because this repo has no existing language/runtime choice, the best default is the stack with the lowest coordination cost in the current environment.
* A lightweight command framework is preferable to a heavyweight CLI platform unless plugin/runtime extension requirements already exist.
* A first RxJS-backed MVP should prioritize a simple, inspectable stream pipeline over sophisticated conversation state.

## Open Questions

* None for MVP; proceed with the recommended default stack unless implementation reveals a blocker.

## Requirements

* Initialize a runnable CLI project in this repository.
* Use a widely adopted, low-friction stack suitable for a new standalone CLI.
* Include a clear entrypoint, build script, dev script, and basic test/check scripts.
* Include at least one example command so the scaffold proves the command layout works.
* Initialize Git for the repository using a conventional default branch.
* Add `rxjs` as a runtime dependency.
* Implement a CLI command where user input is transformed into replies through an RxJS pipeline.
* Make the RxJS command testable in non-interactive mode, while still supporting interactive CLI usage.
* Keep the implementation small and conventional; avoid prematurely introducing plugin systems or complex generators.
* Add minimal project documentation for local usage.

## Acceptance Criteria

* [x] The repo has a package manager manifest and dependency lockfile.
* [x] The CLI can run locally in development mode.
* [x] The CLI can build to distributable JavaScript and expose a `bin` entry.
* [x] There is at least one example subcommand with help text.
* [x] Git is initialized for the repository.
* [x] `rxjs` is installed and recorded in the package manifest.
* [x] The CLI exposes an RxJS-based user-input → reply command path.
* [x] Basic checks/tests run successfully in the local environment after the RxJS changes.
* [x] The scaffold includes enough documentation for a new contributor to run the RxJS command.

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope

* Designing the real business commands for this CLI
* Plugin architecture, auto-update, analytics, or release automation
* Multi-runtime or polyglot scaffolding
* Rewriting Trellis workflow/docs outside what this new code requires

## Research Notes

### Observed options

**Option A: Node.js + TypeScript + Commander** (Recommended)

* Why it fits:
  * Node/npm are already installed.
  * npm officially supports `package.json` initialization and `bin` mapping for executable commands.
  * Commander is a lightweight, mainstream argument/subcommand library with built-in TypeScript declarations.
* Trade-off:
  * Slightly more manual setup than a full generator, but much lighter than a framework like oclif.

**Option B: Node.js + TypeScript + oclif**

* Why it fits:
  * Officially built for Node + TypeScript CLIs and can scaffold a full project quickly.
* Trade-off:
  * Better when you already know you need pluginability, command generators, and heavier CLI infrastructure.
  * Overkill for a clean-slate MVP scaffold.

**Option C: Python + Typer**

* Why it fits:
  * Python and uv are available locally; Typer gives quick command/help generation.
* Trade-off:
  * This repo has no Python app packaging baseline yet, and npm-style CLI distribution is more conventional for a generic standalone CLI scaffold here.

### Recommendation

Use `npm + TypeScript + Commander` with a small modular command layout:

* `src/cli.ts` as the root program
* `src/commands/` for subcommands
* `bin/` wrapper for the executable entry
* `tsc` for build output to `dist/`
* a smoke test against the built CLI

## Technical Approach

* Initialize `package.json` with scripts, `bin`, and Node engine metadata.
* Add TypeScript compiler config and source layout.
* Add Commander-based root command plus one example subcommand.
* Add a small executable wrapper in `bin/`.
* Add a smoke test using Node's built-in test runner.
* Add `.gitignore` and `README.md`.
* Sync Trellis backend spec to the newly established CLI code layout and quality baseline.
* Initialize Git with a conventional default branch.
* Add an RxJS-backed `chat` command with a reusable reply pipeline and a one-shot mode suitable for tests.

## Technical Notes

* Official sources consulted:
  * npm docs on `npm init`: https://docs.npmjs.com/creating-a-package-json-file/
  * npm docs on `package.json#bin`: https://docs.npmjs.com/cli/v8/configuring-npm/package-json/?v=true
  * TypeScript docs on `tsc --init` / CLI options: https://www.typescriptlang.org/docs/handbook/compiler-options.html
  * TypeScript docs on `tsconfig.json`: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html
  * Commander package docs: https://www.npmjs.com/package/commander
  * oclif docs: https://oclif.io/docs/introduction
  * Typer docs: https://typer.tiangolo.com/tutorial/first-steps/
* Files inspected before planning:
  * `AGENTS.md`
  * `.trellis/workflow.md`
  * `.trellis/spec/guides/index.md`
  * `.trellis/spec/guides/communication-language-policy.md`
* Files created or updated during implementation:
  * `package.json`
  * `package-lock.json`
  * `tsconfig.json`
  * `.gitignore`
  * `README.md`
  * `bin/rx-cli.js`
  * `src/cli.ts`
  * `src/commands/hello.ts`
  * `src/commands/chat.ts`
  * `src/chat/reply-pipeline.ts`
  * `test/cli.test.js`
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/backend/directory-structure.md`
  * `.trellis/spec/backend/quality-guidelines.md`

## Verification

* `npm run check`
* `npm run dev -- hello Trellis`
* `npm start -- hello Trellis --upper`
* `npm run dev -- chat --message "你好"`
* `printf 'hello\n/exit\n' | npm run dev -- chat`
* `npm start -- chat --message "你好"`
* `npm pack --dry-run`
* `python3 ./.trellis/scripts/task.py validate 05-23-init-cli-project`
* `git init -b main`
* `git branch --show-current`

## Notes

* The repository is now a Git repository on branch `main`.
* Current `.gitignore` entries ignore `.trellis/` and agent directories, so Trellis-spec changes are local but not shown by default in `git status`.
