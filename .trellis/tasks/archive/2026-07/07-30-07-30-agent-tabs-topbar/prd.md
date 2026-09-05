# feat(tui): 顶部 AgentTabs 单阶段组件 + 简化焦点模型

> 任务 slug: `07-30-07-30-agent-tabs-topbar` · 创建于 2026-07-30
> 范围: TUI 子 agent 展示与切换(单组件 + 6 文件局部改动)
> 设计稿: `.trellis/workspace/yonghds1/notes/2026-07-30-tui-subagent-plan.md` (v4)

## Goal

wasteland 当前 TUI 对子 agent 的展示**仅是紧凑 ⏺ 单行**(混在主消息流),用户无法快速切换"只看某个 sub-agent"的视角,多 agent 并发时无法一眼看全状态。

本任务:
- 在 TUI 顶部 StatusBar 之下新增 `AgentTabs` 组件(默认 1 行,可横向滚动)
- 单阶段交互:`←/→` 切 ▶、`Enter` 选中(filter 生效)、`Esc` 回 inputBar
- Main 永远 tab 第一项(代表 filter 取消)
- 简化焦点模型:`Tab cycle = ['inputBar', 'agentTabs']`(移除 messageList 死状态)
- 引入 `viewFilter` 全局状态,影响 `ChatMessageList` 渲染

## What I already know

**现有状态**(`src/tui/`,已读源码):

- `src/tui/App.tsx:317-345` — 当前 focusCycle 与 Tab 切换实现
- `src/tui/App.tsx:91-93` — setCurrentPage/focusArea 是 useCallback 包装
- `src/tui/components/ChatArea.tsx` — 单视口组装(StatusBar + 主体 + InputBar)
- `src/tui/components/StatusBar.tsx` — 顶部状态,显示 `wasteland · model · N tools · N running agents`
- `src/tui/context/AppContext.tsx:13-21` — `PageName` 5 个,其中 `'debug'`/`'config'` 死类型;`FocusArea` 6 个,其中 `'messageList'` 是死状态
- `src/tui/components/ChatMessageList.tsx` — 消息渲染,目前**不接收 viewFilter**,需要改
- `src/tui/components/ChatInputBar.tsx` — 输入框,内部 useInput,本任务**不动**
- `src/tui/hooks/useRuntimeEvents.ts:235-256` — `agent_spawned` push 到 `state.session.agents`,`agent_completed` 标完成
- `state.session.agents: AgentNode[]` — `{id, name, depth, status, startTime, endTime}`
- 主 agent 永远在 `agents` 数组中,`depth: 0`,`status: 'running'`,`name: 'Main Agent'`
- wasteland 架构下**用户不能直接接管 sub-agent 对话**(主 agent 通过 spawn_agent 编排)

**Wasteland 主题与色板**:`src/theme/wasteland/index.ts` 有 `colors.primary`/`secondary`/`success`/`warning`/`muted`/`borderFocused`/`borderDim`/`text`/`backgroundDarker`

## Requirements

### 1. 新增 `src/tui/components/AgentTabs.tsx`(主组件)

- **位置**: 顶部组件,StatusBar 之下
- **布局**: 默认 1 行,`flexShrink={0}`,始终显示
- **Tab 列表**:
  - Main 永远第一项(label: "Main")
  - 后续为 `state.session.agents` 中所有 `depth >= 0` 的 agent
  - 每项: `name + status icon`
- **状态图标**: `● / ✓ / ✗ / ⏱` 对应 `running / completed / failed / timeout`
- **滚动**: 当总 tab 宽度 > 终端宽度 - 8 时,视口跟随 selectedIdx,显示 `◀ / ▶` 溢出指示器
- **视觉反馈**:
  - 选中 tab: `▶` 前缀 + `wastelandTheme.colors.primary` 加粗
  - 未选中 tab: 默认色 + 细体
  - 已 filter 的 tab: 持久加粗(不只依赖 selectedIdx)

### 2. 交互(useInput 内部,focusArea='agentTabs' 时响应)

