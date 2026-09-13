# Wasteland 内置工具需求分析

> 对比 Claude CLI 和 OpenCode 工具集，确定 Wasteland 需要实现哪些内置工具。
> 日期: 2026-08-10

---

## 1. Claude CLI 工具清单

Claude Code (Anthropic 官方 CLI) 内置工具（共 15 个）：

### 1.1 文件与代码操作

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Read** | 读取文件内容，支持 PDF/图片/Notebook | file_path, offset, limit, pages | read |
| **Write** | 创建或完全覆写文件（需先 Read） | file_path, content | write |
| **Edit** | 精确字符串替换编辑 | file_path, old_string, new_string, replace_all | write |
| **NotebookEdit** | 编辑 Jupyter notebook 单元格 | notebook_path, new_source, cell_id, edit_mode | write |

### 1.2 文件发现

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Glob** | 使用 glob 模式查找文件 | pattern, path | read |
| **Grep** | 在文件中搜索文本（ripgrep 风格） | pattern, path, include | read |

### 1.3 Shell 执行

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Bash** | 执行 shell 命令，支持后台运行 | command, timeout, run_in_background | execute |

### 1.4 网络

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **WebFetch** | 获取 URL 内容并转为 markdown | url, prompt | execute |
| **WebSearch** | 搜索网络信息（US-only） | query, allowed_domains, blocked_domains | read |

### 1.5 多 Agent 编排

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Agent** | 启动子 Agent 处理复杂任务 | description, prompt, model, isolation, run_in_background | execute |
| **SendMessage** | 向其他 Agent 发送消息 | to, message, summary | execute |
| **TaskStop** | 停止后台任务 | task_id | execute |

### 1.6 工作区管理

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **EnterWorktree** | 创建/进入 git worktree 隔离环境 | name, path | execute |
| **ExitWorktree** | 退出 worktree 会话 | action (keep/remove) | execute |

### 1.7 技能与配置

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Skill** | 调用预定义技能（部署、审查等） | skill, args | execute |

### Claude CLI 特点
- 工具名使用 PascalCase（Read, Write, Edit）或 kebab-case（无）
- Read 工具支持 absolute path、PDF `pages` 参数、图片读取
- Write 工具只能覆写已读取过的文件（read-before-write）
- Edit 要求 old_string 唯一匹配（除非 replace_all）
- WebFetch 内置 markdown 转换能力
- Agent 支持 worktree 隔离和远程执行
- Skill 系统支持打包的可复用工作流
- 没有专门的 Git 工具（通过 Bash 调用 git）
- 没有专门的目录浏览工具（通过 Bash 调用 ls/find）

---

## 2. OpenCode 工具清单

OpenCode (开源终端 AI 编码助手) 内置工具：

| 工具名 | 描述 | 主要参数 | 风险等级 |
|--------|------|----------|----------|
| **Bash** | 执行 shell 命令 | command | execute |
| **Read** | 读取文件内容 | file_path, offset, limit | read |
| **Write** | 创建或覆写文件 | file_path, content | write |
| **Edit** | 精确编辑文件 | file_path, old_string, new_string | write |
| **Search** | 搜索文件和代码库 | query, path | read |
| **Glob** | 文件模式匹配查找 | pattern | read |

### OpenCode 特点
- 工具集相对精简，聚焦核心文件操作
- Search 工具同时支持文件名搜索和内容搜索
- 不包含 WebFetch/WebSearch 等网络工具
- 不包含 git 专用工具（用户需通过 Bash 调用 git）
- 不包含 Todo 管理工具
- 不包含多 Agent 相关工具

---

## 3. Wasteland 现有工具清单

`src/tools/` 目录下已实现的工具：

