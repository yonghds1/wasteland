# nightowl --version 读取 package.json 真实版本

## Goal

`nightowl --version` 目前显示 `0.1.0`,因为 `src/cli.ts` 第 25 行硬编码了版本号,与 `package.json` 实际版本(0.1.1)漂移。改为从 `package.json` 读取真实版本。

## What I already know

- `src/cli.ts:25` `.version('0.1.0')` 硬编码
- `pkgRoot()` 已能定位包根,可 `readFileSync` 读 package.json
- 版本号只应有一个来源:package.json(已由 npm version 维护)

## Requirements (evolving)

- `nightowl --version` 输出 package.json 的真实 version

## Acceptance Criteria (evolving)

- [ ] `nightowl --version` 输出 `0.1.x` 与 package.json 一致
- [ ] 无硬编码版本残留

## Out of Scope (explicit)

- 其他 CLI 改动

## Technical Notes

- 目标文件 `/home/ubuntu/workspace/nightowl/src/cli.ts`
- 读版本:`JSON.parse(fs.readFileSync(path.join(pkgRoot(), 'package.json'), 'utf8')).version`
