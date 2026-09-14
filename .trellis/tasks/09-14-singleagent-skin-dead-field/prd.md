# 清理 settings.json 的 singleAgent.skin 死字段

## Goal

`09-14-doom-loop-detection` 之后的 `d1e2345` 把 single 模式皮肤的真源改成 `skins.json` 的 `singleAgent.skin`（`initialize-runtime` 改读 `getSingleAgentSkin()`）。此后 `settings.json` 的 `singleAgent.skin` **只写不读**：

- `config-writer` 仍写入（`setup` 生成）
- `validate-settings` 仍校验
- `settings-merge` 仍合并
- **零消费方**

这与本次会话清理的其它问题同类（"写了但没人读"），且正是当初皮肤默认值混乱的根源之一——同一件事有两个地方声明。

本任务决定并执行清理。

## What I already know

**已确认零消费（`d1e2345` 后 grep 验证）**

- `settings.json` 的 `singleAgent.skin` 唯一读取点曾是 `initialize-runtime.ts:175`，现已改为 `getSingleAgentSkin()`
- `src/skins/index.ts:50` 的 `registerSingleAgent(singleAgent.skin)` 读的是 **`skins.json`** 的字段，是不同的对象，不受影响

**写入 / 校验点**

| 位置 | 行为 |
|---|---|
| `src/config/settings-types.ts:169` | raw runtime 类型：`singleAgent?: { model?, skin?, promptTemplate? }` |
| `src/config/settings-types.ts:299` | resolved 类型，同上 |
| `src/config/config-writer.ts:226-232` | `setup` 写入 `singleAgent: { model, skin: skinId, promptTemplate }` |
| `src/config/config-writer.ts:281-287` | 另一分支同样写入 |
| `src/config/validate-settings.ts:170-192` | `validateSingleAgentSettings` 读取并校验 `skin` |
| `src/config/settings-merge.ts:123-126` | 字段级浅合并 singleAgent（泛型，未单独处理 skin） |

**受影响的测试**

- `config-writer.test.ts:74`（`input.skinId` → `settings.singleAgent.skin`）、`:100`（SAMPLE_INPUT 断言含 `skin: 'warlord-immortal'`）
- `loaded-settings.test.ts:198,203`（loader 保留 `skin`）
- `load-settings.test.ts:129,142-148`（合并断言含 `skin`）
- `resolve-chat-runtime.test.ts:123`（用 `skin` 作填充值，非断言）

**文档**

- `docs/user-guide/configuration.md` 的向导骨架段与 `singleAgent` 示例含该字段

## Requirements

- 二选一并执行（见 Decisions）。**不做**"保留字段但继续不读"——那正是本任务要消除的状态。
- 若移除：`config-writer` 不再写入该键、`validate-settings` 不再接受、类型声明去掉、受影响测试与文档同步。
- `input.skinId`（`InitWizardInput.skinId`）**保留**——它仍驱动 `runtime.skinId` 与 `multiAgent.main.skin`，不是死参数。
- `skins.json` 的 `singleAgent.skin` 不受影响（它是真源）。
- 兼容性：现有用户配置中残留的 `singleAgent.skin` 不得导致加载失败（未知/多余键应被忽略而非报错）。

## Acceptance Criteria

- [x] `settings.json` 的 `singleAgent.skin` 不再有任何"写入但无消费"的状态（按选定方案消解）
- [x] `initialize-runtime` 的 single 模式皮肤解析行为**无变化**（仍取 `skins.json` 的 `singleAgent.skin`）——该文件在本次 diff 中**零改动**
- [x] 现有含 `singleAgent.skin` 的用户配置仍能正常加载（若选移除方案）——`load-settings.test.ts:140` 单测覆盖，并对本机真实的 `.wasteland/settings.json`（仍含 `skin: warlord-stern`）做了实机 smoke，静默丢弃、不抛错
- [x] 受影响测试全部更新且通过；`npx vitest run` 全绿（111 文件 / 1545 通过 / 3 跳过）
- [x] `npm run typecheck` 通过
- [x] 文档同步（`docs/user-guide/configuration.md` 及相关示例）——另同步了 `multi-agent.md`
- [x] `input.skinId` → `runtime.skinId` / `multiAgent.main.skin` 的链路仍被测试覆盖（`config-writer.test.ts` 断言两者随 `skinId='scout'` 变化）

## Out of Scope (explicit)

- `skins.json` 的 `singleAgent.skin` 语义（它是真源，本任务不动）
- 「0 = 关闭」约定的推广（见 `09-14-zero-disables-convention`）
- 本地 `.wasteland/` 配置的陈旧内容（用户本地状态，非仓库问题）

## Decisions (待评审确认)

**方案 A（推荐）：移除该字段**

`settings.json` 的 `singleAgent` 只保留 `model` / `promptTemplate`；皮肤一律由 `skins.json` 说了算。

理由：
- 用户已在 `d1e2345` 决定"single 模式读注册表而非 settings.json"，移除是它的自然收尾
- 皮肤配置归 `skins.json`、角色配置归 `roles.json`——这已是本仓的既有分工（`docs/architecture/role-skin.md` 的"角色与皮肤解耦"）。settings.json 再持有一份皮肤字段与该分工冲突
- 当初的默认值混乱正源于"同一件事两处声明"

**方案 B（备选）：改为显式覆盖语义**

`initialize-runtime` 用 `singleAgentConfig?.skin ?? getSingleAgentSkin()`，让 settings.json 可覆盖 `skins.json` 的默认。

代价：`config-writer` 必须**停止写入兜底值**（否则 setup 后 `warlord-immortal` 会一直覆盖 `road-nomad`），否则全等于 A 但多留一个键。且会让 `singleAgent.skin` 与 `runtime.skinId` 语义重叠，读者容易混。

**倾向 A。** 若评审选 B，需在 PRD 补一条"覆盖优先级"契约并补测。

## Definition of Done

- 选定方案落地；受影响的类型 / 写入 / 校验 / 测试 / 文档全部同步
- `npm run typecheck`、`npx vitest run` 全绿
- 行为变更（若有）记入 `.trellis/spec/backend/runtime-contracts.md`

## 备注

P3。属配置一致性整理，不阻塞功能。与 `09-14-zero-disables-convention` 同属"配置语义整理"批次，可一并推进。
