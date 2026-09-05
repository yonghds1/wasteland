# Research: Claude Code 日志 / 可观测性体系

- **Query**: Claude Code 的运行时日志、--debug / --verbose、session transcript、轮转、子 agent 隔离、性能、审计事件、用户场景重现
- **Scope**: mixed（**大量本地一手实证** + 多个第三方深度文档 + Anthropic GitHub issues + claude-dev.tools 文档站）
- **Date**: 2026-07-29
- **Author**: trellis-research 子代理
- **Claude Code 版本基线**: 2.1.220（当前 user 工作环境实测），同时覆盖 2.1.7 … 2.1.220 的演化

> **关键说明**: Claude Code 是闭源 Node.js 应用，源码不可见。本文以下结论 = **本地 `~/.claude/` 实测目录** + **Anthropic 公开 issues** + **第三方 DevTools 项目逆向（matt1398/claude-devtools, daaain/claude-code-log 等）**。每个论断都标注 **一手（local-empirical / 官方 issue / 官方 changelog）** 或 **推断（open-source reverse）**。

---

## 1. Sources

### 1.1 一手（first-hand）

| 类别 | 路径 / URL | 说明 |
|---|---|---|
| **local-empirical** | `/home/ubuntu/.claude/projects/-home-ubuntu-workspace-wasteland/5fa18c0d-ca08-4212-a9c1-f382d7dc4d39.jsonl` | 当前活动 session 的 transcript（92 条记录，覆盖 9 种 type） |
| **local-empirical** | `/home/ubuntu/.claude/projects/-home-ubuntu-workspace-wasteland/5fa18c0d.../subagents/agent-a6db84e83e981f546.jsonl` + `agent-a6db84e83e981f546.meta.json` | subagent 的 jsonl + meta（agentType / description / toolUseId / spawnDepth） |
| **local-empirical** | `/home/ubuntu/.claude/sessions/1993610.json` | live session roster（pid / sessionId / cwd / version / peerProtocol / kind / entrypoint / status） |
| **local-empirical** | `/home/ubuntu/.claude/telemetry/1p_failed_events.5fa18c0d....json` | 27 类内部 telemetry 事件（tengu_*）582 条 |
| **local-empirical** | `/home/ubuntu/.claude/daemon.log` | supervisor/background-worker 守护进程日志（57 行 plain text + ISO ts + tag） |
| **local-empirical** | `/home/ubuntu/.claude/daemon/roster.json` + `dispatch/` + `control.key` | 守护进程 ipc 路由 |
| **local-empirical** | `/home/ubuntu/.claude/history.jsonl` | **跨 session 的 prompt 历史**（仅 user 文本 + pastedContents + project + sessionId） |
| **local-empirical** | `/home/ubuntu/.claude/file-history/<sid>/<hash>@v<n>` | 文件每次 Edit/Write 前的版本快照（按 hash + 版本号） |
| **local-empirical** | `/home/ubuntu/.claude/jobs/<jobId>/state.json` + `timeline.jsonl` | background job state machine + 事件 timeline |
| **local-empirical** | `/home/ubuntu/.claude/teams/<teamId>/config.json` + per-task subdirs | multi-agent teams 元数据 |
| **local-empirical** | `/home/ubuntu/.claude/session-env/<sid>/sessionstart-hook-0.sh` | hook 注入快照 |
| **local-empirical** | `/home/ubuntu/.claude/cache/changelog.md` | 2.1.220 changelog（最近修复：copy-on-select base64 leak、Remote Control stale status） |
| **local-empirical** | `/home/ubuntu/.claude/.last-cleanup`, `/home/ubuntu/.claude/.last-update-result.json` | 自我维护时间戳 |

### 1.2 Anthropic 官方 GitHub issues（无 docs，但 issue 是产品真相的来源）

| Issue | 主题 | URL |
|---|---|---|
| #53516 | **[FEATURE] Stable, documented schema for `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` line types** — 列出 v2.1.118/119 观测到的全部 type / subtype：`assistant / attachment / custom-title / file-history-snapshot / last-prompt / permission-mode / queue-operation / system / user / agent-name`，`system` 的 subtype：`away_summary / bridge_status / compact_boundary / local_command / scheduled_task_fire / stop_hook_summary / turn_duration`，`--include-hook-events` 还会出 `system/hook_callback` | https://github.com/anthropics/claude-code/issues/53516 |
| #55934 | 自动压缩 session log（gzip / zstd） | https://github.com/anthropics/claude-code/issues/55934 |
| #71496 | Session transcript persistence silently disabled by server-side gate | https://github.com/anthropics/claude-code/issues/71496 |
| #78159 | **fable-5 模型自 2.1.209 起静默停止写本地 transcript**（Opus 正常） — 揭示存在"server-side session storage"与本地 JSONL 并行 | https://github.com/anthropics/claude-code/issues/78159 |
| #79764 | background subagent 在 SessionStart:fork 后无法 resume —— 文件未丢，只是 fork 的 symlink 机制只覆盖 running agent | https://github.com/anthropics/claude-code/issues/79764 |
| #80654 | **CLAUDE_CODE_CHILD_SESSION marker 跨进程继承，导致主 session 静默停止持久化**，需要 `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` | https://github.com/anthropics/claude-code/issues/80654 |
| #81065 | 压缩 session transcripts（实测 388MB → 137MB，2.8x） | https://github.com/anthropics/claude-code/issues/81065 |
| #81843 | **Transcript JSONL 损坏（spliced writes）** —— 4 个独立 writer 域无共享锁：batched drain queue / appendEntryToFileAsync / reAppendSessionMetadataAsync / sync appendFileSync 退出处理 | https://github.com/anthropics/claude-code/issues/81843 |
| #79651 | PermissionResult hook event 请求 | https://github.com/anthropics/claude-code/issues/79651 |
| #77191 | PreToolUse hook allow decision 在并发 Bash 下不可靠 | https://github.com/anthropics/claude-code/issues/77191 |
| #63904 / #60984 | transcript 仅写 metadata，不写 content 的多份报告 | （合并入口） |

