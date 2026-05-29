/**
 * symlink-manager.ts - 符号链接管理器
 *
 * 负责检查和创建角色别名符号链接
 * 在 CLI 启动时自动检测并创建缺失的符号链接
 * 切换皮肤时自动删除旧的符号链接，创建新的
 */

import { access, mkdir, readdir, symlink, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { t } from "../locales/index.js";

const execFileAsync = promisify(execFile);

// 当前皮肤 ID（用于跟踪切换）
let currentSkinId: string | null = null;

/**
 * 检查文件是否存在
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取项目根目录
 */
async function getProjectRoot(): Promise<string> {
  // 从当前文件位置向上查找 package.json
  let dir = process.cwd();
  while (dir !== "/") {
    const pkgPath = join(dir, "package.json");
    if (await fileExists(pkgPath)) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

/**
 * 确保 bin/links 目录存在
 */
async function ensureLinksDir(projectRoot: string): Promise<string> {
  const linksDir = join(projectRoot, "bin", "links");
  await mkdir(linksDir, { recursive: true });
  return linksDir;
}

/**
 * 创建符号链接
 */
async function createSymlink(target: string, linkPath: string): Promise<void> {
  try {
    // 如果符号链接已存在，先删除
    await unlink(linkPath);
  } catch {
    // 符号链接不存在，忽略错误
  }

  await symlink(target, linkPath);
}

/**
 * 删除符号链接（保留 install.sh 和 wasteland.js）
 */
async function removeRoleAliases(linksDir: string): Promise<void> {
  try {
    const entries = await readdir(linksDir);
    for (const entry of entries) {
      // 保留 install.sh 和 wasteland 主入口
      if (entry === "install.sh" || entry === "wasteland") {
        continue;
      }

      const entryPath = join(linksDir, entry);
      try {
        await unlink(entryPath);
      } catch {
        // 删除失败，忽略
      }
    }
  } catch {
    // 读取目录失败，忽略
  }
}

/**
 * 运行 create-aliases.sh 脚本
 */
async function runCreateAliasesScript(projectRoot: string, skinId: string): Promise<void> {
  const scriptPath = join(projectRoot, "scripts", "create-aliases.sh");

  if (!(await fileExists(scriptPath))) {
    return;
  }

  try {
    await execFileAsync("bash", [scriptPath, skinId], {
      cwd: projectRoot,
      timeout: 30000,
    });
  } catch (error) {
    // 脚本执行失败，忽略
    console.warn(t("utils.failedToRunScript"), error);
  }
}

/**
 * 检查并创建角色别名符号链接
 *
 * 逻辑：
 * 1. 首次加载时，如果符号链接不存在，创建它们
 * 2. 切换皮肤时，删除旧的符号链接，创建新的
 */
export async function ensureRoleAliases(skinId: string = "immortan-joe"): Promise<void> {
  const projectRoot = await getProjectRoot();
  const linksDir = await ensureLinksDir(projectRoot);

  // 主命令符号链接（始终存在）
  const mainLink = join(linksDir, "wasteland");
  if (!(await fileExists(mainLink))) {
    await createSymlink("../wasteland.js", mainLink);
  }

  // 检查是否切换了皮肤
  if (currentSkinId !== null && currentSkinId !== skinId) {
    // 切换皮肤：删除旧的角色别名符号链接
    await removeRoleAliases(linksDir);
  }

  // 更新当前皮肤 ID
  currentSkinId = skinId;

  // 检查角色别名符号链接是否存在
  // 通过 get-role-aliases.js 获取别名列表
  const getAliasesScript = join(projectRoot, "scripts", "get-role-aliases.js");
  if (await fileExists(getAliasesScript)) {
    try {
      const { stdout } = await execFileAsync("node", [getAliasesScript, skinId], {
        cwd: projectRoot,
        timeout: 10000,
      });

      const aliases: string[] = JSON.parse(stdout.trim());

      // 检查第一个别名的符号链接是否存在
      if (aliases.length > 0) {
        const firstAliasLink = join(linksDir, aliases[0]);
        if (!(await fileExists(firstAliasLink))) {
          // 符号链接不存在，运行 create-aliases.sh 创建
          await runCreateAliasesScript(projectRoot, skinId);
        }
      }
    } catch {
      // 获取别名失败，运行脚本创建
      await runCreateAliasesScript(projectRoot, skinId);
    }
  }
}

/**
 * 切换皮肤并更新符号链接
 */
export async function switchSkin(newSkinId: string): Promise<void> {
  const projectRoot = await getProjectRoot();
  const linksDir = await ensureLinksDir(projectRoot);

  // 删除旧的角色别名符号链接
  await removeRoleAliases(linksDir);

  // 更新当前皮肤 ID
  currentSkinId = newSkinId;

  // 运行 create-aliases.sh 创建新的符号链接
  await runCreateAliasesScript(projectRoot, newSkinId);
}

/**
 * 检查指定命令的符号链接是否存在
 */
export async function hasCommandAlias(alias: string): Promise<boolean> {
  const projectRoot = await getProjectRoot();
  const linksDir = join(projectRoot, "bin", "links");
  const linkPath = join(linksDir, alias);

  return fileExists(linkPath);
}

/**
 * 获取符号链接路径
 */
export async function getSymlinkPath(alias: string): Promise<string> {
  const projectRoot = await getProjectRoot();
  return join(projectRoot, "bin", "links", alias);
}
