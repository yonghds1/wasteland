/**
 * session-index.ts - Session 索引和检索
 *
 * 提供 session 的列出、搜索和检索功能。
 * 优化策略：列表操作只读取必要的摘要信息，避免完整解析。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveDefaultSessionDir } from '../../config/paths.js';
import type { SessionRecord, SessionStartRecord, SessionMessageRecord } from './event-types.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Session 摘要信息
 */
export type SessionSummary = {
  /** Session ID */
  id: string;
  /** Session 文件路径 */
  path: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 消息数量 */
  messageCount: number;
  /** 第一条用户消息（预览） */
  firstUserMessage?: string;
  /** 最后一条助手消息（预览） */
  lastAssistantMessage?: string;
  /** 工作目录 */
  cwd?: string;
  /** Provider ID */
  providerId?: string;
  /** 运行模式 */
  mode?: string;
  /** 是否有子 Agent */
  hasChildren: boolean;
  /** 子 Agent 名称列表 */
  childNames: string[];
};

/**
 * Session 详细信息
 */
export type SessionDetail = SessionSummary & {
  /** 完整的消息记录 */
  records: SessionRecord[];
};

/**
 * Session 索引查询选项
 */
export type SessionQueryOptions = {
  /** 最大返回数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
  /** 搜索关键词（搜索消息内容） */
  search?: string;
  /** 按 Provider 过滤 */
  provider?: string;
  /** 按模式过滤 */
  mode?: string;
  /** 排序方式 */
  sort?: 'newest' | 'oldest';
};

/**
 * 内部使用的 session 文件信息（带 mtime 用于排序）
 */
type SessionFileInfo = {
  file: string;
  id: string;
  mtimeMs: number;
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析 session 目录
 */
function resolveSessionDir(): string {
  return resolveDefaultSessionDir({
    cwd: process.cwd(),
    projectConfigDir: null,
    env: process.env,
  });
}

/**
 * 从文件名提取 session ID
 */
function extractSessionId(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}_\d{6}_[a-f0-9]{6})\.jsonl$/);
  return match ? match[1] : null;
}

/**
 * 检查是否是子 Agent session
 */
function isChildSession(sessionId: string): boolean {
  return sessionId.includes('-child-');
}

/**
 * 提取子 Agent 名称
 */
function extractChildName(sessionId: string): string | null {
  const match = sessionId.match(/^.+-child-(.+)$/);
  return match ? match[1] : null;
}

/**
 * 快速读取 session 文件的摘要信息（只读取前几行）
 */
async function readSessionSummaryFast(
  filePath: string
): Promise<{ firstUserMessage?: string; providerId?: string; mode?: string; cwd?: string; createdAt?: string }> {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    let firstUserMessage: string | undefined;
    let providerId: string | undefined;
    let mode: string | undefined;
    let cwd: string | undefined;
    let createdAt: string | undefined;

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as SessionRecord;

        // 从 session 开始记录获取元数据
        if (record.type === 'session' && !providerId) {
          const sessionRecord = record as SessionStartRecord;
          providerId = sessionRecord.provider;
          mode = sessionRecord.mode;
          cwd = sessionRecord.cwd;
          createdAt = sessionRecord.timestamp;
        }

        // 获取第一条用户消息
        if (record.type === 'message' && !firstUserMessage) {
          const msgRecord = record as SessionMessageRecord;
          if (msgRecord.role === 'user') {
            firstUserMessage = msgRecord.content?.substring(0, 100);
          }
        }

        // 一旦获取到所需信息，提前退出
        if (providerId && firstUserMessage) break;
      } catch {
        // 跳过无效行
      }
    }

    return { firstUserMessage, providerId, mode, cwd, createdAt };
  } catch {
    return {};
  }
}

// ============================================================
// Session 索引类
// ============================================================

/**
 * Session 索引
 *
 * 提供 session 的列出、搜索和检索功能。
 */