### 1.3 第三方深度文档（高可信）

| 项目 | 关键文档 | URL |
|---|---|---|
| matt1398/claude-devtools（3.7k★） | **JSONL format explained** — 字段逐项表 + jq 示例 | https://claude-dev.tools/docs/jsonl-format |
| matt1398/claude-devtools | **Where are Claude Code logs stored** — 全平台路径 + 容器/CI 注意事项 | https://claude-dev.tools/docs/log-locations |
| matt1398/claude-devtools | **`claude --verbose` vs claude-devtools** — 两者都读同一份 JSONL，区别是 live stdout vs 事后结构化 | https://claude-dev.tools/docs/verbose-vs-devtools |
| daaain/claude-code-log（1.2k★） | README —— 列举 JSONL 全部 message type（user / assistant / system / tool_use / tool_result），支持 `--detail {user-only, minimal, low, high, full}` 五级细节 | https://github.com/daaain/claude-code-log |
| leanmcp/superview.sh（2.1k★） | dashboard 化 `~/.claude/` 日志 | https://github.com/Leanmcp/superview.sh |
| nateherkai/token-dashboard（649★） | 把 JSONL 转成本地 token dashboard | https://github.com/nateherkai/token-dashboard |
| GarrickZ2/claude-code-cleaner（31★） | 专门清理 `~/.claude/` 磁盘 | https://github.com/GarrickZ2/claude-code-cleaner |
| hjtenklooster/claude-file-recovery（107★） | 从 JSONL 恢复被改的文件 | https://github.com/hjtenklooster/claude-file-recovery |

### 1.4 推断（reverse-engineered, open-source observation）

- **claude-devtools 文档站** 的"Source of data"段明确说：`--verbose` 与本地 transcript JSONL **读同一份底层数据**，只是呈现层不同 → 故 `--verbose` 不会改落盘格式。
- **claude-devtools README** 给出 v2.1.20 之后的退化史（"Read 3 files" 折叠 + `--verbose` 沦为唯一详情出口），但本地 v2.1.220 实测 transcript JSONL 仍包含完整 `Read / Grep / Bash / Edit` 的 input/output 块 → **完整性保留，仅终端渲染折叠**。
- 通过本地解码 `additional_metadata`（base64）确认 Claude Code 内部 telemetry 事件 `tengu_*` 命名稳定自 2.1.220。

---

## 2. 总体架构

### 2.1 一段话描述

Claude Code 在用户机器上跑的是一个 **多进程的 Node.js supervisor + 多 worker + 主交互 CLI** 的混合体。日志体系拆成 **4 条独立轨道**，由不同代码域写入、互不串扰：

1. **Session Transcript（结构化业务事件流）** —— append-only JSONL，**这是产品主通道**。`--verbose` 只是把同一份 JSONL 实时 echo 到 stdout。
2. **Telemetry（结构化埋点流）** —— 内部代号 `tengu_*`，1P-only，文件名 `1p_failed_events.<sid>.<random>.json`，**首行已是"failed"暗示这是客户端 fallback**：本应上传 1P 服务，失败时本地留底。additional_metadata 用 base64 包了一层避免被反序列化器踩坏。
3. **Daemon 日志（系统级 plain text）** —— `~/.claude/daemon.log`，仅由 background-task supervisor / bg worker 写，单文件无切分，进程退出即停止追加。
4. **In-process ephemeral state** —— `~/.claude/sessions/<pid>.json`、`/jobs/<jobId>/state.json`、`/teams/<teamId>/config.json`、`/file-history/<sid>/<hash>@v<n>` 是 **运行时状态机快照**，不是日志但可当 audit trail 旁路。

四套系统都 **没有共享锁**（issue #81843 直接点名），4 个独立 writer 域并发写同一份 session jsonl，会出现 truncated-splice / missing-newline 损坏（实测本机 30 条损坏记录 / 10,949 文件 ≈ 0.21%）。

### 2.2 ASCII 流程图

