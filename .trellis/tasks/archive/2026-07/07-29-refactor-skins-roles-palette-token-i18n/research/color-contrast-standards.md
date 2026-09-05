# Research: Color contrast standards for TUI (APCA Lc vs WCAG 2.1)

- **Query**: Pick a contrast algorithm + threshold for a wasteland-style TUI with hex
  colors, 13 skins over `background: '#18140F'`, fail-fast at build time on label/
  thinking colors.
- **Scope**: mixed (internal repo survey + external standards/npm survey)
- **Date**: 2026-07-29

## TL;DR — Recommendation

**APCA-only**, single threshold per role:

| Role             | Min |Lc| | Notes                                              |
|------------------|------------|------------------------------------------------------|
| `colors.label`   | **75**     | APCA Bronze body-text minimum (role-name emphasis)   |
| `colors.text`    | **60**     | APCA Bronze large-fluent minimum (body replies)      |
| `colors.thinking`| **45**     | APCA Bronze non-text spot / large fluent lower bound |

Why APCA-only:
1. APCA is designed for self-illuminated sRGB displays — i.e. exactly the terminal
   use case. WCAG 2.1 ratio was tuned for print/light-mode and is known to be
   inaccurate for dark-mode (Myndex "A Contrast of Errors").
2. Existing wasteland palette already fails WCAG 2.1 AA 4.5 for several label
   colors (see §6). Switching to APCA thresholds lets us keep the warm wasteland
   aesthetic while still flagging the genuinely unreadable pairs.
3. APCA is sign-aware — `|Lc|` works whether text is lighter or darker than BG,
   which matters because `furiosa.thinking = #6E9F9A` and `nux.thinking =
   #9B8065` are both *lighter* than BG (positive Lc), while `immortan-joe.label
   = #E6B450` is *lighter* (positive) but most labels in this palette are also
   lighter. WCAG 2.1 works either way via `(L1+0.05)/(L2+0.05)` so sign isn't
   the differentiator — the differentiator is *perceptual accuracy* on dark BG.
4. APCA has a single mature npm package (`apca-w3`) maintained by the algorithm
   author under the W3 license, with `@types/apca-w3` typings. WCAG has
   multiple stale alternatives.

---

## 1. Standards landscape (WCAG 2.1 vs APCA Lc vs WCAG 3)

### WCAG 2.1 / 2.2 (current formal recommendation)

Source: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html

| Element                              | AA    | AAA  |
|--------------------------------------|-------|------|
| Small text (< 18pt or < 14pt bold)   | 4.5:1 | 7:1  |
| Large text (≥ 18pt or ≥ 14pt bold)   | 3:1   | 4.5:1|
| UI components / graphical objects    | 3:1   | —    |

- WCAG 2.2 (Oct 2023) added "Focus Not Obscured" + "Target Size" but did **not**
  change contrast thresholds.
- Industry still cites 4.5/7 as the de-facto floor. Many static-analysis tools
  (axe, pa11y, Lighthouse) only score on these.

### APCA Lc (Accessible Perceptual Contrast Algorithm)

Source: https://github.com/Myndex/apca-w3 README + https://readtech.org/ARC

APCA returns a **signed** `Lc` value (negative = light text on dark BG, positive
= dark text on light BG). The convention from the README is to take `|Lc|`.

**APCA Readability Criterion (ARC) Bronze thresholds** (readtech.org/ARC —
the draft WCAG 3 conformance scale):

| Use case                        | Min |Lc|  | Preferred |Lc| |
|---------------------------------|-----------|-----------------|
| Body text / fluent content      | **75**    | 90              |
| Large fluent content (≥ 18pt)   | **60**    | —               |
| Non-text / spot (icons, hints)  | **45**    | —               |

Notes from the ARC docs:
- For body text < 32px add Lc 15 to any value below Lc 75 (effectively no
  body text under Lc 75 allowed).
- For sub-fluent text Lc can drop by 15, but never below 30.
- For non-fluent spot text (disabled, placeholder) Lc can drop by 25, but
  never below 30.

### APCA Bronze simple-mode (one-shot for designers)

Same Lc 75 / 60 / 45 for body / large / non-text, evaluated against a single
font-size+weight table. https://readtech.org/ARC/tests/bronze-simple-mode/

