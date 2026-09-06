# Design：TUI UX优化（P0+P1）

## 架构与边界

- 只改 TUI 层（`src/tui/components/*`、`src/tui/App.tsx`、`src/locales/*`），不碰 `src/core/runtime` 事件结构与 `ChatInputTurn` 合同（`backend/cli-tui-contracts.md`）。
- 状态归属（`frontend/state-management.md`）：
  - 全局（`AppState`）：`focusArea`、`viewFilter`（`undefined`=全部，`Esc` 不清）、`showHelp`（不扩大联合类型）。
  - 局部（`useState`）：补全 index/visible、历史栈指针、scrollOffset/stickToBottom、思考/工具展开 id 集合。
- 命令单一来源（`backend/command-registry.md`）：补全列表 = `getCommandRegistry().getAll()` + `getCommandManager()` 技能派生，UI 不硬编码命令字符串；`/help` 文案复用 `command-handlers.ts` 四段 helper + 新增快捷键节（数据来自 `keymap-registry` 真实绑定）。

## 数据流与关键决策

- R1 焦点：`App.tsx` focusCycle 改回 `session: ['inputBar','agentTabs']`；`Tab/Shift+Tab` 按现有 `getKeymapRegistry().findAction` 调度后循环；`Esc` 双向 toggle（inputBar↔agentTabs），同步 `inputMode`；`AgentTabs` 内 `useInput` 必须先 `if (state.focusArea!=='agentTabs') return`（`focus-management.md §6`）。
- R3 补全：新增纯函数 `filterCommands(query, entries): CommandEntry[]` + `moveCompletionIndex(dir, len)`，`ChatInputBar` 内 `useInput` 只做 dispatch；`/` 开头才显示；`↑↓` 在补全可见时优先补全导航（与 R2 历史召回冲突时：补全可见→导航补全，补全关闭→历史召回）。
- R4 窄屏：`ChatArea` 在 `!showInspector` 时渲染 `CompactStatusBar`（1 行，`borderBottom borderDim`，无 `backgroundColor`）；内容 `mode · tokens · tools✓✗`，全部 `t()`。
- R7 未读：纯函数 `newLinesCount(prevTotal, curTotal, stickToBottom)`；badge 文案 `t('tui.session.messages.newLines', {count})`。
- R8/R9 展开：`Message.collapsed?` 已存在但未用——复用该字段存思考/工具展开态（`true`=折叠默认），避免新增全局字段；切换函数为纯函数 `toggleExpanded(set: Set<string>, id)`。
- R2 历史：`history: string[] + histIdx` 存本会话已发消息（上限 50）；`↑` 在无补全且单行光标行首时回溯，不污染多行编辑。
- ChatMessageList 拆分（500 行铁律）：抽 `message-rows.tsx`（user/assistant/system/tool 行渲染）+ `streaming-status.tsx`（流式+thinking+subagent 尾部），原文件只留视口/滚动编排。纯函数（wrap/parse/badge 计数）进 `__tests__/` 覆盖。

## 兼容与 trade-off

- 256-color：所有分隔只用边框/前景色，不用深色底（`theme-skin.md §3.1`）。
- 对比度：复用 `primary/muted/success/error/warning`，新增组合跑 `check:contrast`。
- `?` 不恢复：避免与 `AppContext.tsx:32` 既定决策冲突；快捷键进 `/help` 一节即可解决发现性，spec 更新另起任务。
- 不引 markdown 库/状态库（五闸门“新依赖需说明”——本次零新增）。

## 回滚点

- 每个 R 独立 commit 可单独 revert；`locales` 双文件同 PR；`ChatMessageList` 拆分先做纯搬运、零逻辑改动，第二步才加 R7–R9。
