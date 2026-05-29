# wasteland 核心架构规范

## Goal

建立 wasteland 项目的权威架构规范文档，解决当前文档之间相互矛盾、与代码不一致的问题。规范将作为唯一事实来源（Single Source of Truth），所有其他文档引用此规范。

## What I already know

### 项目概况
- **产品名**: wasteland（npm package name）
- **CLI 命令**: `wasteland`（主命令）+ `joe`（短别名，Immortan Joe 简写）
- **当前版本**: 0.1.0
- **技术栈**: TypeScript + Commander + RxJS + Ink (React TUI)
- **主题**: Mad Max 废土风格，Immortan Joe 作为主 agent，子 agent 为 War Boys

### 已确认的核心架构决策

#### 1. Agent 模型
- **主 Agent**: 唯一 1 个，默认皮肤为 Immortan Joe
  - 可以覆盖皮肤/配置
  - **不能增加**新的主 agent
- **子 Agent**: 默认 4 个 warboys
  - 经典四件套：coder（写代码）、planner（做计划）、reviewer（审查）、researcher（调研）
  - 可以覆盖现有子 agent
  - **可以新增**自定义子 agent

#### 2. 皮肤（Skin）与角色（Role）严格分离
| 层 | 归属 | 内容 |
|----|------|------|
| **Skin（表面）** | 皮肤配置 | 名字、问候语（greeting）、口癖（catchphrase）、颜色、UI 文字、横幅 |
| **Role（能力）** | 角色配置 | systemPrompt、tools、permissions、model |

- 皮肤是纯外在表现，外部可覆盖和自定义
- 皮肤不影响会话链路
- 对话链路由 agent 的角色配置决定

#### 3. 加载机制
- 皮肤文件：`.wasteland/skins/` 或 `~/.wasteland/skins/`
- 角色配置：`settings.json`（或 `.wasteland/settings.json`）
- 两者通过 agent name 关联

#### 4. 协作模式
- **严格层级**：主→子→主
- 子 agent 隔离，结果返回主 agent
- 子 agent 之间不直接通信
- 主 agent 负责所有编排决策

### 当前文档问题清单

| # | 严重度 | 问题 | 涉及文件 |
|---|--------|------|----------|
| 1 | 🔴 | CLI 命令名三版本：wasteland / rxc / joe | package.json, README, prd.md |
| 2 | 🔴 | 产品名混乱：wasteland vs RxCLI | skills.md |
| 3 | 🔴 | spawn_agent 参数不一致（缺 inheritHistory） | README, prd.md |
| 4 | 🔴 | spawn_agent 超时不一致（60s vs 120s） | multi-agent-architecture.md, prd.md |
| 5 | 🔴 | 8 个命名角色从未实现，与代码脱节 | multi-agent-architecture.md |
| 6 | 🟠 | agent-cli.md 基线描述完全过时 | agent-cli.md |
| 7 | 🟠 | phase-3 文档自相矛盾 | phase-3 doc |
| 8 | 🟠 | prd.md Out of Scope 列了已实现功能 | prd.md |
| 9 | 🟠 | 架构图工具列表不完整 | multi-agent-architecture.md |
| 10 | 🟠 | Ollama 被错误描绘为独立 provider | multi-agent-architecture.md |
| 11 | 🟡 | /info 别名冲突 | status-skill.ts, context-skill.ts |
| 12 | 🟡 | Session Record vs RuntimeEvent 命名不一致 | event-types.ts |
| 13 | 🟡 | 皮肤系统边界未在文档中明确 | 所有架构文档 |
| 14 | 🟡 | Skills 架构文档缺失关键层 | agent-cli.md |

## Assumptions

- wasteland 核心规范文档将作为唯一事实来源
- 现有实现代码是正确的，文档需要向代码对齐（而非反过来）
- 皮肤和角色的分离需要在代码层面也做重构

## Open Questions

（已全部在 brainstorm 中解决）

## Requirements

