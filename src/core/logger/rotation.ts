/**
 * rotation.ts - 文件轮转与 gzip 归档
 *
 * 用途：FileSink 在写入前调用本模块判断是否需要轮转 / gzip 归档。
 *
 * 行为契约：
 * - `rotateIfNeeded(filePath, upcomingBytes, policy)`：
 *     - 若 file 不存在或 size + upcoming ≤ maxSizeBytes → no-op
 *     - 否则：file → file.1, file.1 → file.2 ...；超出 maxFiles-1 的旧档 unlink
 *     - maxSizeBytes = 0 → 不按 size 切
 *     - maxFiles = 0 → 不按 size 切（同上）
 * - `gzipIfStale(filePath, maxAgeDays)`：
 *     - 若文件 mtime 距今 > maxAgeDays 且 <file>.gz 不存在 → 流式 gzip 并 unlink 原文件
 *     - maxAgeDays = 0 → 不归档
 *
 * 实现要求：
 * - 用 node:fs/promises + node:zlib（无第三方依赖）
 * - 失败（权限 / 磁盘满）静默忽略（与 debug-logger 一致）
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { access, readdir, rename, stat, unlink } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';

import type { Readable, Writable } from 'node:stream';

// ============================================================
// 工具函数
// ============================================================

/**
 * 文件是否存在（不抛错）。
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 文件大小（字节）。文件不存在返回 0。
 */
export async function fileSize(p: string): Promise<number> {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * 文件 mtime（毫秒）。文件不存在返回 0。
 */
export async function fileMtimeMs(p: string): Promise<number> {
  try {
    const s = await stat(p);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

// ============================================================
// 轮转策略
// ============================================================

/**
 * 文件轮转策略。
 *
 * @property maxSizeBytes - 单文件 size cap（bytes）。0 = 不按 size 切。
 * @property maxFiles - 保留档位总数（含当前 active file）。0 = 不按 size 切。
 * @property maxAgeDays - 旧档超过此天数后 gzip 归档。0 = 不归档。
 * @property maxTotalSizeBytes - 目录级：sessions/ 总大小上限（bytes）。0 = 不限制。
 * @property maxTotalFiles - 目录级：sessions/ 文件总数上限。0 = 不限制。
 */
export type RotatePolicy = {
  maxSizeBytes?: number;
  maxFiles?: number;
  maxAgeDays?: number;
  maxTotalSizeBytes?: number;
  maxTotalFiles?: number;
};

// ============================================================
// rotateIfNeeded
// ============================================================

/**
 * 在写入前调用；判断是否需要 rotate。
 *
 * 规则：
 * 1. 若 policy 未启用（maxSizeBytes=0 或 maxFiles=0）→ no-op
 * 2. 若 file 不存在 → no-op（首次写入不需要 rotate）
 * 3. 若 file.size + upcomingBytes ≤ maxSizeBytes → no-op
 * 4. 否则：
 *    a. 把现存旧档从 .N → .(N+1)；超出 maxFiles-1 的 unlink
 *    b. 把当前 active file → .1
 *    c. 下一次 write 就会创建新的 active file
 *
 * 失败静默：catch 任何 fs error 直接吞掉。
 *
 * @param filePath - 当前 active file 路径
 * @param upcomingBytes - 即将写入的字节数（用于判断是否超 cap）
 * @param policy - 轮转策略
 */
export async function rotateIfNeeded(
  filePath: string,
  upcomingBytes: number,
  policy: RotatePolicy
): Promise<void> {
  const maxSize = policy.maxSizeBytes ?? 0;
  const maxFiles = policy.maxFiles ?? 0;
  if (maxSize <= 0 || maxFiles <= 0) return;

  if (!(await fileExists(filePath))) return;

  const currentSize = await fileSize(filePath);
  if (currentSize + upcomingBytes <= maxSize) return;

  try {
    // 从最旧的保留档（maxFiles - 1）开始往上推；超出的 unlink
    // 例：maxFiles=3 → 保留 .1, .2；.3 直接 unlink
    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      if (i === maxFiles - 1) {
        if (await fileExists(src)) {
          await unlink(src);
        }
        continue;
      }
      const dst = `${filePath}.${i + 1}`;
      if (await fileExists(src)) {
        await rename(src, dst);
      }
    }
    // active file → .1
    if (await fileExists(filePath)) {
      await rename(filePath, `${filePath}.1`);
    }
  } catch {
    // 静默
  }
}

// ============================================================
// gzipIfStale
// ============================================================

/**
 * 把超过 maxAgeDays 天的文件 gzip 归档。
 *
 * - mtime 距今 ≤ maxAgeDays → no-op
 * - mtime 距今 > maxAgeDays 且 <file>.gz 不存在 → 流式 gzip 压缩到 <file>.gz，
 *   完成后 unlink 原文件
 * - <file>.gz 已存在 → no-op（不重复压缩）
 * - maxAgeDays = 0 → no-op
 *
 * 失败静默。
 *
 * @param filePath - 待归档文件路径
 * @param maxAgeDays - age cap（天）
 */
export async function gzipIfStale(filePath: string, maxAgeDays: number): Promise<void> {
  if (maxAgeDays <= 0) return;
  if (!(await fileExists(filePath))) return;

  const gzPath = `${filePath}.gz`;
  if (await fileExists(gzPath)) return;

  const mtime = await fileMtimeMs(filePath);
  if (mtime <= 0) return;

  const ageMs = Date.now() - mtime;
  if (ageMs <= maxAgeDays * 24 * 60 * 60 * 1000) return;

  try {
    await streamGzip(filePath, gzPath);
    await unlink(filePath);
  } catch {
    // 静默
  }
}

/**
 * 流式 gzip 压缩（适合大文件 >10MB）。
 */
function streamGzip(src: string, dst: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const input: Readable = createReadStream(src);
    const output: Writable = createWriteStream(dst);
    const gz = createGzip();
    input.on('error', reject);
    output.on('error', reject);
    gz.on('error', reject);
    output.on('finish', () => resolve());
    input.pipe(gz).pipe(output);
  });
}

