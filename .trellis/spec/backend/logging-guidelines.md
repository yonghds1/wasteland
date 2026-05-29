# Logging Guidelines

> Current status / 当前状态: no backend logging conventions are established yet.

---

## Observed State / 已观察到的状态

- No backend logging library, logger wrapper, or structured log format was found in this workspace.
- There is no production runtime code from which to infer log levels or redaction rules.

---

## Rule For Now / 当前规则

- Do not invent logger APIs, log fields, or log-level policy before backend code exists.
- When logging is introduced, record only the fields, redaction rules, and level usage that appear in real code and operational docs.

---

## Future Update Checklist / 后续补充清单

- logging library or wrapper
- allowed log levels and their intended use
- required structured fields
- redaction / secret-handling rules
- 2-3 representative log examples
