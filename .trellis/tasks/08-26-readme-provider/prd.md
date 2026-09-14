# README 私有 provider 示例替换为通用示例

## Goal

README 与用户指南中直接用 `jdcloud` / `xiaomi` 作为示例 provider,它们是供应商私有接入(`GLM-5`、`mimo-v2.5`),对社区读者无意义且会让外人以为项目仅支持国内云。替换为 openai-compatible 通用示例(复用 README 已有的 Qwen `APP_CHAT_*` 三段式配置风格)。

## What I already know

- 引用位置:README.md 6 处;docs/user-guide/getting-started.md ~8 处;tools.md 4 处;multi-agent.md 4 处
- 代码中 `jdcloud`/`xiaomi` 是真实注册的 provider(`src/providers/profiles.ts:139,146`,按 baseUrl 匹配),只改文档示例、不改代码
- README 末尾已有 Qwen 通用示例:`APP_CHAT_BASE_URL` + `APP_CHAT_API_KEY` + `APP_CHAT_MODEL`(DashScope OpenAI-compatible),本地自动切 provider 逻辑已存在

## Assumptions (temporary)

- 替换目标统一为 Qwen/openai-compatible 通用示例(保持文档可运行于真实模型)

## Open Questions

- 替换范围:仅 README.md 还是含 docs/user-guide/ 全部三个文件?(倾向全部,保证一致性)

## Requirements (evolving)

- [x] README / getting-started 中的环境变量示例去掉 jdcloud/xiaomi,换通用示例
- [x] tools.md / multi-agent.md 中的命令示例(如 `tui --provider jdcloud`)换通用写法
- [x] 保留 provider 配置优先级、权限模式等非私有表述不变

## Acceptance Criteria (evolving)

- [x] `grep -riE 'jdcloud|xiaomi'` 对目标文件返回 0 命中。**实测四文件均为 0**
      （README.md / getting-started.md / tools.md / multi-agent.md；含 `GLM-5`、`mimo` 亦为 0）
- [x] 替换后示例仍可由 Qwen / openai-compatible provider 直接运行。
      **静态核实**：`qwen`、`deepseek` 均在 `src/tui/wizard/presets.ts` 预设列表中
      （`type: 'openai-compatible'`）；`deriveAuthKey('qwen') === 'qwen_api_key'` 与文档键名一致。
      **未做真实 API 调用**（不用用户凭据发起外部请求）⇒ 此项为静态核实，非端到端实测。

## Definition of Done

- 文档一致(file check),不涉及代码/测试变更,通过 `npm run check:fast` 回归

## Out of Scope

- 不改 provider 注册代码、不改测试、不动 docs/ 中非 provider 示例部分

## Technical Notes

- 涉及文件:README.md、docs/user-guide/getting-started.md、docs/user-guide/tools.md、docs/user-guide/multi-agent.md
- jdcloud 对应 GLM-5,xiaomi 对应 mimo-v2.5(见 getting-started 注释)
- 示例命令可改用默认 `local`/`qwen` 或省略 `--provider`
---

## 前提订正（2026-09-14，动工前核实）

PRD 原文写「替换为 openai-compatible 通用示例（**复用 README 已有的 Qwen `APP_CHAT_*` 三段式配置风格**）」——
此前提**不成立**：`APP_CHAT` 在 `src` / `scripts` / `bin` 里**零命中**，该桥接已从代码移除，
README 那两段 `APP_CHAT_*` 示例本身已过期。照抄它等于用一个坏例子换另一个。

**改用当前真实机制**（已核实）：

- provider 预设见 `src/tui/wizard/presets.ts`：`deepseek` / `openai` / `qwen` / `glm` /
  `minimax` / `ollama` / `opencode-zen` / `opencode-go` / `custom`，**全部是 `openai-compatible`**。
- 凭据形态见 `src/config/config-writer.ts` 的 `deriveAuthKey()`：`${providerName}_api_key`
  （auth.json 键名与 env 变量名同形，均为小写 `<provider>_api_key`），
  在 settings 里以 `apiKey: { $auth: "<provider>_api_key" }` 引用。
- 因此 getting-started 的「环境变量 / auth.json」两段示例**形状是对的**，只需把私有 provider
  名换成通用预设名。

**替换映射**：

| 原 | 改为 | 依据 |
|---|---|---|
| `jdcloud`（GLM-5 私有接入） | `qwen` | 预设之一，baseUrl `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `xiaomi`（mimo-v2.5 私有接入） | `deepseek` | 预设之一，baseUrl `https://api.deepseek.com/v1` |

**新增 Non-goal**：不顺手修 README 里已过期的 `APP_CHAT_*` 段落（那是另一处文档漂移，
与本任务的 AC 无关；本次只做 provider 名的通用化）。
