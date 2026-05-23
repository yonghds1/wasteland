# rxc

一个按架构拆分推进的 TypeScript、Commander 和 RxJS 智能体 CLI 原型。

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

## 示例

```bash
npm run dev -- hello Trellis
npm start -- hello Trellis --upper
npm run chat -- --message "你好"
npm run dev -- chat --role coder --message "/bash pwd"
npm run dev -- config current
npm run chat -- --message "/read package.json"
npm run chat -- --message "/bash pwd"
npm run chat -- --permission-mode bypass_permissions --message "/bash pwd"
printf 'hello' | npm run dev -- chat
npm run dev -- chat
```

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

安装或链接到全局后，启动命令是 `rxc`。

如果要按真实全局命令的方式测试：

```bash
npm link
rxc --help
rxc chat --message "你好"
```

内置默认 provider 是 `local`，用于在不接真实模型时验证 runtime/provider/ui/session 边界；当前项目本地 `.rxc/settings.json` 已把默认 provider 配成 `qwen`。

当前支持的 `chat` 输入语法表见：

- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)

## 配置与数据目录

当前统一使用 `.rxc/` 作为项目级配置与运行数据目录。

配置优先级如下：

1. CLI 参数
2. 环境变量
3. 项目配置 `.rxc/settings.json`
4. 用户全局配置 `~/.rxc/settings.json`
5. 内置默认值

当前常用环境变量：

- `RXC_HOME`：覆盖全局配置根目录，等价于把 `~/.rxc/` 改到别处
- `RXC_PROVIDER`：覆盖默认 provider
- `RXC_PERMISSION_MODE`：覆盖默认权限模式
- `RXC_MAX_STEPS_PER_TURN`：覆盖单轮最大 step 数
- `RXC_DEBUG`：默认打开调试追踪
- `RXC_SESSION_DIR`：覆盖 session transcript 输出目录

当前还支持一组面向 Qwen 接入的环境变量桥接：

- `APP_CHAT_BASE_URL`
- `APP_CHAT_API_KEY`
- `APP_CHAT_MODEL`

兼容策略：

- 旧环境变量 `RX_CLI_SESSION_DIR` 仍可用，但只作为过渡兼容，主推荐值已经是 `RXC_SESSION_DIR`
- 旧项目数据目录 `.rx-cli/` 不再作为默认路径；如有历史 transcript，请手动迁移到 `.rxc/`
- 如果未显式传 `--provider` 且未设置 `RXC_PROVIDER`，当 `APP_CHAT_API_KEY` 和 `APP_CHAT_MODEL` 同时存在时，默认 provider 会自动切到 `qwen`

最小配置示例：

```json
{
  "defaultProvider": "local",
  "runtime": {
    "defaultRole": "chat",
    "permissionMode": "default",
    "maxStepsPerTurn": 8,
    "debug": false
  },
  "models": {
    "chat_model": {
      "provider": "local",
      "model": "local"
    }
  },
  "roles": {
    "chat": {
      "model": "chat_model"
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

rxc chat --message "你好"
```

说明：

- `APP_CHAT_BASE_URL` 即使不带 `/v1` 也可以，当前 provider 会自动补成兼容接口根路径
- 这组三个值更适合放在本地 shell 配置或本地 `.rxc/settings.json`，不要提交真实 key

当前第一版多角色配置已经支持：

- `runtime.defaultRole`
- `models`
- `roles`
- `chat --role <name>`
- `config current`

session transcript 默认写入 `.rxc/sessions/`。

## 项目结构

```text
bin/            可执行入口
docs/           架构与实施文档
src/            TypeScript 源码
src/commands/   子命令
src/chat/       RxJS 输入/回复管线
src/config/     统一配置加载与 `.rxc` 路径规则
src/runtime/    当前已落地的 agent runtime 层
src/providers/  当前已落地的 provider 抽象层
src/tools/      当前已落地的工具合同与内建工具层
src/ui/         当前已落地的终端 UI 层
src/mcp/        预留的 MCP 集成层
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
- `src/config/` 已统一承载 `.rxc/settings.json`、`~/.rxc/settings.json` 与环境变量覆盖逻辑

当前也已经落下 Phase 2 第一批骨架：

- 独立的 tool contract、tool registry、tool runner
- 独立的 permission gate
- 独立的 tool lifecycle dispatch 与测试
- `local` provider 下 `/read <path>` 与 `/bash <command>` 的真实工具调用路径
- 内建工具：`read-file`、`bash`、`edit-file`、`write-file`
- read-before-edit 安全检查：edit-file 和 write-file 需要先读取目标文件

下一阶段会继续补：

- 真实模型 provider 的 tool calling 支持
- 更多内建工具与更完整权限策略
- provider registry 与真实模型接入
- session index / `resume` / `sessions`
- MCP 客户端与 registry

## 文档

实现规范以 `.trellis/spec/` 为准；`docs/` 负责架构说明和阶段设计。

- [文档索引](./docs/README.md)
- [智能体 CLI 架构](./docs/architecture/agent-cli.md)
- [配置层与 `.rxc` 目录](./docs/architecture/configuration.md)
- [多角色配置方案](./docs/architecture/multi-role-configuration.md)
- [运行时分层与契约](./docs/architecture/runtime-boundaries.md)
- [项目结构规划](./docs/project-structure.md)
- [Phase 1：Agent Runtime 实施方案](./docs/implementation/phase-1-agent-runtime.md)
- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)

## 下一步

- 用真实业务命令替换示例 `hello` 命令
- 把 `local` provider 替换或并列接入真实模型 provider
- 扩展 runtime 事件、工具执行和权限模型
- 增加 `resume`、`sessions`、`config`、`mcp` 等命令
- 等 CLI 表面稳定后再引入发布自动化
