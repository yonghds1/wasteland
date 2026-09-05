# Theme / Skin / i18n Layer Contract

## Layer Model / 分层模型

```text
wastelandTheme (visual)   RoleSkin + systemCommon (content)   locales (language)
          \                         |                           /
           \____________________ TUI render __________________/

RoleSkin.persona.fullPrompt --------------------------> LLM system message
```

## Theme / 视觉层

- Path: `src/theme/wasteland/`
- Owns: colors, typography, spacing, decorations, animation defaults.
- Must not contain: role identity, user-facing sentence, translation key, LLM prompt.
- TUI code imports the aggregate `wastelandTheme` rather than defining alias constants.

## Skin / 内容层

- System-level content: `src/skins/system/common.ts`.
- Role-level content: `src/skins/roles/<id>/`.
- A role skin contains:
  - `persona`: fixed English LLM identity and safety constraints.
  - `roleUi`: i18n keys for label, thinking, greeting, catchphrases, and error prefix.
- `defaultRoleSkin` is the fallback for omitted or unknown optional sub-agent skin IDs.
- Main and sub-agent prompts place persona before functional role instructions.

### Sub-agent skin occupancy (SkinOccupancy registry)

- Path: `src/core/runtime/skin-occupancy.ts`
- Purpose: prevent the same persona from being held by multiple concurrent sub-agents
  (which causes minimax "persona collision" thinking noise).
- `SubAgentSettings.skins?: string[]` is the candidate list. Each `spawn_agent` call
  picks one available skin at random, registers it against the child session, and
  releases it on completion / timeout / unsubscribe.
- When all candidates are occupied (or the list is empty), the spawn falls back to
  `defaultRoleSkin` without acquiring — the fallback skin is *not* reserved.
- Single-skin legacy `skin?: string` is still accepted (kept for backwards
  compatibility) and folded into the candidate list.
- `warlord-casual` is an alternate main persona (no sub-agent references it) —
  listed in the registry and exposed via `roles` for future UI surfaces.
- `hotsand-warrior` is an optional homage skin for a young wasteland-warrior archetype;
  it is shipped but not assigned to a default sub-agent candidate list.

## i18n / 语言层

