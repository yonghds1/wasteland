# brainstorm: 让 subAgents 配置真正生效（角色 prompt + 工具限定）

## Goal

让 `settings.subAgents[name]` 的 `promptVariables`（role / goal / backstory / tools / constraints）真正注入到子 agent 的 system prompt + 工具集。当前 `spawn-agent.ts` **完全忽略**这些字段，minimax 在子 agent 里只能"角色扮演"researcher，导致 thinking 暴露、输出混乱（"高球 这是啥?"）。

## What I already know

- `src/tools/spawn-agent.ts` 的 `execute` 流程：
  - 解析 input（name / task / model / tools / inheritHistory）
  - `createChildSession` → `runAgentLoop` → `events$`
  - `lastValueFrom(events$.pipe(filter assistant_message, take 1, timeout))` 拿结果
  - 不读 `loadedSettings.subAgents[childName]`
- `src/core/runtime/agent-loop.ts` 的 `runAgentLoop` 已有 `prompt?: string` 参数（之前 #4 修复时加过）
- `src/prompts/prompt-assembler.ts:178` 把 `context.tools?.join(', ')` 注入 `__tools` 变量
- `src/prompts/role-templates.ts:51` 的 role-worker template 含 `{{tools}}` 占位符
- `settings.subAgents.researcher.promptVariables` 含：role / goal / backstory / constraints / tools（逗号分隔字符串如 `"read-file, glob, grep, list-directory, web-fetch"`）
- 用户上次测试：minimax 主动传 `tools: ["web-search", "web-fetch"]` → 工具限定生效（但 minimax 不传则全部 13 个工具）
- 模型一致已修复（所有 subAgents.model 改为 `minimax_model`）

## Assumptions (temporary)

- minimax 接受外部传入的 system prompt 并按其约束行为（待验证）
- `prompt-assembler` 已支持 `role-worker` template + promptVariables 合并（待验证）
- `runAgentLoop` 的 `prompt` 参数能完整传给 provider（minimax OpenAI 协议下 system message）

## Open Questions

- Q1（已答）：**工具限定优先级 = subAgents.tools 优先**（A）— minimax 传入的 tools 被忽略
- Q2（已答）：**模型优先级 = subAgentConfig.model 优先**（A）— 与 tools 一致
- Q3（已答）：**主 agent minimax 工具集 = 核心 [spawn_agent, read-file, bash]**（方案 2）— 减少 minimax 决策压力，其他工具全交给子 agent
- Q4（默认）：**inheritHistory** 走 minimax 传入值（默认 false）；**subAgentConfig 缺失时** 降级为 minimax 传入 + 无 prompt 注入；**workflow 字段没设** 走 ROLE_WORKER defaults

## 决定（ADR-lite）

**Context**: minimax (MiniMax-M3) 是小模型，工具越多决策越乱。当前主 agent minimax 拥有全部 13 个工具 + 4 个 subAgents 完全没生效（spawn-agent.ts 不读 subAgents.promptVariables）。

**Decision**:
- **主 agent 工具集最小化** = `[spawn_agent, read-file, bash]`（其他工具放子 agent）
- **subAgents 配置真正生效** = spawn-agent.ts 读 `loadedSettings.subAgents[name]`，注入 prompt + 工具限定
- **配置优先于 minimax 输入** = subAgents.tools/model 优先于 minimax 传入的 tools/model

**Consequences**:
- minimax 决策更聚焦（少工具）
- 子 agent 收到 researcher/developer 角色 prompt（不再"角色扮演"）
- minimax 在 thinking 暴露 "ROOT_SYSTEM_POLICY" 概率降低
- minimax 工具选择更准（不调无关工具）
- 风险：inheritHistory false 时子 agent 看不到父历史（但 minimax 通常不传，默认 false）

## Requirements (evolving)

- spawn-agent.ts 读 `loadedSettings.subAgents[childName]` 配置
- 解析 `promptVariables.tools` 字符串为 `string[]`，作为工具限定
- 用 `promptTemplate` + `promptVariables` 组装 system prompt，传给 `runAgentLoop.prompt`
- 工具限定优先级：subAgents.tools > minimax 传入的 tools > 全部工具
- 重试机制保持（maxRetries）

## Acceptance Criteria (evolving)

- [ ] spawn-agent.ts 读 subAgents 配置并注入 prompt
- [ ] minimax 调 spawn_agent("researcher") 时，子 agent 收到 researcher 角色 system prompt
- [ ] 子 agent 工具限定为 `subAgents.researcher.promptVariables.tools`（逗号解析为数组）
- [ ] minimax 在 thinking 里不再复读 "ROOT_SYSTEM_POLICY"
- [ ] minimax 工具选择更准确（不调无关工具）
- [ ] **主 agent 工具集最小化为 `[spawn_agent, read-file, bash]`**（其他工具从 builtinTools 移除或加权限限定）
- [ ] 现有 410 测试通过
- [ ] 新增至少 2 个测试：subAgents 配置注入 + 主 agent 工具集最小化

## Definition of Done (team quality bar)

- Tests added/updated
- Lint / typecheck / CI green
- Debug log 记录 subAgentConfig 实际生效（已加 `kind: "spawn_agent"` 日志，扩展字段）
- Docs/notes updated

## Out of Scope (explicit)

- 主 agent 的 system prompt 改写（工单 2：minimax 行为约束）
- minimax 自身的输出质量改进（无法控制）
- web-search 工具失败 → web-fetch fallback（minimax 自己在做）

## Technical Notes

- 改动集中在 `src/tools/spawn-agent.ts`（~50-80 行）
- 可能需要扩展 `src/prompts/prompt-assembler.ts`（如果不支持 `role-worker` + `promptVariables` 组合）
- `runAgentLoop` 已支持 `prompt` 参数
- 需新增 debug log 字段记录 `subAgentPrompt`、`subAgentTools`
- 当前 396+14+1=411 测试通过
