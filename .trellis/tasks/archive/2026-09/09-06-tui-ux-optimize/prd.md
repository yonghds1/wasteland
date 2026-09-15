# TUI UX优化

## Goal

修复 TUI 唯一主界面的核心 UX 断点（焦点死键、输入效率、窄屏信息丢失、Help 缺失、新消息/思考/工具可读性），同时保持 `.trellis/spec` 合规与五闸门全绿，让 80 列默认终端可用、新手可发现关键操作。范围：P0+P1 一次做（用户 2026-09-06 决策）。

## Background（已确认事实）

- TUI 为唯一主入口（`src/cli.ts:106` 无参默认 `tui`）；CLI `chat` 仅 fallback。
- `src/tui/App.tsx:749` session focusCycle 现为 `['inputBar']` 单元，与 `frontend/focus-management.md §3` 要求的 `['inputBar','agentTabs']` 二元+Esc 双向 toggle 漂移，`Tab` 按下无响应。
- `src/tui/components/` 缺 `HelpShortcutsView.tsx`；但 `src/tui/context/AppContext.tsx:32` 注释明确“`?` 快捷键已移除”，`HelpView='commands'|null`。与 `frontend/focus-management.md`（`HelpView='shortcuts'|'commands'`）存在 spec-code 不一致。本任务不静默恢复 `?` 独立 dialog，改在 `HelpCommandsView` 内新增快捷键一节（低风险合规路径）；恢复 `?` 留待 spec 更新任务。
- `ChatArea.tsx:70-74` Inspector 仅 `>=100` 列挂载，80 列默认终端看不到 mode/tokens/tools。
- `ChatInputBar.tsx` 为自研单行模拟器，无历史召回/Home/End/词跳；`/` 仅变色无补全。
- `ChatMessageList.tsx` 513 行已超 `CLAUDE.md` 500 行铁律，P1 必须先拆分。
- 硬编码中文散落 `App.tsx:263-300`、`ChatMessageList.tsx:250,318`，违反 `theme-skin.md` i18n 外置要求。

## Requirements

### P0

- R1（焦点）：恢复 `session: ['inputBar','agentTabs']` 二元 Tab 循环 + Esc 双向 toggle + `AgentTabs` useInput gating（`←/→/Enter/Esc`），死键消除。遵循 `focus-management.md §3-4`。
- R2（输入）：`ChatInputBar` 增加历史召回（`↑`）、`Home/End`、`Ctrl+U/K` 清行；空输入 hint 常驻关键操作。`↑/↓` 在 permission pending 时仍优先权限选择（现有行为保留）。
- R3（命令发现）：`/` 前缀过滤补全，下拉来自 `getCommandRegistry()/getCommandManager()` 单一来源（`backend/command-registry.md §11` 禁硬编码），`↑↓+Tab/Enter` 选中，`Esc` 关闭补全；纯函数抽取+单测。
- R4（窄屏）：`<100` 列时 `Inspector` 沉底信息降级为 InputBar 上方 1 行状态条（mode/tokens/tools），仍守 1 行+`borderBottom` 约束，不用 `backgroundColor` 微调（`theme-skin.md §3.1`）。
- R5（Help）：在 `HelpCommandsView` 内新增“快捷键”一节（`Ctrl+O/Ctrl+C/Alt+数字/Shift+Tab/T/q/PageUp` 等真实键位以 `keymap-registry` 为准），复用 `SECTION_PREFIX/BULLET/sectionSeparator/shouldRenderBanner`；不扩大 `HelpView` 联合类型。
- R6（合规）：所有新文案 `zh+en` 双 key；无十六进制字面量，复用 `wastelandTheme.colors` + `resolvePalette`；无新 npm 依赖；新单测放 `__tests__/`；五闸门全绿。

### P1（本次并入）

- R7（新消息）：钉底关闭时（`stickToBottom=false`）有新行追加，显示 `▼ N行新消息，按End回到底部` badge，按 `End/PageDown` 回底消除；计数为纯函数。
- R8（思考）：思考折叠行可展开/收起（`Ctrl+T` 或选中行 `Enter` 二选一，设计阶段定），展开态复用 dim+italic 样式，不新增颜色。
- R9（工具）：工具单行可展开显示 args/output 摘要（默认仍单行，前缀 `⏺` 保留），展开态多行 wrap，不挤占 Inspector 逻辑。
- R10（中止）：流式/thinking 指示器右侧常驻 `(Ctrl+C 停止)` 文案（i18n），与 `App.tsx:681-687` 现有中止逻辑对应，不新增按键。

## Acceptance Criteria

- [ ] AC1：80 列终端按 `Tab` 可在 inputBar↔agentTabs 间循环，`Esc` 来回切换，`Tab` 不再无响应。
- [ ] AC2：`/help` 内可见快捷键一节，列出真实键位；`Esc` 关闭。
- [ ] AC3：输入 `/` 后出现过滤列表，`Tab/Enter` 可补全 registry 中的真实命令，非硬编码；`Esc` 关闭补全不误发。
- [ ] AC4：80 列下仍可见 mode/tokens/tools 一行摘要；`≥100` 列 Inspector 行为不变。
- [ ] AC5：未钉底时新消息出现 badge 且计数正确；回底后消除。
- [ ] AC6：思考折叠行可展开/收起；工具行可展开看摘要。
- [ ] AC7：流式中可见中止提示；`Ctrl+C` 仍优先中止而非退出（现有语义不变）。
- [ ] AC8：`npm run typecheck && npm run lint && npm run validate:i18n && npm run check:locale-parity && npm run check:contrast && npm test` 全绿（本任务改动文件相关新问题为零）；无新增硬编码中文；无新依赖。

## Out of Scope

- Markdown 全量渲染（仅保留现状，不引库）、InitWizard 进度条/删改、每行时间戳开关、空态示例行动点、浅色主题、`?` 独立 dialog 恢复——留待后续子任务。`?` 恢复需走 `trellis-update-spec` 更新 `focus-management.md` 后再做。

## Open Questions

- 无阻塞问题。范围已由用户决策为 P0+P1。

## 收口记录（2026-09-15）

TUI UX 项已落地：Help 页 src/tui/components/HelpCommandsView.tsx 在位，输入历史、斜杠补全、ctx 显示、窄屏可读性均已实现。
