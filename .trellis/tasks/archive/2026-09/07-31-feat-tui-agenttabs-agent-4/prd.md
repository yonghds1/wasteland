# feat(tui): AgentTabs 进入时默认选中激活 agent, 选中/激活 4 态样式区分

## Goal

修复用户在 agentbar focus 后"切换 agent 不直观"的体验,具体 4 件事:

1. **进入时默认选中激活的 agent** —— focus 进 AgentTabs 时,`selectedIdx` 初始化为当前激活 agent 的索引(由 `viewFilter` 决定)。
2. **方向键切换 agent 焦点** —— 已有的 `←`/`→` 不动。
3. **"选中" 视觉化** —— `isSelected` 时(用户在 AgentTabs 内用方向键移到的 tab),视觉明显区分于未选中。
4. **"激活" 视觉化** —— `isActive`(匹配 viewFilter)时,视觉明显区分于未激活;**且**必须跟"选中"区分。

当前实现把"选中" 和"激活"合并到同一个 bold + primary 视觉,导致选中主 agent 时跟"已经激活了它"完全看不出差。

## What I already know

### 状态组合(4 种)

| isSelected | isActive | 含义 | 当前视觉 |
|---|---|---|---|
| ❌ | ❌ | 普通 tab | `muted` 颜色,无 bold |
| ✅ | ❌ | 用户方向键移到的 tab | `muted` 颜色 + bold + ▶ 前缀 — **bug**:muted + bold 几乎与 muted 无视觉差 |
| ❌ | ✅ | 已应用 filter 的 tab | `primary` 颜色 + bold |
| ✅ | ✅ | 用户已选 + 当前激活 | `primary` 颜色 + bold + ▶(跟"仅激活"看不出区别) |

### 现有代码

`src/tui/components/AgentTabs.tsx:386-394`:

```ts
{viewport.visibleTabs.map((tab, vi) => {
  const originalIdx = viewport.visibleIndices[vi] ?? -1;
  const isSelected = originalIdx === selectedIdx;
  const isFiltered = tab.id === persistentId;
  const color = isFiltered
    ? wastelandTheme.colors.primary
    : wastelandTheme.colors.muted;
  const prefixChar = vi === visibleSelectedIdx ? '▶' : ' ';
  return (
    <Text key={tab.id} color={color} bold={isSelected || isFiltered}>
      {prefixChar}[{displayName} {statusIcon(tab.status)}]
    </Text>
  );
})}
```

`persistentId = getPersistentHighlightId(tabs, state.viewFilter)`,即 `tabs.find(... === viewFilter)` 或 undefined(viewFilter=undefined → 全部显示 → Main 在 idx 0 视为"激活")。

注意 —— `getPersistentHighlightId` 已经把 `viewFilter === undefined` 映射到 undefined(非匹配),所以 Main 是"激活" 但 `tab.id` 仍是 `'main-agent-id'` 而非 Main 这名字。需要重新审视 viewFilter 跟 tab.id 的关系。

看 `buildTabs`:`tab.id = a.id`,Main 的 id 来自 `state.session.agents[0]`(runtime 上推的 uuid)。`viewFilter === undefined` 不匹配任何 tab。

所以"当前激活 = Main"视觉上要单独处理(viewFilter === undefined 的情况)。

### 改动文件清单

- `src/tui/components/AgentTabs.tsx` —— 加 `useEffect` 监听 `focusArea` 变化重置 selectedIdx;render 用新的 4 态视觉映射。
- `src/tui/components/AgentTabs.test.ts` —— 加 ≥3 cases:
  - selectedIdx 初始化 = viewFilter 对应 idx(viewFilter='child-1' → initial selectedIdx = 1)
  - selectedIdx 初始化 = 0 当 viewFilter=undefined(Main is "active")
  - 4 态视觉验证(纯函数化)
- `.trellis/spec/frontend/focus-management.md` §3 'Convention':可加一段解释"agentbar 进入时默认状态"。
- 不动 App.tsx(本任务不再修 Enter 跳焦点 bug;Enter 修复是上一轮已落地的方案 C 之外的事,与本任务解耦;用户没明确要求改 Enter 行为)。

## Requirements

- **R1 进入默认**: focus 进 AgentTabs 后,`selectedIdx = idx of tab matching state.viewFilter`;若 `viewFilter === undefined`,`selectedIdx = 0`(Main 默认激活)。
- **R2 selectedIdx 在 focusArea !== 'agentTabs' 时不重置**:只在 transition `non-agentTabs → agentTabs` 时一次重置,避免用户每次渲染都跳。
- **R3 4 态视觉**(以 preview 给用户选):
  - **Idle(isSelected=false, isActive=false)**: 弱 visual,默认 muted text。
  - **Selected-only(isSelected=true, isActive=false)**: ▶ prefix, primary 颜色, bold(让用户清楚"我方向键移到了这")。
  - **Active-only(isSelected=false, isActive=true)**: 非 ▶ prefix 但加 `●` 后缀,primary 颜色, bold(让用户清楚"这是消息过滤目标")。
  - **Selected + Active**: ▶ prefix + `●` 后缀,primary 颜色, bold + background highlight(主键那"我自己既选了又被过滤")。
- **R4 视觉映射可单测**:抽 pure function `getAgentTabStyle(tab, {isSelected, isActive, isFocused}): AgentTabStyle`,组件渲染消费。
- **R5 Esc 行为保留**:从 AgentTabs 按 Esc 仍然跳回 inputBar(inputMode=true),不破坏 07-31 修复。
- **R6 tests**:AgentTabs.test.ts 现 45 cases + 新增 ≥3 cases,全部 pass。
- **R7 typecheck/lint/contrast/locale-parity/i18n 全绿**。

## Acceptance Criteria

