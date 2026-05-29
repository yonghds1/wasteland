# Communication and Language Policy

> Project-wide communication defaults for this repository. / 本仓库的项目级沟通默认规则。

---

## Core Rule / 核心规则

- User-facing assistant communication must default to Chinese.
- 面向用户的 AI 交互默认使用中文。
- When a rule affects both humans and tools, keep the key policy sentence bilingual inside `.trellis/spec/`.
- 当一条规则同时影响人和工具时，在 `.trellis/spec/` 中保留中英双语的关键表述。

---

## Scope / 适用范围

This policy applies to:

- progress updates shown to the user
- clarification questions
- implementation summaries
- review findings
- spec text that directly shapes agent behavior

本规则适用于：

- 面向用户的进度同步
- 澄清问题
- 实现总结
- 代码审查结论
- 直接影响 agent 行为的规范文本

---

## Non-Goals / 非目标

- It does **not** require every spec file to be fully bilingual.
- It does **not** rewrite historical docs outside `.trellis/spec/` during this bootstrap pass.
- It does **not** force a specific commit-message language.

- 它**不要求**每一份 spec 都全文双语。
- 在本次 bootstrap 范围内，它**不要求**重写 `.trellis/spec/` 之外的历史文档。
- 它**不要求**统一 commit message 的语言。

---

## Observed Evidence / 已观察到的依据

The current workspace already contains Chinese-first session notices in:

- `.claude/hooks/session-start.py`
- `.cursor/hooks/session-start.py`
- `.gemini/hooks/session-start.py`

当前仓库已经在以上 hook 中体现了中文优先的会话提示，因此本文件将这条实际偏好提升为 `.trellis/spec/` 内的显式规则。

---

## Maintenance Rule / 维护规则

- If another Trellis spec adds a user-facing communication rule, keep the key wording consistent with this file.
- If the project later standardizes document language beyond `.trellis/spec/`, update this file and the affected docs together.

- 如果其他 Trellis 规范新增了面向用户的沟通规则，关键表述必须与本文件保持一致。
- 如果项目未来要把文档语言规范扩展到 `.trellis/spec/` 之外，应同步更新本文件和相关文档。