// ============================================================
// cleanupDirectory
// ============================================================

/**
 * 目录级清理：当目录总大小或文件总数超过上限时，按 mtime 由旧到新删除文件，
 * 直到两个上限都满足。
 *
 * 用途：控制 `.wasteland/logs/sessions/` 的整体体积（单文件轮转只控制单个文件，
 * 无法约束目录总量）。清理对象是「最旧的历史文件」，当前正在写入的 session 文件
 * mtime 最新，总是最后才被清理。
 *
 * 行为：
 * - maxTotalSizeBytes = 0 且 maxTotalFiles = 0 → no-op（返回 0）
 * - 任一上限超限 → 从最旧文件开始 unlink，直到 totalSize ≤ maxTotalSizeBytes
 *   且 count ≤ maxTotalFiles（未启用的上限视为 +∞）
 * - 目录不存在 / 无文件 → 返回 0
 * - 失败静默（与 rotateIfNeeded / gzipIfStale 一致）
 *
 * @param opts.dir - 目标目录（通常为 sessions/）
 * @param opts.maxTotalSizeBytes - 目录总大小上限（bytes）。0 = 不限制
 * @param opts.maxTotalFiles - 目录文件总数上限。0 = 不限制
 * @returns 删除的文件数
 */
export async function cleanupDirectory(opts: {
  dir: string;
  maxTotalSizeBytes?: number;
  maxTotalFiles?: number;
}): Promise<number> {
  const maxTotalSize = opts.maxTotalSizeBytes ?? 0;
  const maxTotalFiles = opts.maxTotalFiles ?? 0;
  if (maxTotalSize <= 0 && maxTotalFiles <= 0) return 0;

  let files: { name: string; size: number; mtimeMs: number }[];
  try {
    const entries = await readdir(opts.dir);
    const stats = await Promise.all(
      entries.map(async (name) => {
        try {
          const s = await stat(join(opts.dir, name));
          return { name, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    files = stats.filter((s): s is { name: string; size: number; mtimeMs: number } => s !== null);
  } catch {
    return 0;
  }

  if (files.length === 0) return 0;

  let totalSize = files.reduce((acc, f) => acc + f.size, 0);
  if (totalSize <= maxTotalSize && files.length <= maxTotalFiles) return 0;

  // 最旧的先删
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let removed = 0;
  for (const f of files) {
    const withinSize = maxTotalSize <= 0 || totalSize <= maxTotalSize;
    const withinCount = maxTotalFiles <= 0 || files.length - removed <= maxTotalFiles;
    if (withinSize && withinCount) break;
    try {
      await unlink(join(opts.dir, f.name));
      totalSize -= f.size;
      removed++;
    } catch {
      // 静默
    }
  }
  return removed;
}
