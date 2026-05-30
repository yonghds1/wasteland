import { ToolRegistry } from './tool-registry.js';
import type { ToolCall, ToolExecutionContext, ToolExecutionResult } from './tool-types.js';

export async function executeToolCall(params: {
  registry: ToolRegistry;
  call: ToolCall;
  context: ToolExecutionContext;
}): Promise<ToolExecutionResult> {
  const tool = params.registry.get(params.call.toolName);

  if (!tool) {
    return {
      status: 'error',
      error: `未找到工具：${params.call.toolName}`,
    };
  }

  try {
    return await tool.execute(params.call.input, params.context);
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
