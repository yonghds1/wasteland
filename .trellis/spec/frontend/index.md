# Frontend Development Guidelines

> Current frontend-spec status for this repository. / 当前仓库的前端规范状态说明。

---

## Overview

No frontend application package or source tree is currently present in this workspace. These files therefore record the current absence of established frontend conventions and explain how to update the spec once real frontend code exists.

当前工作区里还没有可观察到的前端业务代码或独立前端包。因此，本目录当前记录的是“前端规范尚未建立”的事实，以及未来出现真实前端代码后应如何更新这些规范。

---

## Project-Wide Policies / 项目通用规则

- Read [Communication and Language Policy](../guides/communication-language-policy.md) before writing user-facing frontend rules or notes.
- Keep frontend rules reality-based: only document conventions that can be traced to the current repository.

- 在编写面向用户的前端规则或说明前，先阅读 [Communication and Language Policy](../guides/communication-language-policy.md)。
- 前端规范必须以仓库现实为准：只能记录当前仓库中可追溯的约定。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Not established yet |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Not established yet |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Not established yet |
| [State Management](./state-management.md) | Local state, global state, server state | Not established yet |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Baseline only |
| [Type Safety](./type-safety.md) | Type patterns, validation | Not established yet |

---

## How to Update These Guidelines / 后续如何更新

When frontend code is introduced:

1. Replace "not established yet" text only after a convention is visible in real code or config.
2. Cite 2-3 representative files or commands when possible.
3. Record actual component layout, state patterns, type usage, and testing expectations.
4. Keep key agent-facing policy text bilingual when it changes user-facing behavior.

当前端代码真正出现后：

1. 只有在真实代码或配置里已经出现某种约定时，才替换本目录里的“尚未建立”说明。
2. 尽量引用 2-3 个代表性文件或命令。
3. 记录真实的组件结构、状态模式、类型使用方式和测试要求。
4. 如果规则会影响面向用户的行为，关键表述保持双语。

这些文件的目标，是帮助 AI agent 和后续维护者理解“这个仓库当前真实存在什么规范”。

---

## Evidence Used For This Baseline / 当前基线依据

- `.trellis/workflow.md`
- `.claude/settings.json`
- `.cursor/hooks.json`
- top-level repository contents under `.trellis/`, `.claude/`, `.cursor/`, `.gemini/`, `.agents/`, and `AGENTS.md`

No frontend source directory was found during this bootstrap pass.
