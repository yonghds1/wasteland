import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyProjectId,
  ensureDataRoot,
  listAllSessions,
  listProjectIds,
  locateSession,
  readProjectMeta,
  writeProjectMeta,
  DATA_VERSION,
} from '../data-store.js';

let tmpRoot = '';

async function makeRoot(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wasteland-data-test-'));
  return tmpRoot;
}

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

async function seedSession(root: string, pid: string, sid: string): Promise<void> {
  await mkdir(join(root, 'logs', pid, 'sessions'), { recursive: true });
  await mkdir(join(root, 'sessions', pid), { recursive: true });
  const line = JSON.stringify({
    version: 1,
    sessionId: sid,
    level: 'info',
    scope: 'turn',
    timestamp: '2026-09-06T10:00:00.000Z',
    message: 'hi',
  });
  await writeFile(join(root, 'logs', pid, 'sessions', `${sid}.jsonl`), line + '\n', 'utf8');
  await writeFile(join(root, 'sessions', pid, `${sid}.jsonl`), line + '\n', 'utf8');
}

describe('classifyProjectId', () => {
  it('40 位 hex 为 git，其余 none', () => {
    expect(classifyProjectId('a'.repeat(40))).toBe('git');
    expect(classifyProjectId('local-0123456789abcdef')).toBe('none');
    expect(classifyProjectId('global')).toBe('none');
  });
});

describe('ensureDataRoot', () => {
  it('幂等并写入版本', async () => {
    const root = await makeRoot();
    const dataRoot = join(root, 'data');
    await ensureDataRoot(dataRoot);
    await ensureDataRoot(dataRoot);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(dataRoot, 'migration'), 'utf8')).toBe(String(DATA_VERSION));
  });
});

describe('project meta', () => {
  it('写后可读，缺失回 null', async () => {
    const root = await makeRoot();
    await writeProjectMeta(root, { id: 'pid-1', vcs: 'none', worktree: '/repo' });
    expect(await readProjectMeta(root, 'pid-1')).toMatchObject({
      id: 'pid-1',
      vcs: 'none',
      worktree: '/repo',
    });
    expect(await readProjectMeta(root, 'missing')).toBeNull();
  });
});

describe('listProjectIds / listAllSessions / locateSession', () => {
  it('聚合多项目并定位 session', async () => {
    const root = await makeRoot();
    await seedSession(root, 'proj-a', 'sess-1');
    await seedSession(root, 'proj-b', 'sess-2');
    await writeProjectMeta(root, { id: 'proj-a', vcs: 'none', worktree: '/a' });

    expect(await listProjectIds(root)).toEqual(['proj-a', 'proj-b']);

    const all = await listAllSessions(root);
    expect(all.length).toBe(2);
    const tagged = all.find((s) => s.sessionId === 'sess-1');
    expect(tagged).toMatchObject({ projectId: 'proj-a', worktree: '/a' });
    expect(all.find((s) => s.sessionId === 'sess-2')).toMatchObject({
      projectId: 'proj-b',
      worktree: 'proj-b',
    });

    const loc = await locateSession(root, 'sess-2');
    expect(loc?.projectId).toBe('proj-b');
    expect(loc?.transcriptFile).toContain(join('sessions', 'proj-b', 'sess-2.jsonl'));
    expect(await locateSession(root, 'nope')).toBeNull();
    expect(await locateSession(root, '../evil')).toBeNull();
  });
});
