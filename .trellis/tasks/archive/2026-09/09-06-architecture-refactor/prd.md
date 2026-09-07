# 当前任务：Wasteland 核心架构与记忆系统重构

**任务状态**: 进行中 (IN PROGRESS)
**最后更新**: 2026-09-06

## 任务背景
当前项目的 `src/core/runtime` 过于臃肿，且记忆系统耦合过深。为了降低未来多智能体切换成本及保证开发准确性，需要对项目的架构边界进行物理文件的重构。

## 目标 (Goals)
1. 拆解臃肿的引擎层（`src/core/runtime`）。
2. 构建通用智能体记忆系统所需的物理边界（`src/core/memory` 与 `src/core/session`）。
3. 工具集的领域化分包。
4. 修复引用的依赖关系。

## 任务流 (TODO List)

### 阶段一：规范固化 (已完成)
- [x] 分析项目的记忆体系。
- [x] 将架构规范与元知识固化到 `.trellis/spec/backend/architecture-rules.md`。
- [x] 统一 `CLAUDE.md` 等各个 AI Agent 的记忆入口。

### 阶段二：记忆域代码物理重构 (已完成，2026-09-06 提交)
> **接手该任务的 Agent 请注意**：执行时请严格参考 `architecture-rules.md` 中的规范。
- [x] 提取 `context-manager.ts`、`context-compaction.ts`、`context-stats.ts`、`context-summarizer.ts`、`memory-trigger.ts` 到 `src/core/memory/`。
- [x] 提取 `session-manager.ts`、`session-index.ts`、`session-records.ts` 到 `src/core/session/`。
- [x] 提取调度逻辑到 `src/core/engine/`。
- [x] 批量修复 `import` 路径（重点关注 `agent-loop.ts` 和外部的 `commands/chat.ts`）。

### 阶段三：工具箱域划分 (已完成，`src/tools/{core,mcp,sys,web,agent,fs,interaction}` 已落地)
- [x] 重组 `src/tools/` 目录结构（`core`, `mcp`, `builtin`, `web`）。

### 阶段四：验证与审查 (已完成，2026-09-07 收尾)
- [x] 运行 `npm run check:fast` 和 `npm run typecheck`。
- [x] 确保测试 `npm test` 通过（收尾修复：agent-loop trace 改 info 后的单测对齐、useRuntime locales mock 补 `DEFAULT_LANGUAGE`、LogsPage 快捷键 `Tab`/`←→` 分项）。

---
**接力提示 (Handoff Note):** 
如果你是新接手的 AI 助手，请按照本文件的 TODO List 继续向下执行阶段二的代码物理移动与引用修复。
