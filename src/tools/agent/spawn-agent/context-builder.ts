/**
 * spawn-agent/context-builder.ts - 子 Agent 上下文组装
 *
 * 集中处理 spawn_agent 上下文准备：
 * 1. assembleSubAgentPrompt - 角色 persona + promptTemplate 组装
 * 2. inheritHistory 拼装 - 父历史作为前缀注入子任务
 * 3. tool 限定 - 根据 effectiveTools 创建子 ToolRegistry
 * 4. provider 解析 - 根据 resolvedModelAlias 创建 childProvider
 *
 * 输出 ResolvedChildSetup：childSessionId + childInput$ + childToolRegistry +
 * childProvider + subAgentPrompt，作为 runAgentLoop 调用参数。
 */

import { of } from 'rxjs';

import { t } from '@locales/index.js';
import { Logger } from '@core/logger/index.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import type { AgentTool } from '../../core/tool-types.js';
import { PromptAssembler } from '@config/prompts/prompt-assembler.js';
import { composeAgentPrompt } from '@config/roles/index.js';
import { mapModelToActualModel } from './input-parser.js';

import type {
  ResolvedChildSetup,
  ResolvedSubAgentInput,
  SpawnAgentContext,
} from './types.js';

// ============================================================
// system prompt 组装
// ============================================================

/**
 * 将项目记忆前置注入到 system prompt 最前面
 *
 * 与主 agent 的注入格式保持一致（`## Project Memory` 块），
 * 让子 agent 也继承项目级/用户级持久约定。
 *
 * @param prompt - 已组装的 system prompt
 * @param memory - 项目记忆文本（可为空）
 * @returns 注入后的 prompt；memory 为空时原样返回
 */
function injectMemory(prompt: string, memory?: string): string {
  const memoryText = memory?.trim();
  return memoryText ? `## Project Memory\n\n${memoryText}\n\n${prompt}` : prompt;
}

/**
 * 根据 subAgentConfig 组装子 agent 的 system prompt
 *
 * 设计目的：minimax 是小模型，没有 system prompt 约束时只能"角色扮演"。
 * 这里通过 PromptAssembler + subAgentConfig.promptTemplate
 * 注入真实角色（researcher / developer / analyst / tester 等）。
 *
 * 行为：
 * - subAgentConfig 不存在时返回 undefined，保持 minimax 传参降级路径
 * - selectedSkinId 缺失或未注册时使用 defaultRoleSkin（上游已 fallback）
 * - 功能 prompt 组装后追加到英文 persona 之后
 *
 * @param params - subAgentConfig 与上下文
 * @returns persona + 功能 prompt；无 subAgentConfig 时返回 undefined
 */
