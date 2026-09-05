# Quality Guidelines

> Status: Established (pure-function extraction rule added 07-30).

## Observed Baseline / 已观察到的基线

- `.trellis/workflow.md` establishes a planning-first task workflow, spec maintenance, and quality-check expectations at the project level.
- 五闸门：`npm run typecheck` / `npm run lint` / `npm run validate:i18n` / `npm run check:locale-parity` / `npm run test`
- Baseline lint 现状：仓库预存 ~75 个 lint 问题，**与本次任务无关**（不在新改文件里），列入 backlog 后续清理
- 测试：`vitest` + Ink test renderer（仅 InitWizard 等少数组件用 Ink 测试，普通组件用纯函数单测）

## Rule For Now / 当前规则

- 五闸门全绿是合并前提（typecheck / lint / validate:i18n / check:locale-parity / test）
- 新增 i18n 键必须 zh + en 对位
- 引入新依赖需在 PR 中说明理由

---

## Convention: Pure-function extraction for testability（07-30）

**When**: 组件内有复杂决策逻辑（如 `useInput` 内的状态机、tab 构建、视口计算、filter setter 语义），但 vitest 无法直接渲染 Ink 测 `useInput` 内部。

**Source**: `src/tui/components/AgentTabs.tsx` + `AgentTabs.test.ts`（07-30，33 tests）

**Rules**:
1. **复杂决策必须提取为可独立测试的纯函数**，export 出组件模块（即使组件内只用一次）
2. **纯函数必须无副作用**（不调 React hooks、不读 context、不修改外部状态）
3. **纯函数类型签名必须显式**，不依赖推断
4. **测试文件与组件同名**（`.test.ts` 或 `.test.tsx`），放在同目录
5. **useInput body 内只做 dispatch**：调用纯函数 + setState，不含 if/else 决策树

**Example（AgentTabs 07-30）**:

```typescript
// 组件模块内 export 纯函数
export function buildTabs(agents: ReadonlyArray<AgentNode>): AgentTab[] {
  return [
    { id: 'main', name: 'Main', status: 'running', isMain: true },
    ...agents.filter(a => a.depth >= 0).map(/* ... */),
  ];
}

export function selectTabViewFilter(tab: AgentTab): string | undefined {
  return tab.isMain ? undefined : tab.id;
}

// useInput 只做 dispatch
useInput((input, key) => {
  if (state.focusArea !== 'agentTabs') return;
  if (key.return) setViewFilter(selectTabViewFilter(tabs[selectedIdx]));
});
```

**Tests Required**:
- 每个 export 纯函数至少一个 happy path 测试 + 一个 edge case 测试
- 边界：空数组、单元素、含 `null`/`undefined` 字段、特殊值（Main、empty id）

**Why**:
- vitest 不渲染 Ink，useInput 不可直接测
- 决策逻辑藏在 useInput 内 = 测试盲区
- 提取纯函数后，决策变更只需改纯函数 + 测试，无需重渲染组件

---

## Convention: 闸门一致性

**When**: 任何 PR / commit 修改前端代码。

**Must run before commit**:
```bash
npm run typecheck
npm run lint
npm run validate:i18n
npm run check:locale-parity
npm run test
```

**Baseline exceptions**:
- 仓库预存 lint 问题允许在 PR 中新增同类（不要求一次性清理）
- 预存失败的 test（`src/commands/__tests__/logs.test.ts` 3 个）不在本任务修复范围，单独 task 跟踪

**Definition of Done**（前端补充）:
- 五闸门全绿
- 改动文件清单与 PRD 一致
- 测试文件覆盖关键路径（用纯函数测试 useInput 决策）
- 任何新增 i18n 键 zh + en 双语对位

---

## Anti-patterns / 反模式

### Don't: 把决策藏在 useInput body

```typescript
// Bad: if/else 决策藏在 useInput 内,无法单测
useInput((input, key) => {
  if (state.focusArea !== 'agentTabs') return;
  if (key.return) {
    const tab = tabs[selectedIdx];
    setViewFilter(tab.isMain ? undefined : tab.id);  // 决策 + 副作用混在一起
  }
});
```

### Don't: 在 useMemo 内构造 context value 但不写依赖数组

```typescript
// Bad: 静默失效,context value 每次 render 都是新的
<Context.Provider value={{ state, setViewFilter }}>
  ...
</Context.Provider>
```

### Don't: 让 useInput 处理非自己 focusArea 的键

```typescript
// Bad: 没 gating,即使焦点不在 agentTabs 也会触发
useInput((input, key) => {
  if (key.leftArrow) setSelectedIdx(i => i - 1);  // 全局响应,污染输入框 ←/→
});
```

### Don't: 在组件内新增颜色字面量

```typescript
// Bad
<Text color="#ff0000">error</Text>
// Good
<Text color={wastelandTheme.colors.warning}>error</Text>
```

---

## Future Update Checklist / 后续补充清单

- [x] 五闸门清单
- [x] Pure-function extraction（07-30）
- [x] useInput gating 约定（参见 `focus-management.md` §6）
- [ ] Accessibility checks (a11y TUI 暂不适用,跳过)
- [ ] 视觉回归测试（暂未引入,可考虑 snapshot 关键 layout）
- [ ] 清理 baseline lint 75 个问题（独立 task）
- [ ] 修复 `logs.test.ts` 3 个预存失败（独立 task）