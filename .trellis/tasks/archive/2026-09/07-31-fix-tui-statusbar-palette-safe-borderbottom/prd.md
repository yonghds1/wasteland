# fix(tui): StatusBar 加 palette-safe 视觉区分(borderBottom / 边框)

## Goal

修复 StatusBar 背景"毫无变化"的根因问题 —— **256-color palette quantization**,而非色选错。

用户在 `xterm-256color`(默认 macOS Terminal / 多数 Linux terminal)下看不到 backgroundColor 变化,因为所有"够深的色"都被量化到 palette 索引 16(= 黑),与主背景 `#18140F` 完全等同。

- **保留**: `titleSurface = #0E0B07`(truecolor 终端仍然稍微深一档)
- **新增**: 一个 palette-safe 视觉元素(`borderBottom` 暖色细线)—— 在 256-color 终端下也能让 StatusBar 视觉上"明显是 Title 段",不依赖 backgroundColor 的微差。

## 根因(深度诊断)

`/tmp/diag-256color.mjs` 跑出来的数据:

| 色            | R,G,B        | 256 索引 | 与 0/16 同? |
|---------------|--------------|----------|-------------|
| 主背景 #18140F | 24,20,15     | 16       | ⚠ |
| #0E0B07 (当前) | 14,11,7      | 16       | ⚠ |
| #13100B (前一) | 19,16,11     | 16       | ⚠ |
| #2A2014 (废止) | 42,32,20     | 58       | ✓ (但 hue 偏差大) |
| borderDim #3D3328 | 61,51,40 | 59       | ✓ |
| border #66513A | 102,81,58    | 101      | ✓ |

256-color 量化规则:
- 索引 0/16 = black
- 索引 16-231 = 6×6×6 RGB cube,通道值离散到 `{0,51,102,153,204,255}`
- 索引 232-255 = 24 灰阶(8/18/28/.../238)

要把"深色"映射到非 black 索引,**任一通道必须 ≥ 51**。但若同时要求"比主背景更深",由于主背景 R=24 < 51,任何 R ≥ 51 的色实际上**更亮**。

**结论**: 在 256-color palette 下,**无法实现"和主背景同色系、更深、且 palette-safe"**——这是 6×6×6 cube + 主背景处于 sub-step 范围的物理约束。

可行的"工程妥协"——**新增一个 palette-safe 的视觉元素**(单 line 就够):

### 候选方案对比

| 方案 | 实现 | 256-color 可见 | truecolor 叠加视觉 | 改动 |
|---|---|---|---|---|
| A. `borderBottom={true}` + `borderBottomColor={borderDim #3D3328}` | StatusBar 整条下方画一暖棕细线(`─` 连续) | ✓ ✓ ✓(palette index 59,清楚区分 black) | StatusBar 下方有一道 'Title 段结束' 感 | StatusBar.tsx 加 2 个 prop |
| B. `borderStyle="single" borderTop={false} borderBottom={false}` 单画 | StatusBar 套完整 边框,上下左右 | ✓ ✓(同样 palette-safe) | 整个 StatusBar 像 '面板',可能过于围合 | StatusBar.tsx 加 3-4 个 prop |
| C. `borderBottom` + backgroundColor 改到 palette-safe 不饱和暖色 (例如 `#1A110A` index 还是 16...) —— 已证无解 | — | — | — | — |
| D. 强制 24-bit:cli.ts 设 `process.env.FORCE_COLOR = '3'` | Ink 输出 truecolor ANSI(忽略 `TERM`) | — | ✓ | 仅在设置后才有效,用户自家终端 tmux/老 terminal 仍有问题 |

**推荐:方案 A(`borderBottom` 仅下方画线)** —— 最不打扰 StatusBar 原本"title 段"语义,palette-safe 立刻生效,truecolor 下叠加一道 "Title 段落分割" 的视觉,跨全部终端一致行为。

### 用户具体选哪个

在所有 candidate 中,**A 是 greedy best fit**:
- palette-safe:`borderDim #3D3328` 的 RGB(61,51,40) ≥ 51 的两条通道都被量化进 cube 高亮区(索引 59 = `2,2,2` cube 起点,深灰偏暖),与 black 索引 16 完全区分。
- truecolor 叠加:在 truecolor 终端下,borderDim 仍是 `#3D3328` 深暖,StatusBar 上半部分有 `#0E0B07` 微深底色 + 下半部分 borderBottom `─` 连续 `─` line,视觉上明确"上方是 Title"。
- 与 AgentTabs 设计共鸣:AgentTabs 聚焦/失焦时 borderColor 切换,bottom line 永远是暖棕 —— StatusBar 下边沿用 `borderDim` 与之视觉**呼应**(上下两个组件的下边线风格一致)。

## What I already know

### 用户决策(本轮)

- 用户报"毫无变化" → 真根因不是 token 值,是 palette 量化。
- 改色已无空间(L=-1 到 -5pp 全部量化到同一 black 索引)—— 改 strategy 而非改值。

### 文件与契约

- **`src/tui/components/StatusBar.tsx:24-31`**:当前 `<Box flexShrink={0} width={width} paddingX={1} paddingY={1} backgroundColor={...titleSurface}>`。Ink Box 支持 `borderTop / borderBottom / borderLeft / borderRight` boolean,以及 `borderXxxColor`(`node_modules/ink/build/components/Box.d.ts:77-90`)。只在 `borderStyle` 启用时生效。
- **`src/theme/wasteland/colors.ts:30`**: `titleSurface: '#0E0B07'` 保留。
- **`.trellis/spec/frontend/theme-skin.md` §3 Contracts**:titleSurface 文档 + 历史迭代段。

