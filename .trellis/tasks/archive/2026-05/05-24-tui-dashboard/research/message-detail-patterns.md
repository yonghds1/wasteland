# TUI 消息详情显示模式研究报告

## 1. 各工具的做法

### 1.1 lazygit (Git TUI)

**UI 结构**：
- 三栏布局：左侧列表（commits/files/branches）+ 中间详情 + 右侧主面板（diff）
- 详情通过 `<enter>` 键进入，显示在主面板
- 支持多种屏幕模式：normal/half/fullscreen（`+` 键切换）

**长内容处理**：
```yaml
# 滚动配置
scrollHeight: 2           # 每次滚动的行数
scrollPastBottom: true    # 允许滚动到底部以下
scrollOffMargin: 2        # 滚动偏移边距

# 快捷键
scrollUpMain: <pgup>      # 主面板向上翻页
scrollDownMain: <pgdown>  # 主面板向下翻页
scrollUpMain-alt1: K      # Vim 风格
scrollDownMain-alt1: J
scrollUpMain-alt2: <c-u>  # 半页滚动
scrollDownMain-alt2: <c-d>
```

**特点**：
- 分屏设计，列表和详情同时可见
- 支持自定义 pager（delta, diff-so-fancy）
- diff 详情页支持行级别选择和展开

### 1.2 weechat (IRC TUI)

**UI 结构**：
- 左侧 Nick 列表 + 中间消息区 + 底部输入框
- 消息在主区域连续滚动显示
- 支持无限 scrollback 缓冲

**长消息处理**：
- 消息自动换行（word-wrap）
- PageUp/PageDown 滚动历史
- `/scroll` 命令精确控制
- 鼠标滚轮支持

**特点**：
- 消息不截断，直接换行显示
- 没有独立的"详情查看"模式
- 通过滚动而非弹窗查看长内容

### 1.3 aerc (邮件 TUI)

**UI 结构**：
- 上半部分：邮件列表
- 下半部分：邮件正文预览
- `:view` 命令进入全屏阅读模式

**长邮件处理**：
- 使用系统 pager（less）处理超长内容
- 支持上下分屏或左右分屏
- 正文区自动滚动

**特点**：
- 分屏 + 全屏模式切换
- 借助外部 pager 处理复杂内容
- 支持 markdown/highlight 渲染

### 1.4 htop (系统监控)

**UI 结构**：
- 上部：系统概览（CPU/内存图表）
- 中部：进程列表（可滚动）
- 底部：快捷键菜单

**进程详情**：
- 按 `s` 键显示进程系统调用（strace）
- 按 `l` 键显示进程打开的文件（lsof）
- 详情在独立的全屏视图显示

**特点**：
- 列表行截断显示关键信息
- 详情在单独视图中完整展示
- 支持树形展开（`t` 键）

### 1.5 aider (AI 对话 CLI)

**UI 结构**：
- 类 REPL 交互模式
- 消息流式显示，支持 markdown 渲染
- 使用 `mdstream` 实现增量更新

**长回复处理**：
```python
# aider/coders/base_coder.py
def render_incremental_response(self, final):
    return self.get_multi_response_content_in_progress()

# 流式渲染，支持 markdown
self.mdstream.update(show_resp, final=final)
```

**特点**：
- 流式输出，实时更新
- Markdown 渲染（代码高亮）
- 不做行截断，自然换行
- 终端滚动而非弹窗

### 1.6 bubbletea/bubbles viewport (Go TUI 框架)

**Viewport 组件特性**：
```go
type Model struct {
    SoftWrap         bool        // 自动换行 vs 水平滚动
    FillHeight       bool        // 填充高度
    MouseWheelEnabled bool       // 鼠标滚轮
    MouseWheelDelta  int         // 滚轮步长
    LeftGutterFunc   GutterFunc  // 左侧栏（行号等）
}
```

