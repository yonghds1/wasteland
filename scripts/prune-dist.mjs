/**
 * prune-dist.mjs - 发布前清理 dist/
 *
 * npm 的 "files" 白名单无法被 .npmignore 否定，因此在打包前直接删除：
 * 所有 __tests__/ 目录（tsc 会把 src 内的单测一并编译，不应随包发布）。
 *
 * 注：sourcemap 已在 tsconfig 关闭（Node ≥22 默认启用 source maps，
 * 若只删 .map 而残留 sourceMappingURL 注释，运行时会 ERR_MODULE_NOT_FOUND）。
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');

let removedDirs = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === '__tests__') {
        rmSync(full, { recursive: true, force: true });
        removedDirs++;
        continue;
      }
      walk(full);
    }
  }
}

walk(distDir);

console.log(`[prune-dist] removed ${removedDirs} __tests__ dirs from dist/`);
