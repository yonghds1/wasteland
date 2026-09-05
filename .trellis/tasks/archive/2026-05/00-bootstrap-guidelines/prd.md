# Bootstrap Guidelines

## Goal

Populate `.trellis/spec/` with the project's real development conventions so future Trellis sessions inherit useful guidance instead of generic defaults. Because this workspace currently looks like a fresh Trellis scaffold, the first requirement is to confirm what should count as the source of truth for those conventions.

## What I already know

* The repo contains Trellis scaffolding and agent configuration directories: `.trellis/`, `.claude/`, `.cursor/`, `.gemini/`, and `AGENTS.md`.
* There is an existing Trellis task at `.trellis/tasks/00-bootstrap-guidelines/` with status `in_progress`.
* The task initially had no active session pointer; it was later activated in this session with `python3 ./.trellis/scripts/task.py start 00-bootstrap-guidelines`.
* The workspace is not a Git repository at the moment (`git status` failed with "not a git repository").
* I did not find existing convention docs such as `CLAUDE.md`, `CONTRIBUTING.md`, `.cursorrules`, or `.editorconfig`; only `AGENTS.md` is present.
* The backend and frontend spec indexes are still template placeholders marked "To fill".
* I have not found application source code outside the Trellis and agent scaffolding, so there may be no concrete backend/frontend implementation to mine for conventions yet.
* The user explicitly requested that I communicate in Chinese and that this convention be reflected in the Trellis spec.
* The current backend/frontend spec index templates still state that documentation should be written in English, so the language policy now needs an explicit project decision.
* The user chose the bilingual direction: user-facing communication in Chinese, with Trellis spec content maintained bilingually where the rule matters.
* The user chose the current workspace as the only source of truth for this bootstrap task.
* Observed conventions currently come from Trellis workflow/config files such as `.trellis/workflow.md`, `.claude/settings.json`, and `.cursor/hooks.json`; I still do not see real backend/frontend product code to justify concrete app-layer conventions.
* The user chose the strict "document current reality" scope rather than inventing starter backend/frontend rules.
* Existing language-related reality is mixed: `.claude/hooks/session-start.py` and `.cursor/hooks/session-start.py` already instruct the first visible reply to begin with a short Chinese sentence, while `.trellis/spec/backend/index.md`, `.trellis/spec/frontend/index.md`, and `.trellis/workspace/index.md` still say documentation should be written in English.

## Assumptions (temporary)

* This is a first-run Trellis bootstrap for a new or not-yet-imported project.
* We should not invent "actual conventions" until the user confirms which source of truth to use.
* The bilingual rule should be treated as a project-wide convention, not a backend/frontend-only detail.
* Empty backend/frontend areas should stay explicitly "not established yet" in this bootstrap pass.
* Language-policy cleanup in this task should apply only to `.trellis/spec/`.

## Open Questions

* None.

## Requirements (evolving)

* Determine the authoritative source for project conventions before writing spec content.
* Keep the spec grounded in reality: existing code/config when available, otherwise explicitly documented intended conventions approved by the user.
* Use Chinese for user-facing communication in this project.
* Record the language policy bilingually in Trellis spec files where it affects agent behavior and project documentation.
* Capture constraints and source references in this PRD as decisions are made.
* Treat the current workspace as the only valid evidence source for this bootstrap pass.
* Keep backend/frontend business-layer spec honest: mark those conventions as not yet established where no supporting code exists.
* Limit this bootstrap change set to `.trellis/spec/`; do not rewrite `.trellis/workspace/`, workflow docs, or hook copy in this pass.

## Acceptance Criteria (evolving)

* [x] The source of truth for the bootstrap spec is explicitly chosen.
* [x] The spec-writing approach is agreed: extract from existing code/config and document absent areas honestly instead of inventing them.
* [x] The project language policy is explicit: user-facing communication in Chinese, with bilingual Trellis spec wording where appropriate.
* [x] The final spec plan states what evidence/examples will be cited in `.trellis/spec/`.

## Technical Approach

* Add a project-wide communication policy under `.trellis/spec/guides/` and link it from `guides/index.md`.
* Rewrite `backend/index.md` and `frontend/index.md` so they reflect the real repository state and no longer contain English-only policy text.
* Replace backend/frontend placeholder sub-guides with honest baseline docs that say the relevant conventions are not established yet and describe what evidence should be captured later.

## Decision (ADR-lite)

