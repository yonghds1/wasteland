# TypeScript 新手指南

本指南帮助 TypeScript 新手理解项目中的类型代码。我们将从基础概念出发，结合项目中的实际代码进行讲解。

---

## 基础类型语法

### type vs interface

TypeScript 提供两种定义类型的方式：`type` 和 `interface`。

#### type（类型别名）

```ts
// type 用于给类型起别名，可以是任何类型
type ToolRiskLevel = "read" | "write" | "execute";  // 联合类型
type ToolInput = Record<string, unknown>;            // 对象类型
type TurnStatus = "running" | "completed" | "failed"; // 字符串字面量联合
```

**特点：**
- 可以表示任何类型（联合类型、交叉类型、原始类型等）
- 使用 `&` 进行交叉，使用 `|` 进行联合
- 不能重复声明

#### interface（接口）

```ts
// interface 用于定义对象形状
interface AgentProvider {
  readonly id: string;  // readonly 表示只读属性
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

**特点：**
- 专门用于定义对象类型
- 使用 `extends` 继承
- 可以重复声明，会自动合并
- 更适合定义类的契约

#### 项目中的例子

```ts
// src/tools/tool-types.ts
// 使用 type 定义工具执行结果（因为有联合类型）
export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult;

// 使用 interface 定义 AgentTool 的行为契约
export interface AgentTool {
  readonly name: string;
  readonly riskLevel: ToolRiskLevel;
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

**选择建议：**
- 需要联合类型（`|`）或交叉类型（`&`）时，使用 `type`
- 定义对象形状或类契约时，使用 `interface`
- 项目中两者并存，根据场景选择

---

### 泛型 `<T>`

泛型让我们可以编写可复用的类型安全代码。`T` 是类型参数，就像函数参数是值的占位符一样，泛型参数是类型的占位符。

#### 基本概念

```ts
// 简单的泛型函数
function identity<T>(value: T): T {
  return value;
}

// 使用时指定类型
const num = identity<number>(42);     // num: number
const str = identity<string>("hello"); // str: string
```

#### 项目中的例子

```ts
// src/providers/provider-types.ts
export interface AgentProvider {
  // runStep 返回一个 Observable，Observable<ProviderStreamEvent> 表示
  // 这个 Observable 流中发出的每个值都是 ProviderStreamEvent 类型
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

```ts
// src/tools/tool-types.ts
// Promise<ToolExecutionResult> 表示这个 Promise 最终会 resolve 一个 ToolExecutionResult 类型的值
execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
```

#### 多个泛型参数

```ts
// 可以有多个泛型参数
type Result<T, E = Error> = {
  success: true;
  value: T;
} | {
  success: false;
  error: E;
};
```

**理解泛型的关键：**
- 把 `<T>` 想象成类型的"参数"
- 调用时传入具体类型，就像函数调用时传入值
- 泛型约束类型之间的关系，确保类型安全

---

### 类型推断

TypeScript 编译器会自动推断变量的类型，我们不需要总是显式标注。

#### 可以省略类型标注的情况

```ts
// TypeScript 能推断出类型
const num = 42;           // number
const str = "hello";      // string
const arr = [1, 2, 3];    // number[]

// 函数返回值通常可以省略
function createTurnContext(params: {
  sessionId: string;
  input: ChatInputTurn;
  cwd: string;
  history: readonly SessionMessageRecord[];
}): TurnContext {
  // TypeScript 会推断返回值是 TurnContext
  return {
    sessionId: params.sessionId,
    turn: params.input.turn,
    input: params.input,
    cwd: params.cwd,
    history: [...params.history],
  };
}
```

#### 需要显式标注的情况

```ts
// 1. 函数参数必须标注（除非有默认值）
function evaluate(call: ToolCall, riskLevel: ToolRiskLevel): PermissionDecision {
  // ...
}

// 2. 返回复杂类型时，建议标注以明确意图
export function createPermissionGate(params?: {
  mode?: PermissionMode;
  rules?: PermissionRule[];
}): PermissionGate {
  // ...
}

// 3. 联合类型或字面量类型，需要显式标注
export type ToolRiskLevel = "read" | "write" | "execute";

// 4. 可选参数用 ? 标注
function example(required: string, optional?: number) {
  // optional 的类型是 number | undefined
}
```

---

## 复杂类型签名

### `Observable<T>`

`Observable<T>` 来自 RxJS 库，表示一个可观察的数据流。

#### 含义

- `T` 是数据流中每个值的类型
- 数据流可以发出 0 到多个 `T` 类型的值，然后可能完成或出错
- 用于处理异步事件流

#### 项目中的例子

```ts
// src/providers/provider-types.ts
import type { Observable } from "rxjs";

// runStep 返回 Observable<ProviderStreamEvent>
// 意思是：调用 runStep 后，会得到一个数据流
// 这个流会逐步发出 ProviderStreamEvent 类型的值
runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
```

```ts
// 使用方式
const event$ = provider.runStep({ context, state });

// 订阅数据流
event$.subscribe({
  next: (event) => {
    // event 的类型是 ProviderStreamEvent
    if (event.type === "assistant_chunk") {
      console.log(event.text);  // TypeScript 知道这里 event.text 存在
    }
  },
  complete: () => console.log("流结束"),
  error: (err) => console.error("流出错", err),
});
```

---

### `Promise<T>`

`Promise<T>` 表示一个异步操作，最终会产生一个 `T` 类型的值。

#### 含义

- `T` 是 Promise resolve 时的值类型
- Promise 有三种状态：pending、fulfilled、rejected
- 用于处理单次异步操作

#### 项目中的例子

```ts
// src/tools/tool-types.ts
export interface AgentTool {
  // execute 返回 Promise<ToolExecutionResult>
  // 意思是：调用 execute 后，返回一个 Promise
  // 这个 Promise 最终会 resolve 为 ToolExecutionResult
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

```ts
// 使用方式
const result = await tool.execute(input, context);
// result 的类型是 ToolExecutionResult

if (result.status === "success") {
  console.log(result.output);  // TypeScript 知道这里有 output
}
```

#### Observable vs Promise

| 特性 | Observable | Promise |
|------|------------|---------|
| 值的数量 | 0 到多个 | 单个 |
| 取消 | 可以取消 | 不能取消 |
| 使用场景 | 事件流、持续数据 | 单次异步操作 |

---

### 函数类型

函数类型描述函数的参数和返回值类型。

#### 基本语法

```ts
// (参数: 类型) => 返回值类型
type Handler = (event: RuntimeEvent) => void;
type Compare = (a: number, b: number) => number;
```

#### 项目中的例子

```ts
// src/runtime/permission-gate.ts
export interface PermissionGate {
  // evaluate 是一个方法
  // 参数：call 是 ToolCall 类型，riskLevel 是 ToolRiskLevel 类型
  // 返回值：PermissionDecision 类型
  evaluate(call: ToolCall, riskLevel: ToolRiskLevel): PermissionDecision;
}
```

```ts
// src/providers/provider-types.ts
export interface AgentProvider {
  // 方法签名
  // 输入是 ProviderStepInput，返回 Observable<ProviderStreamEvent>
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

#### 回调函数类型

```ts
// 作为对象属性
type Config = {
  onMessage: (text: string) => void;
  onError?: (error: Error) => void;  // 可选的回调
};

// 作为函数参数
function subscribe(handler: (event: RuntimeEvent) => void): void {
  // ...
}
```

---

## TS 特有语法

### `satisfies`

`satisfies` 是 TypeScript 4.9 引入的操作符，用于验证表达式是否满足某个类型，同时保留表达式的具体类型。

#### 为什么需要 satisfies

```ts
// 问题：使用 as 会丢失具体类型信息
const colors = {
  red: "ff0000",
  green: "00ff00",
} as Record<string, string>;

colors.red.toUpperCase();  // 类型是 string，可以调用
colors.blue;  // 类型检查通过，但运行时 undefined！
```

```ts
// 解决：使用 satisfies 验证类型但保留具体信息
const colors = {
  red: "ff0000",
  green: "00ff00",
} satisfies Record<string, string>;

colors.red.toUpperCase();  // 类型是 "ff0000"，可以调用
colors.blue;  // 编译错误！TypeScript 知道 blue 不存在
```

#### 使用场景

```ts
// 确保对象符合某个结构，同时保留字面量类型
const routes = {
  home: "/",
  about: "/about",
  contact: "/contact",
} satisfies Record<string, string>;

// TypeScript 知道 routes.home 的确切值
const path: "/" = routes.home;  // 正确！
```

---

### `as const`

`as const` 是常量断言，让 TypeScript 把值当作更严格的字面量类型。

#### 数组变只读元组

```ts
// 没有 as const
const arr = [1, 2, 3];
// 类型是 number[] - 可变数组

// 有 as const
const arr = [1, 2, 3] as const;
// 类型是 readonly [1, 2, 3] - 只读元组，三个位置分别是 1、2、3
```

#### 对象变深度只读

```ts
// 没有 as const
const config = {
  name: "app",
  version: 1,
};
// 类型是 { name: string; version: number }

// 有 as const
const config = {
  name: "app",
  version: 1,
} as const;
// 类型是 { readonly name: "app"; readonly version: 1 }
```

#### 项目中的应用

```ts
// 定义严格的工具名称类型
const TOOL_NAMES = ["read-file", "bash", "write-file"] as const;
type ToolName = typeof TOOL_NAMES[number];
// ToolName 类型是 "read-file" | "bash" | "write-file"
```

---

### 可选链 `?.`

可选链用于安全地访问可能为 null 或 undefined 的属性。

#### 基本用法

```ts
// 传统写法
if (obj && obj.prop && obj.prop.value) {
  console.log(obj.prop.value);
}

// 可选链写法
console.log(obj?.prop?.value);
```

#### 项目中的例子

```ts
// src/runtime/event-types.ts
export type SessionMessageRecord = {
  type: "message";
  role: "user" | "assistant";
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;  // 可选属性
};

// 使用可选链
const record: SessionMessageRecord = { /* ... */ };
const source = record.source?.toLowerCase();  // 如果 source 是 undefined，结果是 undefined
```

#### 四种形式

```ts
obj?.prop      // 访问属性，obj 为 null/undefined 时返回 undefined
obj?.[key]     // 访问索引，obj 为 null/undefined 时返回 undefined
func?.(args)   // 调用函数，func 为 null/undefined 时不调用，返回 undefined
arr?.[index]   // 访问数组元素，arr 为 null/undefined 时返回 undefined
```

---

### 非空断言 `!`

非空断言告诉 TypeScript "我确定这个值不是 null 或 undefined"。

#### 基本用法

```ts
function process(value: string | null) {
  // TypeScript 认为这里 value 可能是 null
  // value.length;  // 错误！

  // 使用非空断言
  console.log(value!.length);  // 正确，但我们保证 value 不是 null
}
```

#### 使用场景

```ts
// 1. 确信某个元素存在
const element = document.getElementById("app")!;
// 类型是 HTMLElement，而不是 HTMLElement | null

// 2. 已经通过条件检查，但 TypeScript 不知道
let name: string | undefined;
if (condition) {
  name = "Alice";
}
// TypeScript 仍然认为 name 可能是 undefined
// 但我们确定此时一定有值
console.log(name!.toUpperCase());
```

#### 警告

```ts
// 危险！如果运行时值真的是 null，会抛出错误
const value: string | null = null;
value!.toLowerCase();  // 运行时错误: Cannot read property 'toLowerCase' of null
```

**最佳实践：** 尽量使用可选链 `?.` 或条件检查，只有在确定值存在时才使用 `!`。

---

### 类型断言 `as`

类型断言告诉 TypeScript "把某个值当作某个类型"。

#### 基本用法

```ts
// 将类型缩窄
const value: unknown = "hello";
const length = (value as string).length;

// 将类型扩展
const narrow: "a" | "b" = "a";
const wide: string = narrow as string;
```

#### 项目中的例子

```ts
// src/providers/local.ts
function buildToolResultReply(result: TurnToolResult): string {
  if (result.status === "success") {
    return [
      `工具 ${result.toolName} 已完成。`,
      // && 短路求值：如果 result.output 为空，返回 "(no output)"
      // 否则返回 result.output
      result.output && result.output.length > 0 ? result.output : "(no output)",
    ].join("\n");
  }
  // ...
}
```

#### as unknown as T（双重断言）

有时候需要进行双重断言来绕过类型检查：

```ts
// 不能直接断言成不相关的类型
const a: string = "hello";
// const b: number = a as number;  // 错误！

// 通过 unknown 中转
const b: number = a as unknown as number;  // 编译通过
// 危险！运行时会出问题
```

**最佳实践：** 尽量避免类型断言，让 TypeScript 自动推断类型。只在必要时使用。

---

## 项目中的实际例子

### 例子 1：联合类型和类型守卫

```ts
// src/tools/tool-types.ts

// 两个对象类型的联合
export type ToolSuccessResult = {
  status: "success";
  output: string;
  data?: unknown;
};

export type ToolErrorResult = {
  status: "error";
  error: string;
  data?: unknown;
};

// 联合类型
export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult;

// 使用时需要用类型守卫区分
function handleResult(result: ToolExecutionResult) {
  if (result.status === "success") {
    // TypeScript 知道这里是 ToolSuccessResult
    console.log(result.output);  // 可以访问 output
  } else {
    // TypeScript 知道这里是 ToolErrorResult
    console.log(result.error);   // 可以访问 error
  }
}
```

**要点：**
- 联合类型的多个分支通常有共同的属性（如 `status`）
- 通过检查共同属性（类型守卫），TypeScript 能自动缩窄类型

---

### 例子 2：复杂对象类型定义

```ts
// src/runtime/turn-state.ts

// 嵌套的对象类型
export type TurnState = {
  sessionId: string;           // 简单字符串
  turn: number;                // 数字
  cwd: string;
  input: ChatInputTurn;        // 另一个类型
  history: readonly SessionMessageRecord[];  // 只读数组
  step: number;
  status: TurnStatus;          // 字符串字面量联合
  assistantChunks: readonly string[];
  finalMessage?: string;       // 可选属性
  toolCalls: readonly ToolCall[];
  toolResults: readonly TurnToolResult[];
};
```

**要点：**
- `readonly` 表示数组不可修改（push、pop 等方法不存在）
- `?` 表示属性可选
- 复杂类型由简单类型组合而成

---

### 例子 3：工厂函数模式

```ts
// src/runtime/turn-state.ts

// 工厂函数创建初始状态
export function createInitialTurnState(params: {
  sessionId: string;
  input: ChatInputTurn;
  cwd: string;
  history: readonly SessionMessageRecord[];
}): TurnState {
  return {
    sessionId: params.sessionId,
    turn: params.input.turn,
    cwd: params.cwd,
    input: params.input,
    history: [...params.history],  // 创建副本
    step: 1,
    status: "running",
    assistantChunks: [],
    toolCalls: [],
    toolResults: [],
  };
}
```

**要点：**
- 参数使用对象类型，便于扩展和命名参数
- 使用 `[...arr]` 创建数组副本，保持不可变性
- 返回值类型可以省略，让 TypeScript 推断

---

### 例子 4：大量使用联合类型的 RuntimeEvent

```ts
// src/runtime/event-types.ts

// 这是一个"可辨识联合"（discriminated union）
// 所有分支都有 type 属性，用于区分类型
export type RuntimeEvent =
  | {
      type: "session_started";
      sessionId: string;
      sessionPath: string;
      mode: RuntimeMode;
    }
  | {
      type: "user_turn";
      sessionId: string;
      turn: number;
      content: string;
      source: InputSource;
    }
  | {
      type: "tool_result";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: "success";
      output: string;
    }
  // ... 更多分支
  ;

// 使用时
function handleRuntimeEvent(event: RuntimeEvent) {
  switch (event.type) {
    case "session_started":
      // TypeScript 知道这里有 sessionPath、mode
      console.log(`Session started: ${event.sessionPath}`);
      break;
    case "tool_result":
      // TypeScript 知道这里有 output
      console.log(`Tool result: ${event.output}`);
      break;
    // ...
  }
}
```

**要点：**
- 可辨识联合是处理多态事件的常见模式
- `type` 属性作为"标签"区分不同类型
- 配合 switch 语句，TypeScript 能正确推断每个分支的类型

---

## 学习建议

1. **从简单开始**：先理解 `type`、`interface`、基本类型
2. **理解泛型**：通过项目的 `Observable<T>` 和 `Promise<T>` 理解泛型的作用
3. **掌握联合类型**：项目大量使用联合类型，理解类型守卫是关键
4. **多看代码**：阅读 `src/runtime/event-types.ts` 等文件，理解实际应用
5. **善用 IDE**：鼠标悬停在变量上查看类型，帮助理解类型推断

## 参考资源

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [TypeScript Deep Dive（中文版）](https://jkchao.github.io/typescript-book-chinese/)
- 项目文档：`docs/rxjs-guide.md` - RxJS 模式指南
