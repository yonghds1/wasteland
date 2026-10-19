/**
 * path-utils.ts - 工具层路径解析与跨平台边界安全治理
 *
 * 统一收口跨平台（POSIX / Windows）路径规范化、边界校验与输入清洗。
 * 杜绝 Windows 反斜杠污染、驱动器盘符大小写不一致导致的伪越界与穿越攻击。
 */

import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * 将任意路径转换为规范的 POSIX 风格路径：
 * 1. 反斜杠 `\` 替换为正斜杠 `/`；
 * 2. 消除多余的连续重复斜杠（保留协议头如 `file:///` 与 UNC 根 `//`）；
 * 3. 规范化 Windows 驱动器盘符为统一大写格式（例如 `c:/` -> `C:/`）。
 *
 * @param p - 原始路径字符串
 * @returns 规范化的 POSIX 格式路径
 */
export function toPosixPath(p: string): string {
  if (typeof p !== 'string' || p.length === 0) {
    return '';
  }

  const s = p.replace(/\\/g, '/');
  let prefix = '';
  let rest = s;

  // 1. 保留已知协议头（协议名至少 2 个字符，避免将 C:/ 盘符误判为协议）
  const protoMatch = /^(file:\/\/\/|[a-zA-Z][a-zA-Z0-9+.-]+:\/\/)/.exec(s);
  if (protoMatch) {
    prefix = protoMatch[1];
    rest = s.slice(prefix.length);
  } else if (s.startsWith('//') && !s.startsWith('///')) {
    // 2. Windows UNC 路径或 POSIX 网络根目录（//server/share）
    prefix = '//';
    rest = s.slice(2);
  } else if (s.startsWith('/')) {
    prefix = '/';
    rest = s.slice(1);
  }

  // 消除多余连续斜杠
  rest = rest.replace(/\/+/g, '/');
  if (prefix === '/' && rest.startsWith('/')) {
    rest = rest.replace(/^\/+/, '');
  }

  let result = prefix + rest;

  // 3. 规范化 Windows 驱动器盘符为统一大写（C:/、C: 或 file:///C:/）
  result = result.replace(/^([a-zA-Z]):\/+/, (_, d: string) => `${d.toUpperCase()}:/`);
  result = result.replace(/^([a-zA-Z]):(?=[^/]|$)/, (_, d: string) => `${d.toUpperCase()}:`);
  result = result.replace(/^(file:\/\/\/)([a-zA-Z]):/, (_, pre: string, d: string) => `${pre}${d.toUpperCase()}:`);

  return result;
}

/**
 * 结合 Node path.normalize 并转换为统一 POSIX 风格。
 *
 * 处理 Windows 盘符与相对段（`..`、`.`）计算，抹平操作系统差异。
 *
 * @param p - 输入路径
 * @returns 规范化的 POSIX 路径
 */
export function normalizePath(p: string): string {
  if (typeof p !== 'string' || p.length === 0) {
    return '';
  }

  const protoMatch = /^(file:\/\/\/|[a-zA-Z][a-zA-Z0-9+.-]+:\/\/)/.exec(p);
  if (protoMatch) {
    const proto = protoMatch[1];
    const rest = p.slice(proto.length);
    return toPosixPath(proto + normalizePath(rest));
  }

  const hasWinDrive = /^[a-zA-Z]:[/\\]/.test(p) || /^[a-zA-Z]:$/.test(p);
  const normalized = hasWinDrive || p.includes('\\')
    ? path.win32.normalize(p)
    : path.normalize(p);

  return toPosixPath(normalized);
}

/**
 * 跨平台安全的子路径判定，处理 Windows 大小写不敏感问题。
 *
 * @param parent - 父路径或基准目录
 * @param child - 子路径或目标路径
 * @returns 是否属于子路径（包含 parent 与 child 相同的情况）
 */
export function isSubPath(parent: string, child: string): boolean {
  if (!parent || !child) {
    return false;
  }

  const normParent = normalizePath(parent);
  const normChild = normalizePath(child);

  // Windows 驱动器或 win32 平台下不区分大小写
  const isCaseInsensitive = process.platform === 'win32' || /^[a-zA-Z]:/.test(normParent);
  const p = isCaseInsensitive ? normParent.toLowerCase() : normParent;
  const c = isCaseInsensitive ? normChild.toLowerCase() : normChild;

  if (p === c) {
    return true;
  }

  const parentWithSlash = p.endsWith('/') ? p : `${p}/`;
  return c.startsWith(parentWithSlash);
}

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
async function resolveExistingRealpath(
  p: string,
  pMod: typeof path.win32 | typeof path,
): Promise<string> {
  const real = await safeRealpath(p);
  if (real !== null) {
    return real;
  }
  const parent = pMod.dirname(p);
  // 到达根目录仍不存在，直接返回 lexical
  if (parent === p) {
    return p;
  }
  const realParent = await resolveExistingRealpath(parent, pMod);
  return pMod.resolve(realParent, pMod.basename(p));
}

