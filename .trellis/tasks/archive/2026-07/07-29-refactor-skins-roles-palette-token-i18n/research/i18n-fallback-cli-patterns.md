# Research: i18n fallback CLI patterns for partial coverage

- **Query**: How do mature CLI/i18n libraries and CLI products handle the case where the user's active locale (e.g. `en`) is missing keys that another declared locale (e.g. `zh`) has? What is the recommended strategy for a Node.js TUI that already loads `en.json` and `zh.json` and currently has parity but must defend against future partial coverage?
- **Scope**: mixed (internal code shape + external library / CLI survey)
- **Date**: 2026-07-29

## Current state of wasteland

Counted leaf keys (`python3 -c '...'` over `src/locales/{en,zh}.json`, see "Findings"):

| File | Total leaf keys | `skins.*` leaves | Notes |
|---|---|---|---|
| `src/locales/en.json` | 644 | 83 (13 skin ids × ~5 string keys + system + error keys) | All 13 skins have full 5-key entries (`label / thinking / greeting / errorPrefix / catchphrases`). Real English content, not placeholders. |
| `src/locales/zh.json` | 644 | 83 | Same shape. |

**Coverage delta**: `0` keys present in `en` and missing in `zh`; `0` keys present in `zh` and missing in `en`. The PRD claim "en.json only has 2 skins.* keys" is stale — both locale files currently have full parity for `skins.*`. The risk is regression: a future contributor adds a new skin to `src/skins/index.ts` or a new `t('skins.<id>.<cat>')` key without filling both files.

`src/locales/i18n.ts:107-131` — current `t()` behaviour on a missing key: returns the key string verbatim. No warning, no fallback to another locale, no parity check at startup.

`src/locales/i18n.ts:64-83` — `initI18n()` silently `try/catch`-swallows per-file load errors, so a malformed locale file is also invisible.

