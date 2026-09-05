# TUI Dashboard - 会话/调试/配置多页面

## Goal

为 rxc CLI 添加交互式 TUI Dashboard，提供会话监控、调试追踪、配置管理三个页面，提升多 Agent 运行时的可视化体验。

## What I already know

**现有架构**：
- CLI 入口：`src/cli.ts` + `src/commands/chat.ts`
- 运行时：`src/runtime/agent-loop.ts` 输出 `RuntimeEvent` 流
- 终端渲染：`src/ui/terminal-renderer.ts`
- Session 管理：`src/runtime/session-manager.ts`

**用户需求**：
- 后台查看日志和交互，而非全部在终端
- 会话页面：Agent 树 + 消息流
- 调试页面：Trace 日志
- 配置页面：Provider/权限/Session 配置

## Assumptions (temporary)

- TUI 作为独立入口 `rxc tui`，不影响现有 CLI
- 使用 ink (React TUI) 框架
- ink 和 react 作为 optionalDependencies

## Requirements (evolving)

### 入口设计

```bash
rxc tui              # 启动 TUI Dashboard
rxc tui --attach     # 附加到已有 session
```

### 页面结构

**页面 1：会话 (Session)**
- Agent 树状图（状态、层级、运行时长）
- 消息滚动区（user/assistant/tool/system）
- 底部输入框（可选）

**页面 2：调试 (Debug)**
- Session 信息面板
- Trace 日志流
- 过滤器和导出

**页面 3：配置 (Config)**
- Provider 配置（名称、模型、Base URL）
- 权限配置（模式、自动批准）
- Session 配置（最大轮次、步骤、超时）

### 键盘交互

```
全局：
  Tab          切换页面
  1/2/3        直接跳转
  q            退出
  ?            帮助

会话页面：
  ↑/↓          滚动消息
  Enter        发送
  a            聚焦 Agent 树
  m            聚焦消息区

调试页面：
  f            聚焦过滤器
  e            导出日志
  c            清空日志

配置页面：
  Tab          切换字段
  Enter        保存
  r            重置
```

## Acceptance Criteria (evolving)

### 基础框架
- [x] `rxc tui` 命令可启动 TUI
- [x] 三个页面可通过 Tab 切换
- [x] q 键正常退出
- [x] 非 TTY 环境友好提示

### TTY 适配
- [x] 自动检测 TTY 环境
- [x] 颜色支持检测
- [x] Unicode 支持检测
- [x] chat 命令根据 TTY 选择样式

### 会话页面
- [x] Agent 树显示（基础框架）
- [x] Agent 状态图标（running/idle/completed/failed/timeout）
- [x] 消息列表显示
- [x] 接入真实 RuntimeEvent 数据流
- [x] 消息可滚动查看

### 调试页面
- [x] Session 信息显示
- [x] Trace 日志显示
- [x] 接入真实 Debug 数据流
- [x] 过滤器可按 scope/phase 过滤

### 配置页面
- [x] Provider 配置显示
- [x] 权限配置显示
- [x] Session 配置显示
- [x] 配置可交互修改
- [x] 配置可保存到 settings.json

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Technical Approach

### 目录结构

```
src/tui/
├── index.ts                    # TUI 入口
├── App.tsx                     # 根组件（页面路由）
│
├── components/
│   ├── common/
│   │   ├── Header.tsx          # 顶部状态栏 + Tab 导航
│   │   ├── Sidebar.tsx         # 通用侧边栏
│   │   └── Footer.tsx          # 底部状态栏
│   │
│   ├── session/                # 会话页面
│   │   ├── SessionPage.tsx
│   │   ├── AgentTree.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   └── InputBar.tsx
│   │
│   ├── debug/                  # 调试页面
│   │   ├── DebugPage.tsx
│   │   ├── SessionInfo.tsx
│   │   ├── TraceLog.tsx
│   │   └── TraceFilter.tsx
│   │
│   └── config/                 # 配置页面
│       ├── ConfigPage.tsx
│       ├── ProviderSection.tsx
│       ├── PermissionSection.tsx
│       └── SessionSection.tsx
│
├── hooks/
│   ├── useAppNavigation.ts
│   ├── useAgentStream.ts
│   ├── useTraceLog.ts
│   └── useConfig.ts
│
├── context/
│   └── AppContext.tsx
│
└── utils/
    ├── format.ts
    └── colors.ts
```

### 依赖

```json
{
  "optionalDependencies": {
    "ink": "^4.4.1",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0"
  }
}
```

### 状态管理

```typescript
interface AppState {
  currentPage: 'session' | 'debug' | 'config';

  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isStreaming: boolean;
  };

  debug: {
    traces: TraceEvent[];
    filter: TraceFilter;
  };

  config: {
    provider: string;
    model: string;
    permissionMode: string;
    maxTurns: number;
    maxSteps: number;
  };
}
```

## Implementation Phases

| Phase | 内容 | 时间 |
|-------|------|------|
| 1 | 项目骨架 + 页面路由 | 1h |
| 2 | 会话页面（Agent 树 + 消息） | 2h |
| 3 | 调试页面（Trace 日志） | 1.5h |
| 4 | 配置页面（表单） | 1.5h |
| 5 | 状态管理 + 事件流 | 1h |
| 6 | 键盘交互 + 样式优化 | 1h |

**总计：约 8 小时**

## Out of Scope (explicit)

- Web UI（后续独立任务）
- 远程访问
- 多 Session 并行
- 配置持久化到远程

## Technical Notes

- ink 使用 React 语法渲染终端 UI
- 需处理终端 resize 事件
- 需处理异步事件流与 React 状态同步
