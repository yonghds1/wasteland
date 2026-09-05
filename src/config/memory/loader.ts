/**
 * memory/loader.ts - 项目记忆加载器
 *
 * 从 `memory.md` 加载持久项目记忆，支持用户级/项目级覆盖。
 * 镜像 `roles/loader.ts` 的优先级加载模式。
 *
 * ## 加载优先级（从低到高）
 *
 * - 用户级 `~/.wasteland/memory.md` → 全局基线
 * - 项目级 `<cwd>/.wasteland/memory.md` → 项目特化（追加在后，优先传达）
 *
 * 记忆是自由文本，无法做字段级覆盖，故采用"拼接"而非"覆盖"：
 * 用户级在前、项目级在后，用 `---` 分隔。二者都不存在时返回空字符串。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** memory.md 文件名 */
export const MEMORY_FILENAME = 'memory.md';

export type LoadedMemory = {
  /** 合并后的记忆文本（markdown），无记忆时为空字符串 */
  memory: string;
};

/**
 * 读取单个 memory.md 文件
 *
 * @param dir - 目录路径
 * @returns 文件内容（trim 后）；文件不存在或读失败返回空字符串
 */
async function loadMemoryFile(dir: string): Promise<string> {
  const filePath = join(dir, MEMORY_FILENAME);
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.trim();
  } catch {
    return '';
  }
}

/**
 * 带优先级的项目记忆加载
 *
 * 按优先级从低到高加载：
 * 1. 用户级 `~/.wasteland/memory.md`（全局基线）
 * 2. 项目级 `<cwd>/.wasteland/memory.md`（项目特化）
 *
 * 合并顺序：用户级在前、项目级在后，用 `---` 分隔。
 * 仅当存在时参与拼接，都为空时返回空字符串。
 *
 * @param userDir - 用户级目录（~/.wasteland）
 * @param projectDir - 项目级目录（<cwd>/.wasteland）
 * @returns 合并后的记忆文本
 */
export async function loadMemoryWithPriority(
  userDir?: string,
  projectDir?: string
): Promise<LoadedMemory> {
  const parts: string[] = [];

  if (userDir) {
    const userMemory = await loadMemoryFile(userDir);
    if (userMemory) parts.push(userMemory);
  }

  if (projectDir) {
    const projectMemory = await loadMemoryFile(projectDir);
    if (projectMemory) parts.push(projectMemory);
  }

  return { memory: parts.join('\n\n---\n\n') };
}