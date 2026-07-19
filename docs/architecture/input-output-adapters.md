# Input/Output 适配器架构

## 概述

wasteland 采用 **UI 分层架构**,通过 **适配器模式(Adapter Pattern)** 将 UI 与核心运行时(core)解耦。核心运行时不依赖任何具体 UI,所有 UI 实现都经由 `InputAdapter` / `OutputAdapter` 抽象接入 core。

- **TUI 是主要界面**(唯一主界面),基于 Ink/React,位于 `src/tui/`;`npm run dev` 默认启动 TUI。
- **CLI 是非交互 fallback**,基于 readline/terminal,位于 `src/ui/`;`chat` 命令已 hidden,保留作非交互场景的兜底。
- 两者共享同一套 core runtime,仅 adapter 实现不同。

适配器契约:

- **InputAdapter**:将不同来源的用户输入统一为 `Observable<ChatInputTurn>`
- **OutputAdapter**:将 `RuntimeEvent` 转换为 `DisplayEvent`,供 UI 渲染

`runAgentLoop({ input$ })` 返回 `{ events$, debug$, userInputBridge }`,其中 `events$` 为运行时事件流,`debug$` 为调试事件流。

---

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│              UI Layer (可替换,经 adapter 接入 core)          │
│                                                             │
│   ┌───────────────────────┐   主界面 (唯一)                 │
│   │  TuiInputAdapter      │   src/tui/                      │
│   │  TuiOutputAdapter     │   Ink / React                   │
│   └───────────────────────┘                                 │
│                                                             │
│   ┌───────────────────────┐   非交互 fallback               │
│   │  CliInputAdapter      │   src/ui/                       │
│   │  CliOutputAdapter     │   readline / terminal           │
│   └───────────────────────┘                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓  core 不依赖具体 UI
┌─────────────────────────────────────────────────────────────┐
│              Adapter 层 (抽象 + 默认实现)                    │
│   src/core/adapters/                                        │
│   InputAdapter / OutputAdapter 抽象                         │
│   DefaultOutputAdapter (RuntimeEvent -> DisplayEvent 1:1)   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              Core Layer (不变)                               │
│   src/core/runtime/                                         │
│   runAgentLoop({ input$ }) -> { events$, debug$ }           │
│   UnifiedSessionManager / tool-dispatch / permission-gate   │
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
| `TuiInputAdapter` | `src/tui/tui-input-adapter.ts` | TUI 输入（主界面，React Subject） |
| `CliInputAdapter` | `src/ui/cli-input-adapter.ts` | CLI 输入（非交互 fallback，readline） |

### OutputAdapter 实现

| 类名 | 文件 | 用途 |
|------|------|------|
| `TuiOutputAdapter` | `src/tui/tui-output-adapter.ts` | TUI 输出（主界面，React 状态） |
| `CliOutputAdapter` | `src/ui/cli-output-adapter.ts` | CLI 输出（非交互 fallback，terminal-renderer） |
| `DefaultOutputAdapter` | `src/core/adapters/output-adapter.ts` | 默认实现（1:1 映射） |

---

## 使用示例

### TUI 使用（主界面）

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

### CLI 使用（非交互 fallback）

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

---

## 扩展新 UI

UI 可分离是本架构的核心优势:添加新的 UI(如 Web UI、Desktop UI)无需修改 core,只需实现两个 adapter 接口并接入 `runAgentLoop`。

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

1. **解耦**:UI 和核心逻辑完全分离,core 不依赖任何具体 UI
2. **可替换**:UI Layer 可替换,TUI 与 CLI 共享同一套 core runtime,仅 adapter 实现不同
3. **可测试**:可以轻松 mock 输入/输出进行测试
4. **可扩展**:添加新 UI 只需实现 `InputAdapter` / `OutputAdapter` 接口,不修改核心代码

---

## 相关文件

- `src/core/adapters/input-adapter.ts` - InputAdapter 接口
- `src/core/adapters/output-adapter.ts` - OutputAdapter 接口和 DefaultOutputAdapter
- `src/tui/tui-input-adapter.ts` - TUI 输入适配器（主界面）
- `src/tui/tui-output-adapter.ts` - TUI 输出适配器（主界面）
- `src/ui/cli-input-adapter.ts` - CLI 输入适配器（非交互 fallback）
- `src/ui/cli-output-adapter.ts` - CLI 输出适配器（非交互 fallback）
