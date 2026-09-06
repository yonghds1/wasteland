# Wasteland 本地开发与发布测试指南 (README.dev.md)

本文档面向开发者，说明如何在本机进行本地开发调试、构建编译、以及**完全模拟真实 npm 发布与全局安装流程**进行端到端验证。

---

## 🛠️ 本地开发与调试指令 (npm)

```bash
# 1. 启动初始化向导 (配置 ~/.wasteland/)
npm run setup          # 首次初始化
npm run setup:force    # 强制覆盖重新配置

# 2. 源码热执行 (无需提前 build)
npm run dev                      # 启动 TUI 交互界面
npm run dev -- setup --force     # 通过 dev 模式运行向导
npm run dev -- chat --message "你好"

# 3. 运行代码检查与全量测试套件
npm run check:fast    # 日常/PR 前：typecheck + lint（秒级）
npm run check         # 合并/CI 前：全链（typecheck + lint + i18n + parity + contrast + 全量测试）
npm test              # 只跑测试（vitest 直跑 src，无需先构建）
npm run test:full     # 发布前：先构建再测，验证构建产物不断
```

---

## 📦 构建体系与版本控制机制

项目的构建由 `npm run build` 统一编排：

1. **小版本自动自增 (Auto Patch Bump)**：每次执行 `build` 打包时，`scripts/bump-version.mjs` 会自动递增 `package.json` 中的 patch 小版本号（如 `0.1.1` -> `0.1.2`）；
2. **输出目录显式指定**：TypeScript 编译指定输出至 `dist/` 目录（已加入 `.gitignore` 避免污染源码仓库）；
3. **别名路径重写**：`scripts/fix-dist-paths.mjs` 将 TS 路径别名（如 `@core/*`）自动转换为相对路径以支持原生 Node.js ESM；
4. **静态资产同步**：`scripts/copy-assets.mjs` 自动拷贝多语言包（`dist/locales/`）与皮肤配置（`dist/skins/`）。

> 💡 **提示**：如果仅想编译而不递增版本号（例如执行单测时），可使用 `npm run build:no-bump`。

### 版本号纪律（必读）

`npm run build` 每次都会自动 +patch，**反复打测试包会导致版本号无意义漂移**（如一天内从 0.2.0 漂到 0.2.15）：

| 场景 | 用法 |
|---|---|
| 本地开发/调试 | `npm run dev`（跑源码，不构建） |
| 打测试包自测 | `npm run build:no-bump` → `npm pack` → `npm install -g ./wasteland-<ver>.tgz`（版本号不动） |
| 正式发版 | 手动把 `package.json` 定到目标号（小功能 `0.x.0`，修 bug 才跟随自增），再 `npm run build` + `npm pack` + `npm publish` |

规则一句话：**只有正式发版才允许版本号变化；测试包永远 no-bump。**

---

## 🧪 模拟发布与本地全局安装测试

通过 `npm pack` 生成真实的 tarball 压缩包并在本机全局安装，可以 100% 还原用户从 npm 官方仓库下载安装的场景：

### 1. 打包本地 Tarball
在项目根目录下执行：

```bash
# 运行构建并生成发布 tarball (会自动触发 prepublishOnly 与资产打包)
npm pack
```

执行后会在根目录下生成 `wasteland-<version>.tgz`（例如 `wasteland-0.1.1.tgz`）。

> **核对清单**：检查输出的文件清单，确保 `dist/` 下的 `.js` 以及 `dist/locales/*.json`、`dist/skins/*.json` 均已打包在内。

---

### 2. 从本地 Tarball 全局安装

```bash
# 本地全局安装当前生成的最新包
npm install -g ./wasteland-*.tgz

# 验证全局版本号是否与 package.json 一致
wasteland --version
```

---

### 3. 跨目录端到端测试

切换到任意**非 wasteland 源码目录**（例如新建一个临时目录），进行真实用户场景验证：

```bash
# 1. 进入纯净测试目录
mkdir -p /tmp/wasteland-test && cd /tmp/wasteland-test

# 2. 运行强制初始化向导 (生成 ~/.wasteland/)
wasteland setup --force

# 3. 验证非交互式单次指令
wasteland chat --message "请确认当前环境"

# 4. 启动交互式 TUI 主界面
wasteland
```

---

### 4. 核心验证 Checklist

- [ ] **全局命令可用性**：输入 `wasteland` 能正常响应，`--version` 动态输出最新自增版本。
- [ ] **人设皮肤正常加载**：
  - 多 Agent 模式：主脑为 **【不死军阀】(`warlord-immortal`)**，子 Agent 池包含 **【狂暴领航】(`fury-vanguard`)**、**【重装机修】(`v8-mechanic`)**、**【荒原猎犬】(`sand-scout`)**、**【弹药裁决】(`bullet-tester`)**、**【喷火盲琴】(`doof-analyst`)**；
  - 单 Agent 模式：主角色为 **【荒原独行客】(`road-nomad`)**。
- [ ] **多语言切换正常**：在向导 Step 0 切换中文/英文，界面即时切换且成功落盘到 `~/.wasteland/settings.json`。
- [ ] **工作目录无污染**：在 `/tmp/wasteland-test` 测试目录下运行后，确认当前目录没有产生意外生成的垃圾文件。

---

## 🧹 卸载与清理

```bash
# 1. 卸载全局 wasteland
npm uninstall -g wasteland

# 2. 删除根目录下生成的 .tgz 测试包
rm -f wasteland-*.tgz
```
