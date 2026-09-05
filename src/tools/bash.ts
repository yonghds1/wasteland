import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

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

function getShellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    if (process.env.SHELL && (process.env.SHELL.toLowerCase().endsWith('bash.exe') || process.env.SHELL.toLowerCase().endsWith('bash'))) {
      return { file: process.env.SHELL, args: ['-lc', command] };
    }
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  const shell = process.env.SHELL || 'bash';
  return { file: shell, args: ['-lc', command] };
}

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

      const { file, args } = getShellCommand(parsed.data.command);

      try {
        const { stdout, stderr } = await execFileAsync(file, args, {
          cwd: context.cwd,
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const output = [stdout, stderr].filter((value) => value.length > 0).join('');

        return {
          status: 'success',
          output: output.trimEnd(),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
          return { status: 'error', error: '命令执行超时（120s 已终止）。' };
        }
        if (msg.includes('maxBuffer')) {
          return { status: 'error', error: '命令输出过大（超过 10MB）。' };
        }
        return {
          status: 'error',
          error: msg,
        };
      }
    },
  };
}