| 工具名 | 文件 | 描述 | 主要参数 | 风险等级 |
|--------|------|------|----------|----------|
| **bash** | `bash.ts` | 执行 shell 命令 | command | execute |
| **read-file** | `read-file.ts` | 读取文件内容，支持分页 | path, offset, limit | read |
| **write-file** | `write-file.ts` | 创建或覆写文件 | path, content | write |
| **edit-file** | `edit-file.ts` | 精确字符串替换编辑 | path, old_string, new_string, replace_all | write |
| **glob** | `glob.ts` | 使用 glob 模式查找文件 | pattern, cwd | read |
| **grep** | `grep.ts` | 在文件中搜索文本 | pattern, path, include, ignoreCase | read |
| **list-directory** | `list-directory.ts` | 列出目录内容 | path, recursive, showHidden | read |
| **web-fetch** | `web-fetch.ts` | 获取 URL 内容 | url, method, headers, body, timeout | execute |
| **web-search** | `web-search.ts` | DuckDuckGo 搜索 | query, maxResults, engine | read |
| **git** | `git.ts` | Git 版本控制操作 | subcommand, args, message | execute |
| **ask-user** | `ask-user.ts` | 向用户提问 | question, options, default | read |
| **spawn_agent** | `spawn-agent/` | 创建子 Agent 执行任务 | task, name, model, tools | execute |
| **acp_<name>** | `acp-agent-tool.ts` | ACP 远程 Agent 调用（stdio JSON-RPC） | task | execute |
| **report_result** | `report-result.ts` | 子 Agent 结果报告 | status, summary, details | read |

### 辅助模块（非工具）

| 模块 | 文件 | 描述 |
|------|------|------|
| **code-assistant-adapter** | `code-assistant-adapter.ts` | 外部代码助手适配器（Claude Code, Codex） |
| **mcp-client** | `mcp-client.ts` | MCP 协议客户端 |
| **mcp-registry** | `mcp-registry.ts` | MCP 工具注册管理 |
| **mcp-transport** | `mcp-transport.ts` | MCP 传输层（stdio/SSE） |
| **mcp-resources** | `mcp-resources.ts` | MCP 资源访问 |
| **tool-registry** | `tool-registry.ts` | 工具注册表 |
| **tool-runner** | `tool-runner.ts` | 工具执行器 |
| **tool-types** | `tool-types.ts` | 工具类型定义 |
| **path-utils** | `path-utils.ts` | 路径安全工具 |
| **lru-cache** | `lru-cache.ts` | LRU 缓存 |

---

## 4. 对比分析

### 4.1 功能覆盖矩阵

| 功能类别 | Claude CLI | OpenCode | Wasteland | 状态 |
|----------|------------|----------|-----------|------|
| **Shell 执行** | Bash | Bash | bash | **已有** |
| **文件读取** | Read (PDF/图片) | Read | read-file | **已有（缺 PDF/图片）** |
| **文件写入** | Write | Write | write-file | **已有** |
| **文件编辑** | Edit | Edit | edit-file | **已有** |
| **文件查找** | Glob | Glob | glob | **已有** |
| **文本搜索** | Grep | Search | grep | **已有** |
| **目录浏览** | — (通过 Bash) | — (通过 Bash) | list-directory | **Wasteland 独有** |
| **网络请求** | WebFetch | — | web-fetch | **已有** |
| **网络搜索** | WebSearch | — | web-search | **已有** |
| **Git 操作** | — (通过 Bash) | — (通过 Bash) | git | **Wasteland 独有** |
| **用户交互** | — (平台内置) | — | ask-user | **Wasteland 独有** |
| **多 Agent** | Agent + SendMessage + TaskStop | — | spawn_agent + acp_* + report_result | **功能对等** |
| **Worktree 隔离** | EnterWorktree/ExitWorktree | — | — | **缺失（Claude CLI 独有）** |
| **技能系统** | Skill | — | — | **缺失（Claude CLI 独有）** |
| **Notebook 编辑** | NotebookEdit | — | — | **缺失** |
| **PDF 读取** | Read (pages 参数) | — | — | **缺失** |
| **图片读取** | Read (images) | — | — | **缺失** |

### 4.2 多 Agent 能力对比

