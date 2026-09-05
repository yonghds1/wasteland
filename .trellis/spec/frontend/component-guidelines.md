# Component Guidelines

> Status: Established (AgentTabs pattern added 07-30; baseline patterns from 06-xx onward).

## Observed Patterns / 已建立模式

- 组件位于 `src/tui/components/*.tsx`，使用函数组件与显式 Props interface。
- 共享运行时状态通过 `src/tui/context/AppContext.tsx` 提供；事件订阅封装在 `src/tui/hooks/`。
- Ink 的 `Box` 负责布局，`Text` 负责文本和颜色。
- 视觉 token 从 `src/theme/wasteland/index.ts` 的 `wastelandTheme` 获取。
- 内容从 `RoleSkin.roleUi` / `systemCommon` 获取 i18n key，再在渲染时调用 `t()` 或 `tArray()`。
- **辅助信息组件默认 1 行**（07-31 后:AgentTabs 同时承担原 StatusBar 角色,合并到同一行;展开/多行是 opt-in）。

代表组件：

- ~~`src/tui/components/StatusBar.tsx`~~(07-31 后删除,职责合并到 AgentTabs)
- `src/tui/components/AgentTabs.tsx` — 顶部 sub-agent 切换 tab + skin label + thinking/streaming prose 三合一(07-30 引入,07-31 后扩展)
- `src/tui/components/ChatMessageList.tsx`
- `src/tui/components/ChatInputBar.tsx`
- `src/tui/components/HelpCommandsView.tsx` — `/help` dialog（07-30-help-dialog-mode）
- `src/tui/components/HelpShortcutsView.tsx` — `?` key dialog（07-30-help-dialog-mode）

---

## Rules / 规则

- Props interface 应紧邻组件定义，并为非显然属性添加注释。
- 不在组件中新增颜色字面量或复制 theme token；统一使用 `wastelandTheme.colors.*`。
- 不直接读取旧式 `skin.ui.*`；角色内容使用 `selectedSkin.roleUi.*`，系统内容使用 `systemCommon.*`。
- Skin 中保存的是翻译键，不是已经翻译的 TUI 文案；组件负责在当前语言下解析。
- 英文 persona 只进入 runtime system prompt，不渲染为普通 TUI 文案。
- 保留终端窄宽度下的 `wrap` / `truncate` 行为，避免依赖浏览器 CSS。
- **组件若使用 `useInput`，必须先检查 `focusArea` 并 short-circuit**（参考 `focus-management.md` §6）。
- **组件中的复杂决策逻辑应提取为可独立测试的纯函数**（参考 `quality-guidelines.md` §Pure-function extraction）。

### i18n Self-Check 约定(07-30)

**Before committing any TUI component that calls `t(...)`**:
1. **Verify every key path exists in both `src/locales/en.json` and `src/locales/zh.json`**.
2. Run `npm run check:locale-parity` to catch missing keys automatically.
3. If a key is missing, `t()` falls back to returning the raw key string (e.g. `"tui.shortcuts.help"`) — visible to users as a literal typo.

**Symptom of violation**: dialog or component renders `tui.<path>.<key>` literal text instead of the intended translation. The 07-30 review caught this in `HelpShortcutsView.tsx` where it referenced `tui.shortcuts.help` and `tui.shortcuts.inputMode` without the corresponding i18n keys existing.

**Fix**:
```ts
// ❌ Bad: assumes key exists, falls back to raw key
<Text>{t('tui.shortcuts.help')}</Text>

// ✅ Good: verify key exists, OR add to both locales
// src/locales/en.json: "tui": { "shortcuts": { "help": "Help" } }
// src/locales/zh.json: "tui": { "shortcuts": { "help": "帮助" } }
<Text>{t('tui.shortcuts.help')}</Text>
```

---

## Pattern: Top-bar Auxiliary Component(顶部辅助带,07-31 后合一同 1 行)

**When**: 在消息主体之上需要一个**始终可见、默认 1 行、可滚动、可交互**的辅助信息带;同时承担原 StatusBar 的"品牌身份 + thinking/streaming 状态 prose"职责。

**Source**: `src/tui/components/AgentTabs.tsx`(07-30-agent-tabs-topbar;07-31 后扩展承担原 StatusBar 的 brand + status prose)

**结构(07-31 合并后)**:
```
<Box flexDirection="column" width={terminalColumns} height={terminalRows}>
  <AgentTabs runtime={runtime} />    {/* 顶部辅助带单一组件:
                                          含 skin label 后缀 on Main
                                          + thinking/streaming prose on right */}
  <Box flexGrow={1}>{messageArea}</Box>
  <ChatInputBar />                    {/* 现有 */}
</Box>
```

不再有独立的 `<StatusBar />` 行 —— 全部职责合并到 AgentTabs。节省约 4 行垂直空间。

**关键约束**:
- 顶部辅助带必须 `flexShrink={0}`，固定 1 行（展开是 opt-in，由用户主动触发）
- 必须与 ChatInputBar **完全解耦**：独立组件、独立 `useAppContext` 订阅、不依赖 ChatInputBar 任何 state
- 输入区高度变化（多行换行、placeholder 切换）不应影响顶部辅助带位置

