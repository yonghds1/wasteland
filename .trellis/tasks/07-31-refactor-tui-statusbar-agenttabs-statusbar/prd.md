# refactor(tui): 合并 StatusBar 到 AgentTabs (取消独立 StatusBar 行)

## Goal

完整执行用户选定的"方案 C":

- **删除** `src/tui/components/StatusBar.tsx` 组件。
- **AgentTabs 承担** StatusBar 的全部职责:
  1. Main tab 显示皮肤标签后缀:`[Main | <skinLabel> ●]`
  2. 整条 strip 右侧(`flexGrow=1`,`justifyContent=flex-end`)显示 thinking/streaming prose
- **ChatArea** 不再 render `<StatusBar />`,直接 `<AgentTabs />` 在会话顶上。
- **不再有独立的 Title 行**,顶级 height 从 7 行 (StatusBar 4 行 + AgentTabs 4 行) → 4 行 (AgentTabs 1 border + 1 content + 1 status content + 1 border),节省 ~3 行视觉开销。

保留 07-31 全部:
- AgentTabs 聚焦/失焦 `borderStyle='single'` + borderColor 切换
- AgentTabs `paddingX=1`、`flexShrink=0`、computeViewport `reserved=10`
- Locale `parity`、`contrast`、`in/out` 所有质量门

## What I already know

### 用户决策(本轮)

- 选 **方案 C**(完全合并)。
- **Main tab 形态**:`[Main | <skinLabel> ●]` ——"Main" 从 locale key 取(新增 `tui.agentTabs.mainShortLabel = "Main"`)。
- **thinking/streaming prose 位置**:AgentTabs 右侧(flexGrow + justifyContent=flex-end)。

### 当前文件状态

- `src/tui/components/StatusBar.tsx` —— 51 行,显示 `<Text>{skin.labelKey}</Text>` + 右侧 thinking/streaming prose。
- `src/tui/components/AgentTabs.tsx` —— 已有 `useAppContext()` + 380+ 行,纯函数 tab 单元 + useInput + render。无 runtime prop。
- `src/tui/components/ChatArea.tsx:56-59` —— 挂载 `<StatusBar width={columns} runtime={runtime} />` 然后 `<AgentTabs />`。
- `src/locales/en.json` + `zh.json` —— 无 "Main" 标签(只有 `tui.session` 与 `skins.*` 系列)。
- `src/tui/components/AgentTabs.test.ts` —— 39 cases,纯函数单元测试不渲染组件。

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/tui/components/StatusBar.tsx` | **删除整个文件** |
| `src/tui/components/ChatArea.tsx` | 删 `<StatusBar />` 行;`<AgentTabs runtime={runtime} />` 加 prop |
| `src/tui/components/AgentTabs.tsx` | 加 `runtime: TuiRuntimeContext` prop + 内部使用 `useAppContext()` 已有;Main tab 特殊渲染带 `| skinLabel`;加右侧 prose Box;更新 docblock §'## 视觉反馈' |
| `src/locales/en.json` | 加 `tui.agentTabs.mainShortLabel: "Main"` |
| `src/locales/zh.json` | 加 `tui.agentTabs.mainShortLabel: "Main"`(中文也是 "Main",UI 控件级英文短 token) |
| `src/tui/components/AgentTabs.test.ts` | 加新 case:verify getMainTabLabel(`runtime.skin`) 返回 `${t(skin.labelKey)}`;verify buildViewportAndLabel / view in right side |
| `.trellis/spec/frontend/theme-skin.md` | §3 Contracts 加 `tui.agentTabs.mainShortLabel` locale 记录(若 spec 模块 i18n)或删 StatusBar 历史段 |
| `.trellis/spec/frontend/component-guidelines.md` | Top-bar Auxiliary 段:删 "StatusBar / AgentTabs 双组件" 描述,改 "AgentTabs 单组件含 skin label + status prose + agent 树导航 三合一" |

## Requirements

- **R1 删除**:`StatusBar.tsx` 不再存在,`grep -r StatusBar src/` 只剩 `ChatArea.tsx` 没引用(实际上一并清理)。
- **R2 AgentTabs Main tab 形态**:`[Main | <skinLabel> ●]`,Main 与 '|' 是 locale `mainShortLabel`(`"Main"`) 与字面 `|`。
- **R3 AgentTabs 右侧 prose**:`flexGrow=1` Box 内,先 thinking prose(`tRandom(skin.thinkingKey)` 仅 thinking 时)再 streaming 文本(`tui.session.messages.streaming` 仅 streaming 时),在 `borderBottomColor` 上方一并显示。
- **R4 AgentTabs 接受 runtime 传 prop**:`AgentTabsProps { runtime: TuiRuntimeContext }`,从 runtime.skin 取 labelKey + thinkingKey。
- **R5 ChatArea 注入 runtime 到 AgentTabs**:`<AgentTabs runtime={runtime} />`。
- **R6 locale parity**:`en` 与 `zh` 两 json 都加 `tui.agentTabs.mainShortLabel`("Main"),`npm run check:locale-parity` 通过。
- **R7 视觉一致性**:合并后顶部只有 AgentTabs 一行(border + content + status + border 合计 4 行)。原先 StatusBar 4 行 + AgentTabs 4 行 = 8 行 → 现在 4 行,节省 4 行。
- **R8 07-31 修复保留**:AgentTabs 聚焦/失焦 borderStyle='single' + borderColor 切换 + paddingY + reserved=10 全部保留。
- **R9 tests**:AgentTabs.test.ts 现有 39 cases 仍 pass;加至少 2 个新 case:
  - 提取 pure function `getMainTabLabel(skin)`,验证返回 `t(skin.labelKey)`
  - 提取 pure function `getRightSideProse({thinking, streaming, skin})`,验证输出含 thinking 或 streaming

## Acceptance Criteria

- [ ] `src/tui/components/StatusBar.tsx` 不存在(git rm)。
- [ ] `src/tui/components/ChatArea.tsx` 无 `<StatusBar` 引用;`<AgentTabs runtime={runtime} />`。
- [ ] Main tab 渲染 `[Main | <skinLabel> ●]`(可通过 `getMainTabLabel(skin)` 单元测试保证)。
- [ ] AgentTabs 右侧 prose Box 在 thinking 或 streaming 时显示对应文字。
- [ ] `npm run check:locale-parity` 通过(添加了 en + zh 两个 key,内容一致)。
- [ ] `npm run check:contrast` 通过(13 skins)。
- [ ] typecheck/lint 通过。
- [ ] AgentTabs.test.ts 现 39 cases + 新加 cases 全部 pass。
- [ ] 全量 test baseline 与 bfd2882 后一致(忽略 3 预存在 logs.test.ts 失败)。
- [ ] terminal 实测(在 `tsx src/cli.ts tui`):可见 1 行顶部条 + 下方 ChatMessageList;Main tab 文本包含 "[Main | 不死老乔 ●]" 形态(skin=immortan-joe 时)。

## Definition of Done

- 一次(或紧凑两段)commit:删除 StatusBar + ChatArea 改 + AgentTabs 加 prose + locale 加 key + spec 调整。
- 完成后仓库顶层 UI 简洁度净提升(顶部 4 行而非 8 行)。

## Out of Scope

- 不改动 AgentTabs 既有 380+ 行逻辑(纯函数、useInput、buildTabs、computeViewport、selectTabViewFilter、getPersistentHighlightId)。
- 不改 ChatMessageList、ChatInputBar、Help dialog、Logs 等其它组件。
- 不重写 `getMainTabLabel` / `getRightSideProse` 的多 locale i18n(本期 zh/en 都是 "Main",不引入其它 locale)。
- 不动 `wastelandTheme.colors.*` 全部 token。

## Technical Notes

### Pure function 提取(为可测)

```ts
// 新增于 src/tui/components/AgentTabs.tsx
export function getMainTabLabel(skin: SkinUi): string {
  // 渲染: '${t(mainShortLabel)} | ${t(skin.labelKey)}'
  // 实现: locale-friendly concat
  return `${t('tui.agentTabs.mainShortLabel')} | ${t(skin.labelKey)}`;
}