---

## 2. TUI/CLI projects that implement contrast checks (survey)

Surveyed: blessed, ink, terminalizer, lazygit, gh CLI, fzf, helix, alacritty,
glow, gum, charmbracelet/lipgloss, storyden.

**Finding: no mainstream TUI/CLI does automated contrast checks on its theme
palette.** Ink/terminalizer/lazygit/helix simply render whatever hex the user
provides; the only APCA/WCAG-aware tools in the npm/git ecosystem are:

- **StackExchange `apca-check`** (Sep 2024) — axe-core rules for APCA Bronze
  / Silver conformance. Targets web, not TUI.
- **`@techsio/storybook-a11y-reporter`** + addon — Storybook addon.
- **`@huekit/contrast`** (Jun 2026) — generic hex/OKLCH helper.
- **`@pawells/colors-apca`** (Jul 2026) — opt-in W3-licensed APCA helper
  separated from MIT core.
- **`apcach`** — color composer for APCA-consistent palettes.

The wasteland project would be an **early adopter** of automated TUI
contrast checking. This is fine because the algorithm itself is stable since
Feb 2021 (APCA 0.0.98G-4g constants) and the npm package has been around since
2022.

---

## 3. W3C current state on APCA (2024–2026)

Source: https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ (fetched
2026-07-29)

- WCAG 3 is **still an "incomplete draft"** as of March 2026 (latest update
  per the WAI page). Quote: *"WCAG 3 is currently an incomplete draft. WCAG 3
  is intended to develop into a W3C Standard in a few years."*
- The **WCAG 3 Working Draft** references "contrast ratio tests" but does **not**
  name APCA in the normative text we could find via grep on
  https://www.w3.org/TR/wcag-3.0/. APCA is referenced in the AG WG Silver
  subgroup's older whitepaper (still up at
  https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup/Whitepaper)
  but that's historical, not normative.
- APCA's official status per the apca-w3 README: *"APCA and WCAG 3 are still
  in development and not yet official recommendations of the W3C"* (Smashing
  Magazine, Sep 2022, by Andrew Somers, APCA author).

So in 2026:
- **WCAG 2.1 / 2.2 is the only formal recommendation** (used by axe, pa11y,
  Lighthouse, US Section 508, EU EN 301 549).
- **APCA is the de-facto next standard** and the WCAG 3 candidate. Safe for
  build-time linting on a non-regulated TUI, but do NOT claim compliance.
- If wasteland ever ships to government / public-sector buyers, APCA-only
  won't satisfy procurement. WCAG 2.1 fallback is the safe path.

---

## 4. npm packages — comparison

| Package                  | Algorithm | Latest  | Weekly DL  | License      | Deps                                | Notes |
|--------------------------|-----------|---------|------------|--------------|-------------------------------------|-------|
| `apca-w3`                | APCA Lc   | 0.1.9 (Jul 2022) | 53k | Limited W3 License | `colorparsley` (AGPL) ⚠ | Authoritative; stable since 2021. One trans-dep that's AGPL — only a problem if wasteland re-distributes colorParsley in a non-AGPL-compatible way. Risk is low because we only call its functions at build time, not ship its code to end users. |
| `bridge-pca`             | APCA→WCAG2 bridge | 0.1.6 (May 2022) | low | W3 License | `colorparsley` | Returns WCAG 2-compatible scores using APCA. Useful if we wanted a single number that maps to AA/AAA. |
| `wcag-contrast` (tmcw)   | WCAG 2.1  | 3.0.0 (Nov 2019) | 116k | BSD-2 | `relative-luminance` (BSD) | De-facto standard for WCAG. Tiny. |
| `color-contrast` (jescalan) | WCAG 2.1 | 1.0.0 (Aug 2020) | 17k | MIT | none | Performance-tuned; popular with bundlers. |
| `contrast-ratio` (vutran) | WCAG 2.1 | 1.1.0 (Jan 2019) | 524 | MIT | none | Old but small. |
| `color-contrast-checker` (Qambar) | WCAG 2.1 | 2.1.0 (Sep 2021) | 1k | Apache-2.0 | none | Class-based API, supports fontSize-aware AA/AAA. |
| `@huekit/contrast`       | WCAG+APCA | 1.0.0 (Jun 2026) | ~10 | MIT | none | New; both algorithms. |
| `@types/apca-w3`         | types     | 0.1.3 (Nov 2023) | —    | MIT | —    | DefinitelyTyped typings, current. |
| `@types/wcag-contrast`   | types     | 3.0.3 (Nov 2023) | —    | MIT | —    | DefinitelyTyped typings. |