| 能力 | Claude CLI | Wasteland | 差异 |
|------|------------|-----------|------|
| **子 Agent 创建** | Agent（支持 worktree/remote 隔离） | spawn_agent（支持嵌套/重试/事件转发） | Wasteland 更强调嵌套深度控制和事件转发 |
| **Agent 间通信** | SendMessage | — (通过事件流) | Claude CLI 有显式消息通道 |
| **后台任务管理** | TaskStop | — (通过 RxJS 取消) | Claude CLI 有显式停止接口 |
| **远程 Agent** | Agent (isolation: "remote") | acp_* (ACP 协议) | Wasteland 用标准 ACP 协议（Zed 主导，编辑器/agent 互操作） |
| **结果报告** | — (文本返回) | report_result（结构化） | Wasteland 有结构化结果 |
| **Worktree 隔离** | EnterWorktree/ExitWorktree | — | Claude CLI 独有 |

### 4.3 Wasteland 优势（已有而竞品没有）

1. **list-directory** — 结构化目录浏览，支持递归、隐藏文件、图标显示
2. **git** — 专用 Git 工具，支持安全限制（禁 force push、禁 --output）
3. **ask-user** — 交互式用户提问，支持选项列表
4. **spawn_agent** — 多 Agent 编排，支持嵌套深度控制、重试、事件转发
5. **acp_<name>** — ACP 协议远程 Agent 调用（stdio JSON-RPC 子进程，标准协议）
6. **report_result** — 子 Agent 结构化结果报告
7. **MCP 集成** — 完整的 MCP 客户端/注册表/传输层
8. **code-assistant-adapter** — 外部代码助手适配器（Claude Code, Codex）

### 4.4 缺失功能分析

| 缺失工具 | 来源 | 优先级 | 建议 |
|----------|------|--------|------|
| **MultiEdit** | Claude CLI | P2 | 批量编辑同一文件的多处内容，减少工具调用次数。可作为 edit-file 的扩展参数 |
| **EnterWorktree/ExitWorktree** | Claude CLI | P3 | Git worktree 隔离环境。对需要安全实验性修改的场景有用 |
| **Skill 系统** | Claude CLI | P3 | 预定义工作流（部署、审查等）。可被命令系统 + MCP 替代 |
| **NotebookEdit** | Claude CLI | P3 | Jupyter notebook 编辑。数据科学场景需要 |
| **TodoRead/TodoWrite** | Claude CLI | P3 | 任务清单管理。可被 spawn_agent + report_result 替代 |
| **PDF 读取** | Claude CLI | P3 | Read 工具支持 pages 参数读取 PDF。可作为 read-file 的扩展功能 |
| **图片读取** | Claude CLI | P3 | Read 工具支持图片读取。多模态场景需要 |

---

## 5. 实现优先级建议

### P0 — 核心（已有，无需新增）
- bash, read-file, write-file, edit-file, glob, grep
- 这些是编码助手的基础设施，已经完备

### P1 — Wasteland 特色（已有，持续优化）
- list-directory, git, web-fetch, web-search
- ask-user, spawn_agent, acp_*, report_result
- MCP 集成, code-assistant-adapter

### P2 — 建议新增

#### 2.1 MultiEdit（批量编辑）
**理由**: Claude CLI 的 MultiEdit 允许在单次调用中编辑同一文件的多处内容，减少工具调用次数和 token 消耗。

**实现方案**: 在 `edit-file.ts` 中增加 `edits` 数组参数：
```typescript
// 新增参数
edits: z.array(z.object({
  old_string: z.string(),
  new_string: z.string(),
})).optional()
```

**工作量**: 小（~50 行代码）

### P3 — 可选增强

#### 3.1 PDF 读取
**理由**: 读取文档、论文等 PDF 文件。Claude CLI 的 Read 工具通过 `pages` 参数支持。

**实现方案**: 在 `read-file.ts` 中增加 PDF 解析（使用 `pdf-parse` 库），通过 `pages` 参数指定页码范围。

