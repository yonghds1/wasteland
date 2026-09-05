# RxJS 模式指南

本文档解释项目中使用的 RxJS 设计模式，帮助新手理解响应式编程的核心概念。

## 目录

- [核心概念](#核心概念)
- [项目中的模式](#项目中的模式)
- [关键操作符详解](#关键操作符详解)
- [数据流图解](#数据流图解)
- [常见问题](#常见问题)

---

## 核心概念

### Observable 是什么

**Observable（可观察对象）** 是一个代表未来值或事件集合的概念。可以把它想象成一个"异步数组"：

```
数组：  [1, 2, 3]           同步，立即获得所有值
Observable: ---1---2---3---> 异步，值随时间推移产生
```

### Observable vs Promise

| 特性 | Promise | Observable |
|------|---------|------------|
| 值的数量 | 单个值 | 零个或多个值 |
| 执行时机 | 立即执行 | 订阅时执行（冷 Observable） |
| 可取消 | 不可取消 | 可取消（unsubscribe） |
| 操作符 | 无 | 丰富的操作符链 |

```
Promise:     request() → pending → resolved/rejected
Observable:  request() → ---pending---data1---data2---complete--->
```

### 订阅（Subscribe）

Observable 是惰性的，只有被**订阅**时才会执行：

```typescript
const source$ = of(1, 2, 3);  // 此时什么都没发生

source$.subscribe({
  next: value => console.log(value),    // 1, 2, 3
  error: err => console.error(err),     // 错误时
  complete: () => console.log('done')   // 完成时
});
```

### Subject

**Subject** 是一种特殊的 Observable，它既是 Observable 又是 Observer：

```typescript
const subject = new Subject<number>();

// 作为 Observable，可以被订阅
subject.subscribe(value => console.log(value));

// 作为 Observer，可以手动发射值
subject.next(1);  // 输出: 1
subject.next(2);  // 输出: 2
subject.complete();
```

**使用场景**：
- 事件总线
- 多播（多个订阅者共享同一个源）
- 调试追踪（如项目中的 `debugSubject`）

---

## 项目中的模式

### 模式 1：defer + concat + 递归 循环模式

这是项目中最核心的模式，用于实现 Agent 的循环调用。

#### 为什么需要这个模式？

传统的 `while` 循环在 RxJS 中不适用，因为：
1. 循环条件可能在异步操作后才确定
2. 需要等待异步操作完成后再决定是否继续

#### 模式结构

```typescript
function runLoop(state: State): Observable<Event> {
  return defer(() => {
    // 1. 检查终止条件
    if (shouldTerminate(state)) {
      return of(createFinalEvent());
    }

    // 2. 执行一步操作
    const step$ = doStep(state);

    // 3. 决定后续行为
    const continuation$ = defer(() => {
      if (shouldContinue()) {
        return runLoop(nextState);  // 递归
      }
      return EMPTY;  // 结束
    });

    // 4. 顺序拼接
    return concat(step$, continuation$);
  });
}
```

#### defer 的作用

`defer` 延迟执行函数体，直到 Observable 被订阅：

```typescript
// 没有 defer：立即执行
const bad$ = of(doSomething());  // doSomething() 立即调用

// 有 defer：订阅时执行
const good$ = defer(() => of(doSomething()));  // doSomething() 在订阅时调用
```

在循环模式中，`defer` 确保：
1. 每次递归时重新检查条件
2. 状态更新后才执行下一步

#### concat 的作用

`concat` 顺序拼接多个 Observable，前一个完成后再开始下一个：

```typescript
const a$ = of(1, 2);
const b$ = of(3, 4);

concat(a$, b$);  // 输出: 1, 2, 3, 4
```

在循环模式中，`concat` 确保：
1. `step$` 完全执行完毕
2. 然后才执行 `continuation$`（递归或结束）

#### 数据流图

```
runLoop(state)
    │
    │ defer (延迟执行)
    ▼
┌─────────────────────────────────┐
│  检查终止条件                    │
│  if (shouldTerminate) → 返回    │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  step$                          │
│  执行一步操作                    │
│  (例如: Provider API 调用)       │
└────────────┬────────────────────┘
             │
             │ concat (等待完成)
             ▼
┌─────────────────────────────────┐
│  continuation$                  │
│  defer(() => {                  │
│    if (shouldContinue)          │
│      return runLoop(nextState)  │──┐ 递归
│    return EMPTY                 │  │
│  })                             │  │
└─────────────────────────────────┘  │
             ▲                       │
             └───────────────────────┘
```

### 模式 2：concatMap 嵌套处理

`concatMap` 用于处理嵌套的 Observable，保证顺序执行。

#### 项目中的应用

在 `agent-loop.ts` 中，Provider 返回的是一个事件流：

```typescript
provider.runStep({ context, state })
  .pipe(
    concatMap(event => {
      // 每个事件可能触发新的 Observable
      if (event.type === 'tool_call') {
        return dispatchToolCall(...);  // 返回 Observable
      }
      return of(transformEvent(event));  // 返回 Observable
    })
  )
```

#### concatMap vs mergeMap vs switchMap

| 操作符 | 行为 | 使用场景 |
|--------|------|----------|
| `concatMap` | 顺序处理，前一个完成后再处理下一个 | 需要保证顺序 |
| `mergeMap` | 并行处理，所有同时进行 | 可以并行 |
| `switchMap` | 取消前一个，只保留最新的 | 搜索输入、最新值 |

```
源:        ---a---b---c--->
concatMap: ---A---B---C--->  (顺序)
mergeMap:  ---A-B-C---A-B-C-->  (并行，可能交错)
switchMap: ---a---b---c--->  (只保留 c 的结果)
               \   \   \
                X   X   C
```

### 模式 3：fromEvent + 操作符链

用于将 Node.js EventEmitter 转换为 Observable。

#### 项目中的应用

在 `readline-input.ts` 中：

```typescript
fromEvent<string>(rl, 'line')  // readline 的 "line" 事件
  .pipe(
    map(line => line.trim()),           // 转换
    tap(line => handleCommands(line)),  // 副作用
    takeUntil(close$),                  // 终止条件
    filter(line => isValid(line)),      // 过滤
    scan(accumulateTurn, initial)       // 累积
  )
```

#### 操作符链的执行顺序

```
用户输入: "  Hello World  "
    │
    │ fromEvent
    ▼
"  Hello World  "
    │
    │ map(trim)
    ▼
"Hello World"
    │
    │ tap (副作用，不改变值)
    ▼
"Hello World"
    │
    │ filter (检查是否有效)
    ▼
"Hello World"
    │
    │ scan (累积 turn 计数)
    ▼
{ turn: 1, content: "Hello World", source: "interactive" }
```

---

## 关键操作符详解

### defer - 延迟执行

**作用**：创建一个 Observable，在订阅时才执行工厂函数。

```typescript
// 立即执行
const now$ = of(Date.now());  // 固定时间戳

// 延迟执行
const later$ = defer(() => of(Date.now()));  // 订阅时的时间戳
```

**项目用法**：
- 包装异步 API 调用
- 实现循环模式
- 确保每次订阅都重新执行

### concat - 顺序拼接

**作用**：顺序订阅多个 Observable。

```typescript
const a$ = interval(1000).pipe(take(2));  // 0, 1 (每秒)
const b$ = of('done');

concat(a$, b$);  // 0, 1, 'done' (等 a$ 完成后才发出 'done')
```

**项目用法**：
- 拼接循环的步骤
- 确保顺序执行

### concatMap - 顺序映射

**作用**：对每个值映射为 Observable，顺序订阅。

```typescript
from([1, 2, 3]).pipe(
  concatMap(x => of(x * 10).pipe(delay(1000)))
);
// 输出: 10 (1秒后), 20 (2秒后), 30 (3秒后)
```

**项目用法**：
- 处理 Provider 事件
- 处理用户输入 turns

### tap - 副作用

**作用**：执行副作用，不改变流中的值。

```typescript
source$.pipe(
  tap(value => console.log('debug:', value)),  // 日志
  map(value => transform(value)),
  tap({
    next: value => console.log('after map:', value),
    error: err => console.error('error:', err),
    complete: () => console.log('done')
  })
);
```

**项目用法**：
- 记录调试追踪
- 更新内存状态
- 日志输出

### scan - 累积器

**作用**：类似 `reduce`，但发出每次累积结果。

```typescript
from([1, 2, 3]).pipe(
  scan((sum, value) => sum + value, 0)
);
// 输出: 1, 3, 6 (累积和)
```

**项目用法**：
- 维护 turn 计数
- 累积状态

### takeUntil - 条件终止

**作用**：在另一个 Observable 发出值时完成。

```typescript
const source$ = interval(1000);  // 每秒发出 0, 1, 2, ...
const stop$ = fromEvent(button, 'click');

source$.pipe(takeUntil(stop$));  // 点击按钮时停止
```

**项目用法**：
- 在 readline close 事件时结束输入流

### filter - 过滤

**作用**：只让满足条件的值通过。

```typescript
from([1, 2, 3, 4, 5]).pipe(
  filter(x => x % 2 === 0)
);
// 输出: 2, 4
```

**项目用法**：
- 过滤空行
- 过滤本地命令

---

## 数据流图解

### 完整的 Agent 循环流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        runAgentLoop                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  input$ (用户输入流)                                              │
│      │                                                            │
│      │ defer (创建会话)                                           │
│      ▼                                                            │
│  ┌─────────────┐                                                 │
│  │  start$     │  session_started 事件                           │
│  └──────┬──────┘                                                 │
│         │                                                         │
│         │ concat                                                  │
│         ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  turns$ (concatMap 处理每个 turn)                        │    │
│  │                                                          │    │
│  │  user$ ──concat──► runTurnLoop                           │    │
│  │                      │                                   │    │
│  │                      ▼                                   │    │
│  │              ┌───────────────────┐                       │    │
│  │              │   runTurnLoop     │                       │    │
│  │              │                   │                       │    │
│  │              │  defer(() => {    │                       │    │
│  │              │    检查步数限制   │                       │    │
│  │              │    ↓              │                       │    │
│  │              │    provider$      │                       │    │
│  │              │    ↓              │                       │    │
│  │              │    concatMap      │                       │    │
│  │              │    ├─ chunk       │                       │    │
│  │              │    ├─ message     │                       │    │
│  │              │    └─ tool_call   │                       │    │
│  │              │         ↓         │                       │    │
│  │              │    dispatchTool   │                       │    │
│  │              │         ↓         │                       │    │
│  │              │    continuation$  │                       │    │
│  │              │    ├─ EMPTY       │ (完成)                │    │
│  │              │    ├─ 递归        │ (继续)                │    │
│  │              │    └─ fallback    │ (异常)                │    │
│  │              │  })              │                       │    │
│  │              └───────────────────┘                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                         │
│         │ concat                                                  │
│         ▼                                                         │
│  ┌─────────────┐                                                 │
│  │  end$       │  session_ended 事件                             │
│  └─────────────┘                                                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
  RuntimeEvent 流 (输出给 UI)
```

### 单个 Turn 的处理流程

```
用户输入: "请帮我读取 package.json"
    │
    │ user$
    ▼
user_turn 事件
    │
    │ assistant$ (runTurnLoop)
    ▼
┌─────────────────────────────────────┐
│  Step 1: Provider 调用              │
│                                      │
│  Provider 返回:                      │
│  - assistant_chunk: "我来帮你"       │
│  - assistant_chunk: "读取文件"       │
│  - tool_call: { name: "read_file" } │
│                                      │
│  状态更新:                           │
│  - step: 1 → 2                       │
│  - toolCalls: [..., newCall]         │
└──────────────┬──────────────────────┘
               │
               │ concat
               ▼
┌─────────────────────────────────────┐
│  工具执行                            │
│                                      │
│  dispatchToolCall:                   │
│  - tool_started 事件                 │
│  - tool_result 事件                  │
│                                      │
│  状态更新:                           │
│  - toolResults: [..., newResult]     │
└──────────────┬──────────────────────┘
               │
               │ concat
               ▼
┌─────────────────────────────────────┐
│  Step 2: Provider 调用 (递归)        │
│                                      │
│  Provider 返回:                      │
│  - assistant_chunk: "文件内容是..."  │
│  - assistant_message: "..."          │
│                                      │
│  状态更新:                           │
│  - status: "completed"               │
└─────────────────────────────────────┘
               │
               │ concat
               ▼
            EMPTY (结束)
```

---

## 常见问题

### Q: 为什么不用 async/await 而用 RxJS？

**A**: RxJS 更适合处理：
1. **多个值**：用户输入是连续的事件流
2. **可取消**：可以随时取消订阅
3. **组合**：复杂的异步流程用操作符链更清晰
4. **统一模型**：所有异步操作都是 Observable

### Q: defer 和直接调用有什么区别？

```typescript
// 直接调用：立即执行
const result = await api();
const source$ = of(result);

// defer：订阅时执行
const source$ = defer(() => api());
```

**区别**：
- 直接调用在创建 Observable 时就执行
- defer 在订阅时才执行，可以延迟、可以取消

### Q: concatMap 和 mergeMap 怎么选？

- **concatMap**：需要保证顺序（如 Agent 的步骤）
- **mergeMap**：可以并行（如多个独立的 API 调用）

### Q: 什么时候用 tap vs map？

- **tap**：副作用（日志、更新外部状态），不改变值
- **map**：转换值

```typescript
// tap：副作用
tap(value => console.log(value))  // 返回原值

// map：转换
map(value => value * 2)  // 返回新值
```

### Q: EMPTY 是什么？

`EMPTY` 是一个立即完成的 Observable，不发出任何值：

```typescript
EMPTY.subscribe({
  next: () => console.log('never'),
  complete: () => console.log('immediately')
});
// 输出: immediately
```

**用途**：在条件分支中表示"什么都不做"。

---

## 延伸阅读

- [RxJS 官方文档](https://rxjs.dev/)
- [RxJS 操作符决策树](https://rxjs.dev/operator-decision-tree)
- [Learn RxJS](https://www.learnrxjs.io/)

---

## 附录：项目中的 Observable 流总结

| 流名称 | 类型 | 描述 |
|--------|------|------|
| `input$` | `Observable<ChatInputTurn>` | 用户输入流 |
| `events$` | `Observable<RuntimeEvent>` | 运行时事件流 |
| `debug$` | `Observable<DebugTraceEvent>` | 调试追踪流 |
| `provider$` | `Observable<ProviderStreamEvent>` | Provider 响应流 |
| `turns$` | `Observable<ChatInputTurn>` | readline 输入流 |
| `close$` | `Observable<void>` | readline 关闭事件 |
