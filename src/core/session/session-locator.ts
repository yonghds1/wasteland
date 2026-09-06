/**
 * session-locator.ts - transcript 跨项目定位（09-06-central-log-store）
 *
 * 中央数据根下 transcript 按 `sessions/<projectId>/` 隔离；本模块提供：
 * - resolveProjectOption：`--project <id|path>` 解析为 projectId（id 精确 → worktree 后缀 → null）
 * - listTranscriptsAllProjects：多项目 transcript 摘要聚合（本项目置顶可选）
 * - getTranscriptAcrossProjects / getLatestTranscriptAcrossProjects：跨目录查找与最新定位
 *
 * 单条 schema 与 session-index 行为不变；本模块只做“去哪找”的路由。
 */

import { join } from 'node:path';

import { listProjectIds, readProjectMeta } from '@core/logger/data-store.js';
import {
  createSessionIndex,
  type SessionDetail,
  type SessionSummary,
} from './session-index.js';

/**
 * 带项目归属的 transcript 摘要。
 */
export interface ProjectSessionSummary {
  /** 所属 projectID */
  projectId: string;
  /** 展示用工作目录 */
  worktree: string;
  /** transcript 摘要本体 */
  summary: SessionSummary;
}

/**
 * 解析 `--project <id|path>` 为 projectID（纯查表，可单测核心分支）。
 *
 * 顺序：projectId 精确匹配 → worktree 精确/后缀匹配 → null（调用方按“无此项目”处理）。
 *
 * @param projects - 已知项目 [{ id, worktree }]
 * @param option - 用户输入
 */
export function matchProjectOption(
  projects: ReadonlyArray<{ id: string; worktree: string }>,
  option: string
): string | null {
  const trimmed = option.trim();
  if (!trimmed) return null;
  const byId = projects.find((p) => p.id === trimmed);
  if (byId) return byId.id;
  const norm = trimmed.replace(/\/+$/, '');
  const byWorktree = projects.find(
    (p) => p.worktree === norm || p.worktree.endsWith(`/${norm}`) || p.worktree === trimmed
  );
  return byWorktree?.id ?? null;
}

/**
 * 收集数据根下全部已知项目（id + worktree 标签）。
 *
 * @param dataRoot - 中央数据根目录
 */
export async function listKnownProjects(
  dataRoot: string
): Promise<Array<{ id: string; worktree: string }>> {
  const ids = await listProjectIds(dataRoot);
  const out: Array<{ id: string; worktree: string }> = [];
  for (const id of ids) {
    const meta = await readProjectMeta(dataRoot, id);
    out.push({ id, worktree: meta?.worktree ?? id });
  }
  return out;
}

/**
 * 解析 `--project` 选项（查表 + 匹配）。
 *
 * @param dataRoot - 中央数据根目录
 * @param option - 用户输入（id 或路径），缺省返回 null（调用方按“全项目”处理）
 */
export async function resolveProjectOption(
  dataRoot: string,
  option: string | undefined
): Promise<string | null> {
  if (!option?.trim()) return null;
  const projects = await listKnownProjects(dataRoot);
  return matchProjectOption(projects, option);
}

export interface TranscriptListOptions {
  limit?: number;
  search?: string;
  provider?: string;
  mode?: string;
  sort?: 'newest' | 'oldest';
  /** 本项目 ID（置顶用，可选） */
  currentProjectId?: string | null;
}

/**
 * 多项目 transcript 摘要聚合。
 *
 * 各项目内沿用 session-index 的过滤/排序；合并后本项目置顶（单项目时顺序与原来一致），
 * 其余按创建时间全局排序；limit 在合并后截断。
 *
 * @param dataRoot - 中央数据根目录
 * @param projectIds - 限定范围（缺省为全部已知项目）
 * @param opts - 过滤/排序/置顶选项
 */
export async function listTranscriptsAllProjects(
  dataRoot: string,
  projectIds?: string[],
  opts: TranscriptListOptions = {}
): Promise<ProjectSessionSummary[]> {
  const ids = projectIds ?? (await listProjectIds(dataRoot));
  const out: ProjectSessionSummary[] = [];
  for (const projectId of ids) {
    const meta = await readProjectMeta(dataRoot, projectId);
    const worktree = meta?.worktree ?? projectId;
    try {
      const index = createSessionIndex(join(dataRoot, 'sessions', projectId));
      const summaries = await index.listSessions({
        search: opts.search,
        provider: opts.provider,
        mode: opts.mode,
        sort: opts.sort as 'newest' | 'oldest' | undefined,
      });
      for (const summary of summaries) {
        out.push({ projectId, worktree, summary });
      }
    } catch {
      // 单项目损坏不阻断聚合
    }
  }
  const cur = opts.currentProjectId ?? null;
  out.sort((a, b) => {
    const aCur = cur !== null && a.projectId === cur ? 0 : 1;
    const bCur = cur !== null && b.projectId === cur ? 0 : 1;
    if (aCur !== bCur) return aCur - bCur;
    const timeA = a.summary.createdAt;
    const timeB = b.summary.createdAt;
    return opts.sort === 'oldest'
      ? timeA.localeCompare(timeB)
      : timeB.localeCompare(timeA);
  });
  return typeof opts.limit === 'number' ? out.slice(0, Math.max(0, opts.limit)) : out;
}

/**
 * 跨目录按 ID 取 transcript 详情（本项目优先）。
 *
 * @param dataRoot - 中央数据根目录
 * @param sessionId - 会话 ID
 * @param currentProjectId - 本项目 ID（优先查找，可选）
 */
export async function getTranscriptAcrossProjects(
  dataRoot: string,
  sessionId: string,
  currentProjectId?: string | null
): Promise<{ detail: SessionDetail; projectId: string } | null> {
  const ids = await listProjectIds(dataRoot);
  const ordered = [
    ...ids.filter((id) => currentProjectId != null && id === currentProjectId),
    ...ids.filter((id) => currentProjectId == null || id !== currentProjectId),
  ];
  for (const projectId of ordered) {
    try {
      const detail = await createSessionIndex(
        join(dataRoot, 'sessions', projectId)
      ).getSession(sessionId);
      if (detail) return { detail, projectId };
    } catch {
      // 继续下一个项目
    }
  }
  return null;
}
