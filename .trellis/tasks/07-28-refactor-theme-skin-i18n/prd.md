# refactor: theme 拆分 + skin 角色化（按级别）+ i18n

## Goal

把 wasteland 当前的"主题/皮肤/角色/i18n"混杂实现拆成清晰的三层：

1. **theme**（UI 视觉层）：颜色、字体、间距、装饰、动画——**只**管 UI 怎么画
2. **skin**（内容层，按级别分）：系统级 + 角色级——管 TUI 文字 + minimax persona
3. **i18n**（语言层）：TUI 文字按用户语言切换；minimax persona 统一英文

让主 agent minimax 看到 persona（之前完全缺失），同时保持皮肤内容 i18n 友好。

## What I already know

- 当前 `src/tui/utils/colors.ts` 是 wasm 颜色常量（PRIMARY/MUTED/SUCCESS 等）—— **实际是 wasteland 主题**，应迁到 `src/theme/`
- 当前 `src/skins/immortan-joe/index.ts` 单文件混杂了 theme（labels/messages/banner）+ skin（roles.main.greeting）内容
- 已有 i18n 系统（`src/locales/{en,zh}.json` + `src/locales/i18n.ts` 的 `t()` 函数）
- 之前 PR1+PR2 已完成：subAgents 配置生效（subAgents.promptVariables 注入 minimax prompt）+ 主 agent 工具集最小化为 `[spawn_agent, read-file, bash]`
- `runtime.language` 已在 settings.json 配（zh / en）
- 主 agent minimax 看到 ROLE_ORCHESTRATOR（功能性调度 prompt），无 persona
- 子 agent minimax 看到 ROLE_WORKER + subAgentConfig.promptVariables（功能描述，无皮肤）
- TUI 渲染时用 `skin?.ui.X`（混杂 theme + skin 字段）
- 之前测试 minimax 在 thinking 里复读 "ROOT_SYSTEM_POLICY"—— minimax 没看到 persona

## Assumptions (temporary)

- wasteland 项目固定废土主题——**只** 1 个 theme（wasteland），不引入多主题
- 皮肤（Mad Max 角色）项目内嵌 3 个：immortan-joe（主）/ nux（信息收集、年轻战士）/ furiosa（分析、精确指挥）
- minimax 是 LLM，英文 persona 通用（minimax 训练数据多语言，看到英文 persona 不影响输出中文）
- settings.json 的 subAgentConfig.promptVariables 统一英文（移除 `.zh` 字段）
- 之前 PR1+2 改动保留（spawn-agent.ts 工具限定、主 agent 工具集最小化）

## Open Questions

- (已通过讨论收敛) Q1: theme = UI 视觉；skin = 内容（系统级+角色级）；不混
- (已收敛) Q2: minimax persona 用英文（minimax 多语言能力强，英文最稳定）
- (已收敛) Q3: settings.json subAgentConfig promptVariables 统一英文（移除 `.zh` 字段）

## Requirements

### R1: theme/ 层（UI 视觉）

- `src/theme/wasteland/colors.ts`：颜色方案（废土黄/橙 + 暗背景 + 语义色 + 交互色）
- `src/theme/wasteland/typography.ts`：字体（family=monospace + weight + size）
- `src/theme/wasteland/spacing.ts`：padding/margin/border 宽度
- `src/theme/wasteland/decorations.ts`：border style + ASCII banner
- `src/theme/wasteland/animations.ts`：spinnerIntervalMs + typewriterRateMs 常量
- `src/theme/wasteland/index.ts`：wastelandTheme = { colors, typography, spacing, decorations, animations }
- 主题只管 UI 怎么画——**不**含任何文本/角色/prompt

### R2: skins/ 层（内容按级别）

- `src/skins/system/common.ts`：系统级 UI（user/system/tool labels + 通用 messages），**不**依赖任何角色
- `src/skins/roles/immortan-joe/persona.ts`：minimax 看到的 persona（英文："You are wasteland Immortan Joe..."）
- `src/skins/roles/immortan-joe/roleUi.ts`：角色专属 TUI 文字（i18n key：labelKey/thinkingKey/greetingKey）
- `src/skins/roles/nux/`：nux 角色（信息收集、年轻战士）
- `src/skins/roles/furiosa/`：furiosa 角色（分析、精确指挥）
- `src/skins/roles/index.ts`：角色注册表（roles map + defaultRoleSkin = 'immortan-joe'）

### R3: i18n（语言层）

- `src/locales/en.json` + `src/locales/zh.json` 加 `skins.{role}.{key}` 节点
- TUI 渲染用 `t(skin.roleUi.labelKey)` 解析
- minimax persona prompt **不**翻译（固定英文）

### R4: subAgentSettings.skin 字段

