# 项目结构规划

## 目的

本文档定义 `rx-cli` 从简单 CLI 演进为智能体 CLI 时，近期应采用的源码布局。

---

## 当前结构

```text
bin/
docs/
src/
  cli.ts
  commands/
  chat/
  runtime/
  providers/
  tools/
  ui/
  mcp/
test/
dist/
```

Phase 2 第一批骨架之后，目录边界已经被建出来，但不同目录的成熟度并不相同：

- `src/runtime/`、`src/providers/`、`src/ui/` 已经有可运行的最小实现
- `src/tools/` 已经有工具合同、registry 和 runner 骨架
- `src/runtime/` 已经补了 permission gate 与 tool dispatch
- `src/tools/read-file.ts` 和 `src/tools/bash.ts` 已作为真实内建工具接入
- `src/mcp/` 仍是预留层
- `src/chat/` 仍是过渡层，当前用于承载本地回复构造逻辑

---

## 当前已落地结构

```text
src/
  cli.ts
  commands/
    chat.ts
    hello.ts
  chat/
    reply-pipeline.ts
  runtime/
    agent-loop.ts
    event-types.ts
    permission-gate.ts
    tool-dispatch.ts
    session-manager.ts
    turn-context.ts
  providers/
    local.ts
    provider-types.ts
  ui/
    readline-input.ts
    terminal-renderer.ts
  tools/
    README.md
    bash.ts
    default-registry.ts
    read-file.ts
    tool-registry.ts
    tool-runner.ts
    tool-types.ts
  mcp/
    README.md
```

---

## 建议演进结构

```text
bin/
  rxc.js

docs/
  architecture/
  implementation/

src/
  cli.ts
  commands/
    chat.ts
    run.ts
    resume.ts
    sessions.ts
    config.ts
    mcp.ts
  runtime/
    agent-loop.ts
    event-types.ts
    permission-gate.ts
    session-manager.ts
    session-index.ts
    tool-dispatch.ts
    turn-context.ts
  providers/
    local.ts
    provider-registry.ts
    anthropic.ts
    openai.ts
    provider-types.ts
  tools/
    tool-registry.ts
    tool-runner.ts
    bash.ts
    read-file.ts
    edit-file.ts
    git.ts
    tool-types.ts
  ui/
    terminal-renderer.ts
    readline-input.ts
  mcp/
    client.ts
    registry.ts
  chat/
    reply-pipeline.ts

test/
  cli.test.js
  runtime/
  providers/
  tools/
  ui/
```

---

## 分层职责规则

- `commands/` 只负责 CLI 入口命令。
- `runtime/` 负责编排逻辑和跨层运行时状态。
- `providers/` 负责模型厂商集成。
- `tools/` 负责内建工具实现与工具契约。
- `ui/` 负责终端输入流与渲染器。
- `mcp/` 负责 MCP 集成边界。
- `chat/` 是过渡层，随着 runtime/UI 成熟应逐步缩小。

## 依赖规则

- `commands/` 可以依赖 `runtime/`、`providers/`、`ui/`，但不反过来。
- `runtime/` 通过 contract 依赖 `providers/` 和未来的 `tools/`，不反向依赖命令层。
- `providers/` 不直接写终端，也不依赖命令层。
- `ui/` 只消费输入和 runtime 事件，不直接操作 provider。
- `tools/` 和 `mcp/` 未来都应围绕 contract 设计，不要把 SDK 细节泄漏到 `commands/`。

## RxJS 落位规则

- 天然是流的链路，优先放在 `runtime/`、`providers/`、`ui/` 中用 RxJS 编排。
- 简单同步对象转换保留普通函数，不强行做成 Observable。
- `commands/` 里只保留装配和分发，不在命令文件内写大段流式业务逻辑。

---

## 迁移规则

1. 不要继续把复杂 runtime 逻辑直接堆进 `src/commands/chat.ts`。
2. 如果一个新行为天然是流驱动的，优先把它放进 `runtime/`、`ui/`、`providers/` 或 `tools/`，并用 RxJS 做编排。
3. `bin/` 必须保持为纯 bootstrap 层。
4. `dist/` 只当作生成产物使用。
5. 如果结构发生变化，必须同步更新本文档和 Trellis backend spec。
6. 如果某个顶层目录开始承载真实实现，补全该目录的 README，说明当前文件归属和边界。
