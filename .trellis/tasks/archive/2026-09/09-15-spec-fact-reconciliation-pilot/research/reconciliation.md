# 对账表：`.trellis/spec/backend/quality-guidelines.md`

核验日期 2026-09-15。逐条列出该文件中**对本仓库客观状态的断言**，给出判定与证据。
判定分三类：**属实** / **已过期** / **属规范（不适用）**。

判据（PRD R1）：该句是否在断言"本仓库当前的客观状态"？是 → 纳入核验；否（行为规范）→ 不适用。

---

## A. 文件头（L3）

| 行 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 3 | baseline built around **compiler checks and smoke tests** | 已过期 | `test/` 目录不存在；过程级 smoke test 已无。现为 vitest 直跑 `src/**/__tests__`（112 文件 / 1580 用例） | 改为 compiler checks + lint + locale/contrast gates + vitest |

## B. Observed Baseline（L7–18）

| 行 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 9 | `.trellis/workflow.md` establishes planning-first workflow… | 属实 | `ls .trellis/workflow.md` → 存在 | 保留 |
| 10 | `package.json` defines `build`, `dev`, **`chat`**, **`start`**, `typecheck`, `test`, `check` | 已过期 | 实测 `npm run chat` → `Missing script: "chat"`；`start` 同样无。实际 28 个脚本中**无 chat、无 start** | 改为如实列举（并去掉不存在的两个） |
| 11 | `tsconfig.json` enables strict compilation | 属实 | `"strict": true` | 保留 |
| 12 | `test/cli.test.js` validates the built CLI through process-level smoke tests | 已过期 | `test/cli.test.js` 不存在 | 删除该条 |
| 13 | `test/cli.test.js` now also validates `/read` `/bash` tool paths | 已过期 | 同上 | 删除该条 |
| 14 | `test/tool-runtime.test.js` validates the Phase 2 tool lifecycle skeleton | 已过期 | `test/tool-runtime.test.js` 不存在 | 删除该条 |
| 15 | `rxjs` is part of the runtime dependency baseline | 属实 | `dependencies.rxjs = ^7.8.2` | 保留 |
| 16 | Phase 1 runtime/provider/ui/session skeleton files exist under `src/runtime/`, `src/providers/`, `src/ui/` | 已过期 | `src/runtime/` **不存在**；`src/providers/`、`src/ui/` 存在但不再是"Phase 1 skeleton" | 改为当前的目录现实 |
| 17 | Phase 2 tool/permission skeleton files exist under `src/tools/` and `src/runtime/` | 已过期 | `src/tools/` 存在；`src/runtime/` **不存在**（运行时已迁至 `src/core/`） | 改为当前的目录现实 |
| 18 | **There is no dedicated linter configured yet** | 已过期 | `eslint.config.js` 与 `.prettierrc` 都在；且 `npm run lint` 已是 `npm run check` 的第 2 道门禁 | 改为描述真实的 lint 基线 |

> 注：L18 是**最典型的一处**——它与本文件下方（L327）"gate 2 runs `eslint src/`"直接自相矛盾。
> 复核 agent 2026-09-15 修了 Gaps 节里同性质的句子，**但漏了这一处**。

## C. Current Check Commands（L253–260）

| 行 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 255 | `npm run typecheck` | 属实 | 脚本存在 | 保留 |
| 256 | `npm run build` | 属实 | 脚本存在 | 保留 |
| 257 | `npm run chat -- --message "你好"` | 已过期 | `Missing script: "chat"`；该命令**跑不起来** | 删除（示例命令已死） |
| 258 | `printf 'hello' \| npm run dev -- chat` | 已过期 | `dev` 存在但已转向 TUI 主导，`dev -- chat` 不再是有效用法 | 删除或改写为真实可跑的示例 |
| 259 | `npm test`（vitest 直跑 src，不再先构建；发布前用 `test:full`） | 属实 | `test`、`test:full` 均存在；`vitest run` 直跑 src | 保留 |
| 260 | `npm run check`（全链）/ `check:fast` | 属实 | 均存在 | 保留 |

## D. Build-time Gate Scripts（L264–332）

| 行 | 断言 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 266–276 | 六道门禁的名称与顺序 | 属实 | `package.json` 的 `check` 脚本逐字一致 | 保留（本会话已修正过） |
| 279–289 | CI Contract 各条 | 属实 | 两次实跑 success；`permissions: contents: read` 在位 | 保留 |
| 302–319 | Dependency Registry Convention | 属实 | lockfile host 分布 `{registry.npmjs.org: 304}` | 保留 |
| 323–325 | locale parity 是 `en.json` vs `zh.json` | 属实 | `scripts/check-locale-parity.ts:64-65` 正是这两个路径 | 保留 |
| 326 | 7 个皮肤 / APCA 75/60/45 / 0 被标记 | 属实 | `check-contrast` 输出「passed for 7 skins」；阈值在 `src/skins/index.ts:101` | 保留 |
| 327–332 | lint 忽略项与「恰好一个文件」、0 errors / 156 warnings | 属实 | `eslint.config.js` ignores 含 `*.js *.cjs *.mjs`；实测唯一被忽略的源文件是 `src/acp/__tests__/fake-acp-agent.mjs`；`eslint src/` → 347 文件 / 0 errors / 156 warnings | 保留 |

