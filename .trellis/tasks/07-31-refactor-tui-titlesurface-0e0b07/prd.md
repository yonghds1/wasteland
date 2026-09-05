# refactor(tui): titleSurface 切到 #0E0B07 (终端可见的更深)

## Goal

回退 `23c46ad` 中的 `titleSurface = '#13100B'`(L=6%,ΔL=-2pp),改用 `titleSurface = '#0E0B07'`(L=4%,ΔL=-4pp)。

**问题复盘**: 用户反馈 "我看到的还是黑色的"。诊断(`/tmp/diagnose-title-deep.mjs`)证明 `#13100B` 跟主背景 `#18140F` 的逐通道 RGB 差仅 (5,4,4),在 dark theme 终端普遍 gamma + anti-alias 下视觉等同主背景(诊断标注 "勉强" 可见)。APCA Lc 数字一样(-65.5 vs -65.8)给人"够对比"的错觉,但工程上 L-2pp 在终端**真的看不出**。

要让 StatusBar 视觉上**比 ChatMessageList 一眼深**,ΔRGB 需要 ≥ 8-10,即 L 至少 -3pp 到 -4pp。

## What I already know

### 用户决策(本轮)

- 选 **`#0E0B07`** —— L=4%(-4pp vs 主背景 8%)。
- ΔRGB(10,9,8),诊断标注 "可辨" 区间。

### 设计数据(精校)

| 候选 | Y | HSL | ΔRGB 主背景 | 终端可见度 |
|---|---|---|---|---|
| 主背景 `#18140F` | 0.0024 | 33°,23%,8% | — | — |
| 上一版 `#13100B` | 0.0014 | 38°,27%,6% | (5,4,4) | 勉强 ← 被回退 |
| **`#0E0B07`(本任务选)** | **0.0006** | **34°,33%,4%** | **(10,9,8)** | **可辨** |
| 再深 `#0B0805` | 0.0004 | 25°,29%,3% | (13,12,10) | 显著(本次不选) |

APCA primary Lc:
- `#0E0B07`:Lc = -66.0(与主背景 Lc -65.5 等价,text 阈值 ≥ 60 满足)

**`#0E0B07` 选为推荐色的设计理由**:
1. **ΔRGB (10,9,8)** —— 通道差全部 ≥ 8,跨 8-bit sRGB 每个通道步进后**真的能看出差**(在 iTerm2 / WezTerm / alacritty dark theme 下均为可见级别)。
2. **Hue 34°** —— 距离主背景 33° 仅 +1°,字面意义上"完全同色系微深",与用户的 "和主背景一致" 要求严格一致。
3. **Saturation 33%** —— 主背景 23% → 33%,+10pp。但 hex channel ΔR=10, ΔG=9, ΔB=8 **接近完美等差**,所以 saturation 提升是"自然衍生",不会让 StatusBar 看起来"色彩更饱和",而是有"更暗一点"的视觉效果。
4. **Lightness 4%** —— 主背景 8% → 4%,亮度减半(线性比例),肉眼可辨但不刺眼。
5. **APCA Lc -66.0** —— text 文字可读性等同主背景。

### Token 命名

不换 token 名 —— `titleSurface` 语义正确(仍"Title 段表面"专用),只改值。这样 spec 中"不能是独立暖色/不能是纯黑"的规则保持成立,只是值向上微调。

## Requirements

- **R1 token 值更新**:`wastelandColors.titleSurface = '#0E0B07'`(从 `#13100B` 改)。
- **R2 StatusBar.backgroundColor**:仍用 `titleSurface`(其它代码不变)。
- **R3 Spec 文档**:theme-skin.md §3 Contracts 更新 HSL/与主背景对比/可见度说明,**记录"为什么不是 `#13100B`" 的诊断结论**:在 dark theme 终端下 ΔRGB ≥ 8 才是肉眼可见级别。
- **R4 保留不变**:StatusBar `paddingY={1}`(3 行加高);AgentTabs 聚焦/失焦 borderStyle 高度锁定;不动其它 wasteland token / 其它 spec。

## Acceptance Criteria

- [ ] `wastelandColors.titleSurface === '#0E0B07'`。
- [ ] `grep -r "titleSurface.*13100B\|titleSurface.*'#13" src/ .trellis/spec/` 空(确认旧值无残留)。
- [ ] StatusBar `backgroundColor` 仍指向 `wastelandTheme.colors.titleSurface`。
- [ ] spec 中关于 titleSurface 的设计与可见度说明更新到位,体现"ΔRGB ≥ 8 才是肉眼可见级别"这条工程经验。
- [ ] typecheck/lint 通过。
- [ ] `npm run check:contrast` 通过(13 skins)。
- [ ] AgentTabs 39/39 仍 pass。
- [ ] 全量 test baseline 与 acb4cca/23c46ad 后一致(忽略 3 个预存在 logs.test.ts 失败)。

## Definition of Done

- 一次 commit 完成 3 文件改动(colors.ts / StatusBar.tsx / theme-skin.md)。
- commit message 引用本任务 ID + 在 message 末尾说明"上一版 `#13100B` 在 dark theme 终端 ΔRGB 仅 5/4/4,肉眼不可辨;本次改为 `#0E0B07` (ΔRGB 10/9/8,可见)"。

## Out of Scope

- 不引入新的设计原则(本次仅就这个值改)。
- 不动 AgentTabs / StatusBar 其它部分。
- 不复活 `surfaceSunken`。

## Technical Notes

### 改动文件清单

- `src/theme/wasteland/colors.ts` —— 改 `titleSurface: '#0E0B07'`;更新行内注释(从 `#13100B` 设计动机改为 `#0E0B07` + 终端可见度诊断)。
- `src/tui/components/StatusBar.tsx` —— 不改代码,仍引用 `wastelandTheme.colors.titleSurface`。
- `.trellis/spec/frontend/theme-skin.md` —— §3 Contracts 中 `titleSurface` 段更新:值改为 `#0E0B07`,HSL 改为 34/33/4%,ΔRGB 改为 (10,9,8),可见度标注 "可辨",并显式提及 "**上一版本 #13100B 因 ΔRGB 仅 (5,4,4) 被用户反馈不可见**" 作为 spec 沉淀。

### 风险

- 0 —— 仍是 token 局部调值,JSX / 其它组件不需改。
- spec 中可能仍出现旧 `#13100B` 字样在反例段(如果保留)。待编辑时确认保留/删除一致性。
