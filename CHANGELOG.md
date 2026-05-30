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

### 计划

- CI/CD 流水线
- 更多测试覆盖
- 性能优化
- 更多 Provider 支持