**关键能力**：
- 支持软换行或水平滚动
- 行号/状态栏
- 滚动百分比指示器
- 高亮搜索匹配
- 全屏模式

### 1.7 ink (React TUI 框架)

**核心组件**：
```tsx
// 静态内容（不重新渲染）
<Static items={messages}>
  {(msg) => <MessageItem key={msg.id} {...msg} />}
</Static>

// 可滚动区域
<Box flexDirection="column" height={height}>
  {visibleMessages.map(msg => <MessageItem {...msg} />)}
</Box>
```

**useInput 钩子**：
```tsx
useInput((input, key) => {
  if (key.upArrow) scrollUp();
  if (key.downArrow) scrollDown();
  if (key.pageUp) pageUp();
  if (key.pageDown) pageDown();
});
```

---

## 2. 常见模式分类

### 模式 A：分屏双面板（Split Panel）

```
┌─────────────────────────────────────────────┐
│ ┌──────────────┐ ┌────────────────────────┐ │
│ │   列表区     │ │       详情区           │ │
│ │              │ │                        │ │
│ │  选中项      │ │   完整内容             │ │
│ │  自动更新    │ │   可滚动               │ │
│ │              │ │                        │ │
│ └──────────────┘ └────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**代表工具**：lazygit, aerc

**优点**：
- 列表和详情同时可见，上下文清晰
- 选中即显示，无需额外操作
- 详情区独立滚动

**缺点**：
- 详情区空间受限
- 列表区内容被截断显示

**适用场景**：需要频繁对照列表和详情的场景

### 模式 B：模态弹窗（Modal Popup）

```
┌─────────────────────────────────────────────┐
│ ╔═════════════════════════════════════════╗ │
│ ║           消息详情                       ║ │
│ ║─────────────────────────────────────────║ │
│ ║                                         ║ │
│ ║   完整消息内容                          ║ │
│ ║   可滚动                                ║ │
│ ║                                         ║ │
│ ║─────────────────────────────────────────║ │
│ ║   [Esc/Enter 关闭]                      ║ │
│ ╚═════════════════════════════════════════╝ │
└─────────────────────────────────────────────┘
```

**代表工具**：当前 rx-cli TUI (MessageDetailModal)

**优点**：
- 详情可获得最大空间
- 实现简单
- 交互明确

**缺点**：
- 列表上下文丢失
- 需要额外操作进入/退出

**适用场景**：偶尔查看详情，不需要对照列表

### 模式 C：内联展开（Inline Expansion）

```
┌─────────────────────────────────────────────┐
│ > 短消息 1                                  │
│ ▼ 长消息 2 [已展开]                         │
│   ├─ 这是长消息的完整内容                   │
│   ├─ 可以是多行                             │
│   └─ 支持滚动                               │
│ > 短消息 3                                  │
│ > 短消息 4                                  │
└─────────────────────────────────────────────┘
```

**代表工具**：某些邮件客户端、Reddit TUI

**优点**：
- 保持列表上下文
- 无需切换视图
- 渐进式披露

**缺点**：
- 展开项占据大量空间
- 列表滚动行为复杂

**适用场景**：树形结构、嵌套内容

### 模式 D：全屏切换（Full-screen Toggle）

```
┌─────────────────────────────────────────────┐
│ [详情视图 - 全屏]                           │
│                                             │
│ 完整消息内容                                │
│ 充分利用屏幕空间                            │
│                                             │
│ [按 Esc 返回列表]                           │
└─────────────────────────────────────────────┘
```

**代表工具**：htop 详情页、aerc `:view` 模式、lazygit fullscreen

**优点**：
- 最大化详情展示空间
- 沉浸式阅读体验

**缺点**：
- 完全丢失列表上下文
- 需要明确的进入/退出操作

**适用场景**：需要专注阅读长内容

### 模式 E：流式自然滚动（Streaming Scroll）

```
┌─────────────────────────────────────────────┐
│ [消息流 - 持续滚动]                         │
│                                             │
│ User: 短消息...                             │
│ Assistant: 这是一个较长的回复，自动换行显示 │
│ 继续显示内容，不需要额外操作查看...         │
│                                             │
│ [最新消息自动滚动到底部]                    │
└─────────────────────────────────────────────┘
```

**代表工具**：aider, weechat, ChatGPT CLI

**优点**：
- 自然阅读体验
- 无需额外操作
- 流式输出友好

**缺点**：
- 历史内容需要滚动查看
- 单条消息无法快速定位

**适用场景**：实时对话、日志流

---

## 3. 推荐方案（适用于 AI 对话 TUI）

基于 AI 对话场景的特点：
- 消息有明确的 user/assistant 角色区分
- assistant 消息通常较长（代码、解释）
- 需要频繁查看历史消息详情
- 同时也需要快速浏览消息概览

### 推荐：混合模式（Split Panel + Modal for Details）

```
┌─────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────┐ │
│ │ Agent    │ │ [消息列表 - 截断显示]      │ │
│ │ Tree     │ │ > User: 短消息...          │ │
│ │          │ │ > Assistant: 这是一个...   │ │
│ │ ● Main   │ │   [按 Enter 查看完整内容]  │ │
│ │ ○ Sub    │ │ > User: 另一个问题...      │ │
│ │          │ │                            │ │
│ └──────────┘ └────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐│
│ │ [输入框]                                 ││
│ └──────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

