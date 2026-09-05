/**
 * copy-assets.mjs - 构建期资产拷贝（替代脆弱的 `cp` 命令）
 *
 * 行为：
 * - 递归拷贝 src/locales 下所有 .json 到 dist/locales
 * - 递归拷贝 src/skins 下所有 .json 到 dist/skins（含子目录，如 system/）
 * - 自动创建目标目录，无需依赖 tsc 先产出 .js 创建目录
 *
 * 新增语言或皮肤 JSON 时无需修改构建脚本，自动包含。
 */

import { cpSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcLocales = resolve(root, 'src/locales');
const distLocales = resolve(root, 'dist/locales');
const srcSkins = resolve(root, 'src/skins');
const distSkins = resolve(root, 'dist/skins');

/** 递归拷贝目录下所有 .json 文件（保留子目录结构）。 */
function copyJsonAssets(src, dist) {
  mkdirSync(dist, { recursive: true });
  cpSync(src, dist, {
    recursive: true,
    filter: (srcPath) => {
      const st = statSync(srcPath);
      // 目录：始终遍历；文件：仅 .json
      return st.isDirectory() || srcPath.endsWith('.json');
    },
  });
}

copyJsonAssets(srcLocales, distLocales);
copyJsonAssets(srcSkins, distSkins);

console.log('[copy-assets] locales + skins copied to dist/');
