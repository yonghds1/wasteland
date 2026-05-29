# Error Handling

> Current status / 当前状态: no backend error-handling conventions are established yet.

---

## Observed State / 已观察到的状态

- No backend runtime, API surface, service layer, or custom error module was found in this workspace.
- There is no real error propagation path to document yet.

---

## Rule For Now / 当前规则

- Do not define a custom backend error taxonomy in the spec before code exists.
- When backend code appears, document only the error patterns that are actually used in handlers, services, and external boundaries.

---

## Future Update Checklist / 后续补充清单

- custom error types or classes
- propagation boundaries between modules
- logging expectations for failures
- client-facing / API error response format
- 2-3 representative examples from real code