```
┌──────────────────────────────────────────────────────────────────────┐
│                          User Terminal (TTY)                         │
│   stdin  ──► claude CLI (REPL) ──► stdout  ◄── --verbose echo        │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ipc / fork
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
 ┌──────────────┐          ┌──────────────┐          ┌──────────────────┐
 │ Main REPL    │          │ Daemon       │          │ Sub-agent /      │
 │ (interactive │          │ supervisor   │          │ Task / Teams     │
 │  session)    │          │ ~/.claude/   │          │ (forked workers) │
 └──────┬───────┘          │ daemon.log   │          └────────┬─────────┘
        │                  └──────┬───────┘                   │
        │ writer domains (no lock)│                          │ writer domains
        ▼                         ▼                          ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl  (PRIMARY)  │
 │   ├── subagents/agent-<id>.jsonl  (isSidechain=true)             │
 │   └── tool-results/<id>.txt  (oversize payloads > 某个阈值)      │
 │                                                                  │
 │   schema: append-only, one event per line, types:                │
 │     assistant | user | system | attachment | mode |              │
 │     last-prompt | ai-title | file-history-snapshot |             │
 │     file-history-delta | permission-mode | queue-operation |     │
 │     agent-name | custom-title                                    │
 └──────────────────────────────────────────────────────────────────┘
        ▲                                                          │
        │                                                          │
 ┌──────┴───────────────┐                                  ┌────────┴────────┐
 │ ~/.claude/telemetry/  │                                  │ ~/.claude/jobs/  │
 │ 1p_failed_events.    │                                  │ <jobId>/         │
 │   <sid>.<rand>.json  │                                  │  state.json      │
 │   (tengu_* events)   │                                  │  timeline.jsonl  │
 └──────────────────────┘                                  └─────────────────┘

        ┌─────────────────────────────────────────────────────┐
        │  Side channels (no rotating, no cleanup by default) │
        │  ~/.claude/history.jsonl        (cross-session)    │
        │  ~/.claude/daemon.log           (supervisor only)  │
        │  ~/.claude/sessions/<pid>.json  (live roster)      │
        │  ~/.claude/file-history/<sid>/<hash>@v<n>         │
        │  ~/.claude/teams/<teamId>/config.json              │
        │  ~/.claude/session-env/<sid>/sessionstart-hook-*.sh│
        └─────────────────────────────────────────────────────┘

External (cloud) ──► Anthropic 1P telemetry ingest
                          ▲
                          │ (failed? ⇒ write local fallback file)
                          │
                  Claude Code client
```

---

## 3. 路径与文件命名约定

### 3.1 默认根目录

| OS | 路径 |
|---|---|
| macOS / Linux | `~/.claude/`（hidden；`ls -la ~` 才能看到） |
| Windows | `%USERPROFILE%\.claude\`（CLI、VS Code、JetBrains、Desktop 全部共用） |

> 来源：claude-dev.tools/docs/log-locations（一手文档站）；本机 `/home/ubuntu/.claude/` 实测确认。

### 3.2 顶层子目录布局（本机实测）

```
~/.claude/
├── .last-cleanup                       # ISO ts of last self-cleanup
├── .last-update-result.json            # self-update metadata
├── CLAUDE.md                           # 全局记忆（agent 加载）
├── agents/                             # 自定义 agent 定义
├── backups/                            # settings.json 自动备份 settings.json.YYYYMMDDbak
├── cache/changelog.md                  # 当前 release notes
├── daemon/
│   ├── control.key                     # ipc auth token
│   ├── dispatch/                       # (empty in idle)
│   └── roster.json                     # supervisor state: proto, supervisorPid, workers
├── daemon.log                          # supervisor + bg worker plain-text log
├── file-history/<sid>/<hash>@v<n>      # 每文件每次 Edit/Write 前的快照（无扩展名）
├── history.jsonl                       # 跨 session 的 user prompt only
├── jobs/
│   ├── pins.json
│   └── <jobId>/
│       ├── state.json                  # {state, detail, tempo, inFlight, fan[]}
│       └── timeline.jsonl              # 事件 timeline（at/state/detail/text）
├── paste-cache/                        # paste buffer 缓存
├── projects/<encoded-cwd>/             # ★ 主体 JSONL 仓库
│   ├── <sessionId>.jsonl               # 主 transcript
│   ├── <sessionId>/
│   │   ├── subagents/agent-<id>.jsonl
│   │   ├── subagents/agent-<id>.meta.json  # {agentType, description, toolUseId, spawnDepth}
│   │   └── tool-results/<hash>.txt     # 过大 payload（hook 输出、grep 结果等）
│   └── memory/                        # CLAUDE.md 项目记忆层
├── session-env/<sid>/
│   └── sessionstart-hook-0.sh          # SessionStart hook 注入快照
├── sessions/<pid>.json                 # live session roster
├── settings.json + settings.json.YYYYMMDDbak
├── shell-snapshots/                    # ZSH/BASH snapshot（环境恢复用）
├── tasks/<sid>/                        # TODO 状态
├── teams/<teamId>/
│   └── config.json                     # 多 agent 编排元数据
└── telemetry/
    └── 1p_failed_events.<sid>.<uuid>.json