export class SessionIndex {
  private readonly sessionDir: string;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir || resolveSessionDir();
  }

  /**
   * 列出所有 session
   *
   * 优化策略：
   * 1. 先收集文件名 + mtime（用于排序）
   * 2. 排序后分页
   * 3. 只对需要展示的 session 读取摘要信息
   */
  async listSessions(options: SessionQueryOptions = {}): Promise<SessionSummary[]> {
    const { limit = 50, offset = 0, search, provider, mode, sort = 'newest' } = options;

    try {
      // 读取 session 目录
      const files = await readdir(this.sessionDir);

      // 收集有效的 session 文件信息（ID + mtime）
      const sessionFileInfos: SessionFileInfo[] = [];

      for (const file of files) {
        const id = extractSessionId(file);
        if (id === null || isChildSession(id)) continue;

        try {
          const fileStat = await stat(join(this.sessionDir, file));
          sessionFileInfos.push({ file, id, mtimeMs: fileStat.mtimeMs });
        } catch {
          // 跳过无法访问的文件
        }
      }

      // 按 mtime 排序
      sessionFileInfos.sort((a, b) =>
        sort === 'newest' ? b.mtimeMs - a.mtimeMs : a.mtimeMs - b.mtimeMs
      );

      // 收集子 Agent 信息（一次性扫描）
      const childMap = new Map<string, string[]>();
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        // 尝试匹配子 Agent 文件名格式: {parentId}-child-{childName}.jsonl
        const childMatch = file.match(/^(.+)-child-(.+)\.jsonl$/);
        if (childMatch) {
          const parentId = childMatch[1];
          const childName = childMatch[2];
          if (!childMap.has(parentId)) {
            childMap.set(parentId, []);
          }
          const children = childMap.get(parentId);
          if (children) {
            children.push(childName);
          }
        }
      }

      // 先过滤（基于 ID 和子 Agent 信息），再分页，最后读取摘要
      // 第一遍：过滤出符合条件的 session
      const filteredInfos: SessionFileInfo[] = [];

      for (const info of sessionFileInfos) {
        // 如果需要按 provider/mode 过滤，需要先读取摘要
        if (provider || mode || search) {
          const summary = await readSessionSummaryFast(join(this.sessionDir, info.file));

          if (provider && summary.providerId !== provider) continue;
          if (mode && summary.mode !== mode) continue;

          if (search) {
            const searchLower = search.toLowerCase();
            const matchesSearch =
              summary.firstUserMessage?.toLowerCase().includes(searchLower) ||
              info.id.toLowerCase().includes(searchLower);

            if (!matchesSearch) continue;
          }
        }

        filteredInfos.push(info);
      }

      // 分页
      const pagedInfos = filteredInfos.slice(offset, offset + limit);

      // 读取摘要信息
      const sessions: SessionSummary[] = [];

      for (const info of pagedInfos) {
        const filePath = join(this.sessionDir, info.file);
        const summary = await readSessionSummaryFast(filePath);
        const childNames = childMap.get(info.id) || [];

        sessions.push({
          id: info.id,
          path: filePath,
          createdAt: summary.createdAt || info.id.replace('_', ' ').substring(0, 19),
          updatedAt: new Date(info.mtimeMs).toISOString(),
          messageCount: 0, // 快速模式不计算消息数
          firstUserMessage: summary.firstUserMessage,
          cwd: summary.cwd,
          providerId: summary.providerId,
          mode: summary.mode,
          hasChildren: childNames.length > 0,
          childNames,
        });
      }

      return sessions;
    } catch (error) {
      // 如果目录不存在，返回空数组
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 获取 session 详情（完整解析）
   */
  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const filePath = join(this.sessionDir, `${sessionId}.jsonl`);

    try {
      await stat(filePath);
    } catch {
      return null;
    }

    const records = await this.parseSessionRecords(filePath);

    if (records.length === 0) {
      return null;
    }

    // 查找子 Agent
    const files = await readdir(this.sessionDir);
    const childFiles = files.filter((f) => f.startsWith(`${sessionId}-child-`));
    const childNames = childFiles
      .map((f) => extractChildName(extractSessionId(f) || ''))
      .filter((name): name is string => name !== null);

    // 从记录中提取摘要
    const sessionStart = records.find((r) => r.type === 'session') as
      | SessionStartRecord
      | undefined;
    const userMessages = records.filter(
      (r): r is SessionMessageRecord =>
        r.type === 'message' && (r as SessionMessageRecord).role === 'user'
    );
    const assistantMessages = records.filter(
      (r): r is SessionMessageRecord =>
        r.type === 'message' && (r as SessionMessageRecord).role === 'assistant'
    );

    const createdAt = sessionStart?.timestamp || records[0]?.timestamp || '';
    const updatedAt = records[records.length - 1]?.timestamp || '';

    return {
      id: sessionId,
      path: filePath,
      createdAt,
      updatedAt,
      messageCount: userMessages.length + assistantMessages.length,
      firstUserMessage: userMessages[0]?.content?.substring(0, 100),
      lastAssistantMessage: assistantMessages[assistantMessages.length - 1]?.content?.substring(
        0,
        100
      ),
      cwd: sessionStart?.cwd,
      providerId: sessionStart?.provider,
      mode: sessionStart?.mode,
      hasChildren: childNames.length > 0,
      childNames,
      records,
    };
  }

  /**
   * 获取最新的 session
   */
  async getLatestSession(): Promise<SessionDetail | null> {
    const sessions = await this.listSessions({ limit: 1, sort: 'newest' });

    if (sessions.length === 0) {
      return null;
    }

    return this.getSession(sessions[0].id);
  }

  /**
   * 搜索 session
   */
  async searchSessions(query: string, limit = 10): Promise<SessionSummary[]> {
    return this.listSessions({ search: query, limit });
  }

  /**
   * 删除 session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = join(this.sessionDir, `${sessionId}.jsonl`);

    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);

      // 删除子 Agent session
      const files = await readdir(this.sessionDir);
      const childFiles = files.filter((f) => f.startsWith(`${sessionId}-child-`));

      for (const childFile of childFiles) {
        await unlink(join(this.sessionDir, childFile));
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 session 统计信息
   */
  async getStats(): Promise<{
    totalSessions: number;
    totalMessages: number;
    oldestSession?: string;
    newestSession?: string;
  }> {
    const sessions = await this.listSessions({ limit: 1000 });

    let totalMessages = 0;
    for (const session of sessions) {
      totalMessages += session.messageCount;
    }

    return {
      totalSessions: sessions.length,
      totalMessages,
      oldestSession: sessions[sessions.length - 1]?.createdAt,
      newestSession: sessions[0]?.createdAt,
    };
  }

  /**
   * 解析 session 记录
   */
  private async parseSessionRecords(filePath: string): Promise<SessionRecord[]> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n').filter((line) => line.trim().length > 0);

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as SessionRecord;
          } catch {
            return null;
          }
        })
        .filter((record): record is SessionRecord => record !== null);
    } catch {
      return [];
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建默认的 Session 索引
 */
export function createSessionIndex(sessionDir?: string): SessionIndex {
  return new SessionIndex(sessionDir);
}
