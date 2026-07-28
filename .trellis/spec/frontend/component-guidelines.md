# Component Guidelines

> Current status / 当前状态：前端是基于 Ink + React + TypeScript 的终端 UI。

---

## Observed Patterns / 已建立模式

- 组件位于 `src/tui/components/*.tsx`，使用函数组件与显式 Props interface。
- 共享运行时状态通过 `src/tui/context/AppContext.tsx` 提供；事件订阅封装在 `src/tui/hooks/`。
- Ink 的 `Box` 负责布局，`Text` 负责文本和颜色。
- 视觉 token 从 `src/theme/wasteland/index.ts` 的 `wastelandTheme` 获取。
- 内容从 `RoleSkin.roleUi` / `systemCommon` 获取 i18n key，再在渲染时调用 `t()` 或 `tArray()`。

代表组件：

- `src/tui/components/ChatMessageList.tsx`
- `src/tui/components/ChatInputBar.tsx`
- `src/tui/components/StatusBar.tsx`

---

## Rules / 规则

- Props interface 应紧邻组件定义，并为非显然属性添加注释。
- 不在组件中新增颜色字面量或复制 theme token；统一使用 `wastelandTheme.colors.*`。
- 不直接读取旧式 `skin.ui.*`；角色内容使用 `selectedSkin.roleUi.*`，系统内容使用 `systemCommon.*`。
- Skin 中保存的是翻译键，不是已经翻译的 TUI 文案；组件负责在当前语言下解析。
- 英文 persona 只进入 runtime system prompt，不渲染为普通 TUI 文案。
- 保留终端窄宽度下的 `wrap` / `truncate` 行为，避免依赖浏览器 CSS。
