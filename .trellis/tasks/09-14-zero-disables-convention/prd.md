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

## Decisions (2026-09-14 收敛)

**核心判据（本任务的主要产出）**

> **「0 = 关闭」只适用于「计数类」配置**——0 个 = 不做。其余类别不适用：
> - **时长/间隔类**：`0ms` 无意义或歧义，用户要的是"关掉这个效果"，那是独立布尔开关的职责，不是把速率设成 0
> - **护栏类**：`0` 等于护栏**失效**（无上限 / 永不超时），与"关闭"完全相反
> - **区间类**：`0` 在值域外或无意义（比例项的 `(0,1]`）

**逐项结论表**

| 配置项 | 现校验 | `0` 的含义 | 结论 |
|---|---|---|---|
| `doomLoopThreshold` | `>= 0` | 关闭检测 | ✅ **已是此语义**（`09-14-doom-loop-detection` 落地） |
| `multiAgent.maxRetries` | 无校验，默认 `0` | 不重试 | ✅ **已是此语义**（既有先例，计数类） |
| `maxStepsPerTurn` | `> 0` | 无步数上限 | ❌ 不采纳 —— 护栏消失 |
| `childAgentTimeout` | `> 0` | 永不超时 | ❌ 不采纳 —— 护栏消失 |
| `spinnerIntervalMs` | `16..1000` | 每 0ms 换帧 | ❌ 不采纳 —— 16ms 下限是**刻意**设的，0 无意义 |
| `typewriterRateMs` | `5..200` | 瞬间输出 | ❌ 不采纳 —— 5ms 下限是刻意设的；"关闭打字机"应是独立布尔，不是速率设 0 |
| `log.tailLines` | 正整数 | "不显示"还是"全部"？ | ❌ 不采纳 —— 语义歧义（`0 = 全部` 是另一套约定，不混用） |
| `compactionBudgetRatio` | `(0,1]` | 区间外 | ➖ 不适用 |
| `compactionThreshold` | `(0,1]` | 区间外 | ➖ 不适用 |
| `summarizationThreshold` | `(0,1]` | 区间外 | ➖ 不适用 |

**因此本任务无新增采纳项**——现有两处已符合，其余按判据均不适用。产出为**判据 + 结论表 + 文档留痕**，防止后续新增配置项时各立门户。

已确认护栏类**不开放**（原核心待决项）：`maxStepsPerTurn` / `childAgentTimeout` 是防跑飞与防挂死的底线，`0` 会让它们失效。

**同步修订**：`doomLoopThreshold` 的 `0 = 关闭` 不再表述为"与 `maxStepsPerTurn` 故意不同"的特例，而是**计数类判据下的自然结果**（`09-14-doom-loop-detection` 的 PRD Decision 5 依此措辞修正）。

## Definition of Done

- 逐项结论表产出并被评审
- 采纳项实现 + 单测；不采纳项在文档中留痕
- 两处配置文档更新
- `npm run check:fast` / `npx vitest run` 全绿

## 备注

本任务优先级 P3 —— 属配置一致性整理，不阻塞功能。应先于"下一次新增 runtime 数值配置"完成，否则新项又会自立门户。
