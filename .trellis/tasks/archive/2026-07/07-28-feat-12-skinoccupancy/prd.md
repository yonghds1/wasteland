# feat: 增加 12 个新皮肤 + SkinOccupancy 占用管理

## Goal

把 wasteland 的角色皮肤从 3 个扩展到 15 个（增加 12 个 Mad Max: Fury Road 角色），并加 SkinOccupancy registry 让每次 spawn_agent 时从 subAgent 候选皮肤列表随机选一个、且同一时刻同一 skin 不被多个 subAgent 占用。

## What I already know

- 当前 3 个角色皮肤：`immortan-joe`（主 agent / 不挂 subAgent）、`nux`（researcher）、`furiosa`（developer + analyst，已有冲突——按"一个 skin 一个 subAgent"要求 furiosa 只能选一个 subAgent）
- `SubAgentSettings.skin?` 字段（之前 PR3 加）—— 改成 `skins?: string[]` 候选列表
- 皮肤结构：`src/skins/roles/<name>/{persona,roleUi,index}.ts`
- persona 全英文（之前决策 minimax 多语言 + 英文稳定）
- 已有 locales `{en,zh}.json` 加 `skins.{role}.{label,thinking,greeting,catchphrases,errorPrefix}` 节点
- spawn-agent.ts 已读 subAgentConfig.skin 注入 minimax persona

## Assumptions (temporary)

- 每次 spawn_agent 时从 subAgentConfig.skins 候选列表**随机**选一个（不轮询、不按上次）
- **Max 不属于任何 subAgent**，单独存在（settings.json 不用）
- 同一时刻同一 skin 不被多个 subAgent session 占用（避免 minimax 看到"两个人格"的混乱）
- 子 agent 失败 / 完成后**自动释放**占用（基于 `agent_completed` / `tool_failed` / `session_ended` event）
- 全候选被占用时 fallback `defaultRoleSkin = 'immortan-joe'`（不报错）
- 皮肤 label 用**英文名**（如 "Max"、"Bullet Farmer"），不意译

## Open Questions

- (已通过讨论收敛) 皮肤 label 用英文名
- (已收敛) Max 单独放置，不挂 subAgent
- (已收敛) 12 个新皮肤一次全做

## 决定 (ADR-lite)

**Context**: 当前 wasteland subAgent skin 选择是单一字段 skin?，缺乏灵活性 + minimax 看到同一 persona 时易混乱（两个 subAgent 都用 furiosa minimax 看到同样的 prompt 角色重叠）。

**Decision**:
- `SubAgentSettings.skins?: string[]`（候选列表，每次 spawn 随机选一个）
- `SkinOccupancy` registry（Map<skinId, sessionId>）防止同 skin 并发冲突
- 占用机制：spawn_agent 时 exclude 已占用 → 从剩余随机选 → 注册 → 子 agent 完成时释放
- 全占用 fallback：defaultRoleSkin = 'immortan-joe'（避免 subAgent 启动失败）
- Max 作为"独立"皮肤存在（settings.json 不引用）

**Consequences**:
- minimax 在每个 subAgent 看到不同 persona（每次随机）—— minimax 不会"同人格冲突"
- SkinOccupancy 简单 Map（in-memory）—— 进程崩溃时清空（可接受）
- skin 候选列表多了用户配置项（settings.json 的 subAgents[].skins[]）

## Requirements

### R1: 12 个新皮肤

每个皮肤 3 个文件：

**Max Rockatansky**（独立 — 不挂 subAgent，单独存在）
- `src/skins/roles/max/{persona,roleUi,index}.ts`
- persona: wasteland Max Rockatansky, lone survivor / silent analyst / survival-driven
- roleUi: labelKey = "skins.max.label" → "Max"

**researcher 候选（3 个，Max 已被占）**
- **Nux**（已有，保留）
- **The Bullet Farmer** —— 长距情报 / 弹药补给
- **The Valkyrie** —— 精英小队 / 战斗 / 精准

**developer 候选（3 个）**
- **Furiosa**（已有，保留）
- **The Organic Mechanic** —— 机械 / 修复 / 改造
- **Toast the Knowing** —— 档案 / 传承 / 代码历史

**analyst 候选（2 个 — Max 不挂）**
- **Miss Giddy** —— 教师 / 智者 / 记忆
- **Capable** —— 坚毅 / 行动力 / 可靠

**tester 候选（3 个）**
- **The Doof Warrior** —— 狂热 / 爆发 / 极限测试
- **Splendid Angharad** —— 母性 / 护守 / 敏锐
- **The Dag** —— 凶狠 / 激进 / 不妥协

总计 1 + 11 = 12 个新皮肤（含 Max 独立）

### R2: SkinOccupancy 机制

- `src/core/runtime/skin-occupancy.ts`（新）：
  - `Map<skinId, Set<sessionId>>`（同 skin 多 session 可同时持有）
  - `tryAcquire(skinId, sessionId): boolean` —— 注册占用
  - `release(skinId, sessionId): void` —— 释放
  - `getAvailable(skins: string[]): string[]` —— 排除已占用，返回可用列表
  - 全部占用时返回空数组（fallback defaultRoleSkin）

