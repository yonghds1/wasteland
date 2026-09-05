import type { PermissionMode } from '@core/runtime/permission-gate.js';
import type {
  ModelSettings,
  ProviderSettings,
  ResolvedWastelandSettings,
  RoleSettings,
  SubAgentSettings
} from './settings-types.js';
import { assemblePrompt, isBuiltinRoleId, ROLE_WORKER } from './prompts/index.js';
import type { PromptTemplateRef } from './prompts/prompt-types.js';
import { t, getLocalizedValue } from '@locales/index.js';

export type ResolvedRoleRef = {
  name: string;
  config: RoleSettings;
};

export type ResolvedModelRef = {
  name: string;
  config: ModelSettings;
};

export type ResolvedChatRuntime = {
  role?: ResolvedRoleRef;
  model?: ResolvedModelRef;
  providerName: string;
  providerConfig: ProviderSettings;
  permissionMode: PermissionMode;
  prompt?: string;
};

function omitModelMetadata(model: ModelSettings): ProviderSettings {
  const { provider: _provider, capabilities: _capabilities, ...providerConfig } = model;

  return providerConfig;
}

/**
 * 解析角色提示词
 *
 * 统一使用 promptTemplate 配置：
 * - 字符串：内置角色 ID 或简单提示词
 * - 对象：完整的 PromptTemplate 定义
 * - { template, variables }：引用 + 变量覆盖
 *
 * @param role - 角色配置
 * @param cwd - 工作目录
 * @returns 提示词字符串
 */
/**
 * Agent 运行模式
 *
 * 区别于 RuntimeMode（'single' | 'interactive'，由输入来源推导）：
 * - 'single': 单 agent 模式，去掉多角色编排提示词，可取 singleAgent 配置
 * - 'multi': 多 agent 模式，orchestrator 注入 multiAgent 角色清单
 */
export type AgentMode = 'single' | 'multi';

/**
 * 组装 "## Available Agents" 整块内容（标题 + 清单 + spawn_agent 部署说明）
 *
 * agents 段在模板中完全由 {{agents}} 变量驱动，因此标题与页脚也在这里拼装。
 */
function buildAgentsBlock(list: string): string {
  return `## Available Agents\n\n${list}\n\nDeploy them via spawn_agent according to their specialty.`;
}

/**
 * 生成 orchestrator 的 agents 块
 *
 * @param multiAgent - 多 agent 配置
 * @param agentMode - 运行模式
 * @returns agents 块内容（single 模式返回空字符串）
 */
function generateOrchestratorAgentsBlock(
  multiAgent: Record<string, SubAgentSettings>,
  agentMode: AgentMode
): string {
  // single 模式：不注入多角色清单
  if (agentMode === 'single') {
    return '';
  }

  const entries = Object.entries(multiAgent);
  if (entries.length === 0) {
    // 无 multiAgent 配置，使用默认清单
    return buildAgentsBlock(
      `- researcher: information gathering
- developer: code implementation
- analyst: system analysis
- tester: testing & verification`
    );
  }

  const list = entries
    .map(([name, cfg]) => {
      const desc = getLocalizedValue(cfg as Record<string, unknown>, 'description');
      return `- ${name}: ${desc || name}`;
    })
    .join('\n');
  return buildAgentsBlock(list);
}

/**
 * 解析角色 prompt（支持多级覆盖）
 *
 * 优先级（从高到低）：
 * 1. roles[roleName].promptTemplate（角色级覆盖）
 * 2. runtime.promptTemplate（全局覆盖）
 * 3. 传入的 role 参数（内置默认）
 *
 * @param roleName - 角色名称
 * @param settings - 完整配置（用于检查 roles 和 runtime 覆盖）
 * @param role - 内置角色配置（fallback）
 * @param cwd - 工作目录
 * @param format - 输出格式
 * @returns 组装后的 prompt
 */
function resolveRolePrompt(
  roleName: string,
  settings: ResolvedWastelandSettings,
  role: RoleSettings | undefined,
  cwd: string,
  format: 'markdown' | 'xml' = 'markdown'
): string {
  // 1. 角色级覆盖（roles[roleName].promptTemplate）
  const roleOverride = settings.roles?.[roleName as keyof typeof settings.roles];
  if (roleOverride?.promptTemplate) {
    return assembleFromRef(roleOverride.promptTemplate, cwd, format);
  }

  // 2. 全局覆盖（runtime.promptTemplate）
  if (settings.runtime.promptTemplate) {
    return assembleFromRef(settings.runtime.promptTemplate, cwd, format);
  }

  // 3. 内置默认（role 参数或 role-worker）
  if (role?.promptTemplate) {
    return assembleFromRef(role.promptTemplate, cwd, format);
  }

  // 4. 最终回退：role-worker 模板
  return assemblePrompt(ROLE_WORKER, { cwd, variables: {} }, format);
}

