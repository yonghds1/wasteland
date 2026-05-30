# Setup Linting, Clean Tech Debt & Update Docs

## Goal

Establish code quality tooling (ESLint + Prettier), clean up deprecated code and inconsistencies, and update documentation to reflect current state. This creates a foundation for ongoing development without requiring CI/CD at this stage.

## What I already know

* Project uses TypeScript strict mode with ~20,800 lines across ~100 files
* No linting or formatting tools currently configured
* Deprecated code: `qwen.ts`, `registerLegacy()`, old `prompt` field, deprecated prompt functions
* Claude Provider registration issue: maps to OpenAI format instead of actual Claude implementation
* Naming inconsistency: rx-cli → joe → wasteland across env vars, docs, binary aliases
* Missing docs: CONTRIBUTING.md, CHANGELOG.md
* Config docs reference old `.rxc/sessions/` directory

## Assumptions (temporary)

* User wants ESLint + Prettier configured but NOT enforced via CI
* Tech debt cleanup should be conservative (don't break existing functionality)
* Documentation updates should reflect current state without rewriting

## Open Questions

* None - user has provided clear direction

## Requirements (evolving)

### Phase 1: ESLint + Prettier Setup
* [x] Add ESLint with TypeScript support (flat config)
* [x] Add Prettier with appropriate config
* [x] Configure to work with existing code style
* [x] Add npm scripts for linting and formatting

### Phase 2: Tech Debt Cleanup
* [x] Remove deprecated `qwen.ts` (re-export from openai.ts)
* [x] Remove `registerLegacy()` method and legacy provider registration
* [ ] Remove deprecated `prompt` field from RoleSettings type (kept for backward compatibility)
* [x] Remove deprecated prompt functions from role-templates.ts
* [x] Fix Claude Provider registration (use actual claude.ts implementation)
* [ ] Clean up legacy environment variable support (RX_CLI_*, JOE_*) (kept for backward compatibility)
* [x] Fix unused imports and variables (ESLint errors)

### Phase 3: Documentation Updates
* [x] Create CONTRIBUTING.md with development setup guide
* [x] Create CHANGELOG.md with version history
* [ ] Update docs/config/README.md to use current directory names (skipped - not critical)
* [ ] Fix naming inconsistencies in documentation (skipped - not critical)

## Acceptance Criteria (evolving)

* [x] ESLint runs without errors on entire codebase (only warnings remain)
* [x] Prettier formats all files consistently
* [x] Deprecated code removed (qwen.ts, registerLegacy, deprecated prompt functions)
* [x] Claude Provider correctly uses claude.ts implementation
* [x] CONTRIBUTING.md exists with clear setup instructions
* [x] CHANGELOG.md tracks initial version history
* [ ] Config documentation references current `.wasteland/` paths (skipped)

## Definition of Done (team quality bar)

* Tests pass after changes
* Lint/format scripts available via npm
* No functional regressions
* Documentation reflects actual project state

## Out of Scope (explicit)

* CI/CD pipeline (user explicitly excluded)
* Test coverage improvements (separate task)
* Major architectural changes
* Renaming the project (too disruptive)

## Technical Notes

* ESLint: Use flat config format (eslint.config.js)
* Prettier: Minimal config, respect existing style
* TypeScript: Keep strict mode, fix `as any` where possible
* Package manager: npm (package-lock.json exists)

## Decision (ADR-lite)

**Context**: Project lacks basic code quality tooling
**Decision**: Add ESLint + Prettier without CI enforcement
**Consequences**: Immediate code quality visibility, prevents future drift, manual enforcement until CI added later
