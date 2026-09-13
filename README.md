# wasteland

Wasteland - 一个基于 TypeScript、RxJS 和 Ink/React 的多智能体系统,以 TUI 为唯一主界面,CLI 仅作非交互 fallback。Core 与 UI 经 adapter 解耦,UI 层可替换。

**核心特性**：
- 基于 RxJS 的响应式 Agent 运行时
- **TUI 主界面**（Ink/React），CLI 作为非交互 fallback；UI 与 core 经 adapter 解耦
- 支持单 Agent 和多 Agent（主从编排）模式
- **并行 Agent 执行**：多个 spawn_agent 调用可并行执行，提升多 Agent 系统效率
- 完整的工具系统和权限控制
- **MCP 协议支持**：支持 stdio 和 SSE 传输，Resources 和 Prompts 功能
- **ACP 协作**：基于 Agent Client Protocol（stdio JSON-RPC），流式 session/update，子进程按调用起停
- **代码助手集成**：支持 Claude Code、Codex 等代码助手的 ACP 协议调用（官方适配器）
- **web-search 增强**：使用 cheerio 进行 HTML 解析，支持 LRU 缓存
- Session 持久化和追踪

## 环境要求

- Node.js 20+
- npm

## 快速开始

### 安装

```bash
npm install
```

### 配置 Provider

```bash
# 方式 1: 环境变量（支持主流 OpenAI、DeepSeek、Anthropic、GLM、Qwen 等）
export OPENAI_API_KEY='your-openai-api-key'
# 或
export DEEPSEEK_API_KEY='your-deepseek-api-key'
# 或
export ANTHROPIC_API_KEY='your-anthropic-api-key'

# 方式 2: 交互式引导 / 配置文件
# 首次启动会自动进入 InitWizard 向导引导配置，也可以随时编辑 ~/.wasteland/auth.json
```

### 启动 TUI

```bash
# 开发模式：从 TypeScript 源码启动 TUI（默认入口）
npm run dev

# 全局安装后
wasteland
```

启动后在 TUI 界面直接输入消息即可对话，AI 响应流式渲染，工具调用、权限决策、子 Agent 进度均实时展示。不带参数运行 `wasteland` 或 `npm run dev` 会自动进入 TUI（`src/cli.ts` 无参时自动追加 `tui`）。

## 可用脚本

- `npm run dev`：从 TypeScript 源码启动 TUI（默认入口，等价于 `npm run dev -- tui`）
- `npm run dev -- chat --message "你好"`：以非交互模式运行 `chat` 命令（已从 `--help` 隐藏，仅作管道/脚本 fallback）
- `npm run build`：把 CLI 编译到 `dist/`
- `npm run tui:build`：先构建再运行 TUI
- `npm test`：直接运行测试（vitest 跑 `src`，无需先构建）；发布前完整校验用 `npm run test:full`（先构建再测）
- `npm run check`：全链（typecheck + lint + i18n + parity + contrast + 全量测试，合并/CI 前用）；日常用 `npm run check:fast`（仅 typecheck + lint）
- `./scripts/create-aliases.sh [skin-id]`：根据皮肤配置创建角色别名（如 `warlord`），postinstall 时自动执行

## 界面与分层架构

wasteland 采用三层分层架构，UI 层可替换，core 不依赖任何具体 UI：

```
┌─────────────────────────────────────────────────────────────┐
│  UI 层（可替换，core 不依赖具体 UI）                          │
│                                                             │
│   TUI（Subject 直连）            CLI（非交互 fallback）       │
│   src/tui/                       src/ui/                     │
│   Ink / React                    readline / terminal         │
│   （无专用 adapter 类）           CliInputAdapter             │
│                                  CliOutputAdapter             │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
               │   统一为 ChatInputTurn 流      │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Adapter 层   src/core/input-adapter.ts + output-adapter.ts     │
│                                                             │
│  InputAdapter（抽象）          OutputAdapter（抽象）          │
│  统一输入为 input$              RuntimeEvent → DisplayEvent   │
│                               DefaultOutputAdapter（1:1 映射）│
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Core 层   src/core/runtime/（UI 无关，可独立运行）           │
│                                                             │
│  runAgentLoop({ input$ }) → { events$, debug$ }             │
│  session-manager · tool-dispatch · permission-gate           │
│  event-types · user-input-bridge                             │
└─────────────────────────────────────────────────────────────┘
```

