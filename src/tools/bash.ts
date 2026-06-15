import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '../locales/index.js';
import type { AgentTool } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

const execFileAsync = promisify(execFile);

// ============================================================
// Zod Schema
// ============================================================

export const bashInputSchema = z.object({
  command: z.string().min(1).describe('要执行的 shell 命令'),
});

export type BashInput = z.infer<typeof bashInputSchema>;

export function createBashTool(): AgentTool {
  return {
    name: 'bash',
    riskLevel: 'execute',
    description: '执行 shell 命令',
    inputSchema: zodToJsonSchema(bashInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = bashInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const { stdout, stderr } = await execFileAsync('bash', ['-lc', parsed.data.command], {
          cwd: context.cwd,
        });
        const output = [stdout, stderr].filter((value) => value.length > 0).join('');

        return {
          status: 'success',
          output: output.trimEnd(),
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
