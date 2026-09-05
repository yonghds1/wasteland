/**
 * fix-dist-paths.mjs - 构建后把 dist 内的 tsconfig 路径别名改写为相对路径
 *
 * 背景：tsconfig.json 的 `paths`（如 @config/*）只是编译期映射，tsc 会原样
 * 输出到 dist/*.js，Node 运行时无法解析，导致构建产物完全无法启动
 * （bin/wasteland.js 报 ERR_MODULE_NOT_FOUND）。
 *
 * 本脚本遍历 dist/**\/*.js 与 *.d.ts，把别名说明符改写为正确的相对路径。
 * 别名表与 tsconfig.json 保持同步；注意 @core/skills 映射到 src/skills（特例）。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(rootDir, 'dist');

// 与 tsconfig.json paths 同步；长前缀优先匹配（避免 @core 吞掉 @core/xxx）
const ALIASES = [
  ['@core/skills', 'skills'],
  ['@core/shared', 'core/shared'],
  ['@core/runtime', 'core/runtime'],
  ['@core/logger', 'core/logger'],
  ['@core', 'core'],
  ['@config', 'config'],
  ['@providers', 'providers'],
  ['@tools', 'tools'],
  ['@locales', 'locales'],
  ['@skins', 'skins'],
  ['@acp', 'acp'],
  ['@theme', 'theme'],
  ['@ui', 'ui'],
  ['@tui', 'tui'],
].sort((a, b) => b[0].length - a[0].length);

// 匹配引号包裹、以已知别名开头且后跟 '/' 的模块说明符（覆盖 static/dynamic import 与 export from）
const ALIAS_SPECIFIER =
  /(['"])(@(?:core|config|providers|tools|locales|skins|acp|theme|ui|tui)\/[^'"\n]+)\1/g;

function resolveAlias(specifier) {
  for (const [alias, srcSub] of ALIASES) {
    if (specifier.startsWith(`${alias}/`)) {
      const rest = specifier.slice(alias.length + 1);
      return { distTarget: join(distDir, srcSub, rest) };
    }
  }
  return null;
}

let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;

function processFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  let changed = false;

  const next = source.replace(ALIAS_SPECIFIER, (_match, quote, specifier) => {
    const hit = resolveAlias(specifier);
    if (!hit) return _match;
    let rel = relative(dirname(filePath), hit.distTarget).split('\\').join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    changed = true;
    rewrittenSpecifiers++;
    return `${quote}${rel}${quote}`;
  });

  if (changed) {
    writeFileSync(filePath, next);
    rewrittenFiles++;
  }
}

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
      walk(full);
    } else if (name.endsWith('.js') || name.endsWith('.d.ts')) {
      processFile(full);
    }
  }
}

walk(distDir);

console.log(
  `[fix-dist-paths] rewrote ${rewrittenSpecifiers} alias specifiers across ${rewrittenFiles} files`
);
