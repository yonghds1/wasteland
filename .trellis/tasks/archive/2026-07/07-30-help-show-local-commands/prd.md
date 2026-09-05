# fix: 在 /help 输出里增加本地命令列表

> 任务 slug: `help-show-local-commands` · 创建于 2026-07-30
> 范围: 单文件 UX 修补 + i18n + 一条测试

## Goal

`/help` skill 当前只列"已注册 skill",不列 TUI 本地命令(`/logs`、`/clear`、`/exit`、`/quit`)。用户从 help 里找不到本地命令,UX 错位。本任务:在 `/help`(topic=all 与 topic=skills)的输出末尾加一段 "本地命令",列出 6 条带用途说明。

## What I already know

- `src/skills/skills/help-skill.ts:108-129` 是 `topic === 'all' || topic === 'skills'` 分支,当前列出 skill 调用语法 + 示例
- 没有任何代码引用"本地命令"清单——`/logs` 在 `src/tui/components/ChatInputBar.tsx` onSubmit 内直接分发(PR4a)
- `/clear`、`/exit`、`/quit` 也是 UI 直处理,具体位置见 `src/ui/readline-input.ts` 与 `src/tui/components/ChatInputBar.tsx`
- 现有 skill 测试文件:`src/skills/__tests__/` 或 `src/skills/skills/__tests__/`(待 grep 确认)
- `src/locales/zh.json` + `en.json` 当前必有 `skills.help.skillSystem` / `skillDescription` / `usage` / `example` 等键

## Requirements

- R1: 在 `topic === 'all' || topic === 'skills'` 输出末尾追加小节 "本地命令(本地分发,不走 skill 系统)"。
- R2: 列出 6 条:`/logs`、`/log`、`/debug`、`/logs close`、`/clear`、`/exit`(合并 /quit 与 /exit)。
- R3: 每条 1 行说明:`/logs` 看实时日志,`/log` `/debug` 是别名,`/logs close` 回到 chat,`/clear` 清空聊天,`/exit` 退出。
- R4: i18n keys 加到 `src/locales/zh.json` 与 `en.json`,保持 parity(由 `npm run check:locale-parity` 校验)。
- R5: 单测覆盖:`/help` 输出含 6 条命令全字符串。

## Acceptance Criteria

- [ ] AC1: 在 `/help`(无参数)=`/help skills` 输出末尾能找到 "本地命令" 段。
- [ ] AC2: 该段包含 6 条字符串:`/logs`、`/log`、`/debug`、`/logs close`、`/clear`、`/exit`。
- [ ] AC3: zh 与 en 两个 locale 各有对应键。
- [ ] AC4: `npm run check:locale-parity`、`npm run validate:i18n`、`npm run test` 全绿(无 regression)。

## Definition of Done

- 单元测试覆盖新增段输出
- typecheck/lint/i18n/parity/test 五闸门全绿
- working tree 干净由主 session commit

## Out of Scope

- 不抽取"本地命令注册表"(那是架构级方案 B,本任务采用方案 A 硬编码)
- 不改 ChatInputBar 的实际命令分发
- 不为 `/logs` 子命令的每一条(`/logs errors`、`/logs show <sid>` 等)单独列条目——只列主命令 + close,以控制行数

## Technical Notes

- help-skill.ts:108-128 加 block,模式如:

```ts
lines.push(`## ${t('skills.help.localCommands.title')}`);
lines.push('');
lines.push(t('skills.help.localCommands.description'));
lines.push('');
for (const item of [
  { cmd: '/logs', desc: t('skills.help.localCommands.logs') },
  { cmd: '/log, /debug', desc: t('skills.help.localCommands.logsAlias') },
  { cmd: '/logs close', desc: t('skills.help.localCommands.logsClose') },
  { cmd: '/clear', desc: t('skills.help.localCommands.clear') },
  { cmd: '/exit', desc: t('skills.help.localCommands.exit') },
]) {
  lines.push(`- \`${item.cmd}\` — ${item.desc}`);
}
lines.push('');
```

- i18n 加键(中英对位):
  - `skills.help.localCommands.title`: zh "本地命令", en "Local commands"
  - `skills.help.localCommands.description`: zh "由 TUI 直接分发,不走 skill 系统。", en "Distributed directly by the TUI; not routed through the skill system."
  - `skills.help.localCommands.logs`: "查看实时日志(切到 Logs page)"
  - `skills.help.localCommands.logsAlias`: "`/logs` 的别名"
  - `skills.help.localCommands.logsClose`: "从 Logs page 回到 chat"
  - `skills.help.localCommands.clear`: "清空当前聊天界面"
  - `skills.help.localCommands.exit`: "退出 wasteland"

- 测试位置:先 `grep -rn 'help-skill' /home/ubuntu/workspace/wasteland/src/skills` 找测试文件,然后在该文件加 case。
