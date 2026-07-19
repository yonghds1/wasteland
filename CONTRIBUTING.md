# 贡献指南

感谢你对 wasteland 项目的关注！本文档将帮助你快速上手开发。

## 开发环境要求

- **Node.js**: >= 20
- **npm**: >= 9

## 快速开始

```bash
# 1. 克隆仓库
git clone <repository-url>
cd wasteland

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run cli          # 使用 tsx 直接运行
npm run cli:build    # 先构建再运行
```

## 项目结构

```
src/
├── cli.ts              # CLI 入口
├── chat/               # RxJS 回复管道
├── commands/           # CLI 子命令
├── config/             # 配置加载和解析
├── locales/            # 国际化支持
├── prompts/            # 提示词组装系统
├── providers/          # AI Provider 抽象层
├── runtime/            # 核心运行时（Agent Loop）
├── skills/             # 技能系统
├── skins/              # 皮肤/主题系统
├── tools/              # 工具系统
├── tui/                # 终端 UI（Ink/React）
├── ui/                 # 经典终端 UI
└── utils/              # 工具函数
```

## 开发工作流

### 代码质量

```bash
# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 自动修复 lint 问题
npm run lint:fix

# 代码格式化
npm run format

# 检查格式
npm run format:check

# 完整检查（类型 + lint + i18n + 测试）
npm run check
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
node --test test/permission-gate.test.js
```

### 构建

```bash
# 清理并构建
npm run clean
npm run build
```

## 代码规范

### TypeScript

- 使用 strict 模式
- 优先使用具体类型，避免 `any`
- 使用判别联合（Discriminated Unions）处理状态
- 导出类型时使用 `export type`

### 命名规范

- 文件名：kebab-case（如 `agent-loop.ts`）
- 类型名：PascalCase（如 `AgentProvider`）
- 函数名：camelCase（如 `createToolRegistry`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_RETRIES`）

### 错误处理

- 使用结构化的 `ToolExecutionResult` 返回工具执行结果
- 异常时提供有意义的错误信息
- 保持错误链（使用 `cause`）

### 国际化

- 所有用户可见的字符串使用 `t()` 函数
- 在 `src/locales/en.json` 和 `src/locales/zh.json` 中添加翻译
- 运行 `npm run validate:i18n` 验证翻译完整性

## 提交规范

- 使用清晰的提交信息
- 前缀建议：`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## 问题反馈

- 使用 GitHub Issues 报告 bug
- 提供复现步骤和环境信息
- 附上相关的日志输出
