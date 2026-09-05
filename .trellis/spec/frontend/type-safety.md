# Type Safety

> Current status / 当前状态: established baseline (TUI exists; unknown-over-any + inference conventions observed).

---

## Observed State / 已观察到的状态

- TUI（`src/tui/`）与命令框架（`src/core/shared/command-*.ts`）已确立三条类型约定，lint `no-explicit-any` 在生产代码零 warning（测试文件除外）。

---

## Rules / 规则

1. **动态参数袋用 `Record<string, unknown>`，不用 `Record<string, any>`**
   Source: `src/core/shared/arg-parser.ts`（`ParseResult.args`）、`command-manager.ts`（`CommandExecutionContext.args`）。
   消费侧用 `as` 收窄（如 `params.args['session-id'] as string | undefined`，见 `command-definitions.ts:104`）或 `typeof` 守卫。
2. **commander handler 不写显式 `: any`，靠推断**
   Source: `src/commands/sessions.ts` 的 `list` handler（无注解）先行，`context.ts` ×4、`sessions.ts` ×3、`resume.ts` ×1 已统一。
   commander 的 `OptionValues` 本就是 any 型记录，显式 `: any` 只是噪音。
3. **外部输入在边界处声明形状**
   Source: `a2a-claude-code-adapter.ts` 的 `ClaudeCodeEvent`（CLI JSONL 输出按期望形状声明，缺失字段 `??` 兜底）。
   不要把 `any` 从边界漏进内部逻辑。

---

## Future Update Checklist / 后续补充清单

- [x] unknown-over-any for arg bags (arg-parser/command-manager)
- [x] inference over explicit any for commander handlers
- [x] boundary types for external input (ClaudeCodeEvent)
- [ ] runtime validation approach（zod 仅在 tool input 用，UI 层暂无）
- [ ] common utility / generic patterns
