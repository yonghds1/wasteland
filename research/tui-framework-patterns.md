# CLI/TUI 框架实现模式调研报告

## 调研问题

1. 主流 CLI/TUI 工具使用什么技术栈？
2. AI CLI 工具（Aider/Claude Code/Cursor 等）用什么方案？
3. React + ink 的优缺点是什么？是否有更轻量的方案？
4. 流式输出（打字机效果）在不同方案中如何实现？

---

## 1. 主流 CLI/TUI 技术栈概览

### 1.1 技术栈分类

| 方案 | 代表框架 | 语言 | 特点 |
|------|----------|------|------|
| **React-based** | ink | TypeScript/JavaScript | React 组件模型，声明式渲染 |
| **Elm Architecture** | Bubble Tea | Go | 函数式，消息驱动，无副作用 |
| **Curses/NCurses** | blessed, ncurses | Node.js/C | 底层终端控制，全功能 |
| **Prompt-based** | Inquirer, Clack | TypeScript | 简单交互，无复杂布局 |
| **Rich Console** | Rich (Python) | Python | 格式化输出，简单 TUI |

### 1.2 框架流行度对比（GitHub Stars，2026年5月）

| 框架 | Stars | 语言 | 描述 |
|------|-------|------|------|
| Bubble Tea | 42,644 | Go | The Elm Architecture for terminal apps |
| ink | 38,535 | TypeScript | React for interactive command-line apps |
| GitHub CLI | 44,550 | Go | 使用 Go 标准库 + survey |
| blessed | ~4,000 | Node.js | NCurses-like terminal library |

---

## 2. AI CLI 工具技术方案

### 2.1 Aider（Python + Rich）

**技术栈**：
- Python 3.x
- Rich Console（格式化输出和简单 TUI）
- litellm（LLM API 统一接口）
- prompt-toolkit（输入处理）

**特点**：
- 流式输出：直接写入 stdout，使用 Rich Live Display
- 无复杂 TUI 框架，依赖 Rich 的格式化能力
- 打字机效果：逐字符写入 + Rich 增量更新

**代码模式**（来自 aider/coders/base_coder.py）：
```python
from rich.console import Console

class Coder:
    def __init__(self):
        self.console = Console()
    
    def stream_response(self, chunk):
        # 直接输出，Rich 处理格式化
        self.console.print(chunk, end="")
```

### 2.2 Claude Code（TypeScript + ink）

**技术栈**：
- TypeScript
- ink 7.x（React for CLI）
- React 19.x
- RxJS（事件流管理）

**特点**：
- 完整的 React 组件模型
- 状态驱动渲染
- 流式输出通过 React state 更新触发重渲染

**本项目（rxc）实现模式**：
```typescript
// useRuntimeEvents.ts - 事件订阅 Hook
export function useRuntimeEvents(events$, debug$, setState) {
  const chunkAccumulator = useRef<string>("");
  
  useEffect(() => {
    subscriptionRef.current = events$.subscribe({
      next: (event) => {
        setState((prev) => {
          // 处理 assistant_chunk，更新 streamingContent
          if (event.type === "assistant_chunk") {
            chunkAccumulator.current += event.chunk;
            return {
              ...prev,
              session: {
                ...prev.session,
                streamingContent: chunkAccumulator.current,
              }
            };
          }
          // ...
        });
      }
    });
  }, [events$, setState]);
}
```

### 2.3 Cursor（Electron + React）

**技术栈**：
- Electron（桌面应用）
- React + TypeScript
- VS Code 扩展架构

**特点**：
- 不是纯 CLI，是桌面应用
- 使用 VS Code 的 UI 组件
- 流式输出通过 Web 渲染

### 2.4 Hermes Agent（推测）

**技术栈**：
- TypeScript
- ink（React for CLI）
- 响应式事件处理

**特点**：
- Hermes 风格消息显示
- 流式光标 ▌ 效果
- 分层架构：Provider → Runtime → TUI

---

## 3. React + ink 优缺点分析

### 3.1 优点

| 优点 | 说明 |
|------|------|
| **React 生态** | 可复用 React 知识，组件化开发 |
| **声明式渲染** | 状态驱动，无需手动管理 DOM |
| **Hooks** | `useInput`, `useStdout`, `useFocus` 等内置 Hooks |
| **Flexbox 布局** | 使用 Yoga 布局引擎，类似 CSS Flexbox |
| **TypeScript 支持** | 完整类型定义 |
| **开发工具** | 支持 React DevTools |

### 3.2 缺点

