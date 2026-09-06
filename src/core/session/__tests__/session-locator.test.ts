import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getTranscriptAcrossProjects,
  listKnownProjects,
  listTranscriptsAllProjects,
  matchProjectOption,
  resolveProjectOption,
} from '../session-locator.js';

let tmpRoot = '';

async function makeRoot(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wasteland-locator-test-'));
  return tmpRoot;
}

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

async function seedTranscript(root: string, pid: string, sid: string, userText: string): Promise<void> {
  await mkdir(join(root, 'sessions', pid), { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session', id: sid, provider: 'local', mode: 'single', cwd: '/repo' }),
    JSON.stringify({ type: 'message', role: 'user', content: userText }),
  ];
  await writeFile(join(root, 'sessions', pid, `${sid}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

describe('matchProjectOption', () => {
  const projects = [
    { id: 'abc123', worktree: '/home/u/repo-a' },
    { id: 'def456', worktree: '/home/u/repo-b' },
  ];

  it('id 精确匹配优先', () => {
    expect(matchProjectOption(projects, 'abc123')).toBe('abc123');
  });

  it('worktree 精确与后缀匹配', () => {
    expect(matchProjectOption(projects, '/home/u/repo-b')).toBe('def456');
    expect(matchProjectOption(projects, 'repo-a')).toBe('abc123');
  });

  it('空输入与未知返回 null', () => {
    expect(matchProjectOption(projects, '  ')).toBeNull();
    expect(matchProjectOption(projects, 'nope')).toBeNull();
  });
});

describe('跨项目 transcript 定位', () => {
  it('聚合列出多项目并按 ID 定位', async () => {
    const root = await makeRoot();
    await seedTranscript(root, 'proj-a', '2026-09-06_100000_aaaaaa', 'hello a');
    await seedTranscript(root, 'proj-b', '2026-09-06_110000_bbbbbb', 'hello b');
    await mkdir(join(root, 'project'), { recursive: true });
    await writeFile(
      join(root, 'project', 'proj-a.json'),
      JSON.stringify({ id: 'proj-a', vcs: 'none', worktree: '/a', created: '' }),
      'utf8'
    );

    expect(await listKnownProjects(root)).toEqual([
      { id: 'proj-a', worktree: '/a' },
      { id: 'proj-b', worktree: 'proj-b' },
    ]);
    expect(await resolveProjectOption(root, 'proj-b')).toBe('proj-b');
    expect(await resolveProjectOption(root, undefined)).toBeNull();

    const all = await listTranscriptsAllProjects(root, undefined, { currentProjectId: 'proj-b' });
    expect(all.map((s) => s.summary.id)).toEqual([
      '2026-09-06_110000_bbbbbb',
      '2026-09-06_100000_aaaaaa',
    ]);
    expect(all[0]).toMatchObject({ projectId: 'proj-b' });

    const found = await getTranscriptAcrossProjects(root, '2026-09-06_100000_aaaaaa');
    expect(found?.projectId).toBe('proj-a');
    expect(found?.detail.records.length).toBeGreaterThan(0);
    expect(await getTranscriptAcrossProjects(root, 'missing')).toBeNull();
  });
});
