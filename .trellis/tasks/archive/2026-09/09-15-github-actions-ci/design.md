# 设计：CI 接入与锁文件归一化

## 1. Scope / Trigger

触及 CI 基础设施与依赖可复现性，属跨层配置变更，按 code-spec 深度记录。改动面：
`package-lock.json`（304 个 resolved）、新增 `.github/workflows/ci.yml`。不触碰 `src/`。

## 2. 核心问题：锁文件镜像归一化

### 现状证据

```
215  http://mirrors.tencent.com/npm/<pkg>/-/<file>.tgz     ← http 明文
 43  https://registry.npmmirror.com/<pkg>/-/<file>.tgz
 46  https://registry.npmjs.org/<pkg>/-/<file>.tgz          ← 仅 15%
```

`npm ci` 按 lockfile 里的 `resolved` 地址抓包。GitHub runner 在境外，会去 tencent/npmmirror 拉，
且其中 215 个是 `http://`。这条链路能否在 GitHub 网络下稳定工作**不能假设**，必须在设计上消掉。

### 候选方案

**方案 A：外科式改 host（采用）**

逐个 `packages[*].resolved` 重写为 `https://registry.npmjs.org` + 原路径尾部。

- tencent 的路径是 `mirrors.tencent.com/npm/<pkg>/-/<file>.tgz`，`/npm/` 之后的**路径形状与 npmjs 完全一致** → 去掉 `/npm/` 前缀即可拼接。
- npmmirror 路径与 npmjs 形状一致 → 仅换 host。
- **`integrity` 保持原值不动**。

优点：版本零漂移（只改 host 字符串），diff 可一眼看完；且因为 `integrity` 未变，
后续 `npm ci` 若成功，即**证明** npmjs 的 tarball 与原先镜像的逐字节一致（npm 会校验哈希）。
缺点：需要自己写转换，须覆盖 scoped 包（`@scope/name`）与路径边界。

**方案 B：删掉 lockfile 重新生成（弃用）**

`rm package-lock.json && npm install --registry=https://registry.npmjs.org`。

缺点：传递依赖会在 semver 范围内漂移，违反 PRD 的 A2（依赖版本不得漂移），
且会让所有协作者装到与今天不同的树。仅作为方案 A 失败时的退路。

**决策：方案 A**。方案 B 仅在发现某包 integrity 对不上（说明镜像内容与官方不同）时，
针对该包单独处理并报告。

### 验证手段

`npm ci` 会校验 `integrity`。因此：

> 重写 host → `rm -rf node_modules && npm ci` 成功 → **等价于证明了 258 个包的官方 tarball 与记录的哈希一致**。

这比"跑一遍测试"更强：测试绿只能说明行为对，`npm ci` 绿同时说明**内容对**。

## 3. 工作流契约

```yaml
on: [push, pull_request]
strategy.matrix.node-version: [22, 24]
steps: checkout → setup-node(cache: npm) → npm ci → npm run check
concurrency: 按 ref 分组, cancel-in-progress: true
```

- `pull_request` 事件下 CI 会跑来自 fork 的代码，**不引入任何 secrets**，故无泄露面。
- `concurrency` 用 `${{ github.ref }}` 分组：同分支连续 push 时取消旧的排队运行，
  避免陈旧运行白烧免费额度。

## 4. Validation & Error Matrix

| 情形 | 期望行为 |
|---|---|
| 归一化后仍有非 npmjs host | 视为失败（AC1 断言为 0） |
| 某包 `version` 或 `integrity` 变化 | 视为失败，逐包列出（AC2） |
| `npm ci` 哈希校验失败 | 该包镜像内容与官方不同 → 单独报告，不静默跳过 |
| CI 中 Node 22 与 24 行为不一致 | 视为真实发现，记录差异而非放宽矩阵 |
| CI 因额度/网络失败 | 属基础设施问题，与代码无关，需在报告中区分 |

## 5. Rollback

- 工作流：删除 `.github/workflows/ci.yml` 即完全回退（无其他系统依赖它）。CI 未设为合并门禁（PRD C1），
  故删除不阻塞任何流程。
- 锁文件：`git checkout package-lock.json` 即可回退；归一化是纯文本变换，不涉及重新解析依赖图，
  回退后 `npm ci` 行为与改前完全一致。

## 6. 已知遗留（本任务不处理，仅留痕）

- `engines: node >=20` 与矩阵（22/24）不一致：Node 20 已于 2026-04 EOL。见 PRD B5。
- 未开 branch protection：CI 红灯不阻塞合并，约束力是**提示级**的。
  **且这不只是选择**：实测该仓库下 `gh api repos/.../branches/main/protection` 返回
  `403 Upgrade to GitHub Pro or make this repository public` —— 私有仓库在 GitHub Free 上
  该功能**不可用**。日后要把它变成硬门禁，需先改计划或仓库可见性，光点开关不够。
- **同仓分支的重复运行**：`on: [push, pull_request]` 下，给同仓分支开 PR 后，
  一次 push 会同时触发 `push`（refs/heads/x）与 `pull_request`（refs/pull/N/merge）两条，
  而 `concurrency` 按 ref 分组**不会**互相取消 → 4 个 job 而非 2 个。
  若日后嫌费额度，可改为 `push: branches: [main]` + `pull_request`（代价：无 PR 的分支 push 不跑 CI）。
  本任务按 PRD B1 字面实现，保留重复。

## 7. 实测结果（AC6）

真实运行记录（2026-09-15，push 到 main，均 success）：

| run | job | 耗时 |
|---|---|---|
| `34924298354` | check (node 22) | 144s |
| `34924298354` | check (node 24) | 110s |
| `34925010449` | check (node 22 / 24) | success（补 `permissions` 后复跑） |

两个 job 并行，单次 push 墙钟 ≈ 148s。

**计费口径要分清**：GitHub 按**每个 job 向上取整到整分钟**计费，
故 144s→3min、110s→2min，一次 push 计 **5 分钟**而非墙钟的 2.5 分钟。
private 仓库免费额度 2000 分钟/月 → 约 **400 次 push/月**，个人开发仍远用不完。