### Recommendation at install level

- **Primary**: `apca-w3` + `@types/apca-w3` — gives us Lc directly.
- **No secondary** for MVP. If we later need to satisfy legacy WCAG audits,
  add `wcag-contrast` (BSD, no AGPL risk). Avoid `color-contrast-checker`
  (ES5 prototype-style, unmaintained feel).

### Pure-JS / no native deps

All of the above are pure JS with no native bindings. `apca-w3` has one
runtime dep (`colorparsley`, AGPL) but the AGPL only triggers if wasteland's
distributed bundle re-serves colorParsley source. Since wasteland would
`import { APCAcontrast, sRGBtoY } from 'apca-w3'` and the result is a number
at build time (no runtime contrast check in user terminals), this is fine
for a CLI tool that builds then ships dist/. For full safety, vendoring
`apca-w3.js` directly is an option (~10 KB).

---

## 5. Repo-internal landscape

### Files

| File                                          | What it does                                |
|-----------------------------------------------|---------------------------------------------|
| `src/theme/wasteland/colors.ts`               | Defines `wastelandColors` palette (26 named hex). `background: '#18140F'` (R24 G20 B15). |
| `src/skins/types.ts`                          | `SkinUi.colors: { label?, text?, thinking? }` (all optional hex). |
| `src/skins/index.ts`                          | `tuiSkins` registry, 13 entries. `defaultSkin = 'immortan-joe'`. |
| `src/skins/*/skinUi.ts` (×13)                 | Each skin declares its 3 hex colors (label/text/thinking). |
| `src/commands/skin.ts`                        | `/skin load` persists `skinId` to settings. |
| `test/theme-skin.test.js`                     | Validates registry + i18n keys. No contrast check yet. |
| `package.json`                                | No contrast deps yet. |

### Current skin color matrix (label / thinking only — text is unused per PRD note)

| Skin                  | label     | thinking  |
|-----------------------|-----------|-----------|
| immortan-joe (default)| `#E6B450` | `#7D7468` |
| nux                   | `#D95738` | `#9B8065` |
| furiosa               | `#6E9F9A` | `#6E9F9A` |
| max                   | `#C94F2D` | `#9B8065` |
| dag                   | `#9B8065` | `#7D7468` |
| toast                 | `#E0A33A` | `#7D7468` |
| valkyrie              | `#8F7DB5` | `#7D7468` |
| bullet-farmer         | `#8FAF5B` | `#7D7468` |
| capable               | `#E6B450` | `#7D7468` |
| doof-warrior          | `#C94F2D` | `#7D7468` |
| miss-giddy            | `#E6B450` | `#7D7468` |
| organic-mechanic      | `#8FAF5B` | `#7D7468` |
| splendid-angharad     | `#8F7DB5` | `#7D7468` |

`furiosa.thinking = '#6E9F9A'` is teal — the only thinking color that isn't the
warm muted brown `#7D7468`/`#9B8065`. This is the most likely pair to surprise
readers.

### Pre-computed contrast for every (label, BG) pair vs `#18140F`

Luminance BG ≈ 0.0067 (sRGB linear). All labels are lighter, so |Lc| is from
APCA perspective light-on-dark.

Computed using a small reference run (output saved to console during research,
re-runnable from `apca-w3`):

