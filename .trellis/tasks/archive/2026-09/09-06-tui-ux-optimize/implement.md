# Implement：TUI UX优化（P0+P1）

## 有序清单

- [ ] 0. 拆分 `ChatMessageList.tsx`（纯搬运）：抽 `message-rows.tsx` + `streaming-status.tsx`，行为零改动，先过 `check:fast + test` 相关用例。
- [ ] 1. R1 焦点：`App.tsx` focusCycle + Esc toggle + `AgentTabs` gating；补 `__tests__/focus-cycle.test.ts`（循环顺序/Esc 往返/死键回归）。
- [ ] 2. R2 输入历史/编辑键：`ChatInputBar` 历史栈+Home/End+Ctrl+U/K；纯函数 `historyNav()`；`__tests__/` 覆盖。
- [ ] 3. R3 `/` 补全：`filterCommands/moveCompletionIndex` 纯函数 + 下拉渲染（registry 来源）；`Esc` 关闭；`__tests__/completion.test.ts`。
- [ ] 4. R4 窄屏状态条：`CompactStatusBar`（1 行）+ `ChatArea` 条件渲染；i18n 双 key。
- [ ] 5. R5 Help 快捷键节：`HelpCommandsView` 新增一节（数据来自 keymap 真实绑定），`sectionSeparator/shouldRenderBanner` 复用；i18n 双 key。
- [ ] 6. R7 未读 badge + R10 中止提示：视口编排层加 badge；流式行加 `t()` 中止文案。
- [ ] 7. R8/R9 展开：复用 `Message.collapsed` + `toggleExpanded` 纯函数；思考/工具行可展开。
- [ ] 8. R6 合规扫尾：全量 `grep` 硬编码中文（含 `▶/✓` 外的功能文案走 `t()`）；`wastelandTheme` 无字面量；`locales/en+zh` 对位。
- [ ] 9. 终检：`npm run typecheck && npm run lint && npm run validate:i18n && npm run check:locale-parity && npm run check:contrast && npm test`。

## Validation

```bash
npm run check:fast
npm run validate:i18n && npm run check:locale-parity && npm run check:contrast
npx vitest run src/tui/components/__tests__/focus-cycle.test.ts src/tui/components/__tests__/completion.test.ts
npm test
```

## 风险文件/回滚

- 高风险：`src/tui/App.tsx`（键盘总调度）、`ChatInputBar.tsx`（输入机）、`ChatMessageList.tsx`（拆分）。每个 R 独立 commit；拆分步与功能步分离；`locales` 缺 key 会导致 `t()` 回显 raw key——靠 `check:locale-parity` 拦截。
- `task.py start` 前置：本任务走 sub-agent 派发需先灌 `implement.jsonl/check.jsonl`（见下一步）；inline 流程跳过 jsonl，改走 `trellis-before-dev`。

## Follow-up before start

- 确认 `design.md` 无新增全局状态、无新依赖、无 `HelpView` 扩大。
- 准备 `implement.jsonl/check.jsonl` 条目（frontend focus/component/quality/state/theme-skin + backend command-registry/cli-tui-contracts）。
