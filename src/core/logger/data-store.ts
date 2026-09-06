/**
 * data-store.ts - 中央数据根读写抽象（09-06-central-log-store，OpenCode 模式）
 *
 * 数据布局（`dataRoot` = resolveDefaultDataDir）：
 * ```
 * <dataRoot>/
 *   migration                  # 数据版本（当前 1）
 *   project/<projectId>.json   # { id, vcs, worktree, created }
 *   logs/<projectId>/          # FileSink 日志（含 sessions/<sid>.jsonl + error.jsonl）
 *   sessions/<projectId>/      # transcript（*.jsonl）
 *   exports/<projectId>/       # 日志导出物
 * ```
 *
 * 约定：
 * - 本模块只拼目录、做聚合与定位；单条 JSONL schema 与 FileSink/loader 行为不变；
 * - `locateSession` 索引优先、全根扫描回退（OpenCode #8538 教训：不假设 cwd 即归属）；
 * - 旧 `.wasteland/{logs,sessions}` 一行不读（绿地决策）。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PROJECT_DIRNAME } from '@config/paths.js';
import { listSessions, type SessionSummaryOnDisk } from './file-log-loader.js';

/** 当前数据版本（新数据根初始化时写入）。 */
export const DATA_VERSION = 1;

/**
 * 项目元数据（`project/<projectId>.json` 内容）。
 */
export interface ProjectMeta {
  /** projectID（git root hash 或 local-<hash> 或 global） */
  id: string;
  /** 版本控制系统标识：'git' | 'none' */
  vcs: 'git' | 'none';
  /** 解析时的工作目录（展示标签用，不做精确匹配依据） */
  worktree: string;
  /** 创建时间的 ISO 字符串 */
  created: string;
}

/**
 * 带项目归属的 session 摘要（聚合列表用）。
 */
export interface ProjectSessionSummary extends SessionSummaryOnDisk {
  /** 所属 projectID */
  projectId: string;
  /** 展示用工作目录（读 project.json 失败时回退 projectId） */
  worktree: string;
}

/**
 * session 定位结果（resume/export 跨目录用）。
 */
export interface SessionLocation {
  /** 所属 projectID */
  projectId: string;
  /** transcript 文件绝对路径（不存在时为 null） */
  transcriptFile: string | null;
  /** 日志 session 文件绝对路径（不存在时为 null） */
  logFile: string | null;
}

/**
 * 判定 projectID 的版本控制类型（纯函数，可单测）。
 *
 * 裸 40 位 hex 为 git root hash，其余（local- 前缀 / global）一律 none。
 *
 * @param projectId - 项目 ID
 */
export function classifyProjectId(projectId: string): 'git' | 'none' {
  return /^[0-9a-f]{40}$/i.test(projectId) ? 'git' : 'none';
}

/**
 * 确保数据根骨架存在并写入版本文件（幂等）。
 *
 * @param dataRoot - 中央数据根目录
 */
export async function ensureDataRoot(dataRoot: string): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(dataRoot, PROJECT_DIRNAME), { recursive: true });
  const migrationFile = join(dataRoot, 'migration');
  try {
    await readFile(migrationFile, 'utf8');
  } catch {
    await writeFile(migrationFile, String(DATA_VERSION), 'utf8');
  }
}

/**
 * 写入项目元数据（每次启动覆盖 worktree，保持标签新鲜）。
 *
 * @param dataRoot - 中央数据根目录
 * @param meta - 项目元数据（created 由调用方传入）
 */
export async function writeProjectMeta(
  dataRoot: string,
  meta: Omit<ProjectMeta, 'created'> & { created?: string }
): Promise<void> {
  await mkdir(join(dataRoot, PROJECT_DIRNAME), { recursive: true });
  const full: ProjectMeta = {
    ...meta,
    created: meta.created ?? new Date().toISOString(),
  };
  await writeFile(join(dataRoot, PROJECT_DIRNAME, `${meta.id}.json`), JSON.stringify(full), 'utf8');
}

/**
 * 读取项目元数据（缺失/损坏返回 null，调用方回退 projectId 展示）。
 *
 * @param dataRoot - 中央数据根目录
 * @param projectId - 项目 ID
 */
export async function readProjectMeta(
  dataRoot: string,
  projectId: string
): Promise<ProjectMeta | null> {
  try {
    const raw = await readFile(join(dataRoot, PROJECT_DIRNAME, `${projectId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectMeta>;
    if (typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      vcs: parsed.vcs === 'git' ? 'git' : 'none',
      worktree: typeof parsed.worktree === 'string' ? parsed.worktree : projectId,
      created: typeof parsed.created === 'string' ? parsed.created : '',
    };
  } catch {
    return null;
  }
}

/**
 * 列出数据根下全部 projectID（logs/ 与 sessions/ 目录并集，排序稳定）。
 *
 * @param dataRoot - 中央数据根目录
 */
export async function listProjectIds(dataRoot: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const kind of ['logs', 'sessions'] as const) {
    try {
      const entries = await readdir(join(dataRoot, kind), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          ids.add(entry.name);
        }
      }
    } catch {
      // 目录不存在视为无项目（绿地首启）
    }
  }
  return [...ids].sort();
}

/**
 * 聚合全部项目的 session 摘要（本项目置顶由调用方排序；此处按 projectId 分组返回）。
 *
 * @param dataRoot - 中央数据根目录
 * @param signal - 可选中止信号（透传 listSessions）
 */
export async function listAllSessions(
  dataRoot: string,
  signal?: AbortSignal
): Promise<ProjectSessionSummary[]> {
  const ids = await listProjectIds(dataRoot);
  const out: ProjectSessionSummary[] = [];
  for (const projectId of ids) {
    const meta = await readProjectMeta(dataRoot, projectId);
    const worktree = meta?.worktree ?? projectId;
    try {
      const summaries = await listSessions({ dir: join(dataRoot, 'logs', projectId), signal });
      for (const summary of summaries) {
        out.push({ ...summary, projectId, worktree });
      }
    } catch {
      // 单项目损坏不阻断聚合
    }
  }
  return out;
}

/**
 * 跨目录定位 session（索引优先、全根扫描回退）。
 *
 * 查找顺序：transcript（sessions/<pid>/<sid>.jsonl）与日志（logs/<pid>/sessions/<sid>.jsonl）
 * 逐 project 尝试；两者皆无返回 null（调用方按“无此 session”处理）。
 *
 * @param dataRoot - 中央数据根目录
 * @param sessionId - 会话 ID
 */
export async function locateSession(
  dataRoot: string,
  sessionId: string
): Promise<SessionLocation | null> {
  if (!sessionId) return null;
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;
  const ids = await listProjectIds(dataRoot);
  for (const projectId of ids) {
    const transcriptFile = join(dataRoot, 'sessions', projectId, `${safeId}.jsonl`);
    const logFile = join(dataRoot, 'logs', projectId, 'sessions', `${safeId}.jsonl`);
    const [hasTranscript, hasLog] = await Promise.all([
      fileExists(transcriptFile),
      fileExists(logFile),
    ]);
    if (hasTranscript || hasLog) {
      return {
        projectId,
        transcriptFile: hasTranscript ? transcriptFile : null,
        logFile: hasLog ? logFile : null,
      };
    }
  }
  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}