**Context**: The default Trellis spec templates currently assume English documentation, while the user requested Chinese communication and asked that this be reflected in Trellis norms.

**Decision**: Use Chinese for user-facing interaction, and write the relevant Trellis policy text bilingually where that improves clarity and tool compatibility.

**Consequences**: Cross-cutting spec sections need explicit language-policy wording; backend/frontend template language may need adjustment so it no longer conflicts with the bilingual project rule.

## Source of Truth Decision

**Context**: The workspace currently contains Trellis scaffolding and agent configuration, but no visible application code or separate conventions repository.

**Decision**: Use the current workspace as the only authoritative source for this bootstrap task.

**Consequences**: Observed workflow and agent conventions can be documented immediately; backend/frontend implementation rules must either stay explicitly unestablished or be marked as future-facing decisions approved by the user.

## Scope Decision

**Context**: There is no backend/frontend application code in the workspace, so starter conventions would be invented rather than observed.

**Decision**: Keep this bootstrap pass strictly reality-based. Backend/frontend spec files should explicitly state when conventions are not established yet instead of fabricating them.

**Consequences**: This task will produce honest, low-assumption spec content. It may feel less complete, but future implementation tasks will have a cleaner baseline and clearer prompts to update spec once real code appears.

## Spec Scope Decision

**Context**: Language-policy inconsistencies also exist in adjacent Trellis docs such as `.trellis/workspace/index.md`, but the user asked specifically to落实到 Trellis 规范里 and selected the smallest scope.

**Decision**: Normalize the policy only inside `.trellis/spec/` during this task.

**Consequences**: `.trellis/spec/` becomes the authoritative policy surface for agents, while other Trellis docs may still contain older English-only wording until a later cleanup task.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Writing fabricated "current" backend/frontend conventions without a confirmed source.
* Implementing product code unrelated to Trellis bootstrap.
* Editing `.trellis/workspace/`, `.trellis/workflow.md`, or hook copy in `.claude/`, `.cursor/`, `.gemini/` during this pass.

## Technical Notes

* Files modified:
  * `.trellis/spec/guides/communication-language-policy.md`
  * `.trellis/spec/guides/index.md`
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/backend/directory-structure.md`
  * `.trellis/spec/backend/database-guidelines.md`
  * `.trellis/spec/backend/error-handling.md`
  * `.trellis/spec/backend/logging-guidelines.md`
  * `.trellis/spec/backend/quality-guidelines.md`
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/directory-structure.md`
  * `.trellis/spec/frontend/component-guidelines.md`
  * `.trellis/spec/frontend/hook-guidelines.md`
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/frontend/type-safety.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
* Files inspected:
  * `AGENTS.md`
  * `.trellis/workflow.md`
  * `.claude/settings.json`
  * `.cursor/hooks.json`
  * `.trellis/tasks/00-bootstrap-guidelines/prd.md` (template bootstrap instructions before rewrite)
  * `.trellis/tasks/00-bootstrap-guidelines/task.json`
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/guides/index.md`
  * `.trellis/workspace/index.md`
  * `.trellis/spec/backend/*.md`
  * `.trellis/spec/frontend/*.md`
  * `.claude/hooks/session-start.py`
  * `.cursor/hooks/session-start.py`
* Commands run:
  * `python3 ./.trellis/scripts/task.py current --source`
  * `python3 ./.trellis/scripts/task.py list`
  * `python3 ./.trellis/scripts/task.py start 00-bootstrap-guidelines`
  * `python3 ./.trellis/scripts/task.py validate 00-bootstrap-guidelines`
  * `rg --files` for convention-doc discovery
  * `find` over `.cursor/`, `.claude/`, `.gemini/`
  * `rg` checks for leftover placeholder / English-only text in `.trellis/spec/`
* Constraint:
  * The workspace currently appears to be Trellis bootstrap/config only, so "document reality, not ideals" needs user confirmation on what reality should mean for this task.
  * The spec templates currently assume English documentation, so the bilingual language policy will require explicit overrides in the final spec content.

## Verification

* `rg -n "To fill|To be filled|All documentation should be written in \\*\\*English\\*\\*|\\(To be filled by the team\\)" .trellis/spec` returned no matches.
* `python3 ./.trellis/scripts/task.py validate 00-bootstrap-guidelines` passed; `implement.jsonl` and `check.jsonl` were not present, so validation skipped them.
