# /logs 页面撑屏问题 — 改动方案

> 状态：分析完成，部分已实现（见 §4），已暂停待 review。重启 TUI 前当前线上行为不变。
> 相关代码：`src/tui/components/LogsPage.tsx`、`ScrollableBox.tsx`、`card-window.ts`（新建）、
> `ToolTimeline.tsx`、`GlobalTimeline.tsx`。

## 1. 问题

`/logs` 页面右侧内容过多时，页面总高度超过终端，顶部被顶出视口；历史视图没有滚动条。

## 2. 根因（按影响排序，均有实测证据）

### R1. Ink 不裁剪纵向溢出（机制性前提错误）

`ink/build/render-border.js` 与渲染器只做布局、不做绘制裁剪；
`overflow="hidden"` 对输出无约束。实测：`ScrollableBox height={10}` 塞 5 张超高卡，
实际输出 **22 行**。代码里 4 处“超高部分由 ScrollableBox 固定高度 overflow 裁掉”
注释的前提不存在；`sliceWindowByLines`（注释声称的“按行预算精确切割”）全仓库无实现。

### R2. Ink 7 边框语义：`borderStyle` 存在即四边全画

`render-border.js`：`showTopBorder = style.borderTop !== false`（余类推）。
只传 `borderRight` 不会只画右边，必须显式 `={false}` 关闭。命中：

| 位置 | 代码写法 | 实际多出 |
|---|---|---|
| 左栏 Session 列表 | `borderStyle + borderRight` | 上下各 1 行（+2 行） |
| 卡片（每张） | `borderStyle + borderLeft + borderBottom` | 顶部 1 行（+1 行/卡）+ 右框占 1 列 |
| 底部帮助条/搜索框 | `borderStyle + borderTop + borderBottom` | 左右框各占 1 列（帮助文本换行提前） |

### R3. 右栏卡片“按张数切、按标称估”

`cardWindowCount = floor(全屏行/4) + 2`，标称 4 行/卡；真卡片折叠 4~6 行、
展开几十行、长行按列宽换行。`+2` 余量兜不住 → 超行直接撑页。
且 `showScrollbar={false}` 时 `ScrollableBox` 连外层 `height` 都不套（已修，见 §4）。

### R4. 左栏行不是 1 行

Session 行总长 ~80 列（indent+时间+sid+计数+消息 30+项目标签），左栏内容宽
40%−3（100 列终端下 37 列）→ 每行换行成 ~3 行，但滚动数学按 `itemHeight=1`。
左栏 header（56 列）同样换行。两处都未进预算。

### R5. 底部帮助条行数写死 4

快捷键文本 ~150 列，100 列终端下换行成 2 行 + `[help on]` 1 行 + 上下框 2 行 = 实际 6 行。
空页实测 31 行（预算 24）：左框线 2 + 左空态 3 + 底部 2 = 7 行超支，一一对上。

### R6. 时间线错误子行超高

`✗ + 60 字符` 在内容宽 56 列下换行成 2 行，但 `TIMELINE_ROW_HEIGHT=2` 只够主行+子行各 1。

### R7. 历史视图本来就没有滚动条

卡片流 `showScrollbar={false}` 硬编码，只有 ▲▼ 计数器。“没看到滚动条”不是渲染失败。

## 3. 设计决策

- **行数测量与 Ink 同管线**：`wrapAnsi(text, w, {trim:false, hard:true})` 数 `\n`
 （即 `ink/build/wrap-text.js` wrap 分支 + `measure-text.js` height 语义），
  宽度用 `string-width`（与 `widest-line` 同源）。不对齐就逐像素对齐。
- **预算铁律**：渲染总行数恒 ≤ 预算，宁可少显示（截断打标）不多占一行。
  超大单卡截断可展开区域（消息 > 错误 > 详情 > 上下文，timings 原子丢弃），
  marker 计入预算；预算耗尽时静默丢弃。
