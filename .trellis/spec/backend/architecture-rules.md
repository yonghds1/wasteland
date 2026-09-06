# Wasteland 架构与模块边界规范 (Architecture Rules)

> ⚠️ **所有 AI Agent (Claude, Gemini, Cursor 等) 必读**：在进行代码修改前，请严格遵守本规范，避免破坏项目边界。

## 1. 核心架构演进：从单体走向领域划分
项目目前正经历从单体 `core/runtime` 到多领域（Domain）拆分的重构。所有新的核心层代码，必须放入对应的领域目录：

- **`src/core/engine/`**：调度与控制流（`agent-loop.ts`, `tool-dispatch.ts`, `turn-state.ts`）
- **`src/core/memory/`**：上下文与短期工作记忆（`context-manager.ts`, `context-compaction.ts`）
- **`src/core/session/`**：会话持久化与长情景记忆（`session-manager.ts`, `session-records.ts`）
- **`src/cli-parser/` (或类似外层)**：CLI 解析逻辑（原 `core/shared/command-manager.ts` 等），**严禁将其放入 `core` 的深层目录中**。

## 2. 通用智能体记忆架构 (Generic Agent Memory)
在后续扩展中，记忆模块必须遵循“多租户隔离”与“接口依赖”：
- **隔离性**：记忆存储必须支持按 `agentId` 和 `sessionId` 隔离，严禁写死为全局单例。
- **接口化**：定义 `IAgentMemory` 与 `IMemoryStore` 接口，以便未来能以**插件化 (Provider)** 的形式平滑接入外部记忆库（如 Mem0）或本地向量库。
- **双轨制认知**：
  - **动态会话记忆**：由 Agent 自身的 Session / Context 模块管理（自成体系，JSONL落盘）。
  - **静态项目记忆**：依赖 `.trellis/spec/`，作为 Agent 的元知识库。

## 3. 工具集的分包隔离 (`src/tools/`)
不要在 `src/tools/` 下继续堆砌扁平文件，按功能域建立子目录：
- `tools/core/`：工具注册表、接口定义
- `tools/builtin/`：基础 Shell/文件工具
- `tools/mcp/`：MCP 通信与资源注册工具
- `tools/web/`：网络抓取与搜索工具

## 4. UI 呈现层与底层 IO 剥离
- `src/ui/` 定位为“CLI 纯终端文本适配层”，未来应重命名为 `src/adapters/cli`。
- `src/tui/` 定位为“基于 React/Ink 的富交互界面”。
- 两者必须依赖 `core/ports` 中定义的输入/输出接口，禁止直接向 `core/runtime` 注入硬编码的终端逻辑。

## 5. 测试文件组织 (Test Placement)
统一遵循：**就近原则与 `__tests__` 目录结合**。
- `Vitest` 测试文件存放在所在模块的 `__tests__/` 子目录中（如 `src/commands/__tests__/chat.test.ts`）。
- 严禁出现同目录下既有 `__tests__` 又有外露 `*.test.ts` 文件的精神分裂情况。新加代码请参考 `CLAUDE.md` 中的测试约定。
