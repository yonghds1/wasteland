# fix(runtime): 工具失败重试导致重复 tool_call_id 被上游拒收

## 背景（实测根因，勿重新推导）

2026-09-13 会话 `2026-09-13_100427_1416ba`（opencode-go + deepseek-v4.1-flash），3 个并行 `spawn_agent` 各卡满 `childAgentTimeout` 后，整个 turn 被上游拒绝：

> `[invalid_request_error] Duplicate value for 'tool_call_id' of call_01_1IQvk97GkfDjDd4XvWwW6704 in message[2]`

### 完整链路（已证实）

1. `event-forwarder.ts` 的 `invokeFinish` 失败分支：先 `subscriber.next({type:'tool_failed'})` 发出**第 1 条**（原始消息 `子 Agent 执行超时 (timeout: 600000ms)`），再 `subscriber.error(...)` 触发外层。
2. `spawn-agent/index.ts` 的 `catchError` 把该 error 转成**第 2 条** `tool_failed` 事件（包装消息 `子 agent analyst 失败 N 次: ...`）。
3. `turn-executor.ts` 的 `historyPart$` 循环里，`collected` 已被 `tap` 预过滤为
   `tool_result | tool_failed`（类型标注为 `RuntimeEvent & { type: 'tool_result' | 'tool_failed' }`），
   循环体写成 `if (event.type === 'tool_result') { 记录 } else { 记录 }`。
   因此**同一 callId 的两条 `tool_failed` 各被记一次**，`state.toolResults` 出现重复 callId。
   （注：该 `else` 语义上等价于 `else if (tool_failed)`，**不是**宽泛兜底——此点经 09-14 复核修正。）
4. `state.toolResults` 因此出现重复 `callId`；`buildMessages` 的 section-3 把它们全部塞进一条 assistant 消息的 `tool_calls` + 逐条 tool 消息，生成重复 `tool_call_id`。
5. 上游拒绝整个 turn。

### 算术实证

| 项 | 值 |
|---|---|
| 会话文件 `tool_result` 记录数 | 10 |
| 日志 `turn.advance` / `provider.start` 声称的 `toolResults` | 13 |
| 差值 | **3** = 三个 `spawn_agent` 各多记一条 |

## Goal

保证**同一 `callId` 在 `state.toolResults` 中最多出现一次**，因此 `buildMessages` 产出的报文不含重复 `tool_call_id`；且失败工具在续传历史里仍与 `tool_calls` 一一对应（不能因为去重把工具结果整条丢掉）。

## Requirements

### D-1 失败事件只产出一条最终结果
一个 tool_call 无论经历几次重试/几个错误来源，**父侧只应收到一条终结事件**（`tool_result` 或 `tool_failed`）。

候选修法（二选一，实施时定）：
- (a) `invokeFinish` 失败分支不再 `next(tool_failed)`，只 `error()`，把终结事件的产出权收归 `catchError` 一处；
- (b) `recordToolResultSorted` 按 `callId` 去重（同 callId 以最后一条为准）。

倾向 (a)：它治的是"两个产出点"这个根因；(b) 只是下游兜底。若 (a) 会破坏现有 event-forwarder 测试或多 agent 进度展示，则退回 (b) 并把 (a) 记为后续。

### D-2 去重不得改变成功路径
正常的单条 `tool_result`、`blocked`、`error` 路径逐字节不变。

### D-3 回归测试
- 单测：同一 callId 先后进入两条失败事件 → `state.toolResults` 只有一条。
- 单测/集成：`buildMessages` 对含重复 callId 的输入不产出重复 `tool_call_id`（按 D-1 选定的层次断言）。
- 若走 (a)：补一条 forwarder/retry 测试，断言超时重试后父侧只收到一条终结事件。

## Acceptance Criteria

- [ ] 复现用例：构造「同一 callId 两条 tool_failed」→ 修复后 `state.toolResults` 长度不再多算。
- [ ] `buildMessages` 输出中不存在重复 `tool_call_id`（含 13 条 toolResults 的回归场景）。
- [ ] 成功 / blocked / 单条失败路径的报文与改前逐字节一致。
- [ ] `npm test` / `typecheck` / lint 全绿。

## Non-goals

- 子 agent 权限提问无人应答（那是 `09-14-subagent-permission-hang`；本任务是它的下游后果，但**独立可达**——任何工具只要发两条 `tool_failed` 都会中毒）。
- 同一批次 `concat(spawnStreams$, otherStreams$)` 导致本地工具排在子 agent 之后的调度行为（已确认为设计行为，仅在需要的任务里讨论）。
- reasoning 回传（`09-13-reasoning-roundtrip`）。

## 风险

- 选 (a) 需确认 `subscriber.error()` 之后 `retry` 的 `count` 语义与既有测试一致；`maxRetries=0` 时 `retry({count:0})` 不重试，error 直达 `catchError`。
- 若某调用方依赖 `invokeFinish` 的 `next(tool_failed)` 做即时 UI 反馈，需要保留等价反馈（走 `catchError` 后时序差异极小，但要在 check 阶段确认）。

## 已知残余风险（本任务不修，记录在案）

- **`maxRetries > 0` 时同一 callId 会写入多条 `tool_result` 记录**：每次重试 attempt 都会跑一遍 forwarder，失败时 `invokeFinish` 各写一条父 session 记录。`maxRetries` 是**文档化的用户可配开关**（`docs/user-guide/multi-agent.md`、`settings-types.ts`），当前用户配置未设故走默认 0，但一旦设为 >0，`/resume` 经 history 分支重建消息时会再现重复 `tool_call_id` —— 属真实风险而不仅是理论风险。根治需把「记录只由最终 attempt 写」做进 `invokeFinish`（它当前拿不到 attempt 序号），属独立改动。
  终结**事件**侧已不受影响：复核新增的 `maxRetries=2` 用例断言重试耗尽后父侧仍恰好 1 条终结事件。
- **产出点唯一性是真正的防线，不要靠收紧 `turn-executor`**：复核确认 `collected` 已预过滤，收紧 `else` 只是换写法、不增加安全性，反而会在未来出现第三种终结类型时变成静默丢弃。
- 相关但反向的同类缺口（**丢掉**终结事件，非重复）：`ask-user` 的 `result$`（`tool-dispatch.ts`）若 `requestInput()` 抛错，会走 error 而非产出终结事件。归到 `09-14-subagent-permission-hang` 一并考虑。


## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