/**
 * 从 PromptTemplateRef 组装 prompt
 */
function assembleFromRef(
  ref: PromptTemplateRef,
  cwd: string,
  format: 'markdown' | 'xml' = 'markdown'
): string {
  // 字符串类型：判断是内置角色 ID 还是简单提示词
  if (typeof ref === 'string') {
    if (isBuiltinRoleId(ref)) {
      return assemblePrompt(ref, { cwd, variables: {} }, format);
    }
    // 简单提示词：包装成模板
    return assemblePrompt(
      { name: 'simple-prompt', sections: [{ id: 'main', content: ref }] },
      { cwd, variables: {} },
      format
    );
  }

  // 对象类型：直接使用
  if ('sections' in ref) {
    return assemblePrompt(ref, { cwd, variables: {} }, format);
  }

  throw new Error(t('config.cannotParsePromptTemplate', { template: JSON.stringify(ref) }));
}

/**
 * 内置角色配置（功能性，可被用户在 multiAgent 中覆盖）
 */
const BUILTIN_ORCHESTRATOR_CONFIG: RoleSettings = {
  promptTemplate: 'role-orchestrator',
};

const BUILTIN_WORKER_CONFIG: RoleSettings = {
  promptTemplate: 'role-worker',
};

/** 内置角色注册表：角色名 -> 默认配置 */
const BUILTIN_ROLE_CONFIGS: Record<string, RoleSettings> = {
  orchestrator: BUILTIN_ORCHESTRATOR_CONFIG,
  worker: BUILTIN_WORKER_CONFIG,
};

function resolveRole(
  settings: ResolvedWastelandSettings,
  requestedRoleName: string | undefined
): ResolvedRoleRef | undefined {
  if (!requestedRoleName) {
    return undefined;
  }

  // 用户配置优先（主子角色皆可覆盖/新增）
  const userRole = settings.multiAgent[requestedRoleName];
  if (userRole) {
    return {
      name: requestedRoleName,
      config: userRole,
    };
  }

  // 内置角色
  const builtinConfig = BUILTIN_ROLE_CONFIGS[requestedRoleName];
  if (builtinConfig) {
    return {
      name: requestedRoleName,
      config: builtinConfig,
    };
  }

  throw new Error(
    t('config.roleNotDefined', {
      roleName: requestedRoleName,
      availableRoles: [
        ...Object.keys(BUILTIN_ROLE_CONFIGS),
        ...Object.keys(settings.multiAgent),
      ].join(', '),
    })
  );
}

function resolveModel(
  settings: ResolvedWastelandSettings,
  role: ResolvedRoleRef | undefined,
  agentMode: AgentMode
): ResolvedModelRef | undefined {
  // single 模式：优先取 singleAgent.model（"完整取 singleAgent 配置"语义）
  if (agentMode === 'single') {
    const singleModelName = settings.singleAgent?.model;
    if (singleModelName) {
      const singleModel = settings.models[singleModelName];
      if (!singleModel) {
        throw new Error(
          t('config.modelNotDefined', {
            roleName: 'singleAgent',
            modelName: singleModelName,
            availableModels: Object.keys(settings.models).join(', '),
          })
        );
      }
      return { name: singleModelName, config: singleModel };
    }
  }

  if (!role) {
    return undefined;
  }

  // 优先使用角色配置的 model，然后 fallback 到 runtime.defaultModel
  const modelName = role.config.model ?? settings.runtime.defaultModel;
  const model = modelName ? settings.models[modelName] : undefined;

  if (!model || !modelName) {
    throw new Error(
      t('config.modelNotDefined', {
        roleName: role.name,
        modelName: modelName ?? '(未设置)',
        availableModels: Object.keys(settings.models).join(', '),
      })
    );
  }

  return {
    name: modelName,
    config: model,
  };
}

