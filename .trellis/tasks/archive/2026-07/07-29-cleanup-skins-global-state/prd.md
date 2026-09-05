# refactor: 清理 skins 全局可变状态 + /skin load 持久化

## Goal

清理 `src/skins/index.ts` 的模块级可变状态（`_currentSkinId` / setCurrentSkin /
getCurrentSkin / loadSkin），让"当前皮肤"的单一事实来源回归 `runtime.skin`（由
`initializeRuntime` 从 `settings.runtime.skinId` 注入）。

让 `commands/skin.ts` 的 `/skin load <id>` 命令实际持久化所选皮肤到
`settings.runtime.skinId`，而不是写易失内存（当前重启后丢失的行为）。

## What I already know

**当前 3 套并行"皮肤选择机制"**：
1. `settings.runtime.skinId` （settings.json 配置）→ `initializeRuntime`
   读 `getSkin(runtime.skinId)` → 注入 `runtime.skin` 对象 → **TUI 渲染用**（权威）
2. `getCurrentSkinId() / setCurrentSkin()` （模块级 `_currentSkinId`）→ 仅
   `commands/skin.ts` 用 → **易失**，CLI 关闭后丢失
3. `subAgents[].skins[]` （sub-agent 配置）→ spawn-agent 的 `selectAndAcquireSkin`
   → 通过 `SkinOccupancy` → **子 agent 选 skin**（独立体系，不影响主 session）

**已验证的物理分离**：
- `roles/` ↔ `skins/` 零交叉引用
- `spawn-agent/` 是唯一耦合点：`defaultSkin as defaultRoleSkin` + `composeAgentPrompt(roleName)`
- TUI 完全走 `runtime.skin`，不读全局 `_currentSkinId`
- `loadSkin` 只被 `commands/skin.ts` 用，写的是模块级易失 state

**`commands/skin.ts` 现有命令**：
- `/skin list` —— 列所有
- `/skin show` —— 当前
- `/skin load <id>` —— 写易失 state（**当前不持久化**）
- `/skin info <id>` —— 详情

**`setCurrentSkin` 实际被 loadSkin 一调用方用**。

**Settings 持久化**：项目已有 `load-settings.ts` + `config-writer.ts` 的成熟读写
路径；`runtime.skinId` 字段已有 schema 校验（trim + 非空字符串）。

## Assumptions (temporary)

- 持久化到 `settings.runtime.skinId` 是合理目标（已经有该字段 + 校验 + 重启加载机制）
- 不需要新增"皮肤历史/撤销"功能（不在用户原始需求范围）
- 不需要强制热应用（写完 settings.json 就够了，下次启动生效；如要立即热应用可后续扩展）
- TUI 的 `runtime.skin` 是当前事实主源，模块级易失 state 应彻底删（最干净）

## Open Questions

- (待问) H1 清理方式 = 删除 vs 私有化（function 移除 export）
- (待问) /skin load 持久化策略：写 settings.json 直接覆盖 vs merge 配置？
- (待问) /skin load 行为契约：仅持久化（下次生效）vs 持久化 + 当前会话立即应用

## Requirements (evolving)

- `/skin load <id>` 把所选 skinId 持久化到 settings.json
- `settings.runtime.skinId` 启动时校验：必须是 `tuiSkins` 已注册 skin，否则给 warning + fallback 到 defaultSkin
- 删除 `setCurrentSkin` / `getCurrentSkin` / `loadSkin` 在 `skins/index.ts` 的 export
- 任何调用方（TUI/CLI/测试）改走 `runtime.skin`（如有需要通过 getSkin(id) 静态查）
- 451 测试 + 新增 skin-persistence 单测全绿

## Acceptance Criteria (evolving)

- [ ] `/skin load furiosa` 后，settings.json 的 `runtime.skinId === 'furiosa'`
- [ ] 重启后再次启动 CLI，runtime 仍为 furiosa（实际跑过 settings 重载路径）
- [ ] `skins/index.ts` 不再 export `setCurrentSkin` / `getCurrentSkin` / `loadSkin`
- [ ] `commands/skin.ts` 的 show 命令改走 `runtime.skin`（或新接口查持久化的皮肤）
- [ ] `setCurrentSkin` 删除后测试仍全绿（需关注是否有测试依赖）
- [ ] typecheck 干净

## Definition of Done (team quality bar)

- 单测覆盖持久化路径（写 settings + 重读）
- typecheck / lint 全绿
- /skin load 命令用户文档（commands.skin.* i18n）补"持久化"提示

## Out of Scope (explicit)

- TUI 内 hot-reload 立即应用（不动）
- 皮肤历史 / 撤销栈（不动）
- 多 profile 皮肤（per-project 不同 settings.json 已经是）
- 改 `runtime.skinId` 命名 / 类型
- 重命名 `roles/` -> `personas/`

## Technical Notes

- 关键文件：
  - `src/skins/index.ts` —— 删除 `let _currentSkinId` + `getCurrentSkinId` / `getCurrentSkin` / `setCurrentSkin` / `loadSkin`（L54-L63）
  - `src/commands/skin.ts` —— `/skin load` 重写为写 settings + 提示用户"重启生效"；`/skin show` 改走 runtime 或 getSkin
  - `src/core/shared/initialize-runtime.ts` —— 启动校验 settings.runtime.skinId 是注册 skin
  - `src/config/settings-types.ts` —— `runtime.skinId` 字段已存在
  - `src/config/load-settings.ts` —— 已有读取/校验代码（line 230-235, 499-501, 644-671）
  - `src/config/config-writer.ts` —— 已有 settings 写入能力
  - 现有 i18n key：`commands.skin.load.success` / `.error` / `.info`
- `composeAgentPrompt` 不涉及本次改动
- `SkinOccupancy` (src/core/runtime/skin-occupancy.ts) 不涉及本次改动
- `getSkin(name?: string)`（L42-45）—— 静态查，**保留**（仅删除当前皮肤 mutable 接口）

## Decision (ADR-lite)

*(待定 — 等待 PRD 收敛)*