- **UI 层**：TUI（`src/tui/`，Ink/React，无专用 adapter 类，Subject + `useRuntimeEvents` 直连）是唯一主界面；CLI（`src/ui/`，readline/terminal，`CliInputAdapter`/`CliOutputAdapter`）保留为非交互/管道/脚本 fallback。两者经同一套 adapter 接口接入 core。
- **Adapter 层**：`src/core/input-adapter.ts` / `output-adapter.ts` 定义 `InputAdapter`/`OutputAdapter` 抽象与 `DefaultOutputAdapter`，把 `RuntimeEvent` 1:1 映射为 `DisplayEvent`，屏蔽 UI 差异。
- **Core 层**：`src/core/runtime/` 负责编排（`runAgentLoop`、`session-manager`、`tool-dispatch`、`permission-gate`、`event-types`、`user-input-bridge`），与 UI 完全解耦。`runAgentLoop({ input$ })` 返回 `{ events$, debug$ }`，UI 经 adapter 订阅事件流。

## 使用示例

### 基础对话（TUI）

```bash
# 启动 TUI（默认入口）
npm run dev

# 指定 provider / role 启动
npm run dev -- tui --provider jdcloud --role orchestrator
```

启动后在 TUI 界面直接输入消息即可对话，响应流式渲染。

### Tool Calling（TUI）

在 TUI 中直接输入：

- "读取 package.json" → 触发 `read-file`
- "列出当前目录" → 触发 `list-directory` / `bash`
- "搜索所有 .ts 文件" → 触发 `glob`

工具调用请求、权限决策、执行结果都会在 TUI 中实时展示。

### 多 Agent（TUI）

在 TUI 中输入需要编排的任务，主角色（orchestrator）会通过 `spawn_agent` 调度子 Agent：

- "创建一个子 Agent 来分析代码"
- "同时执行：1. 读取 README.md 2. 列出目录"

子 Agent 的创建、进度、完成事件会在 TUI 中显示。

### 会话管理

```bash
# 列出会话
wasteland sessions

# 查看会话详情
wasteland sessions show <session-id>

# 恢复会话
wasteland resume <session-id>

# 删除会话
wasteland sessions delete <session-id> --confirm
```

TUI 也支持 `--attach <session>` 直接附加到历史会话：

```bash
npm run dev -- tui --attach <session-id>
```

### 非交互 fallback（chat 命令）

`chat` 命令已从 `--help` 隐藏（`src/cli.ts` 中 `hidden: true`），保留作脚本/管道场景的 fallback。chat 命令选项：`-m/--message`、`-p/--provider`、`-r/--role`、`--debug`、`--debug-format`、`--permission-mode`（无 `--multi`，多 Agent 由 `spawn_agent` 工具调度）。

```bash
# 单次消息（脚本场景）
npm run dev -- chat --provider jdcloud --message "你好"

# 管道输入
echo "列出当前目录" | npm run dev -- chat --provider jdcloud

# 交互式 CLI（非 TTY 无法启动 TUI 时的 fallback）
npm run dev -- chat --provider jdcloud
```

`chat` 命令的三条输入路径：

- `--message <text>`：单次输入，适合脚本和测试
- 通过 `stdin` 管道输入：适合把外部输入整段送入同一条 runtime 路径
- 不带 `--message` 且无 `stdin` 管道：进入交互模式，按行输入，输入 `/exit` 或 `/quit` 退出

交互模式下支持本地会话命令（在 UI 层直接处理，不进入 runtime/provider）：

- `/help`
- `/tools`
- `/clear`
- `/exit`

内置默认 provider 是 `local`，用于在不接真实模型时验证 runtime/provider/ui/session 边界；当前项目本地 `.wasteland/settings.json` 已把默认 provider 配成 `qwen`。如果要按真实全局命令的方式测试：

```bash
npm link
wasteland --help
wasteland chat --message "你好"
```

`chat` 输入语法表见：

- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)

## 多 Agent 模式

wasteland 采用 **单主角色 + 多子Agent** 架构：

### 主角色（orchestrator）

```bash
# 在 TUI 中直接对话即可，默认使用 orchestrator 主角色
npm run dev
```

