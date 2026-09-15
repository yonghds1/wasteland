# Quality Guidelines

> Current baseline / 当前基线: this repository has a TypeScript CLI quality baseline built around compiler checks and smoke tests.

---

## Observed Baseline / 已观察到的基线

- `.trellis/workflow.md` establishes a planning-first task workflow, spec maintenance, and quality-check expectations at the project level.
- `package.json` defines `build`, `dev`, `chat`, `start`, `typecheck`, `test`, and `check` scripts.
- `tsconfig.json` enables strict TypeScript compilation.
- `test/cli.test.js` validates the built CLI through process-level smoke tests.
- `test/cli.test.js` now also validates process-level `/read <path>` and `/bash <command>` tool paths through the main chat runtime.
- `test/tool-runtime.test.js` validates the Phase 2 tool lifecycle skeleton.
- `rxjs` is now part of the runtime dependency baseline for stream-based CLI behavior.
- Phase 1 runtime/provider/ui/session skeleton files now exist under `src/runtime/`, `src/providers/`, and `src/ui/`.
- Phase 2 tool/permission skeleton files now exist under `src/tools/` and `src/runtime/`.
- There is no dedicated linter configured yet; that absence is part of the current baseline.

---

## Rule For Now / 当前规则

- Follow the Trellis task workflow for future CLI changes: plan first, keep discoveries in spec, and run the project checks before closing the task.
- Run `npm run check` before reporting backend/CLI work complete.
- Keep the executable wrapper thin and put command behavior in `src/`.
- When a flow is event-driven or streaming by nature, prefer building it as an explicit RxJS pipeline with named stages instead of ad-hoc callback chains.
- Keep Observable boundaries explicit: command handlers should orchestrate runtime pipelines, not hide core stream logic inline.
- Treat `runAgentLoop(...)`, `AgentProvider.runStep(...)`, `RuntimeEvent`, `DebugTraceEvent`, and `SessionRecord` as the current runtime contract; when these change, update both `docs/` and `.trellis/spec/backend/runtime-contracts.md` in the same task.
- Treat tool lifecycle and permission-gate contracts as first-class runtime boundaries; when `ToolCall`, `PermissionMode`, or tool lifecycle events change, update `.trellis/spec/backend/tool-runtime-contracts.md` in the same task.
- Treat `.trellis/spec/` as the authoritative source for executable rules. If `docs/` and spec wording diverge, align `docs/` to spec rather than weakening the spec implicitly.
- If a change alters architecture, folder ownership, runtime boundaries, or implementation phases, update the matching document under `docs/` in the same task.
- For interactive commands, keep a non-interactive path that can be verified in tests.
- Test user-facing command behavior at the process boundary when practical.
- For slash commands (`/help`, `/clear`, `/exit`, etc.), follow the CommandRegistry single-source-of-truth pattern. See [CommandRegistry](./command-registry.md) — do not hard-code command names in UI, do not duplicate `LOCAL_COMMANDS` Sets, do not skip `bootstrapCommandRegistry` after `initI18n`.

---

### RxJS 代码可读性规范

当编写或修改 RxJS 代码时，必须遵循以下规范以确保新手友好：

#### 1. 注释要求

每个 RxJS 操作符必须添加中文注释说明其作用：

```ts
// ✅ 正确示例
const turns$ = params.input$.pipe(
  // concatMap: 顺序处理每个 turn，内层完成后才处理下一个
  concatMap((turn) => {
    // ...
  }),
);

// ❌ 错误示例 - 缺少注释
const turns$ = params.input$.pipe(
  concatMap((turn) => { ... }),
);
```

复杂数据流必须添加 ASCII 图：

```ts
// 数据流图:
// 用户输入$ → concatMap → user$ + assistant$
//                           │
//                           └─ runTurnLoop (可能多 step)
```

#### 2. 拆分命名函数

复杂的 operator 链必须拆分成有清晰命名的辅助函数：

```ts
// ✅ 正确示例 - 拆分成命名函数
const provider$ = params.provider.runStep({...}).pipe(
  concatMap((event) => handleProviderEvent(event, state)),
);

/**
 * 处理 provider 发出的事件
 * @param event - provider 返回的事件
 * @param state - 当前 turn 状态
 */
function handleProviderEvent(event, state) { ... }

// ❌ 错误示例 - 内联复杂逻辑
const provider$ = params.provider.runStep({...}).pipe(
  concatMap((event) => {
    if (event.type === "assistant_chunk") {
      // 50+ 行复杂逻辑...
    } else if (event.type === "tool_call") {
      // 30+ 行复杂逻辑...
    }
    // ...
  }),
);
```

#### 3. JSDoc 要求

所有 Observable 相关函数必须包含 JSDoc：

```ts
/**
 * 运行 Agent 主循环
 * 
 * @param input$ - 用户输入流，每个事件代表一次对话轮次
 * @param provider - AI provider，负责生成响应
 * @returns 包含 events$（主事件流）和 debug$（调试流）的对象
 * 
 * @example
 * const run = runAgentLoop({ input$, provider, ... });
 * await renderRuntimeEvents(run.events$);
 */
export function runAgentLoop(params): AgentRun { ... }
```