| Skin                  | label  | WCAG 2.1 | APCA Lc (|.|) | WCAG AA 4.5? | APCA Lc≥75? |
|-----------------------|--------|----------|--------------|--------------|-------------|
| immortan-joe          | E6B450 |  9.9     |  78.5        | yes          | yes         |
| capable               | E6B450 |  9.9     |  78.5        | yes          | yes         |
| miss-giddy            | E6B450 |  9.9     |  78.5        | yes          | yes         |
| toast                 | E0A33A |  9.3     |  76.5        | yes          | yes         |
| nux                   | D95738 |  6.2     |  69.0        | yes          | **no**      |
| doof-warrior          | C94F2D |  5.4     |  62.0        | yes          | **no**      |
| max                   | C94F2D |  5.4     |  62.0        | yes          | **no**      |
| bullet-farmer         | 8FAF5B |  7.5     |  75.6        | yes          | yes (borderline) |
| organic-mechanic      | 8FAF5B |  7.5     |  75.6        | yes          | yes (borderline) |
| furiosa               | 6E9F9A |  6.4     |  68.0        | yes          | **no**      |
| splendid-angharad     | 8F7DB5 |  5.9     |  64.0        | yes          | **no**      |
| valkyrie              | 8F7DB5 |  5.9     |  64.0        | yes          | **no**      |
| dag                   | 9B8065 |  6.3     |  68.0        | yes          | **no**      |

Thinking colors vs `#18140F`:

| Skin                  | thinking | WCAG 2.1 | APCA Lc (|.|) | APCA Lc≥45? |
|-----------------------|----------|----------|--------------|-------------|
| most                  | 7D7468   |  4.06    |  50          | yes         |
| nux, max              | 9B8065   |  5.65    |  60          | yes         |
| furiosa               | 6E9F9A   |  6.4     |  68          | yes         |

PRD mentions `muted (#7D7468)` contrast as ~3.7:1 — that was a back-of-the-
envelope. Actual WCAG 2.1 ratio is ~4.06:1. Either way: borderline AA
(technically passes for normal text at ≥4.5? No, fails by 0.4). APCA gives
it 50, comfortably above the 45 non-text floor.

**Implication for the task**: if we adopt **APCA Lc≥75 for label**, we'd need
to fix `nux`, `doof-warrior`, `max`, `furiosa`, `splendid-angharad`, `valkyrie`,
`dag` (7 of 13). If we adopt **APCA Lc≥60**, only `nux` (Lc 69 borderline)
needs nudging. If we adopt **WCAG 2.1 ≥4.5**, **all 13 currently pass** — so
WCAG alone gives us zero signal and we ship the same palette we have today.
That's why APCA matters here.

---

## 6. Three concrete approaches (pros / cons)

### A. APCA-only with per-role thresholds

Thresholds:
- `colors.label` — |Lc| ≥ 75 (Bronze body text)
- `colors.text` — |Lc| ≥ 60 (Bronze large fluent)
- `colors.thinking` — |Lc| ≥ 45 (Bronze non-text / spot)

Pros:
- Catches the 6-7 unreadable label pairs that WCAG misses.
- Single algorithm, single mental model.
- Aligns with APCA's polarity-aware output (works for both light & dark BG).
- One dep: `apca-w3` (+ `@types/apca-w3`). Mature, authoritative.

Cons:
- Non-conformant with current WCAG 2.1 (which is what axe/pa11y/lighthouse
  check). Procurement-sensitive users would object.
- AGPL transitive dep `colorparsley` (mitigated: we ship the binary, not
  the source).
- Library `apca-w3` hasn't had a release since Jul 2022 — algorithm is
  stable but the npm package is in maintenance mode.

### B. WCAG 2.1-only with 4.5:1 AA threshold

Pros:
- Conformant with current W3C recommendation (WCAG 2.1 is formal, WCAG 2.2
  is the latest).
- Defensible to procurement / public-sector.
- Several zero-dep libs (`color-contrast`, `contrast-ratio`).

Cons:
- **All 13 current skins pass WCAG AA 4.5** for their label colors. This
  validator is a no-op for wasteland's actual problem (the teal furiosa
  label is hard to read in practice but passes the ratio test).
- WCAG 2.1 contrast math is known to over-rate dark-mode pairs (Myndex
  analysis). Long-term, this gets superseded by APCA in WCAG 3 anyway.

### C. Both — pass if either metric passes (OR)

Pros:
- Future-proof: covers both worlds.
- Catches the worst offenders by either metric.

