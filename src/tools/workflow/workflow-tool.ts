/**
 * workflow-tool.ts - Workflow 提交工具
 *
 * 模型可调的动态工作流扳机：校验输入后交 scheduler 后台执行，
 * 立即返回 {taskId, runId}。opt-in 由 description 约束。
 */

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';
import type {
  AgentTool,
  JsonSchema,
  ToolExecutionContext,
  ToolInput,
} from '../core/tool-types.js';

export const workflowInputSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
    script: z.string().min(1).max(8192).optional(),
    scriptPath: z.string().min(1).max(1024).optional(),
    args: z.array(z.string().max(1024)).max(20).optional().default([]),
    resumeFromRunId: z.string().uuid().optional(),
  })
  .refine((d) => d.script === undefined || d.scriptPath === undefined, {
    message: 'script 与 scriptPath 二选一，不可同时提供',
    path: ['script'],
  })
  .refine(
    (d) => d.name !== undefined || d.script !== undefined || d.scriptPath !== undefined,
    {
      message: 'name / script / scriptPath 至少提供一个',
      path: ['name'],
    },
  );

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export interface WorkflowToolDeps {
  submit: (
    input: WorkflowInput,
    ctx: ToolExecutionContext,
  ) => Promise<{ taskId: string; runId: string }>;
}

export function createWorkflowTool(deps?: WorkflowToolDeps): AgentTool {
  return {
    name: 'workflow',
    riskLevel: 'execute',
    description:
      '提交动态工作流后台运行，立即返回 taskId/runId。仅当用户明说workflow/工作流、或点名/workflows、或当前Skill明确指示时才可调用，否则禁止擅调。',
    inputSchema: zodToJsonSchema(workflowInputSchema) as JsonSchema,
    async execute(input: ToolInput, context: ToolExecutionContext) {
      const parsed = workflowInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          status: 'error' as const,
          error: parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        };
      }
      if (deps === undefined) {
        return {
          status: 'error' as const,
          error: 'workflow runtime not wired',
        };
      }
      const { taskId, runId } = await deps.submit(parsed.data, context);
      return {
        status: 'success' as const,
        output: JSON.stringify({ taskId, runId }),
        data: { taskId, runId },
      };
    },
  };
}
