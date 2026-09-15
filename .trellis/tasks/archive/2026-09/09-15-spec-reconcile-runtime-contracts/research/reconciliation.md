# 对账表：`.trellis/spec/backend/runtime-contracts.md`

核验日期 2026-09-15。926 行 / 7 个 `## Scenario:`。判据继承父任务 R1 / R1b / R2 / R3。
判定：**属实** / **已过期** / **属规范（不适用）**。

## 扫描方法（本文件是契约型，与试点不同）

试点靠"文件是否存在"扫，对本文件不够。实际用了三条并行扫描：

1. **代码块标识符对码**：抽出全部 ```ts 代码块中的标识符（函数式 `name(` + 类型式 `Name`），
   逐个 `grep -rl` 于 `src/` → **109 个标识符，9 个零命中**。
2. **路径存在性**：抽出全部 `src/*.ts(x)` 引用逐个 `-e` 测试 → **21 个路径，6 个失效**。
3. **品牌名扫**：扫 `.rxc` / `RXC_` / `Rxc`。**这条是脚本漏掉后补的**——见方法教训。

## A. 已过期（共 6 类，实修 42 增 / 29 删）

| 位置 | 断言原文 | 判定 | 证据 | 处理 |
|---|---|---|---|---|
| L38/41/44 | `loadRxcSettings(...): Promise<LoadedRxcSettings>`、`ResolvedRxcSettings` | 已过期 | 真名为 `loadWastelandSettings`（`src/config/load-settings.ts:529`）、`LoadedWastelandSettings` / `ResolvedWastelandSettings`（`src/config/settings-types.ts:357/286`）。rx-cli 时代命名 | 全部改名 |
| L113/162 | `createInteractiveTurnStream(...): InteractiveTurnStream` | 已过期 | 两处零命中。现由 `CliInputAdapter implements InputAdapter`（`src/ui/cli-input-adapter.ts:87`）承担，契约在 `src/core/input-adapter.ts:17` | 替换为真实契约并注明旧名已废 |
| **L166–180** | 配置源全用 `.rxc/`、`RXC_HOME`、`RXC_*` | 已过期 | `src/` 中 **`RXC_` 零命中**；真实为 `.wasteland/` 与 `WASTELAND_HOME` / `WASTELAND_*`（对比 `docs/architecture/configuration.md:23-49`） | 全块改写 |
| L197–201 | `RXC_SESSION_DIR`；缺省为 `.rxc/sessions/`（cwd 下） | 已过期 | 真名 `WASTELAND_SESSION_DIR`，legacy 依次 `JOE_SESSION_DIR`、`RX_CLI_SESSION_DIR`（`src/config/paths.ts:116-122`）；缺省**不走项目本地**，走中央数据根 `<dataRoot>/sessions/<projectId>/`（`paths.ts:108-113`） | 改写，含顺序与真实缺省 |
| L209/220/250/295 | `.rxc/traces/<sessionId>.jsonl`、`.rxc/traces/`（"与 `.rxc/sessions/` 平行"） | 已过期 | `resolveDefaultTraceDir`（`paths.ts:128-138`）用**项目配置目录**或 `~/.wasteland/`，**不经中央数据根**；故正确路径是 `.wasteland/traces/`，且**与 sessions 不再同级** | 路径改写 + 修掉"平行"这一已不成立的关系 |
| L305-306 | `.rxc/auth.json` / `.rxc/settings.json` | 已过期 | 同上（`.wasteland/`） | 改写 |
| L489/591/795/800/537 | 5 个测试/源码路径 | 已过期 | 全部只是**搬家**：`src/commands/chat.test.ts`→`__tests__/`；`src/core/runtime/…context-manager*`→`src/core/memory/…`；`src/tui/hooks/useRuntime.test.ts`→`__tests__/`；`tool-reducer.test.ts`→`__tests__/`；`ChatInputBar.test.ts`→`__tests__/ChatInputBar.test.**tsx**`（扩展名也变了，这解释了三轮扫描的偏差） | 逐个更新 |

> **`ChatInputBar.test.ts` 的追查结论（PRD AC2）**：不是臆造也没被删——它**搬到了同级 `__tests__/`
> 且扩展名由 `.ts` 改成 `.tsx`**。我的前两轮检查只找 `.test.ts`，因此两次都判"不存在"。
> 这是"检查手段不完整被误读为事实"的一个实例，与试点里"关键词搜不到 ≠ 不存在"同源。

## B. 判定为"属规范、不适用"（未改）

- 7 个 scenario 的 `### 1. Scope / Trigger`、`### 5. Good/Base/Bad` 的规范意图。
- `### 4. Validation & Error Matrix` 的期望行为（要求，非现状）。
- `### 7. Wrong vs Correct` 中 **Wrong 块的伪代码**：`callProviderInline()`（L317）、
  `provider.client.post(...)`（L424）、`stripAndRetry()`（L709）三个标识符零命中，但它们是
  **刻意示错的反例**，不构成 API 断言 → **不属过期，不改**。
  （正确写法 `stripReasoningFields` 见 `src/providers/shared/reasoning-roundtrip.ts:80`，
  但反例里用错名恰恰是它示错的手段。）
- `### 6. Tests Required` 的覆盖**要求**本身。

## C. 属实并已留证（抽样列示，全部逐条扫过）

| 断言 | 证据 |
|---|---|
| `runAgentLoop` 入口 | `src/core/engine/agent-loop.ts` |
| `resolveChatRuntime` | `src/config/resolve-chat-runtime.ts` |
| `ProviderRegistry` / `createDefaultProviderRegistry` | `src/providers/provider-registry.ts:91` |
| `renderDebugTrace` | `src/ui/debug-trace-helper.ts` |
| `createSingleTurnInput` / `readPipedInput` | `src/ui/readline-input.ts` |
| 交互本地命令 `/help` `/tools` `/clear` `/exit` `/quit` | `src/core/shared/command-definitions.ts:123/137/37/183/184` |
| `chat` **命令**存在（npm script 无 `chat` 是另一回事） | `src/cli.ts:26` `program.command('chat')`；`src/commands/chat.ts` |
| `themes`/`sessions` 等中央数据根目录名常量 | `src/config/paths.ts:124-126` |

## D. 按 R1b 显式区分"要求 vs 现状"（新增标注，未改要求）

`### 6. Tests Required` 中"Process-level CLI test / smoke test"共 **9 处**。
实测：`test/` 目录与其 smoke test **已不存在**，且**没有任何测试 spawn CLI 入口**
（`chat.test.ts` 里命中的 `spawn` 是工具名 `spawn_agent`，非 `child_process`）。

按 R1b，**不删要求**，而是在该节头部加一条显式标注：
要求保留，但"进程级"这一形式**当前未实现**，现有覆盖以 `src/**/__tests__/` 下的 vitest 承载。

## 方法教训（供父任务 AC4 汇总与后续批次修订）

1. **只扫 `src/` 路径会漏掉品牌名与 env 变量**。本文件最大的一处漂移（18 行 `.rxc/` / `RXC_*`）
   是脚本之外补扫才发现的。**后续批次必须加"旧品牌名"一维**（`.rxc`、`RXC_`、`rx-cli`、`joe` 等）。
2. **必须区分代码块与反例块**。`Wrong` 示例里的标识符是刻意伪代码；把它们当过期断言去"修"
   会破坏文档的示错意图。
3. **"找不到"要归因**。`ChatInputBar.test.ts` 两轮判"不存在"，真因是我的匹配模式不含 `.tsx`。

## 小结（父任务 AC6 要求的三项）

1. 本文件事实性断言（可机械核验的部分）**约 40 条**（9 标识符 + 21 路径 + 品牌/配置块 10 余条），
   其中**已过期 6 类、波及 20 余行**；实修 42 增 / 29 删。
2. **成本显著高于存在性型试点**：本文件用了 3 轮脚本扫描 + 约 15 次定向核验命令 +
   通读 926 行。主因是"签名要对码"（109 个标识符逐个 grep），而非行数。
3. 结论：**契约型文件的单位成本约为存在性型的 2–3 倍**，但过期后果也更重（读者照签名写代码）。
   父任务排期时宜按此系数估计剩余批次。

---

## E. 收工自审（2026-09-15）

对本次改动做的对抗性回查。**自审抓到 3 处我自己引入或漏掉的问题**，均已修。

### E-1 真缺陷：我改的签名本身没验全（3 处）

| 位置 | 问题 | 证据 | 处理 |
|---|---|---|---|
| `resolveChatRuntime` | 我只把 `ResolvedRxcSettings` 换成真名，**没核对签名完整性**——真实现还有 `cwd?` 与 `agentMode?` | `src/config/resolve-chat-runtime.ts:276-286` | 补齐两参数 |
| `runAgentLoop` 入参 | 文档只列 3 个可选参数，真实现有 **18 个**（含 `doomLoopThreshold`、`abort$`、`loadedSettings` 等）。属**旧有缺陷**，非我引入，但我改过相邻行却没发现 | `src/core/engine/agent-loop.ts:161-205` | 必需项列全，可选项全名列举并指向源码 |
| `runAgentLoop` 返回 | 文档内联 `{events$, debug$}`，真类型 `AgentRun` 还有第三个字段 `userInputBridge` | `agent-loop.ts:75-80` | 改为引用 `AgentRun` 并注明三字段 |

**根因与我记下的 R7 同源**：第一轮我用"标识符是否 grep 得到"来验证签名，
但**名字存在不等于签名正确**。这是本批最重要的自我批评——我写下 R7（"找不到要归因"）之后，
**自己又犯了它的镜像错误**："找得到"就没有再往下核对。

### E-2 高危否定句：经更严格复验后成立

我在文档里新增了一句否定断言——"nothing spawns the CLI entry point"。这类断言若写错，
就是**新引入的假信息**，故用比首次更严格的手段复查：

- 首次（可能失效）：`grep -rln ... src/**/__tests__/*.ts` —— zsh 无 globstar 时 `**` 只匹配一层，**不可靠**。
- 复验：`find src -path "*__tests__*" -name "*.test.ts*"` → **112 个测试文件**，逐个 `xargs grep`
  `child_process|execFile|execa|spawnSync|execSync` → **零命中**。

结论：该否定断言**成立**，且这次是可复现的严格搜索。

### E-3 归属核实

初步 edit 把会话缺省路径归给 `src/config/paths.ts:108-113`。复验函数边界：
`resolveDefaultSessionDir`（`paths.ts:95-113`）内含该返回，且先走 `resolveSessionDirOverride`；
`src/core/session/session-index.ts:102` 与 `session-manager.ts:47` 各自的 `resolveSessionDir()`
均**委托**同一实现 → 归属正确。
同理复验 `resolveDefaultTraceDir` 确由 `src/ui/debug-trace-helper.ts:30` 调用（非仅"定义存在"）→ trace 结论成立。

### E-4 核验为真、明确选择不改的

| 项 | 实况 | 为何不改 |
|---|---|---|
| `ProviderRegistry.register(id, factory)` | 真参名为 `register(type, factory)`（`provider-registry.ts:35`） | 位置参数语义等价，改之属润色而非纠错 |
| `readPipedInput(stdin?: Readable)` | 真为 `stdin: Readable = process.stdin` | 调用方视角等价（省略即取默认） |
| `AgentProvider` | `{readonly id: string; runStep(input): Observable<…>}` 逐字相符 | 无漂移 |

### E-5 自审未覆盖的部分（诚实边界）

本批核验重心是**可机械核验的断言**（标识符、路径、品牌名、签名）。7 个 scenario 中
`### 3. Contracts` 与 `### 4. Validation & Error Matrix` 的**散文式行为描述**（如
"abort$ 触发 → AbortError，下游 catchError 转中断消息"）**未逐条对码验证**——那需要读实现并构造用例，
成本远高于本批。因此本表的覆盖**只到"签名与引用"层**，不应被读作对全文件的逐句核验。
