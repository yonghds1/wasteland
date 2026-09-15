# provider 三层架构：ProviderProfile 收敛供应商差异

## Goal

把 provider 的**供应商差异**（缓存字段名、context window 规格、思维链剥离、额外请求字段）从 adapter 硬编码收敛为**声明式 ProviderProfile**，新增/切换供应商不写新 adapter、不改链路代码。

现状：adapter 按协议分（openai-compatible / anthropic / local）是对的，但同协议内的供应商差异（如 `cached_tokens` 字段名）被硬编码散落在 adapter 里，接新供应商必然踩字段/规格不兼容。

## What I already know

- 三层结构方向已与用户对齐：**ProviderProfile（声明式表）+ Adapter（协议级，仅 3 个）+ 归一化边界（ProviderStreamEvent / usage）**。
- 当前配置（`.wasteland/settings.json`）：minimax/jdcloud/xiaomi 三个 provider，全走 `openai-compatible`；主模型 mimo-v2.5（xiaomi_model）。
- 硬编码痛点（已在分析中定位）：
  1. `src/providers/openai.ts:287` 只读 `prompt_tokens_details.cached_tokens`（OpenAI 官方字段）。DeepSeek 返回 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`，读不到 → `cachedTokens` 恒 undefined。
  2. `src/core/runtime/context-manager.ts:86` 内置 `MODEL_CONTEXT_WINDOWS` 查表，缺 mimo / deepseek-v4 → `resolveContextWindow` fallback 到 128000，可能高估窗口 → 压缩偏晚、被 API 400。
  3. 思维链剥离：`settings-types.ts:248` 注释已提醒 minimax/R1/QwQ 把思考拼进 content，无统一处理。
- 现有 schema 友好：`ProviderSettings` 和 `ModelSettings` 都有 `[key: string]: unknown` 索引签名，profile 字段可直接进 settings.json 不破坏 schema；`ModelSettings.contextWindow` 已提供"用户配置覆盖内置"的口子。
- 参照：LiteLLM（协议 adapter + per-provider 参数表）、Vercel AI SDK（capabilities 声明）；LangChain per-model 是反面教材。
- 实测方法已设计（未执行）：同前缀请求 × 2，对比第二次 usage 的缓存字段 / TTFT。

## Decisions (已确认)

1. **任务范围**：只做三层架构落地（profile + 三个硬编码点迁移）。P0-2 token 预算压缩拆独立任务。
2. **profile 数据位置**：内置默认表（代码）+ settings.json 覆盖。新增供应商在代码加一次默认，用户可局部覆盖。
3. **stripReasoning**：仅在 profile 类型定义中预留字段，**本次不实现剥离逻辑**——当前配置（mimo-v2.5 / MiniMax-M3）无推理模型实际需要，YAGNI。

## Requirements

- 新增 `src/providers/profiles.ts`，声明式 ProviderProfile 表，内置各供应商默认值：
  - provider 级：`usageFields`（缓存字段名候选列表）、`stripReasoning?: boolean`（仅字段，本次不实现）、`extraBody?: Record<string, unknown>`（额外请求字段，预留）
  - model 级：`contextWindow`（**仅内置已确认的窗口**，如 deepseek-v3 64000；mimo / deepseek-v4 无可靠数据则不入表，走 fallback + settings 覆盖）
- **覆盖优先级**：settings.json 的 `ModelSettings.contextWindow` > profile 内置 > 默认 128000（沿用现有机制）。
- `openai.ts` 改读 profile 的 `usageFields`，取第一个非空字段归一化进 `cachedTokens`。
- `context-manager.ts` 窗口解析改读 profile + settings 覆盖（内置查表从 context-manager 迁到 profile 数据，不删行为，只挪位置 + 可覆盖）。
- 归一化边界不变：`ProviderStreamEvent.usage` 统一 schema，供应商原始字段不向上泄漏。
- 新增供应商 = 加 profile 行，不写新 adapter。

## Acceptance Criteria

- [ ] `openai.ts` 从 profile 读缓存字段名：DeepSeek 返回 `prompt_cache_hit_tokens` 时 `cachedTokens` 有值（原实现恒 undefined）
- [ ] `contextWindow` 解析：settings > profile > 默认；profile 表数据与原 `MODEL_CONTEXT_WINDOWS` 行为一致（未配置时结果不变）
- [ ] 现有测试全过（`npm run typecheck` + `npx vitest run`）
- [ ] 供应商差异不出现在 `agent-loop.ts` / `provider-types.ts`（链路代码无供应商 if）
- [ ] `stripReasoning` 仅在类型中声明，无剥离逻辑实现

## Definition of Done

- 类型检查 + 测试全绿
- 链路代码（agent-loop / provider-types / turn-state）零供应商分支
- 新供应商接入路径在 PRD/文档说明（加 profile 行即可）

## Out of Scope (explicit)

- **P0-2 token 预算制压缩**（`planCompaction` 改 token 目标）——独立任务
- Prompt caching 的实测验证（mimo/minimax/deepseek 缓存现状探测）——独立任务，需真实 API 调用
- claude.ts / local.ts 迁移——当前无使用路径
- provider registry 结构调整（新增供应商注册机制）

## Technical Notes

- 落点文件：
  - 新建 `src/providers/profiles.ts`（或 `openai-compatible/profiles.ts`）
  - `src/providers/openai.ts` — requestOpenAIStreaming 的 usage 读取段（287 行附近）
  - `src/core/runtime/context-manager.ts` — `resolveContextWindow`（86-150 行）改为读 profile
  - `src/config/settings-types.ts` — `ModelSettings.contextWindow` 已存在，无需改 schema
- 相关 spec：`.trellis/spec/` 下 providers 相关 layer（待 `get_context.py --mode packages` 确认路径）

## 收口记录（2026-09-15）

ProviderProfile 声明式表已落地：src/providers/profiles.ts 导出 ProviderProfile 类型与供应商表，新增供应商不再改链路。
