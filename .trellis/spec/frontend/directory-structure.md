# Directory Structure

> Current status / 当前状态：Ink + React TUI 已建立，并明确拆分视觉 theme、内容 skin 与语言 i18n。

---

## Frontend Roots / 前端根目录

```text
src/
  theme/                    # 视觉契约聚合层
    wasteland/              # 固定 TUI 视觉：颜色、排版、间距、装饰、动画
    palette.ts              # 共享 palette token 解析层（SkinPalette / resolvePalette）
    contrast.ts             # vendored APCA 0.0.98G-4g 对比度计算
  skins/                    # 皮肤注册表（types/registry/loader/index）
    system/common.ts        # 与角色无关的系统级内容键（skins.system.*）
    default-skins.json      # 内置皮肤：label/thinking/greeting/catchphrases + 可选 colors
  config/prompts/           # 角色 prompt 模板与 persona 组装（role-templates / prompt-assembler）
  locales/                  # en/zh 翻译资源与运行时解析
  tui/                      # Ink React 组件、hooks、context
  ui/                       # CLI 终端 renderer 与输入/输出适配器
```

代表路径：

- `src/theme/wasteland/index.ts`：唯一视觉主题入口 `wastelandTheme`
- `src/theme/palette.ts`：palette token 注册表与 `resolvePalette(skin) → ResolvedSkinPalette`
- `src/theme/contrast.ts`：`apcaContrast()` / `assertContrast()`（APCA 0.0.98G-4g vendored）
- `src/skins/index.ts`：皮肤注册表 API（`getSkin` / `getSingleAgentSkin` / `listSkins` / `getSkinContrastIssue`）
- `src/skins/default-skins.json`：内置皮肤定义（`label`/`thinking`/`greeting`/`catchphrases` + 可选 `colors`）
- `src/config/prompts/`：角色 prompt 模板（`role-templates.ts`）与 persona 组装（`prompt-assembler.ts`）
- `src/tui/components/ChatMessageList.tsx`：消费 theme、palette、skin 和 i18n 的组件
- `src/tui/wizard/`：InitWizard 拆分模块（`types`/`presets`/`validation` + `basic-`/`input-`/`provider-`/`role-steps`），主文件只剩状态机与路由
- `src/tui/hooks/runtime-reducers/`：事件归约分域模块（session/agent/tool/usage），约定见 `state-management.md`
- `src/tui/hooks/useLogsKeymap.ts`：LogsPage 全键盘交互（与 LogsPage 同名解构传参，handler 正文搬运零改动）

---

## Ownership Rules / 目录职责

- `src/theme/wasteland/` 只定义 UI 怎么画，不得包含角色、用户文案或 LLM prompt。
- `src/theme/palette.ts` 持有 `paletteTokens`（共享 palette token 名 → hex）；皮肤通过 `SkinPalette` 引用 token，`resolvePalette()` 解析为 hex。
- `src/theme/contrast.ts` 提供 APCA 对比度校验；调用方（`src/skins/index.ts`、`scripts/check-contrast.ts`）负责触发，不自动在 module load 时执行。
- `src/skins/system/` 定义与角色无关的内容键；角色皮肤文案（`default-skins.json` 的 `label`/`thinking`/`greeting`/`catchphrases`）是**内联字面量**，不经 locale 查找。
- `src/skins/`（根目录）定义皮肤注册表与内置皮肤。
- `src/locales/` 保存可见 TUI 文案；英文 persona 与角色皮肤字面量不进入翻译文件。
- `src/tui/` 在渲染时通过 `t(...)` / `tArray(...)` 解析系统级键，并从 `resolvePalette(skin)` + `wastelandTheme` 读取视觉值。
- 不再在 `src/tui/utils/` 建立颜色常量镜像，也不在 skin 对象中保存颜色、间距或动画。

---

## Adding Content / 扩展规则

- 新增视觉 token：放到对应 `src/theme/wasteland/*.ts` 文件，并从 `index.ts` 聚合。
- 新增 palette token（皮肤复用）：放到 `src/theme/palette.ts` 的 `paletteTokens` 对象。优先复用 `wastelandColors.*`；仅当基础色无法满足 APCA Lc 75/60/45 时新增 `role.label.*` / `role.thinking.*`。
- 新增角色：在 `.wasteland/roles.json` 定义（或改内置 `src/config/roles/default-roles.ts`），再由 `settings.json` 的 `multiAgent[name]` 以 `{ role, skin }` 引用。
- 新增 TUI 皮肤：往 `src/skins/default-skins.json`（内置）或 `.wasteland/skins.json` / `~/.wasteland/skins.json`（用户级）加一条 `{ id, label, thinking[], greeting[], catchphrases[], colors? }`。见 `.trellis/spec/guides/skin-development-guide.md` 完整流程。
- 新增系统级 TUI 文案：同时在 `src/locales/en.json` 和 `src/locales/zh.json` 添加同结构键；跑 `npm run check:locale-parity` 校验。角色皮肤文案是内联字面量，不进 locale。
- 新增皮肤颜色：先用 `paletteTokens` 中已有 token；仅在所有现有 token 都无法满足 APCA 时才新增 `role.*` token，并跑 `npm run check:contrast` 验证。
