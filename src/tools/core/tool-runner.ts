import { ToolRegistry } from './tool-registry.js';
import type { ToolCall, ToolExecutionContext, ToolExecutionResult } from './tool-types.js';
import { normalizeToolInputPaths } from '../utils/path-utils.js';

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

  // 跨平台路径统一清洗：在工具执行网关入口处将所有路径字段规整为 POSIX 规范
  const cleanedInput = normalizeToolInputPaths(params.call.input);

  try {
    return await tool.execute(cleanedInput, params.context);
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
