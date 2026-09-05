# fix(tui): StatusBar 主题背景调深 + 加高, AgentTabs 聚焦/失焦高度统一

## Goal

修复用户上一轮视觉反馈暴露的两个 UX gap:

1. **StatusBar 视觉感不够"主题"**:当前背景色 `wastelandTheme.colors.backgroundDarker` (`#100D0A`) 接近纯黑,远离废土主题的暖棕调 (`primary = #E6B450`)。用户希望背景色"比主题色深一点"——既保持主题血脉,又比 `#100D0A` 暖。
2. **StatusBar 整体高度不够**:目前单行(paddingX=1, paddingY=0 → 1 row),与下方 AgentTabs / 主体区域视觉节奏平,缺少"Title 段"的存在感。
3. **AgentTabs 聚焦失焦高度不一致**(07-31 AgentTabs 修复引入):聚焦时 `borderStyle="single"` 给 Box 上下各加 1 行(layout shift);失焦时无边框,高度回原值。每切一次焦点整行就抖一下。

让 Title 行一眼可识别且不抖动。

## What I already know

### 文件与契约

- **`src/tui/components/StatusBar.tsx:24-29`**:当前 Box `<Box flexShrink={0} width={width} paddingX={1} backgroundColor={backgroundDarker}>`,无 paddingY,无 borderStyle。1 行高。
- **`src/theme/wasteland/colors.ts:20-22`**:主题 token 体系里有三个 background 变量:
  - `background: '#18140F'` — 主背景
  - `backgroundSecondary: '#241D16'` — 二级背景(略暖)
  - `backgroundDarker: '#100D0A'` — 更深的纯黑(当前 StatusBar 用)
  
  + 暖色家族:`border = '#66513A'`、`borderDim = '#3D3328'`、`primary = '#E6B450'`。
  
- **`src/tui/components/AgentTabs.tsx:339-352`**(07-31 修复):`borderStyle={focusBorder.borderStyle}` 条件渲染,`focusBorder.borderStyle === 'single'` 时 Box 上下各 +1 行 → 高度变化 +2。
- **`src/tui/components/ChatArea.tsx:54-59`**:布局根 `column` → `StatusBar` → `AgentTabs` → 主体 flexGrow=1。任何子 Box 高度变化都会传导到下方主体高度。
- **`.trellis/spec/frontend/theme-skin.md:75-130`**:主题契约。新增颜色 token 需要通过 APCA contrast check(背景对前景文字 `Lc ≥ 60`,对装饰元素无强约束但与 primary 协调)。

### 设计候选

#### StatusBar 背景调深(设计分析)

用户明确要求"不要突兀,需要单独设计"——意味着不能简单复用现有 token,需要专门为一个"主题相关但比 `#100D0A` 暖"的色彩设计。

**主题色家族 HSL 分析**:

| token | Y | HSL | 角色 |
|---|---|---|---|
| primary `#E6B450` | 0.4805 | 40°,75%,61% | 主标题色 |
| muted `#7D7468` | 0.1548 | 34°,9%,45% | 次要文字 |
| border `#66513A` | 0.0713 | 31°,28%,31% | 装饰边 |
| borderDim `#3D3328` | 0.0227 | 31°,21%,20% | 暗边/占位 |
| background `#18140F` | 0.0024 | 33°,23%,8% | 主背景 |
| backgroundSecondary `#241D16` | 0.0060 | 30°,24%,11% | 二级背景 |
| backgroundDarker `#100D0A` | 0.0009 | 30°,23%,5% | **当前 StatusBar** |

所有 token 都在 30-40° hue 范围(暖黄/橘金家族),**这是 wasteland 主题的统一血脉**。StatusBar 选色必须落在这个 hue 区间,否则会"出戏"。

**手工候选(全部维持 30-36° hue):**

| 候选 hex | HSL | Y | 在 primary 上的 Lc(text ≥ 60) |
|---|---|---|---|
| `#100D0A`(现况 bgDarker) | 30°,23%,5% | 0.0009 | -66.0 |
| `#241D16`(现况 bgSecondary) | 30°,24%,11% | 0.0060 | -64.4 |
| **`#2A2014`(推荐 / "冷静/中")** | **33°,35%,12%** | **0.0079** | **-63.8** |
| `#2E2519`("中间带橙") | 34°,30%,14% | 0.0107 | -63.1 |
| `#33291A`("偏橘") | 36°,32%,15% | 0.0137 | -62.3 |
| `#2A1F12`("更冷暗") | 33°,40%,12% | 0.0075 | -64.0 |