### D-2. Registry/Handler validation gates（L334–342）——**本次最重要的发现**

| 行 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 338 | **Duplicate guard**：`register` must throw on duplicate primary name（e.g. **`CommandRegistryImpl`** throws on second `register({ name: '/foo' })`） | **已过期（两处错）** | ① `CommandRegistryImpl` **全仓不存在**——已被 `CommandManager` 取代（`src/core/shared/command-manager.ts:355`）。② `CommandManager.register()` 是裸 `Map.set()`，**无任何重复名校验** | 修正类名引用；并把"已实现 / 未实现"标注清楚 |
| 339 | **Alias guard**：must throw on duplicate alias, AND on alias-collides-with-existing-name | **已过期** | `register()` 里别名同为裸 `Map.set()`，冲突即静默覆盖；无 throw | 同上 |
| 340 | **Name format guard**：must throw on names not following required format | **已过期** | 注册路径无格式校验。`startsWith('/')` 只出现在**输入解析**（`command-executor.ts:200` 等），不在注册时 | 同上 |
| 341 | **Singleton injection**：provide `setX` / `resetX` | 属实 | `setCommandManager` / `resetCommandManager` / `getCommandManager` 均在 `command-manager.ts` 导出 | 保留 |
| 342 | **Idempotent bootstrap**：bootstrap 函数须幂等 | 未验证 | 未在本任务范围内找到对应实现与断言 | 标注为"未核实"，不擅自改 |

> **为什么这一节最值得记**：它属于"spec 谎报**做了**"的方向——比谎报"没做"更危险。
> 贡献者读到"重复注册会抛错"会放心依赖该保证，而实际上重复名会**静默覆盖**已有的命令。
> 本节 4 条守卫中 **3 条未实现**，且全仓无任何测试断言它们（`grep duplicate/already registered`
> 在 `command-manager` 测试里零命中）。
>
> 按 PRD R1 的边界规则，这是"规范的**前提事实**已被推翻"→ **只改前提、不动规范**：
> "register should throw" 作为**要求**保留，但必须写明当前**未实现**，避免被当成既成事实。

## E. Gaps Not To Paper Over（L362–369）

| 行 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| 364 | warning 存量未强制 / `format:check` 未入门禁 | 属实 | 本会话已修正 | 保留 |
| 365 | **No structured logging policy exists yet** | 已过期 | `.trellis/spec/backend/logging-guidelines.md` 有 **633 行**；`src/core/logger/` 有 Logger / FileSink / LogBus 实现 | 删除该条（策略已存在） |
| 366 | **No database or persistence layer exists yet** | 部分过期 | 无数据库属实；但**持久化层存在**：`src/core/session/` 的 session-index / session-locator + JSONL 落盘 | 精确化：无 DB，但有基于文件的会话持久化 |
| 367 | **No real external model provider exists yet** | 已过期 | `src/providers/openai.ts` 492 行、`claude.ts` 451 行，均为真实 HTTP provider | 删除该条 |
| 368 | **No real external provider is wired into the tool runtime yet**；当前仅 `local` provider | 已过期 | 上述两个 provider 已接入（`fetchWithRetry` 共用、SSE 流式、工具调用） | 删除该条 |
| 369 | **No MCP boundary implementation exists yet** | 已过期 | `src/tools/mcp/`：mcp-client / mcp-transport（含 SseTransport）/ mcp-resources / mcp-registry，均带测试 | 删除该条 |

## F. 属规范、不适用判据的条目（未改）

以下**不是**对当前状态的断言，因此不在对账范围（PRD R1）：

- `## Rule For Now`（L22–35）全部条目 —— 行为要求。
- `### RxJS 代码可读性规范` / `### TypeScript 可读性规范`（L39–241）—— 编写规范。
- `### Adding a new build-time gate`（L344–352）—— 流程指引（其中 `node --import tsx scripts/check-*.ts` 的写法与 `package.json` 中真实的 `check:contrast` / `check:locale-parity` 一致，无漂移）。
- `### Don't`（L354–358）—— 禁止性规范。其中"CI runs the full chain"自 2026-09-15 起**已由事实支撑**。
- `## Observed Baseline` 中"Phase 1 / Phase 2"这类**历史分期措辞本身**——不属客观状态断言，但因其承载的事实已过期，随 B 节一并改写。

---

## 小结（供推广决策的 R6 三问）

1. **规模**：该文件事实性断言共 **31 条**（A–E 各节合计；F 节不适用）。其中
   **已过期 14 条**、属实 15 条、部分过期 1 条、未验证 1 条。过期率 **约 45%**。
2. **成本**：单文件对账约 **12 次核验命令**（`ls`/`grep`/`npm run`/读实现）+ 通读 371 行。
   主要成本不在"找"，而在**判据边界判断**（哪些算事实、哪些算规范）。
3. **判据够用吗**：**基本够用，但出现过一次真正的边界情形**——D-2 节。那里既有规范
   （"must throw"，属要求）又内嵌事实断言（"`CommandRegistryImpl` 抛错"）。R1 的
   "改前提、不改规范"处理得当，但**需要额外一条要求**：改前提时必须显式区分
   "要求如此"与"当前就是如此"，否则读者仍会误读为既成事实。
