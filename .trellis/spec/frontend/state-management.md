# State Management

> Current status / 当前状态: no frontend state-management conventions are established yet.

---

## Observed State / 已观察到的状态

- No client state library, server-state cache, router state pattern, or URL-state convention was found in this workspace.
- There is no frontend application code from which to infer local vs global state boundaries.

---

## Rule For Now / 当前规则

- Do not assume a state-management library or promotion rule for shared state.
- When frontend code appears, document actual local, global, server, and URL state patterns from real features.

---

## Future Update Checklist / 后续补充清单

- local vs global state boundary
- server-state and caching approach
- URL-state handling
- derived-state patterns
- 2-3 representative feature examples
