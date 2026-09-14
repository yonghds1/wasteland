# fix(permission): 子 agent 权限提问无人应答导致 10 分钟超时

## 现象（实测，勿重新推导）

2026-09-13 会话 `2026-09-13_100427_1416ba`：主 agent 同批发起 3 个并行 `spawn_agent`，三个子会话**全部卡死**，满 `childAgentTimeout`(600000ms) 后超时。

子会话记录全部停在 bash 工具调用，**且没有 `permission` 记录**：

| 子会话 | 最后一条记录 |
|---|---|
| child-analyst | `tool_call bash` → 之后什么都没有 |
| child-researcher | `tool_call bash` → 之后什么都没有 |
| child-tester | `tool_call bash` ×2 → 连 `permission` 都没有 |

关键推理：`permission` 记录是在**用户回答之后**才写入的（`tool-dispatch.ts` 的 `confirmation$` 内）。没有该记录 ⇒ 子 agent 卡在**等待用户回答**，而不是卡在执行。

主会话日志在 `02:05:29`（子 agent 开始等）到 `02:15:26`（超时）之间**一行都没有**，与"静默等待"一致。

## 已排除的假设（节省后续调查）

- ❌ 事件被父侧丢弃 —— `turn-executor.ts` 用 `merge`/`concat` 全量转发；`event-forwarder.ts` 的 `translateChildEvent` 对 `user_input_requested` 原样 `return e`，且 `subscriber.next()` 是逐条实时发出。
- ❌ TUI 按 session 过滤事件 —— `useRuntimeEvents.ts` 的 reducer 不分 session。
- ❌ 两个 bridge 实例 —— `useRuntime.ts:76` 创建后经 `startAgentLoop` → `runAgentLoop` → 子 agent 全程同一个实例（`agent-loop.ts:230` 只在未传时才新建）。
- ❌ 计时变量跨并发共享 —— 那些变量在 `tool-dispatch.ts:224`，每次 dispatch 各自一份。

## 已确认的独立缺陷（顺带挖出，与本次现象未必同因）

`ChatInputBar.tsx` 的 `confirmAlways()`：

```ts
const confirmAlways = (): void => {
  if (!pattern || !gate?.addSessionRule) return;   // ← 静默返回，不调用 provideInput
  …
  bridge.provideInput('always');
};
…
if (inputChar === '2' || inputChar === 'a' || inputChar === 'A') {
  confirmAlways();
  return;                                          // ← 按键被吞，等待者永不 resolve
}
```

- `describeAllowPattern` 对 **`spawn_agent` / `ask-user` 按设计返回 `null`**（`permission-gate.ts:105`），所以在这两个工具的确认框上按 `a`/`2` → 按键被吞 + **等待者永远挂着直到超时**。
- 箭头键路径**知道**这件事（`moveSel` 里跳过索引 1），单一热键路径却不知道 —— UI 自身不一致。
- 相关：`spawn-agent/dispatch-handler.ts` 的 `askRequested$` **未填 `toolName`/`input`**（只有 `question` + `options`），卡片只能正则反推，`input` 恒为 undefined ⇒ 该路径必然 `pattern === null`。

## Requirements

### H-1 先钉死机制（不得跳过）
写**并发复现测试**，共享一个 `UserInputBridge` + 一个 gate，并发跑两个（或更多）`dispatchToolCall`（execute 风险级、`default` 模式），断言：

- 每个并发请求都能被一次回答推进（不会互相偷走回答、不会有人永远等不到）；
- 覆盖"TUI 侧 pending 卡片与 bridge 队列不匹配"的场景（如某一请求的事件未产生卡片时，回答仍应能推进队列）。

测试若**通过**，说明机制在 dispatch 层是好的，问题在 TUI 侧的状态配对（继续查 `state.permission.pending`/`queue` 与 `bridge.waiters` 的背离）；测试若**失败**，即钉死 root cause。

### H-2 修复静默吞键
`confirmAlways()`（以及 CLI 侧同类路径 `cli-input-adapter.ts`）在无 pattern 时**必须**做可见的降级而不是静默返回 —— 至少落到 `once`（`provideInput('yes')`）或在 UI 上明确禁用并提示。**绝不允许**出现"按键被吞 + 等待者不 resolve"。同时补齐 `askRequested$` 的 `toolName`/`input` 字段，让卡片不再依赖正则。

### H-3 不可等待无限期
等待用户回答时应有上限或可取消路径，避免子 agent 静默挂满 600s 才被发现。

## Acceptance Criteria

- [ ] 有并发复现测试，能显示修复前的失败与修复后的通过。
- [ ] 无 pattern 的确认框上按 `a`/`2` 不再出现"按键被吞且等待者不 resolve"（有测试断言队列被推进）。
- [ ] 子 agent 权限提问不再无应答到超时（用户实测或等价集成测试）。
- [ ] `npm test` / `typecheck` / lint 全绿。

## Non-goals

- 重复 `tool_call_id`（`09-14-duplicate-tool-call-id`）—— 那是本现象的下游后果，独立可达，分开修。
- 权限决策映射（`ask` + 同意 ⇒ `allow`）—— 已于 09-13 修复（`resolveConfirmedDecision`）。
- reasoning 回传（`09-13-reasoning-roundtrip`）。
- 同一批次 `concat(spawnStreams$, otherStreams$)` 的调度行为（已确认为设计行为）。

## 风险

- 复现测试可能因 RxJS 时序（`queueMicrotask` in `provideInput`）而不稳定；需要显式控制微任务推进。
- H-2 的"降级到 once"是否可接受需产品判断：静默放行与静默拒绝都不理想，可能需要在 UI 上明确呈"该工具不支持本会话记住"。
