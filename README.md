# rx-cli

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

当前默认 provider 是 `local`，用于在不接真实模型的情况下验证 runtime/provider/ui/session 边界。

当前支持的 `chat` 输入语法表见：

- [Phase 2：工具运行时与权限闸门](./docs/implementation/phase-2-agent-tool-runtime.md)

session transcript 默认写入 `.rx-cli/sessions/`，也可以通过环境变量 `RX_CLI_SESSION_DIR` 覆盖。

## 项目结构

```text
bin/            可执行入口
docs/           架构与实施文档
src/            TypeScript 源码
src/commands/   子命令
src/chat/       RxJS 输入/回复管线
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
- session transcript 会写入本地 JSONL

当前也已经落下 Phase 2 第一批骨架：

- 独立的 tool contract、tool registry、tool runner
- 独立的 permission gate
- 独立的 tool lifecycle dispatch 与测试
- `local` provider 下 `/read <path>` 与 `/bash <command>` 的真实工具调用路径

下一阶段会继续补：

- 更多内建工具与更完整权限策略
- provider registry 与真实模型接入
- session index / `resume` / `sessions`
- MCP 客户端与 registry

## 文档

实现规范以 `.trellis/spec/` 为准；`docs/` 负责架构说明和阶段设计。

- [文档索引](./docs/README.md)
- [智能体 CLI 架构](./docs/architecture/agent-cli.md)
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
