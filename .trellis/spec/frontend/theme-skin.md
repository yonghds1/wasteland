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

## i18n / 语言层

- TUI translations live in `src/locales/en.json` and `src/locales/zh.json` under `skins.*`.
- Both files must have the same key structure; run `npm run validate:i18n` after changes.
- TUI resolves keys at render time via `t()` / `tArray()`.
- Persona is always English and is never translated according to `runtime.language`.

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
