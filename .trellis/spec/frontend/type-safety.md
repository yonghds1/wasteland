# Type Safety

> Current status / 当前状态: no frontend type-safety conventions are established yet.

---

## Observed State / 已观察到的状态

- No frontend TypeScript or JavaScript application code was found in this workspace.
- No runtime validation library, shared type layer, or schema definition pattern can be inferred yet.

---

## Rule For Now / 当前规则

- Do not invent type-location, validation, or `any`-usage rules before real frontend code exists.
- When frontend code appears, capture only the type patterns that are visible in the repository and enforced in actual reviews or tooling.

---

## Future Update Checklist / 后续补充清单

- type organization strategy
- runtime validation approach
- common utility / generic patterns
- forbidden patterns discovered in review
- 2-3 representative examples from real code