**关键设计**：

1. **列表截断显示**：
   - 单行显示：`[时间] [角色] 内容前N字符...`
   - 保持列表紧凑，便于快速浏览

2. **Enter 查看详情**：
   - 选中消息按 `Enter` 进入详情模式
   - 详情模式可以是：
     - **方案 A**：Modal 弹窗（当前实现）
     - **方案 B**：右侧面板展开（更推荐）

3. **详情面板展开（推荐改进）**：

```
┌─────────────────────────────────────────────┐
│ ┌──────────┐ ┌─────────┐ ┌────────────────┐ │
│ │ Agent    │ │ 消息列表│ │ [详情面板]     │ │
│ │ Tree     │ │ (压缩)  │ │ 完整消息内容   │ │
│ │          │ │ > 消息1 │ │ 支持滚动       │ │
│ │ ● Main   │ │ ▸ 消息2 │ │ Markdown渲染   │ │
│ │          │ │   消息3 │ │                │ │
│ └──────────┘ └─────────┘ └────────────────┘ │
└─────────────────────────────────────────────┘
```

4. **滚动支持**：
   - 详情面板独立滚动（`↑/↓` 或 `PageUp/PageDown`）
   - 列表和详情可同时滚动（分区域焦点）
   - 滚动指示器显示当前位置

5. **快捷键设计**：
   ```
   导航模式：
     ↑/↓      选择消息
     Enter    查看详情（展开详情面板）
     Esc      关闭详情面板
   
   详情模式：
     ↑/↓      滚动详情内容
     PageUp   向上翻页
     PageDown 向下翻页
     Home     跳到顶部
     End      跳到底部
     Esc      返回列表
   ```

---

## 4. 与当前实现（MessageDetailModal）的对比

### 当前实现

**文件**：`src/tui/components/session/MessageDetailModal.tsx`

**特点**：
- Modal 弹窗形式
- 文本自动换行（`wrapText` 函数）
- 无滚动支持（所有内容一次性显示）
- 宽度限制 80 列
- Esc/Enter 关闭

**代码结构**：
```tsx
function MessageDetailModal({ message, width }) {
  const lines = wrapText(message.content, modalWidth - 4);
  return (
    <Box borderStyle="double" ...>
      {/* 标题 */}
      {/* 分隔线 */}
      {/* 内容 - 全部渲染 */}
      {lines.map((line, idx) => <Text key={idx}>{line}</Text>)}
      {/* 关闭提示 */}
    </Box>
  );
}
```

### 差距分析

