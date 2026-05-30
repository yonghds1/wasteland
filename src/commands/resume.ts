/**
 * resume.ts - Resume 命令
 *
 * 恢复之前的会话。
 */

import { Command } from 'commander';
import { Subject } from 'rxjs';

import { t } from '../locales/index.js';

import { loadWastelandSettings } from '../config/load-settings.js';
import { resolveDefaultSessionDir, resolveDefaultTraceDir } from '../config/paths.js';
import { resolveChatRuntime } from '../config/resolve-chat-runtime.js';
import { createSessionIndex, type SessionDetail } from '../core/runtime/session-index.js';
import { runAgentLoop } from '../core/runtime/agent-loop.js';
import { createDefaultProviderRegistry } from '../providers/provider-registry.js';
import { createDefaultToolRegistry } from '../tools/default-registry.js';
import { createPermissionGate } from '../core/runtime/permission-gate.js';
import { SessionManager } from '../core/runtime/session-manager.js';
import { renderRuntimeEvents } from '../ui/terminal-renderer.js';
import { renderDebugTrace } from '../ui/debug-renderer.js';
import { createInteractiveTurnStream, createSingleTurnInput } from '../ui/readline-input.js';
import type { ChatInputTurn, RuntimeMode } from '../core/runtime/event-types.js';
import { detectTTY } from '../ui/tty-detect.js';
import { createSkillRegistry } from '../skills/skill-discovery.js';
import { SkillExecutor } from '../skills/skill-executor.js';
import { homedir } from 'node:os';

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
  const providerRegistry = createDefaultProviderRegistry();

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

      // 加载配置
      const loadedSettings = await loadWastelandSettings({
        cwd,
        env: process.env,
      });

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

      // 解析运行时配置
      const runtimeConfig = resolveChatRuntime({
        settings: loadedSettings.settings,
        providerName: options.provider,
        roleName: options.role,
        cwd,
      });

      // 创建 provider
      const provider = providerRegistry.resolve(
        runtimeConfig.providerName,
        runtimeConfig.providerConfig
      );

      // 创建 session 管理器
      const sessionManager = new SessionManager(
        resolveDefaultSessionDir({
          cwd,
          projectConfigDir: loadedSettings.projectConfigDir,
          env: process.env,
        })
      );

      // 创建恢复的 session 元数据
      const resumedSession = createResumedSessionMetadata(sessionToResume);

      // 创建权限门控
      const permissionMode = options.permissionMode ?? runtimeConfig.permissionMode ?? 'default';
      const permissionGate = createPermissionGate({ mode: permissionMode });

      // 创建工具注册表
      const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(
        loadedSettings.settings.mcpServers
      );

      // 创建技能注册表和执行器
      const skillRegistry = await createSkillRegistry({
        projectSkillsDir: loadedSettings.projectConfigDir
          ? `${loadedSettings.projectConfigDir}/skills`
          : undefined,
        userSkillsDir: `${homedir()}/.wasteland/skills`,
      });
      const skillExecutor = new SkillExecutor(skillRegistry);

      // 启动 MCP 服务器
      try {
        await startMCP();
      } catch (error) {
        console.warn(
          t('mcp.startupFailed'),
          error instanceof Error ? error.message : String(error)
        );
      }

      const debug = options.debug === true || loadedSettings.settings.runtime.debug;
      const debugFormat = options.debugFormat === 'jsonl' ? 'jsonl' : 'pretty';
      const maxStepsPerTurn = loadedSettings.settings.runtime.maxStepsPerTurn ?? 8;
      const childAgentTimeout = loadedSettings.settings.runtime.childAgentTimeout;
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? 'interactive' : 'classic';

      try {
        if (options.message?.trim()) {
          // 单次消息模式
          const input$ = createSingleTurnInput(options.message, 'message');

          const run = runAgentLoop({
            input$,
            provider,
            sessionManager,
            toolRegistry,
            permissionGate,
            cwd,
            mode: 'single',
            maxStepsPerTurn,
            existingSession: resumedSession,
            prompt: runtimeConfig.prompt,
            providerRegistry,
            providerSettings: runtimeConfig.providerConfig,
            skillExecutor,
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
            provider,
            sessionManager,
            toolRegistry,
            permissionGate,
            cwd,
            mode: 'interactive',
            maxStepsPerTurn,
            existingSession: resumedSession,
            prompt: runtimeConfig.prompt,
            providerRegistry,
            providerSettings: runtimeConfig.providerConfig,
            skillExecutor,
            childAgentTimeout,
          });

          const interactive = createInteractiveTurnStream();
          interactive.prompt();

          const work: Promise<void>[] = [
            renderRuntimeEvents(run.events$, {
              onTurnComplete: interactive.prompt,
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
          interactive.turns$.subscribe({
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
            interactive.close();
            await interactive.done;
            throw error;
          }

          await interactive.done;
        }
      } finally {
        await stopMCP();
      }
    });
}
