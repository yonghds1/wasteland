import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModule, resolveTrusted, resolveUserPath, scanManifests } from '../loader.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? '';
  }
  throw new Error('expected function to throw');
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected function to throw');
}

async function makeDirs(): Promise<{ root: string; globalDir: string; projectDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'wasteland-loader-'));
  const globalDir = join(root, 'global');
  const projectDir = join(root, 'proj');
  await mkdir(globalDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  return { root, globalDir, projectDir };
}

describe('loader scanManifests', () => {
  it('同名时项目 manifest 覆盖全局', async () => {
    const { globalDir, projectDir } = await makeDirs();
    await writeFile(join(globalDir, 'deploy.ts'), 'export const v = 1;\n');
    await writeFile(join(globalDir, 'only-global.ts'), 'export const v = 1;\n');
    await writeFile(join(projectDir, 'deploy.ts'), 'export const v = 2;\n');
    const manifests = await scanManifests([
      { dir: globalDir, scope: 'global' },
      { dir: projectDir, scope: 'project' },
    ]);
    const deploy = resolveTrusted('deploy', manifests);
    expect(deploy.scope).toBe('project');
    expect(deploy.path).toBe(join(projectDir, 'deploy.ts'));
    expect(manifests.filter((m) => m.name === 'deploy')).toHaveLength(1);
    expect(resolveTrusted('only-global', manifests).scope).toBe('global');
  });

  it('缺失目录视为空信任源，未知 name 抛 E_WORKFLOW_NOT_FOUND', async () => {
    const { globalDir } = await makeDirs();
    const manifests = await scanManifests([
      { dir: join(globalDir, 'no-such-dir'), scope: 'global' },
    ]);
    expect(manifests).toEqual([]);
    expect(codeOf(() => resolveTrusted('missing', manifests))).toBe(
      'E_WORKFLOW_NOT_FOUND',
    );
  });

  it('文件内容变化导致 manifest 版本变化', async () => {
    const { projectDir } = await makeDirs();
    const file = join(projectDir, 'flow.ts');
    await writeFile(file, 'export const v = 1;\n');
    const [before] = await scanManifests([{ dir: projectDir, scope: 'project' }]);
    await writeFile(file, 'export const v = 2;\n');
    const [after] = await scanManifests([{ dir: projectDir, scope: 'project' }]);
    expect(before.version).toMatch(/^[0-9a-f]{64}$/);
    expect(after.version).toMatch(/^[0-9a-f]{64}$/);
    expect(after.version).not.toBe(before.version);
  });

  it('*.workflow.js 注册名为去后缀部分', async () => {
    const { projectDir } = await makeDirs();
    await writeFile(join(projectDir, 'review.workflow.js'), 'export const v = 1;\n');
    const manifests = await scanManifests([{ dir: projectDir, scope: 'project' }]);
    expect(resolveTrusted('review', manifests).path).toBe(
      join(projectDir, 'review.workflow.js'),
    );
  });

  it('loadModule 在 submit 后真实 import', async () => {
    const { projectDir } = await makeDirs();
    const file = join(projectDir, 'hello.mjs');
    await writeFile(file, 'export const answer = 42;\n');
    const mod = (await loadModule({ path: file })) as { answer: number };
    expect(mod.answer).toBe(42);
  });
});

describe('resolveUserPath', () => {
  it('拦截 .. 并在 message 注明越界', async () => {
    const { projectDir } = await makeDirs();
    expect(codeOf(() => resolveUserPath('../evil.ts', projectDir))).toBe(
      'E_WORKFLOW_NOT_FOUND',
    );
    expect(messageOf(() => resolveUserPath('../evil.ts', projectDir))).toMatch(/越界/);
    expect(codeOf(() => resolveUserPath('a/../../evil.ts', projectDir))).toBe(
      'E_WORKFLOW_NOT_FOUND',
    );
    expect(codeOf(() => resolveUserPath('..', projectDir))).toBe(
      'E_WORKFLOW_NOT_FOUND',
    );
  });

  it('拦截跳出 cwd 的绝对路径，放行 cwd 内路径', async () => {
    const { root, projectDir } = await makeDirs();
    expect(
      codeOf(() => resolveUserPath(join(root, 'evil.ts'), projectDir)),
    ).toBe('E_WORKFLOW_NOT_FOUND');
    expect(resolveUserPath('flows/a.ts', projectDir)).toBe(
      join(projectDir, 'flows', 'a.ts'),
    );
    expect(
      resolveUserPath(join(projectDir, 'flows', 'a.ts'), projectDir),
    ).toBe(join(projectDir, 'flows', 'a.ts'));
  });
});
