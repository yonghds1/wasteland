# doom-loop 检测：给 agent loop 加第 3 步刹车

## Goal

在 agent loop 中检测模型**重复调用同名同参工具**（连续 3 次），命中时短路本轮并回灌提示。

现状只有 `maxStepsPerTurn = 30` 的粗兜底——它确实会停，但**要先把 30 步全付完**。而每一步都是一次完整 LLM 调用，且历史递增使每步比上一步更贵，所以 doom loop 的真实成本可达正常一轮的 10~50 倍，且**全程无报错、界面只在转圈**。

目标是把"静默烧 30 步"变成"第 3 步停下来并说明原因"。

## What I already know

**问题面**

- `maxStepsPerTurn` 默认 30（`src/config/settings-types.ts:376`、`src/config/config-writer.ts:269`），可用 `WASTELAND_MAX_STEPS_PER_TURN` 覆盖（`src/config/settings-env-auth.ts:232`）
- 守卫实现 `checkMaxStepsExceeded`（`src/core/engine/loop-helpers.ts:135`）：`state.step <= maxStepsPerTurn` 时返回 `null`，否则 `failTurnState` + trace + `persistAssistantMessage`
- 消费点 `src/core/engine/turn-executor.ts:127`：`if (maxStepsExceeded$) return maxStepsExceeded$;` 短路，不再走 provider
- **无任何重复调用检测**：全仓 grep `doom|repeatedTool|sameTool|identical` 无命中

**可复用的现成件**

- `TurnState.toolCalls: readonly ToolCall[]`（`src/core/engine/turn-state.ts:29`）——**本 turn 内全部工具调用已累积**，正是判据所需的数据
- `recordToolCall(state, call)`（`src/core/engine/turn-state.ts:87`）在 `turn-executor.ts:413` 的 `processProviderTail` 内被逐条调用——**天然挂载点**
- 消息走 i18n：`buildMaxStepsMessage`（`src/core/engine/turn-helpers.ts:110`）→ `t('runtime.maxStepsReached')`，字典在 `src/locales/{en,zh}.json:1028`
- trace 约定：`phase: 'turn.max_steps'`，消费方为 TUI 调试页

**外部参照**

- opencode `packages/opencode/src/session/processor.ts`，`DOOM_LOOP_THRESHOLD = 3`：取 `parts.slice(-3)`，三者 `part.tool === value.name` 且 `JSON.stringify(part.state.input)` 相等即判定；命中后走 `permission.ask({ permission: 'doom_loop' })` **升级询问用户**
- Claude Code 无对应机制（其 harness 层靠 maxTurns）

## Requirements

- **判据为纯函数**。形如 `isDoomLoop(toolCalls, call): boolean`，无 RxJS、无副作用，可直接单测。
  - 连续 3 次（含本次）同名**且**同参才算命中
  - 参数比较须**顺序无关**（对 input 做稳定序列化，勿直接裸用 `JSON.stringify`，键序不同会漏判）
  - 连续段被任何一次不同调用打断即重置
- **外壳为 `Observable<RuntimeEvent> | null`**，1:1 对齐 `checkMaxStepsExceeded` 的形状：`null` = 放行，有值 = 接管本轮。不引入新范式。
- **挂载点在 `turn-executor.ts:413` 的 `recordToolCall` 之后、dispatch 之前**，短路方式与步数守卫一致（`if (doomLoop$) return doomLoop$;`）。
- **命中动作：短路本轮 + 持久化一条说明消息**（复用 `failTurnState` + `persistAssistantMessage`），消息需点明"同一工具同一参数已连续调用 N 次"以给模型自纠信号——**N 取当前生效阈值，不得写死 3**。
  - **不做** `permission.ask` 式交互询问（见下方 Decisions）
- **仅在本 turn 内检测，不跨 turn**。跨 turn 的重复由用户驱动，属意图而非死循环。
- **i18n 必须同步**：新增 `runtime.doomLoopDetected` 到 `src/locales/en.json` 与 `src/locales/zh.json`。
- **trace 事件**：`phase: 'turn.doom_loop'`，data 含 `tool` 与 `callCount`，与 `turn.max_steps` 风格一致。
- **必须可配置，且带默认值**——与 `maxStepsPerTurn` 同等对待，接入完整配置体系：
  - 新增 `runtime.doomLoopThreshold`，**默认 3**
  - 环境变量覆盖 `WASTELAND_DOOM_LOOP_THRESHOLD`
  - **`0` 表示关闭检测**（见 Decisions 5）
  - 覆盖全部 8 处接线点（见 Technical Notes），一处不漏

## Acceptance Criteria

- [x] **默认阈值下**连续 3 次同名同参工具调用触发短路，本轮不再发起 provider 调用
- [x] 连续 2 次不触发；第 3 次不同参数不触发；中间插入任意不同调用后计数重置
- [x] 阈值改为 5 时，第 3、4 次不触发，第 5 次才触发（阈值真的生效，非写死 3）
- [x] 参数键序不同但语义相同的两次调用**判定为相同**（稳定序列化生效）
- [x] 命中的 tool 名与次数出现在持久化消息中，模型可在下一轮看到
- [x] trace 发出 `turn.doom_loop`
- [x] `runtime.doomLoopDetected` 在 en/zh 两份字典均存在，`npm run check:i18n` 通过
- [x] **`runtime.doomLoopThreshold` 默认值为 3**：不写任何配置时按 3 生效
- [x] **配置可覆盖**：`settings.json` 写 `"doomLoopThreshold": 5` 后阈值变 5
- [x] **环境变量可覆盖**：`WASTELAND_DOOM_LOOP_THRESHOLD=5` 生效，优先级高于配置文件
- [x] **`WASTELAND_DOOM_LOOP_THRESHOLD=0` 关闭检测**，此时行为与改动前完全一致
- [x] 非法值（负数 / 非整数 / 非数字）在加载时报错，错误信息含配置项名与来源
- [x] 单测覆盖判据纯函数（含边界：0/1/2 次、键序、重置）
- [x] 单测覆盖配置解析（默认值 / 文件覆盖 / env 覆盖 / env 关闭 / 非法值报错）
- [~] `npm run check:fast` + `npx vitest run` 全绿 —— **vitest 全绿**（111 文件 / 1544 通过 / 3 跳过）；`check:fast` 非全绿，唯一 error 是 `src/tools/agent/spawn-agent/__tests__/sidecar.test.ts:73` 的 `no-dynamic-delete`，已在 HEAD 复现确认为 `7373a8c` 遗留，与本任务无关
- [x] 未超步数限制时行为与改动前完全一致（无回归）