| 缺点 | 说明 |
|------|------|
| **包体积** | 依赖 React、react-reconciler、yoga-layout，约 500KB+ |
| **渲染开销** | 每次状态变化触发完整 diff + patch |
| **启动时间** | 需要初始化 React 运行时 |
| **调试复杂** | 需要理解 React reconciler 在终端的工作方式 |
| **流式性能** | 高频更新时可能闪烁（需要 batch 更新） |

### 3.3 ink 7.x 依赖分析

```json
{
  "dependencies": {
    "react-reconciler": "^0.33.0",
    "yoga-layout": "~3.2.1",
    "ansi-escapes": "^7.3.0",
    "chalk": "^5.6.2",
    "cli-cursor": "^4.0.0",
    "cli-truncate": "^6.0.0",
    "slice-ansi": "^9.0.0",
    "string-width": "^8.2.0",
    "wrap-ansi": "^10.0.0"
  }
}
```

**核心依赖**：
- `react-reconciler`: React 的自定义渲染器基础
- `yoga-layout`: Facebook 的 Flexbox 布局引擎（C++ 编译）
- `ansi-escapes`: ANSI 转义码生成

---

## 4. 更轻量的方案

### 4.1 方案对比

| 方案 | 体积 | 复杂度 | 适用场景 |
|------|------|--------|----------|
| **ink** | ~500KB | 高 | 复杂 TUI，多组件交互 |
| **@clack/prompts** | ~50KB | 低 | 简单向导式交互 |
| **@inquirer/prompts** | ~100KB | 中 | 传统问答式 CLI |
| **blessed** | ~200KB | 高 | 全功能终端控制 |
| **原生 ANSI** | 0 | 低 | 简单输出控制 |

### 4.2 @clack/prompts

**特点**：
- 轻量级（~50KB）
- 函数式 API，无 React
- 适合简单交互（select, confirm, text）
- 不适合复杂布局

```javascript
import * as p from '@clack/prompts';

const project = await p.select({
  message: 'Select a project',
  options: [
    { value: 'ts', label: 'TypeScript' },
    { value: 'js', label: 'JavaScript' },
  ],
});
```

### 4.3 原生 ANSI 转义码

**最轻量方案**：
```typescript
// 清屏
process.stdout.write('\x1b[2J\x1b[0H');

// 移动光标
process.stdout.write('\x1b[10;20H'); // 移动到第10行第20列

// 隐藏光标
process.stdout.write('\x1b[?25l');

// 显示光标
process.stdout.write('\x1b[?25h');

// 颜色
process.stdout.write('\x1b[32m绿色文本\x1b[0m');
```

**适用场景**：
- 简单进度条
- 流式输出
- 无需复杂布局

### 4.4 Go + Bubble Tea

**如果性能关键**：
- 单二进制文件
- 无运行时依赖
- 更快的启动时间
- 更低的内存占用

---

## 5. 流式输出（打字机效果）实现方案

### 5.1 ink + React 方案

**原理**：状态更新触发重渲染

```typescript
// 1. 定义流式状态
interface State {
  streamingContent: string;
  isStreaming: boolean;
}

// 2. 事件订阅更新状态
function useStreaming(events$: Observable<Chunk>) {
  const [content, setContent] = useState("");
  const accumulator = useRef("");
  
  useEffect(() => {
    const sub = events$.subscribe((chunk) => {
      accumulator.current += chunk;
      setContent(accumulator.current); // 触发重渲染
    });
    return () => sub.unsubscribe();
  }, []);
  
  return content;
}

// 3. 渲染流式内容 + 光标
function StreamingText({ content, isStreaming }) {
  return (
    <Text>
      {content}
      {isStreaming && <Text color="green">▌</Text>}
    </Text>
  );
}
```

**注意事项**：
- 高频更新需要 batch（React 18+ automatic batching）
- 使用 `useRef` 累积避免状态丢失
- 需要处理 ANSI 转义码正确计算宽度

### 5.2 Rich (Python) 方案

**原理**：Live Display 增量更新

```python
from rich.console import Console
from rich.live import Live

console = Console()

def stream_response(generator):
    text = ""
    with Live(console=console, refresh_per_second=10) as live:
        for chunk in generator:
            text += chunk
            live.update(f"{text}▌")  # 增量更新
    console.print(text)  # 最终输出
```

### 5.3 原生 stdout 方案

**原理**：直接写入 stdout

```typescript
async function streamWithTypewriter(
  stream: AsyncIterable<string>,
  stdout: WritableStream
) {
  process.stdout.write('\x1b[?25l'); // 隐藏光标
  
  for await (const chunk of stream) {
    stdout.write(chunk);
    // 可选：添加延迟效果
    // await sleep(10);
  }
  
  process.stdout.write('\x1b[?25h'); // 显示光标
}
```

### 5.4 性能对比

