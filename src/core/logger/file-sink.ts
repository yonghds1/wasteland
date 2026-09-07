/**
 * file-sink.ts - JSONL 文件落盘 LogSink
 *
 * 用途：把 LogEntry 落到中央数据根 data/logs/<projectId>/ 目录下：
 * - sessions/<sessionId>.jsonl（按 session 维度组织，每个 session 一个文件）
 * - error.jsonl（warn/error 必落盘，独立流，PR1 PRD R6）
 *
 * 行为契约：
 * - write(entry) 同步返回（不阻塞 caller）；内部走串行 async pipeline
 * - 所有 pipeline 经 queueChain 串行化（避免并发更新 currentSize 致轮转判断错位）
 * - 写入失败（权限/磁盘满）静默丢弃
 * - 写入前自动 redactObject(entry.data)
 * - 字段顺序固定：version, timestamp, level, scope, sessionId, turn?, step?, message, data?, error?
 * - level=warn/error 双写：sessions/<sessionId>.jsonl + error.jsonl
 * - size cap 触发轮转（maxFiles 保留档位）
 * - age cap 触发 gzip 归档
 *
 * 与 PRD 关联：
 * - R6: error.jsonl 必落盘
 * - R12: 顶层字段顺序固定
 * - R13: 时间戳 ISO8601 UTC 毫秒精度（由 Logger.finalizeEntry 注入）
 * - R15: WASTELAND_LOG_DIR 可覆盖 dir
 */

import { appendFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { LogSink } from './memory-sink.js';
import type { RedactionRule } from './redactor.js';

import { gzipIfStale, rotateIfNeeded, cleanupDirectory } from './rotation.js';
import type { RotatePolicy } from './rotation.js';
import type { LogEntry } from './types.js';

// ============================================================
// Options
// ============================================================

/**
 * FileSink 构造选项。
 *
 * @property dir - 日志主目录（中央数据根 data/logs/<projectId>，由 caller 注入实际值）
 * @property sessionDir - session 文件子目录名（默认 `sessions`）
 * @property errorFilename - error 独立文件名（默认 `error.jsonl`）
 * @property policy - 轮转策略（size cap + 保留档位 + age cap）
 * @property redactionRules - 自定义脱敏规则（默认 defaultRedactionRules）
 */
export type FileSinkOptions = {
  dir: string;
  sessionDir?: string;
  errorFilename?: string;
  policy?: RotatePolicy;
  redactionRules?: readonly RedactionRule[];
};

// ============================================================
// 字段顺序
// ============================================================

/**
 * 顶层字段输出顺序（与 PRD R12 对齐）。
 *
 * 实现：把 entry 按 KEY_ORDER 拷贝到新对象，object key insertion order 决定
 * JSON.stringify 输出顺序。这避免了 `JSON.stringify(obj, replacerArray)` 的坑：
 * replacer array 仅在顶层生效，对嵌套对象的 key 会被剔除。
 */
const KEY_ORDER: readonly (keyof LogEntry)[] = [
  'version',
  'timestamp',
  'level',
  'scope',
  'sessionId',
  'turn',
  'step',
  'message',
  'data',
  'error',
];

/**
 * 按 KEY_ORDER 构造一个新对象（undefined 字段被 JSON.stringify 省略）。
 */
function orderKeys(entry: LogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = entry[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// ============================================================
// FileSink
// ============================================================

/**
 * JSONL 文件落盘 LogSink。
 *
 * 用法：
 * ```ts
 * const sink = new FileSink({ dir: '<dataRoot>/logs/<projectId>', policy: { maxSizeBytes: 10*1024*1024, maxFiles: 5 } });
 * bus.subscribe(sink);
 * // ...
 * await sink.flush();
 * await sink.close();
 * ```
 */
export class FileSink implements LogSink {
  private readonly dir: string;
  private readonly sessionDir: string;
  private readonly errorFilename: string;
  private readonly policy: RotatePolicy | undefined;

  /** 当前每个 session 文件的 size 估计（bytes） */
  private sessionSizes: Map<string, number> = new Map();
  /** error.jsonl size 估计（bytes） */
  private errorSize: number = 0;

  /** 串行化队列：每条 write 串接在 chain 后面，保证 size 更新可见 */
  private queueChain: Promise<void> = Promise.resolve();

  /** 关闭标志：close 后 write 无效 */
  private closed: boolean = false;
  /** dirReady 标志（懒创建） */
  private dirReady: boolean = false;
  /** 一天内是否已触发过日常维护（age-based gzip + 目录级清理），避免每次 write 都跑 stat */
  private lastMaintenanceDay: string | null = null;

  constructor(opts: FileSinkOptions) {
    this.dir = opts.dir;
    this.sessionDir = opts.sessionDir ?? 'sessions';
    this.errorFilename = opts.errorFilename ?? 'error.jsonl';
    this.policy = opts.policy;
  }

  // ------------------------------------------------------------
  // LogSink interface
  // ------------------------------------------------------------

  /**
   * 同步写一条 entry（不阻塞 caller）。
   *
   * 把 runPipeline 串接到 queueChain 后面，保证各 entry 的 size 更新 / 轮转判断
   */
  write(entry: LogEntry): void {
    if (this.closed) return;

    const sessionId = entry.sessionId || 'unknown';

    // 1) 单行序列化（固定字段顺序）
    const line = JSON.stringify(orderKeys(entry));

    // 3) 日常维护（age-based gzip + 目录级清理）触发（一天内只跑一次，跨日时 lazy 重置）
    this.maybeMaintenance();

    // 4) 串接到 chain
    this.queueChain = this.queueChain
      .catch(() => {
        // 前一个 pipeline 失败不应阻断下一个；静默吞掉
      })
      .then(() => this.runPipeline(line, entry.level, sessionId));
  }

  /**
   * 等待并确保之前所有已调用的 write 落地完成
   */
  async flush(): Promise<void> {
    await this.queueChain;
  }

  /**
   * 停止接收新日志，并等待缓冲区落盘
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  /**
   * 返回 sessions/ 子目录下所有 .jsonl / .jsonl.N（轮转档）/ .gz 文件（文件名，按字典序排序）。
   *
   * 用于 wasteland logs 子命令以及测试断言。
   */
  async listFiles(): Promise<string[]> {
    try {
      const sessionDirPath = join(this.dir, this.sessionDir);
      const entries = await readdir(sessionDirPath);
      return entries
        .filter(
          (name) =>
            name.endsWith('.jsonl') ||
            name.endsWith('.gz') ||
            /^\..*\.jsonl\.\d+$/.test(name) ||
            /.*\.jsonl\.\d+$/.test(name)
        )
        .sort();
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------
  // 内部：append + rotation + 双写
  // ------------------------------------------------------------

  private sessionFilePath(sessionId: string): string {
    return join(this.dir, this.sessionDir, `${sessionId}.jsonl`);
  }

  private errorFilePath(): string {
    return join(this.dir, this.errorFilename);
  }

  /**
   * 实际的写盘流水线：目录创建 -> 轮转判断 -> appendFile -> 累计 size。
   * 任何步骤失败均静默（catch swallow），不影响主流程。
   */
  private async runPipeline(line: string, level: string, sessionId: string): Promise<void> {
    try {
      // 0) 确保 dir 存在（首次 write 时创建）
      if (!this.dirReady) {
        try {
          await mkdir(join(this.dir, this.sessionDir), { recursive: true });
          this.dirReady = true;
        } catch {
          // 失败也继续（后续 appendFile 会再失败，但保持静默）
        }
      }

      const filePath = this.sessionFilePath(sessionId);
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for '\n'
      
      let currentSize = this.sessionSizes.get(sessionId) || 0;

      // 1) 轮转 size check（runtime 日切文件）
      if (this.policy) {
        try {
          await rotateIfNeeded(filePath, lineBytes, this.policy);
          if (currentSize + lineBytes > (this.policy.maxSizeBytes ?? 0)) {
            // rotateIfNeeded 已 rotate；当前文件 size 归零
            currentSize = 0;
          }
        } catch {
          // 静默
        }
      }

      // 2) 写主 session 文件
      await appendFile(filePath, line + '\n', 'utf8');
      this.sessionSizes.set(sessionId, currentSize + lineBytes);

      // 3) 同步追加到 error.jsonl（level=warn/error）
      if (level === 'warn' || level === 'error') {
        const errPath = this.errorFilePath();
        if (this.policy) {
          try {
            await rotateIfNeeded(errPath, lineBytes, this.policy);
            if (this.errorSize + lineBytes > (this.policy.maxSizeBytes ?? 0)) {
              this.errorSize = 0;
            }
          } catch {
            // 静默
          }
        }
        try {
          await appendFile(errPath, line + '\n', 'utf8');
          this.errorSize += lineBytes;
        } catch {
          // 静默
        }
      }

      // 4) age-based gzip 归档已移至 `maybeGzip()`（write 入口一天只触发一次）
    } catch {
      // 兜底静默
    }
  }

  /**
   * 每天只触发一次日常维护（age-based gzip 归档 + 目录级清理）。
   *
   * 设计动机：避免每次 write 都跑 `stat` 系统调用 + gzipIfStale / cleanupDirectory。
   * 通过 lastMaintenanceDay 记录上次维护日期，跨日时 lazy 重置。
   *
   * 实现：setImmediate 不阻塞 write 路径；扫描 sessions/ 子目录，
   * error.jsonl 不参与（与历史行为一致）。失败静默：与 FileSink 一致。
   */
  private maybeMaintenance(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastMaintenanceDay === today) return;
    this.lastMaintenanceDay = today;
    if (!this.policy) return;

    setImmediate(() => {
      void (async () => {
        const policy = this.policy;
        if (!policy) return;
        try {
          // 1) age-based gzip 归档（maxAgeDays > 0 时生效）
          const maxAgeDays = policy.maxAgeDays ?? 0;
          if (maxAgeDays > 0) {
            const files = await this.listFiles();
            for (const file of files) {
              if (file.endsWith('.gz')) continue;
              await gzipIfStale(join(this.dir, this.sessionDir, file), maxAgeDays);
            }
          }
          // 2) 目录级清理：sessions/ 总大小 / 文件数上限（对应 policy 字段 > 0 时生效）
          const maxTotalSizeBytes = policy.maxTotalSizeBytes ?? 0;
          const maxTotalFiles = policy.maxTotalFiles ?? 0;
          if (maxTotalSizeBytes > 0 || maxTotalFiles > 0) {
            await cleanupDirectory({
              dir: join(this.dir, this.sessionDir),
              maxTotalSizeBytes,
              maxTotalFiles,
            });
          }
        } catch {
          // 静默
        }
      })();
    });
  }
}
