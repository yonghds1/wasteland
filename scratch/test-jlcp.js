import { listSessions, loadSessionEntries } from '../dist/core/logger/file-log-loader.js';
import { resolve } from 'path';

(async () => {
  const dir = resolve(process.env.HOME, 'jlcp', '.wasteland', 'logs');
  const sessions = await listSessions({ dir });
  console.log('sessions found:', sessions.length);
  if (sessions.length > 0) {
    const s = sessions[0];
    const entries = await loadSessionEntries({ dir, sessionId: s.sessionId });
    console.log('entries for', s.sessionId, ':', entries.length);
  }
})();
