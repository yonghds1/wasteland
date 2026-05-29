# Quality Guidelines

> Current baseline / 当前基线: project-wide Trellis workflow exists, but frontend-specific quality rules are not established yet.

---

## Observed Baseline / 已观察到的基线

- `.trellis/workflow.md` establishes a planning-first task workflow, spec maintenance, and quality-check expectations at the project level.
- No frontend package, frontend linter config, frontend test suite, or frontend review checklist was found in the workspace.

---

## Rule For Now / 当前规则

- Follow the Trellis task workflow for any future frontend work: plan first, keep discoveries in spec, and run the relevant checks once a frontend toolchain exists.
- Do not claim frontend-specific lint, type-check, accessibility, or testing requirements until the repository actually contains them.

---

## Future Update Checklist / 后续补充清单

- lint / format commands for frontend code
- test commands and minimum coverage expectations
- accessibility checks used in review
- required patterns for components, hooks, and state
- reviewer checklist grounded in real frontend changes
