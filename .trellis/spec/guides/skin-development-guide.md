# Skin Development Guide

> **Purpose**: Step-by-step checklist for adding a new TUI skin. Covers file structure, registry, locales, palette token usage, APCA contrast gating, and CI verification.

---

## When to Use This Guide

Use this guide when:

- Adding a new character / persona as a TUI skin (e.g. a new original IP character).
- Forking wasteland and replacing the bundled default skins with a different character set.
- Investigating a `npm run check:contrast` or `npm run check:locale-parity` failure on a skin-related PR.

For the executable contract (signatures, error matrix, APCA thresholds), see `.trellis/spec/frontend/theme-skin.md#palette-tokens--contrast-validation`.

---

## Pre-Modification Checklist

Before changing any skin code, ALWAYS search first:

```bash
# Is the new skin ID already registered anywhere?
grep -r "<new-skin-id>" src/

# Is there a translation key collision in the locale files?
grep -r "<new-skin-id>" src/locales/

# Does the palette token you want to use exist?
grep -r "role.label" src/theme/palette.ts
```

---

## Step-by-Step: Adding a New Skin

### 1. Add the skin definition

皮肤是 **JSON 数据**，不是 TS 模块。内置皮肤在 `src/skins/default-skins.json`；
用户级 / 项目级皮肤放在 `~/.wasteland/skins.json` / `.wasteland/skins.json`（项目级优先）。

```jsonc
// src/skins/default-skins.json
{
  "skins": {
    "<skin-id>": {
      "id": "<skin-id>",
      "label": "<显示名>",
      "thinking": ["...", "...", "..."],
      "greeting": ["...", "..."],
      "catchphrases": ["...", "...", "...", "..."],
      "colors": {
        "label": "role.label.<token>",       // 从 src/theme/palette.ts 选
        "thinking": "role.thinking.<token>"
        // text 省略 → 回退 wasteland 默认正文色
      }
    }
  },
  "singleAgent": { "skin": "<skin-id>" }
}
```

**Token reference rules:**

- `paletteTokens` **只有**两组：`role.label.*`（gold / amber / green / teal / violet / taupe）
  与 `role.thinking.*`（muted / warm / teal）。**没有** `'text'` / `'muted'` 这类短名——
  写了会被 `resolveColor()` **静默忽略**并回退到 wasteland 默认色（见 `palette.ts:65`）。
- `label` 建议引用一个已通过 APCA Lc 75 的 `role.label.*`。
- `text` 省略即可；确需自定义正文色才用 hex `#XXXXXX`。
- `thinking` 引用 `role.thinking.muted` / `warm` / `teal`；仅当 Lc 45 需要特定亮度才用 hex。

### 2. 文案写在皮肤里，不动 locale

角色皮肤文案（`label` / `thinking` / `greeting` / `catchphrases`）是**内联字面量**——
`src/skins/types.ts` 明写"JSON 中写什么显示什么，无 i18n 翻译"。**不要**动 `src/locales/`。

只有**系统级**内容（`src/skins/system/common.ts` 的 `skins.system.*`）才走 locale 键；
新增那类文案才需要同时改 `en.json` / `zh.json` 并跑 `check:locale-parity`。

Conventions:

- 每个数组提供 3-5 条，UI 会随机选取。
- `label` 不翻译，两种语言下形态一致。

### 3. 无需注册

`loader.ts` 启动时按优先级（内置 → 用户级 → 项目级）合并 `skins` 对象，
`initSkinRegistry()` 全量注册。**没有** `tuiSkins` 常量对象，也没有需要手工维护的
`SkinId` 字面量类型。

### 4. Run the build gates

```bash
npm run typecheck                # 严格 TS
npm run check:contrast           # 遍历 listSkins() 校验 APCA Lc 75/60/45
npm run check:locale-parity      # 仅当改过系统级 locale 键
npm test
```

If any gate fails:

