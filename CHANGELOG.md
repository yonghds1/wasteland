# 更新日志

本文档记录 wasteland 项目的主要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