| 方案 | 更新方式 | 性能 | 复杂度 |
|------|----------|------|--------|
| ink + React | 状态驱动重渲染 | 中等 | 高 |
| Rich Live | 增量更新 | 高 | 中 |
| 原生 stdout | 直接写入 | 最高 | 低 |

---

## 6. 本项目（rxc）架构分析

### 6.1 技术栈

```json
{
  "dependencies": {
    "commander": "^14.0.2",
    "ink": "^7.0.3",
    "react": "^19.2.6",
    "rxjs": "^7.8.2"
  }
}
```

### 6.2 数据流

```
Provider (assistant_chunk)
    ↓ Observable<ProviderStreamEvent>
Runtime (agent-loop.ts)
    ↓ Observable<RuntimeEvent>
TUI (useRuntimeEvents.ts)
    ↓ React setState
MessageList.tsx
    ↓ 渲染
终端输出
```

### 6.3 流式实现关键代码

**Provider 层**（assistant-events.ts）：
```typescript
export function createAssistantTextEvents(text: string): Observable<ProviderStreamEvent> {
  return concat(
    from(splitReplyText(text)).pipe(
      map((chunk) => ({ type: "assistant_chunk", text: chunk })),
    ),
    of({ type: "assistant_message", text }),
  );
}
```

**Runtime 层**（agent-loop.ts）：
- 转发 Provider 事件到 TUI
- 管理 session 状态

**TUI 层**（useRuntimeEvents.ts）：
- 订阅 events$ 流
- 累积 chunk 到 `streamingContent`
- 触发 React 重渲染

**渲染层**（MessageList.tsx）：
- 显示 `streamingContent` + 流式光标 `▌`
- 自动滚动跟随

---

## 7. 推荐方案

### 7.1 场景选择

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| **复杂 TUI**（多面板、交互） | ink + React | 组件化，状态管理清晰 |
| **简单 CLI**（问答式） | @clack/prompts | 轻量，API 简洁 |
| **流式输出为主** | 原生 ANSI + 简单状态 | 性能最优 |
| **Python 项目** | Rich | 生态成熟，API 友好 |
| **Go 项目** | Bubble Tea | 性能最优，单二进制 |

### 7.2 本项目选择理由

本项目选择 **ink + React + RxJS**：
1. **复杂 TUI 需求**：多页面（session/debug/config）、多组件交互
2. **状态管理**：React Context + Hooks 模式成熟
3. **事件流**：RxJS 天然适合流式事件处理
4. **类型安全**：TypeScript 全栈类型

### 7.3 优化建议

如果需要优化流式性能：
1. **batch 更新**：使用 `unstable_batchedUpdates` 或 React 18 自动 batch
2. **节流渲染**：限制最大刷新率（如 60fps）
3. **虚拟滚动**：消息列表只渲染可见区域
4. **增量渲染**：只更新变化的部分（ink 已实现）

---

## 8. 参考资料

### 8.1 框架文档

- [ink](https://github.com/vadimdemedes/ink) - React for CLI
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - The Elm Architecture for Go
- [@clack/prompts](https://github.com/bombshell-dev/clack) - Effortlessly build beautiful CLIs
- [Rich](https://github.com/Textualize/rich) - Python library for rich text

### 8.2 AI CLI 工具

- [Aider](https://github.com/paul-gauthier/aider) - AI pair programming in your terminal
- [GitHub CLI](https://github.com/cli/cli) - GitHub's official command line tool

### 8.3 相关 npm 包

| 包名 | 用途 |
|------|------|
| ansi-escapes | ANSI 转义码生成 |
| chalk | 终端颜色 |
| ora | 优雅的 spinner |
| cli-spinners | spinner 配置集合 |
| string-width | 计算字符串显示宽度 |
| wrap-ansi | ANSI 感知的换行 |

---

## 9. 总结

### 9.1 技术栈选择矩阵

```
复杂度 →
  低          中          高
  ┌───────────┬───────────┬───────────┐
  │ 原生 ANSI │  Clack    │   ink     │
  │ Rich      │ Inquirer  │ BubbleTea │
  │           │           │  blessed  │
  └───────────┴───────────┴───────────┘
性能 ↑
```

### 9.2 流式输出实现要点

1. **状态累积**：使用 ref 累积 chunk，避免状态丢失
2. **渲染触发**：每次 chunk 更新触发 UI 重渲染
3. **光标效果**：流式结束时移除光标
4. **滚动跟随**：自动滚动到最新内容
5. **性能优化**：batch 更新、节流渲染

### 9.3 本项目架构优势

- **分层清晰**：Provider → Runtime → TUI 三层分离
- **响应式**：RxJS 处理事件流，天然支持流式
- **类型安全**：TypeScript 全栈类型
- **组件化**：React 组件复用，状态管理清晰