`src/skins/index.ts:65-67` — `validateSkinId()` already exists and is the right pattern to copy for a locale-coverage validator.

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/locales/en.json` | English locale bundle (644 leaf keys; 83 under `skins.*`). |
| `src/locales/zh.json` | Chinese locale bundle (644 leaf keys; full parity with `en`). |
| `src/locales/i18n.ts` | 249-line custom i18n module — `t() / tObject() / tRandom() / tArray() / getLocalizedValue()`. **No fallback chain, no missing-key warning, no parity check.** |
| `src/skins/index.ts` | `tuiSkins` registry — 13 skins. `validateSkinId()` exists; same pattern applicable to locale keys. |
| `src/commands/skin.ts` | `/skin list` etc. — calls `t('commands.skin.list.title')`, will surface parity gaps to users. |

### Surveyed i18n libraries — fallback strategy when active locale is missing a key

| Library | Config knob | Default fallback chain | On miss (runtime) | Configurable warn? | Source evidence |
|---|---|---|---|---|---|
| **i18next** (with `fallbackLng`) | `fallbackLng` (string / array / decision map / function); `returnEmptyString` (default `true`); `returnNull` (default `false`); `saveMissing` + `saveMissingTo` ('fallback'/'current'/'all'); `missingKeyHandler`; `parseMissingKeyHandler` | `['dev']` default in `defaults.js`; explicit chain e.g. `['fr', 'en']` | Returns the key path as the string; emits a `logger.warn` if `debug: true`; with `saveMissing`, POSTs to backend | Yes — `debug: true` controls warn volume; `missingKeyHandler` lets you customize output | `src/defaults.js:9` (`fallbackLng: ['dev']`), `src/Translator.js:283-341` (`send(lngs, key, defaultValue)` block), `src/Translator.js:357` (`res = … 'i18nKey path' … if options.appendNamespaceToMissingKey`), `src/defaults.js:32-36` (`saveMissing / updateMissing / saveMissingTo / missingKeyHandler`), `www.i18next.com/principles/fallback` ("Seeing raw keys in your UI usually means a translation is missing, not that the fallback is misconfigured.") |
| **react-intl / FormatJS** | `<IntlProvider onError={(err) => …}>` callback; `IntlErrorCode.MISSING_TRANSLATION` | None — react-intl expects you to ship complete catalogs | Returns the `defaultMessage` prop, or the `id` if no `defaultMessage`; raises `onError` event for every miss | Yes — every `MISSING_TRANSLATION` goes through `onError`, so the app can `console.error` / `console.warn` / post to telemetry | `packages/intl-messageformat/src/message_resolver.ts:235-242` (`missing` handler invocation, `'missing'` event emit), `packages/intl-messageformat/src/message_resolver.ts:257` ("use raw catalog or your catalog doesn't have a translation … fallback was used") |
| **@lingui/core** (v6) | `fallbackLocales` config object; defaults to CLDR Parent Locales; `fallbackLocales: false` opts out → returns the default message / message ID | `{}` default → CLDR Parent Locales (e.g. `en-GB` → `en`) | Returns the source-locale translation or the message ID; in non-prod emits `console.warn('Messages for locale "…" not loaded.')` on `activate()`; emits a `missing` event per lookup | Yes — `missing` handler param to `new I18n({ missing: handler })`; CLDR Parent Locales can be disabled; `process.env.NODE_ENV !== 'production'` gates the activation warning | `packages/core/src/i18n.ts:106` (`private _missing?: MissingHandler`), `i18n.ts:201` (`if (process.env.NODE_ENV !== 'production') console.warn('Messages for locale "${locale}" not loaded.')`), `i18n.ts:236-242` (missing handler invocation + `emit('missing', …)`), `lingui.dev/ref/conf#fallbacklocales` ("Translations from fallbackLocales are used if the translation … is missing. It uses CLDR Parent Locales by default, unless you override it with a `false`") |
| **vue-i18n** (Legacy & Composer) | `fallbackLocale` (string / array / decision map / function); `silentTranslationWarn` (Legacy) / `missingWarn` (Composer); `silentFallbackWarn` (Legacy) / `fallbackWarn` (Composer); `missingHandler` | Implicit CLDR Parent Locales by default; explicit chain `['fr','en']` allowed | Emits 2 console warnings by default: `[intlify] Not found 'X' key in 'ja' locale messages.` and `[intlify] Fall back to …`; renders the fallback locale value | Yes — `silentTranslationWarn:true` and `silentFallbackWarn:true` suppress | `kazupon/vue-i18n master gitbook/en/fallback.md` ("And you have specified a `fallbackLocale` … the `message` key uses the corresponding `en` locale key as a fallback"), `vue-i18n.intlify.dev/guide/essentials/fallback.html` ("By default, falling back to fallbackLocale generates two console warnings: [intlify] Not found … / [intlify] Fall back to …"; "To suppress the first warning … `missingWarn: false` … To suppress the second … `fallbackWarn: false`") |
| **ttag** (gettext-style) | None at runtime — uses build-step extraction; `babel-plugin-ttag` enforces that every `t\`...\`` in code matches a `po` entry | Source string is the message ID, so fallback IS the source | Returns the template literal itself; no console warning at runtime | No runtime warn; `ttag-cli` can validate the po catalog against source | `ttag-org/ttag README.md` ("Modern javascript i18n localization library based on … the good old GNU gettext"; "It can precompile translations on a build step"; "Has a builtin validation for translated strings format") |
| **rust-i18n** | `i18n!("locales", fallback = "en")` or `fallback = ["en", "es"]` | None — relies on the configured `fallback` chain | Returns the key / source-locale value; emits `log::warn!` when the optional `log-miss-tr` Cargo feature is enabled | Yes — opt-in `log-miss-tr` feature flag | `longbridge/rust-i18n README.md` ("Supports specifying a chain of fallback locales for missing translations"; "Support for log missing translations at the warning level with `log-miss-tr` feature") |
| **fluent-rs / fluent-fallback** | `fluent-fallback::Localization::new(vec!["a.ftl".into(), …], generate_messages)` — bundle order IS the fallback chain | Library-supplied; per-call override possible | `format_value()` returns `Option<Cow<'l, str>>` — `None` if missing, caller decides; errors collected in `&mut Vec<LocalizationError>` (no panic, no log) | Caller-controlled — you get an `errors` vec to handle | `projectfluent/fluent-rs master fluent-fallback/src/bundles.rs:65-93` (`format_value` returns `Option<Cow<'l, str>>`, errors `&mut Vec<LocalizationError>`), `fluent-fallback/README.md` ("`Localization` struct encapsulates a persistent localization context providing language fallbacking") |

### Mature CLI products — what they actually do

