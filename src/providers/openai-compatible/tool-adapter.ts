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
import { t } from "../../locales/index.js";
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
    "read-file": t("providers.toolAdapter.readFile"),
    "edit-file": t("providers.toolAdapter.editFile"),
    "write-file": t("providers.toolAdapter.writeFile"),
    bash: t("providers.toolAdapter.bash"),
    "spawn_agent": t("providers.toolAdapter.createSubAgent"),
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
          description: t("providers.toolAdapter.filePath"),
        },
        offset: {
          type: "integer",
          description: t("providers.toolAdapter.startLine"),
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
          description: t("providers.toolAdapter.oldString"),
        },
        new_string: {
          type: "string",
          description: t("providers.toolAdapter.newString"),
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
          description: t("providers.toolAdapter.writePath"),
        },
        content: {
          type: "string",
          description: t("providers.toolAdapter.content"),
        },
      },
      required: ["path", "content"],
    },
    bash: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: t("providers.toolAdapter.command"),
        },
      },
      required: ["command"],
    },
    "spawn_agent": {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: t("providers.toolAdapter.subAgentId"),
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
        inheritHistory: {
          type: "boolean",
          description: "可选，是否继承父 Agent 的历史上下文，默认 false",
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
        _errorMessage: `${t("providers.toolAdapter.invalidJson")}${tc.function.arguments}`,
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
  return typeof msg === "string" ? msg : t("providers.toolAdapter.unknownParseError");
}
