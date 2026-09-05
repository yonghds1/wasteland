# feat(core): CommandRegistry 统一命令管理

> 任务 slug: `07-30-07-30-command-registry` · 创建于 2026-07-30
> 范围: 7 文件改造,建立命令系统单一来源
> 设计稿: `.trellis/workspace/yonghds1/notes/2026-07-30-command-registry-plan.md`(11 节完整规划)

## Goal

wasteland 命令系统当前**碎片化在 5 个管理点**(local-commands.ts / readline-input.ts / skill-registry / route-logs-command / help-skill),互不知情:

- `/clear` 和 `/exit` 在两处出现且描述矛盾
- 漏列 `/status` `/init` `/ctx` `/sessions`
- `/sessions` 在 readline-input.ts 的 LOCAL_COMMANDS 漏注册

**本任务**:建立 `CommandRegistry` 单一来源,所有命令相关查询(列表/判断/help 输出/测试)从这处读。

## What I already know

**当前 5 个管理点**:

| # | 文件 | 范围 |
|---|------|------|
| A | `src/tui/route-logs-command.ts` | `/logs` 独立分支 |
| B | `src/core/shared/local-commands.ts:45,48,78-111` | `LOCAL_COMMANDS` + `EXIT_COMMANDS` Set + 5 个 if/else handler |
| C | `src/skills/skill-registry.ts` | 5 个 skill 命令(`/help` `/status` `/tools` `/init` `/ctx`) |
| D | `src/ui/readline-input.ts:55,58` | **重复 B 的 LOCAL_COMMANDS**,**漏 `/sessions`** |
| E | `src/skills/skills/help-skill.ts:42-46,136-139` | help 输出硬编码命令列表 |

**SkillRegistry**(`src/skills/skill-registry.ts`):
- `register(skill, source)` 注册,支持别名
- `get(nameOrAlias)` 按名或别名查
- `list(filter?)` 列表
- `isSkillCommand(input)` 检测输入是否为 skill 命令

**wasteland 内置 5 个 skill**(`src/skills/default-skills.ts:22-30`):
- `helpSkill` → `/help` (别名 `/h` `/?`)
- `statusSkill` → `/status` (别名 `/stat`)
- `toolsSkill` → `/tools`
- `initSkill` → `/init`
- `contextSkill` → `/ctx` (别名 `/context`)

**核心抽象**:
- `CommandEntry`: 命令元数据(name/aliases/category/descriptionKey/handlerType)
- `CommandRegistry`: 注册/查询接口
- `bootstrapCommandRegistry`: 从 SkillRegistry 派生 skill 命令(避免双源)
- Handler 池: `executeLocalCommand` 委托给 handler 函数

## Requirements

### R1: 新建 `src/core/shared/command-types.ts`

- `CommandCategory = 'skill' | 'local' | 'session' | 'exit'`
- `CommandHandlerType = 'skill-executor' | 'route-logs-command' | 'execute-local' | 'clear-screen' | 'exit-session' | 'session-list'`
- `CommandEntry` interface(name/aliases/category/descriptionKey/handlerType,全 readonly)
- `HelpEntry` interface(i18n resolved)
- `CommandRegistry` interface(register/registerMany/unregister/isCommand/get/getAll/getByCategory/getByHandlerType/getHelpEntries)

### R2: 新建 `src/core/shared/command-registry.ts`

- `CommandRegistryImpl` class 实现接口
- 内部用 Map<name, CommandEntry> + Map<alias, name> 索引
- `register` 时检查重复(name 和 alias 都检查),throw 明确错误
- `get` 支持 name 和 alias 查找
- `getHelpEntries` 调 `t(descriptionKey)` 解析 i18n
- Singleton:`getCommandRegistry()` / `setCommandRegistry()` / `resetCommandRegistry()`
- `bootstrapCommandRegistry(reg, skillReg)`: 从 SkillRegistry 派生 skill 命令(遍历 `skillReg.list()`,映射到 CommandEntry)

### R3: 新建 `src/core/shared/command-registry-builtin.ts`

- `registerBuiltinCommands(reg)`: 注册 `/clear` `/sessions` `/logs` `/exit` 4 个本地命令
- 不在此处列 skill 命令(由 `bootstrapCommandRegistry` 派生,避免双源)
- 调用方:`getCommandRegistry()` 第一次调用时自动注册内置

