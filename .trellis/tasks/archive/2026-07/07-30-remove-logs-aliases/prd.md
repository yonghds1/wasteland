# refactor: 移除 /logs 的 /log 与 /debug 别名

> 任务 slug: `remove-logs-aliases` · 创建于 2026-07-30
> 范围: 4 个文件的小幅清理,移除 2 个 alias,只留 `/logs` 一个 canonical name

## Goal

PR4a 时引入了 3 个 alias:`/logs`(canonical)、`/log` 和 `/debug`。用户指出"通用做法里没这么多别名,保留最通用的一个即可"。本任务:**只留 `/logs`,移除 `/log` 与 `/debug` 两个 alias**。

## What I already know

- `src/tui/route-logs-command.ts` —— `isLogsRootCommand` 函数 + 21 个 unit tests
- `src/skills/skills/help-skill.ts` —— 在 topic=all/skills 末尾列 6 条本地命令,其中第二行当前是 `{ cmd: '/log, /debug', desc: t('skills.help.localCommands.logsAlias') }`
- `src/locales/{zh,en}.json` —— 加过 `skills.help.localCommands.logsAlias` 键
- 测试文件:`src/tui/route-logs-command.test.ts` 含有 "`/log` is alias for /logs" 与 "`/debug` is alias for /logs" 两个 it

## Requirements

- R1: `src/tui/route-logs-command.ts` —— 移除 `/log` 与 `/debug` alias;`isLogsRootCommand` 只接受 `logs`。
- R2: `src/tui/route-logs-command.test.ts` —— 移除 alias 相关的 it(2 条);保留 `/logs` 主入口的所有 case。
- R3: `src/skills/skills/help-skill.ts` —— 移除 alias 项 `{ cmd: '/log, /debug', ... }`,只保留 `/logs` 项。
- R4: `src/locales/zh.json` 与 `en.json` —— 移除 `skills.help.localCommands.logsAlias` 键(无引用)。
- R5: 别名取消后,改名 `isLogsRootCommand` 为 `isLogsCommand`(可选语义改名,也可以保留名字不动)。本任务推荐**保留** `isLogsRootCommand` 不动,避免无关 diff。

## Acceptance Criteria

- [ ] AC1: 输入 `/logs` 仍切到 Logs page(回归确认)
- [ ] AC2: 输入 `/log` 不再被识别为命令(返回 false 或被当 message;与 `/help` 的 fall-through 一致)
- [ ] AC3: 输入 `/debug` 不再被识别为命令(同 AC2)
- [ ] AC4: `/help` 输出不再含 `/log` 或 `/debug` 字符串;本地命令段只剩 `/logs`、`/logs close`、`/clear`、`/exit`
- [ ] AC5: zh/en 两 locale 同步移除 `logsAlias` 键,parity 仍通过
- [ ] AC6: 5 闸门全绿(typecheck/lint/validate:i18n/check:locale-parity/test)

## Definition of Done

- 测试覆盖 `/logs` 主入口与 alias 取消后行为
- typecheck / lint / i18n / parity / test 五闸门全绿
- working tree 干净由主 session commit

## Out of Scope

- 不改 `route-logs-command.ts` 的其它行为(`/logs close`、`/logs errors` 等子命令保留)
- 不改 `/clear`、`/exit` 等其它本地命令
- 不调整 spec 文件(本来就是新合同,本来只有 `/logs` 一个就行)

## Technical Notes

- `src/tui/route-logs-command.ts` 的当前 alias 模式(参考 PR4a 实现):
  ```ts
  export function isLogsRootCommand(cmd: string): boolean {
    return cmd === 'logs' || cmd === 'log' || cmd === 'debug';
  }
  ```
  改为:
  ```ts
  export function isLogsRootCommand(cmd: string): boolean {
    return cmd === 'logs';
  }
  ```
- 测试文件 `src/tui/route-logs-command.test.ts` 移除 `it('accepts logs / log / debug')` 与 `it('handles /log as alias for /logs')` 与 `it('handles /debug as alias for /logs')`。
- 不再需要 alias 项的 i18n 键 —— 从两个 locale 文件删除 `skills.help.localCommands.logsAlias` 键。
