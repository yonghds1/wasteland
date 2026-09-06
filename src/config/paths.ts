import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const WASTELAND_DIRNAME = '.wasteland';
export const SETTINGS_FILENAME = 'settings.json';
export const AUTH_FILENAME = 'auth.json';
export const SESSIONS_DIRNAME = 'sessions';
export const WASTELAND_HOME_ENV = 'WASTELAND_HOME';
export const WASTELAND_SESSION_DIR_ENV = 'WASTELAND_SESSION_DIR';
export const WASTELAND_DATA_DIR_ENV = 'WASTELAND_DATA_DIR';
// 中央数据根目录名（OpenCode 模式：单根 + projectID 命名空间，见 09-06-central-log-store）。
export const DATA_DIRNAME = 'data';
export const PROJECT_DIRNAME = 'project';
export const DATA_MIGRATION_FILENAME = 'migration';
// 非 git 目录的 projectID（与 OpenCode 的 "global" 桶一致）。
export const GLOBAL_PROJECT_ID = 'global';
// Legacy env vars (kept for backward compatibility, not exported)
const LEGACY_JOE_HOME_ENV = 'JOE_HOME';
const LEGACY_JOE_SESSION_DIR_ENV = 'JOE_SESSION_DIR';
const LEGACY_RX_CLI_SESSION_DIR_ENV = 'RX_CLI_SESSION_DIR';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveEnvPath(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return resolve(value);
  }

  return null;
}

export function resolveUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configuredHome =
    resolveEnvPath(env, WASTELAND_HOME_ENV) ?? resolveEnvPath(env, LEGACY_JOE_HOME_ENV);

  if (configuredHome) {
    return configuredHome;
  }

  return resolve(homedir(), WASTELAND_DIRNAME);
}

export function resolveUserSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveUserConfigDir(env), SETTINGS_FILENAME);
}

export function resolveUserAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveUserConfigDir(env), AUTH_FILENAME);
}

export function resolveProjectSettingsPath(configDir: string): string {
  return join(configDir, SETTINGS_FILENAME);
}

export function resolveProjectAuthPath(configDir: string): string {
  return join(configDir, AUTH_FILENAME);
}

export async function findProjectConfigDir(startCwd: string): Promise<string | null> {
  let currentDir = resolve(startCwd);

  while (true) {
    const candidateDir = join(currentDir, WASTELAND_DIRNAME);
    const settingsPath = resolveProjectSettingsPath(candidateDir);
    const authPath = resolveProjectAuthPath(candidateDir);

    if ((await pathExists(settingsPath)) || (await pathExists(authPath))) {
      return candidateDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function resolveDefaultSessionDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;

  const sessionDirOverride = resolveSessionDirOverride(env);

  if (sessionDirOverride) {
    return sessionDirOverride;
  }

  // 中央数据根：transcript 按 projectID 隔离（绿地新做，不再写项目本地）。
  return join(
    resolveDefaultDataDir({ cwd: params.cwd, env }),
    SESSIONS_DIRNAME,
    resolveDataProjectId(params.cwd, params.projectConfigDir)
  );
}

export function resolveSessionDirOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    resolveEnvPath(env, WASTELAND_SESSION_DIR_ENV) ??
    resolveEnvPath(env, LEGACY_JOE_SESSION_DIR_ENV) ??
    resolveEnvPath(env, LEGACY_RX_CLI_SESSION_DIR_ENV)
  );
}

export const TRACES_DIRNAME = 'traces';
export const LOGS_DIRNAME = 'logs';
export const EXPORTS_DIRNAME = 'exports';

export function resolveDefaultTraceDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  if (params.projectConfigDir) {
    return join(params.projectConfigDir, TRACES_DIRNAME);
  }

  return join(resolveUserConfigDir(params.env), TRACES_DIRNAME);
}

export function resolveDefaultLogDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const raw = env.WASTELAND_LOG_DIR;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return resolve(params.cwd, raw.trim());
  }

  // 中央数据根：日志按 projectID 隔离（绿地新做，不再写项目本地）。
  return join(
    resolveDefaultDataDir({ cwd: params.cwd, env }),
    LOGS_DIRNAME,
    resolveDataProjectId(params.cwd, params.projectConfigDir)
  );
}