orchestrator 是唯一主角色，完全内置，不可覆盖。它会自动调度子Agent执行任务。

### 子Agent

内置 4 个子Agent，可在 `.wasteland/settings.json` 的 `subAgents` 中配置或覆盖：

| 子Agent | 职责 | 说明 |
|---------|------|------|
| `researcher` | 信息收集 | 搜索、发现、检索信息和资源 |
| `developer` | 代码开发 | 编写、修改、调试代码 |
| `analyst` | 系统分析 | 理解现有系统和代码结构 |
| `tester` | 测试验证 | 运行测试、验证功能、确保质量 |

### 工作原理

1. 用户与 orchestrator 对话
2. 主角色分析任务，决定需要哪些子Agent
3. 通过 `spawn_agent` 工具调度子Agent
4. 子Agent 并行或串行执行子任务
5. 主角色汇总结果并继续推理

**spawn_agent 工具参数**：
```typescript
spawn_agent({
  name: string;      // 子 Agent 标识
  task: string;      // 任务描述
  model?: string;    // 可选：模型选择（haiku/sonnet/opus）
  tools?: string[];  // 可选：限定工具集
})
```

**Session 文件**（中央数据根 `~/.wasteland/data/sessions/<projectId>/`）：
- 主 Agent: `{sessionId}.jsonl`
- 子 Agent: `{sessionId}-child-{name}.jsonl`

**测试多 Agent（使用 Qwen）**：

在 TUI 中直接输入任务即可触发多 Agent；以下为非交互测试场景：

```bash
# 1. 配置 Qwen API Key（如果还没配置）
export APP_CHAT_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
export APP_CHAT_API_KEY="<your-key>"
export APP_CHAT_MODEL="qwen3-max"

# 2. 使用 local provider 测试 spawn_agent 命令
npm run dev -- chat --provider local --message "/spawn analyst 分析 package.json"

# 3. 使用 Qwen provider 测试（Qwen 会自动决定是否调用 spawn_agent）
npm run dev -- chat --message "分析这个项目的架构，并给出重构建议"

# 4. 使用 bypass_permissions 模式让子 agent 的工具调用也免确认、全自动跑完
npm run dev -- chat --permission-mode bypass_permissions --message "..."
```

**注意**：
- `local` provider 通过 `/spawn <name> <task>` 语法触发 spawn_agent
- `qwen` provider 会根据任务自动决定是否调用 spawn_agent（需要模型支持 tool calling）
- spawn_agent 本体免确认（只读级，只创建子会话）；子 agent 的工具调用（bash/edit 等）照常走权限门确认（同 Claude Code 的 Agent 工具语义）

## 配置与数据目录

当前统一使用 `.wasteland/` 作为项目级配置与运行数据目录。

配置优先级如下：

1. CLI 参数
2. 环境变量
3. 项目配置 `.wasteland/settings.json`
4. 用户全局配置 `~/.wasteland/settings.json`
5. 内置默认值

当前常用环境变量：

- `WASTELAND_HOME`：覆盖全局配置根目录，等价于把 `~/.wasteland/` 改到别处
- `WASTELAND_PROVIDER`：覆盖默认 provider
- `WASTELAND_PERMISSION_MODE`：覆盖默认权限模式
- `WASTELAND_MAX_STEPS_PER_TURN`：覆盖单轮最大 step 数
- `WASTELAND_DEBUG`：默认打开调试追踪
- `WASTELAND_LOG_LEVEL`：日志最低等级，支持 `debug` / `info` / `warn` / `error`，默认 `info`；`WASTELAND_DEBUG=1` 等价于设为 `debug`
- `WASTELAND_LOG_DIR`：覆盖日志目录，默认中央数据根 `~/.wasteland/data/logs/<projectId>/`
- `WASTELAND_DATA_DIR`：覆盖中央数据根，默认 `~/.wasteland/data/`
- `WASTELAND_LOG_REDACT`：日志脱敏策略开关，默认 `true`；8 类 baseline secret denylist 始终保留
- `WASTELAND_LOG_TAIL_LINES`：日志查看默认尾部行数，默认 `50`
- `WASTELAND_SESSION_DIR`：覆盖 session transcript 输出目录
- `WASTELAND_LANGUAGE`：覆盖界面语言（如 `zh`、`en`）
- `WASTELAND_MAX_CONCURRENCY`：覆盖并行子 Agent 最大并发数（`-1` 表示无限制）

