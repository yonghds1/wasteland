# 执行计划：CI 接入与锁文件归一化

## 顺序（A 必须在 B 之前）

A 是 B 的前提：若锁文件仍指向国内镜像，CI 的首个 `npm ci` 就可能挂，届时无法判断 CI 配置本身有没有问题。

### A. 锁文件归一化

- [ ] **A-0 留底**：`cp package-lock.json /tmp/lock.before.json`，并导出逐包 `{version, integrity}` 快照
      （以 `packages` 的 key 为包标识；根 `""` 条目跳过）。
- [ ] **A-1 重写 host**：对每个 `packages[*].resolved`：
      - `http://mirrors.tencent.com/npm/` → `https://registry.npmjs.org/`
      - `https://registry.npmmirror.com/` → `https://registry.npmjs.org/`
      - 已是 npmjs 的不动
      `integrity` 与 `version` 一律不碰。注意 scoped 包路径（`@scope/name`）。
- [ ] **A-2 断言 AC1**：`grep -c 'mirrors.tencent.com\|registry.npmmirror.com' package-lock.json` → 0。
- [ ] **A-3 断言 AC2**：对比快照，`version` 与 `integrity` 逐包必须零差异；有差异则逐条列出并停下报告。
- [ ] **A-4 断言 AC3**：`rm -rf node_modules && npm ci`。哈希校验通过即证明内容与改前一致。
- [ ] **A-5 断言 AC4**：`npm run check` exit 0。

### B. 工作流

- [ ] **B-1**：写 `.github/workflows/ci.yml`：`on: [push, pull_request]`；
      `strategy.matrix.node-version: [22, 24]`；`setup-node` 开 `cache: npm`；
      步骤 `npm ci` → `npm run check`；`concurrency` 按 ref 且 `cancel-in-progress: true`。
- [ ] **B-2**：本地先验 yaml 语法（`python3 -c "import yaml,..."` 或 actionlint 若有）。
- [ ] **B-3**：提交并推送 main。
- [ ] **B-4 断言 AC5**：`gh run list` / `gh run watch` 确认该 workflow 真实跑过，
      矩阵两个 Node 版本均绿。**这是本任务唯一的"真的会跑"证据，必须实测，不接受"文件已写"。**
- [ ] **B-5 断言 AC6**：记录 CI 单次耗时，写入本任务 `prd.md` 或 design.md 的遗留节。

## 验证命令汇总

```bash
# AC1
grep -c 'mirrors.tencent.com\|registry.npmmirror.com' package-lock.json   # 期望 0

# AC2（快照对比，脚本产出差异清单）
python3 - <<'PY'
import json
a=json.load(open('/tmp/lock.before.json'))['packages']
b=json.load(open('package-lock.json'))['packages']
def snap(d): return {k:(v.get('version'),v.get('integrity')) for k,v in d.items() if k}
sa,sb=snap(a),snap(b)
print("新增:",sorted(set(sb)-set(sa))); print("消失:",sorted(set(sa)-set(sb)))
print("版本/哈希差异:",[ (k,sa[k],sb[k]) for k in set(sa)&set(sb) if sa[k]!=sb[k] ])
PY

# AC3 / AC4
rm -rf node_modules && npm ci && npm run check; echo "exit=$?"

# AC5
gh run list --workflow=ci.yml --limit 5
gh run watch
```

## Review gates

- **G1（A-3 之后）**：版本/哈希零差异 + `npm ci` 成功。任一不满足 → 停下报告，不进入 B。
- **G2（B-3 之前）**：`npm run check` 本地全绿。
- **G3（B-4）**：CI 实跑绿。未见真实运行结果前，不得声称任务完成。

## Rollback points

| 阶段 | 回退动作 |
|---|---|
| A 任何一步失败 | `cp /tmp/lock.before.json package-lock.json && npm ci` |
| B 工作流有问题 | 删除 `.github/workflows/ci.yml` 并推送（CI 非合并门禁，删除不阻塞任何人） |
