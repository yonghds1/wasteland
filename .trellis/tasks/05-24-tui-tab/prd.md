# TUI 焦点管理系统

## 背景

当前 TUI 应用中，滚动条在输入模式下无法使用。用户需要在输入消息时能够查看历史消息。

## 问题分析

- 现有 `inputMode` 状态独占键盘事件
- MessageList 的滚动功能在 `inputMode` 时被禁用
- 缺乏统一的焦点管理机制

## 解决方案

实现扁平化焦点管理模型，Tab/Shift+Tab 切换焦点区域，方向键操作当前区域内容。

## 焦点区域定义

```typescript
type FocusArea =
  | "header"       // 顶部 Tab 卡片
  | "agentTree"    // 左侧 Agent 树
  | "messageList"  // 右侧消息列表
  | "inputBar"     // 底部输入区
  | "traceLog"     // Debug 页面日志列表
  | "configList";  // Config 页面配置列表
```

## 焦点流转规则

### 按页面分组

```typescript
const FOCUS_ORDER_BY_PAGE = {
  session: ["header", "agentTree", "messageList", "inputBar"],
  debug: ["header", "traceLog"],
  config: ["header", "configList"],
};
```

### 快捷键映射

| 快捷键 | 行为 |
|--------|------|
| Tab | 下一个焦点区域 |
| Shift+Tab | 上一个焦点区域 |
| ←→ | Header: 切换页面标签 |
| ↑↓ | MessageList/TraceLog: 滚动 |
| Ctrl+Enter | InputBar: 进入输入模式 / 发送消息 |
| Esc | 退出输入模式 |

## 各区域方向键操作

| 焦点区域 | ↑↓ 操作 | ←→ 操作 | Enter 操作 |
|---------|--------|--------|-----------|
| header | 无效 | 切换页面标签 | 无效 |
| agentTree | 预留 | 预留 | 无效 |
| messageList | 滚动消息 | 无效 | 无效 |
| inputBar | 无效 | 无效 | 进入输入模式 |
| traceLog | 滚动日志 | 无效 | 无效 |
| configList | 切换 section | 无效 | 进入编辑模式 |

## 视觉反馈

- 焦点区域边框高亮为 cyan
- 非焦点区域边框为 gray
- InputBar 焦点时显示 "Ctrl+Enter 输入" 提示

## 实现步骤

1. AppContext.tsx - 添加 `focusArea` 状态和 `setFocusArea` 方法
2. App.tsx - 处理 Tab/Shift+Tab 焦点切换、页面切换时重置焦点
3. Header.tsx - 焦点高亮、←→ 切换页面
4. MessageList.tsx - 焦点高亮、↑↓ 滚动
5. InputBar.tsx - 焦点高亮、Ctrl+Enter 进入/发送
6. AgentTree.tsx - 焦点高亮
7. TraceLog.tsx - 焦点高亮、↑↓ 滚动
8. ConfigPage.tsx - 焦点高亮适配
9. SessionPage.tsx - 传递焦点状态
10. DebugPage.tsx - 传递焦点状态

## 测试要点

- [ ] Session 页面 Tab 循环切换 4 个区域
- [ ] Debug 页面 Tab 切换 2 个区域
- [ ] Config 页面 Tab 切换 2 个区域
- [ ] Header 焦点时 ←→ 切换页面
- [ ] MessageList 焦点时 ↑↓ 滚动
- [ ] InputBar 焦点时 Ctrl+Enter 进入输入模式
- [ ] 输入模式 Esc 退出
- [ ] 输入模式 Ctrl+Enter 发送
- [ ] 页面切换时焦点重置
- [ ] 视觉高亮正确显示
