/**
 * tool-adapter.ts - 工具定义和调用转换
 *
 * 提供 ToolRegistry 与 OpenAI API 格式之间的转换。
 *
 * ## 核心功能
 *
 * 1. buildOpenAITools: ToolRegistry → OpenAI tools 数组
 * 2. parseToolCalls: OpenAI tool_calls → ToolCall[]
 *
 * ## 设计原则
 *
 * - 工具的 Schema 定义在各工具文件中（通过 AgentTool.inputSchema）
 * - 本文件只负责转换格式，不做 Schema 定义
 */

import type { ToolCall } from '@tools/tool-types.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import { t } from '@locales/index.js';
import type { JsonSchema, OpenAIFunctionTool, OpenAIToolCall } from './types.js';

// ============================================================
// 工具定义转换
// ============================================================

/**
 * 构建 OpenAI tools 数组
 *
 * 将 ToolRegistry 中的工具转换为 OpenAI API 格式。
 * 直接从 AgentTool.inputSchema 读取参数 Schema。
 */
export function buildOpenAITools(registry: ToolRegistry): OpenAIFunctionTool[] {
  return registry.list().map((toolName) => {
    const tool = registry.get(toolName);
    if (!tool) {
      return null;
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? `${tool.name} 工具`,
        parameters: (tool.inputSchema as JsonSchema) ?? { type: 'object', properties: {} },
      },
    };
  }).filter((t) => t !== null) as OpenAIFunctionTool[];
}

// ============================================================
// 工具调用解析
// ============================================================

/**
 * 解析 OpenAI tool_calls
 *
 * 将 OpenAI API 返回的 tool_calls 转换为内部 ToolCall 格式。
 *
 * @param toolCalls - OpenAI API 返回的 tool_calls
 * @returns ToolCall 数组（可能包含解析错误）
 */
export function parseToolCalls(toolCalls: OpenAIToolCall[]): ToolCall[] {
  return toolCalls.map((tc) => {
    let input: Record<string, unknown>;

    try {
      input = JSON.parse(tc.function.arguments);
    } catch {
      input = {
        _parseError: true,
        _rawArguments: tc.function.arguments,
        _errorMessage: `${t('providers.toolAdapter.invalidJson')}${tc.function.arguments}`,
      };
    }

    return {
      id: tc.id,
      toolName: tc.function.name,
      input,
    };
  });
}

/**
 * 检查工具调用是否包含解析错误
 *
 * @param call - 工具调用
 * @returns true 表示参数解析失败
 */
export function hasParseError(call: ToolCall): boolean {
  return call.input._parseError === true;
}

/**
 * 获取解析错误消息
 *
 * @param call - 包含解析错误的工具调用
 * @returns 错误消息
 */
export function getParseErrorMessage(call: ToolCall): string {
  const msg = call.input._errorMessage;
  return typeof msg === 'string' ? msg : t('providers.toolAdapter.unknownParseError');
}
