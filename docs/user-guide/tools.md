# 工具使用指南

本指南介绍 wasteland 的所有内建工具。

## 工具概览

wasteland 内置 17 个工具，分为以下几类：

| 类别 | 工具 |
|------|------|
| 文件操作 | read-file, write-file, edit-file |
| 目录操作 | list-directory, glob |
| 搜索 | grep |
| 命令执行 | bash |
| 网络 | web-fetch, http-request |
| 多 Agent | spawn-agent |
| 用户交互 | ask-user |
| MCP | mcp-client |

## 文件操作工具

### read-file

读取文件内容。

```bash
wasteland chat --provider jdcloud --message "读取 package.json"
```

**参数**:
- `path`: 文件路径（必填）
- `startLine`: 起始行号（可选）
- `endLine`: 结束行号（可选）

**示例**:
```
读取 package.json
读取 src/index.ts 的前 10 行
读取 README.md 的第 50-100 行
```

### write-file

写入文件内容。

```bash
wasteland chat --provider jdcloud --message "创建文件 hello.ts，内容是 console.log('hello')"
```

**参数**:
- `path`: 文件路径（必填）
- `content`: 文件内容（必填）

**注意**: 需要先读取文件才能写入（read-before-write 安全检查）

### edit-file

编辑文件内容。

```bash
wasteland chat --provider jdcloud --message "在 src/index.ts 的第 5 行添加 import"
```

**参数**:
- `path`: 文件路径（必填）
- `content`: 新内容（必填）
- `startLine`: 起始行号（可选）
- `endLine`: 结束行号（可选）

**注意**: 需要先读取文件才能编辑（read-before-write 安全检查）

## 目录操作工具

### list-directory

列出目录内容。

```bash
wasteland chat --provider jdcloud --message "列出当前目录"
```

**参数**:
- `path`: 目录路径（可选，默认当前目录）
- `recursive`: 是否递归列出（可选，默认 false）

### glob

使用 glob 模式搜索文件。

```bash
wasteland chat --provider jdcloud --message "搜索所有 .ts 文件"
```

**参数**:
- `pattern`: glob 模式（必填）
- `path`: 搜索路径（可选，默认当前目录）

**示例**:
```
搜索所有 .ts 文件: **/*.ts
搜索 src 目录下的所有文件: src/**/*
搜索所有测试文件: **/*.test.js
```

## 搜索工具

### grep

在文件中搜索内容。

```bash
wasteland chat --provider jdcloud --message "搜索所有包含 TODO 的文件"
```

**参数**:
- `pattern`: 搜索模式（必填）
- `path`: 搜索路径（可选，默认当前目录）
- `include`: 文件过滤器（可选）

**示例**:
```
搜索所有包含 TODO 的文件
搜索 src 目录下的 TypeScript 文件中的 FIXME
搜索所有包含 import 的 .ts 文件
```

## 命令执行工具

### bash

执行 bash 命令。

```bash
wasteland chat --provider jdcloud --message "查看 git 状态"
```

**参数**:
- `command`: 要执行的命令（必填）

**示例**:
```
查看 git 状态: git status
查看当前目录: pwd
查看文件列表: ls -la
运行测试: npm test
```

**安全说明**: bash 工具会执行任意命令，请谨慎使用。

## 网络工具

### web-fetch

获取网页内容。

```bash
wasteland chat --provider jdcloud --message "获取 https://example.com 的内容"
```

**参数**:
- `url`: 网页 URL（必填）

### http-request

发送 HTTP 请求。

```bash
wasteland chat --provider jdcloud --message "发送 GET 请求到 https://api.example.com"
```

**参数**:
- `url`: 请求 URL（必填）
- `method`: HTTP 方法（可选，默认 GET）
- `headers`: 请求头（可选）
- `body`: 请求体（可选）

## 多 Agent 工具

### spawn-agent

创建子 Agent 执行任务。

```bash
wasteland chat --provider jdcloud --message "创建一个子 Agent 来分析代码"
```

**参数**:
- `name`: 子 Agent 名称（必填）
- `task`: 任务描述（必填）
- `model`: 模型选择（可选）
- `tools`: 工具列表（可选）

**示例**:
```
创建子 Agent 分析代码
创建 researcher 子 Agent 搜索信息
创建 developer 子 Agent 编写代码
```

## 用户交互工具

### ask-user

向用户提问获取输入。

```bash
wasteland chat --provider jdcloud --message "问我一个问题：你今天心情如何？"
```

**参数**:
- `question`: 问题（必填）
- `options`: 选项列表（可选）

**示例**:
```
问我一个问题：你今天想做什么？
问我一个选择题：A. 读取文件 B. 执行命令
```

## MCP 工具

### mcp-client

使用 MCP 协议调用外部工具。

```bash
# 需要配置 MCP 服务器
wasteland chat --provider jdcloud --message "使用 MCP 工具执行任务"
```

**参数**: 根据 MCP 服务器定义

## 工具组合使用

wasteland 的 AI 会自动组合使用多个工具完成复杂任务。

### 示例 1: 代码分析

```bash
wasteland chat --provider jdcloud --message "分析这个项目的架构，包括：1. 列出目录结构 2. 读取主要文件 3. 总结功能"
```

### 示例 2: 代码重构

```bash
wasteland chat --provider jdcloud --message "重构 src/index.ts：1. 读取文件 2. 分析代码 3. 提出改进建议 4. 应用修改"
```

### 示例 3: 测试执行

```bash
wasteland chat --provider jdcloud --message "运行测试并分析结果：1. 执行 npm test 2. 分析输出 3. 修复失败的测试"
```

## 工具权限

不同工具有不同的权限级别：

| 风险级别 | 工具 | 默认权限 |
|----------|------|----------|
| read | read-file, list-directory, glob, grep | 自动允许 |
| low | web-fetch, http-request, ask-user | 自动允许 |
| execute | bash, spawn-agent | 需要确认 |
| write | write-file, edit-file | 需要确认 |

## 故障排除

### 工具执行失败

```
Error: Tool execution failed
```

**解决方案**:
1. 检查工具参数是否正确
2. 检查文件路径是否存在
3. 检查权限是否足够

### 权限被拒绝

```
Permission denied
```

**解决方案**:
1. 使用 `--permission-mode bypass_permissions` 跳过权限检查
2. 或者在交互模式中确认权限请求
