# refactor(tui): StatusBar 背景切到主背景同色系稍深版本

## Goal

回退 `acb4cca` 中的"用 `background = '#18140F'` 直接复用"决定,改用一个与主背景(`#18140F`)同色系、稍微深一点的新 token,作为 StatusBar 专用 Title 背景。

- 用法:`StatusBar.backgroundColor = wastelandColors.titleSurface`(新 token)
- token 值:经过 HSL + APCA 设计,与 ChatMessageList 主屏背景**同色系,亮度低 1-2 个百分点**
- **不复活 `surfaceSunken`**(`#2A2014`)——之前的版本 hue/saturation 与主背景差距太大,用户认为"突兀,不和主背景一致"

## What I already know

### 用户决策(本轮迭代)

- "title背景不是黑色!" —— 不是 `#18140F` 也不是 `#100D0A`
- "是和聊天区域背景一致的" —— 同色系,色相/饱和度贴近 `#18140F`
- "可以稍微深一点" —— L 略低(降 1-3 个百分点),区别于主背景但微弱
- 该 token 命名后,继续作为 StatusBar 专用,因为它与主背景有"刻意"的微小差异

### HSL/APCA 设计数据

主背景参考色:
- `wastelandColors.background = '#18140F'` —— **Y=0.0024, HSL(33°,23%,8%)**

候选(全部保持 hue 30-40° wasteland 家族):

| 候选 | Y | HSL | ΔH | ΔS | ΔL | 与主背景差异 |
|---|---|---|---|---|---|---|
| 主背景 `#18140F` | 0.0024 | 33,23,8 | 0 | 0 | 0 | baseline |
| design `#16120D` | 0.0019 | 33,26,7 | 0 | +3 | -1 | 微调,几乎一致 |
| **design `#13100B`(推荐)** | **0.0014** | **38,27,6** | **+5** | **+4** | **-2** | **稍微深,色相略偏黄** |
| design `#110E09` | 0.0010 | 38,31,5 | +5 | +8 | -3 | 深一档 |
| design `#0E0B07` | 0.0014 | 34,33,4 | +1 | +10 | -4 | 明显深,Title 凹下去 |

APCA primary text Lc:
- `#16120D`: -65.6 → 满足 text ≥ 60
- `#13100B`: -65.8 → 满足 text ≥ 60
- `#110E09`: -65.9 → 满足 text ≥ 60
- `#0E0B07`: -66.0 → 满足 text ≥ 60

所有候选 APCA 全部满足 text 阈值(都 ≥ 60)。thinking muted token 在所有这些深背景上 Lc 都在 -28 ~ -29 范围,**远低于 45 thinking 阈值**——但这是 baseline 行为,与主背景一致(主背景 muted Lc = -28.9),不构成问题。

**推荐 `#13100B`** 的设计理由:
1. **Hue 38°** —— 距主背景 33° 仅 +5°,保持在 wasteland hue 家族
2. **Saturation 27%** —— 主背景 23% → 27%,+4 个百分点,色彩密度略高但不喧宾夺主
3. **Lightness 6%** —— 主背景 8% → 6%,L=6% vs L=8% 的视觉差是 "稍微":肉眼看是"这里更暗一点点",不刺眼
4. **APCA 主标题** Lc -65.8,文字可读性等同主背景
5. **不复活 `surfaceSunken`**(`#2A2014`,L=12%):之前选了它,色相饱和度都偏离太远,不是"和主背景一致",而是"独立暖底"

### Token 命名

候选名称:
- `titleSurface` —— 表达"Title 段表面"语义,清晰
- `backgroundDeep` —— 与 `backgroundSecondary` / `backgroundDarker` 形成"background 家族"
- `surfaceTitle` —— 表达"标题表面",语义同样清晰

**推荐**:`titleSurface`(短、明确、专给 Title 用,避免与 `background` 系列混淆)。对应 `wastelandColors.titleSurface = '#13100B'`。

## Requirements

- **R1 新 token**:`wastelandColors.titleSurface = '#13100B'`,hex 合法。
- **R2 StatusBar.backgroundColor**:用 `titleSurface`,不再用 `background` / `surfaceSunken`。
- **R3 spec 文档**:`theme-skin.md` §3 Contracts 添加 titleSurface 说明(含 HSL/与主背景差异/APCA/唯一调用点),不引用 `surfaceSunken`(它是已废弃的).
- **R4 保留不动**:StatusBar `paddingY={1}`(3 行加高);AgentTabs 聚焦/失焦 `borderStyle='single'` 高度锁定。
- **R5 与主背景"一致"**:`titleSurface` 的 hue 与 `background` 33° 差距 ≤ 10°,saturation 差距 ≤ 5 个百分点。

## Acceptance Criteria

- [ ] `wastelandColors.titleSurface = '#13100B'` 存在。
- [ ] `wastelandColors.surfaceSunken` **仍不存在**(上轮已删除,本任务不再复活)。
- [ ] `grep -r surfaceSunken src/ .trellis/spec/` → 空。
- [ ] StatusBar `backgroundColor` = `wastelandTheme.colors.titleSurface`。
- [ ] `.trellis/spec/frontend/theme-skin.md` §3 有 `titleSurface` 段,提到 design rationale。
- [ ] `npm run check:contrast` 通过(13 skins)。
- [ ] typecheck/lint 通过。
- [ ] AgentTabs.test.ts 39/39 仍 pass;全量 test baseline 等同 acb4cca(忽略 3 个预存在 logs.test.ts 失败)。

## Definition of Done

- 一次 commit 完成 3 文件改动。
- commit message 明确"基于主背景同色系微调"的设计动机,显式引用本任务 id。

## Out of Scope

- 不复活 `surfaceSunken`。
- 不重做 AgentTabs / StatusBar 其它部分。
- 不调整 wasteland 其它 token / 主题面板。

## Technical Notes

### 改动文件清单

- `src/theme/wasteland/colors.ts` —— 加 `titleSurface: '#13100B'`(附行内注释指明设计动机、与主背景对比)。
- `src/tui/components/StatusBar.tsx` —— `backgroundColor` 改用 `titleSurface`。
- `.trellis/spec/frontend/theme-skin.md` —— §3 Contracts 加 `titleSurface` 段(HSL/与主背景对比/APCA/允许调用点)。

### Token 选择依据

`#13100B` 选 L=6% 而非 L=7%(很微妙接近主背景)—— 用户原文"可以稍微深一点"暗示视觉上要能看出差。L=-1 (即 `#16120D`) 差异太小,用户可能看不出差别;L=-2 (即推荐) 处于"看得出但不刺眼"区间。L=-3 / -4 更显眼但偏离用户原意"稍微"。

### 不需要的研究

- 横向对比其他 TUI StatusBar 设计:本次按本仓库主题走,不需外部参考。
- transparent border / 透明 token:本次完全不涉及,不需查。

### 风险

- 0 — 与 acb4cca 同样简单的 token 局部改动。但**这次专门走 design-first 流程,避免再次表面"`#2A2014` 突兀"**。
