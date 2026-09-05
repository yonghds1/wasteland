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

### 1. Create the skin file

```bash
mkdir -p src/skins/<skin-id>
touch src/skins/<skin-id>/skinUi.ts
```

Write the file using **token references** (preferred) or hex literals (escape hatch):

```ts
// src/skins/<skin-id>/skinUi.ts
import type { SkinUi } from '../types.js';

export const <skinIdCamel>SkinUi: SkinUi = {
  labelKey: 'skins.<skin-id>.label',
  thinkingKey: 'skins.<skin-id>.thinking',
  greetingKey: 'skins.<skin-id>.greeting',
  catchphrasesKey: 'skins.<skin-id>.catchphrases',
  errorPrefixKey: 'skins.<skin-id>.errorPrefix',
  colors: {
    label: 'role.label.<token>',      // pick from src/theme/palette.ts
    text: 'text',                     // default wasteland text
    thinking: 'role.thinking.<token>',
  },
};
```

**Token reference rules:**

- `label` should reference one of the `role.label.*` tokens that already passes APCA Lc 75 (see `palette.ts` for current set).
- `text` typically uses `'text'` (default) — escape hatch with hex `#XXXXXX` only if the skin needs a distinct body color.
- `thinking` should reference `role.thinking.muted` / `warm` / `teal`; only hex-escape if APCA Lc 45 needs a custom brightness.

### 2. Add translation keys to BOTH locales

Both `src/locales/en.json` and `src/locales/zh.json` must contain the same nested structure:

```json
{
  "skins": {
    "<skin-id>": {
      "label": "<English character name>",
      "thinking": [
        "<thinking line 1>",
        "<thinking line 2>",
        "<thinking line 3>"
      ],
      "greeting": [
        "<greeting line 1>",
        "<greeting line 2>",
        "<greeting line 3>"
      ],
      "errorPrefix": "<error prefix word>",
      "catchphrases": [
        "<catchphrase 1>",
        "<catchphrase 2>",
        "<catchphrase 3>",
        "<catchphrase 4>"
      ]
    }
  }
}
```

Conventions:
- `label` stays in the source language (English) for both locales — the character name should not be translated.
- `thinking`, `greeting`, `errorPrefix`, `catchphrases` are translated normally.
- Provide 3-5 entries in each array; the UI may pick randomly.

### 3. Register in `src/skins/index.ts`

```ts
import { <skinIdCamel>SkinUi } from './<skin-id>/skinUi.js';

// In the tuiSkins object:
export const tuiSkins = {
  // ... existing 13
  '<skin-id>': <skinIdCamel>SkinUi,
} as const satisfies Record<string, SkinUi>;
```

TypeScript will infer the new `SkinId` literal type automatically.

### 4. Run the build gates

```bash
npm run typecheck                              # strict TS
npm run check:locale-parity                    # verify both locales have <skin-id>.* keys
npm run check:contrast                         # verify APCA Lc 75/60/45 on label/text/thinking
npm test                                       # run all unit + smoke tests
```

If any gate fails:
- **typecheck**: usually a missing import or wrong casing in the const object key.
- **check:locale-parity**: message names the missing leaf key + which locale. Add the key.
- **check:contrast**: message names the failing role + actual Lc. Either pick a brighter `role.label.*` token or compute a custom hex with `apcaContrast()` from `src/theme/contrast.ts`.

### 5. Optional: update `commands/skin.ts` list output

`commands/skin.ts` automatically picks up new skins via `listSkins()`. No edit required unless you want a custom blurb in `info` output.

### 6. Verify in TUI

```bash
npm run dev
# In the TUI prompt:
# /skin load <skin-id>
```

Verify:
- Role label renders in the new color
- Thinking text shows the translated lines
- Greeting appears on session start
- `/skin list` shows the new skin
- `/skin show <skin-id>` shows the resolved colors (hex output, not internal tokens)

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

### Symptom: TUI shows `skins.<skin-id>.label` as raw key

**Cause**: Missing entry in either `en.json` or `zh.json` for the active locale. `t()` falls back to `'en'`, then to the raw key if neither locale has it.

**Fix**: Run `npm run check:locale-parity` to see exactly which key is missing.

### Symptom: Runtime warns `[skins] Skin "<id>" failed contrast validation, falling back to "warlord-stern"`

**Cause**: The skin registered but fails APCA at runtime. This should never happen if `npm run check:contrast` passes locally — usually indicates you skipped the gate.

**Fix**: Run `npm run check:contrast` locally and fix the failing role before commit.

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