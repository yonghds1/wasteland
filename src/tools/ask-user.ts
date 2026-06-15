/**
 * ask-user.ts - 向用户提问工具
 *
 * 允许 Agent 在需要澄清时向用户提问。
 */

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '../locales/index.js';
import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const askUserInputSchema = z.object({
  question: z.string().min(1).describe('要问用户的问题'),
  options: z.array(z.string()).optional().describe('可选答案列表'),
  default: z.string().optional().describe('默认答案'),
});

export type AskUserInput = z.infer<typeof askUserInputSchema>;

export function createAskUserTool(): AgentTool {
  return {
    name: 'ask-user',
    riskLevel: 'read',
    description: '向用户提问并等待回答',
    inputSchema: zodToJsonSchema(askUserInputSchema) as JsonSchema,

    async execute(input): Promise<ToolExecutionResult> {
      const parsed = askUserInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      // 在 CLI 模式下，这个问题会被上层拦截处理
      // 这里返回一个标记，让调用方知道需要用户交互
      return {
        status: 'success',
        output: parsed.data.options
          ? `${parsed.data.question}\n${t('tools.askUser.options')} ${parsed.data.options.join(', ')}`
          : parsed.data.question,
        data: { pendingUserInput: true },
      };
    },
  };
}
