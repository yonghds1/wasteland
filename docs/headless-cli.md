# Wasteland 无头命令行 (Headless CLI) 参考手册

本文档全面梳理 Wasteland 目前支持的**无头（Headless）命令行模式**、输入输出契约、权限安全策略、退出码规范以及 CI/CD 自动化集成指南。

---

## 1. 概述与核心特性

Wasteland 除了提供交互式终端图形界面（TUI / REPL）外，还具备工业级标准（对标 Claude Code / Codex CLI / OpenCode）的无头非交互式运行能力。

### 核心特性
- **顶层参数直传**：支持位置参数或 `-p/--prompt` 直接下发任务，无需繁琐声明子命令。
- **UNIX 管道原生支持**：自动感知 `stdin` 管道流，`cat prompt.txt | wasteland` 零配置直通。
- **机器可读结构化协议**：提供 `--json` 与 `--output-format json`，输出纯净合法 JSON Envelope。
- **规范 POSIX 退出码**：杜绝“Exit Code 0 假成功”，精准区分成功、模型异常、死循环熔断与中断。
- **非交互安全与交互回退**：自动识别无头执行上下文，高危操作安全阻断，`ask-user` 安全降级。
- **异步生态通知闭环**：单轮与管道流内置 `NotificationBridge`，支持后台任务事件侦听。

---

## 2. 命令调用方式与语法

Wasteland 无头模式支持以下四种调用姿态：

### 2.1 顶层位置参数直传（推荐）
直接在根命令后附带 Prompt 字符串，系统自动识别并分发至无头 Agent 执行链路：
```bash
wasteland "请分析 src/cli.ts 的主要职责并列出核心导出函数"
```

### 2.2 选项式 Prompt 直传 (`-p` / `--prompt`)
使用 `-p` 或 `--prompt` 参数显式传递提示词：
```bash
wasteland -p "审查当前 Git 变更并指出潜在的空指针异常"
# 亦兼容旧版 -m / --message
wasteland -m "检查 package.json 依赖版本"
```

### 2.3 UNIX 管道直通 (Pipe / STDIN)
当系统检测到标准输入（stdin）为非 TTY 管道时，自动进入无头执行模式，无需手动附加子命令：
```bash
# 管道输入上下文
git diff | wasteland -p "根据以上 diff 生成符合 Angular 规范的 commit message"

# 文件内容直通
cat error.log | wasteland "分析该错误日志并给出排查建议"

# 多命令管道级联
curl -s https://api.github.com/repos/owner/repo/releases/latest | wasteland "提取变更要点"
```

### 2.4 显式 `chat` 子命令调用
可通过显式 `chat` 子命令调用所有无头参数：
```bash
wasteland chat -p "编写一个快速排序的 TypeScript 实现" --provider openai
```

---

## 3. 命令行参数完整列表

无头模式支持如下参数与标志位：

| 参数 / 标志位 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `[prompt]` | 位置参数 | 直接执行的 Prompt 文本 | `wasteland "hello"` |
| `-p, --prompt <text>` | 字符串 | 提示词（与 `-m` 等价，优先取 `--prompt`） | `-p "优化这段代码"` |
| `-m, --message <text>` | 字符串 | 单次执行提示词（向后兼容别名） | `-m "修复单测"` |
| `--provider <name>` | 字符串 | 指定调用的模型提供商（不再占用 `-p` 短参数） | `--provider deepseek` |
| `-r, --role <name>` | 字符串 | 指定运行的角色（加载对应角色 Prompt 与配置） | `-r architect` |
| `--output-format <fmt>` | 字符串 | 输出格式：`text`（默认）、`json`、`stream-json` | `--output-format json` |
| `--json` | 标志位 | `--output-format json` 的快捷方式 | `--json` |
| `--dangerously-skip-permissions` | 标志位 | 绕过权限检查，无头环境下自动放行写文件与执行命令 | `--dangerously-skip-permissions` |
| `--permission-mode <mode>` | 字符串 | 显式指定权限模式：`default`、`accept_edits`、`bypass_permissions` | `--permission-mode accept_edits` |
| `--mode <mode>` | 字符串 | Agent 组织模式：`single`（单 Agent）或 `multi`（多 Agent） | `--mode single` |
| `--debug` | 标志位 | 启用诊断日志（日志写入 `.wasteland/trace/` 或 stderr） | `--debug` |
| `--debug-format <fmt>` | 字符串 | 调试日志格式：`pretty`（默认）或 `jsonl` | `--debug-format jsonl` |

---

## 4. 输出契约与格式化 (Output Contracts)

### 4.1 纯文本模式 (`text`，默认)
当通过管道或无头运行且未指定 `--json` 时：
- `stdout` 仅输出模型最终回答文本，剥离 ANSI 装饰与光标擦除序列；
- 工具调用、调试信息与状态更新统一走 `stderr` 或日志落盘，确保标准输出可被 `grep`、`awk` 等脚本安全消费。

### 4.2 机器可读 JSON 模式 (`--json` / `--output-format json`)
为满足 CI/CD、自动化脚本及 Web/IDE 集成，提供结构化的 JSON 响应 Envelope：

```bash
wasteland -p "计算 2+2 等于几" --json
```

**输出格式示例**：
```json
{
  "sessionId": "2026-10-18_123456_a1b2",
  "status": "success",
  "finishReason": "stop",
  "exitCode": 0,
  "content": "2 + 2 等于 4。",
  "error": null
}
```

