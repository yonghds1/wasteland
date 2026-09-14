# feat(provider): OpenAI-compatible reasoning 原样回传（round-trip）

## 背景（实测根因，勿重新推导）

2026-09-12 用户全局 link 版 TUI 实测：`opencode-go`（`https://opencode.ai/zen/go/v1`）+ `deepseek-v4.1-flash`（思考模型），多轮工具循环在 turn2 step3 被上游拒绝：

> `invalid_request_error: The reasoning_content in the thinking mode must be passed back to the API.`

根因：`src/providers/openai.ts:305-316` 把流式 `reasoning_content`/`reasoning`/`thought` delta 折叠进 `<think>…</think>` 正文文本后**字段丢失**；`message-builder.ts:74-79` 重建历史时只剩 `content`，无法满足 DashScope 系"思考字段必须原样带回"的硬性要求。Anthropic 原生线（`claude.ts` thinking block + signature）同类问题**不在本任务范围**（二期）。

## Goal

OpenAI-compatible 线上实现"字面回传"契约：**上游在这条 assistant 消息上发过什么 reasoning 字段，续传历史时就用同名原字段、原值带回去；没发的绝不凭空造**。换任何 OpenAI 兼容厂商/网关/模型不需要重新适配、重新测试。

## Requirements

### R-1 接收侧：按源字段名累积 reasoning
`openai.ts` 流解析：探测 delta 中 `reasoning_content` / `reasoning` / `thought` 时，记录**实际命中的字段名**并将增量字符串单独累积（现有 `<think>` 拼接与 `emitChunk` 行为**保持不变**，UI/transcript 渲染零改动）。

### R-2 事件与存储：透传不解释
- `ProviderStreamEvent.assistant_message`（`provider-types.ts:52`）附带可选 `reasoning?: { field: string; content: string }`。
- `SessionMessageRecord`（`core/runtime/event-types.ts:50`）加同名可选字段；`createAssistantRecord`（`core/session/session-records.ts:44`）透传。
- 无 reasoning 的消息、旧会话记录（字段缺失）→ 序列化结果与今天逐字节一致（默认行为零回归）。

### R-3 回传侧：原 key 原值放回
`message-builder.ts` 历史重建：assistant 消息带 `reasoning` 时 `push({ role, content, [reasoning.field]: reasoning.content })`。仅 assistant 角色；user/system/tool 不造。
**范围扩展（2026-09-13 用户拍板 B，经失败会话 transcript 实证）**：报错请求含两类缺 reasoning 的 assistant 消息——① turn-1 最终消息（`history` message 记录）② turn-2 中间步的 tool_call（`history` tool_call 记录 **与** `state.toolResults` 的 section-3 重建，二者并存）。故数据链全面补齐：`ProviderStreamEvent.tool_call`/`assistant_message`、`SessionToolCallRecord`、`TurnToolResult` 都携带 `reasoning?: {field, content}`；`message-builder` 两条历史分支 + intra-turn section-3 都按原字段回传。同一 step 多 tool_call 合并进一条 assistant 消息时只挂一次（按字段名判重）。`claude.ts` 的 `convertToClaudeMessages` 仅读 role/content/tool_call_id，动态 reasoning key 自然丢弃 → 二期 Non-goal 不受影响。

### R-4 错误自愈：一发入魂的例外处理
`openai.ts` 请求失败且错误文案命中 reasoning/thinking 类 `invalid_request_error`（大小写不敏感，含 `reasoning_content` 子串）时：**一次性**自动丢弃本次请求要回传的全部 reasoning 字段重试一次；成功则在**进程内**（per provider 实例）记住"该端点停回传"，后续请求不再带。解决"发了但拒收回传"的较真厂商，避免人工逐厂测试。
- 若上游报"必须回传而我们没带"（旧会话续聊）：不做假重试（数据已丢，造不出来），错误文案原样透传即可。

### R-5 测试防线
- `message-builder` 单测：带/不带 `reasoning` 的 assistant 历史序列化对比（key 名、值、旧记录零回归、user 消息不造字段）。
- `openai.ts` 流解析单测：三个字段名变体各自命中时 `{field, content}` 正确；无 reasoning 流不产生该字段；UI chunk 序列与改前一致。
- 自愈路径单测：mock 400 + reasoning 文案 → 第二次请求 body 不含 reasoning 字段；进程内记住开关。
- 全量 `npm test` + `typecheck` + eslint 绿。

