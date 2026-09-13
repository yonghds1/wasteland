# Wasteland 工具层 (Tools Layer)

本目录承载了所有暴露给大模型（Agent）调用的原子化工具库，以及工具运行时的核心调度逻辑。
经过架构重构，工具库现已严格按照**领域驱动（Domain-Driven）**进行模块化拆分。

## 📂 领域分类 (Domains)

- **`core/`** (核心运行时)
  - 包含工具类型定义（`tool-types`）、工具执行器（`tool-runner`）、核心注册表（`tool-registry` / `default-registry`）等调度基建。
- **`fs/`** (文件系统)
  - 本地文件操作边界。包含 `read-file`, `write-file`, `edit-file`, `glob`, `list-directory`。
- **`sys/`** (系统与终端)
  - 操作系统层面的交互。包含 `bash` (命令执行), `terminal` (长时终端), `grep`, `git`。
- **`web/`** (网络通信)
  - 公网交互能力。包含 `web-fetch`, `web-search`, 及 HTML 解析等。
- **`agent/`** (多智能体协作)
  - Agent 之间的生杀与通讯权。包含 `spawn-agent` 引擎, `acp-agent-tool`, `task-tools` 等。
- **`mcp/`** (模型上下文协议)
  - 第三方 MCP Server 的客户端接入实现层。
- **`interaction/`** (人机交互)
  - 跨越 TUI 与 Core 的中断型工具，例如向用户提问 (`ask-user`) 或更新面板 (`tui-update-panel`) 等。
- **`utils/`** (公共基建)
  - 纯内部数据结构与帮助函数（如 `lru-cache`, `path-utils`），对大模型不可见。

## ⚠️ 扩展原则 (Architecture Rule)
未来新增工具时，**绝对禁止**在当前根目录直接创建 `.ts` 扁平文件。
必须先评估其业务边界并归入对应的领域子目录中。若属于全新领域（如数据库 `db/`），需新建对应的领域文件夹。
