# Database Guidelines

> Current status / 当前状态: no database stack has been established in this workspace.

---

## Observed State / 已观察到的状态

- No ORM, query builder, migration tool, schema directory, or database configuration was found in the current repository.
- There is no observed persistence layer from which to infer naming, query, or transaction conventions.

---

## Rule For Now / 当前规则

- Do not assume a database library, migration workflow, or schema naming standard.
- When a persistence layer is added, replace this baseline with conventions taken from real code and commands.

---

## Future Update Checklist / 后续补充清单

- chosen ORM / query library
- migration creation and execution commands
- table / column / index naming rules
- transaction handling patterns
- 2-3 representative schema or query examples