### 配色

| 元素 | 颜色 | R,G,B | 256 索引 | 角色 |
|---|---|---|---|---|
| StatusBar background | `titleSurface` `#0E0B07` | (14,11,7) | 16(等同 black)| truecolor 微深;256-color 退化为等价背景 |
| StatusBar borderBottom | `borderDim` `#3D3328` | (61,51,40) | 59(= cube 深灰偏暖) | palette-safe Title 分隔线 |
| 主背景 | `background` `#18140F` | (24,20,15) | 16(等同 black)| ChatMessageList 主体 |

### Ink 边框 semantics 关键

- Ink 的 `borderTop / borderBottom / borderLeft / borderRight` 在 `borderStyle` 为 truthy 时启用。
- 单画一条底边:`borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom={true}` —— 等价于只画 `borderBottom` + `borderBottomColor`。
- 注意:`<Box>` 的 `borderColor` / `borderBottomColor` 是 prop,value 是 ANSI color 或 hex string(chalk 接受 hex)。
- 副作用:加 border 后 Box 高度增加 1 行。如果 paddingY={1} 共 3 行,加 border 后变 4 行。要么 减 paddingY 到 0(让总高度 2 行 = 1 border + 1 content row;更稳);要么保留 paddingY 不变(4 行加 border 用户可能要滚动测试)。

**决策**: `paddingY={1}` 保留(3 行加 border = 4 行),但视觉上应可接受 —— AgentTabs 也是 4 行 (1 row + 1 border-top + 1 border-bottom + 1 content),所以"Title 4 行 / Tab 4 行" 视觉平衡。

## Requirements

- **R1 StatusBar 加 borderBottom**: Inbox 的 `borderStyle="single"` 配合 `borderTop={false}` `borderLeft={false}` `borderRight={false}`,仅保留底边。
- **R2 borderColor**:用 `wastelandTheme.colors.borderDim`(`#3D3328`,palette-safe)。
- **R3 BackgroundColor 保留**:`titleSurface` 不改,值仍 `#0E0B07`(truecolor 用户能感受到)。
- **R4 Spec 更新**:theme-skin.md §3 Contracts 增补"### Palette Quantization Caveat":256-color 终端下深色 backgroundColor 等同 black,只能用 borderBottom 这类 palette-safe 视觉元素;titleSurface token 仍存在,但实际效果仅在 truecolor 终端可见。
- **R5 兼容**:AgentTabs 与 StatusBar 在 borderBottom 用色上保持 `borderDim`(视觉呼应)。
- **R6 不动**:AgentTabs / 其它 wasteland token / main bg / 其它组件。

## Acceptance Criteria

- [ ] StatusBar.jsx / .tsx 有 `borderBottom={true}` 与 `borderBottomColor={borderDim}` 配置。
- [ ] `borderDim` 的 RGB(61,51,40)在 256-color palette 下映射到索引 59(≠ 16),与 black 区分。
- [ ] `titleSurface` token 仍 `#0E0B07`,未被改。
- [ ] theme-skin.md §3 增加 "Palette Quantization Caveat" 段。
- [ ] typecheck/lint/contrast 全绿;AgentTabs 39/39 仍 pass。
- [ ] 终端实测(在 `xterm-256color` 下 `node dist/tui/cli.js tui` 或 `tsx src/cli.ts tui`):StatusBar 下方能明显看到一道 `─` 暖色细线,与下方 ChatMessageList 区分。

## Definition of Done

- 一次 commit 完成 2 文件改动(StatusBar.tsx + theme-skin.md)。
- commit message 引用本任务 ID,显式说明"256-color palette quantization"是根因。

## Out of Scope

- 不改 cli.ts 设 `FORCE_COLOR=3`(这个改动有副作用,不推荐合并;且 FORCE_COLOR 仍救不了 tmux / 老 terminal)。
- 不改 titleSurface 值。
- 不动 AgentTabs / 其它 wasteland 颜色 token / 其它 spec。

## Technical Notes

### 改动文件清单

- `src/tui/components/StatusBar.tsx` —— Box 加 `borderStyle="single"` + `borderTop={false}` `borderLeft={false}` `borderRight={false}` + `borderBottomColor={wastelandTheme.colors.borderDim}`。
- `.trellis/spec/frontend/theme-skin.md` —— §3 Contracts 加 "Palette Quantization Caveat" 段,沉淀 "xterm-256color 下深色 backgroundColor 等同 black (palette index 16),只能靠 palette-safe 边框/前景色做视觉区分" 的工程经验。
- `src/theme/wasteland/colors.ts` —— 不动。

### 风险

- 加 border 后 Box 多 1 行变 4 行。如果用户终端窄(<10 行),可能挤压主体。ChatArea 主布局 `flexGrow=1` 会自动吸收,可视性影响小。
- `borderTop={false}` 在 Ink Box 上是 boolean 控制;某些 Ink 版本 prop 名可能略有不同(如 `border={false}`),需要看实际情况。Ink 4.x API 是 `borderTop/borderBottom/borderLeft/borderRight` boolean + 对应 color prop。

### 不需要的研究

- 横向对比其他 TUI StatusBar 设计:本次按 Ink prop API + 仓库现状走,不需外部参考。
- Ink `borderTop={false}` 兼容性:已在 Ink 4.x 文档里有(`Box.d.ts:77`),不需验证。

## 收口记录（2026-09-15）

256-color 下的 palette 量化问题随 StatusBar 删除而消失（该组件已不存在），本条目标不再适用。
