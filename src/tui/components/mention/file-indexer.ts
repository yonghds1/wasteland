import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 缓存数据结构
 */
interface FileCache {
  timestamp: number;
  files: string[];
}

const CACHE_TTL_MS = 2000;
let fileCache: FileCache | null = null;

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.wasteland',
  '.gemini',
  '.turbo',
  '.cache',
  'coverage',
]);

/**
 * 递归收集文件（在非 git 仓库或 git 命令失败时的兜底）
 */
function scanFilesRecursively(baseDir: string, currentDir: string, maxFiles = 3000): string[] {
  const result: string[] = [];
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (result.length >= maxFiles) break;
    const name = entry.name;
    if (IGNORED_DIRS.has(name) || name.startsWith('.')) continue;

    const fullPath = join(currentDir, name);
    try {
      if (entry.isDirectory()) {
        result.push(...scanFilesRecursively(baseDir, fullPath, maxFiles - result.length));
      } else if (entry.isFile()) {
        result.push(relative(baseDir, fullPath));
      }
    } catch {
      // 忽略无权限或已删除文件
    }
  }

  return result;
}

/**
 * 获取工作区文件列表（优先 git ls-files，具备内存防抖缓存）
 */
export function getWorkspaceFiles(cwd = process.cwd()): string[] {
  const now = Date.now();
  if (fileCache && now - fileCache.timestamp < CACHE_TTL_MS) {
    return fileCache.files;
  }

  let files: string[];

  try {
    // 优先尝试 git ls-files，速度极快
    const stdout = execSync('git ls-files -co --exclude-standard', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
    files = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    // 降级使用目录递归扫描
    try {
      files = scanFilesRecursively(cwd, cwd);
    } catch {
      files = [];
    }
  }

  fileCache = {
    timestamp: now,
    files,
  };

  return files;
}

/**
 * 测试用：重置缓存
 */
export function resetFileCacheForTest(): void {
  fileCache = null;
}
