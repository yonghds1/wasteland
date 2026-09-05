/**
 * resume.ts - Resume 命令
 *
 * 恢复之前的会话。
 *
 * ## 增强功能
 *
 * - 显示可恢复的会话列表
 * - 支持交互式选择会话
 * - 会话状态验证
 * - 自动保存恢复的会话
 */

import { Command } from 'commander';
import { Subject } from 'rxjs';

import { t } from '@locales/index.js';

import { initializeRuntime, resolveAgentMode } from '@core/shared/initialize-runtime.js';
import {
  attachDebugTrace,
  startAgentLoop,
  stopRuntimeAgents,
} from '@core/shared/run-agent-helpers.js';
import {
  enableDebugLog,
  initializeFileSinkFromEnv,
} from '@core/runtime/debug-logger.js';
import { createSessionIndex, type SessionDetail, type SessionSummary } from '@core/runtime/session-index.js';
import { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import { renderRuntimeEvents } from '@ui/terminal-renderer.js';
import { CliInputAdapter } from '@ui/cli-input-adapter.js';
import { createSingleTurnInput } from '@ui/readline-input.js';
import type { ChatInputTurn, HistoryRecord, RuntimeMode, SessionRecord, SessionSummaryRecord } from '@core/runtime/event-types.js';
import { detectTTY } from '@ui/tty-detect.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从 session 记录中恢复历史
 *
 * 返回完整 HistoryRecord[]，包含 message、tool_call、tool_result 记录，
 * 以及 summary 摘要记录（压缩时插入的早期上下文），
 * 确保 resume 后 AI 能看到之前的工具调用上下文与压缩摘要。
 * 非历史记录（session/usage/compaction/permission/end）被过滤。
 */
export function restoreHistoryFromRecords(records: Array<SessionRecord | SessionSummaryRecord>): HistoryRecord[] {
  return records.filter(
    (record): record is HistoryRecord =>
      record.type === 'message' ||
      record.type === 'tool_call' ||
      record.type === 'tool_result' ||
      record.type === 'summary'
  );
}

/**
 * 创建恢复的 session 元数据
 */
export function createResumedSessionMetadata(originalSession: SessionDetail) {
  return {
    id: originalSession.id,
    path: originalSession.path,
    cwd: originalSession.cwd || process.cwd(),
    mode: (originalSession.mode || 'single') as RuntimeMode,
    providerId: originalSession.providerId || 'local',
  };
}

/**
 * 显示可恢复的会话列表
 *
 * @param sessions - 会话列表
 * @param currentSessionId - 当前会话 ID（可选）
 */
export function displayResumableSessions(
  sessions: SessionSummary[],
  currentSessionId?: string
): void {
  console.log(`\n📋 ${t('commands.resume.list.title')}:\n`);

  if (sessions.length === 0) {
    console.log(`  ${t('commands.resume.list.empty')}\n`);
    return;
  }

  sessions.forEach((session, index) => {
    const isCurrent = session.id === currentSessionId;
    const prefix = isCurrent ? '  👉 ' : '  ';
    const suffix = isCurrent ? ` (${t('commands.resume.list.current')})` : '';

    console.log(`${prefix}${index + 1}. ${session.id}${suffix}`);
    if (session.firstUserMessage) {
      console.log(`     ${t('commands.resume.list.preview')}: ${session.firstUserMessage.substring(0, 50)}...`);
    }
    console.log(`     ${t('commands.resume.list.time')}: ${session.createdAt}`);
    console.log(`     ${t('commands.resume.list.messages')}: ${session.messageCount}`);
    console.log('');
  });
}

/**
 * 验证会话状态
 *
 * @param session - 会话详情
 * @returns 验证结果
 */
export function validateSessionForResume(session: SessionDetail): {
  valid: boolean;
  reason?: string;
} {
  // 检查会话是否有记录
  if (!session.records || session.records.length === 0) {
    return {
      valid: false,
      reason: t('commands.resume.validation.noRecords'),
    };
  }

  // 检查会话是否有消息记录
  const hasMessages = session.records.some(
    (record) => record.type === 'message'
  );

  if (!hasMessages) {
    return {
      valid: false,
      reason: t('commands.resume.validation.noMessages'),
    };
  }

  return { valid: true };
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
    .option('--dangerously-skip-permissions', t('commands.chat.options.dangerouslySkipPermissions'))
    .option('--permission-mode <mode>', t('commands.resume.options.permissionMode'))
    .option('--mode <mode>', t('commands.chat.options.mode'))
    .option('-l, --list', t('commands.resume.options.list'))
    .option('-a, --all', t('commands.resume.options.all'))
    .action(async (sessionId: string | undefined, options) => {
      const cwd = process.cwd();

      // 如果指定了 --list 选项，显示可恢复的会话列表
      if (options.list) {
        console.log(`\n🔍 ${t('commands.resume.list.searching')}\n`);

        const sessionIndex = createSessionIndex();
        let sessions: SessionSummary[];

        if (options.all) {
          // 显示所有会话
          sessions = await sessionIndex.listSessions();
        } else {
          // 只显示可恢复的会话
          sessions = await sessionIndex.listSessions();
        }

        displayResumableSessions(sessions);
        return;
      }

      // 装配 FileSink + Logger（默认 info；debug 路径见下）
      initializeFileSinkFromEnv({ cwd, env: process.env });

      const explicitPermissionMode = options.dangerouslySkipPermissions
        ? 'bypass_permissions'
        : options.permissionMode;

      // 初始化运行时（复用入口缓存的配置，消除手动重造 runtime 的重复）
      // mode：--mode 启动参数（收窄为 single/multi）只影响 agentMode，不碰 RuntimeMode
      const runtime = await initializeRuntime({
        cwd,
        roleName: options.role,
        providerName: options.provider,
        env: process.env,
        mode: resolveAgentMode(options.mode),
        permissionMode: explicitPermissionMode,
      });
      const { loadedSettings, resolvedRuntime } = runtime;

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

      // 验证会话状态
      const validation = validateSessionForResume(sessionToResume);
      if (!validation.valid) {
        console.error(`\n❌ 无法恢复会话: ${validation.reason}`);
        process.exit(1);
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
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? 'interactive' : 'classic';

      // debug 启用时升 Logger level（FileSink 已装配）
      if (debug) {
        enableDebugLog();
      }

      try {
        if (options.message?.trim()) {
          // 单次消息模式
          const input$ = createSingleTurnInput(options.message, 'message');

          const run = startAgentLoop({
            input$,
            runtime,
            cwd,
            mode: 'single',
            maxStepsPerTurn,
            prompt: resolvedRuntime.prompt,
            debug,
            existingSession: resumedSession,
            initialHistory: history,
          });

          const work: Promise<void>[] = [renderRuntimeEvents(run.events$, { style: renderStyle })];

          attachDebugTrace(work, run.debug$, {
            debug,
            debugFormat,
            cwd,
            projectConfigDir: loadedSettings.projectConfigDir,
          });

          await Promise.all(work);
        } else {
          // 交互模式（带 ask-user 输入桥接，与 chat 交互模式一致）
          const inputSubject = new Subject<ChatInputTurn>();
          const userInputBridge = new UserInputBridge();

          const run = startAgentLoop({
            input$: inputSubject.asObservable(),
            runtime,
            cwd,
            mode: 'interactive',
            maxStepsPerTurn,
            prompt: resolvedRuntime.prompt,
            debug,
            userInputBridge,
            existingSession: resumedSession,
            initialHistory: history,
          });

          const inputAdapter = new CliInputAdapter({
            skillExecutor: runtime.skillExecutor,
            userInputBridge,
            permissionGate: runtime.permissionGate,
          });

          const work: Promise<void>[] = [
            renderRuntimeEvents(run.events$, {
              onTurnComplete: () => inputAdapter.prompt(),
              style: renderStyle,
            }),
          ];

          attachDebugTrace(work, run.debug$, {
            debug,
            debugFormat,
            cwd,
            projectConfigDir: loadedSettings.projectConfigDir,
          });

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
        await stopRuntimeAgents(runtime);
      }
    });
}
