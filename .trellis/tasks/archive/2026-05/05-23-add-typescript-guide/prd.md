# docs: add TypeScript beginner guide

## Goal

让 TypeScript 新手能更容易理解项目中的类型代码，通过注释、文档和规范三管齐下。

## Requirements

### 1. 创建 TypeScript 新手指南

创建 `docs/typescript-guide.md`，内容包括：

- **基础类型语法**：type、interface、泛型、类型推断
- **复杂类型签名**：Observable<T>、Promise<T>、函数类型
- **TS 特有语法**：satisfies、as const、可选链、非空断言
- **项目中的实际例子**：结合代码讲解

### 2. 添加类型注释

在核心类型文件添加注释：
- `src/runtime/event-types.ts`
- `src/tools/tool-types.ts`
- `src/providers/provider-types.ts`

### 3. 规范落地

把 TypeScript 可读性规范写入 `.trellis/spec/backend/quality-guidelines.md`

## Acceptance Criteria

* [x] `docs/typescript-guide.md` 文档存在且内容完整
* [x] 核心类型文件有详细中文注释
* [x] TypeScript 可读性规范已写入 spec
* [x] `npm run check` 通过
