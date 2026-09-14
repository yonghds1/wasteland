# chore(test): 同级外露测试归拢到 __tests__/（29 个文件）

## 背景

CLAUDE.md 铁律 1：「测试文件：使用 Vitest，必须放置在与被测试文件同级的 `__tests__/` 目录中（严禁在同级混杂外露的 `.test.ts`）。」

实测现状：`src/` 下 **81 个已合规**（在 `__tests__/`）、**29 个外露**。即规则是主流，29 个是历史漂移。顶层 `test/` 目录已不存在。

外露的 29 个：

```
src/commands/chat.test.ts
src/config/config-writer.test.ts
src/config/parallel-config.test.ts
src/config/resolve-chat-runtime.test.ts
src/core/engine/agent-loop-parallel.test.ts
src/core/engine/parallel-spawn-agent.test.ts
src/core/output-adapter.test.ts
src/core/shared/initialize-runtime.test.ts
src/providers/sse-parser.test.ts
src/skills/skill-parser.test.ts
src/skills/skill-registry.test.ts
src/tools/agent/code-assistant-adapter.test.ts
src/tools/agent/spawn-agent/context-builder.test.ts
src/tools/agent/spawn-agent/sidecar.test.ts
src/tools/mcp/mcp-resources.test.ts
src/tools/mcp/mcp-transport.test.ts
src/tools/utils/lru-cache.test.ts
src/tools/web/html-to-markdown.test.ts
src/tools/web/web-search-integration.test.ts
src/tui/App.test.ts
src/tui/components/AgentTabs.test.ts
src/tui/components/ChatInputBar.test.tsx
src/tui/components/HelpCommandsView.test.ts
src/tui/components/InspectorPanel.test.tsx
src/tui/hooks/runtime-reducers/tool-reducer.test.ts
src/tui/hooks/useRuntime.test.ts
src/tui/InitWizard.test.tsx
src/tui/route-logs-command.test.ts
src/ui/cli-input-adapter.test.ts
```

## 已勘察的风险（勿重新推导）

| 风险 | 结论 |
|---|---|
| 迁移后与既有 `__tests__/` 同名冲突 | **无**（逐一比对过） |
| 快照文件（`__snapshots__` / `.snap`） | **无** |
| `__dirname` / `import.meta.url` / `readFileSync` 等路径敏感用法 | **无** |
| **数据型相对路径字符串**（如断言里的 `'./fixtures/x.json'`） | **无** —— 已确认这 29 个文件里所有相对路径都出现在模块说明符位置，可安全机械改写 |
| `vi.mock` 带相对路径 | **有**，3 个文件：`commands/chat`、`tui/hooks/useRuntime`、`core/shared/initialize-runtime` |
| 动态 `import()` 带相对路径 | **有**，2 个文件：`core/shared/initialize-runtime`、`tools/agent/spawn-agent/sidecar` |
| tsconfig / vitest / eslint 引用具体测试路径 | **无**（`vitest.config.ts` 的 include 为 `src/**/*.test.ts(x)`，两种位置都覆盖；`lint` 为 `eslint src/`，与位置无关） |

## Requirements

### T-1 迁移
把 29 个文件移入**同级** `__tests__/`（`src/tui/components/ChatInputBar.test.tsx` → `src/tui/components/__tests__/ChatInputBar.test.tsx`）。

### T-2 同步改写相对说明符
目录深一层 ⇒ 所有相对说明符前插 `../`：
- `from './x.js'` → `from '../x.js'`
- `from '../a/b.js'` → `from '../../a/b.js'`
- `vi.mock('./x.js')` / `vi.mock('../a/b.js')` **同样**（`vi.mock` 按测试文件位置解析）
- 动态 `import('./x.js')` / `import('../a/b.js')` **同样**
- 别名导入（`@core/...`、`@tools/...`、`@locales/...` 等）**不动**

**只改模块说明符位置**，不得碰到字符串字面量数据。

### T-3 行为等价
迁移是纯结构调整：**不新增/不删除任何用例**，迁移前后 `npm test` 的通过数必须一致，`typecheck` / `lint` 结论一致。

## Acceptance Criteria

- [ ] `find src -name '*.test.ts*' | grep -v '/__tests__/'` 为空（外露数 = 0）。
- [ ] `npm test` 通过数与迁移前**完全相同**（迁移前为 1524 passed | 3 skipped）。
- [ ] `npm run typecheck` 干净；`npm run lint` 结论与迁移前一致（仅 `sidecar.test.ts:73` 那个既有 error，位置随文件移动）。
- [ ] 迁移前后**用例名集合**比对一致（可用 vitest 的 reporter 输出 diff 验证）。
- [ ] 迁移纯机械：`git diff --stat` 中这 29 个文件的改动仅含路径移动与说明符改写。

## Non-goals

- 不修任何测试逻辑 / 不新增用例 / 不改测试内容。
- 不动已在 `__tests__/` 的 81 个文件。
- 不处理 `format:check`（全仓 238 个文件未过 prettier，属独立议题）。
- 不调整 `vitest.config.ts`（现有 include 已同时覆盖两种位置）。

## 风险

- 机械改写脚本若误伤字符串字面量会静默改坏断言 ⇒ 已勘察确认无数据型相对路径，且迁移后用「用例名集合比对 + 通过数比对」双重验证。
- 若某个测试依赖自身所在目录的相对位置（本勘察未发现），迁移后会被测试失败暴露而非静默通过。
