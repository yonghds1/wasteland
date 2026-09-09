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

## Convention: 布局回归的双侧防线（防"测量与断言串供"，09-08 /logs 撑屏修复）

**When**: 用行预算防纵向撑屏（见 `component-guidelines.md` §行预算布局）时，决定"在哪一层写回归测试"。

**核心坑**：漏计发生在**测量侧**（如 `measureCard` 少算一个 `marginTop`），而 `planRows`
自洽断言读同一份测量 → 两者一起漏，**恒绿却挡不住撑屏**。渲染侧帧断言
（末帧 `split('\n').length ≤ rows`）能抓**整块溢出**（空页 27→24 已证有效），
但抓不到 **±1 行漏计**——外层 `height="100%"` + 截断 slack 会把 1 行误差吸收掉。

**Rules**（两层都要，缺一不可）：
1. **测量层显式断言**：对每个占行元素直接断言其 chrome 计数
   （如 `expect(measureCard(expanded).detailChromeRows).toBe(1)`、折叠态 `toBe(0)`、
   以及 `planRows` 求和随该字段 ±1），**独立于 planRows 自洽**——这是唯一能确定观测 ±1 漏计的地方。
2. **渲染层帧断言**：以真实 Ink 渲染组件树（`FakeStdout` 带 `columns`/`rows`，
   非 TTY 下 unmount 写末帧），strip ANSI 后断言行数 ≤ rows、顶栏在位、
   滚动条按需出现、任一可视行显示宽 ≤ columns。参考 `src/tui/components/__tests__/logs-frame.test.tsx`。
3. **防串供自检**：新写测量断言后，临时把被测字段回退（如 `detailChromeRows = 1` 改 `0`），
   **测量断言须变红、帧断言仍绿**——若两者同红或同绿，说明断言没守在该守的层。
4. 帧测试不引未声明的传递依赖（`strip-ansi` 是 ink 的 transitive，须本地实现 ANSI 正则；
   宽度用已声明的 `string-width` via `card-window.displayWidth`）。

**Why**:
- 单靠 planRows 自洽 = 自证，测不到测量侧的"少算"
- 单靠帧断言 = 常规终端下 ±1 被 slack 吸收，测不到边界
- 两层 + 防串供自检，才能锁定"渲染行数恒 ≤ 预算"这条铁线

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
- ~~预存失败的 test（`src/commands/__tests__/logs.test.ts` 3 个）~~（09-08 全量 `vitest run` 复验已全绿，该例外记录作废）

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