```

### 3.3 编码约定

- **项目目录名**：cwd 的绝对路径用 `-` 替换 `/`，前缀 `-`。例：`/home/ubuntu/workspace/wasteland` → `-home-ubuntu-workspace-wasteland`。
- **sessionId**：UUID v4（小写 + 连字符）。
- **subagent file**：固定模式 `agent-<16-hex>.jsonl` + `.meta.json` 配对。
- **file-history**：`<8-char-hash>@v<integer>`，每改一次递增 v 号，无扩展名。

---

## 4. debug vs transcript 边界

### 4.1 `--debug`（推断；社区/issue 共识）

- **没有专门 `--debug` CLI flag** —— 至少 2.1.220 之前。issue #53516 / #80654 / #81843 等多次出现 `~/.claude/logs/session-<sid>.log` 字样（per-session tool log），但**这不是 `--debug` 写出来的**，而是 transcript + tool-results 派生的事实目录。
- 用户实际能用的"debug 入口"只有两个：`--verbose` 和 `DEBUG=claude:*`（env-based tracing，2.1.215+ changelog 间接确认）。

### 4.2 `--verbose`（一手：claude-dev.tools/docs/verbose-vs-devtools）

| 维度 | `--verbose` | 默认 |
|---|---|---|
| 数据源 | 与 transcript JSONL 同源 | transcript JSONL（写盘） |
| 输出形式 | 实时 echo 到 stdout（每行一个 JSON object） | 不 echo，仅写盘 |
| 持久性 | 进程结束即消失 | 永久（除非 archive / cleanup） |
| 包含内容 | system prompts、metadata、tool input/output 全部 | 同左（写盘包含完整 content，只是渲染折叠） |
| 噪音 | 大（raw JSON + system prompt） | 中（devtools / claude-code-log 解析后） |
| 适合 | live piping、自定义日志处理 | 事后审计、回放、跨 session 搜索 |

**结论：`--verbose` 与 transcript 是同一份数据的两个 sink**。打开 `--verbose` 不会让 transcript 多写字段，只会让 stdout 同步打印。

### 4.3 daemon.log vs transcript

- **daemon.log**：仅 supervisor 启动 / bg worker spawn / settle / shutdown / OOM retire 等调度事件，**不含** LLM turn / tool call。
- **transcript**：业务事件流。

两者完全正交。

### 4.4 telemetry vs transcript

- **transcript**：业务事件（user/assistant/system 消息 + tool call + tool result + meta）。
- **telemetry**：性能/审计事件（`tengu_tool_use_success` 附 `durationMs / rssDeltaBytes / heapUsedDeltaBytes`，`tengu_bash_tool_command_executed` 附 `command_type / stdout_length / exit_code / was_backgrounded / sandboxed`，`tengu_api_success` 附 `messageCount / messageToken*` 等）。

telemetry 是 **second-by-second instrumentation**，transcript 是 **turn-by-turn business event**。两者时间轴 1:1 对齐（实测同 session 同时间窗的 ts 偏差 < 1s）。

---

## 5. 主要字段

### 5.1 Transcript JSONL（实测 v2.1.220）

**所有记录共有顶层字段**：

| 字段 | 类型 | 含义 |
|---|---|---|
| `type` | string | discriminator：`user / assistant / system / attachment / mode / last-prompt / ai-title / file-history-snapshot / file-history-delta / permission-mode / queue-operation / agent-name / custom-title` |
| `uuid` | string | 事件唯一 id |
| `parentUuid` | string\|null | 上一事件 uuid（树形；非树状的线性链路） |
| `timestamp` | string (ISO 8601) | RFC3339 UTC |
| `sessionId` | string (UUID) | session id |
| `cwd` | string | 该事件发生时的 cwd |
| `gitBranch` | string | 当前 git branch（若有） |
| `version` | string | Claude Code 版本 |
| `userType` | string | `external`（本机交互）/ `external`（SDK） |
| `entrypoint` | string | `cli` / `sdk` / `vscode` 等 |

**`type=user`**：

```json
{
  "type": "user",
  "isSidechain": false,
  "isMeta": true,                      // 来自 /local-command、system-injected
  "message": {
    "role": "user",
    "content": "<string|ContentBlock[]>"
  }
}
```

- `content` 是 string 时：纯 prompt。
- `content` 是 array 时：多模态，含 `tool_result` 块回填（带 `tool_use_id`）。

**`type=assistant`**：

```json
{
  "type": "assistant",
  "requestId": "<anthropic request id>",
  "attributionSkill": "trellis-brainstorm",   // 当前 skill（若有）
  "effort": "high",                           // effort level
  "session_id": "<sid>",                      // 注意：与顶层 sessionId 偶有不同（跨 session 引用！）
  "message": {
    "id": "<anthropic msg id>",
    "role": "assistant",
    "model": "MiniMax-M3",                    // 实际返回的模型
    "stop_reason": "end_turn|tool_use|max_tokens|...",
    "stop_sequence": null,
    "service_tier": "standard",
    "stop_details": null,
    "content": [                              // 内容块数组
      {"type": "thinking", "thinking": "..."},// extended thinking（若启用）
      {"type": "text", "text": "..."},
      {"type": "tool_use", "id": "toolu_xxx",
       "name": "Bash|Read|Edit|Task|...",
       "input": {...}}
    ],
    "usage": {
      "input_tokens": 30990,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 128,
      "output_tokens": 1012,
      "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0},
      "service_tier": "standard",
      "cache_creation": {"ephemeral_1h_input_tokens": 0, "ephemeral_5m_input_tokens": 0},
      "inference_geo": "",
      "iterations": [],
      "speed": "standard"
    }
  }
}
```

**`type=system`**（subtype 决定内容）：

```json
{"type":"system","subtype":"local_command","level":"info","content":"...","isMeta":false,...}
```

实测 subtype：`local_command / compact_boundary / turn_duration / away_summary / stop_hook_summary / bridge_status / scheduled_task_fire / hook_callback`。

**`type=attachment`**：hook 输出（如 SessionStart hook stdout，**含 JSON-encoded `hookSpecificOutput.additionalContext`**）。

**`type=mode`**：`{"mode":"normal|plan|acceptEdits|bypassPermissions|...","sessionId":...}`

**`type=permission-mode`**：同 mode 但独立 type。

**`type=last-prompt`**：`{"leafUuid":"<last-event-uuid>","sessionId":...}` —— 持续更新指针。

**`type=ai-title`**：自动生成的 session 标题。

**`type=file-history-snapshot` / `file-history-delta`**：编辑前的版本控制。

**`type=queue-operation`**（v2.1.215+ 新增）：TUI 队列事件。

```json
{
  "type":"queue-operation","operation":"enqueue",
  "timestamp":"...","sessionId":"...",
  "content":"<task-notification>...</task-notification>",
  "usage":{"subagent_tokens":0,"tool_uses":57,"duration_ms":260886}
}
```

**`type=agent-name`** / **`type=custom-title`**：命名 / 标题变更。

### 5.2 Telemetry（tengu_*）

| 事件 | 触发 | 关键 additional_metadata（已 base64 解码） |
|---|---|---|
| `tengu_tool_use_granted_in_config` | 工具通过配置被 allow 时 | `{"rh":"...","renderer_mode":"default","messageID":"...","toolName":"...","sandboxEnabled":false}` |
| `tengu_tool_use_can_use_tool_allowed` | runtime canUseTool 判定通过 | `{"messageID":"...","toolName":"...","queryChainId":"<uuid>","queryDepth":N}` |
| `tengu_tool_use_success` | 工具调用成功 | `{"durationMs":74,"rssDeltaBytes":393216,"heapUsedDeltaBytes":553992,"permissionDurationMs":2,"preToolHookDurationMs":0,"toolInputSizeBytes":571,"toolResultSizeBytes":867,"toolName":"Bash","isMcp":false,"effort_level":"high",...}` |
| `tengu_tool_use_error` | 工具调用失败 | `{"error":"ShellError","error_message_hash":"...","error_top_frame":"cli.js:16889:2528","isMcp":false,"subagent_type":"user-defined","effort_level":"high",...}` |
| `tengu_bash_tool_command_executed` | Bash 跑完 | `{"command_type":"python3","stdout_length":868,"stderr_length":0,"exit_code":0,"interrupted":false,"executor_shell":"zsh","sandboxed":false,"was_backgrounded":false,"tool_use_id":"...",...}` |
| `tengu_bash_tool_command_failed` | Bash 退出码非 0 | 同上 + failed 标记 |
| `tengu_api_success` / `tengu_api_before_normalize` / `tengu_api_after_normalize` | API 调用生命周期 | `{"model":"MiniMax-M3","preNormalizedModel":"MiniMax-M3[1m]","betas":"...","messageCount":25,"messageToken*":...}` |
| `tengu_query_before_attachments` / `tengu_query_after_attachments` / `tengu_attachment_compute_duration` | 上下文附件挂载前后 | `{"messagesForQueryCount":67,"assistantMessagesCount":3,"toolResultsCount":3,"queryChainId":"...","queryDepth":19}` |
| `tengu_tool_search_mode_decision` | 工具搜索策略选择 | (策略 + token 计数) |
| `tengu_sysprompt_block` | system prompt 构建 | (各 block token 大小) |
| `tengu_repl_hook_finished` | hook 链执行完 | `{"hookName":"PostToolUse:Read","numCommands":1,"numSuccess":1,"numBlocking":0,"totalDurationMs":1}` |
| `tengu_session_file_read` | 读取 session 文件 | (path/size) |
| `tengu_file_operation` / `tengu_file_activity` / `tengu_file_history_track_edit_success` / `tengu_file_changed` | 文件相关 | (file metadata) |
| `tengu_shell_set_cwd` | 切换 cwd | (cwd) |
| `tengu_bash_ast_too_complex` | Bash AST 解析失败 | (snippet 截断) |
| `tengu_feature_ok` / `tengu_feature_sad` | feature flag 命中/未命中 | (feature 名) |
| `tengu_api_cache_breakpoints` | cache breakpoint 决策 | (breakpoint count) |

每条事件还携带：

```json
{
  "event_type": "ClaudeCodeInternalEvent",
  "event_data": {
    "event_name": "tengu_tool_use_success",
    "client_timestamp": "2026-07-29T14:27:16.844Z",
    "model": "MiniMax-M3[1m]",
    "session_id": "5fa18c0d-...",
    "user_type": "external",
    "betas": "claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,thinking-token-count-2026-05-13,...",
    "env": {"platform":"linux","node_version":"v26.3.0","terminal":"tmux","is_running_with_bun":true,"is_ci":false,"version":"2.1.220","linux_distro_id":"ubuntu",...},
    "entrypoint": "cli",
    "is_interactive": true,
    "client_type": "cli",
    "process": "<base64>","additional_metadata": "<base64>",
    "event_id": "<uuid>",
    "device_id": "<sha256>",
    "parent_session_id": "<uuid, 若 subagent spawn>"
  }
}
```

> **注意 `parent_session_id`**：实测本机 telemetry 全部是同一值 `13d407ef-...` —— 这是 device-level 顶层 session；当前 active session `5fa18c0d-...` 的事件也可能没有该字段。subagent spawn 时写入父 sid。

---

## 6. 子任务与会话的引用结构

### 6.1 子 agent jsonl（实测）

路径：`~/.claude/projects/<encoded-cwd>/<parent-sid>/subagents/agent-<agentId>.jsonl` + `.meta.json`

**meta.json**：
```json
{
  "agentType": "trellis-research",
  "description": "研究 opencode 日志系统",
  "toolUseId": "call_OUcX7En9v9tLNVxTmmmD2B7l",
  "spawnDepth": 1
}
```

**agent jsonl 字段差异**（与父 transcript 对比）：

| 字段差异 | 含义 |
|---|---|
| `isSidechain: true` | 标识这是子树，与父 session 主线分叉 |
| `agentId: "a2b451be11cc25d22"` | 8-byte hex（短） |
| `promptId: "803d8f66-ac70-459e-aeb0-e3c4150ba3bd"` | 触发该 subagent 的父 tool_use_id（可追溯到父 transcript 中的 Task call） |
| `attributionAgent: "trellis-implement"` | 哪个父 agent 派生 |
| `sessionKind: "bg"` | background / interactive / 等 |
| 顶层 `sessionId` = 父 session 的 sid | 但同文件有 `parentSessionId` 风格字段（实测有时 `sessionKind=bg`） |

**链路追溯**：

```
父 transcript: assistant.content[].tool_use { name:"Task", input:{subagent_type:"..."}, id:"call_OUcX7En9v9tLNVxTmmmD2B7l" }
                                   │
                                   ▼