#### 4. 文档更新

引入新的 RxJS 模式时，必须更新 `docs/rxjs-guide.md`：

- 解释新模式的作用
- 提供代码示例
- 添加数据流图

#### 参考文档

- `docs/rxjs-guide.md` - 项目 RxJS 模式完整指南

---

### TypeScript 可读性规范

当编写或修改 TypeScript 类型代码时，必须遵循以下规范以确保新手友好：

#### 1. 类型定义注释要求

每个 `type` 和 `interface` 定义必须添加 JSDoc 注释：

```ts
// ✅ 正确示例
/**
 * 工具风险等级
 * 
 * 用于分类工具的危险程度：
 * - "read": 只读操作
 * - "write": 写入操作
 * - "execute": 执行操作
 */
export type ToolRiskLevel = "read" | "write" | "execute";

// ❌ 错误示例 - 缺少注释
export type ToolRiskLevel = "read" | "write" | "execute";
```

#### 2. 联合类型必须有说明

联合类型（Union Type）必须说明每个分支的含义和使用场景：

```ts
/**
 * 工具执行结果
 * 
 * 使用联合类型配合 status 字段进行类型守卫。
 * 检查 status 的值可以确定当前是哪种结果类型。
 */
export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult;
```

#### 3. 复杂类型签名要拆解说明

对于泛型包装类型（如 `Observable<T>`、`Promise<T>`），必须解释：

- 泛型参数 `T` 代表什么
- 整个类型表达什么含义

```ts
/**
 * Agent Provider 接口
 * 
 * @method runStep - 执行一步生成
 * @returns Observable<ProviderStreamEvent>
 *          - Observable 表示这是一个可观察的数据流
 *          - ProviderStreamEvent 是流中每个值的类型
 *          - 数据流会逐步发出多个事件
 */
export interface AgentProvider {
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

#### 4. 可辨识联合类型要有示例

可辨识联合（Discriminated Union）必须提供使用示例：

```ts
/**
 * 运行时事件（可辨识联合类型）
 * 
 * 通过 type 字段区分不同事件类型。
 * 
 * @example
 * switch (event.type) {
 *   case "assistant_chunk":
 *     // TypeScript 知道这里有 chunk 属性
 *     console.log(event.chunk);
 *     break;
 * }
 */
export type RuntimeEvent = ...;
```

#### 5. 属性注释

对象类型的属性应添加单行注释说明用途：

```ts
export type ToolCall = {
  /** 调用的唯一标识符 */
  id: string;
  /** 要调用的工具名称 */
  toolName: string;
  /** 传递给工具的参数 */
  input: ToolInput;
};
```

#### 6. 文档更新

引入新的 TypeScript 模式时，必须更新 `docs/typescript-guide.md`：

- 解释新模式的用途
- 提供代码示例
- 结合项目实际代码讲解

#### 参考文档

- `docs/typescript-guide.md` - 项目 TypeScript 模式完整指南

---

### any 还债约定（生产代码零 `any`）

- 动态参数袋、外部输入一律 `Record<string, unknown>` / 边界形状类型，不用 `any`（commander handler 靠推断，不写显式 `: any`）。详见执行细节与例外：`frontend/type-safety.md`。
- `as` 只用于收窄（`unknown` → 具体类型），不用于掩盖；`as any` 禁止出现。
- 测试文件的 `any` 暂不处理（mock/断言便利性优先）。
- 例外需 `eslint-disable` + 一行原因注释，硬改行为的不改类型。

---

## Current Check Commands / 当前检查命令

- `npm run typecheck`
- `npm run build`
- `npm run chat -- --message "你好"`
- `printf 'hello' | npm run dev -- chat`
- `npm test`（vitest 直跑 `src`，不再先构建；发布前完整校验用 `npm run test:full`）
- `npm run check`（全链） / `npm run check:fast`（typecheck + lint，日常/PR 前用）

---

## Build-time Gate Scripts

`npm run check` chains six gates; all must pass before merge:

| Order | Script | Purpose | Failure Mode |
|---|---|---|---|
| 1 | `npm run typecheck` | `tsc --noEmit` against `tsconfig.json` (strict) | exit non-zero on TS error |
| 2 | `npm run lint` | eslint over `src/` | exit non-zero on **error**-severity rule (warnings do not fail) |
| 3 | `npm run validate:i18n` | key-structure consistency across every file in `src/locales/` | exit non-zero + message naming the drifting locale file |
| 4 | `npm run check:locale-parity` | recursive comparison of `src/locales/en.json` vs `src/locales/zh.json` leaf keys | exit non-zero + message naming missing key + locale |
| 5 | `npm run check:contrast` | APCA Lc 75/60/45 validation for all skins against `wastelandColors.background` | exit non-zero + message naming skin ID + role + Lc value |
| 6 | `npm test` | vitest unit + process-level smoke tests | exit non-zero on assertion fail |

`npm run check:fast` = gates 1–2 only (typecheck + lint); use it for the tight local loop.

### CI Contract

`.github/workflows/ci.yml` runs `npm run check` on every `push` and `pull_request`,
on a Node matrix of **22 and 24**, with `fail-fast: false`. Added 2026-09-15.

- **Why it exists**: the gates above are only worth anything if they actually run.
  Before CI, `main` sat red on a lint error (`sidecar.test.ts` dynamic `delete`)
  without anyone noticing.
- **Advisory only**: branch protection is deliberately **not** enabled, so a red CI
  does not block a merge. The signal is a prompt, not a gate — if red runs start being
  ignored, revisit this decision.
- **Job budget**: one push ≈ 4.2 min (node 22 ≈ 144s, node 24 ≈ 110s). A private repo
  gets 2,000 Actions minutes/month ⇒ roughly 470 pushes/month.
- **Duplicate runs**: with `on: [push, pull_request]`, a branch with an open PR triggers
  both events (different `github.ref`, so `concurrency` does not cancel across them).

### Dependency Registry Convention

**`package-lock.json` must resolve every entry to `https://registry.npmjs.org`.**

