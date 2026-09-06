# Wasteland AI 导航与高频速查 (AI Router & Cheat Sheet)

> **⚠️ 致所有 AI 编程助手 (Claude, Cursor, Gemini 等)**：
> 本项目采用 Trellis 系统进行知识管理。请**不要**依赖你自身的预训练记忆来猜测项目的架构或业务逻辑。

## 🔍 核心知识库路由 (Single Source of Truth)

你所需的真实、最新的项目规范全部存放在 `.trellis/` 目录中：

- **开发流程与任务分配**：阅读 `.trellis/workflow.md`
- **后端架构边界与记忆设计**：阅读 `.trellis/spec/backend/index.md` (重点关注 `architecture-rules.md`)
- **前端渲染与皮肤主题系统**：阅读 `.trellis/spec/frontend/index.md`
- **当前活跃任务状态**：查看 `.trellis/tasks/` 目录下的最新任务。

---

## ⚡ 绝对底线规范 (Non-negotiable Rules)

在不查阅具体 Spec 的情况下进行简单修改时，必须遵守以下铁律：

1. **测试文件**：使用 Vitest，必须放置在与被测试文件同级的 `__tests__/` 目录中（严禁在同级混杂外露的 `.test.ts`）。
2. **代码体积**：单文件严格控制在 500 行以内。
3. **导入语法**：
   - 类型导入必须使用 `import type`。
   - 内部模块使用相对路径导入，严禁从 `dist/` 导入。

---

## 🛠️ 高频开发指令 (Cheat Sheet)

```bash
# 测试
npm test                    # 运行所有测试
npx vitest run <file>       # 运行单个测试文件

# 构建与检查
npm run build               # 构建 TypeScript
npm run typecheck           # 类型检查
npm run check:fast          # 快速类型与 Lint 检查
```
