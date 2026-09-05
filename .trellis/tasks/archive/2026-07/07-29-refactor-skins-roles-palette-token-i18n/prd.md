# Refactor skins & roles: 死字段清理 / palette token / i18n 防回归 / 对比度校验

## Goal

清理 wasteland 项目皮肤/角色层的历史包袱：消除 dead schema、把分散的硬编码 hex 集中成可复用 token、补 i18n 防回归机制、加构建期对比度校验。在保持现有 13 个皮肤/5 个角色向后兼容的前提下，让皮肤层更可维护、更可扩展、更可访问。

## Scope (MVP, Top-3)

用户确认先做 Top-3:

1. **`colors.text` 死字段清理** — 要么真正消费，要么删除
2. **i18n 防回归** — 构建期 locale parity lint + 运行时 silent fallback（不是补 gap，因为实际无 gap）
3. **`palette.ts` 集中调色板** + token 引用 + 集成 APCA 校验

**显式延后（Out of Scope）**:

- 4. orchestrator prompt 加 "中文回复" 指令 + agent 选择决策树
- 5. `assertContrast` 完整测试覆盖（仅在本次做最小版本）
- 6. `/skin preview <id>` 命令
- 7. 用户自定义皮肤 loader
- 8. light theme / high-contrast theme
- 9. `catchphrases` 抽取防重复封装
- 10. `animations.ts` 与皮肤 timing 联动

## Requirements

### R1. 消除 `colors.text` dead schema

- **调研结论**：所有 13 个皮肤都赋了 `colors.text`，但 `src/` 中没有任何 consumer
- **决策（推荐）**：**真正消费** `colors.text` —— 在 `ChatMessageList` 中用它上色 assistant 回复正文，比统一用 `wastelandTheme.colors.text` 更能凸显皮肤个性
- **验收**:
  - `ChatMessageList.tsx` 渲染 assistant 回复文本时优先用 `skin.colors.text`，fallback 到 `wastelandTheme.colors.text`
  - 13 个皮肤的 `colors.text` 字段保留（向后兼容），但全部真的被消费
  - 单测：mock skin with/without colors.text 验证渲染结果

### R2. 构建期 locale parity lint + 运行时 fallback

- **调研修正**：当前 `en.json` 和 `zh.json` 都已有 13 个皮肤完整 5 类文案（83 个 leaf key 全等），**不存在补齐 gap**。原 Top-3 #2 描述错误。
- **新需求**：加 lint 防未来回归 + 统一 fallback 行为
- **实现**:
  - 新文件 `scripts/check-locale-parity.ts`：对比 `en.json` vs `zh.json` 的所有嵌套 key，发现缺失即 non-zero exit
  - 接 `npm run check`（已有 typecheck + test 流水线，参考 `package.json` scripts）
  - `src/locales/i18n.ts` 的 `t()` 行为：当前 locale → `en` → key string（已有 fallback，但需 audit 现状）
  - **保持 `DEFAULT_LANGUAGE = 'en'`**（research 明确建议：不要把默认从 en 翻成 zh）
- **验收**:
  - 故意删除 `en.json` 一个 key → `npm run check` 失败
  - 故意删除 `zh.json` 一个 key → `npm run check` 失败
  - 现有所有 key 都在时 → 通过

### R3. `palette.ts` 集中调色板 + APCA 校验

- **决策**：新建 `src/theme/palette.ts`，分两层：
  - **基础层**：复用 `wastelandColors`（已存在，~30 个语义 token），不重复定义
  - **皮肤覆盖层**：每个皮肤写 `palette = { label: 'accent', text: 'text', thinking: 'muted' }` 这种 token 引用而非硬编码 hex
  - **解析器**：`resolvePalette(skin)` 返回 `{ label, text, thinking }` hex 字符串
- **APCA 校验集成**:
  - 用 `apca-w3` npm 包（research 推荐；纯 JS 算法稳定；vendor ~10KB 源码作为 hedge 防 npm 包停止维护）
  - 阈值：label `|Lc| ≥ 75`、text `|Lc| ≥ 60`、thinking `|Lc| ≥ 45`（research APCA Bronze 表）
  - 校验时机：**构建期** —— `npm run check` 触发；对所有 13 个皮肤跑；任一失败即报错
- **APCA 会失败的 7 个皮肤**（research 已实测）:
  - nux / doof-warrior / max / furiosa / splendid-angharad / valkyrie / dag
  - 这些 skin 的 `colors.label` 在 `#18140F` 背景上 APCA Lc 不达标
  - **本次同步修复**：把它们的 `colors.label` 调到 ≥ Lc 75 的合规色
