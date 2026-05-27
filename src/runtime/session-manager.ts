import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveDefaultSessionDir } from "../config/paths.js";
import type { RuntimeMode, SessionRecord } from "./event-types.js";

export type SessionMetadata = {
  id: string;
  path: string;
  cwd: string;
  mode: RuntimeMode;
  providerId: string;
  /** 父会话 ID（如果是子 Agent） */
  parentId?: string;
  /** 子 Agent 名称（如果是子 Agent） */
  childName?: string;
};

/** 缓冲区配置 */
const FLUSH_THRESHOLD = 10; // 累积 10 条记录后写入
const FLUSH_INTERVAL_MS = 5000; // 或每 5 秒强制写入

/**
 * Generates a session ID with local timestamp prefix for easy identification.
 * Format: 2026-05-23_143000_abc123 (使用本地时区)
 */
function generateSessionId(): string {
  const now = new Date();

  // 使用本地时间而非 UTC
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  const date = `${year}-${month}-${day}`;
  const time = `${hours}${minutes}${seconds}`;
  const shortId = randomUUID().slice(0, 6);

  return `${date}_${time}_${shortId}`;
}

function resolveSessionDir(): string {
  return resolveDefaultSessionDir({
    cwd: process.cwd(),
    projectConfigDir: null,
    env: process.env,
  });
}

/** 单个会话的缓冲区 */
type SessionBuffer = {
  records: SessionRecord[];
  timer?: NodeJS.Timeout;
};

export class SessionManager {
  constructor(private readonly sessionDir = resolveSessionDir()) {}

  /** 每个 session 独立的缓冲区 */
  private buffers = new Map<string, SessionBuffer>();

  async startSession(params: {
    cwd: string;
    mode: RuntimeMode;
    providerId: string;
  }): Promise<SessionMetadata> {
    await mkdir(this.sessionDir, { recursive: true });

    const id = generateSessionId();

    const session: SessionMetadata = {
      id,
      path: join(this.sessionDir, `${id}.jsonl`),
      cwd: params.cwd,
      mode: params.mode,
      providerId: params.providerId,
    };

    // 初始化缓冲区
    this.buffers.set(id, { records: [] });

    return session;
  }

  /**
   * 创建子 Agent 会话
   *
   * @param parent - 父会话元数据
   * @param name - 子 Agent 名称
   */
  async createChildSession(
    parent: SessionMetadata,
    name: string,
  ): Promise<SessionMetadata> {
    await mkdir(this.sessionDir, { recursive: true });

    const childId = `${parent.id}-child-${name}`;

    const session: SessionMetadata = {
      id: childId,
      path: join(this.sessionDir, `${childId}.jsonl`),
      cwd: parent.cwd,
      mode: "single",
      providerId: parent.providerId,
      parentId: parent.id,
      childName: name,
    };

    // 初始化缓冲区
    this.buffers.set(childId, { records: [] });

    return session;
  }

  /**
   * 追加记录到缓冲区
   *
   * 当缓冲区达到阈值、超时或遇到 session_end 记录时自动写入文件。
   */
  async appendRecord(session: SessionMetadata, record: SessionRecord): Promise<void> {
    const buffer = this.buffers.get(session.id);
    if (!buffer) {
      // 无缓冲区时直接写入（兼容旧逻辑）
      await appendFile(session.path, `${JSON.stringify(record)}\n`, "utf8");
      return;
    }

    buffer.records.push(record);

    // session_end 记录立即写入所有缓冲内容
    if (record.type === "session_end") {
      await this.flush(session.id);
      return;
    }

    // 启动定时器（如果还没有）
    if (!buffer.timer) {
      buffer.timer = setTimeout(() => {
        this.flush(session.id);
      }, FLUSH_INTERVAL_MS);
    }

    // 达到阈值时立即写入
    if (buffer.records.length >= FLUSH_THRESHOLD) {
      await this.flush(session.id);
    }
  }

  /**
   * 强制写入缓冲区到文件
   */
  async flush(sessionId: string): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.records.length === 0) {
      return;
    }

    // 清除定时器
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = undefined;
    }

    // 批量写入
    const content = buffer.records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const sessionPath = join(this.sessionDir, `${sessionId}.jsonl`);

    await appendFile(sessionPath, content, "utf8");
    buffer.records = [];
  }

  /**
   * 关闭会话，强制写入并清理缓冲区
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.flush(sessionId);
    this.buffers.delete(sessionId);
  }

  /**
   * 关闭所有会话（进程退出时调用）
   */
  async closeAll(): Promise<void> {
    const promises = Array.from(this.buffers.keys()).map((id) => this.flush(id));
    await Promise.all(promises);
    this.buffers.clear();
  }
}
