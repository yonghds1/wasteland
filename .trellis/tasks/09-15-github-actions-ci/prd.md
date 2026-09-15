# 接入 GitHub Actions CI（含锁文件镜像归一化）

## Goal

仓库已有六道门禁（`npm run check` = typecheck → lint → validate:i18n → check:locale-parity →
check:contrast → vitest，1580 用例），但它们只在人记得跑的时候才跑。实证代价已经出现过：
main 上 `src/tools/agent/spawn-agent/__tests__/sidecar.test.ts:73` 的 lint error 长期为红而无人察觉
（2026-09-15 修复）。

本任务把门禁接上 GitHub Actions，使其在每次 push / PR 上自动执行；并解决阻碍它在 GitHub runner
上复现的前提问题——锁文件里 258 个依赖指向国内镜像。

## Requirements

### A. 锁文件可复现化（前置）

- **A1**：`package-lock.json` 中所有 `resolved` 字段的 host 收敛为 `https://registry.npmjs.org`。
  现状：304 个 resolved 中 215 个指向 `http://mirrors.tencent.com/npm`（**http 明文**）、
  43 个指向 `registry.npmmirror.com`、仅 46 个是 npmjs。
- **A2**：**依赖版本不得漂移**。归一化只应改 host，不得借机升级/降级；`integrity` 字段保持原值
  （镜像 tarball 与官方同源，哈希应当一致；若某包哈希对不上，说明内容不同，必须单独报告而非静默接受）。
- **A3**：`npm ci` 从干净检出可成功执行——这是 CI 的第一步，也是本任务的验收前提。
- **A4**：归一化后全量 `npm run check` 仍绿（证明改 host 未改变实际安装内容）。

### B. CI 工作流

- **B1**：新增 `.github/workflows/ci.yml`，在 `push` 与 `pull_request` 上触发。
- **B2**：Node 版本矩阵为 **22 与 24**（22 = 当前 LTS，24 = 本地开发版本 v24.16.0）。
- **B3**：步骤为 `checkout` → `setup-node`（含 npm 缓存）→ `npm ci` → `npm run check`。
- **B4**：并发控制：同一分支的旧运行在新 push 时应被取消（`concurrency` + `cancel-in-progress`），
  避免排队的陈旧运行占用免费额度。
- **B5**：`engines` 当前声明 `node: >=20`，但 **Node 20 已于 2026-04 EOL**。矩阵不含 20（用户决策），
  因此该声明会给出"支持已停止维护的运行时"的误导。本任务**只报告该不一致，不擅自改 `engines`**
  ——改它属于对使用者的语义承诺变更，需单独决定。

### C. 约束

- **C1**：**不开启 branch protection**（用户决策）：本任务只让 CI 跑起来并提供绿/红提示，
  不设为合并硬门禁。因此 CI 失败不阻塞任何人的合并动作。
- **C2**：CI 只做校验，不做发布。不配置 npm publish、不引入 secrets、不写 release 流程。

## Acceptance Criteria

- [x] AC1：`grep -c 'mirrors.tencent.com\|registry.npmmirror.com' package-lock.json` 结果为 0。
      —— 实测 0；host 分布收敛为 `{'registry.npmjs.org': 304}`。
- [x] AC2：归一化前后 `package.json` 的 dependencies/devDependencies 版本范围逐字未变；
      且 lockfile 中各包 `version` 与 `integrity` 逐包一致。
      —— 实测 304 条快照对比：无新增、无消失、无差异。`package.json` 未改动。
      （过程中发现 2 个 `https://` 前缀的 tencent URL，首轮 `http://` 替换未覆盖，第二轮补齐。）
- [x] AC3：干净环境下 `npm ci` 成功。
      —— 实测 `rm -rf node_modules && npm ci` → added 251 packages，7s。
      哈希校验通过即证明 npmjs tarball 与原镜像逐字节一致（方案 A 成立的核心证据）。
- [x] AC4：归一化后 `npm run check` exit 0。
      —— 实测 exit 0，112 文件 / 1580 用例通过 / 3 跳过。
- [x] AC5：`.github/workflows/ci.yml` 在 main 上，且在 GitHub 上**实际跑过**。
      —— 实测 run `34924298354`：conclusion **success**；
      `check (node 22)` success、`check (node 24)` success。
- [x] AC6：CI 单次耗时已记录。
      —— node 22 = 144s、node 24 = 110s，合计约 4.2 分钟/push；见 design.md 第 7 节。

## Out of Scope

- branch protection / required status checks（用户决定暂不开启）。
- 锁定 `engines` 到 `>=22`（见 B5，只报告不一致）。
- CI 缓存优化之外的构建加速、测试分片、并行 job 拆分。
- 发布流水线（npm publish、release、ghcr 等）。
- 其他 CI 提供方（CircleCI / GitLab CI）。
