# refactor(tui): agentbar 与输入框样式简化

## Goal

把顶部 agentbar 和底部输入框的视觉做得更简洁、大气，减少边框感和块感。

用户明确要求：
- **agentbar 要去掉边框**
- **整体样式要简洁大气**
- 需要同时给出**新的设计方案**，覆盖 agentbar 与输入框的整体关系

## What I already know

### 当前现状

- `src/tui/components/AgentTabs.tsx` 目前仍带有 `borderStyle='single'` + `borderColor={borderFocused/borderDim}` 的 top-bar 边框感。
- `src/tui/components/ChatInputBar.tsx` 目前有明显输入框边框：
  - `borderStyle={wastelandTheme.decorations.borderStyle}`
  - `borderTop`
  - `borderColor={state.inputMode ? wastelandTheme.colors.borderFocused : wastelandTheme.colors.borderDim}`
- 顶部 agentbar 已经承担：
  - skin label / Main tab
  - thinking / streaming prose
  - agent 选择与 viewFilter
- 输入框需要保留清晰的输入焦点感，但不一定要继续依赖重边框。
- `src/tui/components/AgentTabs.tsx` 是唯一允许的顶部辅助带组件，`focus-management.md` 要求 focus cycle 里的组件都必须真能处理输入。

### 用户已选定的方向

- **agentbar 样式方向**: **A: 无框 + 轻底线**
- **输入框样式方向**: **轻底线输入槽**
- **selected 态**: 只用颜色区分，**不需要方向图标（去掉 ▶）**
- **active 态**: 保留 `◆` 标记
- **selected + active**: 颜色 + `◆`
- **视觉语义**:
  - agentbar: 去掉完整边框，靠留白 / 文字态 / 轻底线形成层次
  - 输入框: 保留轻量的输入槽感，但不能抢走 agentbar 的简洁感

### 现有布局语义

- 顶部区域已经从 `StatusBar + AgentTabs` 合并成单一 `AgentTabs` strip。
- 现有风格偏重“边框 + 区块分隔”，用户想把它往更克制、现代一点的方向收敛。

## Assumptions (temporary)

- “去掉边框”主要指 agentbar 的外框不再强制描边。
- 输入框仍需要保留可识别的焦点状态，但可以从“完整框”降级到“轻输入槽”。
- 顶部/底部仍需在视觉上可区分，但区分方式改为更轻的底线、背景色差和文字权重。

## Open Questions

(无 — 已全部收敛)

## Requirements (evolving)

- agentbar 不要再是“框起来的一条”，而要更像一条轻量的导航带。
- 输入框要保留可识别的输入焦点状态，但不能抢走 agentbar 的简洁感。
- 顶部和底部的层次关系要清晰，但不要依赖重边框。
- 顶部辅助带仍要保留 AgentTabs 的交互能力、selected/active 区分、thinking/streaming prose。
- selected 视觉主要依赖颜色，不再需要方向图标；active 仍可用轻标记辅助区分。

## Acceptance Criteria (evolving)

- [ ] agentbar 视觉上没有显眼的完整边框。
- [ ] 输入框保留清晰的可输入状态反馈。
- [ ] 顶部区域和输入框之间的层次更轻、更大气。
- [ ] 在暗色终端和窄宽度终端下都保持可读。
- [ ] agentbar 仍可用方向键 / Enter / Esc 交互。
- [ ] selected 态只靠颜色区分，不再依赖方向图标。

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- 不改 agentbar 的功能语义：选中、激活、过滤、方向键交互都保留。
- 不改输入框的发送/换行/Esc 行为。
- 不改消息列表和帮助页的布局。

## Technical Notes

- 已检查文件：
  - `src/tui/components/AgentTabs.tsx`
  - `src/tui/components/ChatInputBar.tsx`
  - `src/tui/App.tsx`
  - `src/tui/context/AppContext.tsx`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/focus-management.md`
- 当前实现中的主要视觉来源：`borderStyle`、`borderColor`、`paddingX/Y`、`backgroundColor`。
- 这次改造更偏向 UI 结构与视觉节奏，不是功能重构。

## Proposed Design Direction

### 方案 A: 无框 + 轻底线（推荐）

- **AgentTabs**: 去掉外框，不再用完整 `borderStyle='single'` 包住整条。
- **AgentTabs 层次**: 保留一条很轻的底边或下划线，更多依赖留白和文字态表达。
- **输入框**: 保留较轻的底部/顶部边线，但把边框感做淡，只在 focus 时略加强。
- **选中 / 激活态**: selected 只用颜色（去掉 ▶），active 保留 `◆` 后缀，selected+active = 颜色 + `◆`。不靠边框。

#### 为什么推荐
- 最符合“简洁大气”。
- agentbar 本身已经是导航带，不需要再用框强调。
- 输入框仍保有“可输入区域”的识别度，但不会与顶部抢戏。
- 视觉重心会回到内容和选中状态，而不是边框。

#### 风险
- 如果底线过淡，agentbar 和内容区之间的层次会变弱。
- 如果输入框也过淡，焦点感可能不够，需要通过颜色和 prompt 强化。

### 方案 B: 双轻线

- 顶部 agentbar 只保留一条很淡的下边线。
- 输入框只保留一条很淡的上边线。
- 结构更规整，但会比 A 更“工具化”。

### 方案 C: 全无框 + 文字态

- agentbar 和输入框都尽量不画线。
- 完全依赖间距、颜色和字体权重。
- 最简洁，但对终端可读性要求最高。

## Decision (ADR-lite)

**Context**: 用户想让顶部 agentbar 和输入框更简洁大气，明确要求 agentbar 去掉边框。

**Decision**: 采用 **方案 A: 无框 + 轻底线**。

**Consequences**:
- agentbar 会从“框状面板”变成更轻的导航带。
- 输入框保留弱边界，但不再是视觉主角。
- 需要仔细控制颜色和间距，避免失去层次。

## Research References

- [`.trellis/spec/frontend/component-guidelines.md`](../../spec/frontend/component-guidelines.md) — 顶部辅助带必须可交互，且 07-31 后已合并 StatusBar 到 AgentTabs。
- [`.trellis/spec/frontend/focus-management.md`](../../spec/frontend/focus-management.md) — focus cycle 和 useInput gating 规则，不能把一个不可交互的组件放进焦点链。
