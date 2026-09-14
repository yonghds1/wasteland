# 统一 runtime 数值配置的「0 = 关闭」语义

## Goal

把「0 = 关闭」确立为本仓 runtime 数值配置的**统一约定**，取代目前"必须正整数、无法关闭"的单一校验。

起因：`09-14-doom-loop-detection` 引入 `runtime.doomLoopThreshold` 时需要"可关闭"，若各配置项各用各的关闭语义（有的没有、有的布尔、有的 0），配置面会碎掉。

**前提**：`doomLoopThreshold` 已在本约定确立前落地并采用 `0 = 关闭`，本任务负责把语义**对齐到其余项**（而非反过来）。

## What I already know

**先例已存在**：`multiAgent[name].maxRetries` 默认 `0`，语义即"不重试"（`src/config/settings-types.ts:148`）。说明 `0 = 关闭` 在本仓不是新发明。

**待评估清单**（`src/config/load-settings.ts` 现有校验位置）：

| 配置项 | 行 | 现校验 | 类别 |
|---|---|---|---|
| `runtime.maxStepsPerTurn` | 149 | 正整数 | **护栏** |
| `runtime.childAgentTimeout` | 161 | 正整数（毫秒） | **护栏** |
| `runtime.compactionBudgetRatio` | 178 | 0-1 比例 | 比例 |
| `runtime.compactionThreshold` | 192 | 0-1 比例 | 比例 |
| `runtime.summarizationThreshold` | 209 | 0-1 比例 | 比例 |
| `runtime.spinnerIntervalMs` | 291 | 正整数 | 呈现 |
| `runtime.typewriterRateMs` | 306 | 正整数 | 呈现 |
| `runtime.log.tailLines` | 361 | 正整数 | 呈现 |
| `multiAgent[name].maxRetries` | — | 默认 0 | 已符合 |
| `multiAgent[name].retryDelayMs` | — | — | 待查 |

## Requirements

- **分类处置，不做无差别统一**：
  - **呈现类**（`spinnerIntervalMs` / `typewriterRateMs` / `log.tailLines`）——关闭语义清晰（不转场 / 不逐字 / 不限行数），可直接采纳，逐个确认"关闭后的降级行为"是否合意。
  - **护栏类**（`maxStepsPerTurn` / `childAgentTimeout`）——**必须先论证再动手**。`0` 意味着**守卫整体消失**：无步数上限、子代理永不超时，与 doom-loop 的"刹车"性质相反。需明确：(a) 是否真的开放关闭；(b) 若开放，是否要求显式 opt-in 或输出警告；(c) 是否保留一个不可关闭的硬上限。
  - **比例类**（`compaction*` / `summarizationThreshold`）——**不适用**，`0` 是有意义取值而非"关闭"。保持不变，并在文档中写明为何不参与本约定。
- 统一后须在**同一处**给出约定说明（文档 + 类型注释），避免后续新配置项再次各写各的校验。
- 逐项验证：默认值行为不变；显式关闭后行为符合预期；非法值仍报错。

## Acceptance Criteria

- [ ] 形成一份逐项结论表：每项标注「采纳 0=关闭」/「不采纳」+ 理由
- [ ] 采纳项：校验改为允许 `>= 0`，`0` 触发关闭分支，且有对应单测
- [ ] 不采纳项：保持原校验，并在类型注释或文档中写明原因
- [ ] 护栏类给出明确决策（关闭 / 保持 / 关闭但带警告），不得默认放行
- [ ] `doomLoopThreshold` 的语义与最终约定一致（若约定推翻，同步修改该任务产物）
- [ ] 约定写入 `docs/user-guide/configuration.md` 与 `docs/architecture/configuration.md`
- [ ] `npm run check:fast` + `npx vitest run` 全绿
- [ ] 无回归：所有默认值下行为与改动前一致

## Out of Scope (explicit)

- 新增配置项（只处理既有项的语义统一）
- 配置项的组织结构 / 命名调整
- `settings-merge` / `settings-env-auth` 的重构（除非某单项必须改）
- 比例的语义（0-1 区间）本身

## Decisions (待定，规划阶段收敛)

1. **护栏类是否开放关闭** —— 本任务的核心待决项。倾向"不开放"（`maxStepsPerTurn` / `childAgentTimeout` 是防跑飞与防挂死的底线），但需用户确认。
2. **若不开放，约定是否仍称"统一"** —— 可能的最终形态是"**约定适用于可关闭类；护栏类显式豁免并注明**"，而非字面上的全量统一。

## Definition of Done

- 逐项结论表产出并被评审
- 采纳项实现 + 单测；不采纳项在文档中留痕
- 两处配置文档更新
- `npm run check:fast` / `npx vitest run` 全绿

## 备注

本任务优先级 P3 —— 属配置一致性整理，不阻塞功能。应先于"下一次新增 runtime 数值配置"完成，否则新项又会自立门户。