export function resolveChatRuntime(params: {
  settings: ResolvedWastelandSettings;
  roleName?: string;
  providerName?: string;
  cwd?: string;
  /**
   * Agent 运行模式覆盖（single/multi）。
   * 缺省时取 settings.runtime.mode，再缺省 'single'。
   * 注意区别于 RuntimeMode（'single'|'interactive'，由输入来源推导）。
   */
  agentMode?: AgentMode;
  /**
   * 项目记忆文本（memory.md），非空时前置注入到 system prompt 最前面。
   * 由调用方从 loadedSettings.memory 传入。
   */
  memory?: string;
}): ResolvedChatRuntime {
  const agentMode: AgentMode = params.agentMode ?? params.settings.runtime.mode ?? 'single';
  const role = resolveRole(params.settings, params.roleName ?? params.settings.runtime.defaultRole);
  let model = resolveModel(params.settings, role, agentMode);
  const providerName =
    params.providerName ?? model?.config.provider ?? params.settings.defaultProvider;

  // 当指定 provider 时，智能匹配 model
  if (params.providerName) {
    // 查找该 provider 下的所有 model
    const matchingModels = Object.entries(params.settings.models)
      .filter(([_, config]) => config.provider === params.providerName);

    if (matchingModels.length === 0) {
      // 没有匹配的 model，报错
      throw new Error(
        t('config.providerNoModels', {
          providerName: params.providerName,
          availableModels: Object.keys(params.settings.models).join(', '),
        })
      );
    }

    // 检查当前 model 是否已经匹配该 provider
    const currentModelMatches = model && model.config.provider === params.providerName;

    if (!currentModelMatches) {
      if (matchingModels.length === 1) {
        // 只有一个 model，自动选择（静默）
        model = {
          name: matchingModels[0][0],
          config: matchingModels[0][1],
        };
      } else {
        // 多个 model，使用第一个，但发出警告
        console.warn(
          t('config.providerMultipleModels', {
            providerName: params.providerName,
            modelNames: matchingModels.map(([n]) => n).join(', '),
            selectedModel: matchingModels[0][0],
          })
        );
        model = {
          name: matchingModels[0][0],
          config: matchingModels[0][1],
        };
      }
    }
  }

  const providerSettings = params.settings.providers[providerName] ?? {};

  // 解析提示词模板
  const cwd = params.cwd ?? process.cwd();
  // - single 模式且配置了 singleAgent.promptTemplate：优先使用 singleAgent 模板
  // - 否则内置 orchestrator 按 agentMode 注入/省略子角色清单
  const singleAgent = params.settings.singleAgent;
  let effectiveConfig: RoleSettings | undefined;
  if (agentMode === 'single' && singleAgent?.promptTemplate) {
    effectiveConfig = { promptTemplate: singleAgent.promptTemplate };
  } else {
    effectiveConfig = role?.config;
  }
  const promptFormat = params.settings.runtime?.promptFormat ?? 'markdown';
  let basePrompt = resolveRolePrompt(
    role?.name ?? 'orchestrator',
    params.settings,
    effectiveConfig,
    cwd,
    promptFormat
  );

  // orchestrator 动态注入 agents 块
  if (role?.name === 'orchestrator' && agentMode === 'multi') {
    const agentsBlock = generateOrchestratorAgentsBlock(params.settings.multiAgent, agentMode);
    if (agentsBlock) {
      // 在 delegation 段后插入 agents 块
      const delegationMarker = basePrompt.includes('## Execution & Delegation Protocol')
        ? '## Execution & Delegation Protocol'
        : '## Deployment Protocol';
      const delegationIdx = basePrompt.indexOf(delegationMarker);
      if (delegationIdx !== -1) {
        // 找到 delegation 段结束位置
        const afterDelegation = basePrompt.indexOf('\n##', delegationIdx + delegationMarker.length);
        if (afterDelegation !== -1) {
          basePrompt =
            basePrompt.slice(0, afterDelegation) +
            '\n\n' +
            agentsBlock +
            basePrompt.slice(afterDelegation);
        } else {
          // delegation 是最后一个段，在末尾追加
          basePrompt += '\n\n' + agentsBlock;
        }
      } else {
        basePrompt += '\n\n' + agentsBlock;
      }
    }
  }

  // 按当前语言注入回复语言指令（所有角色统一）
  const languageDirective =
    params.settings.runtime.language === 'zh'
      ? 'Always respond to the user in Simplified Chinese (简体中文).'
      : 'Always respond to the user in English.';
  const prompt = basePrompt ? `${basePrompt}\n\n${languageDirective}` : basePrompt;

  // 项目记忆前置到 system prompt 最前面，作为常驻项目约定（与 multi/single 模式正交）
  const memoryText = params.memory?.trim();
  const finalPrompt = memoryText ? `## Project Memory\n\n${memoryText}\n\n${prompt}` : prompt;

  return {
    role,
    model,
    providerName,
    providerConfig: model
      ? {
          ...providerSettings,
          ...omitModelMetadata(model.config),
        }
      : {
          ...providerSettings,
        },
    permissionMode: role?.config.permissionMode ?? params.settings.runtime.permissionMode,
    prompt: finalPrompt,
  };
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();

  return (
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password')
  );
}

export function redactSensitiveConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveConfig(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key) ? '***' : redactSensitiveConfig(nestedValue);
  }

  return redacted;
}