/**
 * 解析路径并确保其真实路径严格位于工作目录（cwd）内。
 *
 * 防御与修复：
 * 1. 修复 Windows 盘符大小写不一致导致的伪越界缺陷（对齐盘符后再做 relative 计算）；
 * 2. 精准阻断跨目录遍历攻击（如 `../../etc/passwd`、`..\\..\\etc\\passwd`）；
 * 3. 防御符号链接穿越攻击（基于 realpath 解析祖先节点）；
 * 4. 最终返回规范化的 POSIX 绝对路径，杜绝在下游留下反斜杠隐患。
 *
 * @param cwd - 当前工作目录
 * @param value - 用户输入的路径参数
 * @returns 规范化的 POSIX 绝对路径（在 cwd 内），或 null（无效/越界）
 */
export async function resolveWithinCwd(cwd: string, value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const isWin =
    /^[a-zA-Z]:[/\\]/.test(cwd) ||
    /^[a-zA-Z]:$/.test(cwd) ||
    cwd.startsWith('\\\\') ||
    /^[a-zA-Z]:[/\\]/.test(value) ||
    value.includes('\\') ||
    process.platform === 'win32';
  const pMod = isWin ? path.win32 : path;

  const baseCwd = (await safeRealpath(cwd)) ?? cwd;
  const targetPath = pMod.resolve(baseCwd, value);
  const resolved = await resolveExistingRealpath(targetPath, pMod);

  const normBaseCwd = toPosixPath(baseCwd);
  const normResolved = toPosixPath(resolved);

  // 统一对齐 Windows 驱动器盘符大小写（统一为大写）以消除伪越界
  const alignDrive = (str: string) => str.replace(/^([a-zA-Z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  const alignedBase = alignDrive(normBaseCwd);
  const alignedResolved = alignDrive(normResolved);

  const rel = path.posix.relative(alignedBase, alignedResolved);
  if (rel.startsWith('..') || path.posix.isAbsolute(rel)) {
    return null;
  }

  return normResolved;
}

/**
 * 常见路径字段键名集合（全部小写以供快速匹配）
 */
const PATH_KEY_PATTERNS = new Set([
  'path',
  'filepath',
  'cwd',
  'file',
  'dir',
  'directory',
  'targetpath',
  'sourcepath',
  'destination',
  'dest',
  'outputpath',
  'inputpath',
  'include',
  'exclude',
  'basedir',
  'workdir',
  'rootdir',
  'folder',
  'paths',
  'files',
]);

/**
 * 判定键名是否为路径相关的属性名
 */
function isPathKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (PATH_KEY_PATTERNS.has(lower)) {
    return true;
  }
  return (
    lower.endsWith('path') ||
    lower.endsWith('filepath') ||
    lower.endsWith('dir') ||
    lower.endsWith('directory') ||
    lower.endsWith('filename')
  );
}

/**
 * 递归深度清洗工具输入参数中的所有路径字段为 POSIX 规范格式。
 *
 * 针对常见的路径字段（path, filePath, cwd, file, dir, include, exclude 等）
 * 以及数组、嵌套对象自动调用 `toPosixPath`，不影响非路径字段（如 content, command）。
 *
 * @param input - 任意工具输入对象
 * @returns 字段被安全规整后的新对象
 */
export function normalizeToolInputPaths<T extends Record<string, unknown>>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) =>
      typeof item === 'object' && item !== null
        ? normalizeToolInputPaths(item as Record<string, unknown>)
        : item,
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (isPathKey(key)) {
      if (typeof value === 'string') {
        result[key] = toPosixPath(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (typeof item === 'string') {
            return toPosixPath(item);
          }
          if (typeof item === 'object' && item !== null) {
            return normalizeToolInputPaths(item as Record<string, unknown>);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = normalizeToolInputPaths(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = normalizeToolInputPaths(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
