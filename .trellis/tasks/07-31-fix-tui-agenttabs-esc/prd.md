# fix(tui): AgentTabs 聚焦可视化 + Esc 双焦点修复

## Goal

修复 TUI 中两处与「AgentTabs 焦点」相关的问题:

1. **行为 bug**:Esc 退出 `inputBar` 时,`ChatInputBar` 的 `setFocusArea(null)` 覆盖 `App` 的 `setFocusArea('agentTabs')`,导致 Esc 后焦点落在 `null` 而非 `agentTabs`——所以方向键、Enter 切换 filter 全部不响应。
2. **可视 bug**:`AgentTabs` 组件的 render 完全不读 `state.focusArea`,即便焦点真的进了 `agentTabs`(例如通过 Tab 切过去),屏幕上看不出任何「已聚焦」的视觉差异。用户感知与 bug① 同源,叠加放大。

让 Esc 之后焦点可靠落在 `agentTabs`,并让该状态在屏幕上看得见。

## What I already know

### 文件与契约

- **`src/tui/App.tsx:295-303`**:Esc 双向 toggle 期望路径(inputMode→agentTabs、agentTabs→inputBar+inputMode=true),**这是期望契约**。
- **`src/tui/components/ChatInputBar.tsx:62-66`**:ChatInputBar 的 Esc handler 多写了 `setFocusArea(null)`,**这是 bug 根源**——Ink 的 `useInput` 按注册顺序广播(父先子后),`App` 先设的 `'agentTabs'` 被 `ChatInputBar` 后设的 `null` 覆盖。
- **`src/tui/components/ChatInputBar.tsx:29-42`**:`useEffect` 自动拉回逻辑有豁免(`wasInputMode=true` 时不拉回),配合 App 的 Enter 分支可重入,无需改动。
- **`src/tui/components/AgentTabs.tsx:277-300`**:本身的 `useInput` handler 写得正确(`if state.focusArea !== 'agentTabs' return`),只是被 bug① 阻断永远进不来。
- **`src/tui/components/AgentTabs.tsx:303-325`**:render 块完全不读 `state.focusArea`,聚焦态无可视反馈。
- **`src/tui/components/App.tsx:340-371`**:Tab cycle 已存在 `session: ['inputBar','agentTabs']`,路径已就位,无需扩 Tab 处理逻辑。

### 主题 token 现成可用

- `wastelandTheme.colors.borderFocused = '#E6B450'`(`src/theme/wasteland/colors.ts:26`)——给 AgentTabs 整条加 focused 边框已有现成 token。
- `wastelandTheme.colors.primary = '#E6B450'` —— 与 borderFocused 同色,用作「已聚焦」的 selected tab 反白。
- `wastelandTheme.colors.muted = '#7D7468'` —— 失焦 tab 默认色(已用,无需改)。

### Ink 渲染注意

- `<Box borderColor={...} borderStyle="single">` 会占 1 列边距且 Ink 不同终端上宽度表现可能略不同——若选「加边框」方案,要预留 layout shift 风险。
- 当前 `AgentTabs` 父级 `<Box flexDirection="row" flexShrink={0} paddingX={1}>` 没有 border,加 border 后需要确认 `computeViewport` 的 `reserved=8` 仍充足(简单实测加 2-4 列足够)。

## Assumptions (temporary)

- 视觉方案首选「聚焦时整条 Box 加 `borderFocused` 边框」——颜色 token 现成、对沉浸式废土主题契合、需要最少的现有样式改动。
- 修改后:`AgentTabs` 在 `state.focusArea === 'agentTabs'` 时整条 Box 加单边框,selected tab 文本保持现有 `▶ + bold` 语义。
- 这次不触碰其它 focus area(仅 `agentTabs`,chat inputBar 仍由 `borderFocused` 之外的 prompt 视觉体现聚焦——本次不动)。
- 现有测试 `src/tui/components/AgentTabs.test.ts` 仅覆盖 buildTabs / computeViewport / selectTabViewFilter / statusIcon,不覆盖可视层,新增可视测试可用 ink-testing-library 或直接 snapshot Tab 数据。

## Open Questions (待确认)

- 唯一偏好问题:AgentTabs 聚焦的视觉指示选哪种?→ 见下一条消息(单问题)。

## Requirements (evolving)

- **R1 行为修复**:`App` 与 `ChatInputBar` 的两个 Esc handler 必须只设一次 `focusArea`。约定:`focusArea` 由 `App` 唯一决定,`ChatInputBar` 退出输入模式时**不**动 focusArea。
- **R2 视觉**:`AgentTabs` 在 `state.focusArea === 'agentTabs'` 时,屏幕上有清晰、立即可辨认的「已聚焦」视觉;失焦时该视觉消失。
- **R3 不引入新焦点循环**:保持 Tab cycle 仍为 `['inputBar','agentTabs']`,不增加新 focus area。
- **R4 回归**:Esc 在 inputBar 时不再把焦点设 `null`;Esc 在 agentTabs 时仍然正确回到 inputBar+inputMode(true);Enter 在非输入模式时仍能进入 inputBar。

