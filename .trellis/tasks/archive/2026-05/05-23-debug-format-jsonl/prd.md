# debug-format jsonl

## Goal

为 `rxc chat --debug` 增加结构化 JSONL 输出格式，同时输出到 stderr 和文件，便于脚本化排查、自动化测试断言、以及后续真实 provider 接入时的适配问题诊断。

## What I already know

* 当前已有 `--debug` 选项，输出人类可读的 trace 到 stderr
* 当前 `DebugTraceEvent` 已包含完整结构化字段：`timestamp`, `sessionId`, `turn`, `step`, `scope`, `phase`, `message`, `data`
* 当前 `renderDebugTrace` 只支持 "pretty" 格式（人类可读）
* Phase 3 文档已规划 `--debug-format pretty|jsonl`
* 业界惯例：debug/trace 统一走 stderr，只有 Terraform 有 JSON debug 格式

## Requirements

* CLI 增加 `--debug-format` 选项，支持 `pretty`（默认）和 `jsonl`
* `jsonl` 格式每行输出一个 JSON 对象，结构直接映射 `DebugTraceEvent`
* **同时输出到 stderr 和文件**：
  * stderr：便于管道到 `jq` 等工具
  * 文件：`.rxc/traces/<timestamp>_<shortId>.jsonl`，便于持久化和复盘
* 保持向后兼容：`--debug` 单独使用时仍输出 pretty 格式到 stderr
* 自动创建 `.rxc/traces/` 目录（如不存在）

## Acceptance Criteria

* [x] `chat --debug --debug-format jsonl` 同时输出 JSONL 到 stderr 和文件
* [x] `chat --debug` 保持当前 pretty 格式输出（仅 stderr）
* [x] JSONL 输出可通过管道被 `jq` 等工具解析
* [x] trace 文件名格式为 `<timestamp>_<shortId>.jsonl`（如 `2026-05-23T14-30-00_abc123.jsonl`）
* [x] 测试覆盖 jsonl 格式输出和文件持久化

## Definition of Done

* Tests added/updated
* Lint / typecheck / CI green
* Docs updated if behavior changes

## Out of Scope

* 新的 debug 事件类型
* 真实 provider 接入
* 用户自定义 trace 文件路径（`--debug-out`）
* **session 文件命名改进**（独立任务）

## Technical Approach

### 文件结构

```
src/
  runtime/
    session-manager.ts  # 修改 session ID 生成：时间戳前缀
  ui/
    debug-renderer.ts   # 扩展支持 jsonl 格式
  config/
    paths.ts            # 增加 resolveDefaultTraceDir()
  commands/
    chat.ts             # 增加 --debug-format 选项
```

### Session ID 生成规则

```ts
// 格式: 2026-05-23T14-30-00_abc123
function generateSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const shortId = randomUUID().slice(0, 6);
  return `${timestamp}_${shortId}`;
}
```

### 实现步骤

1. `session-manager.ts` 修改 session ID 生成逻辑
2. `paths.ts` 增加 `resolveDefaultTraceDir()` 函数
3. `debug-renderer.ts` 扩展 `renderDebugTrace()` 支持 `format: 'pretty' | 'jsonl'`
4. `debug-renderer.ts` 增加 JSONL 文件写入逻辑
5. `chat.ts` 增加 `--debug-format` 选项并传递给 renderer
6. 增加测试覆盖

### 关键设计

```ts
// debug-renderer.ts
export async function renderDebugTrace(
  events$: Observable<DebugTraceEvent>,
  params?: {
    output?: Writable;
    format?: 'pretty' | 'jsonl';
    traceFile?: string;  // .rxc/traces/<timestamp>_<shortId>.jsonl
  },
): Promise<void>
```

## Decision (ADR-lite)

**Context**: 需要支持结构化 debug 输出，便于脚本化处理和持久化复盘；同时 session ID 纯 UUID 不易识别

**Decision**:
- JSONL 格式同时输出到 stderr 和文件
- Session ID 改为时间戳前缀格式：`<timestamp>_<shortId>`
- 类似 kubectl 的 `--alsologtostderr` 和 Terraform 的 `TF_LOG_PATH` 行为

**Consequences**:
- 用户无需额外参数就能获得持久化 trace
- session 和 trace 文件名按时间排序，易于识别最新
- stderr 仍可用于管道处理
- 增加文件 I/O，但对 debug 场景可接受

## Technical Notes

* 当前相关实现：
  * `src/runtime/debug-events.ts` — `DebugTraceEvent` 类型定义
  * `src/runtime/session-manager.ts` — session ID 生成（需修改）
  * `src/ui/debug-renderer.ts` — `renderDebugTrace` 函数
  * `src/commands/chat.ts` — `--debug` 选项
  * `src/config/paths.ts` — 路径解析函数

## Research References

* [`research/cli-debug-output-conventions.md`](./research/cli-debug-output-conventions.md) — 业界 CLI debug 输出惯例
* Phase 3 文档：`docs/implementation/phase-3-multi-step-agent-loop.md`