- **check:contrast**: 报错会指出 skin ID + role + 实际 Lc。换成更亮的 `role.label.*`，
  或用 `apcaContrast()`（`src/theme/contrast.ts`）算一个有余量的 hex。
- **check:locale-parity**: 只在动过系统级 locale 键时才会失败。
- **typecheck / test**: 皮肤是纯 JSON 数据，通常不会因此失败；检查是否有别的 TS 改动。

### 5. Optional: update `commands/skin.ts` list output

`commands/skin.ts` 经 `listSkins()` 自动带上新皮肤。除非要在 `info` 输出里加自定义说明，
否则无需改动。

### 6. Verify in TUI

```bash
npm run dev
# TUI 内：
# /skin load <skin-id>
```

Verify:

- Role label renders in the new color
- Thinking text shows the new lines
- Greeting appears on session start
- `/skin list` shows the new skin
- `/skin show` 显示当前皮肤的解析后颜色（hex 输出，不是内部 token）

---

## Common Mistakes

### Symptom: `check:contrast` says `role.label Lc 65 < 75`

**Cause**: Hex literal you chose (e.g. `#E6B450`) doesn't actually meet APCA Lc 75 against `#18140F`. WCAG 2.1 ratio says it passes; APCA disagrees.

**Fix**: Pick from `paletteTokens['role.label.*']`:
- `role.label.gold` (`#F0CB72`) → Lc ≈ -76.8
- `role.label.amber` (`#F5C878`) → Lc ≈ -76.5
- `role.label.green` (`#B9D889`) → Lc ≈ -79
- `role.label.teal` (`#B8DFDB`) → Lc ≈ -81.7
- `role.label.violet` (`#DACAF5`) → Lc ≈ -77.9
- `role.label.taupe` (`#E5CDB8`) → Lc ≈ -77.9

### Symptom: 界面显示成 raw key（如 `skins.system.labels.user`）

**Cause**: 当前 locale 的 `en.json` / `zh.json` 缺该**系统级**键。`t()` 回退顺序是
当前 locale → `'en'` → raw key。

**Fix**: 跑 `npm run check:locale-parity` 看具体缺哪个键。

> 角色皮肤文案（label/thinking/greeting/catchphrases）是内联字面量，不走 `t()`，
> 因此**不会**出现这个症状。

### Symptom: 期望运行时因对比度不达标而告警或回退

**Cause**: **不存在这样的运行时检查。** 对比度是构建期契约——`scripts/check-contrast.ts`
遍历 `listSkins()` 调 `getSkinContrastIssue()`。运行时的 `getSkin()` 只做"未注册则**静默**
回退 `defaultSkin`（`'warlord-immortal'`）"，不校验对比度、**不打 warn**。

**Fix**: 依赖 `npm run check:contrast`，不要期待运行时报错。

---

## Gotchas

> APCA pre-calc values from older drafts (e.g. `#E6B450` at Lc -78) are inaccurate. The vendored 0.0.98G-4g constants in `src/theme/contrast.ts` report `#E6B450` at Lc ≈ -65.5 — below the 75 label threshold. Always use the shipped `apcaContrast()` or pick from `paletteTokens['role.label.*']`.

> The `t()` function lookup order is `current locale → 'en' → key`. If your active locale is `zh` but the key is missing from `zh.json`, you will see the English translation, not the raw key. This is by design.

> `DEFAULT_LANGUAGE` in `src/locales/i18n.ts` is `'en'`. Do not flip it to `'zh'` without coordinating the full i18n policy.

---

## Related Specs

- `.trellis/spec/frontend/theme-skin.md` — palette token system + APCA contract (signatures, error matrix, good/base/bad cases)
- `.trellis/spec/frontend/directory-structure.md` — `src/theme/`, `src/skins/`, `src/locales/` ownership rules
- `.trellis/spec/backend/quality-guidelines.md#build-time-gate-scripts` — `npm run check` chain mechanics
- `.trellis/spec/guides/index.md` — pre-modification search rule and other thinking triggers