## Acceptance Criteria

- [ ] 在 inputBar 输入模式按 Esc:焦点可见地落在 `agentTabs`,**且方向键 ← / → 能切换 selectedIdx**(屏幕可见 ▶ 移动)。
- [ ] 在 `agentTabs` 按 Esc:焦点切回 `inputBar` 且 `inputMode=true`。
- [ ] 按 Tab 在 inputBar 与 agentTabs 间循环,聚焦可视立即变化。
- [ ] `App.tsx:295-303` 的双向 toggle 契约保持原样,只移除 `ChatInputBar.tsx:62-66` 的 `setFocusArea(null)`。
- [ ] 现有 `AgentTabs.test.ts` 测试仍全绿;新增至少 1 个针对「focusArea change → visual 状态变化」的测试。
- [ ] `pnpm lint && pnpm typecheck && pnpm test` 全绿。

## Definition of Done (team quality bar)

- 行为 bug 一次性修掉,Esc 后用方向键验过。
- AgentTabs 聚焦有可视化,多人目视可一眼判断当前焦点。
- 没有改其它 focus area 的语义。
- 提交后 `.gitignore` 提示的运行时装制品没被混进去。
- 没有破坏现有 ink snapshot / 单元测试。

## Out of Scope (explicit)

- 不重做 Tab 循环(本次仅 fix 既有双向 toggle)。
- 不动 ChatInputBar 自身的其它视觉(placeholder / 快捷键提示上次已重构过,本次不碰)。
- 不改 `AgentTabs` 现有 selectedIdx / viewFilter / 视口算法的纯函数逻辑。
- 不调整 contrast 阈值或皮肤调色板(用户看到的「不死老乔背景黑」是 StatusBar 用 `backgroundDarker` 的全局设计,本次不动)。
- 不开新 sub-agent 调研 UX(可视方案用现有 token)。

## Technical Notes

### 修复点 ①:`src/tui/components/ChatInputBar.tsx`

```ts
// 修改前 (lines 62-66):
if (key.escape) {
  setInputMode(false);
  setFocusArea(null);     // ← 删掉
  return;
}

// 修改后:
if (key.escape) {
  setInputMode(false);
  // focusArea 由 App.tsx 的 Esc 处理决定下一焦点
  return;
}
```

副作用面:`ChatInputBar` 销毁/重建时 `focusArea` 可能短暂落在 null?需要确认。但 useEffect on `state.inputMode` 没有强制 setFocusArea,所以默认 null 状态下 Tab 仍可正常进入 cycle。**零破坏。**

### 修复点 ②:`src/tui/components/AgentTabs.tsx`

```tsx
const { state, ... } = useAppContext();
const isFocused = state.focusArea === 'agentTabs';

return (
  <Box
    flexDirection="row"
    flexShrink={0}
    paddingX={1}
    borderStyle={isFocused ? 'single' : undefined}
    borderColor={isFocused ? wastelandTheme.colors.borderFocused : undefined}
  >
    ... // 其余渲染不变
  </Box>
);
```

注意点:
- `borderStyle="single"` 会让 Box 宽 +2 列。`computeViewport(..., reserved=8)` 当前留 8 列给 overflow indicator + padding 估算,加 border 后宽度变化在终端大小时不应该突破保留预算,但是测试保留足够。若有溢出,临时把 reserved 提到 10。
- 选了 `borderFocused` 是因为与废土主题的 primary 同色,与现有 brand 协调。

### 风险与边界

- **TUI 终端兼容性**:`borderStyle` 在现代终端(alacritty/iTerm2/WezTerm)都没问题;但 Windows CMD 老版不支持。可接受。
- **focusArea race**:Ink 重渲染是单线程顺序,setState 合并按调用顺序,父→子规则下 `ChatInputBar` 不再 setFocusArea,父的 `'agentTabs'` 不会被打掉。
- **useEffect 自动拉回**:`ChatInputBar.tsx:29-42` 在非 inputMode + 非 showHelp + 非 exitConfirm 时强制拉回 inputBar(inputMode=true),首启动 + 会话切换场景不受影响。

### 不需要的研究

- 这次不查 Ink `useInput` 内部实现(已知结论)。
- 不查其它 TUI(OpenCode/Claude Code)对 AgentTabs 这类组件聚焦的设计——本次方案用本仓库现有 token 与已有 contract,不需横向对比。