**JSON Envelope 字段说明**：
- `sessionId` (string)：本次运行生成的会话唯一 ID，可用于后续执行 `wasteland resume <sessionId>`。
- `status` (`"success"` | `"failed"`): 任务执行状态总结。
- `finishReason` (`"stop"` | `"error"` | `"max_steps"` | `"abort"`): 会话结束的底层核心原因。
- `exitCode` (number): 对应进程的退出码。
- `content` (string | undefined): 大模型给出的最终回答文本正文。
- `error` (string | undefined): 若发生故障（如 Provider 限流/鉴权失败），记录具体的错误详细信息。

---

## 5. 权限治理与非交互安全策略

在无头环境下，由于没有终端用户实时输入 `y/n`，Wasteland 具备明确的安全降级与放行契约：

1. **默认模式 (`default`) 下的高危操作拦截**：
   - 读操作（`read` 风险等级，如读文件、目录列表）：自动放行。
   - 写操作与命令执行（`write`/`execute`，如 bash、write-file）：因缺乏交互通道，**自动阻断（deny）**，阻断原因精准标记为：
     `（非交互无头环境自动阻断）`
     大模型知晓环境处于无头模式后会自动寻找只读替代方案，不会产生“被人类用户拒绝”的认知幻觉。
2. **完全自动化模式 (`--dangerously-skip-permissions`)**：
   - 在受信的 CI/CD Runner 或沙箱容器中，传入该标志可全自动放行工具调用。
3. **`ask-user` 工具的确定性降级**：
   - 若大模型调用了 `ask-user` 尝试向用户提问：
     - 若参数提供了有效默认值 `default: "..."`：系统自动以默认值作为结果成功返回。
     - 若未提供 `default`：系统明确返回 `tool_failed` 错误（`非交互/无头模式下无法进行用户询问 (ask-user)`），严禁静默伪成功。

---

## 6. 进程退出码规范 (Exit Codes)

为了保证 CI 管道（如 GitHub Actions、Makefile）能够根据 `$?` 精准判断任务状态，Wasteland 实现了 POSIX 标准化的退出码规范：

| 退出码 | 标识 (FinishReason) | 含义与场景 |
| :---: | :--- | :--- |
| **`0`** | `stop` | **成功完成**：大模型正常响应完毕，所有工具步骤执行成功并给出结论。 |
| **`1`** | `fatal_error` | **通用致命错误**：命令行参数非法、配置损坏、空标准输入（empty stdin）等。 |
| **`2`** | `error` | **Provider / 模型故障**：API 网络超时、鉴权失败 (401)、超出配额 (429/Quota)、模型服务崩溃。 |
| **`3`** | `max_steps` | **步数超限 / 死循环熔断**：单轮步数耗尽（超出 `maxStepsPerTurn`）或触发 Doom Loop 保护机制。 |
| **`130`** | `abort` | **用户主动中断**：接收到 SIGINT（Ctrl+C）信号或主动取消。 |

---

## 7. 辅助无头管理子命令

除了主执行命令外，Wasteland 的以下子命令均原生支持无头/脚本化调用：

### 7.1 会话管理 (`wasteland sessions`)
```bash
# 以 JSON 格式输出最近 5 个会话列表
wasteland sessions --limit 5 --json

# 格式输出:
# [
#   { "id": "2026-10-18_120000_abcd", "createdAt": "...", "messageCount": 4, "summary": "..." }
# ]
```

### 7.2 技能扩展管理 (`wasteland skills`)
```bash
# 无头列出所有已安装的外部技能
wasteland skills list

# 从本地目录非交互安装新技能
wasteland skills install ./my-skill

# 从 GitHub 仓库非交互安装
wasteland skills install https://github.com/user/agent-skill.git

# 移除技能
wasteland skills remove my-skill
```

### 7.3 工作流调度 (`wasteland chat -m "/workflows"`)
```bash
# 查看所有可用工作流及运行状态
wasteland -p "/workflows status"

# 执行内置工作流
wasteland -p "/workflows review ."
```

### 7.4 会话导出 (`wasteland export`)
```bash
# 导出指定会话为 Markdown 或 JSON
wasteland export <session-id> --output report.md
```

---

## 8. CI/CD 与自动化集成最佳实践

### 8.1 GitHub Actions 工作流示例
```yaml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Wasteland
        run: npm install -g wasteland

      - name: Run Headless Review
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          git diff origin/main...HEAD | \
          wasteland "对以上 PR Diff 进行安全与性能审查，给出评分和改进建议" \
            --dangerously-skip-permissions \
            --output-format json > review_result.json

      - name: Parse Review Outcome
        run: |
          STATUS=$(jq -r '.status' review_result.json)
          if [ "$STATUS" != "success" ]; then
            echo "审查失败: $(jq -r '.error' review_result.json)"
            exit 1
          fi
          echo "审查通过，大模型意见:"
          jq -r '.content' review_result.json
```

### 8.2 Shell 脚本链式处理
```bash
#!/usr/bin/env bash
set -euo pipefail

PROMPT="分析 README.md 并提取出所有支持的命令列表"
RESPONSE=$(wasteland -p "$PROMPT" --json)

EXIT_CODE=$(echo "$RESPONSE" | jq -r '.exitCode')
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "任务失败，退出码: $EXIT_CODE"
  echo "原因: $(echo "$RESPONSE" | jq -r '.error')"
  exit "$EXIT_CODE"
fi

echo "任务产出:"
echo "$RESPONSE" | jq -r '.content'
```
