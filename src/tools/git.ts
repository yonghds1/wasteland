/**
 * git.ts - Git 操作工具
 *
 * 执行 Git 版本控制操作，支持常用子命令。
 *
 * ## 功能特性
 * - 支持只读操作：status, diff, log
 * - 支持写操作：add, commit, branch, checkout, push, pull
 * - 安全限制：禁止 force push，限制在项目目录内操作
 * - 结构化输出（JSON 格式）
 *
 * ## 风险等级
 * execute - 涉及版本控制写操作，可能需要用户确认
 *
 * ## 参数
 * - subcommand: Git 子命令（必需）
 * - args: 子命令的参数数组（可选）
 * - message: commit 信息（仅 commit 时必需）
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '../locales/index.js';
import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

const execFileAsync = promisify(execFile);

// ============================================================
// 配置常量
// ============================================================

/** 执行超时时间（毫秒） */
const DEFAULT_TIMEOUT = 30000;

/** 最大输出长度 */
const MAX_OUTPUT_LENGTH = 50000;

/** 禁止的子命令（出于安全考虑） */
const BLOCKED_SUBCOMMANDS = new Set(['push --force', 'push -f', 'rebase', 'reset --hard']);

// ============================================================
// 类型定义
// ============================================================

// ============================================================
// Zod Schema
// ============================================================

export const gitInputSchema = z.object({
  subcommand: z.enum(['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout', 'push', 'pull'])
    .describe('Git 子命令'),
  args: z.array(z.string()).optional().describe('子命令的参数数组'),
  message: z.string().optional().describe('commit 信息（仅 commit 时需要）'),
});

export type GitInput = z.infer<typeof gitInputSchema>;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 验证子命令是否允许执行
 *
 * @param subcommand - Git 子命令
 * @param args - 命令参数
 * @returns 验证结果
 */
function validateSubcommand(
  subcommand: string,
  args: string[]
): { allowed: true } | { allowed: false; error: string } {
  // 检查是否在禁止列表中
  const fullCommand = [subcommand, ...args].join(' ');
  for (const blocked of BLOCKED_SUBCOMMANDS) {
    if (fullCommand.includes(blocked)) {
      return {
        allowed: false,
        error: t('tools.git.blockedSubcommand', { command: blocked }),
      };
    }
  }

  // 检查禁止 force push
  if (subcommand === 'push' && (args.includes('--force') || args.includes('-f'))) {
    return {
      allowed: false,
      error: t('tools.git.forcePushDenied'),
    };
  }

  // 检查是否支持的子命令
  const supportedSubcommands = [
    'status', 'diff', 'log', 'add', 'commit',
    'branch', 'checkout', 'push', 'pull',
  ];
  if (!supportedSubcommands.includes(subcommand)) {
    return {
      allowed: false,
      error: t('tools.git.unsupportedSubcommand', { subcommand }),
    };
  }

  return { allowed: true };
}

/**
 * 执行 Git 命令
 *
 * @param cwd - 工作目录
 * @param subcommand - 子命令
 * @param args - 参数数组
 * @returns 执行结果
 */
async function executeGit(
  cwd: string,
  subcommand: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const gitArgs = [subcommand, ...args];

  const { stdout, stderr } = await execFileAsync('git', gitArgs, {
    cwd,
    timeout: DEFAULT_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });

  return { stdout, stderr };
}

/**
 * 截断过长的输出
 *
 * @param output - 原始输出
 * @returns 截断后的输出
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  return output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... [output truncated]';
}

/**
 * 格式化 Git 操作输出
 *
 * @param subcommand - 子命令
 * @param args - 参数
 * @param stdout - 标准输出
 * @param stderr - 标准错误
 * @returns 格式化后的输出
 */
