# Plan Phase 2 Agent Tool Runtime

## Goal

在已经落地的 Phase 1 runtime 骨架之上，定义并实现一个最小可运行的 agent tool runtime，让 CLI 不只会流式回复文本，还能通过统一事件流发起工具调用、经过权限判断、执行工具并记录 transcript。

## What I already know

* 当前仓库已经有 `commands -> runtime -> providers -> ui -> session` 的 Phase 1 骨架。
* `chat` 的 `--message`、`stdin`、交互模式已共用同一条 runtime 路径。
* 当前 provider 只有 `local`，还没有真实模型 provider、tool runtime、MCP、resume。
* 项目偏好是：天然流式链路尽量用 RxJS 建模，但不强行 Observable 化简单同步转换。
* 官方通用做法基本一致：
  * tool calling 是多步循环：模型返回 tool call，应用执行工具，再把结果送回模型。
  * 权限控制应独立于工具实现本身，至少要区分允许、询问、拒绝。
  * MCP 把 `tools`、`resources`、`prompts` 作为不同能力对待，不应在本地 tool contract 尚未稳定前就提前耦合进去。

## Assumptions (temporary)

* Phase 2 先做本地 tool runtime 和 permission gate，不在这一阶段接入 MCP。
* Phase 2 先建立统一 tool contract，即使当前 provider 仍是 `local`，也要让 runtime 能表达 tool call / tool result / permission events。
* Phase 2 先实现最小内建工具集合和权限判定骨架，再决定真实 provider 如何产出 tool call。

## Open Questions

* 本轮先不阻塞在真实 provider 上，先默认由本地/测试路径驱动 tool runtime。

## Research References

* [`research/common-practices.md`](./research/common-practices.md) — 官方资料对 Phase 2 范围的支持：tool loop、permission mode、MCP 能力边界。

## Requirements (evolving)

* 定义统一的 tool contract：
  * tool call
  * tool result
  * tool error
  * tool metadata / risk level
* 定义最小 permission gate：
  * allow
  * ask
  * deny
* 为 runtime 扩展新的事件阶段，至少覆盖：
  * tool_call_requested
  * permission_decision
  * tool_started
  * tool_result
  * tool_failed
* 让 tool 与 permission 设计能被 transcript 持久化。
* 保持 `commands/` 薄，不把工具编排塞回 command handler。
* 为未来真实 provider 和 MCP 保留扩展点，但本阶段不实现它们。

## Acceptance Criteria (evolving)

* [x] 仓库中存在独立的 `src/tools/` 契约文件，而不是把工具类型散落在 runtime 中。
* [x] 仓库中存在独立的 `src/runtime/permission-gate.ts`，权限判断不与具体工具实现耦合。
* [x] runtime 事件模型能表达最小工具调用生命周期。
* [x] 至少有一条可测试路径能覆盖“请求工具 -> 权限判断 -> 产出结果/失败”。
* [x] transcript 模型已为工具与权限事件预留或落地记录结构。
* [x] `npm run check` 通过。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 真实 OpenAI / Anthropic provider 接入
* MCP client / server 集成
* resume / sessions 命令
* 多智能体编排
* 复杂 planner / autonomous loop

## Technical Notes

* 当前相关实现：
  * `src/runtime/agent-loop.ts`
  * `src/runtime/event-types.ts`
  * `src/runtime/permission-gate.ts`
  * `src/runtime/tool-dispatch.ts`
  * `src/providers/provider-types.ts`
  * `src/providers/local.ts`
  * `src/tools/bash.ts`
  * `src/tools/default-registry.ts`
  * `src/tools/read-file.ts`
  * `src/tools/tool-types.ts`
  * `src/tools/tool-registry.ts`
  * `src/tools/tool-runner.ts`
  * `src/ui/terminal-renderer.ts`
* 当前相关文档：
  * `docs/architecture/agent-cli.md`
  * `docs/architecture/runtime-boundaries.md`
  * `docs/project-structure.md`
  * `docs/implementation/phase-1-agent-runtime.md`
  * `docs/implementation/phase-2-agent-tool-runtime.md`
* 本阶段对应 spec：
  * `.trellis/spec/backend/runtime-contracts.md`
  * `.trellis/spec/backend/tool-runtime-contracts.md`

## Implementation Outcome

本阶段第一批骨架已经落地：

* `src/tools/tool-types.ts`
* `src/tools/tool-registry.ts`
* `src/tools/tool-runner.ts`
* `src/runtime/permission-gate.ts`
* `src/runtime/tool-dispatch.ts`
* `src/runtime/event-types.ts` 的工具/权限事件扩展
* `src/tools/bash.ts`
* `src/tools/read-file.ts`
* `src/tools/default-registry.ts`
* `src/providers/local.ts` 对 `/read <path>` / `/bash <command>` 的 tool-call 演示路径
* `src/commands/chat.ts` 的 `--permission-mode` 选项
* `test/tool-runtime.test.js`
* `test/cli.test.js` 的主 chat 路径工具调用测试

当前边界结果：

* 工具合同已经独立于 runtime main loop 定义。
* 权限判断已经独立成可复用的 gate，不耦合具体工具实现。
* transcript 已能记录 `tool_call`、`permission`、`tool_result`。
* `local` provider 已经能通过 `/read <path>` 和 `/bash <command>` 走通主 `chat` loop 的工具调用路径。
* CLI 已经暴露 `--permission-mode`，可演示 `default` 与 `bypass_permissions`。
* 当前已有 `read-file` 和 `bash` 两个真实内建工具；写入类工具仍未实现。

## Verification

已执行并通过：

* `npm run typecheck`
* `npm test`
* `npm run check`
