/**
 * spawn-agent/input-parser.ts - 子 Agent 输入解析
 *
 * 集中处理 spawn_agent 工具输入的关注点：
 * 1. Zod schema 定义（spawnAgentInputSchema）
 * 2. settings.json subAgent 配置解析（maxRetries / retryDelayMs / tools / model）
 * 3. 通用模型名 → 实际模型名映射（mapModelToActualModel）
 * 4. 嵌套深度检查（depth >= MAX_SPAWN_DEPTH 时拒绝）
 * 5. 模型别名解析（multiAgent.model → settings.models[alias].model）
 * 6. 工具优先级合并（multiAgent.tools > minimax.tools > 全集）
 *
 * 所有逻辑保持与 spawn-agent.ts 旧实现完全一致，保证 451 测试无回归。
 */

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { JsonSchema } from '../../core/tool-types.js';

import {
  MAX_SPAWN_DEPTH,
  type ParseInputParams,
  type ParsedSpawnInput,
  type ResolvedSubAgentInput,
  type SpawnAgentContext,
} from './types.js';

// ============================================================
// Zod Schema
// ============================================================

export const spawnAgentInputSchema = z.object({
  name: z.string().min(1).describe('子 Agent 标识'),
  task: z.string().min(1).describe('任务描述'),
  model: z.string().optional().describe('模型选择（haiku/sonnet/opus 或具体模型名）'),
  tools: z.array(z.string()).optional().describe('限定子 Agent 可用的工具集'),
  inheritHistory: z.boolean().default(false).describe('是否继承父 Agent 的历史上下文'),
});

export const SPAWN_AGENT_INPUT_SCHEMA_JSON = zodToJsonSchema(spawnAgentInputSchema) as JsonSchema;

/** spawn_agent 工具的输入类型（由 spawn-agent 子模块导出） */
export type SpawnAgentInput = z.infer<typeof spawnAgentInputSchema>;

// ============================================================
// 通用模型名 → 实际模型名映射
// ============================================================

/**
 * 将通用模型名称映射到实际模型名称
 *
 * 不同 provider 的通用名（haiku/sonnet/opus）对应实际模型不同，
 * 这里集中映射。找不到映射时原样返回（适用于"具体模型名"输入）。
 */
export function mapModelToActualModel(model: string, providerId: string): string {
  const modelMappings: Record<string, Record<string, string>> = {
    qwen: { haiku: 'qwen-turbo', sonnet: 'qwen-plus', opus: 'qwen-max' },
    ollama: { haiku: 'llama3.2:1b', sonnet: 'llama3.2', opus: 'llama3.3:70b' },
    openai: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o1' },
    'openai-compatible': { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o1' },
    anthropic: {
      haiku: 'claude-haiku-4-5-20251001',
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-8',
    },
  };
  const providerMapping = modelMappings[providerId];
  if (providerMapping && providerMapping[model]) {
    return providerMapping[model];
  }
  return model;
}

// ============================================================
// 工具优先级合并
// ============================================================

/**
 * 解析 tools 配置（逗号分隔字符串或数组）为 string[]
 *
 * settings.json 的 multiAgent[name].tools 可以是字符串（如 "read-file, glob, grep"），
 * 也可以是数组。这里统一转为工具名数组。
 *
 * @param raw - 原始值（字符串 / 数组 / undefined）
 * @returns 工具名数组（已 trim 空格），未定义返回空数组
 */
export function parseSubAgentTools(raw: unknown): string[] {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
  }
  return [];
}

// ============================================================
// 主入口：解析 spawn_agent 输入 + 嵌套深度检查
// ============================================================

/**
 * 解析 spawn_agent 输入 + 返回校验后参数（含 Zod 错误信息）
 *
 * 行为：
 * - Zod 校验失败时返回 `{ ok: false, error }`（caller 负责转译为 tool_failed 事件）
 * - 校验通过时返回 `{ ok: true, parsed }`
 *
 * @param call - tool call（含 input 字段）
 * @returns 校验结果（discriminated union）
 */
export type SpawnInputParseResult =
  | { ok: true; parsed: ParsedSpawnInput }
  | { ok: false; error: string };

export function parseSpawnInput(
  call: { id: string; toolName: string; input: Record<string, unknown> }
): SpawnInputParseResult {
  const parsed = spawnAgentInputSchema.safeParse(call.input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join(', '),
    };
  }

  return {
    ok: true,
    parsed: {
      childName: parsed.data.name,
      childTask: parsed.data.task,
      model: parsed.data.model,
      tools: parsed.data.tools,
      inheritHistory: parsed.data.inheritHistory,
    },
  };
}

/**
 * 嵌套深度检查（spawn_agent 递归保护）
 *
 * depth >= MAX_SPAWN_DEPTH 时拒绝继续 spawn。
 *
 * @param context - 父 agent 上下文（含 depth）
 * @returns 通过返回 true，超限返回 false
 */
export function checkSpawnDepth(context: SpawnAgentContext): boolean {
  const depth = context.depth ?? 0;
  return depth < MAX_SPAWN_DEPTH;
}

// ============================================================
// subAgent 配置 + 工具/模型合并
// ============================================================

/**
 * 解析子 agent 配置（settings.json multiAgent[name]）
 *
 * 关注的字段：
 * - maxRetries / retryDelayMs（默认 0 / 1000）
 * - tools（优先于 minimax 传入的 tools）
 * - model（alias，优先于 minimax.model）
 *
 * 模型别名解析：subAgentConfig.model 是 alias（如 "minimax_model"），
 * 需要从 settings.models 解析为 provider 真正使用的 model name。
 * 若 alias 在 models 中找不到对应配置，保持原值（兼容 alias 即 model name 的场景）。
 *
 * @param params - 子 agent 名字 + minimax 传入 model/tools + 父 context
 * @returns 合并后的子 agent 配置与解析后的模型/工具
 */
export function resolveSubAgentInput(params: ParseInputParams): ResolvedSubAgentInput {
  const { childName, model, tools, context } = params;

  const subAgentConfig = context.loadedSettings?.settings?.multiAgent?.[childName];
  const maxRetries = subAgentConfig?.maxRetries ?? 0;
  const retryDelayMs = subAgentConfig?.retryDelayMs ?? 1000;
  const fallbackModel = subAgentConfig?.fallbackModel;

  // 工具限定优先级：multiAgent.tools > minimax 传入的 tools > 全部工具（context.toolRegistry）
  const subAgentConfigTools = parseSubAgentTools(subAgentConfig?.tools);
  const effectiveTools: string[] | undefined =
    subAgentConfigTools.length > 0
      ? subAgentConfigTools
      : tools && tools.length > 0
        ? tools
        : undefined;

  // 模型选择优先级：subAgentConfig.model > minimax 传入的 model
  const subAgentConfigModel = subAgentConfig?.model;
  const effectiveModel = subAgentConfigModel ?? model;
  const subAgentConfigModelUsed = Boolean(subAgentConfigModel);

  // 模型别名解析
  let resolvedModelAlias: string | undefined = effectiveModel;
  if (subAgentConfigModel && context.loadedSettings?.settings?.models) {
    const aliasConfig = context.loadedSettings.settings.models[subAgentConfigModel];
    if (aliasConfig?.model) {
      resolvedModelAlias = aliasConfig.model;
    }
  }

  const depth = (context.depth ?? 0) + 1;

  return {
    subAgentConfig,
    maxRetries,
    retryDelayMs,
    fallbackModel,
    effectiveTools,
    effectiveModel,
    resolvedModelAlias,
    subAgentConfigModelUsed,
    depth,
  };
}
