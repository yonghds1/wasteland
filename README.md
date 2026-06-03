# wasteland

Immortan Joe's War Machine - 一个基于 TypeScript、Commander 和 RxJS 的多智能体 CLI 系统。

**核心特性**：
- 基于 RxJS 的响应式 Agent 运行时
- 支持单 Agent 和多 Agent（主从编排）模式
- 完整的工具系统和权限控制
- Session 持久化和追踪

## 环境要求

- Node.js 20+
- npm

## 快速开始

```bash
npm install
npm run dev -- --help
```

## 可用脚本

- `npm run dev -- <args>`：直接从 TypeScript 源码运行 CLI
- `npm run chat -- --message "你好"`：直接从 TypeScript 源码运行 RxJS `chat` 命令
- `npm run build`：把 CLI 编译到 `dist/`
- `npm start -- <args>`：通过可执行包装层运行构建后的 CLI
- `npm test`：先构建，再运行冒烟测试
- `npm run check`：统一运行 typecheck 与测试
- `./scripts/create-aliases.sh [skin-id]`：根据皮肤配置创建角色别名（如 `joe`），postinstall 时自动执行

## 示例

```bash
npm run chat -- --message "你好"
npm run dev -- chat --role coder --message "/bash pwd"
npm run dev -- config current
npm run chat -- --message "/read package.json"
npm run chat -- --message "/bash pwd"
npm run chat -- --permission-mode bypass_permissions --message "/bash pwd"
printf 'hello' | npm run dev -- chat
npm run dev -- chat

# 多 Agent 模式（需要 Provider 支持 spawn_agent 工具）
npm run chat -- --multi --message "分析并重构 UserService"
```

## 多 Agent 模式

wasteland 采用 **单主角色 + 多子Agent** 架构：

### 主角色（Immortan Joe）

```bash
# 默认使用 Immortan Joe 主角色
wasteland chat --message "分析代码"
```

Immortan Joe 是唯一主角色，完全内置，不可覆盖。它会自动调度子Agent执行任务。

### 子Agent

内置 4 个子Agent，可在 `.wasteland/settings.json` 的 `subAgents` 中配置或覆盖：

| 子Agent | 职责 | 说明 |
|---------|------|------|
| `researcher` | 信息收集 | 搜索、发现、检索信息和资源 |
| `developer` | 代码开发 | 编写、修改、调试代码 |
| `analyst` | 系统分析 | 理解现有系统和代码结构 |
| `tester` | 测试验证 | 运行测试、验证功能、确保质量 |

### 工作原理

1. 用户与 Immortan Joe 对话
2. Joe 分析任务，决定需要哪些子Agent
3. 通过 `spawn_agent` 工具调度子Agent
4. 子Agent 并行或串行执行子任务
5. Joe 汇总结果并继续推理

**spawn_agent 工具参数**：
```typescript
spawn_agent({
  name: string;      // 子 Agent 标识
  task: string;      // 任务描述
  model?: string;    // 可选：模型选择（haiku/sonnet/opus）
  tools?: string[];  // 可选：限定工具集
})
```

**Session 文件**：
- 主 Agent: `.wasteland/sessions/{sessionId}.jsonl`
- 子 Agent: `.wasteland/sessions/{sessionId}-child-{name}.jsonl`

**测试多 Agent（使用 Qwen）**：

```bash
# 1. 配置 Qwen API Key（如果还没配置）
export APP_CHAT_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
export APP_CHAT_API_KEY="<your-key>"
export APP_CHAT_MODEL="qwen3-max"

# 2. 使用 local provider 测试 spawn_agent 命令
npm run chat -- --provider local --message "/spawn analyzer 分析 package.json"

# 3. 使用 Qwen provider 测试（Qwen 会自动决定是否调用 spawn_agent）
npm run chat -- --multi --message "分析这个项目的架构，并给出重构建议"

# 4. 使用 bypass_permissions 模式允许 spawn_agent 执行
npm run chat -- --multi --permission-mode bypass_permissions --message "..."
```

**注意**：
- `local` provider 通过 `/spawn <name> <task>` 语法触发 spawn_agent
- `qwen` provider 会根据任务自动决定是否调用 spawn_agent（需要模型支持 tool calling）
- spawn_agent 是高风险工具，默认权限模式会要求确认

`chat` 命令当前有三条输入路径：

- `--message <text>`：单次输入，适合脚本和测试
- 通过 `stdin` 管道输入：适合把外部输入整段送入同一条 runtime 路径
- 不带 `--message` 且无 `stdin` 管道：进入交互模式，按行输入，输入 `/exit` 或 `/quit` 退出

交互模式下还支持本地会话命令：

