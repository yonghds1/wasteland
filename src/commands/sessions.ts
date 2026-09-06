/**
 * sessions.ts - Sessions 命令
 *
 * 列出本地 session，支持搜索和过滤。
 *
 * ## 增强功能
 *
 * - 支持交互式选择会话
 * - 支持会话切换
 * - 支持会话重命名
 * - 支持批量操作
 */

import { join } from 'node:path';
import { Command } from 'commander';
import { createSessionIndex, type SessionDetail, type SessionSummary } from '@core/session/session-index.js';
import {
  getTranscriptAcrossProjects,
  listTranscriptsAllProjects,
  resolveProjectOption,
  type ProjectSessionSummary,
} from '@core/session/session-locator.js';
import { resolveDefaultDataDir } from '@config/paths.js';
import { t, getLanguage } from '@locales/index.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr: string): string {
  if (!dateStr) {
    return t('commands.sessions.unknown');
  }

  try {
    // 处理 "2026-06-03 20:47:24" 格式（添加 T 以便正确解析）
    const normalizedDateStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
    const date = new Date(normalizedDateStr);

    if (isNaN(date.getTime())) {
      return dateStr;
    }

    const lang = getLanguage();
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * 截断文本
 */
function truncate(text: string | undefined, maxLength: number): string {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
}

/**
 * 格式化 session 列表（聚合项带项目归属行）。
 */
function formatSessionList(sessions: SessionSummary[] | ProjectSessionSummary[]): string {
  if (sessions.length === 0) {
    return t('commands.sessions.list.empty', { count: '0' });
  }

  const lines: string[] = [];

  for (const session of sessions) {
    const wrapped = 'summary' in session ? session.summary : session;
    const project = 'summary' in session ? session : null;
    const id = wrapped.id;
    const date = formatDateTime(wrapped.createdAt);
    const messages = `${wrapped.messageCount} ${t('commands.sessions.show.messages')}`;
    const provider = wrapped.providerId || t('commands.sessions.unknown');
    const preview = truncate(wrapped.firstUserMessage, 50);

    lines.push(`  ${id}`);
    lines.push(`    ${t('commands.sessions.show.time')} ${date}`);
    lines.push(`    ${t('commands.sessions.show.messages')}: ${messages}`);
    lines.push(`    Provider: ${provider}`);
    if (project) {
      lines.push(`    ${t('commands.sessions.show.project')}: ${project.worktree}`);
    }

    if (preview) {
      lines.push(`    ${t('commands.sessions.show.preview')}: ${preview}`);
    }

    if (wrapped.hasChildren) {
      lines.push(`    ${t('commands.sessions.show.subAgent')}: ${wrapped.childNames.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 格式化 session 详情
 */
function formatSessionDetail(session: SessionDetail): string {
  const lines: string[] = [];

  lines.push(`Session: ${session.id}`);
  lines.push(`${t('commands.sessions.show.time')} ${formatDateTime(session.createdAt)}`);
  lines.push(`${t('commands.sessions.stats.totalMessages')} ${session.messageCount}`);
  lines.push(`Provider: ${session.providerId || t('commands.sessions.unknown')}`);
  lines.push(
    `${t('commands.sessions.show.mode')}: ${session.mode || t('commands.sessions.unknown')}`
  );
  lines.push(
    `${t('commands.sessions.show.cwd')}: ${session.cwd || t('commands.sessions.unknown')}`
  );
  lines.push('');

  if (session.hasChildren) {
    lines.push(`${t('commands.sessions.show.subAgent')}: ${session.childNames.join(', ')}`);
    lines.push('');
  }

  if (session.compactionStats) {
    const { count, summarizedCount, syncCount, tokensSaved } = session.compactionStats;
    lines.push(`${t('commands.sessions.show.compaction')}:`);
    lines.push(
      `  ${t('commands.sessions.show.compactionCount')}: ${count} (${t(
        'commands.sessions.show.compactionSummarized'
      )} ${summarizedCount} / ${t('commands.sessions.show.compactionSync')} ${syncCount})`
    );
    lines.push(`  ${t('commands.sessions.show.compactionTokensSaved')}: ${tokensSaved}`);
    lines.push('');
  }

  lines.push(`${t('commands.sessions.show.messages')}:`);
  lines.push('─'.repeat(60));

  for (const record of session.records) {
    if (record.type === 'message') {
      const role =
        record.role === 'user'
          ? t('commands.sessions.show.user')
          : t('commands.sessions.show.assistant');
      const content = truncate(record.content, 200);
      lines.push(`[${role}] ${content}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================
// 命令定义
// ============================================================

/**
 * 创建 sessions 命令
 */
export function createSessionsCommand(): Command {
  const command = new Command('sessions')
    .description(t('commands.sessions.list.description'))
    .option('-l, --limit <number>', t('commands.sessions.list.options.limit'), '20')
    .option('-s, --search <query>', t('commands.sessions.list.options.search'))
    .option('-p, --provider <name>', t('commands.sessions.list.options.provider'))
    .option('-m, --mode <name>', t('commands.sessions.list.options.mode'))
    .option(
      '--sort <order>',
      t('commands.sessions.list.options.sort') + ' (newest/oldest)',
      'newest'
    )
    .option('--json', t('commands.sessions.list.options.json'))
    .option('--project <id|path>', t('commands.sessions.list.options.project'))
    .action(async (options) => {
      try {
        // 中央数据根聚合：默认全项目，--project 收窄（本项目置顶由 locator 负责）
        const dataRoot = resolveDefaultDataDir({ cwd: process.cwd() });
        let projectIds: string[] | undefined;
        if (options.project?.trim()) {
          const resolved = await resolveProjectOption(dataRoot, options.project);
          if (!resolved) {
            console.error(t('commands.sessions.list.unknownProject', { id: options.project }));
            process.exit(1);
          }
          projectIds = [resolved];
        }

        const sessions = await listTranscriptsAllProjects(dataRoot, projectIds, {
          limit: parseInt(options.limit, 10),
          search: options.search,
          provider: options.provider,
          mode: options.mode,
          sort: options.sort as 'newest' | 'oldest',
        });

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          console.log(
            `\n${t('commands.sessions.list.found', { count: String(sessions.length) })}\n`
          );
          console.log(formatSessionList(sessions));
        }
      } catch (error) {
        console.error(
          t('commands.sessions.list.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
        process.exit(1);
      }
    });

  // 添加子命令：查看 session 详情
  command
    .command('show <session-id>')
    .description(t('commands.sessions.show.description'))
    .option('--json', t('commands.sessions.show.options.json'))
    .action(async (sessionId: string, options) => {
      try {
        const sessionIndex = createSessionIndex();
        let session = await sessionIndex.getSession(sessionId);

        // 本项目未命中 → 跨项目定位（中央数据根）
        if (!session) {
          const dataRoot = resolveDefaultDataDir({ cwd: process.cwd() });
          const found = await getTranscriptAcrossProjects(dataRoot, sessionId);
          session = found?.detail ?? null;
        }

        if (!session) {
          console.error(t('commands.sessions.show.notFound', { id: sessionId }));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          console.log(formatSessionDetail(session));
        }
      } catch (error) {
        console.error(
          t('commands.sessions.show.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
        process.exit(1);
      }
    });

  // 添加子命令：删除 session
  command
    .command('delete <session-id>')
    .description(t('commands.sessions.delete.description'))
    .option('--confirm', t('commands.sessions.delete.options.confirm'))
    .action(async (sessionId: string, options) => {
      try {
        if (!options.confirm) {
          console.log(t('commands.sessions.delete.confirmRequired'));
          return;
        }

        const sessionIndex = createSessionIndex();
        let success = await sessionIndex.deleteSession(sessionId);

        // 本项目未命中 → 跨项目定位后在归属目录删除
        if (!success) {
          const dataRoot = resolveDefaultDataDir({ cwd: process.cwd() });
          const found = await getTranscriptAcrossProjects(dataRoot, sessionId);
          if (found) {
            success = await createSessionIndex(
              join(dataRoot, 'sessions', found.projectId)
            ).deleteSession(sessionId);
          }
        }

        if (success) {
          console.log(t('commands.sessions.delete.deleted', { id: sessionId }));
        } else {
          console.error(t('commands.sessions.delete.error', { error: sessionId }));
          process.exit(1);
        }
      } catch (error) {
        console.error(
          t('commands.sessions.delete.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
        process.exit(1);
      }
    });

  // 添加子命令：统计信息
  command
    .command('stats')
    .description(t('commands.sessions.stats.description'))
    .option('--json', t('commands.sessions.stats.options.json'))
    .action(async (options) => {
      try {
        // 全项目聚合统计
        const dataRoot = resolveDefaultDataDir({ cwd: process.cwd() });
        const all = await listTranscriptsAllProjects(dataRoot, undefined, { limit: 100000 });
        const times = all.map((s) => s.summary.createdAt).filter(Boolean).sort();
        const stats = {
          totalSessions: all.length,
          oldestSession: times[0],
          newestSession: times[times.length - 1],
        };

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\n${t('commands.sessions.stats.title')}`);
          console.log('─'.repeat(40));
          console.log(`${t('commands.sessions.stats.totalSessions')} ${stats.totalSessions}`);

          if (stats.oldestSession) {
            console.log(
              `${t('commands.sessions.stats.earliest')} ${formatDateTime(stats.oldestSession)}`
            );
          }

          if (stats.newestSession) {
            console.log(
              `${t('commands.sessions.stats.latest')} ${formatDateTime(stats.newestSession)}`
            );
          }

          console.log('');
        }
      } catch (error) {
        console.error(
          t('commands.sessions.stats.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
        process.exit(1);
      }
    });


  return command;
}