### R1: 创建核心规范文档
- 创建 `docs/architecture/wasteland-spec.md` 作为权威文档
- 包含：Agent 模型、皮肤/角色分离、协作模式、配置加载、CLI 命令定义

### R2: 修复 CLI 命名不一致
- 统一为 `wasteland` + `joe` 别名
- 更新 package.json bin 注册 joe 别名
- 更新 README、prd.md 中的命令名

### R3: 修复产品名不一致
- skills.md 中的 "RxCLI" 全部改为 "wasteland"
- import 路径 `from "rx-cli"` 改为 `from "wasteland"`

### R4: 修复 spawn_agent 文档
- 补充 `inheritHistory` 参数
- 超时值统一为 120000ms

### R5: 清理角色系统描述
- 移除 8 个命名角色的理想化描述
- 替换为实际的 1 主 + 4 子 agent 模型
- 明确皮肤/角色分离原则

### R6: 更新过时文档
- agent-cli.md 基线描述更新
- phase-3 文档状态更新
- prd.md Out of Scope 清理
- 架构图补充完整工具列表

### R7: 修复代码级问题
- `/info` 别名冲突修复
- spawn-agent.ts 中硬编码中文走 i18n

## Acceptance Criteria

- [ ] `docs/architecture/wasteland-spec.md` 创建完成，包含所有核心决策
- [ ] 文档中 CLI 命令名统一为 `wasteland` + `joe`
- [ ] 文档中产品名统一为 `wasteland`
- [ ] spawn_agent 参数和超时值与代码一致
- [ ] 角色系统描述与实际实现一致（1 主 + 4 子）
- [ ] 皮肤/角色分离原则在文档中明确
- [ ] agent-cli.md 基线描述反映当前实际状态
- [ ] `/info` 别名冲突在代码中修复
- [ ] 所有文档之间的矛盾消除

## Definition of Done

- 核心规范文档创建并包含所有已确认的架构决策
- 至少 3 个现有文档的矛盾被修复
- 代码级 bug（/info 别名）修复
- 所有文档中的命名统一
- `npm run check` 通过

## Technical Approach

### 核心规范文档结构

```
docs/architecture/wasteland-spec.md

1. 概述
   - 产品定位：废土主题多 agent CLI 系统
   - 技术栈：TypeScript + Commander + RxJS + Ink

2. Agent 架构模型
   - 2.1 主 Agent（Immortan Joe）
   - 2.2 子 Agent（War Boys）
   - 2.3 协作模式（严格层级）

3. 皮肤与角色分离
   - 3.1 Skin 层（表面）
   - 3.2 Role 层（能力）
   - 3.3 加载机制

4. 配置体系
   - 4.1 settings.json 结构
   - 4.2 皮肤文件结构
   - 4.3 加载优先级

5. CLI 命令定义
   - 5.1 命令名：wasteland + joe 别名
   - 5.2 子命令

6. 运行时架构
   - 6.1 Agent Loop
   - 6.2 Provider 抽象
   - 6.3 工具系统
   - 6.4 Session 管理
```

## Decision (ADR-lite)

**Context**: 项目文档在多次迭代后产生严重不一致，需要建立单一事实来源
**Decision**: 新建 `docs/architecture/wasteland-spec.md` 作为核心规范，现有文档保留为实现记录但不作为权威来源
**Consequences**: 所有新功能开发以核心规范为准；现有文档需要逐步更新以消除矛盾

## Out of Scope

- 代码层面的 skin/role 分离重构（本任务只做文档规范）
- CI/CD 搭建
- 测试覆盖率提升
- Provider registry 修复（anthropic 指向错误 provider）
- Deprecated 代码清理
- Streaming 响应支持

## Technical Notes

- 核心规范文档路径：`docs/architecture/wasteland-spec.md`
- 现有文档保留但标注"参考实现记录，以 core spec 为准"
- 代码级 /info 别名修复涉及：`src/skills/skills/status-skill.ts`、`src/skills/skills/context-skill.ts`
- spawn-agent.ts 硬编码中文需要加入 i18n 系统