### R4: 新建 `src/core/shared/command-handlers.ts`

- `CommandHandlerFn = (params: ExecuteLocalCommandParams) => LocalCommandResult`
- `commandHandlers` 字典,key 是 `CommandHandlerType`:
  - `clear-screen` → `{ handled: true, action: 'clear' }`
  - `exit-session` → `{ handled: true, action: 'exit' }`
  - `session-list` → `{ handled: true, action: 'sessions' }`
  - `execute-local` → 处理 `/help` `/tools` `/skills` 的复杂输出(调 createHelpText/createToolsText/createSkillsText)
  - `skill-executor` → `{ handled: false }`(由 skillExecutor 处理)
  - `route-logs-command` → `{ handled: false }`(由 App.tsx dispatchLogsRoute 处理)
- 把现有 `createHelpText` `createToolsText` `createSkillsText` 从 `local-commands.ts` 提取到这个文件(避免循环依赖)

### R5: 改造 `src/core/shared/local-commands.ts`

**当前**:
- 硬编码 `LOCAL_COMMANDS` Set + `EXIT_COMMANDS` Set
- 5 个 if/else 处理 `/help` `/tools` `/skills` `/clear` `/sessions` `/exit`
- 3 个 text generator 内联

**新**:
- 保留 `LocalCommandResult` `ExecuteLocalCommandParams` 类型
- 删 Set 定义
- `executeLocalCommand` 简化为:从 registry 查 entry → 委托给 `commandHandlers[entry.handlerType]`
- `isLocalCommand` / `isExitCommand` 改为:从 registry 查 entry,根据 category 判断
- 文件行数从 ~200 行降到 ~80 行

### R6: 改造 `src/ui/readline-input.ts`

- 删除第 55 行 `const EXIT_COMMANDS = new Set(['/exit', '/quit']);`
- 删除第 58 行 `const LOCAL_COMMANDS = new Set(['/help', '/tools', '/clear', '/skills']);`
- 改用从 `@core/shared/local-commands.js` import 的 `isExitCommand` / `isLocalCommand`
- 修复 `/sessions` 漏注册的 bug(自动通过 registry 修复)

### R7: 改造 `src/skills/skills/help-skill.ts`

