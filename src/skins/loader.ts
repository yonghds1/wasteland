/**
 * skins/loader.ts - 皮肤文件加载器
 *
 * 支持从 `skins.json` 加载皮肤定义和 agent 分配。
 * 支持 singleAgent 和 multiAgent 两种模式。
 *
 * ## 加载优先级
 *
 * - 内置默认（default-skins.json）→ 兜底
 * - 用户级 `~/.wasteland/skins.json` → 全局偏好
 * - 项目级 `<cwd>/.wasteland/skins.json` → 项目特化（最高优先）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Skin } from './types.js';

// ============================================================
// 类型定义
// ============================================================

/** 皮肤定义（对象格式，按 ID 键） */
export type SkinsDefinition = Record<string, Skin>;

/** 单 agent 皮肤配置 */
export interface SingleAgentSkinConfig {
  skin: string;
}

/** skins.json 完整格式 */
export interface SkinsFile {
  skins: SkinsDefinition;
  singleAgent: SingleAgentSkinConfig;
}

/** 加载结果 */
export interface LoadedSkins {
  skins: SkinsDefinition;
  singleAgent: SingleAgentSkinConfig;
}

// ============================================================
// 内置默认
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defaultSkinsFile: SkinsFile = JSON.parse(
  readFileSync(join(__dirname, 'default-skins.json'), 'utf-8')
);

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 skins.json 文件
 *
 * @param dir - 目录路径
 * @returns 皮肤文件，文件不存在返回 null
 */
async function loadSkinsFile(dir: string): Promise<SkinsFile | null> {
  const filePath = join(dir, 'skins.json');
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as SkinsFile;
  } catch {
    return null;
  }
}

/**
 * 合并皮肤定义（高优先覆盖低优先）
 *
 * @param base - 基础皮肤定义
 * @param override - 覆盖皮肤定义
 * @returns 合并后的皮肤定义
 */
export function mergeSkins(base: SkinsDefinition, override: SkinsDefinition): SkinsDefinition {
  return { ...base, ...override };
}

/**
 * 合并单 agent 配置（高优先覆盖低优先）
 *
 * @param base - 基础配置
 * @param override - 覆盖配置
 * @returns 合并后的配置
 */
export function mergeSingleAgent(
  base: SingleAgentSkinConfig,
  override: SingleAgentSkinConfig
): SingleAgentSkinConfig {
  return { ...base, ...override };
}

// ============================================================
// 优先级加载
// ============================================================

/**
 * 带优先级的皮肤加载
 *
 * 按优先级从低到高加载：
 * 1. 内置默认（兜底）
 * 2. 用户级 `~/.wasteland/skins.json`
 * 3. 项目级 `<cwd>/.wasteland/skins.json`
 *
 * @param userDir - 用户级目录（~/.wasteland）
 * @param projectDir - 项目级目录（<cwd>/.wasteland）
 * @returns 合并后的皮肤数据
 */
export async function loadSkinsWithPriority(
  userDir?: string,
  projectDir?: string
): Promise<LoadedSkins> {
  // 1. 内置默认
  let skins = { ...defaultSkinsFile.skins };
  let singleAgent = { ...defaultSkinsFile.singleAgent };

  // 2. 用户级覆盖
  if (userDir) {
    const userFile = await loadSkinsFile(userDir);
    if (userFile) {
      skins = mergeSkins(skins, userFile.skins);
      singleAgent = mergeSingleAgent(singleAgent, userFile.singleAgent);
    }
  }

  // 3. 项目级覆盖（最高优先）
  if (projectDir) {
    const projectFile = await loadSkinsFile(projectDir);
    if (projectFile) {
      skins = mergeSkins(skins, projectFile.skins);
      singleAgent = mergeSingleAgent(singleAgent, projectFile.singleAgent);
    }
  }

  return { skins, singleAgent };
}

/**
 * 确保用户级 skins.json 存在
 *
 * @param userDir - 用户级目录（~/.wasteland）
 */
export async function ensureUserSkinsFile(userDir: string): Promise<void> {
  const filePath = join(userDir, 'skins.json');
  try {
    await readFile(filePath, 'utf-8');
  } catch {
    await mkdir(userDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(defaultSkinsFile, null, 2), 'utf-8');
  }
}