export function assembleSubAgentPrompt(params: {
  subAgentConfig: ResolvedSubAgentInput['subAgentConfig'];
  cwd: string;
  roleName: string;
  tools: string[];
  selectedSkinId: string;
  sessionId?: string;
  format?: 'markdown' | 'xml';
  /** 项目记忆（memory.md），非空时前置注入到子 agent system prompt 最前面 */
  memory?: string;
}): string | undefined {
  if (!params.subAgentConfig) return undefined;

  const promptTemplate = params.subAgentConfig.promptTemplate;

  try {
    if (!promptTemplate) {
      // 没有 promptTemplate 时用 role-worker 模板作为默认
      return injectMemory(
        composeAgentPrompt(params.roleName, undefined, params.format ?? 'markdown'),
        params.memory
      );
    }

    const assembler = new PromptAssembler({ cwd: params.cwd });
    const ref = promptTemplate as
      | string
      | { sections: unknown[]; name?: string };

    const result = assembler.assemble(
      ref as Parameters<typeof assembler.assemble>[0],
      {
        cwd: params.cwd,
        roleName: params.roleName,
        tools: params.tools,
        variables: {},
      },
      params.format ?? 'markdown'
    );
    return injectMemory(composeAgentPrompt(params.roleName, result.content), params.memory);
  } catch (err) {
    // prompt 组装失败不应阻塞子 agent 启动，仅记录日志
    Logger.warn({
      sessionId: params.sessionId ?? 'unknown',
      scope: 'tool',
      message: 'sub_agent_prompt_error',
      data: {
        kind: 'sub_agent_prompt_error',
        roleName: params.roleName,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return undefined;
  }
}

// ============================================================
// inheritHistory 拼装
// ============================================================

/**
 * 将父历史拼成前缀
 *
 * - 不继承时返回原 childTask
 * - 继承时按 roleUser/roleAssistant 翻译键拼成前缀 + 当前任务
 *
 * @param childTask - minimax 传入的子任务
 * @param inheritHistory - 是否继承
 * @param history - 父历史
 * @returns 拼装后的任务内容
 */
export function buildChildTaskContent(
  childTask: string,
  inheritHistory: boolean,
  history: SpawnAgentContext['history']
): string {
  if (!inheritHistory || history.length === 0) return childTask;

  const historySummary = history
    .filter((record) => record.type === 'message')
    .map((record) => {
      const role =
        record.role === 'user'
          ? t('tools.spawnAgent.roleUser')
          : t('tools.spawnAgent.roleAssistant');
      return `【${role}】\n${record.content}`;
    })
    .join('\n\n');

  if (!historySummary) return childTask;

  return `${t('tools.spawnAgent.historyHeader')}\n\n${historySummary}\n\n${t('tools.spawnAgent.currentTaskHeader')}\n\n${childTask}`;
}

// ============================================================
// 子 ToolRegistry（按 effectiveTools 限定）
// ============================================================

/**
 * 根据 effectiveTools 限定子 agent 的工具集
 *
 * 行为：
 * - effectiveTools 为空/未指定 → 沿用父 context.toolRegistry
 * - effectiveTools 有值 → 创建新的 ToolRegistry 只含列出的工具
 *
 * @param effectiveTools - 工具白名单（已合并 multiAgent/tools）
 * @param context - 父 context（含 toolRegistry）
 * @returns 限定后的 ToolRegistry 或 undefined
 */
export function buildChildToolRegistry(
  effectiveTools: string[] | undefined,
  context: SpawnAgentContext,
  reportResultTool: AgentTool
): ToolRegistry | undefined {
  // 始终注入 report_result 工具（子 agent 必须用它返回结构化结果）
  const mandatoryTools = [reportResultTool];

  if (!effectiveTools || effectiveTools.length === 0) {
    // 无工具白名单：继承父工具 + report_result
    const parentTools = context.toolRegistry?.list().map(name => context.toolRegistry?.get(name)).filter(Boolean) ?? [];
    return new ToolRegistry([...mandatoryTools, ...parentTools] as AgentTool[]);
  }
  if (!context.toolRegistry) return undefined;

  const allowedTools = effectiveTools
    .map((toolName) => context.toolRegistry?.get(toolName))
    .filter((tool): tool is AgentTool => tool !== undefined);

  // 合并：配置的工具 + report_result
  return new ToolRegistry([...mandatoryTools, ...allowedTools]);
}

// ============================================================
// childProvider 解析
// ============================================================

/**
 * 根据 resolvedModelAlias 解析 childProvider
 *
 * 行为：
 * - 无 providerRegistry / providerSettings → 沿用 context.provider
 * - subAgentConfigModel 路径下 resolvedModelAlias 已是真实 model name
 *   （已在 input-parser 阶段还原）
 * - 否则走通用名映射 (mapModelToActualModel)
 *
 * @param context - 父 context
 * @param resolved - 已解析的子 agent 配置
 * @returns 子 Provider（沿用父或创建新的）
 */
/**
 * 计算子 agent 实际使用的模型名
 *
 * - `subAgentConfigModel` 路径下 `resolvedModelAlias` 已是真实 model name
 * - 否则 `effectiveModel === resolvedModelAlias`，走通用名映射
 *
 * @returns 子 agent 模型名；未指定独立模型时返回 null（继承父）
 */
function resolveChildModel(
  context: SpawnAgentContext,
  resolved: ResolvedSubAgentInput
): string | null {
  if (!resolved.resolvedModelAlias) return null;
  if (resolved.subAgentConfigModelUsed) {
    return resolved.resolvedModelAlias;
  }
  // 优先检查用户 settings.models 是否定义了该 alias（如 sonnet / haiku / default 等）
  const configuredModel = context.loadedSettings?.settings?.models?.[resolved.resolvedModelAlias]?.model;
  if (configuredModel) {
    return configuredModel;
  }
  // 针对通用 openai-compatible 终端：无特殊配置时继承父模型，避免盲发 gpt-4o 导致 404/卡死
  if (context.provider.id === 'openai-compatible') {
    return context.providerSettings?.model ?? resolved.resolvedModelAlias;
  }
  return mapModelToActualModel(resolved.resolvedModelAlias, context.provider.id);
}

/**
 * 解析子 agent 的 providerSettings
 *
 * 子 agent 有独立模型时返回含子模型名的 settings，否则返回父 settings（继承）。
 * runAgentLoop 用 `providerSettings.model` 解析 context window —— 传子模型
 * settings 可让子 agent 的 context window 基于其实际模型，而非父模型。
 *
 * @param context - 父 context
 * @param resolved - 子 agent 解析结果
 * @returns 子 providerSettings（可能为 undefined，表示继承父 context.providerSettings）
 */
export function resolveChildProviderSettings(
  context: SpawnAgentContext,
  resolved: ResolvedSubAgentInput
): SpawnAgentContext['providerSettings'] {
  if (!context.providerSettings) return context.providerSettings;
  const actualModel = resolveChildModel(context, resolved);
  if (!actualModel) return context.providerSettings;
  return { ...context.providerSettings, model: actualModel };
}

export function resolveChildProvider(
  context: SpawnAgentContext,
  resolved: ResolvedSubAgentInput
): SpawnAgentContext['provider'] {
  if (!context.providerRegistry || !context.providerSettings) {
    return context.provider;
  }
  const settings = resolveChildProviderSettings(context, resolved);
  if (!settings) return context.provider;
  return context.providerRegistry.resolve(context.provider.id, settings);
}

// ============================================================
// 主入口：组装 runAgentLoop 调用参数
// ============================================================

/**
 * 组装 runAgentLoop 调用所需的子 agent 上下文
 *
 * 集中串联：system prompt + inheritHistory + tool 限定 + provider 解析
 *
 * @param params - 子 session id + childName + sub agent 输入 + 父 context + 选中的 skin
 * @returns ResolvedChildSetup（childSessionId / childInput$ / childToolRegistry / childProvider / subAgentPrompt）
 */
export function buildChildSetup(params: {
  childSessionId: string;
  childName: string;
  childTask: string;
  inheritHistory: boolean;
  subAgentConfig: ResolvedSubAgentInput['subAgentConfig'];
  resolved: ResolvedSubAgentInput;
  context: SpawnAgentContext;
  selectedSkinId: string;
  reportResultTool: AgentTool;
}): ResolvedChildSetup {
  const taskContent = buildChildTaskContent(
    params.childTask,
    params.inheritHistory,
    params.context.history
  );

  const childInput$ = of({
    turn: 1,
    content: taskContent,
    source: 'message' as const,
  });

  const childToolRegistry = buildChildToolRegistry(
    params.resolved.effectiveTools,
    params.context,
    params.reportResultTool
  );

  const childProvider = resolveChildProvider(params.context, params.resolved);
  const childProviderSettings = resolveChildProviderSettings(params.context, params.resolved);

  const promptFormat = params.context.loadedSettings?.settings?.runtime?.promptFormat ?? 'markdown';
  const subAgentPrompt = assembleSubAgentPrompt({
    subAgentConfig: params.subAgentConfig,
    cwd: params.context.cwd,
    roleName: params.childName,
    tools: params.resolved.effectiveTools ?? params.context.toolRegistry?.list() ?? [],
    selectedSkinId: params.selectedSkinId,
    format: promptFormat,
    memory: params.context.loadedSettings?.memory,
  });

  return {
    childSessionId: params.childSessionId,
    childInput$,
    childToolRegistry,
    childProvider,
    childProviderSettings,
    subAgentPrompt,
  };
}