- `SubAgentSettings` 加 `skin?: string` 字段（默认 `defaultRoleSkin`）
- `assembleSubAgentPrompt` 读 `subAgentConfig.skin` → 加载皮肤 → 注入 persona 到 minimax prompt
- settings.json 默认 researcher/developer/analyst/tester 的 `skin` 字段

### R5: 主 agent persona 注入

- `useRuntime.ts` / `chat.ts` / `resume.ts`：runAgentLoop 前，从 `runtime.skin` 读 `persona`，组装主 agent system prompt

### R6: 全局替换

- `skin?.ui.X` → `selectedSkin.roleUi.X`（角色专属）+ `systemCommon.X`（系统级）
- `import { PRIMARY } from '../utils/colors.js'` → `import { wastelandTheme } from '../theme/wasteland/index.js'` + `theme.colors.primary`
- 涉及 ~10-15 个文件

### R7: 清理

- 删 `src/tui/utils/colors.ts`（迁到 theme/）
- 删 `src/skins/immortan-joe/index.ts` 旧版（拆到 theme + skins/roles/immortan-joe/）
- `promptVariables` 移除 `.zh` 字段（统一英文）

## Acceptance Criteria

- [ ] `src/theme/wasteland/` 创建完整（colors/typography/spacing/decorations/animations/index）
- [ ] `src/skins/system/common.ts` 创建（系统级 UI labels + messages）
- [ ] `src/skins/roles/{immortan-joe,nux,furiosa}/` 创建（persona + roleUi）
- [ ] `src/skins/roles/index.ts` 注册表 + `defaultRoleSkin`
- [ ] TUI 渲染时颜色用 `theme.colors.X`，文字用 `selectedSkin.roleUi.X` 或 `systemCommon.X`
- [ ] `SubAgentSettings.skin` 字段 + `assembleSubAgentPrompt` 读皮肤注入 persona
- [ ] minimax persona prompt 是英文（minimax 看到的"我是 Immortan Joe"是英文）
- [ ] 主 agent minimax 看到 persona（不再是 ROLE_ORCHESTRATOR 裸 prompt + 无 persona）
- [ ] minimax 在 thinking 里不再复读系统指令（因为看到 persona + 约束明确）
- [ ] locales/{en,zh}.json 加 `skins.{role}.{key}` 节点
- [ ] 删 `src/tui/utils/colors.ts` + `src/skins/immortan-joe/index.ts` 旧版
- [ ] settings.json promptVariables 统一英文（移除 `.zh` 字段）
- [ ] 现有 419 测试 + 新增 ~5 个测试通过
- [ ] typecheck + build + i18n 校验通过

## Definition of Done (team quality bar)

- Tests added/updated
- Lint / typecheck / CI green
- i18n 校验通过（zh + en 键结构一致）
- Specs 更新（`.trellis/spec/frontend/` 加 theme/skin 分层合约）
- 自检：TUI 渲染仍正常（颜色/文字不丢失）+ minimax 输出与"不死老乔"角色身份匹配

## Out of Scope (explicit)

- 动态多主题切换（wasteland 固定废土主题）
- minimax persona 多语言版本（minimax 看英文就够）
- 场景级（scenario）皮肤（不必要）
- 重写之前 PR1+2 的功能（保留 + 扩展）

## Technical Notes

- `src/tui/utils/colors.ts` → `src/theme/wasteland/colors.ts` 迁移
- `src/skins/immortan-joe/index.ts` → 拆到 `theme/wasteland/` + `skins/system/common.ts` + `skins/roles/immortan-joe/`
- `assembleSubAgentPrompt` 扩展读 `subAgentConfig.skin`
- mainAgent prompt 注入：`useRuntime.ts` / `chat.ts` / `resume.ts` 读 `runtime.skin.persona` 拼 system prompt
- 之前 PR2 已建 `assembleSubAgentPrompt`，扩展而非重写
- 之前 PR3 已建 9 个 spawn-agent 测试，扩展而非重写

## Implementation PR 拆分（5 个小 PR）

| PR | 内容 | 估算行数 |
|---|---|---|
| **PR1** | 新建 `src/theme/wasteland/`（colors/typography/spacing/decorations/animations/index）+ 迁移 `src/tui/utils/colors.ts` | 80 |
| **PR2** | 新建 `src/skins/system/common.ts` + `src/skins/roles/{immortan-joe,nux,furiosa}/`（persona + roleUi）+ 角色注册表 | 200 |
| **PR3** | `SubAgentSettings.skin` 字段 + `assembleSubAgentPrompt` 读皮肤注入 persona + mainAgent persona 注入 + locales 加 `skins.*` 节点 | 80 |
| **PR4** | 全局替换 `skin?.ui.X` → `theme.X` + `selectedSkin.roleUi.X` + `systemCommon.X`（10-15 文件） | 120 |
| **PR5** | 删 `src/tui/utils/colors.ts` 旧版 + `src/skins/immortan-joe/index.ts` 旧版 + 清理 + specs 更新 | 50 |

**总计 ~530 行**。