**推荐 `#2A2014`** 的设计理由:
1. **色相 33°(暖琥珀)** —— 处于主题家族中段,既不背离 primary (40°) 也呼应 secondary (30°)。
2. **饱和度 35%** —— 比现有 background 系列的 23% 更高,有"颜色存在感",StatusBar 不再是中性黑,而是"带主题色血脉的暖表面"。
3. **亮度 12%** —— 比 `backgroundDarker` (5%) 更亮、比 `borderDim` (20%) 更暗,正好落在"深主题表面"的视觉位。
4. **对比度 primary Lc -63.8** —— 满足 text 阈值 ≥ 60。
5. **不会与 background 混淆** —— `backgroundSecondary` (#241D16) 用作次要表面;新色 `#2A2014` 用作"凹的 Title 表面",语义清晰区分。

**最终选**: `surfaceSunken = '#2A2014'`,作为 StatusBar 专属背景 token。`wastelandTheme.colors.surfaceSunken`。

Honorable mention:`#2E2519` 比 `#2A2014` 略亮、略偏橘(HSL 14%/S 30% vs 12%/S 35%),作为 visual alternative;若用户希望 Title 更"出挑",可用它。

#### StatusBar 加高

候选 (i):`paddingY={1}` —— 1 行 → 3 行(1 inner + 2 padding)。主体变 2 行少。

候选 (ii):`paddingY={1}` + 内部加一行分割(<Text muted>·</Text> 或 thinner 二级文本)—— 1→3 但视觉上是 1 + 1 (label + status);后者仍可读但不增加视觉复杂度。

候选 (iii):不 paddingY,而是 render 一个二级 "secondary" 行(例如 provider name + 动态状态),用 flexShrink=0 确保不被压缩。

**推荐**:候选 (i) — 简单 `paddingY=1`,Title 内容不变就足以营造"加高"感。可观察后续是否需要更多内容再加 (iii)。

#### AgentTabs 聚焦/失焦高度统一

候选 α:**永远 `borderStyle="single"`**,失焦时 `borderColor = borderDim`,聚焦时 `borderColor = borderFocused`。高度恒定(都 +2)。失焦态有"隐形深色边框"作占位,视觉上**比当前 borderStyle=undefined 失焦** 略多一条线,但消除 layout shift。

候选 β:**失焦时 border 不可见但有占位**——Ink 的 `<Box>` 不支持 transparent border 占位,只能用 padding 占位:失焦时包一层不渲染 border 但 paddingY=1 让高度等于聚焦态。复杂,且 border 真的消失时样式不连贯。

候选 γ:不用 border,聚焦改用 backgroundColor 块。背景色变化没高度影响,但**视觉接近 Tab 行变色**,与"全 Tab 条套边框"语义不同。

**推荐**:候选 α (`borderStyle` 永远 'single',borderColor 二选一)。最小改动、视觉一致、零 layout shift。

## Assumptions (待 brainstorm 验证)

- StatusBar 背景用现有 `borderDim` 色值的别名 token(`surfaceSunken`),不修改原 token。
- StatusBar 加高到 3 行(paddingY=1)。
- AgentTabs 改用 α 方案,失焦时仍然画单边框,只是用 `borderDim` 色让它看起来比聚焦时"细"。

## Requirements

- **R1 StatusBar 背景色**:新增 `wastelandTheme.colors.surfaceSunken = '#2A2014'` token,色值经过设计(主题 hue 33°,饱和度 35%,亮度 12%,与 wasteland 主题色家族和谐)。
- **R2 StatusBar 高度**:`paddingY={1}`,Box 实际渲染 3 行(原来 1 行)。
- **R3 AgentTabs 高度稳定性**:聚焦/失焦两种状态下 Box 视觉行数一致(差 0)。
- **R4 BorderVisible 强度差**:即使两个状态都画边框,聚焦态明显更醒目——通过 `borderColor` 对比实现(聚焦用 `borderFocused` `#E6B450`,失焦用 `borderDim` `#3D3328`)。
- **R5 APCA 对比度**:`surfaceSunken` 与 primary `#E6B450` Lc ≥ 60(text 阈值)。
- **R6 兼容**:不破坏 StatusBar 当前内容(角色名 + thinking/streaming 状态)、AgentTabs 现有 38 测试、不破坏其它 wasteland 颜色 token。

## Acceptance Criteria

- [ ] StatusBar background 不再是 `#100D0A` 纯黑;改成 `surfaceSunken` token(暖棕)。
- [ ] StatusBar Box 渲染 3 行(原来 1 行)。
- [ ] AgentTabs 在聚焦/失焦两种状态下,Box 总视觉行数相同(对比切换焦点时下方主体高度不抖)。
- [ ] 失焦时 AgentTabs 仍然有边框,但颜色明显比聚焦时弱。
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 全绿。
- [ ] AgentTabs.test.ts 现有 38 cases 仍 pass。
- [ ] APCA 对比度:`surfaceSunken` 上跑 border-color 的视觉对比度满足(聚焦态 borderFocused ≥ 60 Lc);失焦态是装饰性不强约束,但记录在 spec。

## Definition of Done

- 一次提交包含完整三处改动。
- spec 沉淀:`theme-skin.md` 加 `surfaceSunken` token 文档。
- journal entry 在收尾后写(.trellis/workspace/yonghds1/journal-1.md 续写)。

## Out of Scope

- 不引入新的主题 core 函数(本次仅添加 1 个 token)。
- 不动 SessionIndexPage / LogsPage 的 padding/title(本次只动 ChatArea.tsx 顶部两行)。
- 不调整 contrast 阈值。
- 不改 AgentTabs 的 selectedIdx / viewFilter 逻辑。

## Technical Notes

### 改动文件清单(预计)

- `src/theme/wasteland/colors.ts` — 加 `surfaceSunken: '#2A2014'`(手工设计的 hex 值)。
- `src/tui/components/StatusBar.tsx` — `backgroundColor` 改用 `surfaceSunken`;加 `paddingY={1}`。
- `src/tui/components/AgentTabs.tsx` — `getAgentTabsFocusBorder` 加分支:聚焦 / 非聚焦都返回 `borderStyle: 'single'`,borderColor 二选一;AgentTabs Box 渲染逻辑不变。
- `src/tui/components/AgentTabs.test.ts` — `getAgentTabsFocusBorder` 测试调整:失焦态也期望有 borderColor(从 undefined 改为 `borderDim` hex 值),保证零 layout shift。
- `.trellis/spec/frontend/theme-skin.md` — 添加 `surfaceSunken` token 与设计分析(HSL/harmony)。
- `src/tui/components/ChatArea.tsx` — **不需要改**,StatusBar/AgentTabs 自身控制高度,父布局 flex 链自动吸收。

### Token 设计细节

**`wastelandColors.surfaceSunken = '#2A2014'`** —— "Title 段凹表面"专用色。设计动机:
- Hue 33° 与 wasteland 主题家族对齐。
- Saturation 35%(高于 background 系列的 23%),有"色感"不至于纯黑。
- Lightness 12%,比 backgroundDarker (5%) 暖、比 borderDim (20%) 暗,正好做"Title 凹表面"。

### AgentTabs `getAgentTabsFocusBorder` 改动

```ts
export function getAgentTabsFocusBorder(focusArea: FocusArea): AgentTabsFocusBorder {
  if (focusArea === 'agentTabs') {
    return {
      borderStyle: 'single',
      borderColor: wastelandTheme.colors.borderFocused,  // #E6B450
    };
  }
  // 失焦态:仍然画边框,但颜色用 borderDim 让它"几乎隐形"
  return {
    borderStyle: 'single',                              // ← 改:从 undefined 改为 'single'
    borderColor: wastelandTheme.colors.borderDim,       // ← 改:给失焦态一个"暗边框"
  };
}
```

AgentTabs render 的 `<Box borderStyle={focusBorder.borderStyle} borderColor={focusBorder.borderColor}>` 不需要改。**聚焦/失焦 Box 高度都 +2,正好对齐,layout shift 消除。**

### 不需要的研究

- Ink `borderColor` 对透明度支持:用 `borderDim` 实色 hex 字串稳定可靠,不依赖 `'transparent'` 关键字(Ink 4.x 兼容性版本敏感)。
- 别的 TUI 的 StatusBar 设计模式:本次按本仓库主题走,不需横向对比。

### 风险与边界

- `paddingY={1}` 让 StatusBar Box 高度 +2(1→3 行)。如果终端窄(<10 行),主体可能被吃光 → 仍用 `flexShrink={0}`,主体 `flexGrow={1}` 自动吸收。窄终端情况(常见于 telemetry)可能让 StatusBar 超出可视——可在 spec 加 note 但本次不增加"窄终端 fallback"。
- AgentTabs `borderStyle='single'` 永远开 = 失焦态会多一条暗线(`#3D3328` vs 主背景). 设计上假定失焦用 `borderDim` 与背景差异够小(Lc -9.4),用户不会感知到强边框。如果实测"暗线太显眼",可在 PR 验证阶段反向弱化。
