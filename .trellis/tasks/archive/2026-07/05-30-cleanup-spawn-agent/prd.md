# spawn_agent 架构清理: 抽象化 tool-dispatch 特殊处理

## Goal

把 spawn_agent 在 tool-dispatch 里的特殊路径抽象为通用 hook / 适配层，使
"非常规 tool"（spawn_agent / 类似：长耗时、嵌套子 agent、需要转发事件）能
像普通 tool 一样注册，但保留其特殊行为（嵌套超时 / 事件转发 / 跨 session 占用）

## What I already know

- `src/tools/spawn-agent.ts` 现状 704 行，单文件承担多关注点：
  - Input schema (Zod)
  - 嵌套深度检查 (MAX_SPAWN_DEPTH = 3)
  - 子 agent 重试配置 (maxRetries / retryDelayMs)
  - 工具限定优先级 (subAgents.tools > minimax 传入 tools > 全部工具)
  - 模型选择 + alias 解析 (settings.models[])
  - Skin 候选列表 + SkinOccupancy 占用 (来自上一任务 07-28-skinoccupancy)
  - 组装子 agent system prompt (assembleSubAgentPrompt)
  - inheritHistory（父历史前缀拼装）
  - 事件转发 (spawnChildAgentForwarding$)
  - 子 agent 创建 + 超时 + 失败处理
- `src/core/runtime/tool-dispatch.ts` 现状 685 行：
  - L155-200 有 `handleSpawnAgent` 特殊处理器（pre-dispatch 阶段）
  - L415 `['spawn_agent', handleSpawnAgent]` 注册表
  - L504 注册查表 dispatch（特殊处理器优先）
- 2 个月里演化：增加了 subAgents[].skins、SkinOccupancy、agent_completed
  hook、prompt-assembler、model alias 解析、inheritHistory 等新关注点
  —— 全部塞进 spawn-agent.ts 单文件，没有按"hook 点"分层。
- 5-30 的命名："抽象化 tool-dispatch 特殊处理"——核心痛点是 spawn_agent
  不是普通 tool，它做了太多 dispatch 框架不该关心的事（创建子 agent、
  转发事件、跨 session 占用、嵌套深度），被堆到 tool-dispatch 的特殊路径里。

## Assumptions (temporary)

- 目标不是把 spawn_agent "降级" 成普通 tool，而是抽象 hook 让非常规 tool
  能接入 dispatch 框架而无需改 dispatch 内部。
- 现状可重构成 3 层：dispatch 框架 / tool 适配层 / spawn-agent 业务层
- 重构后 spawn-agent.ts 主业务文件应该瘦身（target < 400 行），新关注点
  按"组装 / 编排 / 转发"拆到对应文件
- 不破坏现有 451 测试、单 agent 调用行为不变

## Open Questions — 全部收敛

- (✓) 重构主轴 = **PR1 拆 spawn-agent.ts → PR2 抽 tool-dispatch hook**
- (✓) PR1 文件组织 = **子目录 `src/tools/spawn-agent/`**（index.ts 入口 + 子模块）
- (✓) PR2 hook 接口 = **Hook 对象 + 注册表** (`PreDispatchHook { matches, apply }`)
- (✓) PR1 主文件目标 **< 400 行**
- (✓) PR2 只迁移 spawn_agent，其他同类（暂无）保留接口待未来扩展

## Requirements (evolving)

- spawn_agent 调用行为不变（最小外部可见改动）
- 451 测试 + typecheck + lint 全绿
- tool-dispatch 对 spawn_agent 的"特殊"暴露成显式 hook / 装饰器
- spawn-agent.ts 按"组装 / 编排 / 转发"拆分子模块
- 新关注点（重试 / model alias / skin 占用 / 嵌套深度）独立可测

## Acceptance Criteria (evolving)

- [ ] tool-dispatch 不再有 spawn_agent 字符串特殊分支（用注册/装饰/hook 替代）
- [ ] spawn-agent.ts 主业务 < 400 行，关注点拆到独立文件
- [ ] 现有 451 测试不需修改就全绿
- [ ] spawn_agent 行为不变（手动 e2e 不变）
- [ ] 新增 spawn_agent 子关注点（retry/model-alias/skin/嵌套）独立单测

## Definition of Done (team quality bar)

- Tests added/updated
- Lint / typecheck / 全部 green
- spawn_agent 外部行为不变（兼容）
- docs/architecture/role-skin.md 或新 spawn-agent-design.md 描述新分层

