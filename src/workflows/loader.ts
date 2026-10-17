import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkflowErrorCode } from './errors.js';

export type WorkflowScope = 'global' | 'project';

export interface WorkflowManifest {
  name: string;
  version: string;
  path: string;
  scope: WorkflowScope;
}

export interface ManifestScanDir {
  dir: string;
  scope: WorkflowScope;
}

export type ManifestHandle = Pick<WorkflowManifest, 'path'>;

const WORKFLOW_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.mts']);

class WorkflowLoaderError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowLoaderError';
    this.code = code;
  }
}

function fail(code: WorkflowErrorCode, message: string): never {
  throw new WorkflowLoaderError(code, message);
}

function manifestNameOf(filename: string): string | null {
  if (filename.startsWith('.')) return null;
  const ext = extname(filename);
  if (!WORKFLOW_EXTS.has(ext)) return null;
  let name = basename(filename, ext);
  // 约定：*.workflow.js 的注册名为去后缀部分（review.workflow.js → review）
  if (name.endsWith(".workflow")) name = name.slice(0, -".workflow".length);
  if (name.length === 0) return null;
  return name;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 扫描信任目录并生成 manifest。
 * 只读文件内容做 sha256 版本指纹，不执行任何代码。
 * dirs 按优先级升序传入（全局在前、项目在后），同名后者覆盖前者。
 */
export async function scanManifests(
  dirs: readonly ManifestScanDir[],
): Promise<WorkflowManifest[]> {
  const merged = new Map<string, WorkflowManifest>();
  for (const { dir, scope } of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = manifestNameOf(entry);
      if (name === null) continue;
      const abs = resolve(dir, entry);
      let raw: Buffer;
      try {
        raw = await readFile(abs);
      } catch {
        continue;
      }
      merged.set(name, { name, version: sha256Hex(raw), path: abs, scope });
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/** name 引用走信任路径：只在已扫描 manifest 中解析。 */
export function resolveTrusted(
  name: string,
  manifests: readonly WorkflowManifest[],
): WorkflowManifest {
  const found = manifests.find((m) => m.name === name);
  if (!found) {
    fail('E_WORKFLOW_NOT_FOUND', `unknown trusted workflow: ${name}`);
  }
  return found;
}

/**
 * 用户直传 scriptPath 解析。
 * 含 `..` 片段或解析后跳出 cwd 的一律视为越界，
 * 统一抛 E_WORKFLOW_NOT_FOUND（message 注明越界）。
 */
export function resolveUserPath(p: string, cwd: string): string {
  if (!p || p.trim().length === 0) {
    fail('E_WORKFLOW_NOT_FOUND', 'empty workflow path');
  }
  const segments = p.split(/[\\/]+/);
  if (segments.includes('..')) {
    fail(
      'E_WORKFLOW_NOT_FOUND',
      `workflow path escapes cwd (.. detected, 越界拦截): ${p}`,
    );
  }
  const base = resolve(cwd);
  const abs = isAbsolute(p) ? normalize(p) : resolve(base, p);
  const rel = relative(base, abs);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(
      'E_WORKFLOW_NOT_FOUND',
      `workflow path escapes cwd (越界拦截): ${p}`,
    );
  }
  return abs;
}

/**
 * 真正的模块 import（发生在 submit 后）。
 * 调用方须先经 resolveTrusted / resolveUserPath 拿到合法路径。
 */
export async function loadModule(handle: ManifestHandle): Promise<unknown> {
  if (!handle || typeof handle.path !== 'string' || handle.path.length === 0) {
    fail('E_WORKFLOW_NOT_FOUND', 'empty workflow module path');
  }
  const url = pathToFileURL(resolve(handle.path)).href;
  return import(url);
}

export function defaultGlobalDir(): string {
  return join(homedir(), '.wasteland', 'workflows');
}

export function defaultProjectDir(cwd: string): string {
  return join(resolve(cwd), '.wasteland', 'workflows');
}