- [ ] `useEffect` 在 `state.focusArea` 切到 `'agentTabs'` 时,根据 viewFilter 重置 selectedIdx。
- [ ] `selectedIdx` 在 `state.focusArea === 'agentTabs'` 时不再被 useEffect 反复重置。
- [ ] 4 态视觉在 dev mode 肉眼可区分(visual preview 跑通)。
- [ ] `getAgentTabStyle` 新 pure 函数覆盖 4 态,单测 4 cases。
- [ ] AgentTabs.test.ts 现 45 + 新 ≥3 cases 全部 pass。
- [ ] typecheck/lint/contrast/locale-parity/i18n validate 全绿。
- [ ] 全量 test baseline 等同 b358930 后(忽略 3 预存在 logs.test.ts 失败)。

## Definition of Done

- 一次(或紧凑两段)commit 完成 AgentTabs 内 4 态视觉 + selectedIdx 重置 + 测试覆盖。

## Out of Scope

- **不动 App.tsx Enter 抢焦点问题** —— 那是上一轮分析里另一个 bug,本任务有意识不修。用户当前要的是"切换 agent 清晰",Enter 抢焦点是另一回事。
- 不改 AgentTabs useInput 的方向键行为。
- 不改 viewFilter 持久化或初始语义。

## Technical Notes

### pure function 抽取

```ts
export type AgentTabVisualState =
  | 'idle'
  | 'selected'
  | 'active'
  | 'selectedActive';

export interface AgentTabStyle {
  state: AgentTabVisualState;
  colorKey: 'muted' | 'primary' | 'textEmphasized';
  bold: boolean;
  hasSelectionArrow: boolean;  // ▶ prefix
  hasActiveDot: boolean;       // 后缀 ● for active
  hasHighlightBg: boolean;     // backgroundColor highlight box
}

export function getAgentTabStyle(opts: {
  isSelected: boolean;
  isActive: boolean;
}): AgentTabStyle {
  if (opts.isSelected && opts.isActive) {
    return {
      state: 'selectedActive',
      colorKey: 'primary',
      bold: true,
      hasSelectionArrow: true,
      hasActiveDot: true,
      hasHighlightBg: true,
    };
  }
  if (opts.isActive) {
    return {
      state: 'active',
      colorKey: 'primary',
      bold: true,
      hasSelectionArrow: false,
      hasActiveDot: true,
      hasHighlightBg: false,
    };
  }
  if (opts.isSelected) {
    return {
      state: 'selected',
      colorKey: 'primary',
      bold: true,
      hasSelectionArrow: true,
      hasActiveDot: false,
      hasHighlightBg: false,
    };
  }
  return {
    state: 'idle',
    colorKey: 'muted',
    bold: false,
    hasSelectionArrow: false,
    hasActiveDot: false,
    hasHighlightBg: false,
  };
}
```

### useEffect 选 idx 逻辑

```ts
// 新增
const prevFocusRef = useRef(state.focusArea);

useEffect(() => {
  const prevFocus = prevFocusRef.current;
  prevFocusRef.current = state.focusArea;
  
  if (prevFocus === 'agentTabs') return; // 已经在 agentTabs 内,不需要再次重置
  
  if (state.focusArea === 'agentTabs') {
    // 进入 agentTabs → 把 selectedIdx 重置到 viewFilter 对应的 idx
    let targetIdx: number;
    if (state.viewFilter === undefined) {
      targetIdx = 0;  // Main 默认
    } else {
      const found = tabs.findIndex((t) => t.id === state.viewFilter);
      targetIdx = found >= 0 ? found : 0;  // 不匹配 fallback Main
    }
    setSelectedIdx(targetIdx);
  }
}, [state.focusArea]);  // 故意不依赖 tabs/viewFilter,只在 focus transition 触发
```

### render 中 style 消费

```tsx
const activeId = state.viewFilter ?? tabs[0]?.id; // "active" 包含 Main

{viewport.visibleTabs.map((tab, vi) => {
  const originalIdx = viewport.visibleIndices[vi] ?? -1;
  const isSelected = originalIdx === selectedIdx;
  const isActive = tab.id === activeId;
  const style = getAgentTabStyle({ isSelected, isActive });
  
  const prefixChar = style.hasSelectionArrow ? '▶' : ' ';
  const suffix = style.hasActiveDot ? ' ●' : '';
  
  return (
    <Text
      key={tab.id}
      color={wastelandTheme.colors[style.colorKey]}
      bold={style.bold}
      backgroundColor={style.hasHighlightBg ? wastelandTheme.colors.backgroundDarker : undefined}
    >
      {prefixChar}[{displayName} {statusIcon(tab.status)}]{suffix}
    </Text>
  );
})}
```

(注:`hasHighlightBg` 用 `backgroundDarker`,跟原 StatusBar 同色,palette-safe。)

### 风险

- `useEffect` 副作用仅在 focusArea 跳到 'agentTabs' 时触发一次,但 React 18 strict mode 会渲染两次,需要 `prevFocusRef` 守门避免 focusArea 已为 agentTabs 时被再次重置。
- `tab.id` 与 Main agent uuid 的关系需在测试里假数据覆盖。
- 4 态视觉用 Ink 颜色(`#E6B450` + `#FFF3D6` 等)都是 256-color palette 不友好的(都是 > 50 RGB 通道值,deep palette 都是 black 16);highlights 仍需谨慎设计。本任务暂时只在文字前缀/后缀 + color 区分,bg highlight 仅在 selectedActive(小概率发生,样本小)上,视觉代价低。

## 收口记录（2026-09-15）

AgentTabs 落地（src/tui/components/AgentTabs.tsx 在位），四项：默认选中激活项、方向键切换、选中与激活两态视觉区分。
