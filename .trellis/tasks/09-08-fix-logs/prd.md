# fix: /logs 撑屏修复收尾

来源：`docs/logs-overflow-fix-plan.md` §5（暂停前断点）。父提交 `5b0ee7a 日志修改,未完成` 已落地 §4（card-window.ts 纯函数 + 单测、sliceCardWindow 消费、列宽账本、边框显式关闭）。本任务收掉 §5 六项未完成 + §6 验收。

## Goal

让 `/logs` 页面在任何终端尺寸 / 视图 / 过滤 / 展开组合下，渲染总行数恒 ≤ 终端行数，顶部工具栏恒可见，可滚内容出现滚动条。

## 根因背景（决策依据，勿重新推导）

- **R1**：Ink 不做纵向裁剪，`overflow="hidden"` 无效。唯一防线是"测量行数恒 ≤ 预算"。
- **R2**：Ink 7 里 `borderStyle` 存在即四边全画，多余边必须显式 `borderX={false}`。
- 测量必须与 Ink 同管线：`wrapAnsi(text, w, {trim:false, hard:true})` + `string-width`，已在 `card-window.ts` 建好，复用之。

## Requirements

### R-1 展开卡详情区 marginTop 漏计预算
`card-window.ts:214-219` 的 `detailHeaderLines` 只计文本行，但 `LogsPage.tsx:1300` 渲染包在 `<Box marginTop={1}>` 里 → 每张展开卡漏 1 行。
（对照：错误上下文区已在 `contextChromeRows` 里正确计入 marginTop，见 `card-window.ts:228-231`。修法与之对称。）
- 给 `CardLinePlan` 增加详情区 chrome 行数，`planRows` 与 `capPlanToBudget` 同步（截断时该 chrome 也必须随之出现/消失，不能出现"渲染了 marginTop 但计划没算"或反之）。
- `capPlanToBudget` 里若详情区被完全截掉（`detailHeaderLines` 与 `detailLines` 皆空），对应 chrome 必须归零。

### R-2 bottomBarRows 写死 4（R5 残留）
`LogsPage.tsx:374` `isSearching ? 3 : helpVisible ? 4 : 3` 是标称值；帮助文本 ~150 列，100 列终端实际换行 2 行 → 真值 6。
- 改为实算：`2(上下框) + wrapRowCount(helpText, terminalCols) + 1([help on/off] 行)`；帮助关闭时按其实际渲染行数算（现为 3）。
- 导出状态行（`exportStatus`）截断到 `terminalCols`，避免自己换行吃掉未预算的行。
- `helpText` 的构造需与渲染侧同源（现有帮助条测试依赖其内容，改动勿破坏）。

### R-3 空态 / 加载态在预算外（R5 同类）
四处 `<Box marginTop={1}>` 均未进预算：右栏列表空态（`LogsPage.tsx:1181`）、右栏加载态（1123，现仅硬扣 2 行）、全局时间线加载态（1149）、左栏空态（1015）。
- 采用**空态不占额外行**：去掉这些块的 `marginTop`，把文案渲染进列表自身槽位（它们与列表/时间线互斥渲染，槽位本就空闲）。
- 收益：不动 `listHeight` 数学 → 现有帮助条/卡片测试的渲染结果不受影响（比"从预算里再扣 N 行"影响面小）。
- 加载完成后文案消失、卡片流接管同一槽位，不得出现 1 行跳动。

### R-4 import 残留确认
`LogsPage.tsx` 内 `formatDetail` / `formatTimeFull` / `isErrorEntry` 已无引用（grep 已验证）。以 `tsc` 为准关闭此项，若报 unused/缺失则清理。

### R-5 端到端全屏帧断言（本任务的核心防线）
现有 `card-window.test.ts:106-120` 的预算扫描用 `planRows` 自洽断言 —— 漏计发生在**测量侧**，planRows 与断言一起漏，故恒绿却挡不住撑屏（R1 教训复现：注释声称有实现、实际缺失）。必须补渲染侧断言：
- 重建探针（原 `probe-height.test.tsx` 已删）：`FakeStdout` 增加 `rows`/`columns` getter，按 100×24 渲染，unmount 后取末帧，断言 `frame.split('\n').length <= 24`。
- 用例矩阵至少覆盖：空页恰 24 行；20 条 300 字长日志；含错误行 + 展开卡（驱动 R-1）；帮助条开启（驱动 R-2）；时间线视图与全局视图；错误子行超长（驱动 R-6/既有截断）。
- 有可滚内容时断言滚动条字符出现；无内容时无滚动条。
- 断言顶部工具栏在任意组合下出现在末帧内（驱动"顶部恒可达"）。
- 左栏单行断言：任一行不超 `leftContentWidth`（R4）。

### R-6 门禁与实测
`npm test` 全绿 + `npm run typecheck` + eslint + `npm run check:locale-parity`（若触及文案）+ `npm run build` → 单个 commit。
构建产物重启 TUI 手工实测：80 / 100 / 140 列 × 历史(list) / timeline-session / timeline-global / 全局 stats × 折叠 / 展开。

## Acceptance Criteria（= 方案 §6）

- [ ] 100×24：空页恰好 24 行；20 条 300 字日志 + 错误行 + 展开卡组合下，末帧总行数恒 ≤ 24。
- [ ] 有可滚内容时滚动条可见；无内容时无滚动条。
- [ ] 顶部工具栏在任意 视图 × 过滤 × 展开 组合下恒可见。
- [ ] 左栏每条 session 行与 header 均为单行（不超左栏内容宽）。
- [ ] 全量 `npm test` 绿；`typecheck` / `eslint` 干净；`npm run build` 通过。
- [ ] 手工实测三档列宽 × 各视图 × 折叠/展开无撑屏（记录进任务笔记）。
- [ ] 新渲染侧断言在把 R-1 修复回退时会失败（证明它真的在守这条线，非自洽空转）。

## Non-goals（方案 §3 明确不碰）

- 其他页面边框（wizard / tabs / inspector）—— 另起任务。
- 时间线主行 <90 列的换行残留。
- `spawn_agent` 的 always 权限。

## 执行顺序与验证

1. R-1 → R-2 → R-3（同一主题：预算数学补齐，改完即可跑现有 card-window 单测）
2. R-4 tsc 确认
3. R-5 端到端断言（若先写，能当 R-1~R-3 的失败复现测试；建议先写一条最小帧断言复现撑屏，再修）
4. R-6 全量门禁 + build + 手工实测 → commit
5. 收尾：更新 `docs/logs-overflow-fix-plan.md` 状态（§5 勾选 + §4/§5 合并，标注已验收）

风险：改 `listHeight` / `bottomBarRows` 会影响现有依赖渲染行数的测试（帮助条 T15、卡片可读性 T12）。每步跑相关测试文件而非只跑全量，失败时优先判断"测试断言了旧的错误行为"还是"真改坏了"。
