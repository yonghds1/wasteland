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
 * ## 为什么需要转换？
 *
 * - ToolRegistry 使用内部 AgentTool 格式
 * - OpenAI API 使用特定的 tools JSON Schema 格式
 * - 需要在两者之间转换
 */

import type { ToolCall } from "../../tools/tool-types.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import type { JsonSchema, OpenAIFunctionTool, OpenAIToolCall } from "./types.js";

// ============================================================
// 工具定义转换
// ============================================================

/**
 * 构建 OpenAI tools 数组
 *
 * 将 ToolRegistry 中的工具转换为 OpenAI API 格式。
 *
 * ## 转换规则
 *
 * - name: 工具名称
 * - description: 工具描述（从 riskLevel 推断）
 * - parameters: 工具参数的 JSON Schema
 *
 * ## 参数 Schema 生成
 *
 * 根据工具名称和 riskLevel 生成参数 Schema：
 * - read-file: { path: string }
 * - edit-file: { path, old_string, new_string, replace_all? }
 * - write-file: { path, content }
 * - bash: { command: string }
 *
 * @param registry - 工具注册表
 * @returns OpenAI tools 数组
 *
 * @example
 * const tools = buildOpenAITools(registry);
 * // [{ type: 'function', function: { name: 'read-file', ... } }, ...]
 */
export function buildOpenAITools(registry: ToolRegistry): OpenAIFunctionTool[] {
  const tools: OpenAIFunctionTool[] = [];

  for (const toolName of registry.list()) {
    const tool = registry.get(toolName);
    if (!tool) continue;

    tools.push({
      type: "function",
      function: {
        name: tool.name,
        description: getToolDescription(tool.name, tool.riskLevel),
        parameters: getToolParameters(tool.name),
      },
    });
  }

  return tools;
}

/**
 * 获取工具描述
 *
 * 根据工具名称和风险等级生成描述文本。
 */
function getToolDescription(name: string, riskLevel: string): string {
  const descriptions: Record<string, string> = {
    "read-file": "读取文件内容。参数：path（文件路径）。",
    "edit-file":
      "精确编辑文件。参数：path（文件路径）、old_string（要替换的字符串）、new_string（替换后的字符串）、replace_all（可选，是否替换所有匹配）。",
    "write-file": "创建或覆写文件。参数：path（文件路径）、content（文件内容）。",
    bash: "执行 shell 命令。参数：command（命令字符串）。",
    "spawn_agent":
      "创建并运行子 Agent。参数：name（子 Agent 标识）、task（任务描述）、model（可选，模型选择）、tools（可选，限定工具集）。用于并行执行或委派子任务。",
  };

  return descriptions[name] ?? `${name} 工具（风险等级：${riskLevel}）。`;
}

/**
 * 获取工具参数 Schema
 *
 * 根据工具名称生成 JSON Schema。
 */
function getToolParameters(name: string): JsonSchema {
  const schemas: Record<string, JsonSchema> = {
    "read-file": {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要读取的文件路径（相对于工作目录）",
        },
        offset: {
          type: "integer",
          description: "起始行号（从 1 开始，可选）",
        },
        limit: {
          type: "integer",
          description: "读取的行数（可选）",
        },
      },
      required: ["path"],
    },
    "edit-file": {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要编辑的文件路径（相对于工作目录）",
        },
        old_string: {
          type: "string",
          description: "要替换的原始字符串（必须精确匹配）",
        },
        new_string: {
          type: "string",
          description: "替换后的新字符串",
        },
        replace_all: {
          type: "boolean",
          description: "是否替换所有匹配项（默认 false）",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    "write-file": {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要写入的文件路径（相对于工作目录）",
        },
        content: {
          type: "string",
          description: "文件的完整内容",
        },
      },
      required: ["path", "content"],
    },
    bash: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要执行的 shell 命令",
        },
      },
      required: ["command"],
    },
    "spawn_agent": {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "子 Agent 的唯一标识符",
        },
        task: {
          type: "string",
          description: "子 Agent 要执行的任务描述",
        },
        model: {
          type: "string",
          description: "可选，模型选择（haiku/sonnet/opus 等）",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "可选，限定子 Agent 可用的工具集",
        },
      },
      required: ["name", "task"],
    },
  };

  return (
    schemas[name] ?? {
      type: "object",
      properties: {},
    }
  );
}

// ============================================================
// 工具调用解析
// ============================================================

/**
 * 解析 OpenAI tool_calls
 *
 * 将 OpenAI API 返回的 tool_calls 转换为内部 ToolCall 格式。
 *
 * ## 关键步骤
 *
 * 1. 遍历每个 tool_call
 * 2. 解析 arguments JSON 字符串
 * 3. 构建 ToolCall 对象
 *
 * ## 错误处理
 *
 * 如果 arguments 不是有效 JSON，返回错误信息作为 input.error，
 * 让调用方决定如何处理（通常返回给模型重试）。
 *
 * @param toolCalls - OpenAI API 返回的 tool_calls
 * @returns ToolCall 数组（可能包含解析错误）
 *
 * @example
 * const calls = parseToolCalls(response.choices[0].message.tool_calls);
 * // [{ id: 'call_abc', toolName: 'edit-file', input: { path: '...', ... } }, ...]
 */
export function parseToolCalls(toolCalls: OpenAIToolCall[]): ToolCall[] {
  return toolCalls.map((tc) => {
    // 尝试解析 arguments JSON
    let input: Record<string, unknown>;

    try {
      input = JSON.parse(tc.function.arguments);
    } catch {
      // JSON 解析失败，返回错误信息
      input = {
        _parseError: true,
        _rawArguments: tc.function.arguments,
        _errorMessage: `无法解析工具参数：无效的 JSON 格式。原始参数：${tc.function.arguments}`,
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
  return typeof msg === "string" ? msg : "未知解析错误。";
}
