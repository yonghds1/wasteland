/**
 * code-assistant-adapter.ts - 通用代码助手适配器
 *
 * 定义代码助手的通用接口，支持 Claude Code、Codex 等工具。
 *
 * ## 设计模式
 *
 * 使用策略模式，将不同代码助手的差异封装在适配器中。
 * 主 Agent 只需要关心任务和结果，不需要关心具体的代码助手实现。
 *
 * ## 支持的代码助手
 *
 * - Claude Code (Anthropic)
 * - Codex (OpenAI)
 * - Cursor
 * - GitHub Copilot CLI
 * - 未来的其他工具
 */

import { Observable } from 'rxjs';
import type { AgentTool, ToolExecutionResult, ToolInput, ToolExecutionContext } from './tool-types.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 代码助手配置
 */
export type CodeAssistantConfig = {
  /** 助手名称 */
  name: string;
  /** 命令路径 */
  command: string;
  /** 命令参数模板 */
  argsTemplate: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
};

/**
 * 代码助手任务
 */
export type CodeAssistantTask = {
  /** 任务 ID */
  id: string;
  /** 任务内容 */
  prompt: string;
  /** 工作目录 */
  cwd?: string;
  /** 文件上下文 */
  files?: string[];
  /** 额外参数 */
  extraArgs?: string[];
};

/**
 * 代码助手事件
 */
export type CodeAssistantEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; status: 'success' | 'error'; output: string }
  | { type: 'result'; content: string; costUsd?: number; durationMs?: number }
  | { type: 'error'; error: string };

/**
 * 代码助手结果
 */
export type CodeAssistantResult = {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息 */
  error?: string;
  /** 成本（美元） */
  costUsd?: number;
  /** 耗时（毫秒） */
  durationMs?: number;
};

// ============================================================
// 通用适配器接口
// ============================================================

/**
 * 代码助手适配器接口
 *
 * 所有代码助手都必须实现此接口。
 */
export interface CodeAssistantAdapter {
  /** 助手名称 */
  readonly name: string;

  /**
   * 执行任务（阻塞模式）
   *
   * @param task - 任务内容
   * @returns 执行结果
   */
  execute(task: string): Promise<CodeAssistantResult>;

  /**
   * 执行任务（流式模式）
   *
   * @param task - 任务内容
   * @returns 事件流
   */
  executeStream(task: string): Observable<CodeAssistantEvent>;

  /**
   * 检查助手是否可用
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================
// Claude Code 适配器
// ============================================================

/**
 * Claude Code 配置
 */
export const CLAUDE_CODE_CONFIG: CodeAssistantConfig = {
  name: 'claude-code',
  command: 'claude',
  argsTemplate: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose'],
  timeoutMs: 300000, // 5 分钟
};

/**
 * Claude Code 适配器
 *
 * 通过 CLI 调用 Claude Code，解析流式 JSON 输出。
 *
 * @example
 * ```typescript
 * const adapter = new ClaudeCodeAdapter();
 *
 * // 阻塞模式
 * const result = await adapter.execute('分析这段代码');
 * console.log(result.output);
 *
 * // 流式模式
 * adapter.executeStream('重构这个函数').subscribe(event => {
 *   console.log('事件:', event);
 * });
 * ```
 */
export class ClaudeCodeAdapter implements CodeAssistantAdapter {
  readonly name = 'claude-code';
  private config: CodeAssistantConfig;

  constructor(config?: Partial<CodeAssistantConfig>) {
    this.config = { ...CLAUDE_CODE_CONFIG, ...config };
  }

