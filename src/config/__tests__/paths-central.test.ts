import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveProjectId,
  getCurrentProjectId,
  GLOBAL_PROJECT_ID,
  resetCurrentProjectId,
  resolveDataProjectId,
  resolveDefaultDataDir,
  resolveDefaultExportDir,
  resolveDefaultLogDir,
  resolveDefaultSessionDir,
  setCurrentProjectId,
  WASTELAND_DATA_DIR_ENV,
  WASTELAND_HOME_ENV,
} from '../paths.js';

afterEach(() => {
  resetCurrentProjectId();
});

describe('deriveProjectId', () => {
  it('git root hash 原样返回（小写归一）', () => {
    const hash = 'A'.repeat(40);
    expect(deriveProjectId({ cwd: '/repo', gitRootHash: hash })).toBe('a'.repeat(40));
  });

  it('无 hash 回退 local-<sha1>（16 位）', () => {
    const id = deriveProjectId({ cwd: '/some/dir' });
    expect(id).toMatch(/^local-[0-9a-f]{16}$/);
    expect(deriveProjectId({ cwd: '/some/dir' })).toBe(id);
  });

  it('非法 hash 视为缺失', () => {
    expect(deriveProjectId({ cwd: '/x', gitRootHash: 'zzz' })).toMatch(/^local-/);
  });

  it('两者皆无进 global 桶', () => {
    expect(deriveProjectId({ cwd: '' })).toBe(GLOBAL_PROJECT_ID);
  });
});

describe('current project cache', () => {
  it('set/get/reset 隔离', () => {
    expect(getCurrentProjectId()).toBeNull();
    setCurrentProjectId('abc');
    expect(getCurrentProjectId()).toBe('abc');
    resetCurrentProjectId();
    expect(getCurrentProjectId()).toBeNull();
  });
});

describe('中央数据根路由', () => {
  const cwd = '/repo';
  const pid = 'local-0123456789abcdef';

  it('resolveDefaultDataDir 默认 <home>/data，env 可覆盖', () => {
    expect(resolveDefaultDataDir({ cwd, env: { WASTELAND_HOME: '/home/u' } as NodeJS.ProcessEnv })).toBe(
      '/home/u/data'
    );
    expect(
      resolveDefaultDataDir({
        cwd,
        env: { WASTELAND_HOME: '/home/u', [WASTELAND_DATA_DIR_ENV]: '/tmp/d' } as NodeJS.ProcessEnv,
      })
    ).toBe('/tmp/d');
  });

  it('log/session/export 按 projectID 隔离（缓存优先）', () => {
    setCurrentProjectId(pid);
    const env = { WASTELAND_HOME: '/home/u' } as NodeJS.ProcessEnv;
    expect(resolveDefaultLogDir({ cwd, projectConfigDir: '/repo/.wasteland', env })).toBe(
      `/home/u/data/logs/${pid}`
    );
    expect(resolveDefaultSessionDir({ cwd, projectConfigDir: '/repo/.wasteland', env })).toBe(
      `/home/u/data/sessions/${pid}`
    );
    expect(resolveDefaultExportDir({ cwd, projectConfigDir: '/repo/.wasteland', env })).toBe(
      `/home/u/data/exports/${pid}`
    );
  });

  it('无缓存回退路径 hash（行为确定）', () => {
    const env = { WASTELAND_HOME: '/home/u' } as NodeJS.ProcessEnv;
    const expected = deriveProjectId({ cwd });
    expect(resolveDefaultLogDir({ cwd, projectConfigDir: null, env })).toBe(
      `/home/u/data/logs/${expected}`
    );
  });

  it('WASTELAND_LOG_DIR / SESSION_DIR 调试覆盖保留', () => {
    const env = {
      WASTELAND_HOME: '/home/u',
      WASTELAND_LOG_DIR: '/tmp/logs',
      WASTELAND_SESSION_DIR: '/tmp/sess',
    } as NodeJS.ProcessEnv;
    setCurrentProjectId(pid);
    expect(resolveDefaultLogDir({ cwd, projectConfigDir: null, env })).toBe('/tmp/logs');
    expect(resolveDefaultSessionDir({ cwd, projectConfigDir: null, env })).toBe('/tmp/sess');
  });

  it('resolveDataProjectId 兼容旧签名', () => {
    expect(resolveDataProjectId(cwd, null)).toMatch(/^local-/);
    setCurrentProjectId(pid);
    expect(resolveDataProjectId(cwd, '/repo/.wasteland')).toBe(pid);
  });
});