## Out of Scope (explicit)

- **`fetchWithRetry` 错误分类扩展**（`src/providers/shared/retry.ts` 现仅认 429/503/网络，缺 500/502/504/overloaded 等）——独立小改动，另开任务
- `background` 异步子代理（需处理 session 写入竞态与 `/resume` 语义）
- 工具并发元数据（`turn-executor.ts:436` 硬编码 spawn=merge / 其他=concat）
- JS 沙箱编排层
- 流程图 / DSL 类方案——本仓已明确不采用
- 按工具类型分别配置阈值（如 read 类豁免）

## Decisions (已定，评审时确认)

1. **阈值 3**——对齐 opencode；且 `maxStepsPerTurn=30` 意味着现状要付 10 倍成本才停。
2. **动作取"短路+回灌"而非"询问用户"**。opencode 用 `permission.ask`，因为它有 `permission: 'doom_loop'` 的完整权限管道。本仓复用 `checkMaxStepsExceeded` 的形状成本最低、且不引入新机制；回灌消息给模型保留了自纠机会，通常比直接中断更省。
3. **判据用纯函数而非 RxJS 操作符**。依据 `.trellis/spec/backend/index.md`："Do not force RxJS into simple synchronous transforms where plain functions or plain objects are clearer." 检测是同步谓词，只有"命中后终止流"那层是流操作。
4. **不跨 turn**。`state.toolCalls` 天然按 turn 累积，正好匹配。
5. **`0` = 关闭检测**（2026-09-14 用户确认）。与 `maxStepsPerTurn` 的"必须正整数"校验**故意不同**。理由：doom-loop 检测存在合法误报（轮询构建、等文件出现等重复调用），用户需要一个干净的关闭开关；本仓布尔开关（`projectMemory` / `contextSummarization`）是既有惯例，但新增一个布尔 + 一个数值等于两个配置项，不如让数值 `0` 兼任关闭。
   - 先例：`multiAgent.maxRetries` 默认 `0` 即"不重试"，`0 = 关闭` 并非新发明。
   - **本任务只覆盖 `doomLoopThreshold`**；把该约定推广到其余 runtime 数值配置由 `09-14-zero-disables-convention` 负责（P3）。**注意护栏类豁免**——`maxStepsPerTurn` / `childAgentTimeout` 的 `0 = 关闭` 等于护栏消失，不适用本约定。

## Definition of Done

- 单测新增/更新（判据纯函数 + 守卫集成）
- `npm run check:fast`、`npx vitest run` 全绿
- i18n 两语字典同步，`check:locale-parity` 通过
- 行为变更记入 `.trellis/spec/backend/runtime-contracts.md`

## Technical Notes

形状参照（`loop-helpers.ts:135` 现有守卫，勿改其行为）：

```ts
export function checkMaxStepsExceeded(params: {...}): Observable<RuntimeEvent> | null {
  if (params.state.step <= params.maxStepsPerTurn) return null;  // 放行
  ...failTurnState / trace
  return persistAssistantMessage({...});                          // 接管
}
```

新增 `checkDoomLoop` 与之并列，内部首行调用纯函数判据。

### 配置接线点（照 `maxStepsPerTurn` 逐处对齐，共 8 处 + 3 处文档）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/config/settings-types.ts:189` | raw runtime 类型加 `doomLoopThreshold?: number` |
| 2 | `src/config/settings-types.ts:311` | resolved runtime 类型加 `doomLoopThreshold: number` |
| 3 | `src/config/settings-types.ts:376` | `DEFAULT_WASTELAND_SETTINGS.runtime.doomLoopThreshold: 3` |
| 4 | `src/config/load-settings.ts` | 校验块（整数且 `>= 0`），错误信息含来源路径 |
| 5 | `src/config/settings-merge.ts` | `next.runtime?.doomLoopThreshold ?? base.runtime.doomLoopThreshold` |
| 6 | `src/config/settings-env-auth.ts` | 读 `WASTELAND_DOOM_LOOP_THRESHOLD`，非法值报错 |
| 7 | `src/config/config-writer.ts:269` | `setup` 生成的初始配置写入该项 |
| 8 | `agent-loop.ts` / `turn-executor.ts` / `run-agent-helpers.ts` / `commands/chat.ts` | 参数透传链：从 `loadedSettings.settings.runtime` 读到 guard |

文档同步（3 处）：

- `docs/user-guide/configuration.md:147` — 配置表格加一行
- `docs/architecture/configuration.md:124` — 配置项说明加一条
- `README.md:317` — 配置示例（视情况，示例不必列全）

`agent-loop.ts:223` 现有 `params.maxStepsPerTurn ?? 30` 兜底写法，新参数照做（`?? 3`）。