export function getRightSideProse(
  state: { isThinking: boolean; isStreaming: boolean },
  skin: SkinUi
): { text: string; color: 'warning' | 'success' | null }[] {
  const out = [];
  if (state.isThinking) {
    out.push({ text: tRandom(skin.thinkingKey), color: 'warning' });
  }
  if (state.isStreaming) {
    out.push({ text: t('tui.session.messages.streaming'), color: 'success' });
  }
  return out;
}
```

### AgentTabs render 结构变化

```tsx
// 当前:
<Box row ...>
  {showLeft && ◀}
  {visibleTabs.map(...)}
  {showRight && ▶}
</Box>

// 合并后:
<Box row ...>
  {showLeft && ◀}
  {visibleTabs.map(tab => 
    isMain ? <Text>[Main | <skinLabel> <icon>]</Text> : <Text>[<agent.name> <icon>]</Text>
  )}
  {showRight && ▶}
  <Box flexGrow={1} justifyContent='flex-end'>
    {thinking prose}
    {streaming text}
  </Box>
</Box>
```

注意:`flexGrow=1` Box 出现在 tabs 渲染后,Ink 会把它推向右边。Tabs 先固定宽度,Box 拿走剩余空间。

### Locale 加 key 形态

```json
// en.json + zh.json
"tui": {
  ...,
  "agentTabs": {
    "mainShortLabel": "Main"   // zh.json 同样 "Main"
  },
  ...existing keys...
}
```

### Ink flex layout 兼容性

`flexGrow` 在 Ink 中按文档正常工作,但需要 children 父级 `flexDirection="row"`(已满足)。`justifyContent='flex-end'` 推内部 Text 到右端。

### 风险

- 加 prose + flexGrow 后 AgentTabs 顶行宽度可能超 `terminalWidth`,在窄终端(80 列以下 + 多个 sub-agent)时 prose 会截断。Ink 默认行为:text overflow 由终端处理(可能 wrap 或 字符换行),按现状(未加 flexWrap)依然 OK。
- StatusBar 删除后,老的 `tsc --noEmit` 验证整体 UI 类型还能 pass(`runtime` 类型在 ChatArea 与 AgentTabs 间通)。
- locale parity 在 cn/en 一致("Main" + "Main")所以 100% pass。
