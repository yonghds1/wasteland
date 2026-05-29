# 文档索引

本目录承载项目级架构和实施文档。对于会改变运行时边界、目录结构、provider/tool/session 设计的改动，不能只改代码，必须同步更新这里的文档。

## 文档边界

本仓库统一按下面的边界收口：

- `docs/`：放项目级架构说明、阶段设计、目录规划、实现思路，面向人阅读。
- `.trellis/spec/`：放可执行规范、跨层合同、质量约束，面向实现和校验。
- `.trellis/tasks/`：放任务 PRD、过程记录和阶段性上下文，不作为长期规范真源。

如果同一主题在 `docs/` 和 `.trellis/spec/` 都出现：

- `docs/` 负责解释“为什么这样设计”
- `.trellis/spec/` 负责定义“实现时必须遵守什么”
- 如果出现冲突，以 `.trellis/spec/` 为准，并在同一任务里把 `docs/` 修正回来

## 文档列表

- [智能体 CLI 架构](./architecture/agent-cli.md)
- [配置层与 `.wasteland` 目录](./architecture/configuration.md)
- [多角色配置方案](./architecture/multi-role-configuration.md)
- [运行时分层与契约](./architecture/runtime-boundaries.md)
- [多Agent协作架构](./architecture/multi-agent-architecture.md)
- [技能系统架构](./architecture/skills.md)
- [项目结构规划](./project-structure.md)
- [Phase 1：Agent Runtime 实施方案](./implementation/phase-1-agent-runtime.md)
- [Phase 2：工具运行时与权限闸门](./implementation/phase-2-agent-tool-runtime.md)
- [Phase 3：多步 Agent Loop 与调试追踪](./implementation/phase-3-multi-step-agent-loop.md)
