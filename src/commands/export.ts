import { Command } from 'commander';

import { t } from '@locales/index.js';
import { createSessionIndex, type SessionDetail } from '@core/runtime/session-index.js';

/**
 * 把 session.jsonl 转换为 markdown 格式。
 * @param session - 会话详情
 * @returns markdown 字符串
 */
function sessionToMarkdown(session: SessionDetail): string {
  const lines: string[] = [];
  lines.push(`# ${sessionIdToTitle(session)}`);
  lines.push('');
  lines.push(`- **Session ID**: \`${session.id}\``);
  lines.push(`- **Created**: ${session.createdAt}`);
  lines.push(`- **Updated**: ${session.updatedAt}`);
  lines.push(`- **Messages**: ${session.messageCount}`);
  lines.push('');

  let currentRole = '';
  for (const record of session.records) {
    if (record.type !== 'message') continue;
    if (record.role !== currentRole) {
      lines.push(`## ${record.role === 'user' ? 'User' : 'Assistant'}`);
      lines.push('');
      currentRole = record.role;
    }
    lines.push(record.content);
    lines.push('');
  }
  return lines.join('\n');
}

function sessionIdToTitle(session: SessionDetail): string {
  // 用首条 user message 标题，没有则用 ID
  const firstUser = session.records.find(
    (r) => r.type === 'message' && r.role === 'user'
  );
  if (firstUser && firstUser.type === 'message') {
    const title = firstUser.content.split('\n')[0].slice(0, 60);
    return title || session.id;
  }
  return session.id;
}

/**
 * `wasteland export` 命令
 *
 * 将本地 session.jsonl 转换为 markdown 输出到 stdout。
 * 默认导出最新 session；可用 `wasteland export <session-id>` 指定。
 */
export function createExportCommand(): Command {
  return new Command('export')
    .description(t('commands.export.description'))
    .argument('[session-id]', t('commands.export.options.sessionId'))
    .action(async (sessionId?: string) => {
      const sessionIndex = createSessionIndex();

      let session: SessionDetail | null;
      if (sessionId) {
        session = await sessionIndex.getSession(sessionId);
        if (!session) {
          console.error(`${t('commands.export.notFound')} ${sessionId}`);
          process.exit(1);
        }
      } else {
        session = await sessionIndex.getLatestSession();
        if (!session) {
          console.error(t('commands.export.noSession'));
          process.exit(1);
        }
      }

      const md = sessionToMarkdown(session);
      console.log(md);
    });
}