### R3: spawn-agent 改造

- `assembleSubAgentPrompt` 读取 `subAgentConfig.skins`（候选列表）而非 `subAgentConfig.skin`
- 调用 `SkinOccupancy.getAvailable(skins)` → 随机选一个
- 注册占用：`SkinOccupancy.tryAcquire(selected, childSessionId)`
- 子 agent 完成时释放：现有 `agent_completed` / `session_ended` event hook
- debug log 扩展：记录 `selectedSkin`、`availableCount`

### R4: settings-types + settings.json

- `SubAgentSettings.skins?: string[]`（候选列表，替代 skin?: string）
- `.wasteland/settings.json` 改 `subAgents[].skin` → `skins[]`：
  - researcher: ["nux", "BulletFarmer", "Valkyrie"]
  - developer: ["furiosa", "OrganicMechanic", "Toast"]
  - analyst: ["MissGiddy", "Capable"]
  - tester: ["DoofWarrior", "SplendidAngharad", "Dag"]
- Max 不在 settings.json（独立存在但不挂 subAgent）

### R5: locales + i18n

`src/locales/{en,zh}.json` 加 12 个新皮肤节点：
- `skins.max.{label,thinking,greeting,catchphrases,errorPrefix}`
- `skins.bullet-farmer.{...}`（key 用 kebab-case）
- `skins.valkyrie.{...}`
- `skins.organic-mechanic.{...}`
- `skins.toast.{...}`
- `skins.miss-giddy.{...}`
- `skins.capable.{...}`
- `skins.doof-warrior.{...}`
- `skins.splendid-angharad.{...}`
- `skins.dag.{...}`
- 中文 label 用英文名（user 决策）

### R6: 测试

- `test/skin-occupancy.test.js`（新）：占用/释放/全占用 fallback
- `test/theme-skin.test.js`（扩展）：12 个新皮肤 + 皮肤选择随机性
- 425+ → 435 测试期望

## Acceptance Criteria

- [ ] 12 个新皮肤文件（每个 3 个：persona / roleUi / index）—— Max 独立
- [ ] `src/skins/roles/index.ts` 注册表加 12 个新角色（defaultRoleSkin 仍为 'immortan-joe'）
- [ ] `SkinOccupancy` registry 实现 + 单测
- [ ] `spawn-agent.ts` 改造：从 `skins` 候选列表随机选 + 占用检查 + fallback
- [ ] `SubAgentSettings.skins?: string[]` 字段替代 `skin?: string`
- [ ] settings.json subAgents 改用 `skins` 列表
- [ ] locales 加 12 个新皮肤节点（en + zh）
- [ ] minimax 在每个 subAgent 看到不同 persona（每次随机）
- [ ] 425 + 10 新测试通过，typecheck + build + i18n 全绿
- [ ] minimax 在 thinking 里不再复读"人格冲突"（每个 subAgent 独立 persona）

## Definition of Done (team quality bar)

- Tests added/updated
- Lint / typecheck / i18n 校验 green
- skin 候选列表 + 占用机制有完整单测
- minimax persona 持续英文 + 跨语言稳定

## Out of Scope (explicit)

- 动态多主题（wasteland 固定废土）
- minimax persona 多语言版本
- 场景级（scenario）皮肤
- 子 agent 间皮肤共享（"两个 subAgent 协作"等）

## Technical Notes

- 改动文件：36 个新皮肤文件（12 × 3）+ SkinOccupancy 1 + spawn-agent.ts 改 + settings-types 改 + settings.json 改 + locales 加 24 个新 key（12 角色 × 2 语言 × 5 字段）
- `SkinOccupancy` in-memory Map（无持久化）
- 子 agent 完成 hook 现有 `agent_completed` / `session_ended` event，可释放占用
- 随机选择用 `Math.random()`（不需要 seedable RNG）

## Implementation PR 拆分

| PR | 内容 | 行数估算 |
|---|---|---|
| **PR1** | `SkinOccupancy` registry + 单测 | 80 |
| **PR2** | spawn-agent.ts 改造（`assembleSubAgentPrompt` 读 `skins` 候选 + 占用管理） | 100 |
| **PR3** | `SubAgentSettings.skins?: string[]` 字段 + settings.json 改用候选列表 | 30 |
| **PR4** | 12 个新皮肤文件（每个 3 个：persona / roleUi / index）—— Max 独立 | 500 |
| **PR5** | `src/skins/roles/index.ts` 注册表加 12 角色 | 30 |
| **PR6** | locales 加 12 角色 × 2 语言 × 5 字段 i18n 节点 | 200 |
| **PR7** | 测试：SkinOccupancy + 皮肤候选随机性 + 全占用 fallback | 200 |
| **PR8** | 文档更新（docs/architecture/role-skin.md + specs） | 50 |

**总计 ~1200 行**。按 PR 顺序实施。
