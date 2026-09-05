/**
 * profiles.ts - 供应商声明式 Profile 表（ProviderProfile）
 *
 * 把同一协议（openai-compatible）内不同供应商的差异收敛为声明式数据：
 * - usageFields：usage 中缓存 token 的字段名候选列表
 * - contextWindows：已知模型的 context window 规格
 * - stripReasoning / extraBody：预留字段（本次不实现剥离逻辑）
 *
 * 新增/切换供应商只需在此表加一行，不改 adapter、不改链路代码。
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 供应商 Profile（声明式配置表）
 *
 * 描述单个供应商在 openai-compatible 协议下的差异。
 * 供应商原始字段差异只在此表声明，并在 adapter（openai.ts）内部消化，
 * 归一化边界（ProviderStreamEvent.usage）保持统一 schema。
 *
 * @example
 * const deepseek = PROVIDER_PROFILES['deepseek'];
 * // deepseek.usageFields === ['prompt_cache_hit_tokens']
 */
export type ProviderProfile = {
  /** 供应商 ID（与表 key 一致） */
  id: string;
  /** baseUrl 匹配子串（小写），命中即判定为该供应商 */
  matchBaseUrl?: string[];
  /** 模型名匹配子串（小写），baseUrl 无法命中时的备用判据 */
  matchModel?: string[];
  /**
   * usage 中缓存 token 字段名候选列表（点号路径）。
   * 取第一个非空值归一化为 cachedTokens。
   */
  usageFields: string[];
  /**
   * 是否剥离思维链（预留字段，本次不实现剥离逻辑）
   *
   * minimax / DeepSeek R1 / QwQ 等会把思考拼进 content，
   * 后续需要时按此字段实现剥离，当前仅声明。
   */
  stripReasoning?: boolean;
  /**
   * 额外请求体字段（预留）
   *
   * 某些供应商需要额外请求参数（如推理预算），后续需要时在此声明。
   */
  extraBody?: Record<string, unknown>;
  /**
   * 模型级 context window 表（token 数）
   *
   * 仅收录已确认规格的模型；无可靠数据的模型不入表，
   * 走默认值 + ModelSettings.contextWindow 覆盖。
   */
  contextWindows?: Record<string, number>;
};

/** OpenAI 官方缓存字段（作为通用兜底，见 mergeUsageFields） */
const OPENAI_CACHED_TOKENS_FIELD = 'prompt_tokens_details.cached_tokens';

// ============================================================
// 内置 Profile 表
// ============================================================

/**
 * 内置供应商 Profile 表
 *
 * 按供应商 ID 索引。新增供应商时在此加一行即可。
 */
export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  openai: {
    id: 'openai',
    matchBaseUrl: ['api.openai.com'],
    usageFields: [OPENAI_CACHED_TOKENS_FIELD],
    contextWindows: {
      'o1': 200000,
      'o3-mini': 200000,
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
    },
  },
  anthropic: {
    id: 'anthropic',
    matchBaseUrl: ['api.anthropic.com'],
    usageFields: [],
    contextWindows: {
      'claude-3-7-sonnet': 200000,
      'claude-3-5-sonnet': 200000,
      'claude-3-5-haiku': 200000,
      'claude-3-opus': 200000,
      'claude-3-sonnet': 200000,
      'claude-3-haiku': 200000,
    },
  },
  deepseek: {
    id: 'deepseek',
    matchBaseUrl: ['deepseek'],
    matchModel: ['deepseek'],
    usageFields: ['prompt_cache_hit_tokens'],
    contextWindows: {
      'deepseek-r1': 64000,
      'deepseek-reasoner': 64000,
      'deepseek-chat': 64000,
      'deepseek-v3': 64000,
      'deepseek-v2.5': 32768,
    },
  },
  minimax: {
    id: 'minimax',
    matchBaseUrl: ['minimaxi'],
    matchModel: ['minimax'],
    usageFields: [],
    contextWindows: {
      'minimax-m3': 128000,
      'minimax-m2.7': 128000,
    },
  },
  qwen: {
    id: 'qwen',
    matchBaseUrl: ['dashscope', 'aliyuncs.com/qwen'],
    matchModel: ['qwen'],
    usageFields: [],
    contextWindows: {
      'qwen-2.5': 131072,
      'qwen2.5': 131072,
      'qwen-max': 32768,
      'qwen-plus': 131072,
      'qwen-turbo': 131072,
    },
  },
  glm: {
    id: 'glm',
    matchBaseUrl: ['bigmodel.cn', 'zhipu'],
    matchModel: ['glm'],
    usageFields: [],
    contextWindows: {
      'glm-5': 128000,
      'glm-4': 128000,
    },
  },
  xiaomi: {
    id: 'xiaomi',
    matchBaseUrl: ['xiaomimimo', 'mimo'],
    matchModel: ['mimo'],
    usageFields: [],
    contextWindows: {
      'mimo-v2.5': 262144,
      'mimo-v2': 262144,
      'mimo': 262144,
    },
  },
  google: {
    id: 'google',
    matchBaseUrl: ['generativelanguage.googleapis.com'],
    matchModel: ['gemini'],
    usageFields: [],
    contextWindows: {
      'gemini-2.0-pro': 2097152,
      'gemini-2.0-flash': 1048576,
      'gemini-1.5-pro': 2097152,
      'gemini-1.5-flash': 1048576,
    },
  },
  moonshot: {
    id: 'moonshot',
    matchBaseUrl: ['moonshot.cn', 'kimi'],
    matchModel: ['moonshot', 'kimi'],
    usageFields: [],
    contextWindows: {
      'moonshot-v1-128k': 131072,
      'moonshot-v1-32k': 32768,
      'moonshot-v1-8k': 8192,
      'kimi-latest': 200000,
      'kimi': 200000,
    },
  },
  jdcloud: {
    id: 'jdcloud',
    matchBaseUrl: ['jdcloud'],
    usageFields: [],
    contextWindows: {},
  },
  ollama: {
    id: 'ollama',
    matchBaseUrl: ['localhost:11434', '127.0.0.1:11434', 'ollama'],
    usageFields: [],
    contextWindows: {},
  },
  opencode: {
    id: 'opencode',
    matchBaseUrl: ['opencode.ai', 'opencode'],
    matchModel: ['opencode', 'mimo'],
    usageFields: [OPENAI_CACHED_TOKENS_FIELD, 'prompt_cache_hit_tokens'],
    contextWindows: {
      'mimo-v2.5': 262144,
      'mimo-v2': 262144,
      'mimo': 262144,
      'claude-3-7-sonnet': 200000,
      'claude-3-5-sonnet': 200000,
      'deepseek-r1': 64000,
      'deepseek-chat': 64000,
      'gpt-4o': 128000,
    },
  },
};