当前还支持一组面向 Qwen 接入的环境变量桥接：

- `APP_CHAT_BASE_URL`
- `APP_CHAT_API_KEY`
- `APP_CHAT_MODEL`

兼容策略：

- 旧环境变量 `RX_CLI_SESSION_DIR` 仍可用，但只作为过渡兼容，主推荐值已经是 `WASTELAND_SESSION_DIR`
- 旧项目数据目录 `.rx-cli/` 不再作为默认路径；如有历史 transcript，请手动迁移到 `.wasteland/`
- 如果未显式传 `--provider` 且未设置 `WASTELAND_PROVIDER`，当 `APP_CHAT_API_KEY` 和 `APP_CHAT_MODEL` 同时存在时，默认 provider 会自动切到 `qwen`

最小配置示例：

```json
{
  "runtime": {
    "permissionMode": "default",
    "maxStepsPerTurn": 8,
    "debug": false
  },
  "models": {
    "default_model": {
      "provider": "local",
      "model": "local"
    }
  },
  "providers": {
    "local": {}
  }
}
```

Qwen 最小使用方式：

```bash
export APP_CHAT_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
export APP_CHAT_API_KEY="<your-key>"
export APP_CHAT_MODEL="qwen3-max"

npm run dev
```

说明：

- `APP_CHAT_BASE_URL` 即使不带 `/v1` 也可以，当前 provider 会自动补成兼容接口根路径
- 这组三个值更适合放在本地 shell 配置或本地 `.wasteland/settings.json`，不要提交真实 key

当前第一版多角色配置已经支持：

- `runtime.defaultRole`
- `models`
- `roles`
- `chat --role <name>`
- `config current`

session transcript 默认写入中央数据根 `~/.wasteland/data/sessions/<projectId>/`。

### 日志与问题排查

Runtime 日志默认写入中央数据根 `~/.wasteland/data/logs/<projectId>/`（TUI `/logs` 默认跨项目聚合）。可以用内置命令或标准 `grep` / `jq` 按 session、level、scope 定位问题：

```bash
# 最近的 warn/error
wasteland logs errors --tail 50

# 查看指定 session 的完整 runtime 链路
wasteland logs show <session-id>

# 持续跟踪 tool / permission 事件
wasteland logs tail --level warn --scope tool,permission --follow

# 直接按 sessionId 或 error level 查询 JSONL（先 cd 到对应项目目录，或把路径换成 ~/.wasteland/data/logs/<projectId>/）
grep '"sessionId":"<session-id>"' ~/.wasteland/data/logs/*/sessions/*.jsonl ~/.wasteland/data/logs/*/error.jsonl
jq 'select(.level=="error")' ~/.wasteland/data/logs/*/error.jsonl
```

完整字段、轮转与脱敏约定见 [日志系统架构](./docs/architecture/logging.md)。

## 技能系统

wasteland 内置技能系统，支持高级工作流和自动化操作。使用 `/技能名` 调用技能，在 TUI 或交互式 CLI 中直接输入即可。

### 内置技能

```bash
# 系统技能
/help              # 显示帮助
/status            # 查看会话状态
/tools             # 列出可用工具

# 项目技能
/init              # 初始化项目上下文
/ctx               # 显示项目概览
/init --template minimal  # 使用最小模板
```

日志页命令是 TUI 本地命令，不注册为技能，也不会发送给 provider：

```text
/logs                         # 打开 LogsPage，保留当前过滤
/logs errors                  # 打开 LogsPage，仅看 error
/logs show <session-id>       # 按 sessionId 过滤
/logs level <level>           # 设置 debug/info/warn/error
/logs scope <scope,...>       # 设置一个或多个 scope
/logs close                   # 返回 chat page
/logs help                    # 显示命令帮助
/log 或 /debug                # /logs 的别名
```

### 技能别名

大部分技能都有简短别名：

- `/help` -> `/h`, `/?`
- `/status` -> `/stat`, `/info`
- `/tools` -> `/tls`
- `/init` -> `/i`
- `/context` -> `/ctx`

### 自定义技能

