# implement edit-file and write-file tools

## Goal

为 CLI 实现文件编辑和写入能力，让 agent 能像真正的编码助手一样修改代码。采用基于会话历史审计的 read-before-edit 安全机制。

## What I already know

* 项目已有 `read-file` 和 `bash` 两个内建工具
* 工具架构：`AgentTool` 接口、`ToolRegistry`、`tool-dispatch.ts`
* 会话记录已完整持久化：`SessionToolCallRecord` 包含完整 input
* 用户选择方案 D：基于会话历史审计，不引入新状态
* 参考 Claude Code 的 Edit/Write 工具设计

## Assumptions (temporary)

* edit-file 和 write-file 都需要权限确认（riskLevel: "write"）
* read-before-edit 检查在 `dispatchToolCall` 层完成
* 检查函数保持同步，不 RxJS 化
* 暂不实现"文件是否被外部修改"检查（未来扩展）

## Open Questions

（已全部解决）

## Requirements (evolving)

* 实现 edit-file 工具：精确字符串替换
  * 参数：`path`, `old_string`, `new_string`, `replace_all?`
  * 默认 `old_string` 必须唯一匹配，否则报错
  * `replace_all: true` 时替换所有匹配项
* 实现 write-file 工具：完整覆写文件
  * 参数：`path`, `content`
  * 自动创建文件及必要的父目录
  * 覆写已有文件时需要 read-before-edit 检查
* 实现 read-before-edit 安全检查
  * 基于会话历史审计，不引入新状态
  * 错误消息带操作提示："必须先读取文件 /path 才能编辑。请使用 /read 命令先读取文件。"
* 两个工具都需要权限确认
* 集成到 default-registry

## Acceptance Criteria (evolving)

* [ ] `edit-file` 能精确替换文件中的字符串
* [ ] `edit-file` 在 `old_string` 匹配多处时报错（除非 `replace_all: true`）
* [ ] `write-file` 能创建新文件（包括父目录）
* [ ] `write-file` 能覆写已有文件
* [ ] 未读取文件时 edit/write 返回明确错误（带操作提示）
* [ ] 权限系统正确拦截写操作（riskLevel: "write"）
* [ ] `npm run check` 通过

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 真实模型 provider 的 tool calling 支持
* 文件外部修改检测（hash 检查）
* 路径遍历攻击防护（read-file 已有，可复用）
* MCP 集成

## Technical Notes

* 相关文件：
  * `src/tools/tool-types.ts` — AgentTool 接口
  * `src/tools/read-file.ts` — 参考实现
  * `src/tools/bash.ts` — 参考实现
  * `src/tools/default-registry.ts` — 工具注册
  * `src/runtime/tool-dispatch.ts` — 需要增加 read-before-edit 检查
  * `src/runtime/event-types.ts` — SessionToolCallRecord 已有完整 input
* Claude Code 参考文档：https://code.claude.com/docs/en/tools-reference.md

## Technical Approach

### 新增文件

```
src/tools/edit-file.ts       — edit-file 工具实现
src/tools/write-file.ts      — write-file 工具实现
src/runtime/file-audit.ts    — read-before-edit 检查函数
```

### 关键函数签名

```typescript
// src/runtime/file-audit.ts
export function checkReadBeforeEdit(params: {
  toolName: string;
  filePath: string;
  history: SessionRecord[];
}): { ok: boolean; error?: string };

// src/tools/edit-file.ts
export function createEditFileTool(): AgentTool {
  return {
    name: "edit-file",
    riskLevel: "write",
    async execute(input, context) { ... }
  };
}

// src/tools/write-file.ts
export function createWriteFileTool(): AgentTool {
  return {
    name: "write-file",
    riskLevel: "write",
    async execute(input, context) { ... }
  };
}
```

### 实现步骤

1. 创建 `src/runtime/file-audit.ts` — 检查函数
2. 修改 `src/runtime/tool-dispatch.ts` — 在 dispatch 前调用检查
3. 创建 `src/tools/edit-file.ts` — 工具实现
4. 创建 `src/tools/write-file.ts` — 工具实现
5. 修改 `src/tools/default-registry.ts` — 注册新工具
6. 添加测试覆盖
