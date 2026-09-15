# First-run Config Init Command

## Goal

新用户首次启动 wasteland/joe 时不再遭遇 `Role orchestrator references undefined model: (未设置)` 报错。通过 Ink 引导式初始化流程，让用户在 1 分钟内完成 provider + model + apiKey 的配置，自动生成 `~/.wasteland/settings.json` 与 `~/.wasteland/auth.json`，然后无缝进入 TUI。

## Requirements

### 功能
- **入口 A：自动引导** — CLI 入口 `run()` 加载配置后，若 `settings.models` 为空且 stdin/stdout 为 TTY → 自动进入引导流程；完成后重新加载配置继续原命令
- **入口 B：显式 `wasteland init`** — 显式重跑引导，若已有配置则报错退出（除非 `--force`）
- **Provider 类型**：只提供两种通用选项
  - `openai-compatible`（用户填 baseUrl）
  - `anthropic`（用户填 baseUrl，默认 `https://api.anthropic.com`）
- **收集信息**：provider 名（用户命名，用于配置 key）、type、baseUrl、apiKey、model 名
- **写入**：
  - `~/.wasteland/settings.json` 包含 `providers.<name>` + `models.default` + `runtime.defaultModel = "default"`
  - `~/.wasteland/auth.json` 存 apiKey，settings 用 `{"$auth":"<name>_api_key"}` 引用
- **保留** `runtime.defaultRole = "orchestrator"`（不修改内置默认）
- **非交互环境**：非 TTY 直接打印错误 + 手写配置说明，退出码 1
- **原子性**：settings 与 auth 使用临时文件 + rename，或先都构造好再依次写
- **i18n**：跟随 `runtime.language`（zh/en）

### UX
- Ink 组件 `InitWizard`：
  1. 欢迎 + 说明将写入的文件路径
  2. Provider type 单选（openai-compatible / anthropic）
  3. Provider 名字（默认从 baseUrl 猜，可编辑）
  4. baseUrl 输入
  5. apiKey 掩码输入
  6. model 名字输入
  7. 确认摘要 + Enter 提交
  8. 显示写入结果，Enter 继续
- 全流程 Ctrl+C 可中断

## Acceptance Criteria

- [ ] 空配置下运行 `wasteland`，自动进入 InitWizard；完成后 TUI 正常启动
- [ ] `wasteland init` 已有配置时报错并列出配置路径；`--force` 覆盖
- [ ] 生成的 settings.json 通过 `loadWastelandSettings` + `resolveChatRuntime` 无异常
- [ ] 生成的 auth.json 仅包含引用到的 key
- [ ] 非 TTY 下运行报错退出（不 hang）
- [ ] Ctrl+C 中断不留下半写的文件
- [ ] 单元测试覆盖：写入器（settings/auth 序列化 + 原子写）、检测器（`isConfigEmpty`）
- [ ] 组件测试覆盖：InitWizard 完整流程（用 ink-testing-library 或纯函数化状态机）

## Definition of Done

- 新增 `src/commands/init.ts` + `src/tui/InitWizard.tsx` + `src/config/config-writer.ts`
- 修改 `src/cli.ts` 加自动触发
- 修改 `src/commands/init.ts` 注册显式命令
- 单元测试 + 一个手动验证脚本（`scripts/verify-init.sh`）
- `pnpm test` / `pnpm lint` / `pnpm build` 全绿
- `docs/user-guide/configuration.md` 增加"首次使用"章节

## Technical Approach

### 触发时机
在 `src/cli.ts run()` 里，`loadWastelandSettings` 之后判断：
```ts
const needsInit = Object.keys(loadedSettings.settings.models).length === 0
                  && Object.keys(loadedSettings.settings.providers).length === 0;
if (needsInit && isTTY() && cliArgs[0] !== 'init') {
  await runInitWizard();  // 阻塞式 Ink render
  loadedSettings = await loadWastelandSettings(...);  // 重新加载
}
```

### 组件位置
- `src/tui/InitWizard.tsx` — Ink 组件，接收 callback 拿到用户输入
- `src/config/config-writer.ts` — 纯函数：`writeInitialConfig(input)`，负责序列化 + 原子写
- `src/commands/init.ts` — commander 命令，包一层 args 处理（--force）

### 原子写实现
先写临时文件 `settings.json.tmp` / `auth.json.tmp`，都成功后再各自 rename。若中途失败，清理 tmp。

### 数据结构
```ts
type InitInput = {
  providerName: string;   // 用户输入，如 "deepseek"
  providerType: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  modelId: string;        // 如 "deepseek-chat"
};
```
写入的 settings.json：
```json
{
  "runtime": { "defaultModel": "default" },
  "providers": {
    "<providerName>": {
      "type": "<providerType>",
      "baseUrl": "<baseUrl>",
      "apiKey": { "$auth": "<providerName>_api_key" }
    }
  },
  "models": {
    "default": { "provider": "<providerName>", "model": "<modelId>" }
  }
}
```
auth.json:
```json
{ "<providerName>_api_key": "<apiKey>" }
```

## Decision (ADR-lite)

**Context**: 新用户首次运行报错 `Role orchestrator references undefined model`，因为没有任何配置且项目无首次引导。

**Decision**:
1. 加自动引导（cli.ts 入口检测空配置 → InitWizard）+ 显式 `wasteland init`
2. 用 Ink 复用 TUI 技术栈
3. 只暴露两种通用 provider type（不维护预设列表），把选择权和责任交给用户
4. apiKey 走 auth.json + $auth 引用，与文档一致

**Consequences**:
- ✅ 消除首次运行硬报错，UX 从"看错误信息+读文档"降到"跟着填四五个框"
- ✅ 不引入 provider 预设的维护负担
- ⚠️ 用户需要自己知道 baseUrl 和 model 名（可通过文档 + 空占位符缓解）
- ⚠️ Ink 引导 unmount 后再启动 TUI 需处理 stdin/stdout 竞争（分别用两次 `render()` 应该 OK，Ink 会在 unmount 时释放）

## Out of Scope

- Provider 预设列表（DeepSeek/GLM/OpenAI 等）—— 后续可加
- 测试连接（发 hello 请求验证 apiKey）—— v2
- 迁移旧 `~/.joe/` 配置 —— 单独任务
- 完整的账号体系
- 非交互模式（env vars / --provider 等 CLI 参数）—— 后续可加

## Technical Notes

- `src/config/settings-types.ts:171` — 默认配置源头，本任务**不改**
- `src/config/resolve-chat-runtime.ts:241` — modelNotDefined 报错处
- `src/cli.ts:39` — `run()` 入口，插入自动触发的位置
- `src/config/paths.ts:34/45` — 用户配置路径解析
- `src/ui/tty-detect.ts` — 已有 TTY 检测工具
- `docs/user-guide/configuration.md` — 配置文档
- 依赖：无需新增（ink/react 已在）

## 收口记录（2026-09-15）

src/commands/init.ts 在位（141 行），用 ink render 做交互式引导，文件头注释即「交互式生成 ~/.wasteland/settings.json 与 auth.json」。
