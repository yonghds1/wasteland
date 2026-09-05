# feat(tui): /help 命令走 dialog 模式(与 ? 统一)

> 任务 slug: `07-30-07-30-help-dialog-mode` · 创建于 2026-07-30
> 范围: 5-6 文件改造,把 `/help` 从 system message 改为真 dialog

## Goal

wasteland 当前有两套 help 触发,行为**不一致**:

- `?` 键 → 触发**真 dialog**(`state.showHelp = true`),按 Esc/h 关闭
- `/help` 命令 → 走 skill → 推 system message 到 chat 流,**不是 dialog**,按 Esc 没反应

用户期望两者统一(任何 help 都能 Esc 关闭回到 chat),并希望 help 内部用 wasteland 化视觉装饰。

**本任务**:把 `/help` 也走 dialog 模式,新增 wasteland 视觉装饰。

## What I already know

**当前实现**:

- `App.tsx:301-303`:`?` 键 → `setShowHelp(true)`
- `App.tsx:278-282`:showHelp 为 true 时,h/Esc 关闭
- `App.tsx:26`:`showHelp: false`(boolean)
- `AppContext.tsx`:`showHelp: boolean`
- `core/shared/command-handlers.ts`:`/help` 调 `createHelpText()` 返回 `{ handled: true, output: ..., action: 'help' }`
- `App.tsx:204-207`:`action === 'help'` 当前**不处理**(output 作为 system message 推到 messages)
- `help-skill.ts:35`:`lines.push(`# ${t('skills.help.title')}`)`(`# CLI 帮助` / `Wasteland Manual`)
- `command-handlers.ts:54-65`:`createHelpText` / `createToolsText` / `createSkillsText` 文本生成器

**i18n 已 wasteland 化**(07-30 commit e139471 + 86ec0d1):
- `skills.help.title: 'Wasteland Manual'` / `'废土操作手册'`
- `skills.help.description: 'All commands for surviving the wasteland, in one place.'`
- `tui.session.messages.chatStartHint: 'In the wasteland, type to begin, /help for commands'`

## Requirements

### R1: `AppContext.showHelp` 改为 string union

```ts
// src/tui/context/AppContext.tsx
export type HelpView = 'shortcuts' | 'commands';

interface AppState {
  // 旧: showHelp: boolean
  // 新: showHelp: HelpView | null
  showHelp: HelpView | null;
}

interface AppContextValue {
  // 旧: setShowHelp: (show: boolean) => void
  // 新: setShowHelp: (view: HelpView | null) => void
  setShowHelp: (view: HelpView | null) => void;
}
```

### R2: `/help` 命令返回 `action: 'help'`(不再返回 output)

```ts
// src/core/shared/command-handlers.ts
// 旧: 'execute-local' handler 返回 { handled: true, output: createHelpText(), action: 'help' }
// 新: '/help' 命令单独 handler,只返回 action(不再拼 output)
'help-dialog': (params) => {
  // 标记需要打开 dialog(由 App.tsx 拦截)
  return { handled: true, action: 'help' };
},
```

`createHelpText()` / `createToolsText()` / `createSkillsText()` **保留**(HelpCommandsView 组件会用到)。

### R3: 新增 `HelpCommandsView` 组件

**位置**:`src/tui/components/HelpCommandsView.tsx`

**职责**:
- 显示 wasteland 化的 help dialog(4 段:commands / tools / skills / localCommands)
- 使用 `skills.help.title` / `skills.help.description` 等已 wasteland 化的 i18n
- 加视觉装饰(见 R4)
- Esc 关闭(由 App.tsx 处理)

**结构**:
```tsx
export function HelpCommandsView() {
  // 1. 顶部 banner
  // 2. description
  // 3. 4 段(commands / tools / skills / localCommands)
  //    每段: ▎ 标题 + 列表项用 ▸ 替代 -
  // 4. 段间分隔线
  // 5. 底部元数据(Session ID / Workdir)
}
```