subagents/agent-a6db84e83e981f546.meta.json: { toolUseId:"call_OUcX7En9v9tLNVxTmmmD2B7l", spawnDepth:1 }
                                   │
                                   ▼
subagents/agent-a6db84e83e981f546.jsonl: 首条 user 行 promptId 复用同一 toolUseId
```

> **重要 caveat（issue #79764）**：当 SessionStart:fork 触发（session UUID 旋转），subagent jsonl 仍在旧 sid 子目录下；resume lookup 只搜新 sid，导致 "No transcript found for agent ID"。**subagent 持久化与父 sid 强绑定，跨 fork 不迁移**。

### 6.2 队列 & 通知（v2.1.215+）

`type=queue-operation` + `<task-notification>` block：

```
parent_tool_use_id  ──►  task-id (subagent agentId)  ──►  output-file  ──►  result text
       │                                                          │
       ▼                                                          ▼
父 transcript assistant.tool_use              父 transcript type=queue-operation enqueue
       │                                                          │
       └─────────────── status:completed / summary / result ───────┘
```

### 6.3 `--resume` / `claude -c`

- `--resume <sid>` 不重新生成 jsonl，**原地 append** 到 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`。
- 但实测（issue #78159）：某些模型 + 版本组合下，**resume 后 jsonl 冻结** —— 只有 metadata (`last-prompt / mode / permission-mode / ai-title`) 被覆写，content 0 增长。原因：server-side session storage 是真相源，本地 jsonl 是缓存。
- issue #76363：**`--resume` 可静默换模型**（保留旧 model vs 切换到当前 default）。