- **边框按意图显式关闭**（ precedent：`ChatInputBar.tsx:371` 已这么写），
  而不是在数学里迁就多余框线；同时收回被框线吃掉的列宽。
- **yoga 百分比列宽向下取整再减 1 做 guard**（宁可少排一列）。
- **指示器行计入预算**：卡片流直接关闭指示器（header 已有 `x-y of N`），
  通用 `ScrollableBox` 做两遍 maxVisible（收缩单调，一次迭代收敛）。
- **offset 语义保持“起始卡下标”**，`useScroll` 加 `clampToLastItem` 让尾卡可达
  （行预算窗口不再 overshoot，旧钳制会 stranded 末尾卡）。
- **不碰**：其他页面边框（wizard/tabs/inspector，另起任务）、
  时间线主行 <90 列换行残留、`spawn_agent` 的 always（已确认不动）。

## 4. 已实现（未提交，需 review）

1. `card-window.ts`（新建，纯函数）：`displayWidth` / `wrapRowCount` /
   `wrapLines` / `truncateToWidth` / `measureCard` / `planRows` /
   `sliceCardWindow`（行预算窗口＋首卡截断）/ 上下文行文本复刻。
   单测 10 项通过（含“总行数恒 ≤ 预算”多预算扫描、`rows === planRows` 自洽）。
2. `ScrollableBox`：`height` 有传即套外层（不限于滚动条路径）；
   指示器占行两遍预留。
3. `useScroll`：`clampToLastItem` 选项（仅卡片流使用）。
4. `LogsPage`：左右共用 `listHeight`；列宽账本（`cardContentWidth` /
   `timelineContentWidth` / `leftContentWidth`）；左栏行＋header 单行截断；
   卡片窗口改行预算切片＋消费计划渲染；卡片流滚动条按需开、指示器关；
   计数器改为窗口实际张数；`relativeTimeStrFor` 抽取（测量渲染同源）；
   `ToolTimeline` / `GlobalTimeline` 加 `contentWidth`（错误子行单行截断，
   不传保持旧行为）。
5. 边框显式关闭：左栏（仅保留右边框）、底部两框（仅保留上下）、
   搜索框 draft 截断；`string-width@8.2.1` / `wrap-ansi@10.0.0` 入 dependencies
   （与 ink 所用版本一致）。
6. 探针（已删）：全屏末帧解析可行；空页 31 行实测与 §2 的 7 行超支逐项对上。

## 5. 未完成（暂停前断点）

- [ ] 卡片详情 `marginTop={1}` 未计入行预算（每展开卡漏 1 行）→
      `measureCard` 加 `detailChromeRows`（或并入 header 逻辑），`planRows` /
      `capPlanToBudget` 同步。
- [ ] `bottomBarRows` 改实算：`2 + wrapRowCount(helpText, cols) + 1`（开）/ 3（关）；
      导出状态行截断到列宽。
- [ ] 右栏空态（3 行）/ 全局加载态（2 行）/ 左栏空态（3 行）进预算扣除。
- [ ] `formatDetail` / `formatTimeFull` / `isErrorEntry` 在 LogsPage 的 import
      已清其二，确认无残留引用（tsc 会报）。
- [ ] 端到端断言：全屏末帧行数 ≤ rows（含长行/错误行/展开卡）＋滚动条字符出现；
      左栏行单行断言。探针代码可复用（`probe-height.test.tsx` 已删，需重建）。
- [ ] 全量 `npm test` + `tsc` + `eslint`，commit，`npm run build`，bump 验证，
      重启 TUI 实测（80/100/140 列 × 历史/时间线/全局 × 折叠/展开）。

## 6. 验证标准

- 100×24：空页恰 24 行；20 条 300 字日志＋错误行＋展开卡，总行恒 ≤ 24；
- 有可滚内容时滚动条可见；无内容时无滚动条；
- 顶部工具栏恒可见（ segala 视图/过滤/展开组合下）；
- 全量测试绿；`tsc`/`eslint` 干净。
