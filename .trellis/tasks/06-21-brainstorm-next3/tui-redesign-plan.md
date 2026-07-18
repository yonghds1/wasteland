# TUI 重新设计方案

## 目标

将 wasteland TUI 改造为 OpenCode 风格的单聊天区域界面，所有功能（对话、配置、调试）都在一个视口中完成。

## 设计原则

**所有辅助功能都通过对话框覆盖实现，不离开聊天区域。**

| 功能 | 显示方式 | 快捷键 |
|------|----------|--------|
| 工具调用 | 内联显示 | - |
| 调试信息 | 对话框覆盖 | Ctrl+L |
| 配置编辑 | 对话框覆盖 | /config |
| 会话管理 | 对话框覆盖 | Ctrl+A |
| 帮助信息 | 对话框覆盖 | ? |
| 模型选择 | 对话框覆盖 | Ctrl+O |
| 命令面板 | 对话框覆盖 | Ctrl+K |

## 当前问题

1. **多页面切换**：Session/Debug/Config 页面需要切换，不够流畅
2. **信息分散**：Agent 树、消息列表、调试信息分散在不同区域
3. **配置不便**：配置需要切换到 Config 页面

## 目标设计

### 单聊天区域

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 wasteland v0.6.0 │ claude-sonnet-4-6 │ 🔧 Tools: 13 │  ← 顶部状态栏
├─────────────────────────────────────────────────────────┤
│                                                         │
│  👤 User: 分析 UserService 代码                          │
│                                                         │
│  🤖 Assistant: 我来分析 UserService 代码...               │
│     [analyzer] 🔧 Using tool: read-file                 │
│     [analyzer] ✅ Tool result: success                   │
│     [analyzer] 🔧 Using tool: bash                      │
│     [analyzer] ✅ Tool result: success                   │
│                                                         │
│  🤖 Assistant: 分析结果如下...                            │
│                                                         │
│  👤 User: 重构这个函数                                    │
│                                                         │
│  🤖 Assistant: 好的，我来重构...                          │
│     ▶ Tool: edit-file (collapsed)                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
│ > 输入消息...                           Tab 切换 │ ? 帮助 │  ← 底部输入栏
└─────────────────────────────────────────────────────────┘
```

### 对话框覆盖

```
┌─ Command Palette (Ctrl+K) ─────────────────────────────┐
│ 🔍 输入命令...                                          │
│                                                         │
│  /help        显示帮助                                   │
│  /status      显示会话状态                               │
│  /model       切换模型                                   │
│  /session     切换会话                                   │
│  /config      编辑配置                                   │
│  /clear       清空消息                                   │
│  /exit        退出                                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 实现计划

### Phase 1: 核心重构（基础）

1. **合并页面为单一视口**
   - 移除 Header 导航
   - 移除 AgentTree 侧边栏
   - 移除 Debug/Config 页面
   - 所有内容在一个 MessageList 中显示

2. **重写 MessageList**
   - 支持所有消息类型（用户、AI、工具、系统）
   - 支持折叠/展开工具调用
   - 支持 Markdown 渲染
   - 支持代码高亮

3. **重写 InputBar**
   - 支持多行输入
   - 支持命令补全
   - 支持历史记录

4. **重写 StatusBar**
   - 显示模型信息
   - 显示会话状态
   - 显示工具数量

### Phase 2: 对话框系统

5. **实现 CommandPalette**
   - Ctrl+K 打开
   - 支持命令搜索
   - 支持快捷键

6. **实现 ModelSelector**
   - Ctrl+O 打开
   - 显示可用模型
   - 支持切换

7. **实现 SessionSwitcher**
   - Ctrl+A 打开
   - 显示会话列表
   - 支持切换/删除

8. **实现 HelpDialog**
   - ? 打开
   - 显示快捷键
   - 显示使用说明

9. **实现 ConfigDialog**
   - /config 命令打开
   - 显示当前配置
   - 支持编辑

### Phase 3: 增强功能

10. **实现日志视图**
    - Ctrl+L 打开
    - 显示调试信息
    - 支持过滤

11. **实现 Diff 视图**
    - 工具调用显示差异
    - 支持展开/折叠

12. **实现实时更新**
    - 子 Agent 进度显示
    - 流式输出支持

## 文件结构

```
src/tui/
├── App.tsx                    # 根组件（简化）
├── index.tsx                  # 入口
├── types.ts                   # 类型定义
├── context/
│   └── AppContext.tsx          # 全局状态
├── hooks/
│   ├── useRuntimeEvents.ts    # 事件处理
│   ├── useUserInput.ts        # 用户输入
│   └── useFocusManager.ts     # 焦点管理
├── components/
│   ├── ChatArea.tsx           # 单聊天区域（新）
│   ├── MessageList.tsx        # 消息列表（重写）
│   ├── InputBar.tsx           # 输入框（重写）
│   ├── StatusBar.tsx          # 状态栏（重写）
│   ├── MessageItem.tsx        # 消息项（新）
│   ├── ToolCallItem.tsx       # 工具调用项（新）
│   └── dialogs/
│       ├── CommandPalette.tsx  # 命令面板（新）
│       ├── ModelSelector.tsx   # 模型选择器（新）
│       ├── SessionSwitcher.tsx # 会话切换器（新）
│       ├── HelpDialog.tsx      # 帮助对话框（新）
│       └── ConfigDialog.tsx    # 配置对话框（新）
└── utils/
    ├── colors.ts              # 颜色工具
    └── markdown.ts            # Markdown 渲染（新）
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |
| `Ctrl+K` | 命令面板 |
| `Ctrl+O` | 模型选择器 |
| `Ctrl+A` | 会话切换器 |
| `Ctrl+L` | 日志视图 |
| `?` | 帮助 |
| `Esc` | 关闭对话框 |
| `Tab` | 切换焦点 |
| `Ctrl+C` | 退出 |

## 迁移策略

### 保留的组件
- `MessageList.tsx` - 重写为支持所有消息类型
- `InputBar.tsx` - 重写为支持多行和命令
- `AppContext.tsx` - 扩展状态管理

### 移除的组件
- `Header.tsx` - 移除（信息移至 StatusBar）
- `AgentTree.tsx` - 移除（信息移至消息列表）
- `DebugPage.tsx` - 移除（移至对话框）
- `ConfigPage.tsx` - 移除（移至对话框）
- `HelpModal.tsx` - 移除（替换为 HelpDialog）
- `ExitConfirm.tsx` - 移除（替换为对话框）

### 新增的组件
- `ChatArea.tsx` - 单聊天区域容器
- `MessageItem.tsx` - 消息项组件
- `ToolCallItem.tsx` - 工具调用项组件
- `StatusBar.tsx` - 底部状态栏
- `CommandPalette.tsx` - 命令面板
- `ModelSelector.tsx` - 模型选择器
- `SessionSwitcher.tsx` - 会话切换器
- `HelpDialog.tsx` - 帮助对话框
- `ConfigDialog.tsx` - 配置对话框

## 测试计划

1. **单元测试**
   - MessageItem 组件测试
   - ToolCallItem 组件测试
   - Dialog 组件测试

2. **集成测试**
   - 消息发送/接收流程
   - 命令执行流程
   - 会话切换流程

3. **手动测试**
   - 键盘快捷键测试
   - 响应式布局测试
   - 性能测试（大量消息）

## 预估工作量

| Phase | 工作量 | 优先级 |
|-------|--------|--------|
| Phase 1 | 3-5 天 | 高 |
| Phase 2 | 2-3 天 | 中 |
| Phase 3 | 1-2 天 | 低 |

**总计**：6-10 天