`npm ci` fetches from the `resolved` URL recorded in the lockfile. A lockfile pinned to a
regional mirror (e.g. `mirrors.tencent.com`, `registry.npmmirror.com`) therefore makes
installs unreproducible on GitHub runners and for anyone outside that mirror's region.

- Verify: `grep -c 'mirrors\.tencent\.com\|registry\.npmmirror\.com' package-lock.json` → must be `0`.
- To fix, rewrite only the host prefix; all three sources share the identical path shape
  (`<host>/<pkg>/-/<name>-<version>.tgz`, scoped packages included).
  **Never touch `version` or `integrity`** — and if a rewrite leaves them unchanged, a
  subsequent `npm ci` passing is itself proof the official tarball matches the recorded hash.
- Do not regenerate the lockfile to fix this: that lets transitive versions drift within
  semver ranges. (History: 2026-09-15 normalized 258 mirror-pinned entries this way.)

### Why these gates exist

- **Locale parity** prevents translation drift: a skin id registered in `src/skins/index.ts` but missing from either locale produces `t()` falling back to the raw key in the UI. Today both locales are at 100% parity for the 13 shipped skins × 5 categories; the gate keeps them there.
- **Contrast check** prevents shipping skins whose `label` / `text` / `thinking` colors are unreadable on the wasteland dark background. WCAG 2.1 4.5:1 lets all 13 current skins pass; APCA Lc 75/60/45 correctly flags 0 skins today (after the 7 originally-failing skins were fixed in `07-29-refactor-skins-roles-palette-token-i18n`).
- **Lint scope**: gate 2 runs eslint over all of `src/` (no exclusions). Only **error**-severity
  findings fail it; warnings are reported but pass. The tree currently sits at 0 errors and
  ~150 warnings (mostly `@typescript-eslint/no-explicit-any`), so a new *error* is a genuine
  regression signal rather than noise.

### Registry/Handler validation gates

For modules that implement a registration pattern (CommandRegistry, SkillRegistry, etc.):

- **Duplicate guard**: `register` must throw on duplicate primary name (e.g., `CommandRegistryImpl` throws on second `register({ name: '/foo' })`).
- **Alias guard**: `register` must throw on duplicate alias, AND on alias-collides-with-existing-name.
- **Name format guard**: `register` must throw on names that don't follow the required format (e.g., commands must start with `/`).
- **Singleton injection**: provide `setX` / `resetX` for test isolation; tests should call `resetX` in `beforeEach` to prevent state leak.
- **Idempotent bootstrap**: if a "bootstrap from upstream registry" function exists, it must be idempotent (re-calling with the same upstream is safe).

### Adding a new build-time gate

1. Add script to `package.json`:
   ```json
   "check:<name>": "node --import tsx scripts/check-<name>.ts"
   ```
2. Append to the `check` chain in the same order the script should run.
3. Reference `.trellis/spec/backend/quality-guidelines.md#build-time-gate-scripts` in any new feature spec that depends on the gate.
4. Document the failure-mode error format in the corresponding `.trellis/spec/<layer>/*.md`.

### Don't

- Don't replace `npm run check` with a sub-set. CI runs the full chain.
- Don't suppress a failing gate with `|| true`. Fix the cause.
- Don't add a gate that runs longer than ~10s on CI; split it into `check:slow` if needed.

---

## Gaps Not To Paper Over / 当前仍然缺失的部分

- No linter or formatter is configured yet.
- No structured logging policy exists yet.
- No database or persistence layer exists yet.
- No real external model provider exists yet.
- No real external provider is wired into the tool runtime yet; current tool path is demonstrated via `local` provider.
- No MCP boundary implementation exists yet.

Do not invent rules for these areas until real code or tooling is added.
