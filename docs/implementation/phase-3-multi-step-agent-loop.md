# Phase 3 实施方案：多步 Agent Loop 与调试追踪

## 目标

在 Phase 2 已经具备工具合同、权限闸门和最小工具执行路径之后，把 `joe` 从“单步工具演示 CLI”推进到“真正的多步 agent CLI”。

这一阶段要解决的核心问题不是再多加几个工具，而是补齐下面这个闭环：

```text
用户输入
  -> provider 推理
  -> tool call
  -> permission gate
  -> tool result
  -> provider 继续推理
  -> assistant 最终回答
```

同时，这一阶段必须把调试日志纳入正式设计，避免后面在 runtime、provider、tools 中散落 `console.log`。

---

## 为什么先做这一层

当前仓库已经具备：

- 统一的 `chat` 主链路
- `tool_call -> permission -> execute -> transcript`
- 交互模式基础渲染

但当前仍有一个关键缺口：

- provider 一旦发出 `tool_call`，runtime 执行完工具后，**不会继续把结果喂回 provider**
- 因此当前系统仍然是“单步 reply / 单步 tool dispatch”，不是多步 agent loop

如果不先补这层，后面即使接真实 provider，也只能得到“会调一次工具”的 CLI，而不是类似 Claude CLI 的可持续智能体循环。

---

## 本阶段范围

Phase 3 建议引入：

- `TurnState`：单轮运行态
- step-based provider contract
- tool result re-entry
- 多步 Rx agent loop
- debug trace 事件模型
- debug trace 的终端展示与可选持久化

## 当前实现状态

当前第一批已经落地：

- `src/runtime/turn-state.ts`
- `src/runtime/debug-events.ts`
- `src/runtime/agent-loop.ts` 的多步 step loop
- `src/providers/provider-types.ts` 的 step-based contract
- `src/providers/local.ts` 的 tool-result 回灌后最终回答
- `src/ui/debug-renderer.ts`
- `src/commands/chat.ts` 的 `--debug`
- `test/cli.test.js` 的 stderr trace 断言

当前这批实现已经做到：

- `/read <path>` 和 `/bash <command>` 不再停在 tool lifecycle，而是会继续给出最终 assistant 回复
- `--debug` 会把 step 级 trace 输出到 `stderr`
- 正常回复和工具结果继续走 `stdout`

当前仍未落地：

- `--debug-format jsonl`
- trace 文件持久化
- 真实 provider 接入
- `sessions` / `resume`

Phase 3 暂不引入：

- `sessions` / `resume` 命令
- MCP client / server
- 多智能体编排
- 复杂 planner / long-running autonomous mode

---

## 核心模型

### 1. `TurnContext`

继续保留现有 `TurnContext` 的职责：

- 描述“进入本轮时的只读上下文”
- 主要给 provider 读取起点信息

它不负责承载本轮执行过程中新增的工具结果或 chunk 累积。

### 2. `TurnState`

新增 `TurnState` 作为 `agent-loop` 内部运行态，用来表达“一轮对话进行到现在发生了什么”。

建议最小结构：

```ts
type TurnState = {
  sessionId: string;
  turn: number;
  cwd: string;
  input: ChatInputTurn;
  history: readonly SessionMessageRecord[];

  step: number;
  status: "running" | "completed" | "failed";

  assistantChunks: string[];
  finalMessage?: string;

  toolCalls: ToolCall[];
  toolResults: Array<{
    callId: string;
    toolName: string;
    status: "success" | "error" | "blocked";
    output?: string;
    error?: string;
  }>;
};
```

边界约束：

- `history` 表示本轮开始前的历史消息快照
- `assistantChunks`、`toolCalls`、`toolResults` 只表示本轮新增数据
- `TurnState` 是 runtime 内部状态，不直接作为 transcript 落盘格式

### 3. `RuntimeEvent`

`RuntimeEvent` 继续承担对外可渲染、可落 transcript 的主事件流职责。

也就是说：

- UI 主渲染吃 `RuntimeEvent`
- transcript 主记录围绕 `RuntimeEvent` 相关结果落盘
- agent loop 内部如何推进，不要直接暴露成用户侧日志噪音

### 4. `DebugTraceEvent`

新增独立的 debug trace 事件模型，不和普通 `RuntimeEvent` 混成一个万能 union。

建议最小结构：

```ts
type DebugTraceEvent = {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: "session" | "turn" | "provider" | "tool" | "ui";
  phase: string;
  message: string;
  data?: Record<string, unknown>;
};
```

设计原则：

- debug trace 用于调试、排障、开发观察
- transcript 仍然只保留会话与工具语义记录
- debug trace 可以单独渲染，也可以单独写文件

---

## Provider 合同演进

当前 provider 合同更适合单步回复：

```ts
streamReply(context: TurnContext): Observable<ProviderStreamEvent>
```

多步 loop 更适合改为 step-based 形式，例如：