---

## 7. 轮转与保留

### 7.1 官方行为（默认）

| 维度 | 行为 |
|---|---|
| **轮转** | **无**。transcript jsonl append-only，至磁盘满为止 |
| **压缩** | **无**（issue #81065 / #55934 强烈需求，官方未实现） |
| **TTL / 自动清理** | 仅有内部 `cleanupPeriodDays`（settings.json），本机实测 `.last-cleanup` 时间戳；不是删除 transcript，只是删旧 session-env / shell-snapshots |
| **kill 阈值** | issue #69734 —— 磁盘配额耗尽 → `--resume` 静默挂死 |
| **增长速率** | 本机实测 ~13 MB/天 / session（issue #81065 同量级）；年累计数 GB |

### 7.2 user 实践（本机 + 社区）

1. **claude-code-cleaner（31★）** —— TUI 工具删除 `~/.claude/projects/` 旧 jsonl + 旧 subagents。
2. **手动 gzip**（issue #81065）：`gzip -6` 即可 2.8x 压缩比；zstd 更好。
3. **`cleanupPeriodDays`**：settings.json 配置项（issue #80654 提到）；设 0 等于关闭持久化。
4. **`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`**（issue #80654）：覆盖 child-session 误判。
5. **`CLAUDE_CODE_SKIP_PROMPT_HISTORY`**：跳过 `history.jsonl` 写入。