- **APCA 包引入**: `apca-w3` 加到 dependencies；纯 JS 无 native dep，CLI 场景安全
- **验收**:
  - 13 个皮肤通过 APCA 校验
  - 新增/修改皮肤的 hex 自动校验（lint 阻止不达标皮肤进注册表）
  - 单测：`resolvePalette` 解析正确；`assertContrast` 报错的样例 fail、通过的样例 pass

## Acceptance Criteria

- [ ] `npm run check` 跑通，包含：typecheck + test + locale parity + APCA contrast
- [ ] 故意制造 locale key 缺失 → check 失败且报错信息明确指出哪个 key 缺失
- [ ] 故意制造 APCA 不达标 → check 失败且报错信息明确指出哪个 skin 的哪个字段
- [ ] `ChatMessageList` 渲染时优先用 `skin.colors.text`（有单测覆盖 fallback 路径）
- [ ] 13 个皮肤在 APCA Lc 75/60/45 阈值下全部通过
- [ ] 13 个皮肤文件改用 token 引用（`accent` / `text` / `muted` 等）而非 hex 字面量
- [ ] `package.json` 加 `apca-w3` dependency
- [ ] 现有 `wasteland skin load <id>` 命令仍能加载所有 13 个内置皮肤（向后兼容）
- [ ] 现有 settings.json 中的 skinId 不失效

## Definition of Done

- Lint / typecheck / 测试 全绿（`npm run check`）
- 13 个皮肤文件改完，新增 `palette.ts` + `scripts/check-locale-parity.ts`
- 至少 5 个新单测：token 解析、APCA 校验（pass + fail 样例）、locale parity（missing 样例）、ChatMessageList fallback
- 文档：README 或 docs/ 下加一节 "Skin development guide"
- Rollback：所有改动对现有用户不可见（皮肤 ID、文案、调色板视觉差异仅在 token 解析后等价产出）

## Technical Approach

### 文件改动清单

| 文件 | 改动 |
|---|---|
| `package.json` | 新增 dep `apca-w3`；scripts 增 `check:locale-parity`、`check:contrast` |
| `src/theme/palette.ts` | **新建** — token 定义 + `resolvePalette(skin) → {label,text,thinking}` |
| `src/theme/contrast.ts` | **新建** — APCA `assertContrast(fg, bg, minLc, role)`；vendor `apca-w3` 源码或 import |
| `scripts/check-locale-parity.ts` | **新建** — 递归对比 en/zh JSON 嵌套 key |
| `scripts/check-contrast.ts` | **新建** — 遍历 `tuiSkins`，跑 APCA 校验，失败退出 |
| `src/skins/types.ts` | `colors.text` 字段保留（消费它），加 `colors?: { label?, text?, thinking? }` 注释明确其实际被消费 |
| `src/skins/*/skinUi.ts` (13 个) | 改用 token 引用 + 调色至 APCA 合规 |
| `src/tui/components/ChatMessageList.tsx` | assistant 回复文本消费 `skin.colors.text` |
| `src/locales/i18n.ts` | audit `t()` fallback 行为（current → en → key），加 dev-mode warn |
| `src/skins/index.ts` | 启动时跑 `validateContrastAllSkins()`，未达标打 warning（运行时 fallback 不阻塞） |

### 关键决策（ADR-lite）

#### ADR-1: APCA-only 校验（不用 WCAG 2.1）

- **Context**: 需要自动校验 13 个皮肤在 `#18140F` 背景上的可读性
- **Options**:
  - WCAG 2.1 4.5:1 → 全部 13 个皮肤通过（false negative，6-7 个实际阅读困难）
  - APCA Lc 75/60/45 → 6-7 个真实不达标皮肤被正确捕获
  - 两者 OR → 复杂度高，收敛慢
- **Decision**: **APCA-only**（Lc 75 label / Lc 60 text / Lc 45 thinking）
- **Consequences**:
  - + 准确捕获当前 6-7 个不合格皮肤
  - + wasteland 是早期采用 APCA 的 TUI（差异化卖点）
  - − W3C WCAG 3 仍是 draft（research 指出），未来可能调整阈值
  - − 需要同步修复 7 个皮肤的 label 颜色（已在 R3 范围内）

#### ADR-2: `colors.text` 真正消费（不删除）

- **Context**: 13 个皮肤都赋了 `colors.text`，但 0 consumer
- **Options**:
  - 删除字段 → 13 个 skin 文件 + types.ts 改动，但失去"皮肤自定义回复正文字色"能力
  - 真正消费 → ChatMessageList 渲染时优先用，提升皮肤差异化
- **Decision**: **真正消费**
- **Consequences**:
  - + 皮肤差异化更明显（Joe 的金色文字 vs Max 的米色 vs Furiosa 的冷灰）
  - + 字段保留，向后兼容现有 settings.json
  - − 多一处需要测试的代码路径

