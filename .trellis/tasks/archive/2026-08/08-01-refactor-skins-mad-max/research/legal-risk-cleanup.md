# 去 Mad Max 化 — 法律风险清理规格（实施依据）

> 扫描时间：2026-08-01。扫描范围：`src/`、`.wasteland/*.json`、`README.md`、`package.json`、`src/prompts/`、`src/roles/`、`src/theme/`。
> 已确认：除下列残留外，**无其它影视/游戏 IP**（Fallout/Dune/Star Wars 等均无），**无商标符号**，`src/prompts/`、`src/roles/`、`src/theme/`、`src/skins/default-skins.json`、`.wasteland/skins.json` 均已干净（原创角色 warlord/scout/coder/scholar/sentinel）。

## 目标
满足 PRD 验收标准 #1：`src/` 与对外文案（README/package.json）不含任何《疯狂麦克斯》角色名、专有名词、台词。

## 改动清单（按文件，精确）

### A. 国际化死代码 —— 整段删除（风险最高，代码零引用）
经 grep 确认 `skin.*` 这一整段 i18n 在 `src/` 中**无任何消费者**（含测试），是旧皮肤系统遗留死代码。

- **`src/locales/en.json`**
  - 删除整个 `"skin": { ... }` 顶层对象（从 `"skin": {` 到其配对闭合 `},`，位于 `"utils"` 之后、`"commands"` 之前）。含："Mad Max: Fury Road"、"Immortan Joe's War Machine"、"The Citadel"、"War Boys"、"I am the bounty!"、"Wish, and I shall grant!"、"Forged in the Citadel's furnace!"、"Supreme Commander of the Citadel"、"Command System of the Wasteland Tyrant" 等。
  - `messages.welcome`：`"◆ wasteland - Immortan Joe's War Machine"` → `"◆ wasteland"`
  - `commands.skin.list.emptyHint`：`.skins/immortan-joe/ directory` → `.skins/<skin-id>/ directory`
  - `config.docs.fields.defaultRole`：`(e.g. immortan-joe)` → `(e.g. orchestrator)`
- **`src/locales/zh.json`**（与 en 镜像，同样处理）
  - 删除整个 `"skin": { ... }` 顶层对象。含：不死老乔、圣殿、War Boys、战争机器、"我即恩赐！"、"许愿吧，我成全！"、"奉不死老乔之命…" 等。
  - `messages.welcome`：`"◆ wasteland - 不死老乔的战争机器"` → `"◆ wasteland"`
  - `commands.skin.list.emptyHint`：`.skins/immortan-joe/` → `.skins/<skin-id>/`
  - `config.docs.fields.defaultRole`：`(如 immortan-joe)` → `(如 orchestrator)`
- **`src/locales/i18n.ts`**（注释示例）
  - L128 `"skins.immortan-joe.label"` → `"skins.warlord-stern.label"`
  - L183 `"skins.immortan-joe.thinking"` → `"skins.warlord-stern.thinking"`
  - L216 `"skins.furiosa.catchphrases"` → `"skins.scout.catchphrases"`
  - 删除后需保证 en.json/zh.json 仍是合法 JSON（注意尾逗号）。运行 `node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json'))"` 与 zh 各验一次。

### B. 代码默认值 `immortan-joe` → `warlord-stern`（顺带修 bug：默认值须指向真实存在的皮肤）
- **`src/config/settings-types.ts`**
  - L299 `skinId: 'immortan-joe'` → `skinId: 'warlord-stern'`（`DEFAULT_WASTELAND_SETTINGS`，**关键**）
  - L128 / L170 / L246 注释中的 `immortan-joe` → `warlord-stern`
- **`src/cli.ts`** L77：`?? 'immortan-joe'` → `?? 'warlord-stern'`
- **`src/utils/symlink-manager.ts`** L123：`skinId: string = 'immortan-joe'` → `= 'warlord-stern'`
- **`src/core/runtime/skin-occupancy.ts`** L41 注释：`（如 "nux"）` → `（如 "scout"）`（Nux 是电影角色）

### C. 对外品牌文案
- **`package.json`** L4 `description`：去掉 "with Immortan Joe as the main character"。建议改为 `"Wasteland CLI - A post-apocalyptic themed multi-agent CLI system"`（不含任何影视角色名）。
- **`README.md`**（L3/111/128/201/204/208/223）：
  - L3 标题句去掉 "Immortan Joe's War Machine"，改为产品中性描述（如 "Wasteland - 一个基于 TypeScript、RxJS 和 Ink/React 的多智能体系统…"）。
  - L111 示例 `--role immortan-joe` → `--role orchestrator`
  - L128/201/204/208/223 "主角色（Immortan Joe）" / "Immortan Joe 是唯一主角色" 等 → 改为 "主角色（orchestrator）" / "主角色" 等中性表述。

### D. 测试
- **`src/tui/hooks/useRuntime.test.ts`** L29-33：`skins.immortan-joe.{label,thinking,greeting,catchphrases,errorPrefix}` → `skins.warlord-stern.*`；L65 `skinId: 'immortan-joe'` → `'warlord-stern'`。
- **`src/tui/components/AgentTabs.test.ts`** L96：`tabWidth('Immortan Joe')` → 换成中性名（如 `'Warlord Stern'`），并**同步更新** `toBe(...)` 的期望宽度值（按新字符串实际显示宽度计算，注意中文/全角差异；该字符串是英文，按字符数即可）。

### E. 运行日志（housekeeping，可选但建议）
- `.wasteland/sessions/*.jsonl`、`.wasteland/debug.log` 含历史 `immortan-joe` 记录。这些是运行日志、非产品源码。
  - 将 `.wasteland/sessions/`、`.wasteland/debug.log`、`.wasteland/logs/` 加入 `.gitignore`（若尚未忽略）。
  - `git rm -r --cached .wasteland/sessions .wasteland/debug.log`（仅取消跟踪，不删本地文件，不重写历史）。
  - 若 `.gitignore` 已忽略则跳过。

## 低风险说明（无需改，仅记录）
- 项目名 "wasteland"：通用英文词典词（post-apocalyptic 通用类型词），在此上下文为描述性使用，风险低。若追求极致规避可另行评估，本次不改。
- `src/roles/`、`src/prompts/role-templates.ts`、`src/theme/wasteland/`：已确认无 Mad Max 引用。

## 验收
- `grep -rniE "immortan|furiosa|war boy|citadel|mad max|fury road|thunderdome|war machine|\bnux\b|i am the bounty|不死老乔|圣殿|战争机器|War Boys" src/ README.md package.json` 返回空（排除 `.wasteland/sessions`、`debug.log`）。
- `tsc --noEmit` 通过；相关单测通过；en/zh JSON 合法。
- 默认皮肤 `warlord-stern` 真实存在（`default-skins.json` 已含）。
