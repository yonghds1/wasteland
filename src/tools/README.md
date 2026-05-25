# Tool 层

本目录承载工具运行时和内建工具实现：

- `default-registry.ts` — 默认工具注册表
- `tool-types.ts` — 工具类型定义（AgentTool, ToolCall, ToolExecutionResult 等）
- `tool-registry.ts` — 工具注册表
- `tool-runner.ts` — 工具运行器

## 内建工具

| 工具 | 文件 | 风险等级 | 说明 |
|------|------|----------|------|
| read-file | `read-file.ts` | read | 读取文件内容（支持 offset/limit） |
| glob | `glob.ts` | read | 按 glob 模式查找文件 |
| grep | `grep.ts` | read | 在文件中搜索文本（支持正则） |
| list-directory | `list-directory.ts` | read | 列出目录内容（支持递归） |
| web-fetch | `web-fetch.ts` | execute | HTTP 请求（支持 GET/POST） |
| bash | `bash.ts` | execute | 执行 shell 命令 |
| edit-file | `edit-file.ts` | write | 编辑文件（read-before-edit 安全检查） |
| write-file | `write-file.ts` | write | 写入文件（read-before-write 安全检查） |
| spawn_agent | `spawn-agent.ts` | execute | 创建子 Agent（占位，实际由 dispatchToolCall 拦截） |

## 后续可继续扩展

- `git.ts` — Git 操作工具
- `web-search.ts` — 网络搜索工具
- `clipboard.ts` — 剪贴板工具
