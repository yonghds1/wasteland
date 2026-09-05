# nightowl review 修复

## Goal

修复对 nightowl（~/workspace/nightowl，npm 包 @yonghds1/nightowl，0.1.3）全面 review 发现的 5 个问题：3 个 P1 功能 bug + 2 个 P2/P3。修复后重发 0.1.4。

## Requirements

### R1 (P1) --dir 全局选项失效
- **现状**: `src/paths.ts` 的 `baseDir` 在模块加载时用 `process.cwd()` 固定;`src/cli.ts` 的 `preAction` chdir 发生在模块加载之后,`--dir` 读写的是旧 cwd。
- **修复**: baseDir 惰性化——`let baseDir: string | null = null`;`getBaseDir()` 返回 `baseDir ?? path.join(process.cwd(), '.nightowl')`;`POOL_FILE()` 等改用 `getBaseDir()`。`setBaseDir()` 注入测试临时目录仍生效。
- **验证**: `nightowl --dir D2 init --skip-permissions` 在 D2 建 `.nightowl/`(而非当前目录);`--dir D2 status` 读 D2 任务池。

### R2 (P1) git 命令 stderr 泄漏到终端
- **现状**: `src/git.ts` `execFileSync` 未指定 stdio,stderr 默认继承。git 失败时(如空仓库 `rev-parse`)fatal 打到终端,污染 run 调度循环解析的协议输出。
- **修复**: `execFileSync` 加 `stdio: ['pipe','pipe','pipe']`,stderr 只进 `err.stderr`,不打印。
- **验证**: 空仓库 `git(['rev-parse',...])` 时终端无 fatal 行,`r.stderr` 含内容。

### R3 (P1) sweep 在空仓库误报主 worktree
- **现状**: 空仓库(unborn)下 `git rev-parse --abbrev-ref HEAD` 返回 `HEAD`(非分支名),主 worktree 不被跳过,输出 `master\t<path>\t` 而非 `SWEEP_CLEAN`;且 R2 泄漏的 fatal 行进一步污染输出。
- **修复**: `src/commands/sweep.ts` 改用 `git worktree list --porcelain` 解析(明确标注 branch/detached/unborn),跳过当前 worktree(HEAD 等于当前 HEAD 或 branch 等于当前分支)。
- **验证**: 空仓库 sweep → 仅 `SWEEP_CLEAN`;有残留 worktree 仍输出 `{branch}\t{path}\t{unmerged}`(detached 用 hash 标识,unborn 跳过)。

### R4 (P2) dist 残留 install-skill 死文件
- **现状**: `tsc` 不清理 outDir,已删的 `install-skill.ts` 的 `.js/.d.ts/.map` 仍在 dist 并被打进发布的 tarball。
- **修复**: `package.json` scripts 加 `"clean": "rm -rf dist"`,`build` 改为 `npm run clean && tsc -p tsconfig.json`;删除当前 dist 残留。postbuild(locales 复制)保留。
- **验证**: `npm run build` 后 dist 无 install-skill 文件;`npm pack` 列表干净。

### R5 (P3) done 审查关口黑名单 → 白名单
- **现状**: `src/commands/done.ts` 只拒绝 `FAIL` 和缺失,放行任意其他值;Python 契约是白名单(仅 PASS/PASS_WITH_NITS)。
- **修复**: `if (!['PASS','PASS_WITH_NITS'].includes(result))` 拒绝。
- **验证**: `review --result FAIL` 后 done 拒绝;`review --result CHANGES_REQUESTED`(非法值)也拒绝;PASS/PASS_WITH_NITS 放行。

## Acceptance Criteria

- [ ] R1: `--dir` 跨目录 init/status 读写正确目标目录
- [ ] R2: git 失败 stderr 不泄漏到终端
- [ ] R3: 空仓库 sweep 输出 `SWEEP_CLEAN`,残留 worktree 输出正常
- [ ] R4: build 后 dist 无 install-skill 残留,npm pack 干净
- [ ] R5: done 只放行 PASS/PASS_WITH_NITS
- [ ] 全部新增/修改测试通过,typecheck + vitest 全绿
- [ ] 协议输出冒烟(RESUME_*/NO_TASK/PUSH_*/SWEEP_CLEAN/CHECKPOINT_*)不回归
- [ ] 提交 + push nightowl main;npm 发布 0.1.4 + 全局更新验证

## Definition of Done

- typecheck/build/vitest 全绿
- 协议输出回归测试通过
- 提交并推送 GitHub yonghds1/nightowl
- npm 0.1.4 发布并全局安装验证(用户放行时)

## Technical Notes

- 涉及文件(nightowl 仓库):
  - `src/paths.ts`(R1 baseDir 惰性化)
  - `src/cli.ts`(确认 preAction 与惰性 baseDir 配合;`thisCommand.opts().dir` 已验证可取)
  - `src/git.ts`(R2 stdio pipe)
  - `src/commands/sweep.ts`(R3 porcelain 解析)
  - `src/commands/done.ts`(R5 白名单)
  - `package.json`(R4 clean+build)
  - `test/`(新增/修改:paths 惰性、sweep 空仓库、done 白名单)
- 机器协议标记必须保持英文硬编码:`SWEEP_CLEAN`、`{branch}\t{path}\t{unmerged}` 等。
- 本次 review 已确认基础全绿:typecheck/build/46 tests/zh-en 137 key 对称。
- 后续待办(非本次范围):发布 0.1.4 需用户放行;wasteland 内嵌技能清理。
