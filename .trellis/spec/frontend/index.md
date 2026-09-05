# Frontend Development Guidelines (TUI)

> Current TUI frontend-spec status for this repository.

---

## Overview

The frontend in this project is a **Terminal User Interface (TUI)** built with **React** and **Ink**.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Focus Management](./focus-management.md) | Flat focus model, Tab cycling, Esc bidirectional toggle, useInput gating, HelpView dialog mode | **Established** (revised 07-30) |
| [Component Guidelines](./component-guidelines.md) | Component patterns, top-bar auxiliary pattern, pure-function extraction, wasteland dialog decoration, i18n self-check | **Established** (revised 07-30) |
| [State Management](./state-management.md) | AppContext + global filter pattern (viewFilter) | **Established** (07-30) |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Baseline |
| [Quality Guidelines](./quality-guidelines.md) | Five-gate checklist, pure-function extraction rule, anti-patterns | **Established** (07-30) |
| [Type Safety](./type-safety.md) | Type patterns, validation | Baseline |
| [Hook Guidelines](./hook-guidelines.md) | Hook conventions | Baseline |
| [Theme & Skin](./theme-skin.md) | Theme tokens and skin system | Baseline |

---

## Core Conventions

- **React + Ink**: Use standard React patterns adapted for terminal rendering via Ink.
- **Flat Focus Model**: All interaction is managed via `focusArea` in `AppContext`. Components MUST gate keyboard input based on their focused status. See `focus-management.md`.
- **Bilingual Support**: User-facing text must be externalized to `src/locales/*.json`.
- **Top-bar Auxiliary Components**: Default 1-row, opt-in expansion, decoupled from `ChatInputBar`. See `component-guidelines.md`.
- **Pure-function Extraction**: Complex decision logic in `useInput` MUST be extracted as exported pure functions for unit testing. See `quality-guidelines.md`.

---

## Recent Updates / 近期更新

### 07-30: AgentTabs TUI 组件

- **新增**: `src/tui/components/AgentTabs.tsx` — 顶部 sub-agent 切换 tab（默认 1 行，可滚动）
- **简化焦点模型**: Tab cycle 从 `['messageList', 'inputBar']` 改为 `['inputBar', 'agentTabs']`；Esc 双向 toggle
- **新增全局状态**: `AppState.viewFilter?: string`（filter agentId，undefined = 全部）
- **新增 spec 沉淀**: 焦点模型简化原则、顶部辅助带模式、viewFilter 全局 filter 模式、纯函数提取测试规则
- **测试**: AgentTabs.test.ts 33 cases（覆盖 tab 构建、viewport 滚动、viewFilter setter 语义）

详见 `.trellis/tasks/07-30-07-30-agent-tabs-topbar/prd.md` 和 `.trellis/workspace/yonghds1/notes/2026-07-30-tui-subagent-plan.md` v4。