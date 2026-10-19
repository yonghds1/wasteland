# ☢️ WASTELAND

<div align="center">

```text
██╗    ██╗ █████╗ ███████╗████████╗███████╗██╗      █████╗ ███╗   ██╗██████╗ 
██║    ██║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║     ██╔══██╗████╗  ██║██╔══██╗
██║ █╗ ██║███████║███████╗   ██║   █████╗  ██║     ███████║██╔██╗ ██║██║  ██║
██║███╗██║██╔══██║╚════██║   ██║   ██╔══╝  ██║     ██╔══██║██║╚██╗██║██║  ██║
╚███╔███╔╝██║  ██║███████║   ██║   ███████╗███████╗██║  ██║██║ ╚████║██████╔╝
 ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
```

### 自由中立 · 终端第一公民 · 工业级 AI 编程工作台

**[English](./README.en.md) | [简体中文](./README.md)**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![RxJS](https://img.shields.io/badge/Reactive-RxJS-e10079.svg)](https://rxjs.dev/)
[![Ink](https://img.shields.io/badge/TUI-Ink%2FReact-00d8ff.svg)](https://github.com/vadimdemedes/ink)
[![APCA Contrast](https://img.shields.io/badge/Contrast-APCA%20Validated-success.svg)](https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup)
[![MCP](https://img.shields.io/badge/MCP-1.0%20Ready-purple.svg)](https://modelcontextprotocol.io/)

</div>

---

## 📖 简介与设计哲学

**Wasteland** 是一个专为严肃开发者打造的自由中立、以现代终端 TUI 为第一公民、基于 **TypeScript + RxJS + Ink** 构建的全功能开源 AI 编程工作台。

在当下的 AI 编码辅助工具生态中，开发者往往面临商业锁定、粗暴污染 Git 分支、终端长对话卡顿崩溃、无法直观编排多 Agent 等痛点。**Wasteland 拒绝妥协**：
- **模型主权 (Model Sovereignty)**：彻底中立，自由切换 DeepSeek、MiniMax、Claude、OpenAI、Qwen、GLM、Ollama；
- **版本纯粹 (Zero-Pollution Version Control)**：独创底层 Git Plumbing 隐形隔离时光机，永不污染你的业务提交树与 Git Log；
- **极致渲染性能 (Constant-Frame TUI)**：基于严格 1:1 视口虚拟化高度预算切片，即便 500 轮超长对话依旧保持毫秒级流畅响应；
- **沉浸式极客情感 (Wasteland Punk Persona)**：内置 7 款通过 W3C APCA 终端高可读校验的废土朋克角色皮肤，提供从思考到交付的全流程情感陪伴。

---

## 🌟 六大杀手级核心特性

### 1. ⏱️ Git Checkpoint 隐形隔离时光机 (Zero-Pollution Invisible Checkpoints)
传统 AI 工具在尝试版本回退时，要么粗暴提交大量脏 commit 污染你的主分支 `git log`，要么简单依赖内存撤销导致外部修改被无情冲掉。
- **底层 Git Plumbing 直连**：直接通过 `git write-tree`、`git commit-tree`、`git update-ref` 构建工作区快照，将快照严格隔离在专属的 `refs/wasteland/` 命名空间中。
- **零污染业务仓库**：普通 `git status`、`git log` 和远端 push 历史 100% 干净透明，无任何冗余垃圾分支。
- **原子级时光机指令**：
  - `/undo [turnId]`：秒级回滚到上一轮或指定历史轮次，并自动将该轮原始 Prompt 回填至输入框草稿区；
  - `/redo`：当撤销后后悔时，基于自动创建的救援快照（rescue checkpoint）一键重做恢复；
  - `/diff [turnId]`：以精美的彩色 Unified Diff 形式，直观查看当前工作区与快照之间的代码差异；
  - `/checkpoints`：完整列出当前会话的所有历史快照节点树与影响文件列表。
- **3-Way 哈希冲突安全拦截**：回滚前自动比对工作区最新文件哈希与快照基准哈希。一旦检测到用户在外部 IDE（VSCode、Cursor、Neovim 等）中并发修改了这些文件，时光机会**立即安全阻断回滚**，列出冲突文件详情并保护用户劳动成果，亦支持 `/undo --force` 显式强制覆盖。

### 2. 🎭 独创废土沉浸式 Persona 与皮肤系统 (Skin System)
告别单调冰冷、千篇一律的 "AI 助手"。Wasteland 赋予工作台极致的废土朋克灵魂与人设张力：
- **7 款内置废土角色**：
  - 👑 **不死老蕉 (`warlord-immortal`)**：全局编排指挥官，号令狂暴车队碾碎复杂工程阻碍；
  - 🏍️ **疯子麦克 (`road-nomad`)**：单兵全栈突击手，一人一车以极致速度切入废墟绝境；
  - 🦾 **独臂弗莎 (`fury-vanguard`)**：攻坚先锋，铁爪强行破拆扭曲残骸，带队杀向绿洲；
  - 🔧 **巨汉瑞克 (`v8-mechanic`)**：修配重构大师，重型气焊与超频化油器，焊死一切架构松脱；
  - 📡 **暴走纳克斯 (`sand-scout`)**：雷达搜寻侦察兵，沙暴中敏锐嗅出关键补给与深层线索；
  - 🎯 **弹头麦哲 (`bullet-tester`)**：火力测试质检官，万发穿甲弹扫射，让一切暗伤在烈火中现形；
  - 🎸 **电音杜夫 (`doof-analyst`)**：拓扑重低音分析师，喷火吉他掌控全局节奏，阵列对齐毫厘不差。
- **100% APCA 色彩对比度校验**：基于 W3C APCA (Advanced Perceptual Contrast Algorithm 0.0.98G-4g) 视觉对比度算法全面核验，杜绝低对比度眩光，深浅终端皆享巅峰可读性。
- **全生命周期情感共鸣**：每个角色均具备专属的问候文案（greeting）、思考文案（thinking）与任务凯旋口头禅（catchphrases）。
- **多层级无缝扩展**：支持内置预设、用户全局级（`~/.wasteland/skins.json`）与项目级（`.wasteland/skins.json`）多层级继承与动态热切换。

### 3. 🖥️ 长会话严格 1:1 视口虚拟化 (Strict 1:1 Viewport Virtualization)
突破 Ink / React 在终端渲染长列表的致命性能瓶颈：
- **虚拟行高度预算裁剪**：通过 `flattenMessageToLines` 与 `useChatScroll` 严格按终端行高（Height Budget）切片。
- **常数级 DOM 节点挂载**：无论当前会话进行了 10 轮还是 500 轮，内存与渲染树中真实挂载的节点始终锁定在当前视口范围内的 ~30 个虚拟行，彻底消除卡顿、光标漂移与内存泄漏。
- **全功能视口导航**：完整支持鼠标滚轮滚动、右侧平滑滚动条拖拽跳转、`PageUp` / `PageDown` / `Shift+↑↓` 键盘平滑滚动、以及新消息未读指示器。

### 4. 🌳 多 Agent 协作全景树状看板 (DAG Tree View)
基于 **Agents-as-Tools** 架构，将复杂任务解耦为多智能体协同流水线：
- **实时拓扑树状呈现**：主角色（`orchestrator`）通过 `spawn_agent` 派发子任务，右侧 Inspector / Tree 面板动态生成直观的 Main-to-Sub Agent 树状拓扑。
- **多维生命周期徽标**：清晰展示各个子 Agent 的执行状态（`[RUNNING]`、`[COMPLETED]`、`[FAILED]`），并实时同步各自的 Steps 步数与 Token 资源消耗。
- **键盘一键聚焦穿梭**：支持方向键导航并一键回车聚焦目标子 Agent 的独立消息视口，或通过快捷键 `Alt+1` ~ `Alt+9` / `/tab <id>` 极速在各 Agent 的独立运行流间穿梭。

### 5. 🔍 轻量感知引擎 (LPIE - Lightweight Perception & Intelligence Engine)
极致的上下文感知与检索能力，且不依赖任何沉重臃肿的外部本地环境：
- **工作区架构记忆自动装配**：智能识别工作区中的 `CLAUDE.md`、`PROJECT.md` 或 `.wasteland/rules.md`，全自动装配并注入 Agent 提示词上下文，确保代码产出与项目规约严丝合缝。
- **三层自适应极速 Grep 探针**：按优先级自动级联调用 `ripgrep (rg)` 极速探针 ➔ `git-grep` 仓库探针 ➔ `Node.js 并发流` 回退探针。支持前后上下文提取（`contextLines`），任何宿主环境皆可实现亚秒级搜索。
- **零 C++ 依赖符号精准定位 (`find-symbol`)**：摆脱 Tree-sitter 等原生编译依赖与构建报错恶梦，采用高效纯粹的跨语言多语法模式引擎，毫秒级提取 TypeScript、JavaScript、Python、Rust、Go 等主流语言的 classes、interfaces、functions、methods、types 与 enums。

### 6. 🛡️ 开放生态与统一跨平台安全治理 (Open Neutrality & Deep Governance)
- **模型自由中立**：内置 OpenAI 兼容协议栈，一键支持 DeepSeek-V3/R1、MiniMax、Claude 3.5 Sonnet、GPT-4o、Qwen 2.5、GLM-4、本地 Ollama 等模型，随时切换算力。
- **标准 MCP 协议热插拔**：完整支持 Model Context Protocol (MCP) 1.0 标准，支持 `stdio` 与 `sse` 两种传输通道，允许在会话内通过 `/mcp add` 与 `/mcp reload` 实时加载外部工具、资源与提示词。
- **统一 POSIX 路径切面预清洗**：统一收口 Windows 反斜杠、UNC 网络路径与多盘符大小写差异，杜绝跨平台沙箱路径遍历与越界假警报。
- **阶梯式负 PID 进程组安全查杀**：运行外部命令时以进程组运行；在超时或用户中止时，向负 PID（`-pid`）优先投递 `SIGTERM`，宽限期后投递 `SIGKILL`，连根查杀所有子进程与孙进程，绝不残留后台僵尸进程。

---

## ⚔️ 深度横向竞品对比矩阵

| 评估维度 | ☢️ Wasteland | Claude Code | Aider | OpenCode | Cline (VSCode) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **模型中立度与自由度** | 🟢 **完全中立开放**<br>(DeepSeek/MiniMax/Claude/OpenAI/Qwen/GLM/Ollama) | 🔴 **商业强绑定**<br>(仅支持 Anthropic Claude 模型) | 🟡 **支持多模型**<br>(通过 LiteLLM 接入，配置较繁琐) | 🟡 **支持多模型**<br>(需自备多 Provider 配置) | 🟢 **支持多模型**<br>(支持主流商业与本地模型) |
| **UI / UX 终端体验** | 🟢 **现代沉浸式 TUI**<br>(Ink/React 驱动 + 严格视口虚拟化 + 鼠标滚动与拖拽) | 🟡 **传统命令行**<br>(单行 Prompt 交互 + 纯终端滚动打印) | 🟡 **传统命令行**<br>(基于 readline 命令行界面，交互较单一) | 🟡 **极简终端列表**<br>(基础 TUI，缺少高级面板管理) | 🔴 **无独立 TUI**<br>(深度依赖 VSCode 桌面编辑器插件) |
| **历史版本原子回退** | 🟢 **隐形隔离时光机**<br>(`refs/wasteland/` 零污染 git log + 3-Way 冲突拦截) | 🟡 **粗粒度本地撤销**<br>(依赖本地记录，易与外部编辑并发冲突) | 🔴 **严重污染 Git Log**<br>(每次代码变更均提交真实 Git Commit) | 🔴 **无版本时光机**<br>(仅依赖手动代码修改撤销) | 🟡 **简易 Checkpoint**<br>(基于 VSCode 本地历史文件存储) |
| **多 Agent 协同与拓扑** | 🟢 **DAG 全景树状看板**<br>(Main/Sub 实时派发树 + Token 统计 + 单键切换) | 🔴 **单 Agent 串行**<br>(无多 Agent 协同体系与拓扑看板) | 🔴 **单 Agent 对话**<br>(无子 Agent 编排机制) | 🔴 **单 Agent 模式**<br>(无 DAG 协同视图) | 🔴 **单 Agent 模式**<br>(缺乏原生多智能体拓扑看板) |
| **长会话终端虚拟化** | 🟢 **严格 1:1 视口虚拟化**<br>(500+ 轮长对话恒定毫秒级渲染，0 掉帧卡顿) | 🔴 **无虚拟化**<br>(完全依赖终端原生 Buffer，极长输出易卡顿) | 🔴 **无虚拟化**<br>(纯文本线性滚动流) | 🟡 **基础分页**<br>(缺乏按行高度精确预算裁剪) | 🟡 **Webview 渲染**<br>(基于 Chromium，长对话内存占用高) |
| **角色化 Persona 系统** | 🟢 **废土朋克 7 角色皮肤**<br>(APCA 校验配色 + 专属思考文案与凯旋口头禅) | 🔴 **无角色系统**<br>(标准单一严肃语调) | 🔴 **无角色系统**<br>(纯工具属性，无情感陪伴) | 🔴 **无角色系统**<br>(纯工具设定) | 🔴 **无角色系统**<br>(单一默认 Prompt 助手) |
| **MCP 生态热插拔** | 🟢 **完整动态热插拔**<br>(支持 stdio/sse 协议，会话内动态热加载) | 🟡 **部分支持**<br>(需在配置中声明并重启) | 🔴 **不支持 MCP** | 🟡 **实验性支持**<br>(支持部分协议功能) | 🟢 **支持 MCP**<br>(需在插件图形面板中手动配置) |

---

## 🎭 废土朋克 Persona 全景与皮肤系统

Wasteland 拒绝千篇一律的工具冷漠感，为不同的编码场景量身定制了 7 种鲜活的废土朋克灵魂。所有预设均 100% 通过 W3C APCA 终端视觉对比度核验：

| 皮肤标识 (`skinId`) | 角色名称 | 职能定位 | 典型口头禅 / 经典台词 |
| :--- | :--- | :--- | :--- |
| `warlord-immortal` | **不死老蕉** | 主脑总指挥 (Orchestrator) | *"在狂暴之路上，只有交付结果的人才能进入瓦尔哈拉！"* |
| `road-nomad` | **疯子麦克** | 单兵全栈突击 (Single Agent) | *"希望是个危险的东西。但我手里这台单兵 V8 引擎不是。"* |
| `fury-vanguard` | **独臂弗莎** | 攻坚突击队长 (Developer) | *"记住这一刻！我们不是为了苟活而战，我们是为了抵达绿洲！"* |
| `v8-mechanic` | **巨汉瑞克** | 重构与修配大师 (Refactorer) | *"底盘焊得够死，车子才经得起荒原的折腾。"* |
| `sand-scout` | **暴走纳克斯** | 探索与侦察兵 (Researcher) | *"只要还有一条微弱信号，车队就能找到前路。"* |
| `bullet-tester` | **弹头麦哲** | 极限制霸质检官 (Tester) | *"我的火力就像一万发曳光弹，让所有暗伤在扫射中现形！"* |
| `doof-analyst` | **电音杜夫** | 拓扑与战阵分析师 (Analyst) | *"行军就是交响乐，节奏乱了，整台战争机器就会在沙丘上解体！"* |

### 皮肤管理命令 (/skin)

在终端或 TUI 内可自由查看与切换皮肤：

```bash
/skin list              # 列出所有可用皮肤及当前生效标识 (●)
/skin show              # 查看当前正在使用的皮肤详情与色彩属性
/skin load <skinId>     # 切换并加载指定皮肤（例如 /skin load fury-vanguard）
/skin info <skinId>     # 查看目标皮肤的详细问候语、思考文案与口头禅统计
/skin reset             # 重置回系统默认皮肤
```

### 自定义扩展皮肤 (Custom Skins)

你可以在用户全局目录（`~/.wasteland/skins.json`）或当前项目目录（`.wasteland/skins.json`）创建自定义皮肤文件：

```json
{
  "skins": {
    "my-wasteland-hacker": {
      "label": "荒原黑客",
      "colors": {
        "label": "#00ffcc",
        "text": "#e0e0e0",
        "thinking": "#7a7a7a"
      },
      "greeting": [
        "卫星天线展开完毕，暗网信道已就绪，说出你的目标代码！"
      ],
      "thinking": [
        "正在穿透重重防火墙，分析 AST 语法抽象树..."
      ],
      "catchphrases": [
        "代码已被攻破，逻辑闭环无瑕，任务完成！"
      ]
    }
  },
  "singleAgent": {
    "skin": "my-wasteland-hacker"
  }
}
```

---

## ⚡ 快速安装与配置

### 1. 环境准备
- **Node.js**：`>= 20.0.0`
- **npm**：`>= 9.0.0`
- 支持操作系统：Linux、macOS、Windows (WSL / PowerShell)

### 2. 安装与全局链接

```bash
# 克隆仓库
git clone https://github.com/yonghds1/wasteland.git
cd wasteland

# 安装项目依赖
npm install

# 编译项目
npm run build

# 全局链接 CLI 命令（可选，方便在任何目录下执行 wasteland）
npm link
```

### 3. 配置模型 Provider

#### 方式 A：环境变量注入（推荐）

```bash
# DeepSeek (深度求索)
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# 通义千问 (Qwen / DashScope)
export qwen_api_key="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# Anthropic Claude
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxx"

# OpenAI
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# MiniMax
export MINIMAX_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"

# 智谱清言 (GLM)
export GLM_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"
```

#### 方式 B：交互式向导 (InitWizard)
首次在终端启动 `wasteland` 时，系统将自动进入交互式 `InitWizard` 初始化向导，指引你配置默认 Provider、API Key、权限模式与角色皮肤。配置将持久化保存在 `~/.wasteland/auth.json` 与 `~/.wasteland/settings.json` 中。

### 4. 启动 TUI 界面

```bash
# 源码开发调试模式（默认自动启动 TUI）
npm run dev

# 或全局安装后在任意项目根目录下运行
wasteland

# 携带指定参数启动
wasteland --provider deepseek --role orchestrator
```

---

## ⌨️ TUI 交互指南：快捷键与常用命令

### 常用斜杠命令 (Slash Commands)

在 TUI 底部输入框中输入 `/` 即可触发自动补全弹窗：

| 命令分类 | 指令 | 说明 |
| :--- | :--- | :--- |
| **版本时光机** | `/undo [turnId]` | 原子回滚到上一轮或指定轮次；支持 `--force` 忽略外部冲突；自动回填 Prompt |
| | `/redo` | 恢复因撤销而丢弃的代码变动（恢复救援快照） |
| | `/diff [turnId]` | 查看当前工作区或指定历史轮次的彩色 Unified Diff 差异 |
| | `/checkpoints` | 列出当前会话的全部 Git Checkpoint 隐形快照历史 |
| **废土皮肤** | `/skin list` | 列出所有可用皮肤 |
| | `/skin load <id>` | 动态切换并应用指定皮肤 |
| | `/skin show` | 显示当前生效皮肤详细配置 |
| | `/skin info <id>` | 查看皮肤角色文案与色彩配置 |
| | `/skin reset` | 重置恢复至默认皮肤 |
| **MCP 生态** | `/mcp list` | 列出当前已挂载的所有 stdio / sse MCP 服务 |
| | `/mcp add <name> <cmd\|url>` | 动态添加新的 MCP 服务配置 |
| | `/mcp reload` | 重新扫描并热重载 MCP 服务 |
| **视口与编排** | `/tab [序号\|名称]` | 切换当前查看的 Agent 标签视口（如 `/tab 2`） |
| | `/mode [single\|multi]` | 切换单 Agent (Single) 与多 Agent 编排 (Multi) 模式 |
| | `/logs` | 打开全局日志页面（支持 `/logs errors`、`/logs show <id>`、`/logs level <lvl>`） |
| **感知与工作区** | `/context` (`/ctx`) | 查看当前工作区感知概览、依赖树与规则注入状态 |
| | `/init` (`/i`) | 智能扫描当前仓库并在根目录初始化标准 `CLAUDE.md` 架构规约 |
| | `/tools` (`/tls`) | 列出当前所有可用工具清单及其权限级别 |
| | `/status` (`/stat`) | 查看当前运行状态、Token 消耗统计与系统信息 |
| **基础控制** | `/clear` | 清空当前视口消息流 |
| | `/help` (`/h`) | 打开交互式帮助文档视口 |
| | `/exit` (`/quit`) | 弹出安全退出确认弹窗 |

### 键盘交互快捷键

| 按键组合 | 生效区域 | 动作描述 |
| :--- | :--- | :--- |
| `Enter` | 输入框 / 标签栏 | 发送消息 / 确认切换选中 Agent 标签 |
| `Shift + Enter` / `Alt + Enter` | 输入框 | 在当前光标处插入换行 |
| `Escape` | 全局 | 失焦输入框返回导航模式 / 关闭当前帮助或浮层弹窗 |
| `Tab` / `Shift + Tab` | 全局 | 循环切换权限模式 (`default` 询问 ➔ `accept_edits` 自动接受代码变更 ➔ `bypass` 全自主放行) |
| `PageUp` / `Ctrl + U` | 聊天视口 | 向上翻滚半屏历史消息 |
| `PageDown` / `Ctrl + D` | 聊天视口 | 向下翻滚半屏历史消息 |
| `Shift + ↑` / `Shift + ↓` | 聊天视口 | 微调向上 / 向下精确滚动 3 行 |
| `Home` / `End` | 聊天视口 | （导航模式下）一键跳转至会话顶部 / 底部 |
| `Ctrl + T` | 聊天视口 | 展开 / 折叠当前工具调用详细执行细节 |
| `Alt + 1` ~ `Alt + 9` | 全局 | 极速跳转对应序号的 Agent 独立视口 |
| `t` | 全局 (导航模式) | 循环切换主页面 (`Chat` 聊天 ➔ `Logs` 日志 ➔ `Sessions` 会话管理) |
| `Ctrl + C` | 全局 | 触发安全退出确认或强制中断进程 |

---

## 🏛️ 系统分层架构与设计哲学

Wasteland 采用严格的三层解耦架构，保证 Core 层完全纯净，与具体 UI、终端框架彻底解耦：

```text
┌─────────────────────────────────────────────────────────────┐
│  1. UI 层 (Presentation Layer - 完全解耦、独立挂载)         │
│                                                             │
│   现代化终端 TUI (唯一主界面)        CLI 管道 (非交互 fallback)  │
│   src/tui/ (Ink / React)           src/ui/ (readline)       │
│   - 1:1 视口虚拟化渲染引擎          - CliInputAdapter         │
│   - DAG Tree View / 状态看板        - CliOutputAdapter        │
│   - APCA 废土朋克主题渲染                                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               │  统一转换为 ChatInputTurn 事件流
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Adapter 适配器层 (src/core/input-adapter.ts & output)   │
│                                                             │
│  - InputAdapter: 统一输入为响应式流 input$                   │
│  - OutputAdapter: 将 RuntimeEvent 1:1 映射为 DisplayEvent   │
│  - 解耦屏蔽具体呈现载体，支持无缝接入未来 WebUI / IDE 插件    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Core 运行时层 (src/core/ - UI 无关、纯 TypeScript/RxJS) │
│                                                             │
│  - runAgentLoop({ input$ }) -> { events$, debug$ }          │
│  - Git Checkpoint 隐形隔离时光机引擎 (Plumbing Driver)       │
│  - LPIE 轻量感知引擎 (CLAUDE.md / 三层自适应 Grep / 符号解析)│
│  - 响应式多 Agent 编排 (Agents-as-Tools / forkJoin 并行)    │
│  - 权限闸门 (Permission Gate) & 阶梯式负 PID 进程组安全查杀  │
└─────────────────────────────────────────────────────────────┘
```

- **响应式事件总线 (RxJS)**：整个 Agent 的思考、工具调用、输出流、权限确认均以响应式 Observable 流流动，天然支持流式取消、超时打断与高并发编排。
- **Agents-as-Tools 多智能体模式**：子 Agent 的孵化通过 `spawn_agent` 工具触发，保持 Agent 运行时接口的单一纯粹性，无需为多 Agent 引入侵入式的特殊语法。

---

## 🔌 生态扩展：MCP 协议与自定义技能

### Model Context Protocol (MCP) 集成

Wasteland 原生拥抱开放标准。你可以在 `~/.wasteland/mcp.json` 或项目根目录 `.mcp.json` 中配置任何标准 MCP 服务器：

```json
{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "memory-service": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

在 TUI 中输入 `/mcp reload` 即可热加载生效，模型将自动获取对应 MCP 服务器暴露的所有工具与资源。

### 自定义技能 (Custom Skills)

在 `.wasteland/skills/` 目录下放置 JSON 或 TypeScript 文件即可扩展工作流：

```typescript
// .wasteland/skills/git-summary.ts
export default {
  definition: {
    name: "git-summary",
    description: "汇总最近提交并生成变更摘要",
    riskLevel: "read",
    aliases: ["gs"]
  },
  async execute(args, context) {
    const result = await context.toolRegistry.get("bash")!.execute(
      { command: "git log -n 5 --oneline" },
      { sessionId: context.sessionId, turn: context.turn, cwd: context.cwd }
    );
    return { status: "success", output: result.output };
  }
};
```

---

## 🛠️ 工程化脚本与质量门禁

Wasteland 遵循工业级研发规范，核心模块坚持类型安全与同构测试（co-located tests）：

```bash
# 快速质量校验（合并代码前必跑，TypeCheck + ESLint）
npm run check:fast

# 运行完整质量门禁（TypeCheck + Lint + i18n 校验 + 对照度校验 + 全量测试）
npm run check

# 单元测试与集成测试 (Vitest)
npm test

# 检查皮肤与终端配色是否满足 W3C APCA 对比度规范
npm run check:contrast

# 校验中英多语言字典一致性
npm run check:locale-parity

# 为废土角色创建快捷运行别名（如直接在终端输入 warlord）
./scripts/create-aliases.sh
```

---

## 📄 开源许可证

本项目基于 [Apache-2.0 License](./LICENSE) 开源协议发布。  
Copyright © yonghds1.
