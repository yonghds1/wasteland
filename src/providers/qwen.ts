import { defer, concatMap } from "rxjs";

import type { ProviderSettings } from "../config/settings-types.js";
import type { SessionMessageRecord } from "../runtime/event-types.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider } from "./provider-types.js";

type QwenProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type QwenChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type QwenChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const normalized = (rawBaseUrl ?? DEFAULT_QWEN_BASE_URL).trim().replace(/\/+$/, "");

  if (normalized.length === 0) {
    return DEFAULT_QWEN_BASE_URL;
  }

  if (normalized.endsWith("/v1")) {
    return normalized;
  }

  return `${normalized}/v1`;
}

function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: "baseUrl" | "apiKey" | "model",
): string | undefined {
  const value = settings?.[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveQwenConfig(settings?: ProviderSettings): QwenProviderConfig {
  const apiKey = readNonEmptyString(settings, "apiKey");
  const model = readNonEmptyString(settings, "model");

  if (!apiKey) {
    throw new Error("provider qwen 缺少 apiKey 配置。");
  }

  if (!model) {
    throw new Error("provider qwen 缺少 model 配置。");
  }

  return {
    baseUrl: normalizeBaseUrl(readNonEmptyString(settings, "baseUrl")),
    apiKey,
    model,
  };
}

function toQwenMessages(history: readonly SessionMessageRecord[], input: string): QwenChatMessage[] {
  const messages: QwenChatMessage[] = [];

  for (const message of history) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  messages.push({
    role: "user",
    content: input,
  });

  return messages;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new Error("qwen 返回的 assistant content 不是字符串。");
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
    throw new Error("qwen 返回的 assistant content 为空。");
  }

  return text;
}

async function requestQwenCompletion(
  config: QwenProviderConfig,
  messages: readonly QwenChatMessage[],
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
    }),
  });

  let payload: QwenChatCompletionResponse | null = null;

  try {
    payload = await response.json() as QwenChatCompletionResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`qwen 请求失败：HTTP ${response.status}`);
    }

    throw new Error("qwen 返回了无法解析的 JSON。");
  }

  if (!response.ok) {
    const errorMessage = payload?.error?.message;

    throw new Error(
      errorMessage
        ? `qwen 请求失败：${errorMessage}`
        : `qwen 请求失败：HTTP ${response.status}`,
    );
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (content === undefined) {
    throw new Error("qwen 返回结果缺少 choices[0].message.content。");
  }

  return extractTextContent(content);
}

export function createQwenProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveQwenConfig(settings);

  return {
    id: "qwen",
    runStep({ context }) {
      return defer(() =>
        requestQwenCompletion(
          config,
          toQwenMessages(context.history, context.input.content),
        ),
      ).pipe(
        concatMap((text) => createAssistantTextEvents(text)),
      );
    },
  };
}