#### ADR-3: 构建期校验 + 运行时 warning，不阻塞

- **Context**: 校验失败的皮肤该如何处理
- **Options**:
  - 构建期 hard fail → CI 红，但单皮肤不达标会阻塞所有部署
  - 运行时 warning → 用户能继续用，但开发者不知情
  - 两者组合 → 构建期 fail + 运行时 warning with fallback
- **Decision**: **构建期 fail（开发者场景）+ 运行时 warning（用户场景 fallback 到 wastelandTheme 默认）**
- **Consequences**:
  - + 开发者被强制知道
  - + 用户不会突然看到崩溃
  - − 需要两套处理逻辑

#### ADR-4: palette.ts 用 token 引用而非 hex

- **Context**: 13 个皮肤大量硬编码 hex，与 wastelandColors 重复
- **Options**:
  - 保留硬编码 hex，只加 APCA 校验 → 改动最小，但重复未消
  - 改用 token 引用（`accent` / `text` / `muted`） → 13 个文件 + palette.ts 改动大
- **Decision**: **token 引用**（与 wastelandColors 复用同一套命名空间）
- **Consequences**:
  - + 改一处基础色（如 `accent`），所有引用皮肤自动更新
  - + palette.ts 可被未来 light theme / high-contrast theme 复用
  - − 13 个皮肤文件全部改写
  - − 失去"每个皮肤独立调色"的灵活性（但 `colors: { label: '#xxx' }` 仍然允许 hex 字面量覆盖，作为 escape hatch）

## Out of Scope

- 4-10 项（参见 Scope 段）
- 任何破坏性 API 改动
- 改 13 个皮肤的角色人设/剧情设定
- 重写 system prompt
- 改 spawn_agent 运行时机制
- light/high-contrast theme

## Technical Notes

### 现状摘要（已读完源码）

- `src/skins/types.ts:2` — `SkinUi.colors` = `{label?, text?, thinking?}` 全可选
- `src/skins/index.ts:33-47` — 13 个皮肤 const object
- `src/skins/*/skinUi.ts` — 每个 9 行硬编码 hex
- `src/theme/wasteland/colors.ts` — 30 个 semantic tokens，背景 `#18140F`
- `src/locales/{en,zh}.json` — **现状：完全 parity**（research 实测 13 × 5 = 65 leaf keys + system + 命令行 = 644 leaf keys 等）
- `src/locales/i18n.ts` — 默认 locale 是 `'en'`，已有 fallback 机制
- `src/tui/components/ChatMessageList.tsx:296` — 当前 assistant 回复用 `wastelandTheme.colors.text`，未消费 `skin.colors.text`
- `src/commands/skin.ts:63,80,132` — 已经在 list/show 皮肤时打印 `colors`

### APCA 现状（research 实测）

- 7 个皮肤 APCA 不达标：`nux / doof-warrior / max / furiosa / splendid-angharad / valkyrie / dag`
- `apca-w3` npm 包 v0.1.9 (2022) 在纯维护状态；算法稳定；建议 vendor ~10KB 源码
- APCA 是 WCAG 3 draft 标准，未正式发布；阈值来源 readtech.org/ARC APCA Bronze 表

### Research References

* [`research/color-contrast-standards.md`](research/color-contrast-standards.md) — APCA-only 推荐；7 个失败皮肤已识别；apca-w3 vendor 策略
* [`research/i18n-fallback-cli-patterns.md`](research/i18n-fallback-cli-patterns.md) — 当前 locale parity 已 OK；建议加 build-time lint + 运行时 silent fallback；lazygit 的 mergo.Merge 模式可参考

## Implementation Plan (small PRs)

按 Trellis Phase 3，建议拆 3 个 PR（每个独立可 review/merge）:

- **PR1**: 引入 `palette.ts` + token 引用改造 13 个 skin 文件 + APCA 校验（不含 CI 集成）
  - 同步修复 7 个不达标皮肤的 label 颜色
- **PR2**: 构建期 lint 集成 —— `scripts/check-locale-parity.ts` + `scripts/check-contrast.ts`，接 `npm run check`
- **PR3**: `ChatMessageList` 消费 `skin.colors.text` + 单测覆盖

每个 PR 后跑 `npm run check` 全绿才能 merge。

## Status

- [x] Step 0: Task created
- [x] Step 1: Auto-context done
- [x] Step 4: Research-first done (contrast + i18n)
- [x] Step 5: Expansion sweep (MVP = Top-3, others Out of Scope)
- [x] Step 7: ADR-lite decisions made
- [ ] Step 8: Final confirmation → ready to start Phase 2