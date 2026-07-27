/**
 * unified-session-manager.ts - 统一会话管理器
 *
 * 封装 SessionManager 和 SessionIndex，提供统一的会话管理接口。
 * 减少 chat.ts、resume.ts、sessions.ts 中的重复代码。
 */

import type { RuntimeMode, SessionRecord, SessionMessageRecord } from './event-types.js';
import { SessionManager, type SessionMetadata } from './session-manager.js';
import { createSessionIndex, type SessionSummary, type SessionDetail, type SessionQueryOptions } from './session-index.js';

// ============================================================
// Types
// ============================================================

/**
 * 启动会话参数
 */
export type StartSessionParams = {
  cwd: string;
  mode: RuntimeMode;
  providerId: string;
};

/**
 * 恢复会话结果
 */
export type ResumeSessionResult = {
  session: SessionMetadata;
  history: SessionMessageRecord[];
  detail: SessionDetail;
};

/**
 * 统一会话管理器参数
 */
export type UnifiedSessionManagerParams = {
  sessionDir: string;
};

// ============================================================
// UnifiedSessionManager
// ============================================================

/**
 * 统一会话管理器
 *
 * 封装 SessionManager 和 SessionIndex，提供统一的会话管理接口。
 * 减少 chat.ts、resume.ts、sessions.ts 中的重复代码。
 */
export class UnifiedSessionManager {
  private sessionManager: SessionManager;
  private sessionIndex: ReturnType<typeof createSessionIndex>;

  constructor(params: UnifiedSessionManagerParams) {
    this.sessionManager = new SessionManager(params.sessionDir);
    this.sessionIndex = createSessionIndex(params.sessionDir);
  }

  /**
   * 启动新会话
   *
   * @param params - 启动会话参数
   * @returns 会话元数据
   */
  async startSession(params: StartSessionParams): Promise<SessionMetadata> {
    return this.sessionManager.startSession(params);
  }

  /**
   * 恢复会话
   *
   * @param sessionId - 会话 ID（可选，不指定则恢复最新会话）
   * @returns 恢复会话结果，包含会话元数据、历史消息和详情
   */
  async resumeSession(sessionId?: string): Promise<ResumeSessionResult | null> {
    let detail: SessionDetail | null;

    if (sessionId) {
      detail = await this.sessionIndex.getSession(sessionId);
    } else {
      detail = await this.sessionIndex.getLatestSession();
    }

    if (!detail) {
      return null;
    }

    // 创建恢复的会话元数据
    const session: SessionMetadata = {
      id: detail.id,
      path: detail.path,
      cwd: detail.cwd || process.cwd(),
      mode: (detail.mode || 'single') as RuntimeMode,
      providerId: detail.providerId || 'local',
    };

    // 恢复历史消息
    const history = this.restoreHistoryFromRecords(detail.records);

    return {
      session,
      history,
      detail,
    };
  }

  /**
   * 列出会话
   *
   * @param options - 查询选项
   * @returns 会话摘要列表
   */
  async listSessions(options?: SessionQueryOptions): Promise<SessionSummary[]> {
    return this.sessionIndex.listSessions(options);
  }

  /**
   * 获取会话详情
   *
   * @param sessionId - 会话 ID
   * @returns 会话详情，不存在则返回 null
   */
  async getSession(sessionId: string): Promise<SessionDetail | null> {
    return this.sessionIndex.getSession(sessionId);
  }

  /**
   * 获取最新会话
   *
   * @returns 最新会话详情，不存在则返回 null
   */
  async getLatestSession(): Promise<SessionDetail | null> {
    return this.sessionIndex.getLatestSession();
  }

  /**
   * 搜索会话
   *
   * @param query - 搜索关键词
   * @param limit - 最大返回数量
   * @returns 会话摘要列表
   */
  async searchSessions(query: string, limit?: number): Promise<SessionSummary[]> {
    return this.sessionIndex.searchSessions(query, limit);
  }

  /**
   * 删除会话
   *
   * @param sessionId - 会话 ID
   * @returns 是否删除成功
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessionIndex.deleteSession(sessionId);
  }

  /**
   * 获取统计信息
   *
   * @returns 统计信息
   */
  async getStats(): Promise<{
    totalSessions: number;
    oldestSession?: string;
    newestSession?: string;
  }> {
    return this.sessionIndex.getStats();
  }

  /**
   * 创建子 Agent 会话
   *
   * @param parent - 父会话元数据
   * @param name - 子 Agent 名称
   * @returns 子 Agent 会话元数据
   */
  async createChildSession(parent: SessionMetadata, name: string): Promise<SessionMetadata> {
    return this.sessionManager.createChildSession(parent, name);
  }

  /**
   * 追加记录到会话
   *
   * @param session - 会话元数据
   * @param record - 会话记录
   */
  async appendRecord(session: SessionMetadata, record: SessionRecord): Promise<void> {
    return this.sessionManager.appendRecord(session, record);
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    return this.sessionManager.closeAll();
  }

  /**
   * 从 session 记录中恢复历史消息
   *
   * @param records - 会话记录列表
   * @returns 历史消息列表
   */
  private restoreHistoryFromRecords(records: SessionRecord[]): SessionMessageRecord[] {
    return records
      .filter((record): record is SessionMessageRecord => record.type === 'message')
      .map((record) => ({
        type: 'message' as const,
        role: record.role,
        turn: record.turn || 0,
        content: record.content,
        source: record.source || 'interactive',
        timestamp: record.timestamp,
      }));
  }

  /**
   * 获取底层 SessionManager（用于兼容性）
   *
   * @returns SessionManager 实例
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * 创建统一会话管理器
 *
 * @param sessionDir - 会话目录路径
 * @returns UnifiedSessionManager 实例
 */
export function createUnifiedSessionManager(sessionDir: string): UnifiedSessionManager {
  return new UnifiedSessionManager({ sessionDir });
}
