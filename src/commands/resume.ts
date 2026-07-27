/**
 * resume.ts - Resume 命令
 *
 * 恢复之前的会话。
 */

import { Command } from 'commander';
import { Subject } from 'rxjs';

import { t } from '../locales/index.js';

import { resolveDefaultTraceDir } from '../config/paths.js';
import { initializeRuntime } from '../core/shared/initialize-runtime.js';
import { createSessionIndex, type SessionDetail } from '../core/runtime/session-index.js';
import { runAgentLoop, MAIN_AGENT_TOOL_NAMES, filterToolRegistry } from '../core/runtime/agent-loop.js';
import { createPermissionGate } from '../core/runtime/permission-gate.js';
import { renderRuntimeEvents } from '../ui/terminal-renderer.js';
import { renderDebugTrace } from '../ui/debug-renderer.js';
import { CliInputAdapter } from '../ui/cli-input-adapter.js';
import { createSingleTurnInput } from '../ui/readline-input.js';
import type { ChatInputTurn, RuntimeMode } from '../core/runtime/event-types.js';
import { detectTTY } from '../ui/tty-detect.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从 session 记录中恢复历史消息
 */
function restoreHistoryFromRecords(records: any[]): any[] {
  return records
    .filter((record) => record.type === 'message')
    .map((record) => ({
      type: 'message',
      role: record.role,
      turn: record.turn || 0,
      content: record.content,
      source: record.source || 'interactive',
      timestamp: record.timestamp,
    }));
}

/**
 * 创建恢复的 session 元数据
 */
function createResumedSessionMetadata(originalSession: SessionDetail) {
  return {
    id: originalSession.id,
    path: originalSession.path,
    cwd: originalSession.cwd || process.cwd(),
    mode: (originalSession.mode || 'single') as RuntimeMode,
    providerId: originalSession.providerId || 'local',
  };
}

// ============================================================
// 命令定义
// ============================================================

/**
 * 创建 resume 命令
 */
