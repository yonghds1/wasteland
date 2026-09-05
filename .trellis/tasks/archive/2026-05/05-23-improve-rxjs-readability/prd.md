# refactor: improve RxJS readability

## Goal

让 RxJS 新手能更容易理解项目中的响应式代码，通过注释、拆分和文档三管齐下。

## Requirements

### 1. 添加详细中文注释

在核心文件中添加详细注释：
- 每个操作符的作用
- 数据流向说明
- 时序关系说明

### 2. 拆分命名函数

把复杂的 operator 链拆分成有清晰命名的辅助函数：
- `runTurnLoop` 内部的逻辑拆分
- `runAgentLoop` 内部的逻辑拆分
- 每个函数有 JSDoc 说明

### 3. 写文档说明

创建 `docs/rxjs-guide.md`：
- 解释项目中的 RxJS 模式
- `defer` + `concat` + 递归 循环模式
- 外层/内层源的关系
- 关键操作符图解

## Acceptance Criteria

* [x] `src/runtime/agent-loop.ts` 有详细中文注释
* [x] 复杂逻辑拆分成命名函数
* [x] `docs/rxjs-guide.md` 文档存在且内容完整
* [x] `npm run check` 通过
* [x] RxJS 可读性规范已写入 `.trellis/spec/backend/quality-guidelines.md`

## Target Files

* `src/runtime/agent-loop.ts`
* `src/ui/readline-input.ts`
* `src/providers/qwen.ts`
* `docs/rxjs-guide.md` (新建)