| Product | Source survey | Strategy |
|---|---|---|
| **`gh` (GitHub CLI)** | `cli/cli go.mod` has no `gettext`/`i18n`/`fluent`/`locale` deps. `internal/text/text.go` is only text-formatting helpers (`Title`, `Truncate`, `Pluralize`, `RelativeTimeAgo`). | **English-only — no i18n layer at all.** No fallback needed because there's no alternative locale. |
| **`kubectl`** | `staging/src/k8s.io/kubectl/pkg/util/i18n/i18n.go` — bundles `translations/<lang>/LC_MESSAGES/k8s.{po,mo}` via `//go:embed`; `knownTranslations["kubectl"] = { "default", "en_US", "fr_FR", "zh_CN", "ja_JP", "zh_TW", "it_IT", "de_DE", "ko_KR", "pt_BR" }`; calls `gettext.PGettext("", defaultValue)` and `gettext.PNGettext("", defaultValue, defaultValue+".plural", n)`. | **GNU gettext.** Translation files embed the English source string as the key. When a key is missing in the active locale, gettext returns the English source string. **Silent fallback, no runtime warning, no parity gate.** Locale files are exhaustive by construction (extracted from source). |
| **`helm`** | `helm/helm go.mod` lists `github.com/chai2010/gettext-go v1.0.2 // indirect`. | **GNU gettext (same as kubectl).** Silent fallback to English source string. |
| **`cargo`** | `rust-lang/cargo/Cargo.toml` has no `fluent` / `tr` / `gettext` deps; top-level has no `locales/` or `translations/` directory; `CHANGELOG.md` is a redirect to the Cargo Book. | **English-only — no i18n.** Subcommand output (`cargo add`, `cargo build`, etc.) ships English. |
| **`npm` CLI** | `npm/cli/package.json` only depends on `@isaacs/string-locale-compare` (locale-aware sort comparator), not an i18n library. | **English-only — no i18n for CLI output.** Locale sorting is the only locale-aware feature. |
| **`yarn`** | Same family as npm; no i18n for CLI strings. | **English-only.** |
| **`lazygit`** | `jesseduffield/lazygit/pkg/i18n/i18n.go` — `baseSet := EnglishTranslationSet(); if language != "en" { translationSet, _ := readLanguageFile(language); mergo.Merge(baseSet, *translationSet, mergo.WithOverride) }`. Translations: `de, en, es, fr, ja, ko, nl, pl, pt, ru, zh-CN, zh-TW`. | **Merge-style English-is-base fallback.** Every non-English translation JSON is merged over the English one with override. Keys missing in the user's locale fall back to English silently; no warning. This is the single TUI tool surveyed that ships full translations and the precedent for the wasteland pattern. |
| **`fzf`** | `junegunn/fzf` `CHANGELOG.md` contains only user-handle mentions of "Lang", no i18n modules. | **English-only.** |
| **`btop`** | `aristocratos/btop/src/btop.cpp` has `setlocale(LC_ALL, "")` for UTF-8 detection only. No translation files, no `_("…")` macro. | **English-only.** |

Pattern from this survey: **every CLI product that ships translations uses either GNU gettext (kubectl/helm) or a merge-style English-base fallback (lazygit).** None hard-fails at runtime when a key is missing in the active locale. None ship a "100% coverage gate" enforced at runtime — they enforce completeness in their build pipeline or via the gettext message-id model.

### Code Patterns

**Already in wasteland (`src/skins/index.ts:65-67`)**:
```ts
export function validateSkinId(name: unknown): name is SkinId {
  return typeof name === 'string' && name in tuiSkins;
}
```
This is the right shape for a parallel `validateLocaleParity()` — `Object.keys(tuiSkins).every(id => 'skins.' + id in en && 'skins.' + id in zh)`.

**Currently missing from `src/locales/i18n.ts`**:
- No fallback chain — `t()` only reads `translations[currentLanguage]` and returns the key on miss (line 114, line 119-121).
- No `warn-on-miss` toggle — no `console.warn` anywhere in the file.
- No build-time or startup-time parity check between declared locales.
- `initI18n()` silently `try/catch`-swallows JSON load failures (line 76-78).

### Industry Recommendation (generic)

For a Node.js TUI that ships curated, hand-written strings (not user-generated content) with `en` + `zh`:

1. **Source of truth = English.** `en.json` is canonical; `zh.json` is the translation. `defaultLanguage = 'en'`.
2. **Build-time parity gate (hard error):** lint rule (or prebuild script) that asserts `Object.keys(en).every(k => k in zh)` and `Object.keys(zh).every(k => k in en)`, AND that every skin id in `src/skins/index.ts` has all 5 string keys in both locales. The current state already satisfies this; the gate prevents regression.
3. **Runtime fallback (silent, then warn):** `t()` first looks in active locale, then in `en`. If still missing, returns the key. On the *first* miss per `(locale, key)` pair, `console.warn` in development (`process.env.NODE_ENV !== 'production'`), silent in production.
4. **No runtime 100%-coverage gate.** The historical `99% missing` state must never ship to users — it's a build-time problem, not a runtime one.

### Specific Recommendation for wasteland (13 skins × 5 categories = 65 keys per locale)

**Recommended approach: build-time parity gate + silent English fallback at runtime.**

