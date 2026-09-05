import { resolveModelContextWindow } from './profiles.js';

export interface FetchModelsOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface FetchedModelInfo {
  id: string;
  contextWindow: number;
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  modelInfos?: FetchedModelInfo[];
  error?: string;
}

/**
 * 规范化 models 请求 URL
 */
export function buildModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) {
    return trimmed;
  }
  return `${trimmed}/models`;
}

function extractContextLength(item: Record<string, unknown>, id: string): number {
  const rawLength =
    item.context_length ??
    item.context_window ??
    item.max_context_length ??
    item.max_tokens ??
    (typeof item.top_provider === 'object' && item.top_provider !== null
      ? (item.top_provider as Record<string, unknown>).context_length
      : undefined);

  if (typeof rawLength === 'number' && Number.isInteger(rawLength) && rawLength > 0) {
    return rawLength;
  }
  if (typeof rawLength === 'string') {
    const parsed = parseInt(rawLength, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 服务端未提供时，根据 modelId 从 Profile 智能推断
  return resolveModelContextWindow(id);
}

/**
 * 从返回的 JSON 解析模型详细信息（包含 contextWindow）
 */
export function extractModelInfosFromJson(data: unknown): FetchedModelInfo[] {
  if (!data || typeof data !== 'object') return [];

  const results: FetchedModelInfo[] = [];
  const addedIds = new Set<string>();

  const addModel = (id: string, itemObj?: Record<string, unknown>) => {
    const trimmedId = id.trim();
    if (!trimmedId || addedIds.has(trimmedId)) return;
    addedIds.add(trimmedId);

    const contextWindow = itemObj ? extractContextLength(itemObj, trimmedId) : resolveModelContextWindow(trimmedId);
    results.push({ id: trimmedId, contextWindow });
  };

  // 标准 OpenAI: { data: [...] }
  if ('data' in data && Array.isArray((data as { data: unknown[] }).data)) {
    for (const item of (data as { data: unknown[] }).data) {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
        addModel((item as { id: string }).id, item as Record<string, unknown>);
      } else if (typeof item === 'string') {
        addModel(item);
      }
    }
  }

  // Ollama 风格: { models: [...] }
  if ('models' in data && Array.isArray((data as { models: unknown[] }).models)) {
    for (const item of (data as { models: unknown[] }).models) {
      if (item && typeof item === 'object') {
        const id =
          typeof (item as { id?: unknown }).id === 'string'
            ? (item as { id: string }).id
            : typeof (item as { name?: unknown }).name === 'string'
              ? (item as { name: string }).name
              : '';
        if (id) addModel(id, item as Record<string, unknown>);
      } else if (typeof item === 'string') {
        addModel(item);
      }
    }
  }

  // 顶层数组: [...]
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
        addModel((item as { id: string }).id, item as Record<string, unknown>);
      } else if (typeof item === 'string') {
        addModel(item);
      }
    }
  }

  return results;
}

/**
 * 从返回的 JSON 解析模型 ID
 * 支持:
 * 1. OpenAI 格式: { object: "list", data: [{ id: "gpt-4o" }] }
 * 2. Ollama / 简易格式: { models: [{ name: "llama3" }] } 或 { models: ["llama3"] }
 * 3. 数组格式: [{ id: "..." }]
 */
export function extractModelIdsFromJson(data: unknown): string[] {
  return extractModelInfosFromJson(data).map((m) => m.id);
}

/**
 * 从 OpenAI 兼容服务端获取可用模型列表
 *
 * @param options 请求配置 (baseUrl, apiKey, timeoutMs)
 * @returns 模型 ID 列表与详细元数据
 */
export async function fetchRemoteModels(options: FetchModelsOptions): Promise<FetchModelsResult> {
  const { baseUrl, apiKey, timeoutMs = 4000 } = options;
  if (!baseUrl || !baseUrl.trim()) {
    return { success: false, models: [], error: 'Base URL is empty' };
  }

  const url = buildModelsUrl(baseUrl);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'wasteland-cli/0.1.0',
  };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const json = (await response.json()) as unknown;
    const modelInfos = extractModelInfosFromJson(json);
    const modelIds = modelInfos.map((m) => m.id);

    return {
      success: modelIds.length > 0,
      models: modelIds,
      modelInfos,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      models: [],
      error: msg,
    };
  }
}