| 键 | 动作 |
|----|------|
| `←/→` | selectedIdx ± 1;视口自动滚动让 selectedIdx 可见 |
| `Enter` | 设 viewFilter 为当前 selectedIdx 对应 agent.id;Main 时 viewFilter = undefined |
| `Esc` | setFocusArea('inputBar') + setInputMode(true);**不取消 viewFilter** |

### 3. AppContext 改动

`src/tui/context/AppContext.tsx`:

```ts
interface AppState {
  // ... 现有字段 ...
  viewFilter?: string;  // 新增: agentId,undefined = 全部
}
```

### 4. ChatArea 改动

`src/tui/components/ChatArea.tsx`: StatusBar 与消息主体之间插入 `<AgentTabs />`

### 5. ChatMessageList 改动

`src/tui/components/ChatMessageList.tsx`: 接受 viewFilter(从 context 取或 props),`viewFilter` 非空时只渲染 `message.agentId === viewFilter` 的消息

### 6. StatusBar 改动

`src/tui/components/StatusBar.tsx`: 右侧加 `viewing: <agentName> ▶` 提示,viewFilter 非空时显示

### 7. App.tsx 改动(简化焦点模型)

- `focusCycle.session` 改为 `['inputBar', 'agentTabs']`(移除 `'messageList'`)
- Esc 处理改为**双向 toggle**:
  - inputBar → Esc → agentTabs
  - agentTabs → Esc → inputBar
- `setFocusArea`/`setInputMode` 调用与现有 Tab cycle 联动逻辑保持一致(参考 `App.tsx:338-342`)

## Acceptance Criteria

- [ ] **AC1**: AgentTabs 组件存在并默认 1 行显示
- [ ] **AC2**: 单 agent 时 tab 列表只有 `[● Main]` 一项,多 agent 时 Main 永远第一
- [ ] **AC3**: Tab cycle 简化为 `['inputBar', 'agentTabs']`,旧 `'messageList'` 仍保留在类型定义中(以兼容,Work Item E 清理)
- [ ] **AC4**: Esc 双向 toggle:inputBar ↔ agentTabs,filter 不取消
- [ ] **AC5**: `←/→` 切 selectedIdx(仅视觉);视口自动滚动保证 selectedIdx 可见
- [ ] **AC6**: `Enter` 在 agentTabs 时设 viewFilter;Main 选中时 viewFilter = undefined
- [ ] **AC7**: 多 agent 时(>= 5 个),tab 总宽度超过终端宽,正确显示 `◀ / ▶` 溢出指示器,`←/→` 切换时视口跟随
- [ ] **AC8**: ChatMessageList 根据 viewFilter 过滤消息,viewFilter 非空时只显示该 agent 的消息
- [ ] **AC9**: StatusBar 在 viewFilter 非空时右侧显示 `viewing: <name> ▶`
- [ ] **AC10**: AgentTabs 与 ChatInputBar 完全解耦(独立组件,独立 useAppContext 订阅,输入区高度变化不影响 AgentTabs)
- [ ] **AC11**: 单元测试覆盖:
  - tab 列表构建(Main 永远第一 + sub-agents 顺序)
  - 滚动算法(各种 agent 数 + 终端宽度组合)
  - viewFilter 设值(Main 选中 → undefined,sub-agent → agentId)
  - Esc 双向 toggle 焦点
- [ ] **AC12**: 五闸门全绿(typecheck / lint / validate:i18n / check:locale-parity / test),无 regression
- [ ] **AC13**: ChatInputBar.tsx 与 useRuntimeEvents.ts **未被修改**(完全不动)

## Definition of Done

- 单元测试覆盖新增组件 + 状态机
- typecheck/lint/i18n/parity/test 五闸门全绿
- working tree 由主 session 整理后 commit + push
- trellis-check(若可执行)无 critical finding
- trellis task archive

## Out of Scope

- 不重构 `useRuntimeEvents`(不在本次任务范围)
- 不实现 `[All]` tab(Main 直接代表"无 filter")
- 不引入 Zustand(Work Item D 后续)
- 不清理 `'messageList'` / `'debug'` / `'config'` 等死类型(Work Item E 后续)
- 不修改 `LogsPage` / `route-logs-command` / 任何 chat input 相关逻辑
- 不实现 sub-agent "用户接管对话"(wasteland 架构不支持,产品决策)