Rationale:
- Mirrors the lazygit precedent (English is the base, translations merge on top) which is the closest analog (Go TUI shipping curated translation JSONs).
- Avoids the "see a raw key in your UI" failure mode that i18next docs explicitly call out as a UX bug.
- The build gate makes the runtime fallback a defense-in-depth measure, not the primary correctness mechanism.
- Aligns with the existing `validateSkinId` pattern in `src/skins/index.ts:65-67` — same shape, different concern.

**Concrete policy:**

1. **At build time** — add a new module `src/locales/lint.ts` (or a `scripts/check-locale-parity.ts` invoked from `package.json` `prebuild`):
   - Compute `keysEn = flatten(en)`, `keysZh = flatten(zh)`.
   - Compute `skinKeys = Object.keys(tuiSkins).flatMap(id => ['skins.' + id + '.label', '.thinking', '.greeting', '.errorPrefix', '.catchphrases'])`.
   - Fail with non-zero exit if any of:
     - `keysEn != keysZh` (asymmetric)
     - `skinKeys ⊄ keysEn` or `skinKeys ⊄ keysZh`
     - any value is empty string or duplicate of the key itself (proxy for "still a placeholder")
   - Wire into CI as a required check.

2. **At runtime** — modify `src/locales/i18n.ts:107` `t()`:
   - Lookup chain: `translations[currentLanguage]` → `translations[DEFAULT_LANGUAGE]` (= `'en'`) → return key.
   - **Active-language preference is correct.** If a `zh` user sees English text for a missing key, that's better than a raw key (which is meaningless for a non-English speaker). But more importantly: with the build gate in place, this path should never execute.
   - **Optional**: first-miss-per-key `console.warn` gated on `NODE_ENV !== 'production'` to catch the regression early during development.

3. **Default locale** — keep `DEFAULT_LANGUAGE = 'en'` (`src/locales/i18n.ts:21`). English is the source; do not flip the default to `zh` (would break English users who have a partial `zh.json` after a future regression).

4. **CI gate** — yes, add the parity check as a required CI step. Lighter than a full i18next/vuelint pipeline but enforces the invariant.

### Pros / Cons of Alternatives

| Alternative | Pros | Cons |
|---|---|---|
| **(A) Require 100% parity at build time** (current recommendation) | Forces completeness; matches lazygit/gettext model; cheap to implement; runtime code stays minimal | Slows down adding new skins (must edit both locale files atomically); requires CI infra |
| **(B) Graceful runtime fallback with a warning log** | Ships even if locale coverage drifts; easy to roll out | Hides regressions; users see mixed-language output with no signal; "raw key in your UI" anti-pattern from i18next docs |
| **(C) Ship English only after audit, reject locales with <100% coverage** | Cleanest output for users; forces explicit completion step | Highest friction: every new locale needs an explicit sign-off step; new skin additions require coordinating two files (same as A but with an explicit approval step) |

(B) is what we have today (effectively — `t()` returns the key on miss). It's the worst UX and the worst regression signal. The choice is between (A) and (C), and (A) wins because the build gate *is* the audit — there is no manual sign-off step to forget.

### Related Specs

- `.trellis/tasks/07-29-refactor-skins-roles-palette-token-i18n/prd.md` — contains the (stale) "en.json only has 2 skins.* keys" claim. Current source-of-truth says otherwise. Both files have full parity as of this research.
- `.trellis/spec/guides/` (not yet written; will be the natural home for the parity-check convention once promoted).
- `.trellis/tasks/07-29-refactor-skins-roles-palette-token-i18n/research/color-contrast-standards.md` — sibling research file for the same task.

## Caveats / Not Found

- **PRD claim is stale.** The PRD says `en.json` only has 2 `skins.*` references; actual count is 83 in both `en` and `zh` with `0` missing in either direction. The "fallback when `en` is missing" scenario is currently hypothetical — relevant only as a regression defense.
- **react-intl source file paths could not be fetched** (rate-limited). The `IntlErrorCode.MISSING_TRANSLATION` + `onError` claim is sourced from the public FormatJS docs page and from `packages/intl-messageformat/src/message_resolver.ts:235-242` (which was successfully fetched).
- **TTS (Clojure) and `t.js` were not located** on master under the expected repo paths; ttag and rust-i18n covered the JS+Rust angles adequately.
- **cargo i18n**: confirmed via `Cargo.toml` and tree listing that no translation files or fluent/gettext deps exist. Subcommands are English-only.
- **npm/yarn**: confirmed English-only at the CLI level; only string-sort collation is locale-aware.
- **Caveat on `lazygit` strategy being "silent":** the merge is done at startup with `mergo.Merge(baseSet, *translationSet, mergo.WithOverride)`, so a missing key in the user locale is *invisible* to the user (English wins). There is no warn. This is exactly the pattern recommended above for runtime.