export function createResumeCommand(): Command {
  return new Command('resume')
    .description(t('commands.resume.description'))
    .argument('[session-id]', t('commands.resume.options.sessionId'))
    .option('-m, --message <text>', t('commands.resume.options.message'))
    .option('-p, --provider <name>', t('commands.resume.options.provider'))
    .option('-r, --role <name>', t('commands.resume.options.role'))
    .option('--debug', t('commands.resume.options.debug'))
    .option('--debug-format <format>', t('commands.resume.options.debugFormat'))
    .option('--permission-mode <mode>', t('commands.resume.options.permissionMode'))
    .action(async (sessionId: string | undefined, options: any) => {
      const cwd = process.cwd();

      // 初始化运行时（复用入口缓存的配置，消除手动重造 runtime 的重复）
      const runtime = await initializeRuntime({
        cwd,
        roleName: options.role,
        providerName: options.provider,
        env: process.env,
      });
      const { loadedSettings, resolvedRuntime } = runtime;

      // permissionMode 覆盖（命令行 --permission-mode 优先于配置）
      const permissionGate = options.permissionMode
        ? createPermissionGate({ mode: options.permissionMode })
        : runtime.permissionGate;

      // 获取 session 索引
      const sessionIndex = createSessionIndex();

      // 获取要恢复的 session
      let sessionToResume: SessionDetail | null;

      if (sessionId) {
        sessionToResume = await sessionIndex.getSession(sessionId);
        if (!sessionToResume) {
          console.error(`${t('commands.resume.notFound')} ${sessionId}`);
          process.exit(1);
        }
      } else {
        sessionToResume = await sessionIndex.getLatestSession();
        if (!sessionToResume) {
          console.error(t('commands.resume.noSession'));
          process.exit(1);
        }
      }

      console.log(`\n${t('commands.resume.resuming')} ${sessionToResume.id}`);
      console.log(`${t('commands.resume.time')} ${sessionToResume.createdAt}`);
      console.log(`${t('commands.resume.messageCount')} ${sessionToResume.messageCount}`);
      console.log('');

      // 恢复历史消息
      const history = restoreHistoryFromRecords(sessionToResume.records);

      // 创建恢复的 session 元数据
      const resumedSession = createResumedSessionMetadata(sessionToResume);

      const debug = options.debug === true || loadedSettings.settings.runtime.debug;
      const debugFormat = options.debugFormat === 'jsonl' ? 'jsonl' : 'pretty';
      const maxStepsPerTurn = loadedSettings.settings.runtime.maxStepsPerTurn ?? 8;
      const childAgentTimeout = loadedSettings.settings.runtime.childAgentTimeout;
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? 'interactive' : 'classic';

      try {
        // ---- 主 agent 工具集最小化 ----
        // minimax 是小模型，工具越多决策越乱。
        // 这里把完整的 toolRegistry 过滤为 MAIN_AGENT_TOOL_NAMES
        // （spawn_agent / read-file / bash），让 minimax 只能看到核心工具。
        const mainAgentToolRegistry = runtime.toolRegistry
          ? filterToolRegistry(runtime.toolRegistry, MAIN_AGENT_TOOL_NAMES)
          : undefined;

        if (options.message?.trim()) {
          // 单次消息模式
          const input$ = createSingleTurnInput(options.message, 'message');

          const run = runAgentLoop({
            input$,
            provider: runtime.provider,
            sessionManager: runtime.sessionManager,
            toolRegistry: mainAgentToolRegistry,
            permissionGate,
            cwd,
            mode: 'single',
            maxStepsPerTurn,
            existingSession: resumedSession,
            prompt: resolvedRuntime.prompt,
            providerRegistry: runtime.providerRegistry,
            providerSettings: resolvedRuntime.providerConfig,
            skillExecutor: runtime.skillExecutor,
            childAgentTimeout,
          });

          const work: Promise<void>[] = [renderRuntimeEvents(run.events$, { style: renderStyle })];

          if (debug) {
            const traceDir =
              debugFormat === 'jsonl'
                ? resolveDefaultTraceDir({
                    cwd,
                    projectConfigDir: loadedSettings.projectConfigDir,
                  })
                : undefined;

            work.unshift(
              renderDebugTrace(run.debug$, {
                output: process.stderr,
                format: debugFormat,
                traceDir,
              })
            );
          }

          await Promise.all(work);
        } else {
          // 交互模式
          const inputSubject = new Subject<ChatInputTurn>();

          // 如果有历史消息，先注入恢复的消息
          if (history.length > 0) {
            for (const msg of history) {
              const turn: ChatInputTurn = {
                turn: msg.turn,
                content: msg.content,
                source: 'interactive',
              };
              inputSubject.next(turn);
            }
          }

          const run = runAgentLoop({
            input$: inputSubject.asObservable(),
            provider: runtime.provider,
            sessionManager: runtime.sessionManager,
            toolRegistry: mainAgentToolRegistry,
            permissionGate,
            cwd,
            mode: 'interactive',
            maxStepsPerTurn,
            existingSession: resumedSession,
            prompt: resolvedRuntime.prompt,
            providerRegistry: runtime.providerRegistry,
            providerSettings: resolvedRuntime.providerConfig,
            skillExecutor: runtime.skillExecutor,
            childAgentTimeout,
          });

          // 使用 CliInputAdapter 替代 createInteractiveTurnStream
          const inputAdapter = new CliInputAdapter({
            skillExecutor: runtime.skillExecutor,
          });

          const work: Promise<void>[] = [
            renderRuntimeEvents(run.events$, {
              onTurnComplete: () => inputAdapter.prompt(),
              style: renderStyle,
            }),
          ];

          if (debug) {
            const traceDir =
              debugFormat === 'jsonl'
                ? resolveDefaultTraceDir({
                    cwd,
                    projectConfigDir: loadedSettings.projectConfigDir,
                  })
                : undefined;

            work.unshift(
              renderDebugTrace(run.debug$, {
                output: process.stderr,
                format: debugFormat,
                traceDir,
              })
            );
          }

          // 订阅用户输入
          inputAdapter.input$.subscribe({
            next: (turn) => {
              inputSubject.next(turn);
            },
            complete: () => {
              inputSubject.complete();
            },
          });

          try {
            await Promise.all(work);
          } catch (error) {
            inputAdapter.destroy();
            throw error;
          }

          await inputAdapter.done;
        }
      } finally {
        await runtime.mcpManager.stopMCP();
      }
    });
}
