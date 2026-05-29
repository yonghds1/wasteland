# Frontend Development Guidelines (TUI)

> Current TUI frontend-spec status for this repository.

---

## Overview

The frontend in this project is a **Terminal User Interface (TUI)** built with **React** and **Ink**.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Focus Management](./focus-management.md) | Flat focus model, Tab cycling, and gated interaction | **Established** |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Baseline |
| [State Management](./state-management.md) | AppContext and global state patterns | Baseline |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Baseline |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Baseline |
| [Type Safety](./type-safety.md) | Type patterns, validation | Baseline |

---

## Core Conventions

- **React + Ink**: Use standard React patterns adapted for terminal rendering via Ink.
- **Flat Focus Model**: All interaction is managed via `focusArea` in `AppContext`. Components MUST gate keyboard input based on their focused status.
- **Bilingual Support**: User-facing text must be externalized to `src/locales/*.json`.

---

## Evidence Used For This Baseline / 当前基线依据

- `.trellis/workflow.md`
- `.claude/settings.json`
- `.cursor/hooks.json`
- top-level repository contents under `.trellis/`, `.claude/`, `.cursor/`, `.gemini/`, `.agents/`, and `AGENTS.md`

No frontend source directory was found during this bootstrap pass.
