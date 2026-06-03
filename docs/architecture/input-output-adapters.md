# Input/Output 适配器架构

## 概述

wasteland 使用 **适配器模式（Adapter Pattern）** 来抽象 CLI 和 TUI 的输入/输出差异。核心思想是：

- **InputAdapter**：将不同来源的用户输入统一为 `Observable<ChatInputTurn>`
- **OutputAdapter**：将 `RuntimeEvent` 转换为不同 UI 的显示格式

---

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    UI Layer (可替换)                         │
│  ┌──────────────────┐   ┌──────────────────┐              │
│  │  CliInputAdapter │   │ TuiInputAdapter  │              │
│  │  (readline)      │   │ (React Subject)  │              │
│  └──────────────────┘   └──────────────────┘              │
│                           ↑                                 │
│  ┌──────────────────┐   ┌──────────────────┐              │
│  │ CliOutputAdapter │   │ TuiOutputAdapter │              │
│  │ (terminal)       │   │ (React state)    │              │
│  └──────────────────┘   └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Core Layer (不变)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  runAgentLoop                                        │   │
│  │  - 输入: Observable<ChatInputTurn>                   │   │
│  │  - 输出: Observable<RuntimeEvent>                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UnifiedSessionManager                               │   │
│  │  - 会话创建、恢复、查询                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 接口定义

### InputAdapter

```typescript
// src/core/adapters/input-adapter.ts

export interface InputAdapter {
  /**
   * 用户输入流
   * 每次用户提交输入时，发出一个 ChatInputTurn
   */
  readonly input$: Observable<ChatInputTurn>;

  /**
   * 销毁适配器，清理资源
   */
  destroy(): void;
}
```

### OutputAdapter

```typescript
// src/core/adapters/output-adapter.ts

export interface OutputAdapter {
  /**
   * 处理运行时事件，返回显示事件
   *
   * @param event - 运行时事件
   * @returns 显示事件
   */
  processEvent(event: RuntimeEvent): DisplayEvent;
}
```

---

## 实现类

### InputAdapter 实现

| 类名 | 文件 | 用途 |
|------|------|------|
| `CliInputAdapter` | `src/ui/cli-input-adapter.ts` | CLI 输入（readline） |
| `TuiInputAdapter` | `src/tui/tui-input-adapter.ts` | TUI 输入（React Subject） |

### OutputAdapter 实现

| 类名 | 文件 | 用途 |
|------|------|------|
| `CliOutputAdapter` | `src/ui/cli-output-adapter.ts` | CLI 输出（terminal-renderer） |
| `TuiOutputAdapter` | `src/tui/tui-output-adapter.ts` | TUI 输出（React 状态） |
| `DefaultOutputAdapter` | `src/core/adapters/output-adapter.ts` | 默认实现（1:1 映射） |

---

## 使用示例

### CLI 使用

```typescript
import { CliInputAdapter } from '@ui/cli-input-adapter.js';
import { CliOutputAdapter } from '@ui/cli-output-adapter.js';
import { runAgentLoop } from '@core/runtime/agent-loop.js';

// 创建输入适配器
const inputAdapter = new CliInputAdapter({
  skillExecutor,
  userInputBridge,
});

// 创建输出适配器
const outputAdapter = new CliOutputAdapter({
  style: 'interactive',
  onTurnComplete: () => inputAdapter.prompt(),
});

// 运行 Agent 循环
const run = runAgentLoop({
  input$: inputAdapter.input$,
  // ... 其他参数
});

// 处理输出
await outputAdapter.handleEvents(run.events$);
```

### TUI 使用

```typescript
import { TuiInputAdapter } from '../tui-input-adapter.js';
import { TuiOutputAdapter } from '../tui-output-adapter.js';
import { runAgentLoop } from '@core/runtime/agent-loop.js';

// 创建输入适配器
const inputAdapter = new TuiInputAdapter({
  skillExecutor,
});

// 创建输出适配器
const outputAdapter = new TuiOutputAdapter({
  onEvent: (event) => {
    // 更新 React 状态
  },
});

// 运行 Agent 循环
const run = runAgentLoop({
  input$: inputAdapter.input$,
  // ... 其他参数
});

// 处理输出
await outputAdapter.handleEvents(run.events$);
```

---

## 扩展新 UI

要添加新的 UI（如 Web UI、Desktop UI），只需：

### 1. 实现 InputAdapter

```typescript
export class WebInputAdapter implements InputAdapter {
  readonly input$: Observable<ChatInputTurn>;
  
  constructor(ws: WebSocket) {
    this.input$ = fromEvent(ws, 'message').pipe(
      map((msg) => JSON.parse(msg)),
      map((data) => ({
        turn: data.turn,
        content: data.content,
        source: 'interactive',
      }))
    );
  }
  
  destroy(): void {
    // 清理资源
  }
}
```

### 2. 实现 OutputAdapter

```typescript
export class WebOutputAdapter implements OutputAdapter {
  private ws: WebSocket;
  
  constructor(ws: WebSocket) {
    this.ws = ws;
  }
  
  processEvent(event: RuntimeEvent): DisplayEvent {
    return event as unknown as DisplayEvent;
  }
  
  async handleEvents(events$: Observable<RuntimeEvent>): Promise<void> {
    events$.subscribe((event) => {
      this.ws.send(JSON.stringify(event));
    });
  }
}
```

### 3. 使用现有组件

```typescript
// Web 服务器
const manager = new UnifiedSessionManager({ sessionDir });
const session = await manager.startSession({...});

const inputAdapter = new WebInputAdapter(ws);
const outputAdapter = new WebOutputAdapter(ws);

const run = runAgentLoop({
  input$: inputAdapter.input$,
  // ... 其他参数
});

await outputAdapter.handleEvents(run.events$);
```

---

## 设计优势

1. **解耦**：UI 和核心逻辑完全分离
2. **可替换**：可以自由切换不同的 UI 实现
3. **可测试**：可以轻松 mock 输入/输出进行测试
4. **可扩展**：添加新 UI 只需实现接口，不修改核心代码

---

## 相关文件

- `src/core/adapters/input-adapter.ts` - InputAdapter 接口
- `src/core/adapters/output-adapter.ts` - OutputAdapter 接口和 DefaultOutputAdapter
- `src/ui/cli-input-adapter.ts` - CLI 输入适配器
- `src/ui/cli-output-adapter.ts` - CLI 输出适配器
- `src/tui/tui-input-adapter.ts` - TUI 输入适配器
- `src/tui/tui-output-adapter.ts` - TUI 输出适配器