**工作量**: 中（~150 行代码 + 依赖）

#### 3.2 图片读取
**理由**: 多模态 LLM 可以理解图片内容。Claude CLI 的 Read 工具原生支持。

**实现方案**: 在 `read-file.ts` 中检测图片文件类型，返回 base64 编码 + 元数据。

**工作量**: 小（~80 行代码）

#### 3.3 EnterWorktree/ExitWorktree
**理由**: Git worktree 隔离环境，允许在独立分支上安全实验性修改。Claude CLI 独有功能。

**实现方案**: 新建 `worktree.ts`，封装 `git worktree add/remove/list` 操作。

**工作量**: 中（~150 行代码）

#### 3.4 NotebookEdit
**理由**: 数据科学场景需要编辑 Jupyter notebook。

**实现方案**: 新建 `notebook-edit.ts`，解析 `.ipynb` JSON 结构，支持 replace/insert/delete 单元格。

**工作量**: 中（~200 行代码）

#### 3.5 TodoRead/TodoWrite（任务清单）
**理由**: 长期任务（如多步骤重构）需要持久化的任务追踪。虽然 spawn_agent + report_result 可以替代，但轻量级的 todo 管理更高效。

**实现方案**: 新建 `todo.ts`，使用 `.wasteland/todos.json` 持久化存储。

**工作量**: 中（~200 行代码）

---

## 6. 总结

| 维度 | Claude CLI | OpenCode | Wasteland | 评估 |
|------|------------|----------|-----------|------|
| **核心文件操作** | Read/Write/Edit/Glob/Grep | Read/Write/Edit/Search/Glob | read-file/write-file/edit-file/glob/grep | **完备** |
| **Shell 执行** | Bash | Bash | bash | **完备** |
| **网络能力** | WebFetch + WebSearch | — | web-fetch + web-search | **优于 OpenCode** |
| **版本控制** | — (通过 Bash) | — (通过 Bash) | git（专用工具） | **优于竞品** |
| **目录浏览** | — (通过 Bash) | — (通过 Bash) | list-directory | **独有优势** |
| **多 Agent** | Agent + SendMessage + TaskStop | — | spawn_agent + acp_* + report_result | **功能对等** |
| **MCP 集成** | 支持 MCP 工具 | — | 完整 MCP 客户端/注册表 | **独有优势** |
| **Worktree 隔离** | EnterWorktree/ExitWorktree | — | — | **缺失** |
| **技能系统** | Skill | — | — | **缺失（可被命令系统替代）** |
| **多媒体支持** | Read (PDF/图片) | — | — | **缺失** |
| **批量编辑** | Edit | Edit | edit-file | **已有（可扩展 MultiEdit）** |

### 建议行动

1. **短期（P2）**: 实现 MultiEdit（edit-file 扩展）
2. **中期（P3）**: 实现 PDF/图片读取、EnterWorktree/ExitWorktree
3. **长期**: 根据用户反馈决定是否需要 NotebookEdit、TodoRead/TodoWrite、Skill 系统

### 核心结论

Wasteland 的工具集在以下方面已达到或超越 Claude CLI / OpenCode：
- **核心文件操作**: 完备（bash, read, write, edit, glob, grep）
- **多 Agent 编排**: 功能对等，且有 ACP 标准协议支持
- **MCP 集成**: 独有优势（完整客户端实现）
- **版本控制**: 优于竞品（专用 git 工具 + 安全限制）
- **目录浏览**: 独有优势（结构化输出）

主要差距集中在：
- **多媒体支持**: PDF/图片读取（Claude CLI Read 工具原生支持）
- **Worktree 隔离**: Git worktree 管理（Claude CLI 独有）
- **批量编辑**: MultiEdit（Claude CLI 独有，但可作为 edit-file 扩展实现）

这些差距均为 P3 级别，不影响核心编码助手功能。建议按优先级逐步补齐。
