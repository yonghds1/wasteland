/**
 * sessions.ts - Sessions 命令
 *
 * 列出本地 session，支持搜索和过滤。
 */

import { Command } from 'commander';
import { createSessionIndex, type SessionSummary } from '../core/runtime/session-index.js';
import { t, getLanguage } from '../locales/index.js';

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
    const date = new Date(dateStr);
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
 * 格式化 session 列表
 */
function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return t('commands.sessions.list.empty', { count: '0' });
  }

  const lines: string[] = [];

  for (const session of sessions) {
    const id = session.id;
    const date = formatDateTime(session.createdAt);
    const messages = `${session.messageCount} ${t('commands.sessions.show.messages')}`;
    const provider = session.providerId || t('commands.sessions.unknown');
    const preview = truncate(session.firstUserMessage, 50);

    lines.push(`  ${id}`);
    lines.push(`    ${t('commands.sessions.show.time')} ${date}`);
    lines.push(`    ${t('commands.sessions.show.messages')}: ${messages}`);
    lines.push(`    Provider: ${provider}`);

    if (preview) {
      lines.push(`    ${t('commands.sessions.show.preview')}: ${preview}`);
    }

    if (session.hasChildren) {
      lines.push(`    ${t('commands.sessions.show.subAgent')}: ${session.childNames.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 格式化 session 详情
 */
function formatSessionDetail(session: any): string {
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
    .action(async (options) => {
      try {
        const sessionIndex = createSessionIndex();

        const sessions = await sessionIndex.listSessions({
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
    .action(async (sessionId: string, options: any) => {
      try {
        const sessionIndex = createSessionIndex();
        const session = await sessionIndex.getSession(sessionId);

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
    .action(async (sessionId: string, options: any) => {
      try {
        if (!options.confirm) {
          console.log(t('commands.sessions.delete.confirmRequired'));
          return;
        }

        const sessionIndex = createSessionIndex();
        const success = await sessionIndex.deleteSession(sessionId);

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
    .action(async (options: any) => {
      try {
        const sessionIndex = createSessionIndex();
        const stats = await sessionIndex.getStats();

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\n${t('commands.sessions.stats.title')}`);
          console.log('─'.repeat(40));
          console.log(`${t('commands.sessions.stats.totalSessions')} ${stats.totalSessions}`);
          console.log(`${t('commands.sessions.stats.totalMessages')} ${stats.totalMessages}`);

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