  async execute(task: string): Promise<CodeAssistantResult> {
    const startTime = Date.now();

    try {
      const childProcess = await import('node:child_process');
      const args = this.buildArgs(task);

      return new Promise((resolve) => {
        const proc = childProcess.spawn(this.config.command, args, {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          const durationMs = Date.now() - startTime;

          if (code === 0) {
            // 解析最后一行 JSON（result 事件）
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1];

            try {
              const event = JSON.parse(lastLine);
              if (event.type === 'result') {
                resolve({
                  success: true,
                  output: event.result,
                  costUsd: event.cost_usd,
                  durationMs: event.duration_ms ?? durationMs,
                });
              } else {
                resolve({
                  success: true,
                  output: stdout,
                  durationMs,
                });
              }
            } catch {
              resolve({
                success: true,
                output: stdout,
                durationMs,
              });
            }
          } else {
            resolve({
              success: false,
              output: stdout,
              error: stderr || `Process exited with code ${code}`,
              durationMs,
            });
          }
        });

        proc.on('error', (error: Error) => {
          resolve({
            success: false,
            output: '',
            error: error.message,
            durationMs: Date.now() - startTime,
          });
        });

        // 设置超时
        if (this.config.timeoutMs) {
          setTimeout(() => {
            proc.kill('SIGTERM');
            resolve({
              success: false,
              output: '',
              error: 'Timeout',
              durationMs: Date.now() - startTime,
            });
          }, this.config.timeoutMs);
        }
      });
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  executeStream(task: string): Observable<CodeAssistantEvent> {
    return new Observable<CodeAssistantEvent>((subscriber) => {
      this.execute(task)
        .then((result) => {
          if (result.success) {
            subscriber.next({ type: 'result', content: result.output });
          } else {
            subscriber.next({ type: 'error', error: result.error ?? 'Unknown error' });
          }
          subscriber.complete();
        })
        .catch((error) => {
          subscriber.next({ type: 'error', error: error.message });
          subscriber.complete();
        });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { spawn } = await import('node:child_process');
      return new Promise((resolve) => {
        const process = spawn(this.config.command, ['--version'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        process.on('close', (code) => {
          resolve(code === 0);
        });

        process.on('error', () => {
          resolve(false);
        });

        setTimeout(() => {
          process.kill();
          resolve(false);
        }, 5000);
      });
    } catch {
      return false;
    }
  }

  private buildArgs(task: string): string[] {
    const args: string[] = [];

    for (const arg of this.config.argsTemplate) {
      if (arg === '{prompt}') {
        args.push(task);
      } else {
        args.push(arg);
      }
    }

    return args;
  }
}

// ============================================================
// Codex 适配器
// ============================================================

/**
 * Codex 配置
 */
export const CODEX_CONFIG: CodeAssistantConfig = {
  name: 'codex',
  command: 'codex',
  argsTemplate: ['--quiet', '--approval-mode', 'full-auto', '{prompt}'],
  timeoutMs: 300000,
};

/**
 * Codex 适配器
 *
 * 通过 CLI 调用 OpenAI Codex。
 */
export class CodexAdapter implements CodeAssistantAdapter {
  readonly name = 'codex';
  private config: CodeAssistantConfig;

  constructor(config?: Partial<CodeAssistantConfig>) {
    this.config = { ...CODEX_CONFIG, ...config };
  }

  async execute(task: string): Promise<CodeAssistantResult> {
    const startTime = Date.now();

    try {
      const childProcess = await import('node:child_process');
      const args = this.buildArgs(task);

      return new Promise((resolve) => {
        const proc = childProcess.spawn(this.config.command, args, {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          const durationMs = Date.now() - startTime;

          resolve({
            success: code === 0,
            output: stdout,
            error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined,
            durationMs,
          });
        });

        proc.on('error', (error: Error) => {
          resolve({
            success: false,
            output: '',
            error: error.message,
            durationMs: Date.now() - startTime,
          });
        });

        if (this.config.timeoutMs) {
          setTimeout(() => {
            proc.kill('SIGTERM');
            resolve({
              success: false,
              output: '',
              error: 'Timeout',
              durationMs: Date.now() - startTime,
            });
          }, this.config.timeoutMs);
        }
      });
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  executeStream(task: string): Observable<CodeAssistantEvent> {
    return new Observable<CodeAssistantEvent>((subscriber) => {
      this.execute(task)
        .then((result) => {
          if (result.success) {
            subscriber.next({ type: 'result', content: result.output });
          } else {
            subscriber.next({ type: 'error', error: result.error ?? 'Unknown error' });
          }
          subscriber.complete();
        })
        .catch((error) => {
          subscriber.next({ type: 'error', error: error.message });
          subscriber.complete();
        });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { spawn } = await import('node:child_process');
      return new Promise((resolve) => {
        const process = spawn(this.config.command, ['--version'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        process.on('close', (code) => {
          resolve(code === 0);
        });

        process.on('error', () => {
          resolve(false);
        });

        setTimeout(() => {
          process.kill();
          resolve(false);
        }, 5000);
      });
    } catch {
      return false;
    }
  }

  private buildArgs(task: string): string[] {
    const args: string[] = [];

    for (const arg of this.config.argsTemplate) {
      if (arg === '{prompt}') {
        args.push(task);
      } else {
        args.push(arg);
      }
    }

    return args;
  }
}

// ============================================================
// 工具集成
// ============================================================

/**
 * 创建代码助手工具
 *
 * 将代码助手封装为 AgentTool，可以注册到 ToolRegistry。
 *
 * @param adapter - 代码助手适配器
 * @returns AgentTool 实例
 */
export function createCodeAssistantTool(adapter: CodeAssistantAdapter): AgentTool {
  return {
    name: `code-assistant-${adapter.name}`,
    description: `Execute task using ${adapter.name}`,
    riskLevel: 'execute',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task to execute',
        },
      },
      required: ['task'],
    },
    async execute(
      input: ToolInput,
      _context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const task = input.task as string;

      if (!task) {
        return {
          status: 'error',
          error: 'Task is required',
        };
      }

      try {
        const result = await adapter.execute(task);

        if (result.success) {
          return {
            status: 'success',
            output: result.output,
            data: {
              costUsd: result.costUsd,
              durationMs: result.durationMs,
            },
          };
        } else {
          return {
            status: 'error',
            error: result.error ?? 'Unknown error',
          };
        }
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 创建代码助手工具（流式版本）
 *
 * 将代码助手封装为 AgentTool，支持流式输出。
 *
 * @param adapter - 代码助手适配器
 * @returns AgentTool 实例
 */
export function createCodeAssistantStreamTool(adapter: CodeAssistantAdapter): AgentTool {
  return {
    name: `code-assistant-${adapter.name}-stream`,
    description: `Execute task using ${adapter.name} with streaming output`,
    riskLevel: 'execute',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task to execute',
        },
      },
      required: ['task'],
    },
    async execute(
      input: ToolInput,
      _context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const task = input.task as string;

      if (!task) {
        return {
          status: 'error',
          error: 'Task is required',
        };
      }

      try {
        // 收集所有事件
        const events: CodeAssistantEvent[] = [];

        return new Promise((resolve) => {
          adapter.executeStream(task).subscribe({
            next: (event) => {
              events.push(event);
            },
            complete: () => {
              // 找到最终结果
              const resultEvent = events.find((e) => e.type === 'result');
              const errorEvent = events.find((e) => e.type === 'error');

              if (resultEvent && resultEvent.type === 'result') {
                resolve({
                  status: 'success',
                  output: resultEvent.content,
                });
              } else if (errorEvent && errorEvent.type === 'error') {
                resolve({
                  status: 'error',
                  error: errorEvent.error,
                });
              } else {
                resolve({
                  status: 'error',
                  error: 'No result received',
                });
              }
            },
            error: (error) => {
              resolve({
                status: 'error',
                error: error.message,
              });
            },
          });
        });
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
