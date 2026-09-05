# State Management

> Status: Established (viewFilter convention added 07-30; baseline patterns observed in AppContext).

## Observed State / 已观察到的状态

- 全局状态通过 `src/tui/context/AppContext.tsx` 提供，类型为 `AppState`。
- 局部状态用 React `useState` / `useRef`，封装在 hooks 或组件内。
- 当前**不引入** Zustand / Redux 等第三方状态库（Work Item D 视性能需要再评估）。
- 单视口 TUI 决定了状态层必须简洁；不鼓励引入事件总线 / observable 之外的依赖。

## Local vs Global Boundary / 局部与全局边界

**全局状态（放 `AppState`）** 的判定标准：

1. **跨页面共享**：`LogsPage` / `SessionIndexPage` / `session` 页都需要读
2. **跨组件共享**：多个组件订阅同一份数据（如 `agents` 在 `StatusBar` 和 `AgentTabs` 都用）
3. **会话级持久**：会话期间需要持续（重启 TUI 重置）
4. **影响渲染分支**：决定 page 路由、组件渲染条件

**局部状态（放 `useState`）** 的判定：

1. 仅当前组件用
2. 短暂交互态（如 hover、focus highlight、scroll position）
3. 派生状态（可由 props + state 算出）

---

## Convention: Global filter field pattern（07-30）

**When**: 需要"全消息 vs 某子集消息"的视角过滤。

**Source**: `viewFilter?: string` 在 `src/tui/context/AppContext.tsx:89`（07-30-agent-tabs-topbar）

**Pattern**:
```typescript
interface AppState {
  viewFilter?: string;  // agentId, undefined = show all
}

// Setter
const setViewFilter = useCallback((filter: string | undefined) => {
  setState(prev => ({ ...prev, viewFilter: filter }));
}, []);
```

**Rules**:
1. **undefined 表示"全部"**（不要用空字符串、特殊 sentinel）
2. **filter 持久到下次显式修改**（Esc 不取消，见 `focus-management.md` §Esc bidirectional toggle）
3. **Setter helper 必须通过 useCallback 暴露在 context value**，避免 provider 重渲染连带重渲所有消费者
4. **Set 时不联动其他全局状态**（除 UI 提示外）
5. **退出 TUI 会话即重置**（不持久化到磁盘）

**UI 反馈约定**:
- 当 filter 生效时，在 StatusBar 右侧加 `viewing: <name> ▶` 提示（参考 `StatusBar.tsx:60-68`）
- 提示 i18n key: `tui.statusbar.viewing`（zh + en 双语，见 `src/locales/{zh,en}.json`）

**Tests Required**:
- Setter pure function: `selectTabViewFilter(tab): string | undefined`（Main → undefined，sub-agent → agentId）
- id uniqueness: `tabs.map(t => t.id)` 互不相同
- StatusBar hint 显示/隐藏条件: `state.viewFilter && agentName` 时显示

---

## Convention: AppContext value composition

**When**: 给 `<AppContext.Provider value={...}>` 注入 setter。

**Rules**:
1. **每个 setter 必须用 `useCallback` 包装**，依赖数组只引用 dispatch（不引用 state）
2. **Provider value 必须 memo**（用 useMemo 或纯对象稳定引用），否则每次 render 触发所有消费者重渲染
3. **setter 命名**: `setXxx` 与字段名一致（`setState` 保留给通用 dispatch）

**Example（AgentTabs 07-30）**:
```typescript
// App.tsx
const setViewFilter = useCallback((filter: string | undefined) => {
  setState(prev => ({ ...prev, viewFilter: filter }));
}, []);

const contextValue = useMemo(() => ({
  state, setState,
  setCurrentPage, setFocusArea, setInputMode,
  setViewFilter,  // NEW
}), [state, setCurrentPage, setFocusArea, setInputMode, setViewFilter]);
```

---

## Anti-patterns / 反模式

- **Don't**: 把 viewFilter 持久到 `useRuntimeEvents` 的 events 流里 — viewFilter 是 UI 状态，不是 agent 状态
- **Don't**: 用 `setState` 直接改 `state.viewFilter`（绕过 `setViewFilter`） — 失去 useCallback 优化
- **Don't**: 在 useMemo 内构造 context value 但不写依赖数组 — 静默失效
- **Don't**: 把局部状态（如某组件的 `selectedIdx`）放进 AppState — 状态层污染

---

## Convention: runtime-reducers 分域归约

**When**: `processRuntimeEvent`（`src/tui/hooks/useRuntimeEvents.ts`）的 switch 超过 ~10 个 case。

**Source**: `src/tui/hooks/runtime-reducers/`（session / agent / tool / usage 四域 + `types.ts`）。

**Pattern**:
```typescript
// types.ts：可变草稿 + 共享上下文，reducer 只改不组装
type EventDraft = { agents; messages; tools; flow; permission; usage; context };
type ReducerShared = { chunkAccumulator; toolStartTimes; multiAgent };
// 调用方：建草稿（数组浅拷贝 + 快照）→ 按 type 分发 → 统一组装返回
// 事件成员类型用 Extract<RuntimeEvent, { type: '...' }> 收窄，不新增命名导出
```

**Rules**:
1. **reducer 只改 draft，不组装返回**（`usage_update` 的加法、`context_compacted` 的整体替换都写回 draft，等价于原直接 return）。
2. **调用方签名不变**（`processRuntimeEvent(event, sessionSlice, chunkAccumulator, toolStartTimes, multiAgent)`），50ms 批处理循环零改动。
3. **helper 跟着 case 走**（`createMainAgent`→session，`inferAgentDepth`+皮肤候选表→agent），不留跨文件私有引用，不制造循环导入。
4. **搬运零逻辑改动**：字段读写顺序、去重 key、防重复守卫原样保留。

**Tests Required**:
- 现有 TUI 测试全绿即视为行为等价（本轮拆分后 21 文件 423 用例）。
- 新增事件类型时：进对应域文件 + dispatcher 加 case，不得另起 switch。

---

## Future Update Checklist / 后续补充清单

- [x] local vs global state boundary
- [x] global filter field pattern (07-30)
- [ ] server-state / IPC 模式（暂不适用，单进程 TUI）
- [ ] derived-state patterns（目前用 useMemo 散落）
- [x] AppContext value composition（部分约定）
- [ ] Zustand migration 评估（Work Item D 候选）