function formatOutput(
  subcommand: string,
  args: string[],
  stdout: string,
  stderr: string
): string {
  const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
  const header = `🔖 git ${subcommand}${argsStr}\n${'─'.repeat(48)}`;

  const parts: string[] = [header];

  if (stdout.trim()) {
    parts.push(truncateOutput(stdout.trim()));
  }

  if (stderr.trim()) {
    parts.push(`⚠️ stderr:\n${truncateOutput(stderr.trim())}`);
  }

  return parts.join('\n\n');
}

/**
 * 格式化 Git 错误输出
 *
 * @param subcommand - 子命令
 * @param args - 参数
 * @param error - 错误信息
 * @returns 格式化后的错误输出
 */
function formatError(subcommand: string, args: string[], error: string): string {
  const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
  return `❌ git ${subcommand}${argsStr} failed:\n${error}`;
}

// ============================================================
// 工具实现
// ============================================================

/**
 * 创建 git 工具
 *
 * ## 功能
 *
 * 执行 Git 版本控制操作，支持常用子命令。
 *
 * ## 参数
 *
 * - `subcommand`: Git 子命令（必需）- status, diff, log, add, commit, branch, checkout, push, pull
 * - `args`: 子命令的参数数组（可选）
 * - `message`: commit 信息（仅 commit 时必需）
 *
 * ## 输出格式
 *
 * ```
 * 🔖 git status
 * ────────────────────────────────────────────────────────
 * On branch main
 * Your branch is up to date with 'origin/main'.
 *
 * nothing to commit, working tree clean
 * ```
 *
 * ## 安全限制
 *
 * - 禁止 force push
 * - 禁止 rebase
 * - 禁止 reset --hard
 * - 仅允许在项目目录内操作
 *
 * @example
 * // 查看工作区状态
 * git({ subcommand: "status" })
 *
 * // 查看变更差异
 * git({ subcommand: "diff" })
 *
 * // 创建提交
 * git({ subcommand: "commit", message: "feat: add new feature" })
 *
 * // 添加文件到暂存区
 * git({ subcommand: "add", args: ["src/file.ts"] })
 *
 * // 推送变更
 * git({ subcommand: "push" })
 */
export function createGitTool(): AgentTool {
  return {
    name: 'git',
    riskLevel: 'execute',
    description: '执行 Git 版本控制操作',
    inputSchema: zodToJsonSchema(gitInputSchema) as JsonSchema,

    async execute(input, context): Promise<ToolExecutionResult> {
      const parsed = gitInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      const { subcommand, args = [], message } = parsed.data;

      // 验证子命令是否允许
      const validation = validateSubcommand(subcommand, args);
      if (!validation.allowed) {
        return {
          status: 'error',
          error: validation.error,
        };
      }

      // 处理 commit 子命令的特殊参数
      let finalArgs = [...args];
      if (subcommand === 'commit') {
        if (!message || message.trim().length === 0) {
          return {
            status: 'error',
            error: t('tools.git.needCommitMessage'),
          };
        }
        finalArgs = ['-m', message.trim(), ...args];
      }

      try {
        // 执行 Git 命令
        const { stdout, stderr } = await executeGit(context.cwd, subcommand, finalArgs);

        // 格式化输出
        const output = formatOutput(subcommand, finalArgs, stdout, stderr);

        return {
          status: 'success',
          output,
          data: {
            subcommand,
            args: finalArgs,
            output: stdout,
          },
        };
      } catch (error) {
        // 区分用户错误和系统错误
        if (error instanceof Error) {
          const errorMessage = error.message;

          // 用户错误：Git 命令执行失败（如文件不存在、分支不存在等）
          if (errorMessage.includes('fatal:') || errorMessage.includes('error:')) {
            return {
              status: 'error',
              error: formatError(subcommand, finalArgs, errorMessage),
            };
          }

          // 系统错误：超时、权限等
          if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
            return {
              status: 'error',
              error: t('tools.git.timeout'),
            };
          }

          return {
            status: 'error',
            error: formatError(subcommand, finalArgs, errorMessage),
          };
        }

        return {
          status: 'error',
          error: formatError(subcommand, finalArgs, String(error)),
        };
      }
    },
  };
}