在 `.wasteland/skills/` 目录创建自定义技能：

**JSON 格式**：
```json
{
  "name": "my-skill",
  "description": "我的自定义技能",
  "riskLevel": "read",
  "aliases": ["ms"],
  "steps": [
    { "tool": "bash", "input": { "command": "pwd" }, "saveAs": "dir" }
  ],
  "template": "当前目录: {{dir}}"
}
```

**TypeScript 格式**：
```typescript
// .wasteland/skills/my-skill.ts
export default {
  definition: {
    name: "my-skill",
    description: "我的自定义技能",
    riskLevel: "read",
  },
  async execute(args, context) {
    const result = await context.toolRegistry.get("bash")!.execute(
      { command: "pwd" },
      { sessionId: context.sessionId, turn: context.turn, cwd: context.cwd }
    );
    return { status: "success", output: result.output };
  },
};
```

详细文档见 [技能系统架构](./docs/architecture/skills.md)。

## 多 Agent 架构

wasteland 采用 **Agents-as-Tools** 模式实现多 Agent 编排：

```
单 Agent 模式（默认）:
  runAgentLoop -> runTurnLoop -> Provider.runStep -> tool_call -> dispatchToolCall

多 Agent 模式:
  runAgentLoop -> runTurnLoop -> Provider.runStep
    ↓ (tool_call: spawn_agent)
    -> dispatchToolCall
      -> createSpawnAgentTool
        -> runAgentLoop (子 Agent, mode="single")
          -> 返回 tool_result
```

**核心优势**：
- 单 Agent 行为完全保持不变
- spawn_agent 作为普通工具，无需修改核心架构
- 利用现有权限系统控制 spawn 行为
- RxJS forkJoin 自然支持并行执行

**相关文件**：
- `src/core/runtime/event-types.ts` - RuntimeEvent 类型（含 agent_spawned/agent_completed）
- `src/core/runtime/session-manager.ts` - SessionManager（含 createChildSession）
- `src/tools/spawn-agent/` - spawn_agent 工具实现（dispatch-handler / event-forwarder）

## 项目结构

```text
bin/            可执行入口
docs/           架构与实施文档
examples/       手动/调试脚本（multi-agent、streaming、verify-init 等，非构建流程）
src/            TypeScript 源码（测试与源码同目录：src/**/*.test.ts）
src/commands/   子命令（tui / chat / config / init / sessions / resume / skin / logs）
src/config/     统一配置加载与 `.wasteland` 路径规则（load-settings 门面 + validate/merge/env-auth 模块）
src/core/       核心层（与 UI 解耦）
src/core/input-adapter.ts + output-adapter.ts  InputAdapter/OutputAdapter 抽象 + DefaultOutputAdapter
src/core/logger/    日志子系统（types/log-bus/file-sink/redactor/rotation）
src/core/runtime/   agent runtime（runAgentLoop / session-manager / tool-dispatch / permission-gate / event-types / user-input-bridge）
src/core/shared/    runtime 初始化等共享逻辑（含 run-agent-helpers：三入口共享装配）
src/core/skills/    技能注册/发现/执行
src/providers/  provider 抽象层（local / openai-compatible / claude 等）
src/tools/      工具合同与内建工具层（含 spawn-agent/ 子目录）
src/skills/     技能系统（技能注册、发现、执行）
src/ui/         CLI 终端 UI 层（CliInputAdapter / CliOutputAdapter，readline/terminal）
src/tui/        TUI 界面（基于 Ink/React；hooks/ 下有 runtime-reducers 与 useLogsKeymap，wizard/ 下是 InitWizard 拆分模块）
src/skins/      皮肤加载（角色人设与皮肤解耦）
src/theme/      TUI 视觉主题与 palette 对比度
src/acp/        ACP 协作（Agent Client Protocol 客户端，stdio JSON-RPC）
src/locales/    i18n 翻译（zh / en）
dist/           构建产物（gitignored）
```

## 当前进度

当前已经完成 Phase 1 runtime 骨架：

