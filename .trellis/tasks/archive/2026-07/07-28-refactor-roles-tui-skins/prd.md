# refactor: 角色指令(roles)与TUI视觉(skins)完全分离 + 皮肤颜色

## Goal

把 wasteland 当前 `src/skins/roles/` 中混杂的角色指令和 TUI 视觉拆成两个正交目录，并为每个皮肤添加专属颜色。

## 设计原则

- `src/roles/` — LLM 指令（system prompt，minimax 看到的）。**纯功能**，如 `roles/researcher/system.ts` → "You are an Information Research Specialist..."
- `src/skins/` — TUI 视觉（用户看到的）。**纯 UI**，如 `skins/nux/skinUi.ts` → `label: "Nux"` + `colors: { label: #D95738, text: ... }`
- **角色与皮肤正交**：`subAgents.researcher.role = 'researcher'`（选 roles/researcher/system.ts），`subAgents.researcher.skin = 'nux'`（选 skins/nux/skinUi.ts）
- `SkinUi` 自带 `colors`：`label?`（角色名颜色）、`text?`（回复文字颜色）、`thinking?`（思考状态颜色）
- 不设颜色则 fallback 到 `wastelandTheme.colors`

## 目录结构（目标）

```
src/roles/
  orchestrator/system.ts     ← 主 agent 指令
  researcher/system.ts       ← 信息收集
  developer/system.ts        ← 代码开发
  analyst/system.ts          ← 分析
  tester/system.ts           ← 测试
  types.ts                   ← RoleInstruction 类型
  index.ts                   ← 角色注册表

src/skins/
  types.ts                   ← SkinUi 类型（labelKey + colors）
  immortan-joe/skinUi.ts     ← 废土风（#E6B450 黄 / #D47A3A 橙）
  nux/skinUi.ts              ← 年轻热血（#D95738 红 / #E6B450 黄）
  furiosa/skinUi.ts           ← 冷静指挥（#6E9F9A 绿松）
  max/skinUi.ts               ← 疯狂（#C94F2D 红橙）
  dag/skinUi.ts               ← 机械（#9B8065 棕）
  toast/skinUi.ts             ← 欢脱（#E0A33A 金）
  valkyrie/skinUi.ts          ← 优雅（#8F7DB5 紫）
  ...
  index.ts                   ← 皮肤注册表 + defaultSkin
```

## Requirements

1. `src/roles/types.ts` — `RoleInstruction` 类型（含 `systemPrompt: string`）
2. `src/skins/types.ts` — `SkinUi` 类型（含 `labelKey: string` + `colors: { label?, text?, thinking? }`）
3. `src/roles/*/system.ts` — 从旧 `src/skins/roles/*/persona.ts` 迁过来（只保留 `fullPrompt`）
4. `src/skins/*/skinUi.ts` — 从旧 `src/skins/roles/*/roleUi.ts` 迁过来，加 `colors` 字段
5. TUI 渲染优先用 `selectedSkin.skinUi.colors.*`，未设则 fallback `wastelandTheme.colors.*`
6. `subAgents` 配置：保持 `subAgents[name].role`（选 role instruction）+ `subAgents[name].skin`（选 TUI 皮肤）

## Acceptance Criteria

- [ ] `src/roles/` 目录创建，含 orchestrator/researcher/developer/analyst/tester 指令
- [ ] `src/skins/` 目录创建，含 immortan-joe/nux/furiosa/max/dag/toast/valkyrie 等皮肤（各带 colors）
- [ ] `subAgents[name].role` 选 roles/system.ts，`subAgents[name].skin` 选 skins/skinUi.ts（正交）
- [ ] `SkinUi` 类型含 `colors: { label?, text?, thinking? }`（全部可选，fallback 到 theme）
- [ ] TUI 角色名用 `skinUi.colors.label` 渲染
- [ ] TUI 角色回复文字用 `skinUi.colors.text` 渲染
- [ ] TUI 思考状态用 `skinUi.colors.thinking` 渲染
- [ ] 未设颜色时 fallback 到 `wastelandTheme.colors.*`（向后兼容）
- [ ] 现有 425 测试通过
- [ ] typecheck + build + i18n 通过

## Out of Scope

- 切换 TUI 主题（保持 wasteland 固定）
- minimax 看到角色颜色（minimax 只读 instruction，不看 skin）

## Implementation Plan

1. 建 `src/roles/` + `src/skins/` 新目录
2. 迁旧 `src/skins/roles/*/persona.ts` → `src/roles/*/system.ts`（改名，去 `role/style/voice/constraints`，只保留 `systemPrompt`）
3. 迁旧 `src/skins/roles/*/roleUi.ts` → `src/skins/*/skinUi.ts`（改名，加 `colors`）
4. 更新 `src/skins/index.ts` → `src/roles/index.ts` + `src/skins/index.ts`
5. TUI 全局替换 `skin.roleUi.X` → `skin.skinUi.X`
6. 每个 `skinUi.ts` 加 `colors`
7. 测试 + 清理旧目录