export function resolveDefaultExportDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  // 中央数据根：导出按 projectID 隔离。
  return join(
    resolveDefaultDataDir({ cwd: params.cwd, env: params.env }),
    EXPORTS_DIRNAME,
    resolveDataProjectId(params.cwd, params.projectConfigDir)
  );
}

// ============================================================
// 中央数据根 + projectID（09-06-central-log-store，OpenCode 模式）
// ============================================================

/**
 * 中央数据根目录。
 *
 * 优先级：`WASTELAND_DATA_DIR` 显式覆盖 > `WASTELAND_HOME/data`（经 resolveUserConfigDir）。
 * 注意 `WASTELAND_DATA_DIR` 按 cwd 解析相对路径，与 `WASTELAND_LOG_DIR` 语义一致。
 *
 * @param params.cwd - 当前工作目录（仅相对路径覆盖时用）
 * @param params.env - 环境变量（默认 process.env）
 */
export function resolveDefaultDataDir(params: { cwd: string; env?: NodeJS.ProcessEnv }): string {
  const env = params.env ?? process.env;
  const raw = env[WASTELAND_DATA_DIR_ENV];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return resolve(params.cwd, raw.trim());
  }
  return join(resolveUserConfigDir(env), DATA_DIRNAME);
}

export interface ProjectIdInput {
  /** 当前工作目录（回退路径 hash 用） */
  cwd: string;
  /** git root commit hash（40 位 hex），缺失时回退路径 hash */
  gitRootHash?: string | null;
}

/**
 * 纯 projectID 推导（可单测，不触 fs/子进程）。
 *
 * - 有 git root hash → 原样返回（目录改名稳定，与 OpenCode 一致）；
 * - 无 → `local-<sha1(resolve(cwd))[:16]>`，与 git hash 长度可区分；
 * - 两者皆无 → `global` 桶。
 */
export function deriveProjectId(input: ProjectIdInput): string {
  const hash = input.gitRootHash?.trim() ?? '';
  if (/^[0-9a-f]{40}$/i.test(hash)) {
    return hash.toLowerCase();
  }
  if (typeof input.cwd === 'string' && input.cwd.trim().length > 0) {
    return `local-${createHash('sha1').update(resolve(input.cwd)).digest('hex').slice(0, 16)}`;
  }
  return GLOBAL_PROJECT_ID;
}

/** 进程级 projectID 缓存（单进程 cwd 固定；测试用 resetCurrentProjectId 隔离）。 */
let currentProjectId: string | null = null;

/**
 * 设置当前进程 projectID（启动时由 resolveProjectIdForCwd 写入）。
 *
 * @param id - projectID 字符串
 */
export function setCurrentProjectId(id: string): void {
  currentProjectId = id;
}

/**
 * 读取当前进程 projectID（未初始化返回 null，调用方回退路径 hash）。
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/**
 * 清空进程级 projectID 缓存（仅测试隔离用）。
 */
export function resetCurrentProjectId(): void {
  currentProjectId = null;
}

/**
 * 同步解析数据读写用的 projectID：缓存优先，否则按 cwd 回退推导。
 *
 * @param cwd - 当前工作目录
 * @param _projectConfigDir - 保留参数（兼容旧签名，中央模式下不再使用）
 */
export function resolveDataProjectId(cwd: string, _projectConfigDir: string | null): string {
  void _projectConfigDir;
  return getCurrentProjectId() ?? deriveProjectId({ cwd });
}

/**
 * 取 git root commit hash（排序取首；非 git/无提交/git 缺失返回 null，永不抛错）。
 *
 * @param cwd - 当前工作目录
 */
async function resolveGitRootHash(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-list', '--max-parents=0', '--all'], {
      cwd,
      timeout: 10000,
    });
    const roots = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[0-9a-f]{40}$/i.test(line))
      .sort();
    return roots[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析当前目录的 projectID（git root hash 优先），写入进程缓存。
 *
 * - git 可用且有提交 → root commit hash（排序取首）；
 * - 非 git/无提交/git 缺失 → 路径回退（deriveProjectId）；
 * - 永远不抛错（子进程失败一律回退）。
 *
 * @param cwd - 当前工作目录
 * @returns projectID 字符串
 */
export async function resolveProjectIdForCwd(cwd: string): Promise<string> {
  const gitRootHash = await resolveGitRootHash(cwd);
  const id = deriveProjectId({ cwd, gitRootHash });
  setCurrentProjectId(id);
  return id;
}
