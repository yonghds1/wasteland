# spec 对账：backend/runtime-contracts.md

## Goal

核验 `.trellis/spec/backend/runtime-contracts.md`（926 行）中**关于本仓库客观状态**的断言并修正。

方法与判据**继承父任务** `09-15-spec-fact-reconciliation-rollout` 的 R1 / R1b / R2 / R3 / R4 / R5
（判据、须显式标注"要求 vs 现状"、不许抽查、整段拆条、只改事实、产出可独立复核的对账表）。

## 文件特征（与试点不同，须注意）

本文件是**契约型**：7 个 `## Scenario:`，每个基本套用 7 段模板
（Scope/Trigger、Signatures、Contracts、Validation & Error Matrix、Good/Base/Bad、Tests Required、
Wrong vs Correct）。因此核验对象不只是"文件是否存在"，还包括**签名与契约是否仍与代码相符**
——读者会照着这些签名写代码，过期后果比存在性型更重。

7 个 scenario：Phase 1 chat runtime skeleton（L7）、subAgent system prompt 透传（L354）、
runAgentLoop 调用收敛（L444）、context compaction token 预算（L513）、
OpenAI-compatible reasoning round-trip（L629）、UserInputBridge FIFO 认领（L734）等。

## 已完成的分诊（起点，非结论）

对文档中引用的 21 个 `.ts` 路径做了存在性扫描，**6 个已失效**：

| 失效路径 | 实况 |
|---|---|
| `src/commands/chat.test.ts` | 已迁至 `src/commands/__tests__/chat.test.ts` |
| `src/core/runtime/context-manager.ts` | 已迁至 `src/core/memory/context-manager.ts` |
| `src/core/runtime/__tests__/context-manager.test.ts` | 已迁至 `src/core/memory/__tests__/` |
| `src/tui/hooks/runtime-reducers/tool-reducer.test.ts` | 已迁至同级 `__tests__/` |
| `src/tui/hooks/useRuntime.test.ts` | 已迁至同级 `__tests__/` |
| `src/tui/components/ChatInputBar.test.ts` | **两个位置都不存在**——需追查是改名、删除，还是文档臆造 |

分诊只覆盖路径存在性，**不构成对签名与契约的核验**——后者是本任务的主体工作量。

## Requirements

- **R1**：7 个 scenario 的每一段都逐条进对账表（父任务 R3：整段拆条，不许"看起来还行"就跳过）。
- **R2**：签名与契约类断言（`### 2. Signatures` / `### 3. Contracts`）必须**对照真实实现**核验：
  函数是否仍存在、参数与返回形状是否仍相符、字段名是否仍准确。
- **R3**：`### 6. Tests Required` 引用的测试文件路径必须逐个核实；上表 6 个失效路径按
  「搬家 → 更新路径」「真没了 → 追查后如实说明」分别处理。
- **R4**：`### 7. Wrong vs Correct` 与 `### 5. Good/Base/Bad` 中的代码示例若与当前实现不符，
  按"以代码为准"修正示例；**但示例所承载的规范意图不改**（父任务 R1/R1b——若属"要求如此而
  当前不是"，显式标注，不要伪装成现状）。
- **R5**：对账表落盘 `research/reconciliation.md`，含行号、判定、证据、处理。

## Acceptance Criteria

- [x] AC1：对账表覆盖全部 7 个 scenario，含行号/判定/证据/处理；无遗漏段落。
      —— 产物 `research/reconciliation.md`，分 A（已过期）/ B（属规范）/ C（属实留证）/ D（R1b 标注）。
- [x] AC2：6 个失效路径全部处理完毕。
      —— 5 个更新为真实路径；`ChatInputBar.test.ts` 追查结论：**搬到同级 `__tests__/` 且扩展名
      由 `.ts` 改为 `.tsx`**（既非改名以外的臆造，也未被删除）。前两轮误判"不存在"的真因是
      我的匹配模式不含 `.tsx`。
- [x] AC3：签名与契约类断言逐条对照实现核验完毕。
      —— 109 个代码块标识符逐个 grep，9 个零命中；其中 **6 个属过期**（已修）、
      **3 个属 Wrong 反例的刻意伪代码**（不改，见对账表 B 节）。
      另发现脚本未覆盖的一类：**`.rxc/` / `RXC_*` 旧品牌配置块共 18 行**，已全块改写。
- [x] AC4："仍然属实"条目给出核验命令与结果（对账表 C 节逐条附证据）。
- [x] AC5：`npm run check` exit 0（42 增 / 29 删，纯 markdown）；CI 推送后确认。
- [x] AC6：向父任务 AC4 提交本文件数字：**可机械核验的断言约 40 条，过期 6 类**；
      成本为 **3 轮脚本扫描 + 约 15 次定向核验 + 通读 926 行**；
      结论：**契约型单位成本约为存在性型的 2–3 倍**，且新增一维必扫项——**旧品牌名**。

## Out of Scope

- 其余 spec 文件（属父任务下其他子任务）。
- `docs/` 的修正——只记录本文件暴露出的 docs 漂移。
- 规范条文本身的增删改。
