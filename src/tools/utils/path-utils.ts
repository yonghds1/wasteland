/**
 * path-utils.ts - 工具层路径解析与边界校验
 *
 * 统一 read-file / edit-file / write-file / list-directory / grep / glob 等
 * 工具的路径解析逻辑。基于 realpath 防止符号链接穿越与路径遍历。
 */

import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * 安全 realpath：路径不存在时返回 null 而非抛错。
 */
async function safeRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/**
 * 解析路径中已存在部分的符号链接。
 *
 * 对于不存在的尾部（如 write-file 即将创建的新文件），
 * 保留 lexical 路径，仅对存在的祖先目录做 realpath。
 */
async function resolveExistingRealpath(p: string): Promise<string> {
  const real = await safeRealpath(p);
  if (real !== null) {
    return real;
  }
  const parent = dirname(p);
  // 到达根目录仍不存在，直接返回 lexical
  if (parent === p) {
    return p;
  }
  const realParent = await resolveExistingRealpath(parent);
  return resolve(realParent, basename(p));
}

/**
 * 解析路径并确保其真实路径位于工作目录内。
 *
 * 同时防御两类攻击：
 * 1. 路径遍历（`../../etc/passwd`）
 * 2. 符号链接穿越（cwd 内 `ln -s /etc/passwd ./p`，纯词法检查会放行）
 *
 * @param cwd - 当前工作目录（会先做 realpath）
 * @param value - 用户输入路径
 * @returns 真实绝对路径（在 cwd 内），或 null（无效/越界）
 */
export async function resolveWithinCwd(cwd: string, value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const baseCwd = (await safeRealpath(cwd)) ?? cwd;
  const targetPath = resolve(baseCwd, value);
  const resolved = await resolveExistingRealpath(targetPath);

  const rel = relative(baseCwd, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }

  return resolved;
}