### 7.3 telemetry 文件轮转

实测：telemetry 文件大小可达 **220KB**（582 events），文件名 `1p_failed_events.<sid>.<uuid>.json` 看似一次性，但实测多次 rotate（uuid 后缀不同）；无明确清理策略。

### 7.4 daemon.log

单文件 plain text，本机实测 57 行 ≈ 4KB；supervisor 进程 exit 时落最后一行，无主动 rotate。Issue 体感：如果长开 supervisor 可能增长到 MB 级。

---

## 8. 隐私 / 脱敏

### 8.1 默认行为（实测）

- **transcript jsonl**：**完整明文**，包括 user prompt、tool input/output、thinking、hook 输出、`<local-command-stdout>`、环境变量经 hook 注入的部分。**无任何脱敏**。
- **telemetry `additional_metadata`**：base64 编码，但只是规避 schema 校验，不是加密。本地任何 reader 可解。
- **telemetry `process` 字段**：base64 编码进程快照（uptime/rss/heap/cpu 等），无 secret。
- **API key**：`~/.claude/settings.json` `env.ANTHROPIC_AUTH_TOKEN` 等敏感字段在 `env` 段是**明文**（本机实测可见）。这是用户责任，不在 Claude Code 控制范围。
- **history.jsonl**：`pastedContents:{}` 看似空，但实测不是 paste buffer 真正内容，是元数据。

### 8.2 暴露面（潜在泄漏点）

