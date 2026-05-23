# Phase 2 实施方案：工具运行时与权限闸门

## 目标

在已经完成的 Phase 1 runtime 骨架之上，把 `rx-cli` 从“能按统一路径聊天”的 CLI，推进到“能安全执行工具动作”的 agent runtime。

---

## 为什么先做这一层

对于类似 Claude Code 的智能体 CLI，真正的分水岭不是“接了哪个模型”，而是：

- 能否让模型或 runtime 发起工具调用
- 能否在执行前经过明确的权限判断
- 能否把工具生命周期记录进事件流和 transcript

如果跳过这一层，后面即使接入真实 provider，系统仍然只是聊天 CLI，而不是 agent CLI。

---

## 本阶段范围

Phase 2 应引入：

- tool contract
- tool registry / tool runner 骨架
- permission gate
- tool lifecycle runtime events
- transcript 中的工具与权限记录
- 至少一条可测试的工具执行路径

Phase 2 暂不引入：

- 真实 OpenAI / Anthropic provider
- MCP client / server 集成
- resume / sessions 命令
- 多智能体编排

---

## 计划交付物

### Tools

- `src/tools/tool-types.ts`
- `src/tools/tool-registry.ts`
- `src/tools/tool-runner.ts`
- 初始内建工具骨架，例如：
  - `src/tools/bash.ts`
  - `src/tools/read-file.ts`
  - `src/tools/edit-file.ts`
  - `src/tools/git.ts`

### Runtime

- `src/runtime/permission-gate.ts`
- `src/runtime/event-types.ts` 的工具事件扩展
- 视实现需要新增：
  - `src/runtime/tool-dispatch.ts`

### Tests

- 围绕 permission gate 的测试
- 围绕最小工具执行路径的测试

---

## 推荐顺序

1. 先定义 tool contract。
2. 再定义 permission gate。
3. 扩展 runtime event model 和 transcript record。
4. 接最小 tool registry / runner。
5. 用本地/测试路径打通一条工具调用链。
6. 再考虑真实 provider 如何产出 tool call。

---

## 验收标准

- 仓库中存在独立的 tool contract。
- 仓库中存在独立的 permission gate。
- runtime 能表达最小工具生命周期。
- transcript 能记录工具和权限事件。
- 至少一条测试路径覆盖工具执行主链路。

## 当前实现状态

本阶段第一批骨架已经落地：

- `src/tools/tool-types.ts`
- `src/tools/tool-registry.ts`
- `src/tools/tool-runner.ts`
- `src/runtime/permission-gate.ts`
- `src/runtime/tool-dispatch.ts`
- `src/runtime/event-types.ts` 的工具/权限事件扩展
- `src/tools/bash.ts`
- `src/tools/read-file.ts`
- `src/tools/default-registry.ts`
- `src/providers/local.ts` 对 `/read <path>` / `/bash <command>` 的本地 tool-call 演示路径
- `src/commands/chat.ts` 的 `--permission-mode` 选项
- `test/tool-runtime.test.js`
- `test/cli.test.js` 的主 chat 路径工具调用测试

当前仍未落地：

- 更多真实内建工具实现
- 写入类工具
- 更通用的 provider 产出 tool call
- MCP 接入

## 当前支持的 `chat` 输入语法

说明：

- 下表描述的是**当前仓库里已经实现**的 `chat` 输入语法。
- 这些语法目前由 `local` provider 解释，主要用于开发、测试和架构验证。
- 它们属于**当前演示约定**，不是已经冻结的长期稳定 DSL；未来接真实 provider 后，触发方式可能继续演进。

| 输入形式 | 示例 | 当前触发路径 | 默认权限行为 | 当前结果 |
|----------|------|--------------|--------------|----------|
| 普通文本 | `你好` | 普通 assistant 回复 | 不涉及工具权限 | 输出 `assistant_chunk` / `assistant_message` |
| 读文件命令 | `/read package.json` | `read-file` 工具 | `default` 下直接 `allow` | 输出工具请求、权限决策、开始执行、工具结果 |
| 执行命令 | `/bash pwd` | `bash` 工具 | `default` 下为 `ask`，因此当前会阻断 | 输出工具请求、权限决策、失败事件 |
| 执行命令 + 放行模式 | `/bash pwd` 配合 `--permission-mode bypass_permissions` | `bash` 工具 | `bypass_permissions` 下 `allow` | 输出工具请求、权限决策、开始执行、工具结果 |
| 交互帮助命令 | `/help` | UI 本地命令 | 不进入权限系统 | 输出当前交互命令帮助，不进入 runtime |
| 工具语法提示 | `/tools` | UI 本地命令 | 不进入权限系统 | 输出当前本地工具语法，不进入 runtime |
| 清屏命令 | `/clear` | UI 本地命令 | 不进入权限系统 | 清空终端并重绘交互头部 |
| 退出命令 | `/exit` / `/quit` | UI 本地命令 | 不进入权限系统 | 结束交互会话 |

补充约束：

- `/read` 当前要求相对路径位于当前工作目录内。
- `/bash` 当前要求非空命令文本。
- `--permission-mode` 当前支持：
  - `default`
  - `accept_edits`
  - `bypass_permissions`

## 当前交互模式样式

当前交互模式已经先做了一版更接近 Codex 的终端样式：

- 提示符改为更轻的 `> `
- assistant 回复在交互模式下显示为 `rxc` 标签 + 正文块
- tool / permission 事件显示为单独的状态行
- `/help`、`/tools`、`/clear` 由 UI 层直接处理，不再被当作普通聊天文本

说明：

- 这是一版先行样式，用于把交互体验从“调试输出”推进到“可用终端界面”。
- 当前只作用于交互模式；单次输入和 stdin 路径仍保留现有测试友好的经典输出。

## 已验证命令

- `npm run typecheck`
- `npm test`
- `npm run check`

---

## 实施说明

- 天然流式的链路继续优先用 RxJS 建模，例如：
  - provider -> tool request
  - permission decision
  - tool result
  - renderer update
- 不要把权限判断塞进单个工具实现里。
- 不要在 command handler 里直接拼装 tool call / tool result。
- MCP 是后续扩展层，不要让它反向主导本地 tool contract。

---

## 参考

- Claude Code Permissions
- Claude Code Permission Modes
- OpenAI Tools / Function Calling
- MCP Server Concepts / Tools / Resources

具体研究摘要见：

- `.trellis/tasks/05-23-phase-2-agent-tool-runtime/research/common-practices.md`