**滚动算法（viewport 跟随选中项）**:
```
const { visibleTabs, showLeft, showRight } = useMemo(
  () => computeViewport(tabs, selectedIdx, terminalWidth),
  [tabs, selectedIdx, terminalWidth]
);
```
- 计算每个 tab 的 prefix position
- 视口起点 = `max(0, min(selectedIdx - 2, totalWidth - visibleWidth))`
- 溢出指示器 `◀` 在 `visibleStart > 0` 时显示，`▶` 在 `visibleEnd < totalWidth` 时显示
- 用户切换选中项时视口自动跟随，无需手动滚动键

**useInput gating（AgentTabs 案例）**:
```typescript
useInput((input, key) => {
  if (state.focusArea !== 'agentTabs') return;  // 关键:焦点 gating
  if (key.leftArrow) setSelectedIdx(i => Math.max(0, i - 1));
  if (key.rightArrow) setSelectedIdx(i => Math.min(tabs.length - 1, i + 1));
  if (key.return) setViewFilter(selectTabViewFilter(tabs[selectedIdx]));
  if (key.escape) {
    setFocusArea('inputBar');
    setInputMode(true);
  }
});
```

---

## Pattern: Pure-function extraction for testability

**When**: 组件内有复杂决策逻辑（tab 构建、视口计算、filter setter 语义），但 `useInput` 内不可直接测试。

**Source**: `AgentTabs.tsx` exports 4 个纯函数用于 vitest：
- `statusIcon(status: AgentStatus): string`
- `tabWidth(tab: AgentTab): number`
- `computeViewport(tabs, selectedIdx, width)`
- `getPersistentHighlightId(viewFilter, tabs)`
- `buildTabs(agents): AgentTab[]`
- `selectTabViewFilter(tab): string | undefined`

**Why**:
- vitest 不渲染 Ink，无法直接测 `useInput` 内逻辑
- 提取纯函数后，决策逻辑可独立单测（07-30 AgentTabs.test.ts 33 cases）
- 维护性：决策变更时改纯函数即可，UI 代码不动

**约定**:
- 纯函数必须 export（即使只在组件内使用）
- 纯函数必须无副作用（不调 React hooks、不读 context）
- 测试文件与组件同名 `.test.ts`（不需 `.tsx`，纯函数无 JSX）

---

## Convention: 「Main 表 filter 取消」语义

**When**: 全局 filter 状态（如 `viewFilter`）需要"全部"具象表达。

**Rule**:
- 不要新增 `[All]` 这种专门的 tab/选项
- 改用**已有的 Main/Master 概念**兼任"全部"
- 例如：AgentTabs 第一项永远是 `Main`，选 `Main` = filter 取消（viewFilter = undefined）

**Why**:
- 减少 UI 元素（用户认知成本）
- 复用用户已有心智模型（"主 vs 子"是已有概念）
- 单一取消入口，无需额外键位

---

## Pattern: Wasteland Dialog Decoration (07-30)

**When**: Building dialog/popup components in the TUI that should reflect the wasteland aesthetic.

**Source**: `src/tui/components/HelpCommandsView.tsx`, `src/tui/components/HelpShortcutsView.tsx`

**Decorative constants** (export from `HelpCommandsView.tsx`, reuse across dialogs):
```ts
export const SECTION_PREFIX = '▎ ';  // Section heading prefix
export const BULLET = '▸ ';          // List item prefix (replaces '- ')

export function sectionSeparator(width: number): string {
  return '─'.repeat(Math.max(8, Math.min(40, width - 4)));
}

export function shouldRenderBanner(width: number): boolean {
  return width >= 100;  // Banner only on wide terminals
}
```

**Structure pattern**:
```
┌──────────────────────────────────────────┐
│ ╔════════════════════════════════════════╗ │
│ ║         ⛓  WASTELAND  MANUAL  ⛓         ║ │  ← Banner (width ≥ 100 only)
│ ╚════════════════════════════════════════╝ │
│                                          │
│ 在废土上求生的指令,皆录于此              │  ← Description
│                                          │
│ ▎ 可用指令                                │  ← Section prefix
│   ▸ /help, /h, /?   显示此手册           │  ← Bullet (not '- ')
│   ▸ /tools          查看可用工具          │
│                                          │
│ ▎ 内置工具                                │
│   · 只读工具                              │
│                                          │
│ ──────────────────────────────           │  ← Section separator
│                                          │
│ Session: xxx  Workdir: /home/...         │  ← Compact metadata
└──────────────────────────────────────────┘
```

**Rules**:
- Always use `borderStyle="double"` for wasteland dialog borders (refined, not rough).
- Always test `shouldRenderBanner(width)` — fall back to plain text title on narrow terminals.
- Always reuse `sectionSeparator` — do not inline the math (`'─'.repeat(...)`).
- Extract section content into pure functions (`createHelpCommandsSection` etc.) so they can be unit-tested without Ink.

**Why**:
- `▎` and `▸` glyphs survive better in monospace terminals than `*` or `>`.
- Banner fallback at 100 columns is a common terminal width threshold (most default terminals are 80-120).
- Pure function extraction lets the section content be tested independently of Ink rendering.