/**
 * 未命中任何供应商时的默认 Profile（OpenAI 官方行为）
 */
export const DEFAULT_PROVIDER_PROFILE: ProviderProfile = PROVIDER_PROFILES['openai'];

// ============================================================
// 供应商归属解析
// ============================================================

/**
 * 合并缓存字段候选列表
 *
 * settings.json 的 usageFields（provider 条目局部覆盖）优先，
 * 其次 profile 内置候选，最后追加 OpenAI 官方字段作为通用兜底
 * （保证供应商未声明专用字段时仍能读到 openai-compatible 协议
 * 的标准字段，维持原实现行为）。
 */
function mergeUsageFields(profileFields: string[], override: unknown): string[] {
  const candidates =
    Array.isArray(override) && override.every((f) => typeof f === 'string')
      ? (override as string[])
      : profileFields;
  const merged = [...candidates];
  if (!merged.includes(OPENAI_CACHED_TOKENS_FIELD)) {
    merged.push(OPENAI_CACHED_TOKENS_FIELD);
  }
  return merged;
}

/**
 * 判定 baseUrl / model 命中的供应商 Profile
 *
 * 优先级：
 * 1. baseUrl 匹配（matchBaseUrl）
 * 2. model 名匹配（matchModel，baseUrl 未命中时）
 * 3. 兜底 DEFAULT_PROVIDER_PROFILE（OpenAI 官方行为）
 *
 * @param params.baseUrl - provider 配置的 baseUrl（可选）
 * @param params.model - provider 配置的模型名（可选）
 * @param params.usageFields - settings.json 中 provider 条目的 usageFields 局部覆盖（可选）
 * @returns 命中的 ProviderProfile（usageFields 已合并）
 */
export function resolveProviderProfile(params: {
  baseUrl?: string;
  model?: string;
  usageFields?: unknown;
}): ProviderProfile {
  const baseUrl = params.baseUrl?.toLowerCase() ?? '';
  const model = params.model?.toLowerCase() ?? '';

  let profile: ProviderProfile | undefined;

  // 1. baseUrl 判定（供应商主机名是归属的最可靠信号）
  for (const candidate of Object.values(PROVIDER_PROFILES)) {
    if (candidate.matchBaseUrl?.some((pattern) => baseUrl.includes(pattern))) {
      profile = candidate;
      break;
    }
  }

  // 2. baseUrl 未命中时用 model 名判定
  if (!profile) {
    for (const candidate of Object.values(PROVIDER_PROFILES)) {
      if (candidate.matchModel?.some((pattern) => model.includes(pattern))) {
        profile = candidate;
        break;
      }
    }
  }

  // 3. 兜底默认
  const base = profile ?? DEFAULT_PROVIDER_PROFILE;
  return { ...base, usageFields: mergeUsageFields(base.usageFields, params.usageFields) };
}

// ============================================================
// Model Context Window 解析
// ============================================================

/** 默认 context window（token 数） */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * 构建合并的模型 context window 查表
 *
 * 把所有 profile 的 contextWindows 合并为一张扁平表，
 * 供 resolveModelContextWindow 做精确 + 模糊匹配。
 */
function buildModelContextWindowMap(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const profile of Object.values(PROVIDER_PROFILES)) {
    if (profile.contextWindows) {
      Object.assign(map, profile.contextWindows);
    }
  }
  return map;
}

/** 合并后的模型 context window 查表 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = buildModelContextWindowMap();

/**
 * 解析模型的内置 context window（不含用户配置覆盖）
 *
 * 优先级：
 * 1. 精确匹配（大小写不敏感）
 * 2. 模糊匹配（前缀 / 包含，如 "gpt-4o-2024-08-06" 匹配 "gpt-4o"）
 * 3. 默认值（128000）
 *
 * @param modelName - 模型名称
 * @returns context window 大小（token 数）
 */
export function resolveModelContextWindow(modelName: string): number {
  const normalized = modelName.toLowerCase();

  // 精确匹配
  const exact = MODEL_CONTEXT_WINDOWS[normalized];
  if (exact !== undefined) {
    return exact;
  }

  // 模糊匹配（如 "gpt-4o-2024-08-06" 匹配 "gpt-4o"）
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (normalized.startsWith(key) || normalized.includes(key)) {
      return value;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}