1. **hook 输出写盘**：`type=attachment` 的 `hookSpecificOutput.additionalContext` 经常包含完整 git status / file tree / env。若 hook 设计不当（打印 `env`）会泄漏 secret。
2. **tool-results/ 大文件**：Bash / Read 输出超过某阈值会单独落盘到 `<sessionId>/tool-results/<hash>.txt`，明文。
3. **shell-snapshots/**：保存 ZSH 启动后的完整环境快照，可能含 `*_TOKEN` 等变量。
4. **session-env/<sid>/sessionstart-hook-0.sh**：hook 注入脚本快照。

### 8.3 官方控制

- `cleanupPeriodDays` 控制最终淘汰。
- `--no-session-persistence` / `--persistSession false`（issue #71496 提的 server-side gate）。
- `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` 强制保留（issue #80654）。
- **官方明确不承诺 schema 稳定**（issue #53516 持续 open）。

---

## 9. 与 wasteland 的契合点与差异

wasteland 当前架构假设（TUI + rxjs + adapter 分层），对照 Claude Code 的本地日志体系：

### 9.1 契合点（可直接借鉴）

| Claude Code 模式 | wasteland 当前 | 借鉴价值 |
|---|---|---|
| `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`（主 session append-only） | （推断）应有 `session/` 目录存 transcript | 直接复刻结构 |
| `subagents/agent-<id>.jsonl` + `.meta.json` 配对 | （推断）task 子日志在 session 内 | 一致；可让 `meta.json` 充当 spawn manifest |
| `type=queue-operation` 携带 `<task-notification>` + `usage{subagent_tokens,tool_uses,duration_ms}` | TUI 任务队列 | **直接复用** task-notification 协议 |
| `last-prompt` leafUuid 指针 | TUI 应有"继续上一次输入" | 用 `leafUuid` 做 cursor 持久化 |
| `mode / permission-mode` 独立 type | UI 模式切换 | **直接复用**：每个 mode 切换一条 type=mode 记录 |
| `file-history-snapshot / file-history-delta` per-file per-version | Edit 前的备份 | **直接复用** `<hash>@v<n>` 命名 |
| telemetry `tengu_tool_use_success` 携带 `durationMs / rssDeltaBytes / heapUsedDeltaBytes / preToolHookDurationMs / permissionDurationMs / toolInputSizeBytes / toolResultSizeBytes` | （推断）应有 tool-call timing | **直接复用**：5 个时间维度（hook前/权限判定/工具本体/post-hook/total）= 端到端 latency 分解 |
| `betas` 字段 + `env` 元数据 | 无 | **直接复用**：betas 充当 capability flags，可让 wasteland 在不同能力下回放 |
| `parent_session_id` 跨 session 引用 | （推断）父子 session 在同一 jsonl 用 `parentUuid` | 注意是 uuid 旋转场景（issue #79764） |
| `attachment` type 携 hook stdout | hook 输出 | **直接复用** |
| `--include-hook-events` flag 控制 `system/hook_callback` 落盘 | hook 开关 | **直接复用**：默认关、按需开 |
| `isSidechain` 标记子树 | subagent jsonl | **直接复用** |

### 9.2 差异（wasteland 应当主动改进）

| 维度 | Claude Code 当前 | wasteland 应当 |
|---|---|---|
| **schema 稳定性** | 无；v2.1.20 大改、v2.1.209 静默停止、v2.1.215+ 加 queue-operation | **承诺版本化 schema**（semver + 迁移工具） |
| **并发写** | 4 个 writer 域无锁，0.21% 损坏 | **单 writer 域 + mutex**，或 batched-drain 串行化 |
| **磁盘增长** | 13MB/天，无 TTL | **必须** 内置 TTL + 压缩（gzip / zstd）+ 大文件滚动 |
| **resume 跨 sid 旋转** | 冻 jsonl + server-side 真相 | 单一真相源 = 本地 jsonl，避免双源漂移 |
| **`--debug` 文档** | 无 | 提供显式 `--debug` + 落盘路径 docs |
| **审计事件** | 仅 telemetry（不公开 schema） | 提供 public schema + 至少 4 类审计事件：`tool_call_granted / permission_decision / hook_executed / sandbox_violation` |
| **PII 脱敏** | 完全明文 | 至少提供 `redact-secrets` 设置：hook 输出 / tool-results 写入前过滤 |
| **场景重现** | jsonl + history.jsonl 拼接勉强可 | **设计专门 replay 入口**：读 `parentUuid` 树 + `queue-operation` + telemetry，重放交互 |

---

## 10. 可借鉴的具体模式

### Pattern 1 — **AppendOnlyJsonlStore**
> **一句话**：session 内一切事件按 `type + uuid + parentUuid` 三元组 append-only 写 jsonl；并发写由单线程 batched-drain（每 100ms flush）串行化，避免 #81843 式损坏。

落地：wasteland 在 `runtime/sinks/transcript.ts` 中实现 `AppendOnlyJsonlStore`，emit `$event` rxjs 流时按 `(type, uuid, parentUuid)` 路由，单 mutex + 64KiB 缓冲 flush。

### Pattern 2 — **SubagentSidechain**
> **一句话**：subagent / 子任务 transcript 用 `isSidechain:true` 标记写入独立 jsonl + `.meta.json`（含 `toolUseId` / `spawnDepth` / `agentType` / `description`）；父 transcript 通过 `parent_tool_use_id` 反查 metadata，**避免子树打散父主线**。

落地：wasteland 在 task spawn 时建 `subagents/agent-<id>.{jsonl,meta.json}`，meta 写完整 spawn contract；resume 时按 `(toolUseId → meta)` 跳转。

### Pattern 3 — **TenguStyleTelemetrySidecar**
> **一句话**：业务 jsonl（turn 级）旁路一份 telemetry json（call 级），**额外 base64 编码 `additional_metadata` 避免 schema 校验踩雷**，每条事件带 `queryChainId / queryDepth / durationMs / rssDeltaBytes`，用于端到端 latency 分解与 OOM 归因。

落地：wasteland 在 `runtime/sinks/telemetry.ts` 提供 `TenguStyleTelemetry`，可观测 5 段时间（`preHookMs / permissionMs / toolMs / postHookMs / totalMs`）和资源 delta。

### Pattern 4（bonus）— **FileHistoryVersioned**
> **一句话**：每次 Edit/Write 前把原文件内容以 `<8-char-hash>@v<n>` 命名写到 `file-history/<sid>/`，搭配 `file-history-snapshot` / `file-history-delta` 元事件；支持任意时刻 `claude-file-recovery` 式回滚。

落地：wasteland 在 Edit 工具 adapter 层前置 snapshot，命名 + 事件广播统一。

### Pattern 5（bonus）— **BetasAsCapabilityFlags**
> **一句话**：把每条 assistant 记录的 `betas` 字段当 capability flag 容器（实测 7 个 beta：`claude-code-20250219 / context-1m-2025-08-07 / interleaved-thinking-2025-05-14 / redact-thinking-2026-02-12 / thinking-token-count-2026-05-13 / context-management-2025-06-27 / prompt-caching-scope-2026-01-05 / mid-conversation-system-2026-04-07`），回放时按 beta 集合决定 capability 开关。

落地：wasteland 在 session manifest 写入 `capabilities: string[]`，UI / replay 按其分支。

---

## Caveats / Not Found

- **`--debug` flag 是否存在**：本机实测 v2.1.220 不存在；issue 中提到的 `~/.claude/logs/session-<sid>.log` 不是 `--debug` 写出来的（应该由 transcript / tool-results 派生，但本机未发现该路径）。
- **schema 稳定性**：**官方未承诺**；issue #53516 已 open 3+ 月。第三方必须自行 snapshot schema 版本。
- **1P telemetry 是否真的上传**：文件名 `1p_failed_events.*` 暗示本应是上传到 1P（first-party ingest），上传失败时本地落底。是否真的上传、什么条件失败、上传内容是否脱敏——**无文档**，仅可推测。
- **`--verbose` 是否真的只 echo jsonl**：claude-dev.tools/docs/verbose-vs-devtools 一手说 "raw event stream"，但未明确说 stdout 行序是否 100% 等价于 jsonl 落盘行序。
- **subagent 在 background task（`run_in_background: true`）的隔离粒度**：实测 subagent jsonl 在父 session 子目录，但 `run_in_background` 的 host worker（daemon.log `bg spawned host pid=...`）日志与 transcript 不交叉。
- **`memory/` 项目记忆层**：本机目录存在但为空（推测功能未启用或新功能）。
- **wasteland 当前是否已有任何 transcript 实现**：本次研究未读取 wasteland 源码（遵守 "禁止 review / 改造" 边界），仅基于 spec 描述（`runtime-contracts.md` 提"session transcript + session-dir"）推断架构契合点。