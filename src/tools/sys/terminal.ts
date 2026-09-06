/**
 * terminal.ts - 交互式终端工具
 *
 * 提供持久化终端会话管理：创建会话、发送命令、读取输出、关闭会话。
 * 使用 child_process.spawn 创建持久 shell 进程，支持会话超时自动关闭。
 *
 * ## 安全机制
 *
 * - riskLevel: "execute" — 需要权限确认
 * - 每个会话有唯一 ID，防止越权操作
 * - 支持超时自动关闭，防止资源泄漏
 *
 * ## 操作模式
 *
 * - create: 创建新会话，返回 session_id
 * - send: 向指定会话发送命令
 * - read: 读取指定会话的输出
 * - list: 列出所有活跃会话
 * - close: 关闭指定会话
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool } from '../core/tool-types.js';
import type { JsonSchema } from '../core/tool-types.js';

// ============================================================
// Session 管理
// ============================================================

export type TerminalSession = {
  id: string;
  process: ChildProcess;
  cwd: string;
  createdAt: number;
  lastActiveAt: number;
  outputBuffer: string;
  timeout: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
};

const sessions = new Map<string, TerminalSession>();

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const MAX_OUTPUT_BUFFER = 1024 * 1024; // 1MB
const CLEANUP_INTERVAL = 60_000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupRunning(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActiveAt > session.timeout) {
        closeSession(id);
      }
    }
  }, CLEANUP_INTERVAL);
}

function generateSessionId(): string {
  return randomBytes(8).toString('hex');
}

function resetTimer(session: TerminalSession): void {
  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
  }
  session.timeoutTimer = setTimeout(() => {
    closeSession(session.id);
  }, session.timeout);
}

function appendOutput(session: TerminalSession, data: string): void {
  session.outputBuffer += data;
  // Trim buffer if too large
  if (session.outputBuffer.length > MAX_OUTPUT_BUFFER) {
    session.outputBuffer = session.outputBuffer.slice(-MAX_OUTPUT_BUFFER);
  }
}

function closeSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
    session.timeoutTimer = null;
  }

  try {
    session.process.kill('SIGTERM');
  } catch {
    // Process may already be dead
  }

  sessions.delete(id);
  return true;
}

// ============================================================
// Zod Schema
// ============================================================

export const terminalInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    cwd: z.string().optional().describe('工作目录（可选，默认使用当前目录）'),
    timeout: z.number().optional().describe('会话超时时间（毫秒，默认 300000）'),
  }),
  z.object({
    action: z.literal('send'),
    session_id: z.string().min(1).describe('会话 ID'),
    command: z.string().describe('要发送的命令'),
  }),
  z.object({
    action: z.literal('read'),
    session_id: z.string().min(1).describe('会话 ID'),
  }),
  z.object({
    action: z.literal('list'),
  }),
  z.object({
    action: z.literal('close'),
    session_id: z.string().min(1).describe('会话 ID'),
  }),
]);

export type TerminalInput = z.infer<typeof terminalInputSchema>;

// ============================================================
// Tool Factory
// ============================================================

/**
 * 创建 terminal 工具
 *
 * @returns AgentTool 实例
 */
export function createTerminalTool(): AgentTool {
  ensureCleanupRunning();

  return {
    name: 'terminal',
    riskLevel: 'execute',
    description: '交互式终端会话管理：创建持久化 shell 会话、发送命令、读取输出',
    inputSchema: zodToJsonSchema(terminalInputSchema) as JsonSchema,

    async execute(input) {
      const parsed = terminalInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      const data = parsed.data;

      switch (data.action) {
        case 'create':
          return handleCreate(data);
        case 'send':
          return handleSend(data);
        case 'read':
          return handleRead(data);
        case 'list':
          return handleList();
        case 'close':
          return handleClose(data);
      }
    },
  };
}

// ============================================================
// Action Handlers
// ============================================================

function handleCreate(data: Extract<TerminalInput, { action: 'create' }>): Promise<{ status: 'success'; output: string; data: { session_id: string } } | { status: 'error'; error: string }> {
  const id = generateSessionId();
  const cwd = data.cwd || process.cwd();
  const timeout = data.timeout || DEFAULT_TIMEOUT;

  const proc = spawn('bash', [], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'dumb' },
  });

  const session: TerminalSession = {
    id,
    process: proc,
    cwd,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    outputBuffer: '',
    timeout,
    timeoutTimer: null,
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    appendOutput(session, chunk.toString());
    session.lastActiveAt = Date.now();
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    appendOutput(session, chunk.toString());
    session.lastActiveAt = Date.now();
  });

  proc.on('error', () => {
    closeSession(id);
  });

  proc.on('exit', () => {
    sessions.delete(id);
  });

  sessions.set(id, session);
  resetTimer(session);

  return Promise.resolve({
    status: 'success',
    output: `Terminal session created. session_id: ${id}`,
    data: { session_id: id },
  });
}

function handleSend(data: Extract<TerminalInput, { action: 'send' }>): Promise<{ status: 'success'; output: string } | { status: 'error'; error: string }> {
  const session = sessions.get(data.session_id);
  if (!session) {
    return Promise.resolve({ status: 'error', error: `Session not found: ${data.session_id}` });
  }

  const proc = session.process;
  if (!proc.stdin || proc.killed) {
    return Promise.resolve({ status: 'error', error: `Session is no longer active: ${data.session_id}` });
  }

  try {
    // Send command with newline to execute it
    proc.stdin.write(data.command + '\n');
    session.lastActiveAt = Date.now();
    resetTimer(session);

    return Promise.resolve({
      status: 'success',
      output: `Command sent to session ${data.session_id}: ${data.command}`,
    });
  } catch (error) {
    return Promise.resolve({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleRead(data: Extract<TerminalInput, { action: 'read' }>): Promise<{ status: 'success'; output: string } | { status: 'error'; error: string }> {
  const session = sessions.get(data.session_id);
  if (!session) {
    return Promise.resolve({ status: 'error', error: `Session not found: ${data.session_id}` });
  }

  const output = session.outputBuffer;
  session.outputBuffer = '';
  session.lastActiveAt = Date.now();
  resetTimer(session);

  return Promise.resolve({
    status: 'success',
    output: output || '(no output)',
  });
}

function handleList(): Promise<{ status: 'success'; output: string; data: { sessions: Array<{ id: string; cwd: string; createdAt: number; lastActiveAt: number }> } }> {
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
  }));

  const output = sessionList.length === 0
    ? 'No active sessions.'
    : sessionList.map(s => `  ${s.id} | cwd: ${s.cwd} | created: ${new Date(s.createdAt).toISOString()}`).join('\n');

  return Promise.resolve({
    status: 'success',
    output: `Active sessions (${sessionList.length}):\n${output}`,
    data: { sessions: sessionList },
  });
}

function handleClose(data: Extract<TerminalInput, { action: 'close' }>): Promise<{ status: 'success'; output: string } | { status: 'error'; error: string }> {
  const closed = closeSession(data.session_id);
  if (!closed) {
    return Promise.resolve({ status: 'error', error: `Session not found: ${data.session_id}` });
  }

  return Promise.resolve({
    status: 'success',
    output: `Session closed: ${data.session_id}`,
  });
}

// ============================================================
// Cleanup for testing / shutdown
// ============================================================

/**
 * 关闭所有活跃会话（用于测试或应用关闭）
 */
export function closeAllSessions(): void {
  for (const id of Array.from(sessions.keys())) {
    closeSession(id);
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