## Out of Scope (explicit)

- 改变 spawn_agent 工具 schema（minimax 调用方不动）
- subAgentSettings.skins / SkinOccupancy 重做
- tool-dispatch 整个重写（只动 spawn_agent 相关路径）
- 新增 spawn_agent 功能（重试策略除外）

## Decision (ADR-lite) — 主轴决策已收敛

**Context**: spawn-agent.ts 704 行混杂 10+ 关注点；tool-dispatch.ts 仍有
spawn_agent 字符串特殊分支（5-30 时既有痛点）。

**Decision**: 重构分两个 PR 顺序推进
- **PR1（拆 spawn-agent.ts）**：
  - 文件组织 = **子目录 `src/tools/spawn-agent/`**
  - 主文件目标 **< 400 行**（index.ts 入口 + thin orchestration）
  - 子模块：input-parser / context-builder / event-forwarder / skin-acquirer
- **PR2（抽 tool-dispatch hook）**：
  - 接口形式 = **Hook 对象 + 注册表**（`PreDispatchHook { matches, apply }`）
  - 仅迁移 spawn_agent（其他同类保留接口待未来扩展）

**Consequences**:
- spawn_agent 外部行为不变（最小外部可见改动）
- 451 测试不变
- PR1 → PR2 顺序：先稳单文件拆分，再动框架
- import 路径变化：`src/tools/spawn-agent.ts` → `src/tools/spawn-agent/index.ts`
  （仅 repo 内部，不影响 minimax 调用方）
- 未来非常规 tool 走 hook 接入（接口已留）

## Implementation Plan

**PR1: spawn-agent 子目录拆分**
1. 创建 `src/tools/spawn-agent/` 目录结构
2. 把 spawn-agent.ts 的关注点拆到子模块文件：
   - `index.ts`（< 400 行）：main forwarder + orchestration
   - `input-parser.ts`：Zod schema + 嵌套深度 + subAgentConfig tools merge + model alias 解析 + 重试配置
   - `context-builder.ts`：inheritHistory 拼装 + system prompt 组装
   - `event-forwarder.ts`：spawnChildAgentForwarding$ 主 Observable + 事件转译
   - `skin-acquirer.ts`：collectSubAgentSkins + selectAndAcquireSkin 包装
   - `types.ts`：SpawnAgentContext / 子关注点的独立类型
3. 在 `src/tools/index.ts` 等处更新 import 为 `from './spawn-agent/index.js'`
4. 跑测试，451 全绿

**PR2: tool-dispatch PreDispatchHook 抽象**
1. 创建 `src/core/runtime/pre-dispatch-hook.ts`：`PreDispatchHook` 接口定义
2. 在 `src/core/runtime/tool-dispatch.ts`：
   - 删除 155-200 行 `handleSpawnAgent` 字符串特殊分支
   - 引入 `preDispatchHooks: PreDispatchHook[]` 注册表
   - dispatch 主流程：对每个 hook 调一次 `matches` + `apply`
3. spawn-agent 子模块提供 `spawnAgentHook` 对象，注册到全局注册表
4. 跑测试，451 全绿
5. 更新 `docs/architecture/spawn-agent-design.md` 描述新分层

## Technical Notes

- spawn-agent.ts 当前关注点（704 行）：
  1. Zod schema + 类型 (228-241)
  2. 校验 + depth 限制 (293-324)
  3. 重试配置 (328-332)
  4. tools merge 优先级 (334-343)
  5. model 选择 + alias 解析 (345-362)
  6. skin 候选收集 + 占用 (364-378)
  7. system prompt 组装 (380-387)
  8. inheritHistory 拼装 (389-...)
  9. 事件转发主入口 (defer → createChildSession → runAgentLoop)
  10. 子 agent 超时 + retry + 错误返回
- tool-dispatch 的 handleSpawnAgent 特殊处理 (155-200) 实际做的是
  "pre-dispatch gate"（permission 评估 + subAgents[name].maxRetries 转换
  为 retry 参数）——这部分如果不是 spawn_agent 独有，可抽象成通用
  tool-pre-dispatch-hook
- 历史 commit：`7e6a92a feat: spawn_agent 风险等级 / maxRetries / provider 切换`
  7-28-skinoccupancy (archived) → spawn-agent.ts 已经能读 subAgents[].skins
- 相关 spec：
  - `.trellis/spec/backend/tool-runtime-contracts.md` (spawn-agent 合约)
  - `.trellis/spec/frontend/state-management.md` (SkinOccupancy)
