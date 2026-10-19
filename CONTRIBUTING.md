# Wasteland 贡献指南

感谢你对 Wasteland 项目的关注与贡献！为了保证代码库的长期可维护性、高内聚与跨平台鲁棒性，请在提交代码前仔细阅读本规范。

---

## 目录

1. [开发环境与快速开始](#开发环境与快速开始)
2. [硬性架构红线](#硬性架构红线)
3. [双层质量验收门禁](#双层质量验收门禁)
4. [跨平台 POSIX 路径治理](#跨平台-posix-路径治理)
5. [废土皮肤（Persona）扩展指引](#废土皮肤persona扩展指引)
6. [本地诊断与排障（Doctor）](#本地诊断与排障doctor)
7. [Git 提交与 PR 规范](#git-提交与-pr-规范)

---

## 开发环境与快速开始

### 基础环境要求

- **Node.js**: >= 20.0.0（推荐 Node.js 22 LTS）
- **npm**: >= 9.0.0
- **Git** & **ripgrep**（可选但推荐）

### 快速开始

```bash
# 1. 克隆代码库
git clone https://github.com/your-org/wasteland.git
cd wasteland

# 2. 安装依赖
npm install

# 3. 启动开发模式（TUI）
npm run dev

# 4. 运行本地健康检查
npm run dev -- doctor
```

---

## 硬性架构红线

为防止代码膨胀与架构退化，所有贡献者与维护者必须严格遵守以下架构红线：

### 1. 单文件行数限制（<= 500 行）

- **硬性上限**：任何源文件或测试文件单文件行数严格限制在 **<= 500 行**。
- **原子化拆分**：一旦模块接近或超过 500 行，必须按照单一职责原则拆解为子模块（如拆分为独立的 parser、types、helpers 或 pipeline）。严禁在一个文件内堆砌业务逻辑。

### 2. 严格类型安全（Strict TypeScript）

- 开启 TypeScript Strict 模式，禁止无理由使用 `any`。
- 仅导入类型时，强制使用 `import type { ... } from '...'`。
- 核心状态流转优先使用判别联合（Discriminated Unions），提高类型推导精度。

### 3. Co-located 单元测试

- 测试文件使用 **Vitest** 运行器，统一放置在被测源码同级的 `__tests__/` 目录下（如 `src/tools/__tests__/task-tools.test.ts`）。
- 测试用例必须具备确定性与原子性，杜绝偶发性失败与未清理的副作用。

---

## 双层质量验收门禁

在提交代码前，请确保通过项目设置的质量门禁：

### 1. 快速检查门禁（本地提交前必跑）

```bash
# 运行 TypeScript 类型检查与 ESLint 代码风格检查
npm run check:fast
```

> **要求**：必须保证 `0 errors`！任何语法错误、类型缺失或 ESLint 错误都将直接阻断合并。

### 2. 完整检查门禁（CI 合并门禁）

```bash
# 全流程门禁：类型 + Lint + i18n 完整性 + APCA 对比度 + 全量测试
npm run check
```

完整门禁内部依次包含以下步骤：

- `npm run typecheck`：全量 TypeScript 类型校验；
- `npm run lint`：ESLint 代码规范与安全扫描；
- `npm run check:i18n`：检查多语言文案同步率（`validate:i18n` + `check:locale-parity`）；
- `npm run check:contrast`：验证所有内置皮肤的 APCA 视力可访问性对比度；
- `npm test`：运行全量 Vitest 单元测试。

### 3. 单独测试命令

```bash
# 运行全量单元测试
npm test

# 运行单个测试文件或目录
npx vitest run src/tools/__tests__/task-tools.test.ts

# 观察模式运行测试
npm run test:watch
```

---

## 跨平台 POSIX 路径治理

Wasteland 面向 Linux、macOS 与 Windows 跨平台环境。为彻底杜绝 Windows 反斜杠（`\`）导致的边界穿透与大小写盘符不一致问题：

- **统一路径规范**：在任何工具层、配置层或文件操作层，必须使用 `src/tools/utils/path-utils.ts` 导出的 `toPosixPath`：

  ```typescript
  import { toPosixPath } from '../utils/path-utils.js';

  const normalizedPath = toPosixPath(inputPath);
  ```

- **禁止直接拼接反斜杠**：切勿硬编码 `\\` 或假定路径分隔符为特定系统字符。
- **边界安全校验**：涉及工作区范围限制的文件读写，必须结合 `assertWithinAllowedRoots` 防范路径穿越攻击。

---

## 废土皮肤（Persona）扩展指引

Wasteland 拥有沉浸式的废土终端风格系统，角色皮肤（Skin）与底层 Agent 职责正交解耦。

### 1. 皮肤定义格式

在 `src/skins/default-skins.json` 或用户配置 `.wasteland/skins.json` 中配置：

```json
{
  "id": "my-custom-persona",
  "label": "荒原行者",
  "thinking": ["正在扫描辐射废墟...", "重新校准盖革计数器..."],
  "greeting": ["欢迎来到新加州废土。"],
  "catchphrases": ["辐射尘永不眠。"],
  "colors": {
    "label": "#00ff66",
    "text": "#e0e0e0",
    "thinking": "#888888"
  }
}
```

### 2. APCA 视力对比度校验

为确保在暗色终端下良好的可读性，所有皮肤配色必须通过 APCA（Advanced Perceptual Contrast Algorithm）算法校验：

```bash
# 验证皮肤对比度
npm run check:contrast
```

新增或修改皮肤必须满足 label、text、thinking 相对背景色的对比度阈值，若未达标门禁将报错。

---

## 本地诊断与排障（Doctor）

开发中如果遇到模型供应商无法连接、环境变量缺失、终端乱码或依赖问题，请使用 Wasteland 内置的诊断工具：

```bash
# 运行系统健康诊断
npx wasteland doctor
# 或在源码开发环境下：
npm run dev -- doctor

# 输出 JSON 格式结构化诊断报告
npx wasteland doctor --json
```

`doctor` 诊断将逐项探测：

- Node.js 版本兼容性与运行时环境
- Git / ripgrep 命令可用性
- 终端 TTY 与颜色支持能力（TrueColor / 256 色）
- `.wasteland/settings.json` 配置文件结构与供应商连通性
- 已注册皮肤有效性与 APCA 对比度

**提示**：在 GitHub 提交 Bug Report 时，请附上 `wasteland doctor` 的输出，这有助于快速定位环境差异。

---

## Git 提交与 PR 规范

### Commit Message 格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <short summary>

[optional body]
```

- **Type**:
  - `feat`: 新增特性或工具
  - `fix`: 修复 Bug
  - `refactor`: 重构代码（既不修复 bug 也不增加新特性）
  - `perf`: 性能优化
  - `test`: 增加或修改测试用例
  - `docs`: 文档变更
  - `chore`: 构建过程或辅助工具变动
- **Scope**: 例如 `(provider)`, `(tui)`, `(tools)`, `(skins)`, `(config)` 等。

### PR 预合并自检

每个 PR 合并前，提交者需自检：

1. 是否所有修改与新建文件单文件行数严格 `<= 500` 行？
2. 是否通过 `npm run check:fast` 且 0 错误？
3. 是否补充了相应的 Vitest 单元测试并全部通过？
4. 是否涉及国际化并更新了对应语言包？