## Technical Notes

### AgentTabs 内部结构

```tsx
export function AgentTabs(): React.ReactElement {
  const { state, setFocusArea, setInputMode, setViewFilter } = useAppContext();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  
  // tab 列表构建(Main 永远第一)
  const tabs: Tab[] = useMemo(() => {
    return [
      { id: 'main', name: 'Main', status: 'running', isMain: true },
      ...state.session.agents
        .filter(a => a.depth >= 0)
        .map(a => ({ id: a.id, name: a.name, status: a.status, isMain: false })),
    ];
  }, [state.session.agents]);
  
  const [selectedIdx, setSelectedIdx] = useState(0);
  
  // 视口算法
  const { visibleTabs, showLeft, showRight } = useMemo(() => 
    computeViewport(tabs, selectedIdx, terminalWidth),
    [tabs, selectedIdx, terminalWidth]
  );
  
  // useInput(只 focusArea='agentTabs' 时响应)
  useInput((input, key) => {
    if (state.focusArea !== 'agentTabs') return;
    if (key.leftArrow) setSelectedIdx(i => Math.max(0, i - 1));
    if (key.rightArrow) setSelectedIdx(i => Math.min(tabs.length - 1, i + 1));
    if (key.return) {
      const tab = tabs[selectedIdx];
      setViewFilter(tab.isMain ? undefined : tab.id);
    }
    if (key.escape) {
      setFocusArea('inputBar');
      setInputMode(true);
    }
  });
  
  // 渲染
  return (
    <Box flexDirection="row" flexShrink={0} paddingX={1}>
      {showLeft && <Text muted>◀ </Text>}
      {visibleTabs.map((tab, i) => (
        <Text 
          key={tab.id}
          color={tab.id === state.viewFilter ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}
          bold={tab.id === state.viewFilter || i === selectedIdx}
        >
          {i === selectedIdx ? '▶' : ' '} [{tab.name}{tab.status === 'running' ? ' ●' : tab.status === 'completed' ? ' ✓' : tab.status === 'failed' ? ' ✗' : ' ⏱'}]
        </Text>
      ))}
      {showRight && <Text muted> ▶</Text>}
    </Box>
  );
}
```

### AppContext 改动(setViewFilter helper)

```ts
// AppContext.tsx
interface AppContextValue {
  // ... 现有字段 ...
  setViewFilter: (filter: string | undefined) => void;
}

// App.tsx 加 useCallback
const setViewFilter = useCallback((filter: string | undefined) => {
  setState(prev => ({ ...prev, viewFilter: filter }));
}, []);
```

### focusCycle 改动

```ts
// App.tsx
const focusCycle: Record<PageName, FocusArea[]> = {
  session: ['inputBar', 'agentTabs'],  // 之前: ['messageList', 'inputBar']
  // ...
};
```

### Esc 双向 toggle

```ts
// App.tsx useInput 内
if (key.escape) {
  if (state.inputMode) {
    setInputMode(false);
    setFocusArea('agentTabs');
  } else if (state.focusArea === 'agentTabs') {
    setInputMode(true);
    setFocusArea('inputBar');
  }
  return;
}
```

## Risks & Mitigations

1. **窄终端(< 80 列)AgentTabs 显示不下** — 滚动算法处理(AC7),最坏情况显示 1 个 tab + `◀▶`
2. **`focusCycle` 改动影响其他 page** — 当前只有 `session` 用 cycle,其他 page `cycle.length === 0`,改动只影响 session
3. **`viewFilter` 字段兼容性** — 旧字段名 `logPageFilter` 已存在,本任务用新字段 `viewFilter`,无冲突
4. **ChatMessageList 改 viewFilter 可能影响 LogsPage 行为** — ChatMessageList 只在 session 页用,LogsPage 不渲染 ChatMessageList,无影响
5. **Main agent id 命名** — 当前 main 是 `state.session.agents[0]`(depth=0,id 动态),Main tab 用特殊 `id: 'main'` 标识,与 agent.id 区分