- `chat` 的 `--message`、`stdin`、交互模式共用同一条 runtime 路径
- `runAgentLoop(...)` 负责编排 turn、provider 输出和 session 持久化
- `local` provider 用于在不接真实模型时验证 provider/runtime/ui 边界
- `qwen` provider 已可通过 DashScope OpenAI-compatible Chat Completions 跑通真实一轮对话
- `chat --role <name>` 已可按 role 解析模型、provider 和默认权限
- `config current` 已可输出当前生效的 provider / model / role 配置，并对敏感字段脱敏
- session transcript 会写入本地 JSONL
- `src/config/` 已统一承载 `.wasteland/settings.json`、`~/.wasteland/settings.json` 与环境变量覆盖逻辑

当前也已经落下 Phase 2 第一批骨架：

- 独立的 tool contract、tool registry、tool runner
- 独立的 permission gate
- 独立的 tool lifecycle dispatch 与测试
- `local` provider 下 `/read <path>` 与 `/bash <command>` 的真实工具调用路径
- 内建工具：`read-file`、`glob`、`grep`、`list-directory`、`web-fetch`、`web-search`、`bash`、`edit-file`、`write-file`、`http-request`、`git`、`ask-user`、`spawn_agent`
- read-before-edit 安全检查：edit-file 和 write-file 需要先读取目标文件

**Phase 3 多 Agent 架构已完成**：

- `spawn_agent` 工具：允许主 Agent 创建子 Agent
- 子 Agent Session 管理：独立的 session 文件
- RuntimeEvent 扩展：`agent_spawned`、`agent_completed` 事件
- 多 Agent 调度：由 `spawn_agent` 工具触发，无需 CLI 开关
- 架构设计：Agents-as-Tools 模式，与现有架构无缝整合

**技能系统已完成**：

- 内置技能：`/help`、`/status`、`/tools`、`/init`、`/context`
- 技能注册表：支持名称和别名查找
- 技能执行器：参数解析、验证和执行协调
- 技能发现：自动加载 `.wasteland/skills/` 和 `~/.wasteland/skills/`
- JSON 和 TypeScript 格式支持
- TUI 日志增强：显示技能调用详情

**ask-user 工具已完成**：

- `ask-user` 工具：允许 Agent 向用户提问并获取输入
- `UserInputBridge`：agent loop 与 UI 层之间的输入桥接机制
- RuntimeEvent 扩展：`user_input_requested`、`user_input_received` 事件
- UI 集成：交互模式下自动检测用户输入请求并路由响应
- 端到端测试：验证完整的用户交互流程

**Session Resume 功能已完成**：

- `sessions` 命令：列出历史会话，支持搜索、过滤和排序
- `sessions show <id>`：查看会话详情和完整消息历史
- `sessions delete <id>`：删除会话及其子 Agent 会话
- `sessions stats`：查看会话统计信息
- `resume` 命令：恢复之前的会话，支持交互模式和单次消息模式
- SessionIndex：高效的会话索引和检索系统
- 端到端测试：验证完整的会话恢复流程

下一阶段会继续补：

- 真实模型 provider 的 tool calling 支持
- 多 Agent 并行执行的端到端测试
- 更多内建工具与更完整权限策略
- provider registry 与真实模型接入
- MCP 客户端与 registry

## 文档

### 用户指南

- [快速开始](./docs/user-guide/getting-started.md) - 安装和基础使用
- [配置指南](./docs/user-guide/configuration.md) - 配置选项详解
- [工具使用指南](./docs/user-guide/tools.md) - 所有内建工具
- [多 Agent 指南](./docs/user-guide/multi-agent.md) - 多 Agent 协作

### 架构文档

- [**wasteland 核心架构规范**](./docs/architecture/wasteland-spec.md) ⭐ 唯一事实来源
- [Input/Output 适配器架构](./docs/architecture/input-output-adapters.md) - Adapter Pattern
- [智能体 CLI 架构](./docs/architecture/agent-cli.md)
- [多 Agent 协作架构](./docs/architecture/multi-agent-architecture.md)
- [配置层与 `.wasteland` 目录](./docs/architecture/configuration.md)
- [技能系统架构](./docs/architecture/skills.md)

### 实施文档

- [Phase 1：Agent Runtime 实施方案](./docs/implementation/phase-1-agent-runtime.md)
- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)
- [Phase 3：多步 Agent Loop 与调试追踪](./docs/implementation/phase-3-multi-step-agent-loop.md)

## License

[Apache-2.0](./LICENSE) © yonghds1