### R-6 端到端验证（用户环境实测）
构建后用户在 wasteland TUI（opencode-go + deepseek-v4.1-flash）复跑"用子 agent 分析项目"：turn ≥ 3 步工具循环不再出现 `reasoning_content must be passed back` 报错，spawn_agent 正常执行。**此项由用户在下一轮 link 环境实测确认**，AI 侧以日志/录屏无法自证。

#### 收口（2026-09-14，用户明确表示不再复测 → 以间接证据收口）

证据链（均可复查）：

1. 会话 `2026-09-13_100427_1416ba`（同配置、fix 后）跑出 **≥4 step** 工具循环（tool_calls 分布在 4 个 step），**全程零 reasoning 报错**；唯一 provider 错误是 `Duplicate value for 'tool_call_id'`——那是另一任务的 bug，已单独修复。
2. 该会话**确实走了 R-1 捕获路径**，不是"没触发所以没报错"。判据是 chunk 形状与 `2026-09-12_231650_f5100b`（**原始报错那次**，确定使用了 `reasoning_content`）逐一同构：

   | 日志 preview | 对应 `openai.ts` 代码 |
   |---|---|
   | `<think>The` / `<think>用户` | 首个非空 reasoning delta → `emitChunk(\`<think>${delta}\`)` |
   | `</think>\n你好` | 首个 content delta → `emitChunk(\`</think>\n${content}\`)` |
   | 光秃的 `</think>\n` | **tool_calls 分支** → 模型思考完直接发起工具调用 |

   第三种形状在 09-13 出现 **3 次**，恰是最需要回传 reasoning 的步骤。
3. 09-12 是在**第二次请求**就被拒（首轮 assistant 消息缺 reasoning）；09-13 同类循环跑满 4 步无此错，两次之间只有本次修复这一个变量。

**残余不确定性（诚实声明）**：日志不记录上游 delta 是否真的带 `reasoning_content` 键，"没报错"理论上也可能是网关那一次未强制要求。但 09-12 的错误文案证明该网关**会**强制要求，且没有任何网关行为变更的证据。据此判定 R-6 以间接证据收口，**而非**"用户实测通过"。

## Acceptance Criteria

- [x] 同一思考模型多轮工具循环（≥4 step）请求均成功 —— **以间接证据收口**（见 R-6「收口」节，用户不再复测）。
- [x] 回传报文含源字段名与完整原值（单测断言请求 body）：`message-builder-reasoning.test.ts`「history assistant message 带 reasoning → 原 key 原值放回」等；`openai-self-heal.test.ts` 直接断言**实际请求体**。
- [x] 不带 reasoning 的 provider 请求体与改前逐字节一致：`message-builder-reasoning.test.ts`「旧记录（无 reasoning）序列化与改前逐字节一致」「无 reasoning 的 toolResults → 仅 role/content/tool_calls」。
- [x] 旧 session（字段缺失记录）续聊行为与今天一致，不炸不造：同上「逐字节一致」+「reasoning.content 为空串时不回传（绝不凭空造上游没发过的字段）」。
- [x] 自愈路径：mock「拒收回传」端点 → 自动去字段重试成功并记忆（`openai-self-heal.test.ts`，含「要求多带」不重试、重试失败不落记忆等反向用例）。
- [x] `npm test`（28 个 reasoning 用例全绿、全量 1522 passed）/ `typecheck` 全绿；
      eslint 无新增（`src/tools/agent/spawn-agent/sidecar.test.ts:73` 的 1 个 error 为既有、本次未触碰该文件）。

## Non-goals

- Anthropic 原生 thinking block + signature 保真（二期，`claude.ts` 不碰）。
- transcript 存储格式重构 / `<think>` 显示层改动。
- reasoning token 成本的截断策略（回传全文，缓存命中率高，暂不管）。
- 其他 provider（claude.ts、local.ts）的类似改造。

## 执行顺序

R-1 → R-2 → R-3（数据链打通，跑 R-5 前两个测试）→ R-4（自愈）→ R-5 全量门禁 → build:no-bump 刷新 dist（link 环境即时生效）→ 用户实测 → commit。

## 风险

- transcript 里 `content` 与 `reasoning.content` 存两份思考文本：可接受（会话文件增大有限，语义清晰换实现简单）；若后续要瘦身，二期合并处理。
- 自愈"重试一次"须防递归：仅一次、带开关记忆。