| 维度 | 当前实现 | 推荐方案 |
|------|---------|---------|
| **展示形式** | Modal 弹窗 | 右侧面板或保留 Modal |
| **滚动支持** | 无（内容截断） | 必须支持 |
| **内容长度限制** | 显示全部，可能超出屏幕 | 滚动查看超长内容 |
| **焦点管理** | Modal 独占焦点 | 分区域焦点切换 |
| **上下文保持** | 列表不可见 | 列表部分可见 |
| **Markdown 渲染** | 无 | 可选支持 |

### 改进建议

1. **必须**：添加滚动支持
   - 使用 `scrollOffset` 状态
   - 限制可见行数
   - 支持 `↑/↓` 和 `PageUp/PageDown`

2. **建议**：添加滚动指示器
   - 显示 `x/y 行` 或 `xx%`
   - 顶部/底部箭头指示

3. **建议**：区分消息类型的渲染
   - tool 类型显示调用参数
   - 支持代码块语法高亮（可选）

4. **可选**：改为分屏面板
   - 详情在右侧面板显示
   - 保持左侧列表可见

---

## 5. 实现参考代码

### 5.1 带滚动的 Modal（基于 ink）

```tsx
function MessageDetailModal({ message, height, width }) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const lines = wrapText(message.content, width - 4);
  const visibleLines = height - 6; // 减去标题和边框

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset(Math.max(0, scrollOffset - 1));
    }
    if (key.downArrow) {
      setScrollOffset(Math.min(lines.length - visibleLines, scrollOffset + 1));
    }
    if (key.pageUp) {
      setScrollOffset(Math.max(0, scrollOffset - visibleLines));
    }
    if (key.pageDown) {
      setScrollOffset(Math.min(lines.length - visibleLines, scrollOffset + visibleLines));
    }
  });

  const visibleContent = lines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column" height={height}>
      {/* 标题 */}
      <Box>
        <Text bold>{message.type}</Text>
        <Text dimColor>{message.timestamp}</Text>
      </Box>
      
      {/* 内容 */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleContent.map((line, idx) => (
          <Text key={idx}>{line}</Text>
        ))}
      </Box>
      
      {/* 滚动指示器 */}
      <Box>
        <Text dimColor>
          {scrollOffset > 0 ? "▲ " : "  "}
          {scrollOffset + 1}-{scrollOffset + visibleLines} / {lines.length}
          {scrollOffset + visibleLines < lines.length ? " ▼" : "  "}
        </Text>
      </Box>
      
      {/* 关闭提示 */}
      <Text dimColor>Esc/Enter 关闭 | ↑↓ 滚动</Text>
    </Box>
  );
}
```

### 5.2 分屏面板模式

```tsx
function SessionPage() {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  
  return (
    <Box flexDirection="row">
      {/* 左侧：Agent 树 */}
      <Box width={25}>
        <AgentTree />
      </Box>
      
      {/* 中间：消息列表 */}
      <Box width={selectedMessage ? 30 : undefined} flexGrow={!selectedMessage}>
        <MessageList onSelect={setSelectedMessage} />
      </Box>
      
      {/* 右侧：详情面板（条件显示） */}
      {selectedMessage && (
        <Box flexGrow={1}>
          <MessageDetailPanel 
            message={selectedMessage} 
            onClose={() => setSelectedMessage(null)}
          />
        </Box>
      )}
    </Box>
  );
}
```

---

## 6. 总结

| 方案 | 复杂度 | 推荐场景 |
|------|--------|---------|
| Modal + 滚动 | 低 | 快速改进，满足基本需求 |
| 分屏面板 | 中 | 长期方案，更好体验 |
| 内联展开 | 高 | 树形结构场景 |
| 流式滚动 | 低 | 仅展示，无详情需求 |

**短期建议**：在现有 Modal 基础上添加滚动支持，复杂度低，见效快。

**长期建议**：实现分屏面板模式，提供更好的上下文保持和对比阅读体验。
