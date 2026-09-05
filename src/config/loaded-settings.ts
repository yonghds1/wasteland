/**
 * loaded-settings.ts - 已加载配置的进程级缓存
 *
 * 由 CLI 入口（cli.ts）在启动时设置，供 initializeRuntime 复用，
 * 避免每个子命令重复加载配置。用模块单例替代 globalThis，提供类型安全。
 */

import { loadWastelandSettings } from './load-settings.js';
import type { LoadedWastelandSettings } from './settings-types.js';

let cached: LoadedWastelandSettings | undefined;

export function setLoadedSettings(settings: LoadedWastelandSettings | undefined): void {
  cached = settings;
}

export function getLoadedSettings(): LoadedWastelandSettings | undefined {
  return cached;
}

export function clearLoadedSettings(): void {
  cached = undefined;
}

/**
 * 复用入口缓存的配置；未缓存时才加载（避免子命令重复磁盘 I/O）
 */
export async function getOrLoadSettings(
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<LoadedWastelandSettings> {
  return getLoadedSettings() ?? (await loadWastelandSettings({ cwd, env }));
}