**复用**:
- `createHelpText` 拆出 4 段 helper,分别返回 commands/tools/skills/localCommands 段内容
- `createToolsText` 同上(readOnlyTools / writeTools / executeTools 3 子段)
- `createSkillsText` 同上(skills 列表)
- `createLocalCommandsText` 同上(localCommands 列表)

**改动**:`command-handlers.ts` 拆 4 个 text generator,导出可被 HelpCommandsView 用。

### R4: wasteland 视觉装饰

**顶部 banner**:
```
╔════════════════════════════════════════╗
║         ⛓  WASTELAND  MANUAL  ⛓          ║
╚════════════════════════════════════════╝
```
用 Ink `Box` 字符画,`borderStyle: 'double'`,wastelandTheme.primary 着色。

**段标题前缀**:`▎ `(`▎` + 空格 + 段标题)

**列表项符号**:`▸ `(`▸` + 空格)替代 `- `

**段间分隔线**:`─────────────────────────`(40 字符,wastelandTheme.borderDim 着色)

**底部元数据**:`Session: xxx  Workdir: /home/...` 紧凑横排

**关键约束**:
- 终端宽 < 100 时 banner 自动降级为简洁标题(无 box)
- 段间分隔线 长度 = 终端宽 - 4

### R5: `?` 键和 `/help` 都用 `setShowHelp('shortcuts'|'commands')`

```ts
// src/tui/App.tsx
// 旧: if (input === '?' && !state.inputMode) setShowHelp(true)
// 新:
if (input === '?' && !state.inputMode) {
  setShowHelp('shortcuts');
  return;
}

// sendMessage 流程新增
// 旧: action === 'help' → 不处理
// 新: action === 'help' → setShowHelp('commands')
if (result.action === 'help') {
  setShowHelp('commands');
  return;  // 不再推 system message
}
```

### R6: Esc 统一关闭

```ts
// src/tui/App.tsx
// 旧: if (state.showHelp) { if (input === 'h' || key.escape) setShowHelp(false); return; }
// 新:
if (state.showHelp !== null) {
  if (input === 'h' || key.escape) {
    setShowHelp(null);
  }
  return;
}
```

### R7: ChatInputBar 检查更新

```ts
// src/tui/components/ChatInputBar.tsx
// 现有: if (!state.inputMode && !state.showHelp && !state.exitConfirmPending)
// 仍正确(showHelp !== null 在 truthy 判断下也工作)
```

### R8: ChatArea 渲染

```tsx
// src/tui/components/ChatArea.tsx
{state.showHelp === 'shortcuts' ? (
  <HelpShortcutsView />
) : state.showHelp === 'commands' ? (
  <HelpCommandsView />
) : isSessionsPage ? (
  <SessionIndexPage ... />
) : (
  <ChatMessageList ... />
)}
```

**HelpShortcutsView** 是现有 dialog 组件(可能存在,需 grep 确认)。

## Acceptance Criteria

- [ ] **AC1**: `/help` 命令**不再产生 system message** 在 chat 流
- [ ] **AC2**: `/help` 触发 dialog(`state.showHelp === 'commands'`)
- [ ] **AC3**: `?` 键触发 shortcuts dialog(`state.showHelp === 'shortcuts'`)
- [ ] **AC4**: Esc 在两个 dialog 都关闭
- [ ] **AC5**: `h` 键在两个 dialog 都关闭(保留现有行为)
- [ ] **AC6**: 4 段内容(commands / tools / skills / localCommands)在 HelpCommandsView 中显示
- [ ] **AC7**: 视觉装饰:▎ 段前缀 + ▸ 列表符 + 段间分隔线 + 顶部 banner
- [ ] **AC8**: wasteland 化文案继承(用 `Wasteland Manual` / `废土操作手册` / `在 wasteland 中`)
- [ ] **AC9**: 终端宽 < 100 时 banner 降级为简洁标题
- [ ] **AC10**: 三闸门全绿(typecheck/lint/test)
- [ ] **AC11**: ChatInputBar / SessionIndexPage 等不引入回归
- [ ] **AC12**: 单元测试覆盖:help-skill / command-handlers / HelpCommandsView

