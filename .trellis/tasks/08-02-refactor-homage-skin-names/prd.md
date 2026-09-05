# refactor homage skin names

## Goal

将当前过于单薄的原创废土皮肤升级为“稳妥致敬”命名与文案：名字有荒漠贸易城 / 公路废土 / 游戏 NPC 味，能让用户感知经典废土角色原型，但不使用影视角色名、谐音、专有地名、阵营、载具或台词。

## Requirements

- 保留现有稳定 skin ID，避免破坏 settings、tests、docs 和用户配置：`warlord-stern`、`warlord-casual`、`scout`、`coder`、`scholar`、`sentinel`。
- 将 6 个现有皮肤升级为稳妥致敬命名：
  - `warlord-stern` → 热沙总督
  - `warlord-casual` → 狂沙行者
  - `scout` → 荣耀之路车长
  - `coder` → 铜湾机师
  - `scholar` → 金沙书记官
  - `sentinel` → 火线巡检官
- 新增可选内置皮肤 `hotsand-warrior` → 热沙战士，用于承接 Nux / War Boy 类“年轻废土战士”原型，但不默认绑定现有功能 agent。
- 更新内置 `src/skins/default-skins.json` 与项目级 `.wasteland/skins.json`，保持内容同步。
- 更新 fallback 文案、测试断言、文档表格和注释中旧“废土军阀/斥候/工匠/学者/哨兵”显示名。
- 文案允许“致敬”气质，但不得回流 Mad Max 受保护识别点：角色名、地名、阵营、台词、特定载具/外观/关系链。
- 修复实施中发现的阻塞问题：`mode: "a2a"` 子 agent 可以不配置 `model`，但必须配置 `a2aServer`。
- 修复实施中发现的阻塞问题：`skin` 命令访问 registry 前必须初始化 skin registry。

## Acceptance Criteria

- [ ] `wasteland skin list` / TUI 主 tab 能显示新的中文 skin label。
- [ ] `getSkin()` fallback 显示 `热沙总督`。
- [ ] 内置和项目级 skins 均包含 `hotsand-warrior`。
- [ ] 现有默认配置不需要改 skin ID 即可工作。
- [ ] 文档中的当前内置皮肤表与新名字一致。
- [ ] 不引入 Mad Max 原名、谐音、专有地名、阵营、台词等高风险词。
- [ ] 相关测试通过，至少覆盖 typecheck、i18n/locale、contrast、皮肤相关测试、skin 命令测试、A2A 配置解析测试。

## Definition of Done

- Tests updated where display labels changed.
- Typecheck / locale parity / relevant tests pass or failures are reported with cause.
- Docs/spec references updated for the changed skin names.
- No unrelated refactors.
- If the naming/legal boundary is a durable user/project preference, record it to memory after implementation.

## Technical Approach

Use the conservative compatibility approach: keep skin IDs stable and change only labels / UI prose. Add `hotsand-warrior` as an extra optional skin entry in skin definitions, but do not wire it into default `multiAgent` assignments unless a future task adds dynamic skin selection or a warrior-style worker.

## Decision (ADR-lite)

Context: The project previously removed direct Mad Max IP usage, but the replacement skins became too generic. The user wants more obvious “致敬” mainly in names, with lower legal risk.

Decision: Use “塔纳利斯式荒漠 NPC + 公路废土原型”的 naming layer: 热沙、狂沙、荣耀之路、铜湾、金沙、火线. Avoid direct role-name puns and protected identifiers.

Consequences: Names are more memorable and have clearer homage value while preserving configuration compatibility. The main residual risk is cumulative similarity if future prose reintroduces forbidden terms, so docs should keep the avoid-token guidance.

## Out of Scope

- Renaming skin IDs or changing settings schema.
- Injecting skin persona into LLM behavior beyond existing UI skin data.
- Adding aliases for homage names.
- Using or documenting direct Mad Max references as public-facing “致敬对象”.

## Technical Notes

- Current skin schema is JSON-based and simple: `label`, `thinking`, `greeting`, `catchphrases`, `errorPrefix`, optional `colors`.
- Relevant files inspected:
  - `src/skins/default-skins.json`
  - `.wasteland/skins.json`
  - `src/skins/index.ts`
  - `docs/architecture/role-skin.md`
  - `docs/architecture/wasteland-spec.md`
  - `test/theme-skin.test.js`
  - `src/tui/components/AgentTabs.test.ts`
  - `src/core/shared/initialize-runtime.test.ts`
  - `src/tui/components/AgentTabs.tsx`
  - `src/tui/hooks/useRuntimeEvents.ts`
