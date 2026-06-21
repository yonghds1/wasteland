# 更新日志

本文档记录 wasteland 项目的主要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 2026-06-21

### 新增

- **web-search 增强**
  - cheerio HTML 解析：使用 cheerio 替换正则表达式解析，提升稳定性
  - 内存 LRU 缓存：避免重复搜索，提升性能
  - 缓存管理：clearSearchCache() 和 getCacheSize() 函数

### 改进

- **web-search 工具**
  - 重构 HTML 解析逻辑：从正则表达式迁移到 cheerio
  - 添加搜索结果缓存：基于查询字符串的 LRU 缓存
  - 保持向后兼容：搜索结果格式完全一致

### 依赖

- 新增 `cheerio` 依赖（HTML 解析库）

## [0.3.0] - 2026-06-21

### 新增

- **MCP 协议完善**
  - 传输抽象层：创建 Transport 接口，支持 stdio 和 SSE 两种传输方式
  - SSE 传输支持：通过 HTTP Server-Sent Events 连接远程 MCP 服务器
  - Resources 功能：resources/list 和 resources/read 方法
  - Prompts 功能：prompts/list 和 prompts/get 方法
  - Resources 工具：mcp-resource-list 和 mcp-resource-read
  - Prompts 工具：mcp-prompt-list 和 mcp-prompt-get

### 改进

- **MCP 客户端**
  - 重构 MCPClient 使用 Transport 接口，解耦传输逻辑
  - 支持配置：`{ "url": "https://..." }` 格式（SSE 模式）
  - 初始化握手时声明 resources 和 prompts 能力

### 配置

- MCP 服务器配置支持 `url` 字段（SSE 模式）
- MCP 服务器配置支持 `headers` 字段（SSE 认证）

## [0.2.0] - 2026-06-16

### 新增

- **并行 Agent 执行**
  - 多个 spawn_agent 调用可并行执行
  - 基于 RxJS 的 Buffer + Batch 模式（符合业界标准）
  - Fail-fast 策略：一个 Agent 失败，取消其他 Agent
  - 可配置并发上限（settings.json: parallel.maxConcurrency，默认 -1 无限制）
  - 并行结果按 tool_call.id 排序，保持事件顺序
  - TUI Footer 并行状态栏显示

### 改进

- **Agent 运行时**
  - 优化 provider 事件处理：使用 toArray 缓冲事件，支持批量处理
  - 工具调用分发：spawn_agent 并行执行，其他工具串行执行
  - 状态管理：支持按 ID 排序的工具结果累积

### 配置

- 新增 `parallel.maxConcurrency` 配置项
- 新增 `WASTELAND_MAX_CONCURRENCY` 环境变量

## [0.1.0] - 2026-05-29

### 新增

- **核心运行时**
  - 基于 RxJS 的响应式 Agent Loop
  - 多步骤工具调用支持
  - 会话管理和持久化

- **Provider 支持**
  - OpenAI 兼容 API（OpenAI、Ollama、DeepSeek 等）
  - Anthropic Claude API
  - 本地模拟 Provider

- **工具系统**
  - 文件操作：read-file, write-file, edit-file
  - 命令执行：bash
  - 搜索：glob, grep
  - 网络：web-fetch, http-request
  - 子 Agent：spawn-agent
  - MCP 协议支持

- **技能系统**
  - 技能发现和注册
  - 内置技能：help, status, tools, init, context
  - 支持 JSON 和 TypeScript 技能定义

- **配置系统**
  - 层级配置合并
  - $auth 安全引用
  - 环境变量覆盖

- **TUI 界面**
  - Ink/React 终端 UI
  - 会话视图、调试视图、配置页面
  - 焦点管理和键盘导航

- **国际化**
  - 完整的 i18n 支持（英文、中文）

- **皮肤系统**
  - 主题加载和切换
  - 内置 "immortan-joe" 皮肤

### 代码质量

- 添加 ESLint 和 Prettier 支持
- 清理 deprecated 代码
- 修复 Claude Provider 注册问题
- 移除 unused imports 和 variables

### 文档

- 完整的架构文档
- 贡献指南 (CONTRIBUTING.md)
- 更新日志 (CHANGELOG.md)

## [未发布]

### 新增

- **ask-user 工具**
  - 允许 Agent 向用户提问并获取输入
  - `UserInputBridge` 桥接机制：agent loop 与 UI 层之间的输入路由
  - RuntimeEvent 扩展：`user_input_requested`、`user_input_received` 事件
  - UI 集成：交互模式下自动检测用户输入请求并路由响应
  - 权限控制：ask-user 为只读工具，自动允许执行
  - 端到端测试：验证完整的用户交互流程

- **Session Resume 功能**
  - `sessions` 命令：列出历史会话，支持搜索、过滤和排序
  - `sessions show <id>`：查看会话详情和完整消息历史
  - `sessions delete <id>`：删除会话及其子 Agent 会话
  - `sessions stats`：查看会话统计信息
  - `resume` 命令：恢复之前的会话，支持交互模式和单次消息模式
  - SessionIndex：高效的会话索引和检索系统
  - 端到端测试：验证完整的会话恢复流程

- **测试基础设施**
  - 迁移到 vitest 测试框架
  - 更新 package.json test 脚本使用 vitest
  - 修复测试文件语法错误
  - 添加条件检查避免跳过测试失败

### 计划

- CI/CD 流水线
- 更多测试覆盖
- 性能优化
- 更多 Provider 支持
