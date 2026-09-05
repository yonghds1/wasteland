/**
 * report-result.ts - 子 agent 结果报告工具
 *
 * 子 agent 完成任务后使用此工具返回结构化结果。
 * 主 agent 收到结果后可直接解析，无需解析自由文本。
 */
import type { AgentTool, ToolInput, ToolExecutionContext, ToolExecutionResult } from './tool-types.js';

export const REPORT_RESULT_TOOL_NAME = 'report_result';

export interface ReportResultInput {
  status: 'success' | 'partial' | 'failed';
  summary: string;
  details?: Record<string, unknown>;
  evidence?: Array<{ file: string; line?: number; content?: string }>;
  suggestions?: string[];
}

export const reportResultTool: AgentTool = {
  name: REPORT_RESULT_TOOL_NAME,
  riskLevel: 'read',
  description: '报告任务执行结果。完成任务后必须调用此工具。',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['success', 'partial', 'failed'],
        description: '任务执行状态',
      },
      summary: {
        type: 'string',
        description: '任务结果摘要（1-2 句话）',
      },
      details: {
        type: 'object',
        description: '详细结果数据（可选）',
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '文件路径' },
            line: { type: 'number', description: '行号' },
            content: { type: 'string', description: '相关内容' },
          },
        },
        description: '证据列表（可选）',
      },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: '后续建议（可选）',
      },
    },
    required: ['status', 'summary'],
  },
  execute: async (input: ToolInput, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const result = input as unknown as ReportResultInput;
    return {
      status: 'success',
      output: JSON.stringify(result, null, 2),
    };
  },
};