- 删除第 38-54 行 `sessionCommands` 段硬编码
- 删除第 131-143 行 `localCommands` 段硬编码
- 改为从 `getCommandRegistry()` 读命令列表:
  ```ts
  const reg = getCommandRegistry();
  for (const cat of ['skill', 'session', 'local', 'exit'] as const) {
    lines.push(`### ${t(`skills.help.categories.${cat}`)}`);
    for (const entry of reg.getByCategory(cat)) {
      const aliases = entry.aliases.length > 0
        ? `, ${entry.aliases.map(a => `\`${a}\``).join(', ')}`
        : '';
      lines.push(`- \`${entry.name}\`${aliases} - ${t(entry.descriptionKey)}`);
    }
    lines.push('');
  }
  ```
- 保留 commands/tools/skills 段的硬编码(因为这些段有动态内容)
- i18n 调整: 加 `skills.help.categories.{skill,local,session,exit}` 键

### R8: 改造 `src/tui/App.tsx`

- `dispatchLogsRoute` 内的 `isLogsRootCommand(cmd)` 调用改为:`getCommandRegistry().get(cmd)?.handlerType === 'route-logs-command'`
- 保留 `route-logs-command.ts` 的所有业务逻辑(只是入口判断换)

### R9: 改造 `src/tui/hooks/useRuntime.ts` (或 `src/core/runtime/initialize-runtime.ts`)

- 启动时调用 `bootstrapCommandRegistry(cmdReg, skillReg)` 把 skill 命令派生注入
- 注意 i18n init 顺序:`initI18n` 必须在 `bootstrapCommandRegistry` 之前(否则 helpEntries 解析失败)
- 实际位置:看 `useRuntime.ts:43` 启动流程,i18n 已经在第 57 行 init,bootstrap 放第 88 行 runAgentLoop 之前即可

### R10: 单元测试

**新文件**:`src/core/shared/command-registry.test.ts`

覆盖:
- register / registerMany / unregister 行为
- 重复 name/alias throw
- name 必须以 / 开头
- get by name / alias
- isCommand 边界(去 / / lowercase)
- getByCategory / getByHandlerType 过滤
- getHelpEntries 解析 i18n
- singleton 注入(setCommandRegistry / resetCommandRegistry)
- bootstrapCommandRegistry 从 SkillRegistry 派生

**改造测试**:
- `src/core/shared/local-commands.test.ts`(如果存在):改为测 registry-driven 行为
- `src/skills/skills/__tests__/help-skill.test.ts`:更新断言,验证从 registry 读

## Acceptance Criteria

- [ ] **AC1**: 5 个管理点收敛为 1 个(`getCommandRegistry()`),其他位置不再有 `LOCAL_COMMANDS` Set 硬编码
- [ ] **AC2**: `/help` 输出 `/status` `/init` `/ctx` `/sessions`(原本漏列)
- [ ] **AC3**: `/clear` `/exit` 在 help 中只出现 1 次(原 2 次)
- [ ] **AC4**: `/sessions` 在 readline-input.ts 不再漏注册(自动通过 registry 修复)
- [ ] **AC5**: 新增一个 skill(测试中动态注册)→ `/help` 自动包含,无需改 help-skill.ts
- [ ] **AC6**: `getCommandRegistry()` singleton 模式,测试可 `setCommandRegistry` 注入
- [ ] **AC7**: `bootstrapCommandRegistry(reg, skillReg)` 从 SkillRegistry 派生 skill 命令,无重复
- [ ] **AC8**: 行为不变(所有现有命令仍正常工作,包括 `/clear` `/exit` `/sessions` `/logs`)
- [ ] **AC9**: 三闸门全绿(typecheck / lint / test),无 regression
- [ ] **AC10**: 单元测试覆盖 registry 核心 API + 集成测试覆盖 bootstrap
- [ ] **AC11**: `local-commands.ts` 行数从 ~200 降到 ~80

## Definition of Done

- 7 个文件改造按实施切片顺序 commit(每步独立 commit,便于回滚)
- 单元 + 集成测试通过
- typecheck / lint / test 三闸门全绿
- working tree 由主 session 整理后 commit + push
- trellis-check 通过(trellis-implement 子 agent 内置)
- trellis task archive

## Out of Scope

- 不重构 `SkillRegistry`(已经相对统一)
- 不重写 `route-logs-command.ts`(业务逻辑保留)
- 不引入 DI 框架(用 Service Locator 够用)
- 不改 `i18n` 目录结构(只加少量键)
- 不修文案(后续 PR 处理,本任务只解决结构/逻辑问题)

## Technical Notes

### Singleton + DI 注入

```ts
// src/core/shared/command-registry.ts
let _instance: CommandRegistry | null = null;

export function getCommandRegistry(): CommandRegistry {
  if (!_instance) {
    _instance = new CommandRegistryImpl();
    registerBuiltinCommands(_instance);
  }
  return _instance;
}

export function setCommandRegistry(reg: CommandRegistry): void { _instance = reg; }
export function resetCommandRegistry(): void { _instance = null; }
```

测试用法:
```ts
beforeEach(() => {
  resetCommandRegistry();
  setCommandRegistry(new CommandRegistryImpl());  // 隔离每个测试
});
```

### i18n 依赖

`getHelpEntries` 调 `t(descriptionKey)`,依赖 i18n 已 init。`bootstrapCommandRegistry` 必须在 i18n init 之后调用。

### 实施切片(7 步)

```
Step 1: command-types.ts
Step 2: command-registry.ts (impl + singleton + bootstrap)
Step 3: command-registry-builtin.ts
Step 4: command-handlers.ts (含 createHelpText/createToolsText/createSkillsText 提取)
Step 5: local-commands.ts (用 registry,删 Set + if 链)
Step 6: readline-input.ts (删重复 Set)
Step 7: help-skill.ts (从 registry 读)
Step 8: App.tsx dispatchLogsRoute (用 registry 判断)
Step 9: useRuntime.ts (加 bootstrapCommandRegistry)
Step 10: 测试 + commit + push
```

## Risks & Mitigations

1. **Singleton 测试污染** — `setCommandRegistry` / `resetCommandRegistry` 提供注入
2. **i18n 未 init** — bootstrap 必须在 i18n init 之后
3. **skill 运行时注册** — `bootstrapCommandRegistry` 可重入
4. **改造面大(7 文件)** — 分步 commit,每步可独立 revert
5. **/logs close 等子命令** — registry 只注册 `/logs` 主命令,子命令由 route-logs-command.ts 处理