/**
 * acp-client.ts - ACP (Agent Client Protocol) 客户端薄封装
 *
 * wasteland 作为 ACP **client**：把远程编码 agent（claude-agent-acp、codex-acp 等）
 * 作为**子进程** spawn，经 stdio newline-delimited JSON-RPC 通信。
 * 协议层（编解码、握手、session 方法、类型校验）委托官方 SDK
 * `@zed-industries/agent-client-protocol`，本文件只负责：
 *   1. 子进程生命周期（spawn / 环境净化 / 退出清理 / kill 兜底）
 *   2. stdio ↔ SDK Stream 适配（node stream → Web stream）
 *   3. `session/update` 通知 → 文本聚合 + `AcpStreamEvent` 透出（供 TUI 流式）
 *   4. 超时（startup 握手 / prompt 执行各一档）
 *
 * 无常驻端口/URL/token：一次 `prompt()` 即完整生命周期，`stopReason` 即终态。
 * 生命周期 = 每次工具调用（spawn → prompt → dispose），不做进程池。
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@zed-industries/agent-client-protocol';
import { Logger } from '@core/logger/index.js';

// ============================================================
// 类型
// ============================================================

/**
 * ACP agent 启动配置（子进程维度）。
 * 与 settings 层的 `AcpAgentConfig` 字段对齐。
 */
export type AcpAgentLaunchConfig = {
  /** agent 名称（日志 / 工具名后缀） */
  name: string;
  /** 启动命令（如 `npx`） */
  command: string;
  /** 命令参数（如 `['-y', '@agentclientprotocol/claude-agent-acp']`） */
  args?: string[];
  /** 追加到子进程的环境变量 */
  env?: Record<string, string>;
  /** 子进程工作目录，默认 process.cwd() */
  cwd?: string;
  /** initialize 握手超时（毫秒），默认 90s（容纳 npx 冷拉） */
  startupTimeoutMs?: number;
  /** prompt 执行超时（毫秒），默认 300s */
  promptTimeoutMs?: number;
};

/**
 * 流式事件（供 TUI / logs 消费）
 */
export type AcpStreamEvent =
  | { kind: 'chunk'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'done'; stopReason: PromptResponse['stopReason']; text: string }
  | { kind: 'error'; error: string };

/**
 * ACP 终态原因（SDK 判别联合的原始类型投影，不外泄 schema 类型）
 *
 * end_turn | max_tokens | max_turn_requests | refusal | cancelled
 */
export type AcpStopReason = PromptResponse['stopReason'];

/** prompt 的聚合结果 */
export type AcpPromptResult = {
  stopReason: PromptResponse['stopReason'];
  /** 聚合的可见回复文本 */
  text: string;
  /** 聚合的思考文本（仅当 agent 发了 thought chunk） */
  thought?: string;
};

/**
 * ACP 客户端错误
 */
export class AcpClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AcpClientError';
  }
}

type AcpChild = ChildProcessByStdio<Writable, Readable, Readable>;

// ============================================================
// 环境净化（P0 实测：claude-agent-acp 检测嵌套会话即拒启）
// ============================================================

/**
 * 剔除 Claude Code 嵌套会话标识，保留鉴权变量（ANTHROPIC_* 等）
 */
export function sanitizeChildEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_CODE_')) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

// ============================================================
// AcpClient
// ============================================================

/**
 * 拥有一个子进程 + 一次 prompt 生命周期的 ACP 客户端。
 *
 * 用法：`await AcpClient.spawn(cfg)` → `await client.prompt(task, onEvent)`
 * → `await client.dispose()`（幂等）。
 */
export class AcpClient {
  private aggregator: {
    text: string[];
    thought: string[];
    onEvent?: (ev: AcpStreamEvent) => void;
  } | null = null;
  private activeSessionId: string | undefined;
  private disposed = false;
  private exitPromise: Promise<number | null>;
  /** 子进程 error（ENOENT 等）→ reject，用于握手/prompt race */
  private failurePromise: Promise<never>;
  private stderrTail = '';