## Definition of Done

- 5-6 文件改造按实施切片顺序 commit(每步独立 commit)
- 单元 + 集成测试通过
- typecheck / lint / test 三闸门全绿
- working tree 由主 session 整理后 commit + push
- trellis-check 通过
- trellis task archive

## Out of Scope

- 不改 `createHelpText()` / `createToolsText()` / `createSkillsText()` 文本内容
- 不改 `?` 键触发的 dialog 视觉(只统一 state 类型)
- 不实现 `/tools` / `/skills` 命令的 dialog 模式(只 `/help` 走 dialog)
- 不改 `ExitConfirm` 对话框(独立)
- 不改 SessionIndexPage
- 不重构 useRuntimeEvents / agent-loop

## Technical Notes

### HelpView 类型

```ts
// src/tui/context/AppContext.tsx
export type HelpView = 'shortcuts' | 'commands';

// 替代 boolean
interface AppState {
  showHelp: HelpView | null;  // null = 无 dialog,'shortcuts' / 'commands' = 打开对应 dialog
}
```

### command-handlers.ts 改造

```ts
// 旧:
'execute-local': (params) => {
  if (cmd === '/help') return { handled: true, output: createHelpText(), action: 'help' };
  // ...
}

// 新: '/help' 单独 handler,不返回 output
'help-dialog': () => ({ handled: true, action: 'help' }),

// 拆 createHelpText 4 段
export function createHelpCommandsSection(): string[] { /* commands 段 */ }
export function createHelpToolsSection(): string[] { /* tools 段(3 子段) */ }
export function createHelpSkillsSection(skillsHelp: string): string[] { /* skills 段 */ }
export function createHelpLocalCommandsSection(): string[] { /* localCommands 段 */ }
```

### HelpCommandsView 结构

```tsx
export function HelpCommandsView() {
  const { stdout } = useStdout();
  const { state, setShowHelp } = useAppContext();
  const width = stdout?.columns ?? 80;
  
  // 顶部 banner(终端宽 >= 100 才用 box)
  if (width >= 100) {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor={wastelandTheme.colors.primary} paddingX={2}>
        <Text>...</Text>
      </Box>
    );
  }
  // 简洁降级
  return <Box>...</Box>;
}
```

### setShowHelp 类型变更传播

需更新的所有调用点:
- `App.tsx`:`setShowHelp(true)` → `setShowHelp('shortcuts')`;`setShowHelp(false)` → `setShowHelp(null)`
- `ChatInputBar.tsx`:`!state.showHelp` → `state.showHelp === null`(语义不变,但显式)
- `ChatArea.tsx`:新增 dialog 渲染分支

## Risks & Mitigations

1. **类型变更传播**:`showHelp: boolean` 改 `string | null` 影响所有 useState/useContext
   - 缓解:grep `setShowHelp` / `state.showHelp` 全量,逐一更新
2. **HelpShortcutsView 是否存在**:可能 grep 后发现没现成组件,需先简单实现
   - 缓解:用 Ink `<Box>` + `<Text>` 快速搭,1-2 个文件
3. **窄终端渲染**:banner 框字符在窄终端可能溢出
   - 缓解:`width >= 100` 阈值 + 降级方案
4. **help-skill 仍存在但不被使用**:原 `/help` 走 skill 路径产生 system message,新方案不调 skill,skill 仍注册但 `createHelpText()` 等从 command-handlers 拆出独立 helper
   - 缓解:help-skill.ts 文件保留(其他场景可能用),但不从 `/help` 命令触发

## 实施切片(5 步,每步独立 commit)

```
Step 1: AppContext.tsx — showHelp 类型改 string | null
Step 2: command-handlers.ts — /help 改 help-dialog handler,createHelpText 拆 4 段
Step 3: HelpCommandsView.tsx — 新增组件(4 段 + wasteland 装饰)
Step 4: ChatArea.tsx — 渲染 dialog 分支
Step 5: App.tsx — ? 键 / /help / Esc 全部接入
Step 6: 测试 + 三闸门 + commit + push
```
