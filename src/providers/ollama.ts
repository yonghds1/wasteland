/**
 * ollama.ts - Ollama 本地模型 Provider
 *
 * 本文件实现了 Ollama 本地模型的 Provider。
 * Ollama 兼容 OpenAI API，可以复用 openai-compatible 模块。
 *
 * ## 使用方式
 *
 * 1. 安装 Ollama: https://ollama.com
 * 2. 下载模型: ollama pull qwen2.5:7b
 * 3. 启动服务: ollama serve (默认 http://localhost:11434)
 * 4. 配置 .rxc/settings.json:
 *    {
 *      "providers": {
 *        "ollama": {
 *          "baseUrl": "http://localhost:11434",
 *          "model": "qwen2.5:7b"
 *        }
 *      }
 *    }
 *
 * ## 与 qwen provider 的区别
 *
 * - qwen: 使用阿里云 DashScope API，需要 API Key
 * - ollama: 本地运行，不需要 API Key
 */

import { defer, concatMap, from, type Observable } from "rxjs";

import type { ProviderSettings } from "../config/settings-types.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider, ProviderStreamEvent } from "./provider-types.js";
import type { ProviderStepInput } from "./provider-types.js";
import {
  buildOpenAITools,
  buildMessages,
  parseToolCalls,
  type OpenAIChatCompletionResponse,
  type OpenAIFunctionTool,
  type OpenAIMessage,
} from "./openai-compatible/index.js";

// ============================================================
// 类型定义
// ============================================================

/** Ollama Provider 配置 */
type OllamaProviderConfig = {
  baseUrl: string;
  model: string;
  // Ollama 不需要 API Key
};

/** Ollama API 响应 */
type OllamaChatCompletionResponse = OpenAIChatCompletionResponse & {
  choices?: Array<{
    finish_reason?: "stop" | "tool_calls" | string;
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

// ============================================================
// 常量定义
// ============================================================

/** 默认 Ollama 基础 URL */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** 默认模型 */
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";

// ============================================================
// 辅助函数
// ============================================================

/**
 * 检查值是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 规范化基础 URL
 */
function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const normalized = (rawBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, "");

  if (normalized.length === 0) {
    return DEFAULT_OLLAMA_BASE_URL;
  }

  return normalized;
}

/**
 * 解析 Ollama Provider 配置
 */
function resolveOllamaConfig(settings?: ProviderSettings): OllamaProviderConfig {
  const baseUrl = normalizeBaseUrl(
    typeof settings?.baseUrl === "string" ? settings.baseUrl : undefined,
  );

  const model = typeof settings?.model === "string" && settings.model.trim().length > 0
    ? settings.model.trim()
    : DEFAULT_OLLAMA_MODEL;

  return { baseUrl, model };
}

/**
 * 提取文本内容
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new Error("ollama 返回的 assistant content 不是字符串。");
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (isRecord(part) && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");

  if (text.length === 0) {
    throw new Error("ollama 返回的 assistant content 为空。");
  }

  return text;
}

// ============================================================
// 核心 API 调用
// ============================================================

/**
 * 请求 Ollama Chat Completion API
 *
 * 注意：Ollama 不需要 Authorization header
 */
async function requestOllamaCompletion(
  config: OllamaProviderConfig,
  messages: readonly OpenAIMessage[],
  tools?: readonly OpenAIFunctionTool[],
): Promise<OllamaChatCompletionResponse> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // Ollama API 路径: /v1/chat/completions
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Ollama 不需要 Authorization header
    },
    body: JSON.stringify(body),
  });

  let payload: OllamaChatCompletionResponse | null = null;

  try {
    payload = await response.json() as OllamaChatCompletionResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`ollama 请求失败：HTTP ${response.status}`);
    }

    throw new Error("ollama 返回了无法解析的 JSON。");
  }

  if (!response.ok) {
    const errorMessage = payload?.error?.message;

    throw new Error(
      errorMessage
        ? `ollama 请求失败：${errorMessage}`
        : `ollama 请求失败：HTTP ${response.status}`,
    );
  }

  return payload;
}

/**
 * 处理 Ollama API 响应
 */
function handleOllamaResponse(payload: OllamaChatCompletionResponse): Observable<ProviderStreamEvent> {
  const choice = payload.choices?.[0];

  if (!choice) {
    throw new Error("ollama 返回结果缺少 choices[0]。");
  }

  const finishReason = choice.finish_reason;
  const message = choice.message;

  // 工具调用响应
  if (finishReason === "tool_calls" && message?.tool_calls) {
    const toolCalls = parseToolCalls(message.tool_calls);
    return from<ProviderStreamEvent[]>(
      toolCalls.map((call) => ({ type: "tool_call" as const, call })),
    );
  }

  // 文本响应
  if (message?.content !== undefined && message.content !== null) {
    const text = extractTextContent(message.content);
    return createAssistantTextEvents(text);
  }

  throw new Error(`ollama 返回了意外的响应：finish_reason=${finishReason}`);
}

// ============================================================
// Provider 工厂函数
// ============================================================

/**
 * 创建 Ollama Provider
 */
export function createOllamaProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveOllamaConfig(settings);

  return {
    id: "ollama",

    runStep({ context, state }: ProviderStepInput) {
      return defer(async () => {
        const messages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
        });

        const tools = context.toolRegistry
          ? buildOpenAITools(context.toolRegistry)
          : undefined;

        return requestOllamaCompletion(config, messages, tools);
      }).pipe(
        concatMap((response) => handleOllamaResponse(response)),
      );
    },
  };
}
