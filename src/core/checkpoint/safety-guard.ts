/**
 * safety-guard.ts - 敏感文件过滤与 3-Way Hash 外部并发冲突检测
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConflictDetail } from './checkpoint-types.js';

const pExecFile = promisify(execFile);

const IGNORED_DIR_NAMES = new Set(['.git', '.wasteland', 'node_modules', 'dist', '.venv', 'target']);
const SENSITIVE_FILE_PATTERNS = [/^\.env(?:\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_rsa(?:.*)?$/i];

/** 判断指定相对路径是否属于被忽略的目录或敏感文件（凭证、私钥等） */
export function isIgnoredOrSensitive(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg && IGNORED_DIR_NAMES.has(seg)) return true;
  }
  const baseName = segments[segments.length - 1] ?? '';
  if (IGNORED_DIR_NAMES.has(baseName)) return true;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
}

/** 获取 Git 排除路径规则，用于在 git add / status 中排除系统与敏感路径 */
export function getGitExcludePathspecs(): string[] {
  return [
    ':!.git', ':!.git/**', ':!.wasteland', ':!.wasteland/**',
    ':!node_modules', ':!node_modules/**', ':!dist', ':!dist/**',
    ':!.venv', ':!.venv/**', ':!target', ':!target/**',
    ':!.env*', ':!*.pem', ':!*.key', ':!id_rsa*',
  ];
}

/** 按照 Git 标准计算内容的 Blob Hash (SHA-1) */
export function computeGitBlobHash(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  return createHash('sha1').update(header).update(content).digest('hex');
}

/** 自动探测 Git 目录（常规 .git 或 wasteland 裸仓库） */
function resolveGitDirForTree(cwd: string, explicitGitDir?: string): string | undefined {
  if (explicitGitDir) return explicitGitDir;
  if (fsSync.existsSync(path.join(cwd, '.git'))) return undefined;
  const bareDir = path.join(cwd, '.wasteland', 'checkpoints.git');
  if (fsSync.existsSync(bareDir)) return bareDir;
  return undefined;
}

/** 从 Git 树中提取文件 blob hash 映射 */
async function getTreeBlobHashes(
  cwd: string,
  treeHash: string,
  gitDir?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!treeHash) return map;
  const effectiveGitDir = resolveGitDirForTree(cwd, gitDir);
  const args = effectiveGitDir ? ['--git-dir', effectiveGitDir] : [];
  args.push('ls-tree', '-r', treeHash);
  try {
    const { stdout } = await pExecFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const meta = line.slice(0, tabIdx).trim().split(/\s+/);
      const filePath = line.slice(tabIdx + 1).trim();
      const hash = meta[2];
      if (hash && filePath) map.set(filePath, hash);
    }
  } catch {
    // 树可能不存在或为空
  }
  return map;
}

/**
 * 3-Way Hash 检查：比对基线树、智能体快照树与当前工作区磁盘文件，检测是否存在外部并发修改
 */
export async function checkExternalConflict(
  cwd: string,
  baseTreeHash: string,
  files: string[],
  agentTreeHash?: string,
  gitDir?: string,
): Promise<ConflictDetail[]> {
  const conflicts: ConflictDetail[] = [];
  if (!agentTreeHash) {
    return conflicts;
  }

  const baseHashes = await getTreeBlobHashes(cwd, baseTreeHash, gitDir);
  const agentHashes = await getTreeBlobHashes(cwd, agentTreeHash, gitDir);

  for (const relPath of files) {
    if (isIgnoredOrSensitive(relPath)) continue;
    const fullPath = path.resolve(cwd, relPath);
    let diskHash: string | null = null;
    try {
      const content = await fs.readFile(fullPath);
      diskHash = computeGitBlobHash(content);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // 文件在磁盘上已不存在，保持 diskHash 为 null
      } else {
        continue;
      }
    }

    const baseHash = baseHashes.get(relPath) ?? null;
    const agentHash = agentHashes.get(relPath) ?? null;

    // 3-Way 判定：磁盘既不等于基线，也不等于 Agent 生成态
    if (diskHash !== agentHash && diskHash !== baseHash) {
      conflicts.push({
        path: relPath,
        reason: 'File modified externally outside agent loop (3-way conflict)',
      });
    }
  }

  return conflicts;
}
