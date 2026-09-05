/**
 * bump-version.mjs - 自动自增 package.json 小版本 (patch version)
 *
 * 每次执行构建时默认将 patch 版本自增 (如 0.1.0 -> 0.1.1 -> 0.1.2)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(root, 'package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version || '0.1.0';

const parts = currentVersion.split('.').map((n) => parseInt(n, 10));
if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
  parts[2] += 1;
  const newVersion = parts.join('.');
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[bump-version] 🚀 Version bumped: ${currentVersion} -> ${newVersion}`);
} else {
  console.warn(`[bump-version] ⚠️ Could not parse semver from "${currentVersion}", skipping bump.`);
}