  private constructor(
    private readonly child: AcpChild,
    private readonly config: AcpAgentLaunchConfig
  ) {
    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
    });
    this.failurePromise = new Promise<never>((_, reject) => {
      child.once('error', (err) =>
        reject(
          new AcpClientError(`Failed to launch agent process: ${err.message}`, 'SPAWN_ERROR')
        )
      );
    });
    child.stderr.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-4096);
    });
  }

  /** 由 spawn 在构造后赋值（Connection 回调需要实例，实例构造又需要子进程） */
  private declare conn: ClientSideConnection;

  /**
   * spawn 子进程并完成 initialize 握手
   *
   * @throws {AcpClientError} 进程启动失败 / 握手超时 / 握手报错
   */
  static async spawn(config: AcpAgentLaunchConfig): Promise<AcpClient> {
    const child = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd ?? process.cwd(),
      env: sanitizeChildEnv(process.env, config.env ?? {}),
      // POSIX 下让子进程成为新进程组组长：`npx` 等 wrapper 会派生真实
      // acp server 孙进程，dispose 需 kill 整个进程组，否则孙进程孤儿化泄漏
      //（P0 冒烟实测：npx 被杀后 claude-code-acp 子树被 init 收养）。
      detached: process.platform !== 'win32',
    }) as AcpChild;

    const client = new AcpClient(child, config);

    client.conn = new ClientSideConnection(
      () => client.asSdkClient(),
      // output = 发给 agent（child.stdin），input = agent 的回流（child.stdout）
      ndJsonStream(
        Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
      )
    );

    try {
      await withTimeout(
        Promise.race([
          client.conn.initialize({
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          }),
          // spawn 失败（ENOENT 等）在握手期即显式抛出，而非等超时
          client.failurePromise,
        ]),
        config.startupTimeoutMs ?? 90_000,
        'initialize'
      );
    } catch (error) {
      await client.dispose();
      if (error instanceof AcpClientError) throw error;
      throw new AcpClientError(
        `ACP initialize failed: ${error instanceof Error ? error.message : String(error)}`,
        'INITIALIZE_ERROR',
        error
      );
    }

    Logger.info({
      sessionId: 'unknown',
      scope: 'acp',
      message: 'acp.spawned',
      data: { name: config.name, command: config.command, args: config.args },
    });
    return client;
  }

  /** SDK Client 回调实现（agent → client 反向调用） */
  private asSdkClient(): Client {
    return {
      // 首版策略（design.md Non-goal）：自动选 allow_once 放行 + warn 记录。
      // 工具级 riskLevel 闸门已在 wasteland 侧把过，agent 反向请求不再二次弹窗。
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const preferred =
          params.options.find((o) => o.kind === 'allow_once') ?? params.options[0];
        Logger.warn({
          sessionId: 'unknown',
          scope: 'acp',
          message: 'acp.auto_approve_permission',
          data: {
            agent: this.config.name,
            toolCall: params.toolCall?.title,
            option: preferred?.optionId,
          },
        });
        if (!preferred) {
          return { outcome: { outcome: 'cancelled' } };
        }
        return { outcome: { outcome: 'selected', optionId: preferred.optionId } };
      },
      sessionUpdate: async (note: SessionNotification) => {
        this.handleSessionUpdate(note);
      },
    };
  }

  private handleSessionUpdate(note: SessionNotification): void {
    const agg = this.aggregator;
    const update = note.update as Record<string, unknown> & {
      sessionUpdate: string;
      content?: { type?: string; text?: string };
    };
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
        if (text) {
          agg?.text.push(text);
          agg?.onEvent?.({ kind: 'chunk', text });
        }
        break;
      }
      case 'agent_thought_chunk': {
        const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
        if (text) {
          agg?.thought.push(text);
          agg?.onEvent?.({ kind: 'thought', text });
        }
        break;
      }
      default:
        // plan / tool_call / available_commands_update 等：仅 debug，不进步进 output
        Logger.debug({
          sessionId: 'unknown',
          scope: 'acp',
          message: `acp.update.${update.sessionUpdate}`,
          data: { agent: this.config.name },
        });
    }
  }

  /**
   * 建会话并执行一次任务，聚合流式文本
   *
   * @param task - 任务文本
   * @param onEvent - 每个流式事件的回调（chunk/thought/done）
   * @throws {AcpClientError} prompt 超时 / 协议错误 / 子进程中途退出
   */
  async prompt(task: string, onEvent?: (ev: AcpStreamEvent) => void): Promise<AcpPromptResult> {
    const text: string[] = [];
    const thought: string[] = [];
    this.aggregator = { text, thought, onEvent };

    try {
      const session = await this.guarded(
        this.conn.newSession({
          cwd: this.config.cwd ?? process.cwd(),
          mcpServers: [],
        }),
        'session/new'
      );
      this.activeSessionId = session.sessionId;

      const res = await this.guarded(
        this.conn.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: task }],
        }),
        'session/prompt',
        this.config.promptTimeoutMs ?? 300_000
      );

      const out = text.join('');
      const joinedThought = thought.join('');
      onEvent?.({ kind: 'done', stopReason: res.stopReason, text: out });
      Logger.info({
        sessionId: 'unknown',
        scope: 'acp',
        message: 'acp.prompt.done',
        data: { agent: this.config.name, stopReason: res.stopReason, chars: out.length },
      });
      return {
        stopReason: res.stopReason,
        text: out,
        ...(joinedThought ? { thought: joinedThought } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent?.({ kind: 'error', error: message });
      throw error;
    } finally {
      this.aggregator = null;
    }
  }

  /**
   * 取消进行中的 prompt（session/cancel 通知，尽力而为）。
   * prompt 超时/异常路径由 dispose 的 SIGKILL 兜底。
   */
  async cancel(): Promise<void> {
    if (!this.activeSessionId || this.disposed) return;
    try {
      await this.conn.cancel({ sessionId: this.activeSessionId });
    } catch {
      // 连接已断或 agent 未支持：忽略，dispose 兜底
    }
  }

  /** 关闭并回收子进程（幂等）：SIGTERM → 2s 未退则 SIGKILL（POSIX 下杀整个进程组） */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.activeSessionId = undefined;
    if (isAlive(this.child)) {
      this.killGroup('SIGTERM');
      const exited = await Promise.race([
        this.exitPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (!exited && isAlive(this.child)) {
        this.killGroup('SIGKILL');
      }
    }
    Logger.debug({
      sessionId: 'unknown',
      scope: 'acp',
      message: 'acp.disposed',
      data: { name: this.config.name },
    });
  }

  /**
   * 向子进程所在进程组发信号（spawn 时 detached=true 使 child.pid 即 PGID）。
   * 覆盖 npx → claude-code-acp 这类 wrapper 派生的孙进程。
   */
  private killGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (!pid) return;
    try {
      if (process.platform === 'win32') {
        this.child.kill(signal);
      } else {
        process.kill(-pid, signal);
      }
    } catch {
      // 进程组已退化为空：忽略
    }
  }

  /** 包一层超时 + spawn 失败 + 子进程早退检测 */
  private async guarded<T>(promise: Promise<T>, label: string, timeoutMs = 90_000): Promise<T> {
    return withTimeout(
      (async () => {
        const raced = await Promise.race([
          promise.then((v) => ({ ok: true as const, v })),
          this.exitPromise.then((code) => ({ ok: false as const, code })),
          this.failurePromise.then(() => ({ ok: false as const, code: 'error' })),
        ]);
        if (!raced.ok) {
          throw new AcpClientError(
            `Agent process exited (code=${raced.code}) during ${label}` +
              (this.stderrTail ? `: ${this.stderrTail.slice(-500)}` : ''),
            'PROCESS_EXITED'
          );
        }
        return raced.v;
      })(),
      timeoutMs,
      label
    );
  }
}

// ============================================================
// 辅助
// ============================================================

function isAlive(child: AcpChild): boolean {
  return child.exitCode === null && child.signalCode === null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AcpClientError(`ACP ${label} timed out after ${ms}ms`, 'TIMEOUT')),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
