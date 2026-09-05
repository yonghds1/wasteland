# brainstorm: 下一步功能规划

## Goal

基于刚完成的工具 Schema 体系改造（Zod 驱动），规划 wasteland 项目的下一个高价值功能方向。

## What I already know

### 项目当前状态（0.1.0）

**已完成的核心功能：**
- Agent Runtime（RxJS 响应式循环）✅
- Provider 层（OpenAI 兼容 / Claude / Local）✅
- 工具系统（13 个内置工具 + MCP）✅
- 多 Agent 架构（spawn_agent）✅
- 会话管理（持久化 / Resume / 索引）✅
- 技能系统（发现 / 注册 / 执行）✅
- TUI 界面（Ink/React）✅
- 配置系统（层级合并）✅
- 国际化（中英文）✅
- 工具参数 Schema 统一（Zod）✅ 刚完成

**已知待改进项：**
1. bash 工具缺少超时控制、输出大小限制、命令黑名单
2. 业务技能缺失（/review、/test、/refactor、/doc）
3. spawn_agent 并行执行能力未实现
4. MCP 协议实现不完整（消息帧、SSE、Resources、Prompts）
5. web-search 仅支持 DuckDuckGo，HTML 正则解析脆弱
6. init-skill 生成的 CLAUDE.md 内容质量差（大量 TODO）

**测试状态：** 305 个测试全部通过

### 架构约束

- Node.js 20+，ESM 模块
- TypeScript 6.x
- RxJS 7.x（核心运行时）
- 已有 Zod + zod-to-json-schema 依赖

## Open Questions

* 下一个功能方向是什么？

## Requirements (evolving)

## Acceptance Criteria (evolving)

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

## Technical Notes

* 刚完成 commit 53ec0d2：统一工具参数 Schema 体系
* 工具系统成熟度约 70%，技能系统约 80%，MCP 系统约 50%