```ts
type ProviderStepInput = {
  context: TurnContext;
  state: TurnState;
};

interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

这样 runtime 和 provider 的职责会更清楚：

- runtime 负责 loop 和状态推进
- provider 负责“基于当前 state 执行一步推理”
- provider 不自己管理整轮 loop

这比把完整 agent 循环塞进 provider adapter 更符合当前仓库的边界设计。

---

## RxJS 落位方式

这一阶段继续遵守项目偏好：

- 天然流式链路用 RxJS
- 简单同步状态和纯数据结构保持普通对象/普通函数

推荐做法：

- `input$`：用户输入流
- `provider step`：`Observable<ProviderStreamEvent>`
- `tool dispatch`：`Observable<RuntimeEvent>`
- `debug trace`：`Observable<DebugTraceEvent>`

不建议：

- 把每个同步字段更新都包成 Observable
- 为了“全 Rx 化”把简单状态机写成不可读的 operator 套娃

实现风格建议：

- 用递归 step loop 或 `defer + concatMap` 的方式推进单轮
- 不要在一个超长 operator 链里同时塞状态推进、工具执行和渲染副作用

---

## 建议的 Loop 结构

一轮对话的推荐推进方式：

1. 为输入 turn 创建初始 `TurnState`
2. runtime 调用 provider 的 `runStep(...)`
3. provider 发出：
   - `assistant_chunk`
   - `tool_call`
   - `assistant_message`
4. runtime 根据事件推进状态：
   - chunk -> 追加到 `assistantChunks`
   - tool call -> 进入 `dispatchToolCall(...)`
   - final message -> 标记本轮完成
5. 如果得到 tool result / tool failed：
   - 把结果写回 `TurnState`
   - `step += 1`
   - 再次调用 provider `runStep(...)`
6. 直到产出最终 `assistant_message` 或触发失败/步数上限

建议同时加一个显式保护：

- `maxStepsPerTurn`

用途：

- 防止 provider/tool 进入死循环
- 调试时能直观看到“为什么这一轮被主动截断”

---

## 调试日志设计

### 目标

调试日志要满足三个要求：

1. 默认不干扰普通聊天输出
2. 打开后能按时间顺序直观看到 loop 在做什么
3. 不破坏脚本模式和测试模式的 stdout 语义

### 原则

- 普通回复继续走 `stdout`
- debug trace 默认关闭
- debug trace 打开后优先走 `stderr`
- 不在 runtime/provider/tool 中直接散落 `console.log`

### 建议展示层级

#### 1. 默认模式

只显示当前已有的用户可理解状态：

- `tool request`
- `permission`
- `tool start`
- `tool result`
- `assistant reply`

这类输出是“产品级状态”，不是开发级 trace。

#### 2. `--debug` 模式

在交互模式下，以低噪音单行 trace 显示关键内部步骤，建议使用固定标签，例如：

```text
trace step=1 provider.start provider=local history=6
trace step=1 provider.event type=tool_call tool=read-file call=tool-read-file-1
trace step=1 tool.result tool=read-file status=success ms=14
trace step=2 provider.start provider=local toolResults=1
trace step=2 provider.event type=assistant_message
```

展示要求：

- 单行、按时间顺序
- 标签固定宽度，便于扫描
- 颜色比主回复更弱，不抢占注意力
- 与 assistant 回复区分开，不混进正文块

#### 3. `--debug-format jsonl` 模式

给脚本化排查和测试使用，建议输出结构化 JSONL 到 `stderr` 或独立文件。

用途：

- 自动化测试断言
- 复盘复杂 turn loop
- 后续接真实 provider 时排查适配问题

建议字段至少包含：

- `timestamp`
- `sessionId`
- `turn`
- `step`
- `scope`
- `phase`
- `message`
- `data`

### 是否落盘

建议把 debug trace 和 transcript 分开：

- transcript：`.joe/sessions/<sessionId>.jsonl`
- trace：`.joe/traces/<sessionId>.jsonl`

原因：

- transcript 是用户会话语义记录
- trace 是运行诊断记录
- 两者生命周期、噪音级别、读取方式都不同

---

## 推荐文件落位

```text
src/
  runtime/
    agent-loop.ts
    debug-events.ts
    turn-state.ts
  providers/
    provider-types.ts
  ui/
    debug-renderer.ts
    terminal-renderer.ts
```

职责建议：

- `runtime/turn-state.ts`
  - 定义 `TurnState`
  - 定义状态推进辅助函数
- `runtime/debug-events.ts`
  - 定义 `DebugTraceEvent`
  - 提供格式化与基础创建函数
- `ui/debug-renderer.ts`
  - 只负责调试 trace 的终端展示
- `ui/terminal-renderer.ts`
  - 继续负责普通 runtime 事件渲染

---

## 推荐 CLI 面

第一批建议只加最小调试开关：

- `chat --debug`
- `chat --debug-format pretty`
- `chat --debug-format jsonl`

说明：

- `--debug` 是开关
- `--debug-format` 决定如何展示
- `pretty` 面向人看
- `jsonl` 面向脚本和测试

如果第一批想继续收敛，也可以先只做：

- `chat --debug`

并把输出格式固定为 pretty，把 jsonl 留到下一小步。

当前仓库已经先按这条收敛路径落地：

- 已实现：`chat --debug`
- 未实现：`--debug-format`

---

## 实施顺序建议

1. 新增 `TurnState` 与 `DebugTraceEvent` 模型
2. 把 provider contract 改成 step-based
3. 重写 `agent-loop.ts` 为多步 loop
4. 让 `local` provider 先跑通：
   - `/read <path>` -> tool result -> 最终 assistant_message
   - `/bash <command>` -> tool result/failed -> 最终 assistant_message
5. 增加 debug trace 渲染
6. 增加调试模式测试

---

## 验收标准

- runtime 能完成至少一轮“tool -> re-entry -> final answer”
- `local` provider 不再只会发一次 `tool_call`
- 默认输出不被调试日志污染
- 打开 `--debug` 后，可直观看到 step 级推进过程
- `npm test` / `npm run check` 继续通过

---

## 与后续阶段的关系

这一阶段完成后，后面的优先级建议是：

1. provider registry + 真实 provider 骨架
2. session index / `sessions` / `resume`
3. 更多写入类工具
4. MCP

先把 loop 闭环和 trace 能力做好，后续真实 provider、恢复会话和复杂工具面才不会建在不稳定地基上。
