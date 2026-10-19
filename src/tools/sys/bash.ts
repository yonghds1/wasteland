import { execFile, spawn } from 'node:child_process';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool, JsonSchema } from '../core/tool-types.js';

export const bashInputSchema = z.object({
  command: z.string().min(1).describe('要执行的 shell 命令'),
  timeout: z.number().positive().optional().describe('超时时间（毫秒，默认 120000）'),
});

export type BashInput = z.infer<typeof bashInputSchema>;

function getShellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    if (process.env.SHELL && (process.env.SHELL.toLowerCase().endsWith('bash.exe') || process.env.SHELL.toLowerCase().endsWith('bash'))) {
      return { file: process.env.SHELL, args: ['-lc', command] };
    }
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  return { file: process.env.SHELL || 'bash', args: ['-lc', command] };
}

/**
 * 跨平台进程树查杀：
 * - POSIX 系统使用负 PID 组发送信号（SIGTERM / SIGKILL）实现进程组级清理；
 * - Windows 系统通过 taskkill /T /F 强杀子进程树，避免 ESRCH 或负 PID 不支持导致的崩溃。
 */
export async function killProcessTree(pid: number, gracePeriodMs = 1500): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
        // 忽略 taskkill 错误（如进程已退出）
        resolve();
      });
    });
    return;
  }

  // POSIX 系统实现：先投递 SIGTERM，超时后若存活则 SIGKILL
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }

  if (gracePeriodMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, gracePeriodMs));
  }

  try {
    process.kill(pid, 0);
    process.kill(-pid, 'SIGKILL');
  } catch {
    // 进程已退出
  }
}

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export function createBashTool(): AgentTool {
  return {
    name: 'bash',
    riskLevel: 'execute',
    description: '执行 shell 命令',
    inputSchema: zodToJsonSchema(bashInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = bashInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map((i) => i.message).join(', ') };
      }

      const { file, args } = getShellCommand(parsed.data.command);
      const timeoutMs = parsed.data.timeout ?? DEFAULT_TIMEOUT_MS;
      const isPosix = process.platform !== 'win32';

      return new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(file, args, {
            cwd: context.cwd,
            detached: isPosix,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (err) {
          resolve({ status: 'error', error: err instanceof Error ? err.message : String(err) });
          return;
        }

        let timedOut = false;
        let bufferExceeded = false;
        let totalBytes = 0;
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const timer = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            void killProcessTree(child.pid);
          }
        }, timeoutMs);

        child.stdout?.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BUFFER) {
            bufferExceeded = true;
            if (child.pid) void killProcessTree(child.pid, 0);
            return;
          }
          stdoutChunks.push(chunk);
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BUFFER) {
            bufferExceeded = true;
            if (child.pid) void killProcessTree(child.pid, 0);
            return;
          }
          stderrChunks.push(chunk);
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ status: 'error', error: err.message });
        });

        child.on('close', (code, signal) => {
          clearTimeout(timer);

          if (timedOut) {
            resolve({
              status: 'error',
              error: `命令执行超时熔断（${Math.round(timeoutMs / 1000)}s 已终止并清理进程组）。`,
            });
            return;
          }

          if (bufferExceeded) {
            resolve({ status: 'error', error: '命令输出过大（超过 10MB）。' });
            return;
          }

          const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
          const stderr = Buffer.concat(stderrChunks).toString('utf-8');
          const output = [stdout, stderr].filter((v) => v.length > 0).join('');

          if (code === 0) {
            resolve({ status: 'success', output: output.trimEnd() });
          } else {
            resolve({
              status: 'error',
              error: output.trimEnd() || `命令执行失败（退出码: ${code ?? signal}）`,
            });
          }
        });
      });
    },
  };
}