- TUI translations live in `src/locales/en.json` and `src/locales/zh.json` under `skins.*`.
- Both files must have the same key structure; run `npm run validate:i18n` after changes.
- TUI resolves keys at render time via `t()` / `tArray()`.
- Persona is always English and is never translated according to `runtime.language`.
- Skin `label` keeps its defined form in both locales
  (a skin's label stays consistent regardless of `runtime.language`).

## Wrong vs Correct

Wrong:

```ts
const skin = { ui: { primary: '#fff', thinking: 'Thinking...' } };
```

Correct:

```ts
const color = wastelandTheme.colors.primary;
const thinking = t(selectedSkin.roleUi.thinkingKey);
```

---

## Palette Tokens & Contrast Validation

### Scenario: Extending the skin palette system with APCA contrast gating

#### 1. Scope / Trigger

- Trigger: New skin added, color palette refactored, or APCA contrast threshold changed.
- Cross-layer concern: visual contract between `src/theme/`, `src/skins/`, `src/tui/`, and CI build pipeline.

#### 2. Signatures

```ts
// src/theme/palette.ts
export const paletteTokens: {
  primary: HexString;
  secondary: HexString;
  accent: HexString;
  muted: HexString;
  text: HexString;
  border: HexString;
  success: HexString;
  error: HexString;
  warning: HexString;
  info: HexString;
  tool: HexString;
  'role.label.gold': HexString;       // '#F0CB72'
  'role.label.amber': HexString;      // '#F5C878'
  'role.label.green': HexString;      // '#B9D889'
  'role.label.teal': HexString;       // '#B8DFDB'
  'role.label.violet': HexString;     // '#DACAF5'
  'role.label.taupe': HexString;      // '#E5CDB8'
  'role.thinking.muted': HexString;   // '#A3998C'
  'role.thinking.warm': HexString;    // '#B09A84'
  'role.thinking.teal': HexString;    // '#74A6A1'
};

export type PaletteToken = keyof typeof paletteTokens;
export type HexString = `#${string}`;
export type SkinPalette = {
  label?: PaletteToken | HexString;
  text?: PaletteToken | HexString;
  thinking?: PaletteToken | HexString;
};
export type ResolvedSkinPalette = { label: string; text: string; thinking: string };

export function resolvePalette(skin: SkinUi): ResolvedSkinPalette;

// src/theme/contrast.ts
export type ContrastRole = 'label' | 'text' | 'thinking';
export function apcaContrast(fgHex: string, bgHex: string): number;  // signed Lc
export function assertContrast(
  fgHex: string,
  bgHex: string,
  minAbsLc: number,
  role: ContrastRole,
): void;

// src/skins/index.ts
export function validateContrastAllSkins(): void;     // throws on any failure
export function getSkinContrastIssue(name: SkinId): string | null;
```

#### 3. Contracts

- **Token resolution**: `resolvePalette(skin)` returns a `ResolvedSkinPalette` where every field is an Ink-compatible hex string. Each field maps in order:
  1. If `skin.colors[role]` is a registered `PaletteToken` → look up `paletteTokens[token]`.
  2. Else if it matches `/^#[\da-f]{3}(?:[\da-f]{3})?$/i` → use as-is.
  3. Else → fall back to `wastelandColors.{primary|text|muted}` per role.
- **Contrast thresholds** (against `wastelandColors.background = '#18140F'`):
  - `label`: `|Lc| ≥ 75`
  - `text`: `|Lc| ≥ 60`
  - `thinking`: `|Lc| ≥ 45`
- **Algorithm**: APCA 0.0.98G-4g vendored in `src/theme/contrast.ts`. No runtime npm dep.
- **Top-bar Title 表面 token** (`wastelandColors.titleSurface`,07-31 引入):顶部 top-bar (07-31 后 AgentTabs) 专用的"Title 表面"色,与主背景**同色系、更明显地深一点**(L=-4pp)。
  - 值:`#0E0B07`
  - 设计参数:Hue 34°(与主背景 33° 字面同色系,+1°),Saturation 33%(主背景 23% +10pp,通道差近完美等差,视觉是"稍暗"),Lightness 4%(主背景 8% -4pp)
  - 与主背景逐通道 RGB Δ (10,9,8) —— 在 dark theme 终端(iTerm2 / WezTerm / alacritty)下为肉眼可见级别
  - 与 `primary` `#E6B450` 的 APCA Lc = -66.0(与主背景 Lc -65.5 等价,text 阈值满足)
  - **历史迭代与已知反例**:
    - 上一版本 `#13100B` 因 ΔRGB (5,4,4) 在 dark theme 终端被用户反馈"看起来还是黑色"已被回退。**经验教训**:ΔRGB 通道差 ≥ 8 才是肉眼可辨的级别,APCA Lc 数字相近不等于视觉可见。
    - `surfaceSunken #2A2014`(废止)是该 token 出现之前的失败设计:色相/饱和度都偏离主背景太大,视觉上"突兀"。
  - 与主背景关系:**同色系、更明显地深**,保持色调血脉一致;**不**应该拉出独立饱和暖色,**也不**应该复用主背景(那样就完全无差),**更不**应该用 `backgroundDarker`(纯黑 `##100D0A`)。
  - 用法:`<Box backgroundColor={wastelandTheme.colors.titleSurface} paddingY={1} borderBottom borderDim>`;唯一允许调用点是 `src/tui/components/AgentTabs.tsx`(07-31 statusbar 合并后)

#### 3.1 Palette Quantization Caveat (07-31,工程经验)

**重要前提**:xterm-256color(默认 macOS Terminal / 多数 Linux terminal)与 16-color 终端会把所有 sRGB color 通过最近邻量化映射到固定 palette。这对 **Top-bar (AgentTabs) 视觉策略有根本性约束**。

**256-color 量化规则**:
- 索引 0/16 = black(`RGB(0,0,0)`)
- 索引 16-231 = 6×6×6 RGB cube,通道只能取 `{0, 51, 102, 153, 204, 255}`(每级 step = 51)
- 索引 232-255 = 24 灰阶(8, 18, 28, …, 238)

**对 deep colors 的影响**(脚本 `/tmp/diag-256color.mjs` 实测):

| 色 | R,G,B | 256 索引 | 视觉 |
|---|---|---|---|
| 主背景 `#18140F` | 24,20,15 | **16** (black) | — |
| `titleSurface #0E0B07` | 14,11,7 | **16** (black) | 完全等同主背景 |
| `borderDim #3D3328` | 61,51,40 | **59** (cube 深暖灰) | ✓ 区分 black |
| `border #66513A` | 102,81,58 | **101** (cube 暖灰) | ✓ 区分 black |

**结论 / 反模式**:
- **在 256-color 终端下,任何 R/G/B ≤ 50 的"够深的色"** 都被量化到 palette 索引 16,与主背景完全等价,看起来"毫无变化"。
- 因此**不能用 backgroundColor 的微调去实现"Title 区段视觉区分"**——`#0E0B07`、`#13100B`、`#1F1610` 在 256-color 终端全部等同 black。
- 唯一 palette-safe 的 Title 区段视觉区分方法是**用 palette-safe 的边框色或前景色**(任何 R/G/B ≥ 51 的色),例如 `borderDim #3D3328`(索引 59)。

**工程规则**:
- Top-bar (AgentTabs) 这类组件若需在不同终端(256-color / truecolor)都呈现一致的视觉区隔,**必须额外加 `borderBottom` 或边框** 而非仅靠 backgroundColor。
- 设计色板时,深度颜色(token 用于 backgroundColor)在 256-color 终端并不一定产生视觉差;真要测试,**应在 `xterm-256color` 下肉眼对比**而非仅看 APCA Lc 数字。
- `FORCE_COLOR=3` 不能 100% 救场 —— tmux / 老 terminal 仍丢失色差。本仓库不引入 `FORCE_COLOR`(污染 runtime),改在 UI 层视觉补强。

**Top-bar (AgentTabs) 当前合规视觉**(见 `src/tui/components/AgentTabs.tsx`,08-01 样式简化后):
- **无完整边框**:去掉 `borderStyle='single'` 包裹,改为只画底部一条轻线(`borderStyle='single'` + `borderTop={false} borderLeft={false} borderRight={false}`)。
- **底线颜色**:聚焦时 `borderFocused`(#E6B450),失焦时 `borderDim`(#3D3328)。由纯函数 `getAgentBarBorderColor(focusArea)` 决策。
- **无背景色**:不再设 `backgroundColor`,视觉由底线 + 文字态表达。
- **selected 态**:只用颜色区分,不用方向图标(`▶` 已移除)。
- **active 态**:保留 `◆` 后缀标记。
- 07-31 statusbar 合并后,原 StatusBar 全部职责(skin label + thinking/streaming prose)在这里一并承担,顶部不再有独立的第二行。
- **Build-time contract**: `scripts/check-contrast.ts` calls `validateContrastAllSkins()` and exits non-zero on any failure. Wired into `npm run check`.
- **Runtime contract**: `getSkin(name)` for a registered-but-failing skin logs `[skins] warn` once per ID and returns `defaultSkin` ('warlord-stern'). User-facing flow never crashes.

#### 4. Validation & Error Matrix

| Condition | Build (`check:contrast`) | Runtime (`getSkin`) |
|---|---|---|
| Skin registered, all roles pass | exit 0 | returns skin |
| Skin registered, role fails Lc threshold | exit non-zero with `<skinId>: <role> Lc <x> < threshold <y>` | warn once, fallback to `defaultSkin` |
| Skin not registered (unknown id) | n/a (script only iterates registry) | returns `defaultSkin`, no warn |
| `skin.colors` missing entirely | resolves to wasteland defaults | returns skin; contrast checked on defaults |
| Hex malformed | skipped during token resolution; falls back to wasteland default | same |

#### 5. Good / Base / Bad Cases

**Good** — token reference with safe defaults:

```ts
// src/skins/scout/skinUi.ts
export const scoutSkinUi: SkinUi = {
  labelKey: 'skins.scout.label',
  thinkingKey: 'skins.scout.thinking',
  greetingKey: 'skins.scout.greeting',
  catchphrasesKey: 'skins.scout.catchphrases',
  errorPrefixKey: 'skins.scout.errorPrefix',
  colors: {
    label: 'role.label.teal',     // token → 'src/theme/palette.ts' → '#B8DFDB'
    text: 'text',
    thinking: 'role.thinking.teal',
  },
};
```

**Base** — hex escape hatch for one-off skins:

```ts
export const customSkinUi: SkinUi = {
  labelKey: 'skins.custom.label',
  // ...
  colors: {
    label: '#FFA500',             // hex literal — validated by APCA at build time
    text: 'text',
    thinking: 'muted',
  },
};
```

**Bad** — never do:

```ts
// Don't write hex strings when a token exists
colors: { label: '#E6B450', text: '#DED3C4', thinking: '#7D7468' }
// Don't disable contrast validation
colors: { label: '#3D3328' /* passes typing but fails Lc 45 */ }

// Don't bypass palette from TUI components
<Text color="#E6B450">          // use resolvePalette(skin).label instead
```

#### 6. Tests Required

- `test/theme-skin.test.js`:
  - `resolvePalette` resolves token to hex (`role.label.gold` → `#F0CB72`)
  - `resolvePalette` passes hex literal through unchanged
  - `resolvePalette` falls back to wasteland default when token is unknown
  - `assertContrast` does not throw for passing colors; throws for failing colors
  - `validateContrastAllSkins()` throws on a failing skin; passes on all shipped skins
  - `getSkinContrastIssue('warlord-stern')` returns null; `getSkin('failing-id')` falls back to default with one warn
- `test/chat-message-colors.test.js`: assistant body text uses `resolvePalette(skin).text`; fallback path when skin lacks colors.
- `test/locale-parity.test.js`: en.json vs zh.json recursive leaf-key parity — missing key in either file fails the parity script.

#### 7. Wrong vs Correct

**Wrong**:

```ts
// src/skins/some-skin/skinUi.ts — hardcoded hex + dead color field
export const someSkinUi: SkinUi = {
  labelKey: 'skins.some.label',
  thinkingKey: 'skins.some.thinking',
  // ...
  colors: { label: '#ABCDEF', text: '#123456', thinking: '#FEDCBA' },
};
// Caller:
<Text color={wastelandTheme.colors.text}>{message}</Text>  // ignores skin
```

**Correct**:

```ts
// src/skins/some-skin/skinUi.ts — token references
export const someSkinUi: SkinUi = {
  labelKey: 'skins.some.label',
  thinkingKey: 'skins.some.thinking',
  // ...
  colors: { label: 'role.label.gold', text: 'text', thinking: 'muted' },
};
// Caller (src/tui/components/ChatMessageList.tsx):
const palette = resolvePalette(selectedSkin);
<Text color={palette.text}>{message}</Text>     // skin-consistent
```

### Common Mistakes

- **Symptom**: New skin passes typecheck but `npm run check:contrast` fails.
- **Cause**: Used a hex literal or token that does not satisfy `|Lc|` threshold against `#18140F`.
- **Fix**: Either pick a brighter token from `paletteTokens['role.label.*']` or compute the Lc with `apcaContrast()` and pick a hex with margin.

- **Symptom**: Removing a hex from `skin.colors` causes the assistant body text to render in the default theme color instead of the skin's expected color.
- **Cause**: Caller used `wastelandTheme.colors.text` instead of `resolvePalette(skin).text`.
- **Fix**: Always go through `resolvePalette()`; tests cover this in `chat-message-colors.test.js`.

- **Symptom**: `validateContrastAllSkins()` throws at module load in production.
- **Cause**: Direct module-load call (removed in `skins/index.ts`; runtime must use `getSkinContrastIssue()` + warn instead).

### Gotchas

> APCA pre-calc reference values from older drafts (e.g. `#E6B450` at Lc ≈ -78) are inaccurate against the 0.0.98G-4g constants. The vendored implementation in `src/theme/contrast.ts` reports `#E6B450` at Lc ≈ -65.5 — below the 75 label threshold. Always use the shipped `apcaContrast()` or pick from `paletteTokens['role.label.*']`.

> `t()` lookup order is `current locale → 'en' → key string`. `DEFAULT_LANGUAGE` is `'en'` (do **not** flip to `'zh'`). Missing key in current locale triggers a one-time `console.warn` only in non-production (`NODE_ENV !== 'production'`).