- `/help`
- `/tools`
- `/clear`
- `/exit`

这些命令在 UI 层直接处理，不会进入 runtime/provider。

安装或链接到全局后，启动命令是 `wasteland`。角色别名（如 `joe`）由 `scripts/create-aliases.sh` 根据皮肤配置动态创建。

如果要按真实全局命令的方式测试：

```bash
npm link
wasteland --help
wasteland chat --message "你好"
```

内置默认 provider 是 `local`，用于在不接真实模型时验证 runtime/provider/ui/session 边界；当前项目本地 `.wasteland/settings.json` 已把默认 provider 配成 `qwen`。

当前支持的 `chat` 输入语法表见：

- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)

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
- `WASTELAND_SESSION_DIR`：覆盖 session transcript 输出目录

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

wasteland chat --message "你好"
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

session transcript 默认写入 `.wasteland/sessions/`。

## 技能系统

RxCLI 内置技能系统，支持高级工作流和自动化操作。

### 内置技能

使用 `/技能名` 调用技能：

```bash
# 系统技能
wasteland chat --message "/help"              # 显示帮助
wasteland chat --message "/status"            # 查看会话状态
wasteland chat --message "/tools"             # 列出可用工具

# 项目技能
wasteland chat --message "/init"              # 初始化项目上下文
wasteland chat --message "/ctx"               # 显示项目概览
wasteland chat --message "/init --template minimal"  # 使用最小模板
```

### 技能别名

大部分技能都有简短别名：

- `/help` → `/h`, `/?`
- `/status` → `/stat`, `/info`
- `/tools` → `/tls`
- `/init` → `/i`
- `/context` → `/ctx`

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
  runAgentLoop → runTurnLoop → Provider.runStep → tool_call → dispatchToolCall

多 Agent 模式:
  runAgentLoop → runTurnLoop → Provider.runStep
    ↓ (tool_call: spawn_agent)
    → dispatchToolCall
      → createSpawnAgentTool
        → runAgentLoop (子 Agent, mode="single")
          → 返回 tool_result
```

**核心优势**：
- 单 Agent 行为完全保持不变
- spawn_agent 作为普通工具，无需修改核心架构
- 利用现有权限系统控制 spawn 行为
- RxJS forkJoin 自然支持并行执行

**相关文件**：
- `src/runtime/event-types.ts` - RuntimeEvent 类型（含 agent_spawned/agent_completed）
- `src/runtime/session-manager.ts` - SessionManager（含 createChildSession）
- `src/tools/spawn-agent.ts` - spawn_agent 工具实现

## 项目结构

```text
bin/            可执行入口
docs/           架构与实施文档
src/            TypeScript 源码
src/commands/   子命令
src/chat/       RxJS 回复管线
src/config/     统一配置加载与 `.wasteland` 路径规则
src/runtime/    当前已落地的 agent runtime 层
src/providers/  当前已落地的 provider 抽象层
src/tools/      当前已落地的工具合同与内建工具层
src/skills/     技能系统（技能注册、发现、执行）
src/ui/         当前已落地的终端 UI 层
src/tui/        TUI 界面（基于 Ink/React）
test/           冒烟测试
dist/           构建产物
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
- 内建工具：`read-file`、`glob`、`grep`、`list-directory`、`web-fetch`、`bash`、`edit-file`、`write-file`
- read-before-edit 安全检查：edit-file 和 write-file 需要先读取目标文件

**Phase 3 多 Agent 架构已完成**：

- `spawn_agent` 工具：允许主 Agent 创建子 Agent
- 子 Agent Session 管理：独立的 session 文件
- RuntimeEvent 扩展：`agent_spawned`、`agent_completed` 事件
- CLI 参数：`--multi` 提示多 Agent 模式
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

- [**wasteland 核心架构规范**](./docs/architecture/wasteland-spec.md) ⭐ 唯一事实来源
- [文档索引](./docs/README.md)
- [智能体 CLI 架构](./docs/architecture/agent-cli.md)
- [多 Agent 协作架构](./docs/architecture/multi-agent-architecture.md)
- [配置层与 `.wasteland` 目录](./docs/architecture/configuration.md)
- [多角色配置方案](./docs/architecture/multi-role-configuration.md)
- [运行时分层与契约](./docs/architecture/runtime-boundaries.md)
- [技能系统架构](./docs/architecture/skills.md)
- [项目结构规划](./docs/project-structure.md)
- [Phase 1：Agent Runtime 实施方案](./docs/implementation/phase-1-agent-runtime.md)
- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)
- [Phase 3：多步 Agent Loop 与调试追踪](./docs/implementation/phase-3-multi-step-agent-loop.md)