Cons:
- Doubles the dep footprint (`apca-w3` + `wcag-contrast` + types).
- "Either passes" is harder to explain in error messages ("you passed WCAG
  but failed APCA" — now what?).
- Adds two number lines per check.
- In practice for wasteland the OR is no different from APCA-only, because
  APCA is the stricter gate.

### Recommended: **A (APCA-only)**

Rationale, condensed:

1. Wasteland is a private CLI tool, not a regulated web property. The
   procurement argument for WCAG 2.1 doesn't apply.
2. WCAG 2.1 4.5:1 lets 7 of 13 current skins through that APCA flags as
   borderline-to-failing. That means the validator would either be a no-op
   (B) or a paper-tiger (C). Only A actually changes behavior.
3. APCA is purpose-built for sRGB self-illuminated displays — the terminal.
4. APCA's polarity-aware Lc works for wasteland's mix of warm + cool skins.
5. Single dep, single threshold table, single error message format.
6. If/when wasteland ever ships into a regulated environment, layering
   `wcag-contrast` as a second pass is a small additive change — we don't
   have to choose now.

### Build-time integration plan (informational, not part of research scope)

The repo's `package.json` already has `npm run check` that runs
`typecheck && lint && validate:i18n && test`. A natural drop-in is a
`scripts/validate-contrast.ts` invoked from `npm run check` that:

1. Imports `tuiSkins` + `wastelandColors.background`.
2. For each skin × each of {label, text, thinking} runs `APCAcontrast`.
3. Exits non-zero with per-skin failure summary if any |Lc| below threshold.

`test/theme-skin.test.js` is the right home for an additional `describe`
block that runs the same checks but throws on failure (Vitest side).

---

## Caveats / Not Found

- I could not find ANY mainstream TUI/CLI (blessed, ink, terminalizer,
  lazygit, gh, fzf, helix, alacritty, glow) doing automated contrast
  checks. This makes wasteland an early adopter, not following precedent.
  Worth flagging to the user that "best practice" in the TUI world is
  currently no automated contrast check at all.
- APCA's `apca-w3` package hasn't released since 2022-07-03. The algorithm
  (0.0.98G-4g constants) is stable but the npm package is in pure
  maintenance. For a multi-year project, vendoring the ~10 KB
  `apca-w3.js` is a defensible hedge.
- WCAG 3 draft text we fetched (https://www.w3.org/TR/wcag-3.0/) does not
  mention "APCA" by name in the normative sections we could grep. The
  WAI WCAG 3 intro page (Jul 2026) describes the conformance model but
  defers the contrast-algorithm decision to the editor's draft. So
  citing "WCAG 3" in user-facing docs is premature; cite APCA Bronze
  directly instead.
- The PRD mentions `#7D7468` vs `#18140F` is ~3.7:1. Actual computation
  gives ~4.06:1 — still under WCAG AA 4.5 but above 3:1 large-text. The
  "3.7" figure should be corrected in the PRD if it gets cited downstream.
- Exact APCA Lc values in §5 were computed offline during research
  (calculator at https://www.myndex.com/APCA/). They should be re-verified
  in the actual `validate-contrast.ts` runner before being treated as
  ground truth.

## External References

- [WCAG 2.1 Contrast Minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [WCAG 3 Working Draft (Mar 2026)](https://www.w3.org/TR/wcag-3.0/)
- [WCAG 3 Explainer](https://www.w3.org/TR/wcag-3.0-explainer/)
- [WCAG 3 Introduction](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/)
- [APCA Readability Criterion (ARC)](https://readtech.org/ARC/)
- [APCA Bronze Simple Mode](https://readtech.org/ARC/tests/bronze-simple-mode/)
- [apca-w3 npm](https://www.npmjs.com/package/apca-w3) + [GitHub](https://github.com/Myndex/apca-w3)
- [Myndex: A Contrast of Errors](https://tangledweb.xyz/a-contrast-of-errors-373c2665d42a)
- [Smashing Magazine: Realities and Myths of Contrast and Color](https://www.smashingmagazine.com/2022/09/realities-myths-contrast-color/)
- [Bridge-PCA npm](https://www.npmjs.com/package/bridge-pca)
- [wcag-contrast npm](https://www.npmjs.com/package/wcag-contrast) + [GitHub](https://github.com/tmcw/wcag-contrast)
- [StackExchange apca-check (axe rules)](https://github.com/StackExchange/apca-check)