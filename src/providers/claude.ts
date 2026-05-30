/**
 * claude.ts - Claude API Provider 实现
 *
 * 支持 Anthropic Claude API 格式：
 * - Endpoint: /v1/messages
 * - Auth: x-api-key header
 * - Version: anthropic-version: 2023-06-01
 */

import { defer, concatMap, from, type Observable } from 'rxjs';

import type { ProviderSettings } from '../config/settings-types.js';
import { t } from '../locales/index.js';
import { createAssistantTextEvents } from './assistant-events.js';
import type { AgentProvider, ProviderStreamEvent } from './provider-types.js';
import type { ProviderStepInput } from './provider-types.js';
import {
  buildOpenAITools,
  buildMessages,
  parseToolCalls,
  type OpenAIFunctionTool,
  type OpenAIMessage,
} from './openai-compatible/index.js';

/** Claude API 配置 */
type ClaudeProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Claude API 消息格式 */
type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/** Claude API 请求 */
type ClaudeRequest = {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  system?: string;
};

/** Claude API 响应 */
type ClaudeResponse = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
  >;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: 'baseUrl' | 'apiKey' | 'model'
): string | undefined {
  const value = settings?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const base = (rawBaseUrl ?? 'https://api.anthropic.com').trim().replace(/\/+$/, '');
  if (base.endsWith('/v1')) return base;
  return `${base}/v1`;
}

function resolveClaudeConfig(settings?: ProviderSettings): ClaudeProviderConfig {
  const apiKey = readNonEmptyString(settings, 'apiKey');
  const model = readNonEmptyString(settings, 'model');

  if (!apiKey) throw new Error(t('providers.claude.missingApiKey'));
  if (!model) throw new Error(t('providers.claude.missingModel'));

  return {
    baseUrl: normalizeBaseUrl(readNonEmptyString(settings, 'baseUrl')),
    apiKey,
    model,
  };
}

/**
 * 将 OpenAI 格式消息转换为 Claude 格式
 *
 * Claude API 不支持 "tool" 角色，需要将工具结果转换为 user 消息
 */
function convertToClaudeMessages(openaiMessages: OpenAIMessage[]): {
  system?: string;
  messages: ClaudeMessage[];
} {
  let system: string | undefined;
  const messages: ClaudeMessage[] = [];
  let pendingToolResults: Array<{ toolCallId: string; content: string }> = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      // Claude 使用单独的 system 参数
      system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    } else if (msg.role === 'tool') {
      // 收集工具结果，稍后转换为 user 消息
      pendingToolResults.push({
        toolCallId: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else {
      // 如果有待处理的工具结果，先添加为 user 消息
      if (pendingToolResults.length > 0) {
        const toolResultContent = pendingToolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolCallId,
          content: tr.content,
        }));
        messages.push({
          role: 'user',
          content: JSON.stringify(toolResultContent),
        });
        pendingToolResults = [];
      }

      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  // 处理最后一批工具结果
  if (pendingToolResults.length > 0) {
    const toolResultContent = pendingToolResults.map((tr) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.toolCallId,
      content: tr.content,
    }));
    messages.push({
      role: 'user',
      content: JSON.stringify(toolResultContent),
    });
  }

  return { system, messages };
}

/**
 * 将 OpenAI 工具格式转换为 Claude 格式
 */
function convertToClaudeTools(tools: OpenAIFunctionTool[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? '',
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
  }));
}

/**
 * 请求 Claude Chat Completion API
 */
async function requestClaudeCompletion(
  config: ClaudeProviderConfig,
  messages: ClaudeMessage[],
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>,
  system?: string
): Promise<ClaudeResponse> {
  const requestBody: ClaudeRequest = {
    model: config.model,
    messages,
    max_tokens: 4096,
  };

  if (system) {
    requestBody.system = system;
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${t('providers.claude.requestFailed')} (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<ClaudeResponse>;
}

/**
 * 处理 Claude API 响应
 */
function handleClaudeResponse(response: ClaudeResponse): Observable<ProviderStreamEvent> {
  // 提取文本
  const text = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // 提取工具调用
  const toolUseBlocks = response.content.filter(
    (
      block
    ): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      block.type === 'tool_use'
  );

  // 工具调用响应
  if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
    const toolCalls = toolUseBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input),
    }));

    // 使用 parseToolCalls 转换为标准格式
    const parsedCalls = parseToolCalls(
      toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }))
    );

    return from<ProviderStreamEvent[]>(
      parsedCalls.map((call) => ({ type: 'tool_call' as const, call }))
    );
  }

  // 文本响应
  if (text) {
    return createAssistantTextEvents(text);
  }

  throw new Error(t('providers.claude.unexpectedResponse'));
}

export function createClaudeProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveClaudeConfig(settings);

  return {
    id: 'claude',

    runStep({ context, state }: ProviderStepInput) {
      return defer(async () => {
        // 构建消息（使用 openai-compatible 模块）
        const openaiMessages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
          prompt: context.prompt,
        });

        // 转换为 Claude 格式
        const { system, messages } = convertToClaudeMessages(openaiMessages);

        // 构建工具定义（如果有工具注册表）
        const openaiTools = context.toolRegistry
          ? buildOpenAITools(context.toolRegistry)
          : undefined;

        const tools = openaiTools ? convertToClaudeTools(openaiTools) : undefined;

        // 发送请求
        return requestClaudeCompletion(config, messages, tools, system);
      }).pipe(concatMap((response) => handleClaudeResponse(response)));
    },
  };
}
